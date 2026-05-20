import os
import re
import time
import json
import uuid
from datetime import datetime
from flask import Flask, send_from_directory, request, jsonify, render_template_string, make_response
import db
from analysis_queue import analysis_queue
from logger import log_event

def sanitize_no_email(name):
    if not name:
        return ""
    email_regex = r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
    sanitized = re.sub(email_regex, 'Projet', name)
    sanitized = re.sub(r'\S+@\S+', 'Projet', sanitized)
    sanitized = sanitized.strip(" -_.,()")
    if sanitized.strip().lower() in ['projet', '']:
        return "Projet Anonyme"
    return sanitized

app = Flask(__name__, static_folder='public', static_url_path='')
log_event("SERVER", "STARTUP", "Flask application initialized")
PORT = int(os.environ.get('PORT', 3000))

uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(uploads_dir, exist_ok=True)
os.makedirs(os.path.join(os.path.dirname(__file__), 'temp_extractions'), exist_ok=True)

# API ENDPOINTS

@app.route('/api/criteria', methods=['GET'])
def get_criteria():
    try:
        log_event("SERVER", "API", "GET /api/criteria requested")
        criteria_path = os.path.join(os.path.dirname(__file__), 'rgesn_criteria.json')
        with open(criteria_path, 'r', encoding='utf-8') as f:
            criteria = json.load(f)
        return jsonify(criteria)
    except Exception as e:
        return jsonify({"error": "Impossible de charger le référentiel des critères."}), 500

@app.route('/api/projects', methods=['GET'])
def get_projects():
    try:
        log_event("SERVER", "API", "GET /api/projects requested")
        projects = db.get_projects()
        return jsonify(projects)
    except Exception as e:
        return jsonify({"error": "Erreur lors de la récupération des projets."}), 500

@app.route('/api/projects/<id>', methods=['GET'])
def get_project_by_id(id):
    try:
        log_event("SERVER", "API", f"GET /api/projects/{id} requested")
        project = db.get_project_by_id(id)
        if not project:
            return jsonify({"error": "Projet introuvable."}), 404
        return jsonify(project)
    except Exception as e:
        return jsonify({"error": "Erreur lors de la récupération du projet."}), 500

@app.route('/api/upload', methods=['POST'])
def upload_project():
    try:
        log_event("SERVER", "API", "POST /api/upload - New project upload initiated")
        
        url = request.form.get('url', '').strip()
        file = request.files.get('file') if 'file' in request.files else None
        
        has_file = file and file.filename != ''
        has_url = bool(url)
        
        if not has_file and not has_url:
            return jsonify({"error": "Veuillez fournir un fichier ZIP et/ou une URL de site web à analyser."}), 400

        project_id = str(uuid.uuid4())
        analysis_mode = request.form.get('analysisMode', 'regex')
        llm_provider = request.form.get('llmProvider', '')
        llm_api_key = request.form.get('llmApiKey', '')
        llm_model = request.form.get('llmModel', '')

        file_path = None
        original_name = ""
        
        requested_name = request.form.get('name', '').strip()
        
        if has_file and not file.filename.lower().endswith('.zip'):
            return jsonify({"error": "Uniquement les fichiers ZIP de projets sont acceptés."}), 400

        if has_file:
            unique_suffix = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
            filename = f"file-{unique_suffix}.zip"
            file_path = os.path.join(uploads_dir, filename)
            file.save(file_path)
            
            if has_url:
                original_name = f"{sanitize_no_email(file.filename)} + {url}"
                project_name = sanitize_no_email(requested_name or file.filename.replace('.zip', ''))
            else:
                original_name = sanitize_no_email(file.filename)
                project_name = sanitize_no_email(requested_name or file.filename.replace('.zip', ''))
        else:
            domain = url
            if '://' in domain:
                domain = domain.split('://')[1]
            domain = domain.split('/')[0]
            original_name = url
            project_name = sanitize_no_email(requested_name or f"Site {domain}")

        new_project = {
            "id": project_id,
            "name": project_name,
            "createdAt": datetime.utcnow().isoformat() + "Z",
            "status": "En attente",
            "globalScore": 0,
            "totalFiles": 0,
            "totalPointsObtained": 0,
            "totalPointsMax": 0,
            "criteria": {},
            "categoryScores": [],
            "error": None,
            "analysisMode": analysis_mode,
            "llmProvider": llm_provider,
            "llmModel": llm_model
        }
        db.add_project(new_project)

        log_event("SERVER", "UPLOAD_SUCCESS", f"Enqueued project '{project_name}' (ID: {project_id}) for mode: {analysis_mode}, provider: {llm_provider}")
        analysis_queue.enqueue(project_id, file_path, original_name, {
            "analysisMode": analysis_mode,
            "llmProvider": llm_provider,
            "llmApiKey": llm_api_key,
            "llmModel": llm_model
        }, url=url if url else None)

        return jsonify({
            "success": True,
            "message": "Projet téléversé et mis en file d'attente pour analyse.",
            "projectId": project_id
        })

    except Exception as e:
        print("Upload error:", e)
        return jsonify({"error": str(e) or "Erreur lors du téléversement du projet."}), 500

@app.route('/api/projects/<id>/manual', methods=['POST'])
def update_manual_criteria(id):
    try:
        log_event("SERVER", "API", f"POST /api/projects/{id}/manual - Manual criteria update requested")
        body = request.get_json() or {}
        updates = body.get('updates')
        
        if not updates or not isinstance(updates, dict):
            return jsonify({"error": "Corps de requête invalide. Attendu: { updates: { Code: statut } }"}), 400

        project = db.get_project_by_id(id)
        if not project:
            return jsonify({"error": "Projet introuvable."}), 404

        for code, new_status in updates.items():
            if code in project.get('criteria', {}):
                if new_status in ['Validé', 'Non-Validé', 'N/A', 'Manuel']:
                    project['criteria'][code]['status'] = new_status
                    if new_status == 'Manuel':
                        project['criteria'][code]['justification'] = "Évaluation manuelle requise."
                    else:
                        project['criteria'][code]['justification'] = "Évalué manuellement par l'utilisateur."

        scores = db.calculate_project_scores(project['criteria'])
        project['globalScore'] = scores['globalScore']
        project['totalPointsObtained'] = scores['totalPointsObtained']
        project['totalPointsMax'] = scores['totalPointsMax']
        project['categoryScores'] = scores['categoryScores']

        db.update_project(project)

        return jsonify({
            "success": True,
            "message": "Déclarations manuelles enregistrées et scores recalculés.",
            "project": project
        })

    except Exception as e:
        print("Manual update error:", e)
        return jsonify({"error": "Erreur lors de la mise à jour des critères manuels."}), 500


@app.route('/api/projects/<id>/pdf', methods=['GET'])
def get_project_pdf(id):
    try:
        log_event("SERVER", "API", f"GET /api/projects/{id}/pdf requested")
        project = db.get_project_by_id(id)
        if not project:
            return jsonify({"error": "Projet introuvable."}), 404

        from fpdf import FPDF
        import textwrap

        # ── Color palette ──────────────────────────────────────────────
        COLOR_DARK   = (15,  23,  42)   # slate-900 background
        COLOR_HEADER = (30,  41,  59)   # slate-800
        COLOR_ACCENT = (16, 185, 129)   # green-500
        COLOR_BLUE   = (59, 130, 246)   # blue-500
        COLOR_AMBER  = (245, 158, 11)   # amber-500
        COLOR_RED    = (239,  68,  68)  # red-500
        COLOR_WHITE  = (255, 255, 255)
        COLOR_LIGHT  = (226, 232, 240)  # slate-200
        COLOR_MUTED  = (148, 163, 184)  # slate-400

        STATUS_COLORS = {
            'Validé':      COLOR_ACCENT,
            'Non-Validé':  COLOR_RED,
            'N/A':         COLOR_MUTED,
            'Manuel':      COLOR_AMBER,
        }

        def score_color(score):
            if score < 40:  return COLOR_RED
            if score < 70:  return COLOR_AMBER
            return COLOR_ACCENT

        def safe_text(text):
            """Return text that legacy FPDF can encode with latin-1."""
            if text is None:
                return ''
            replacements = {
                '\u2013': '-',
                '\u2014': '-',
                '\u2018': "'",
                '\u2019': "'",
                '\u201c': '"',
                '\u201d': '"',
                '\u2026': '...',
                '\u2192': '->',
                '\u00a0': ' ',
            }
            clean = str(text)
            for src, dst in replacements.items():
                clean = clean.replace(src, dst)
            return clean.encode('latin-1', errors='replace').decode('latin-1')

        def wrap_lines(text, width=90):
            """Wrap raw text into a list of lines ≤ width chars."""
            lines = []
            for para in str(text).splitlines():
                if para.strip() == '':
                    lines.append('')
                else:
                    lines.extend(textwrap.wrap(para, width) or [''])
            return lines

        class RGESNReport(FPDF):
            def header(self):
                pass  # custom header per page via draw_page_header()

            def footer(self):
                self.set_y(-14)
                self.set_font('Helvetica', 'I', 7)
                self.set_text_color(*COLOR_MUTED)
                footer_text = f'Rapport RGESN - {project.get("name","Projet")} - Page {self.page_no()}'
                self.cell(0, 6, safe_text(footer_text), align='C')

        pdf = RGESNReport(orientation='P', unit='mm', format='A4')
        pdf.set_auto_page_break(auto=True, margin=18)
        pdf.set_margins(15, 15, 15)

        # ── Helpers ────────────────────────────────────────────────────
        def fill_rect(x, y, w, h, color):
            pdf.set_fill_color(*color)
            pdf.rect(x, y, w, h, 'F')

        def section_title(title, icon=''):
            pdf.ln(4)
            pdf.set_font('Helvetica', 'B', 11)
            pdf.set_text_color(*COLOR_ACCENT)
            pdf.cell(0, 7, safe_text(f'{icon}  {title}'), ln=True)
            # underline
            fill_rect(15, pdf.get_y(), 180, 0.5, COLOR_ACCENT)
            pdf.ln(3)

        def kv_line(label, value, value_color=None):
            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_text_color(*COLOR_MUTED)
            pdf.cell(45, 6, safe_text(label + ' :'), ln=False)
            pdf.set_font('Helvetica', '', 9)
            if value_color:
                pdf.set_text_color(*value_color)
            else:
                pdf.set_text_color(*COLOR_WHITE)
            pdf.cell(0, 6, safe_text(str(value)), ln=True)

        # ══════════════════════════════════════════════════════════════
        # PAGE 1 – COVER
        # ══════════════════════════════════════════════════════════════
        pdf.add_page()
        fill_rect(0, 0, 210, 297, COLOR_DARK)

        # Top accent stripe
        fill_rect(0, 0, 210, 3, COLOR_ACCENT)

        # RGESN badge
        pdf.set_xy(15, 22)
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_text_color(*COLOR_ACCENT)
        pdf.cell(0, 6, 'REFERENTIEL GENERAL D\'ECOCONCEPTION DES SERVICES NUMERIQUES', ln=True)

        # Report title
        pdf.set_xy(15, 34)
        pdf.set_font('Helvetica', 'B', 26)
        pdf.set_text_color(*COLOR_WHITE)
        pdf.multi_cell(180, 12, safe_text('Rapport d\'Audit\nRGESN'), align='L')

        # Project name
        pdf.ln(2)
        pdf.set_font('Helvetica', 'B', 16)
        pdf.set_text_color(*COLOR_ACCENT)
        pdf.multi_cell(180, 9, safe_text(project.get('name', 'Projet')), align='L')

        # Separator line
        fill_rect(15, pdf.get_y() + 4, 180, 1, COLOR_HEADER)
        pdf.ln(8)

        # Global score big display
        score = project.get('globalScore', 0)
        sc = score_color(score)
        pdf.set_font('Helvetica', 'B', 52)
        pdf.set_text_color(*sc)
        pdf.cell(0, 24, f'{score}%', align='C', ln=True)
        pdf.set_font('Helvetica', '', 10)
        pdf.set_text_color(*COLOR_MUTED)
        pdf.cell(0, 6, 'Score de conformite global', align='C', ln=True)
        pdf.ln(6)

        # Key metrics row (3 boxes)
        criteria_map = project.get('criteria', {})
        total  = len(criteria_map)
        valide = sum(1 for c in criteria_map.values() if c.get('status') == 'Validé')
        non_v  = sum(1 for c in criteria_map.values() if c.get('status') == 'Non-Validé')
        na     = sum(1 for c in criteria_map.values() if c.get('status') == 'N/A')

        boxes = [
            ('Criteres valides',   valide, COLOR_ACCENT),
            ('Non-Valides',        non_v,  COLOR_RED),
            ('Non-Applicables',    na,     COLOR_MUTED),
        ]
        bw, bh, bx, by = 54, 28, 15, pdf.get_y()
        for i, (lbl, val, col) in enumerate(boxes):
            fill_rect(bx + i*(bw+6), by, bw, bh, COLOR_HEADER)
            pdf.set_xy(bx + i*(bw+6), by + 4)
            pdf.set_font('Helvetica', 'B', 20)
            pdf.set_text_color(*col)
            pdf.cell(bw, 10, str(val), align='C', ln=False)
            pdf.set_xy(bx + i*(bw+6), by + 15)
            pdf.set_font('Helvetica', '', 7)
            pdf.set_text_color(*COLOR_MUTED)
            pdf.cell(bw, 5, safe_text(lbl), align='C', ln=False)
        pdf.set_y(by + bh + 8)

        # Metadata block
        fill_rect(15, pdf.get_y(), 180, 32, COLOR_HEADER)
        pdf.set_xy(20, pdf.get_y() + 4)
        created_at = project.get('createdAt', '')
        if created_at:
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(created_at.replace('Z',''))
                created_at = dt.strftime('%d/%m/%Y à %H:%M')
            except Exception:
                pass
        kv_line('Date d\'analyse', created_at)
        kv_line('Fichiers analyses', str(project.get('totalFiles', 0)) + ' fichiers')
        kv_line('Points obtenus',
                f"{project.get('totalPointsObtained',0)} / {project.get('totalPointsMax',0)} points")
        kv_line('Mode d\'analyse', project.get('analysisMode', 'regex').upper())
        pdf.ln(5)

        # Bottom note
        pdf.set_font('Helvetica', 'I', 7)
        pdf.set_text_color(*COLOR_MUTED)
        pdf.set_y(-24)
        pdf.cell(0, 5, 'Ce rapport a ete genere automatiquement par EcoAudit RGESN.', align='C', ln=True)

        # ══════════════════════════════════════════════════════════════
        # PAGE 2 – SCORES PAR CATEGORIE + RECAP PROJET
        # ══════════════════════════════════════════════════════════════
        pdf.add_page()
        fill_rect(0, 0, 210, 297, COLOR_DARK)
        fill_rect(0, 0, 210, 3, COLOR_ACCENT)

        # Page title
        pdf.set_xy(15, 12)
        pdf.set_font('Helvetica', 'B', 14)
        pdf.set_text_color(*COLOR_WHITE)
        pdf.cell(0, 8, 'Synthese & Scores par Categorie', ln=True)

        section_title('Scores par dimension RGESN', '')

        cat_scores = project.get('categoryScores', [])
        for cat in cat_scores:
            cname = safe_text(cat.get('name',''))
            cscore = cat.get('score', 0)
            cval   = cat.get('validatedCount', 0)
            cnval  = cat.get('notValidatedCount', 0)
            cc     = score_color(cscore)

            # Category label
            pdf.set_font('Helvetica', 'B', 8)
            pdf.set_text_color(*COLOR_LIGHT)
            pdf.cell(95, 5, cname[:50], ln=False)

            # Score value
            pdf.set_font('Helvetica', 'B', 8)
            pdf.set_text_color(*cc)
            pdf.cell(15, 5, f'{cscore}%', align='R', ln=False)

            # mini stats
            pdf.set_font('Helvetica', '', 7)
            pdf.set_text_color(*COLOR_MUTED)
            pdf.cell(0, 5, f'  {cval}V  {cnval}X', ln=True)

            # progress bar
            bar_x = pdf.get_x() + 0  # already at left margin
            bar_y = pdf.get_y()
            fill_rect(15, bar_y, 180, 3, COLOR_HEADER)
            fill_width = max(1, int(180 * cscore / 100)) if cscore > 0 else 0
            fill_rect(15, bar_y, fill_width, 3, cc)
            pdf.ln(5)

        # ── Project summary (if available via summary field) ──────────
        summary_text = project.get('llmActionPlan') or project.get('summary', '')
        if summary_text:
            pdf.ln(3)
            section_title('Recapitulatif du Projet (Synthese IA)', '')
            pdf.set_font('Helvetica', '', 8)
            pdf.set_text_color(*COLOR_MUTED)
            # Strip markdown symbols for clean plain-text PDF rendering
            import re as _re
            clean = _re.sub(r'\*\*?(.*?)\*\*?', r'\1', summary_text)
            clean = _re.sub(r'^#{1,4}\s*', '', clean, flags=_re.MULTILINE)
            clean = _re.sub(r'`{1,3}', '', clean)
            for line in wrap_lines(clean, 95):
                pdf.set_x(15)
                pdf.cell(0, 4.5, safe_text(line), ln=True)

        # ══════════════════════════════════════════════════════════════
        # PAGE 3+ – STATUT DETAILLE PAR CRITERE
        # ══════════════════════════════════════════════════════════════
        pdf.add_page()
        fill_rect(0, 0, 210, 297, COLOR_DARK)
        fill_rect(0, 0, 210, 3, COLOR_ACCENT)

        pdf.set_xy(15, 12)
        pdf.set_font('Helvetica', 'B', 14)
        pdf.set_text_color(*COLOR_WHITE)
        pdf.cell(0, 8, 'Detail des Criteres RGESN', ln=True)

        section_title('Statut de chaque critere', '')

        # Table header
        col_w = [18, 90, 22, 20, 24]  # Code | Texte | Priorité | Difficulté | Statut
        headers = ['Code', 'Critere / Point de controle', 'Priorite', 'Difficulte', 'Statut']
        hx = 15
        hy = pdf.get_y()
        fill_rect(hx, hy, 180, 7, COLOR_HEADER)
        pdf.set_xy(hx, hy)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.set_text_color(*COLOR_ACCENT)
        for w, h in zip(col_w, headers):
            pdf.cell(w, 7, safe_text(h), border=0, ln=False)
        pdf.ln(7)

        # Table rows
        pdf.set_font('Helvetica', '', 7)
        row_idx = 0
        for code, crit in sorted(criteria_map.items()):
            status   = crit.get('status', 'N/A')
            text     = crit.get('text', '')
            priority = crit.get('priority', '')
            diff     = crit.get('difficulty', '')
            just     = crit.get('justification', '')

            # Alternate row background
            ry = pdf.get_y()
            if pdf.get_y() > 270:
                pdf.add_page()
                fill_rect(0, 0, 210, 297, COLOR_DARK)
                fill_rect(0, 0, 210, 3, COLOR_ACCENT)
                pdf.set_y(15)
                ry = pdf.get_y()

            row_bg = COLOR_HEADER if row_idx % 2 == 0 else (22, 33, 55)
            fill_rect(15, ry, 180, 6.5, row_bg)

            scolor = STATUS_COLORS.get(status, COLOR_MUTED)
            pdf.set_xy(15, ry)
            pdf.set_text_color(*COLOR_ACCENT)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(col_w[0], 6.5, safe_text(code), ln=False)

            pdf.set_text_color(*COLOR_LIGHT)
            pdf.set_font('Helvetica', '', 7)
            max_text = text[:65] + ('…' if len(text) > 65 else '')
            pdf.cell(col_w[1], 6.5, safe_text(max_text), ln=False)

            pdf.set_text_color(*COLOR_MUTED)
            pdf.cell(col_w[2], 6.5, safe_text(priority[:12]), ln=False)
            pdf.cell(col_w[3], 6.5, safe_text(diff[:10]), ln=False)

            pdf.set_text_color(*scolor)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(col_w[4], 6.5, safe_text(status), ln=True)

            # Justification (smaller, indented)
            if just and status != 'N/A':
                jlines = wrap_lines(just, 100)[:2]  # max 2 lines
                for jl in jlines:
                    if pdf.get_y() > 272:
                        break
                    pdf.set_x(15 + col_w[0])
                    pdf.set_font('Helvetica', 'I', 6)
                    pdf.set_text_color(*COLOR_MUTED)
                    pdf.cell(0, 4, safe_text(jl), ln=True)

            row_idx += 1

        # ══════════════════════════════════════════════════════════════
        # LAST PAGE – PLAN D'ACTION
        # ══════════════════════════════════════════════════════════════
        non_validated = [c for c in criteria_map.values() if c.get('status') == 'Non-Validé']
        if non_validated:
            pdf.add_page()
            fill_rect(0, 0, 210, 297, COLOR_DARK)
            fill_rect(0, 0, 210, 3, COLOR_ACCENT)

            pdf.set_xy(15, 12)
            pdf.set_font('Helvetica', 'B', 14)
            pdf.set_text_color(*COLOR_WHITE)
            pdf.cell(0, 8, 'Plan d\'Action - Criteres a corriger', ln=True)
            section_title(f'{len(non_validated)} critere(s) Non-Valide(s) a traiter', '')

            # Sort by priority then difficulty
            def sort_key(c):
                p = 0 if 'prioritaire' in c.get('priority','').lower() else 1
                d = {'faible':0,'moyen':1,'fort':2}.get(c.get('difficulty','').lower(), 1)
                return (p, d)
            non_validated.sort(key=sort_key)

            for crit in non_validated:
                if pdf.get_y() > 265:
                    pdf.add_page()
                    fill_rect(0, 0, 210, 297, COLOR_DARK)
                    fill_rect(0, 0, 210, 3, COLOR_ACCENT)
                    pdf.set_y(15)

                cy = pdf.get_y()
                fill_rect(15, cy, 180, 5, COLOR_RED)
                pdf.set_xy(15, cy)
                pdf.set_font('Helvetica', 'B', 8)
                pdf.set_text_color(*COLOR_WHITE)
                pdf.cell(22, 5, safe_text(crit.get('code','')), ln=False)
                pdf.set_font('Helvetica', '', 8)
                cat_text = f"[{crit.get('category','')}]  {crit.get('priority','')} — {crit.get('difficulty','')}"
                pdf.cell(0, 5, safe_text(cat_text[:80]), ln=True)

                # Criterion text
                pdf.set_x(15)
                pdf.set_font('Helvetica', 'B', 7.5)
                pdf.set_text_color(*COLOR_LIGHT)
                for line in wrap_lines(crit.get('text',''), 93)[:3]:
                    pdf.set_x(15)
                    pdf.cell(0, 4.5, safe_text(line), ln=True)

                # Justification
                just = crit.get('justification','')
                if just:
                    pdf.set_x(15)
                    pdf.set_font('Helvetica', 'I', 7)
                    pdf.set_text_color(*COLOR_MUTED)
                    for jl in wrap_lines(just, 93)[:3]:
                        pdf.set_x(18)
                        pdf.cell(0, 4, safe_text('> ' + jl), ln=True)

                pdf.ln(3)

        # ── Output ────────────────────────────────────────────────────
        pdf_output = pdf.output(dest='S')
        pdf_bytes = bytes(pdf_output) if isinstance(pdf_output, bytearray) else pdf_output.encode('latin-1')
        response = make_response(pdf_bytes)
        response.headers['Content-Type'] = 'application/pdf'
        safe_name = project.get('name','project').replace(' ', '_')[:40]
        response.headers['Content-Disposition'] = f'attachment; filename=rapport_rgesn_{safe_name}.pdf'
        log_event("SERVER", "PDF_SUCCESS", f"PDF generated for project {id} ({len(pdf_bytes)} bytes)")
        return response

    except Exception as e:
        import traceback
        log_event("SERVER", "PDF_ERROR", traceback.format_exc())
        return jsonify({"error": f"Erreur lors de la generation du PDF : {str(e)}"}), 500

def build_criteria_context(non_validated: list) -> str:
    """Construit un contexte compact pour le LLM."""
    lines = []
    
    # Grouper par catégorie
    by_category = {}
    for c in non_validated:
        cat = c.get('category', 'Autre')
        by_category.setdefault(cat, []).append(c)
    
    for category, items in by_category.items():
        codes = ', '.join(i['code'] for i in items)
        priorities = [i['priority'] for i in items if i.get('priority')]
        priority_str = f"(dont {priorities.count('Haute')} haute priorité)" if priorities else ""
        lines.append(f"- {category} ({len(items)} critères : {codes}) {priority_str}")
        
        # Ajouter les constats les plus importants uniquement
        for item in items:
            if item.get('justification'):
                lines.append(f"  → {item['justification'][:120]}")  # Tronquer
    
    return '\n'.join(lines)


@app.route('/api/projects/<id>/summary', methods=['POST'])
def get_project_summary(id):
    try:
        log_event("SERVER", "API", f"POST /api/projects/{id}/summary requested")
        project = db.get_project_by_id(id)
        if not project:
            return jsonify({"error": "Projet introuvable."}), 404
            
        body = request.get_json() or {}
        llm_config = {
            "llmProvider": body.get('llmProvider', 'local'),
            "llmModel": body.get('llmModel', ''),
            "llmApiKey": body.get('llmApiKey', '')
        }
        
        criteria = project.get('criteria', {})
        non_validated = []
        for code, crit in criteria.items():
            if crit.get('status') == 'Non-Validé':
                non_validated.append({
                    "code": code,
                    "category": crit.get('category'),
                    "text": crit.get('text'),
                    "priority": crit.get('priority'),
                    "difficulty": crit.get('difficulty'),
                    "justification": crit.get('justification'),
                    "findings": crit.get('findings', [])
                })
                
        if not non_validated:
            return jsonify({"summary": "Félicitations ! Aucun critère n'est non-validé dans ce projet. Votre plan d'action est déjà vide."})
            
        from analyzer import query_llm, extract_json
        
                # --- NOUVEAUX PROMPTS ---
        system_prompt = (
            "Tu es un expert en écoconception de services numériques. "
            "Ton objectif est de créer une feuille de route chronologique et synthétique à partir d'un audit. "
            "RÈGLES STRICTES : "
            "1. NE RECOPIE SURTOUT PAS les critères un par un. Synthétise-les par thématiques. "
            "2. Rédige exactement 3 ou 4 étapes chronologiques (ex: Court terme, Moyen terme, Long terme). "
            "3. La réponse globale doit faire entre 10 et 16 lignes maximum. "
            "4. Sois direct, professionnel et actionnable."
        )
        
        criteria_context = build_criteria_context(non_validated)
            
        user_prompt = (
            f"Voici les critères RGESN en échec pour le projet '{project.get('name')}':\n"
            f"{criteria_context}\n\n"
            "Génère la feuille de route en respectant STRICTEMENT ce format (ne rajoute pas de texte avant ou après) :\n\n"
            "### 🗺️ Feuille de route d'écoconception\n\n"
            "**Étape 1 : [Titre de l'étape - ex: Fondations & Spécifications]**\n"
            "- [Action de synthèse 1]\n"
            "- [Action de synthèse 2]\n\n"
            "**Étape 2 : [Titre de l'étape - ex: Optimisations Frontend & Backend]**\n"
            "- [Action de synthèse 1]\n"
            "- [Action de synthèse 2]\n\n"
            "**Étape 3 : [Titre de l'étape - ex: Hébergement & Maintenance]**\n"
            "- [Action de synthèse 1]\n"
        )
        
        # Call LLM directly without JSON constraint to avoid infinite Qwen loops
        provider = llm_config.get('llmProvider', 'local')
        model = llm_config.get('llmModel', '')
        api_key = llm_config.get('llmApiKey', '')
        
        summary_text = ""
        
        if provider == 'local':
            import ollama
            model_name = model if model else 'qwen3:0.6b'
            messages = [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt}
            ]
            response = ollama.chat(
                model=model_name,
                messages=messages,
                options={'temperature': 0.05}
            )
            summary_text = response['message']['content'].strip()
            
        elif provider == 'openai':
            import requests
            url = 'https://api.openai.com/v1/chat/completions'
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }
            body = {
                'model': model if model else 'gpt-4o-mini',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                'temperature': 0.1
            }
            res = requests.post(url, json=body, headers=headers, timeout=60)
            res.raise_for_status()
            summary_text = res.json()['choices'][0]['message']['content']
            
        elif provider == 'mistral':
            import requests
            url = 'https://api.mistral.ai/v1/chat/completions'
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }
            body = {
                'model': model if model else 'mistral-tiny',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                'temperature': 0.1
            }
            res = requests.post(url, json=body, headers=headers, timeout=60)
            res.raise_for_status()
            summary_text = res.json()['choices'][0]['message']['content']
            
        else:
            # Fallback to analyzer query_llm
            from analyzer import query_llm, extract_json
            summary_raw = query_llm(llm_config, system_prompt, user_prompt)
            try:
                parsed = extract_json(summary_raw)
                summary_text = parsed.get('summary', summary_raw)
            except Exception:
                summary_text = summary_raw
            
        return jsonify({"summary": summary_text})
        
    except Exception as e:
        print("Summary generation error:", e)
        error_msg = str(e)
        if "ConnectionRefusedError" in error_msg or "Failed to establish a new connection" in error_msg or "connection" in error_msg.lower():
            error_msg = "Impossible de se connecter au service Ollama local. Veuillez vous assurer qu'Ollama est démarré et que le modèle requis est téléchargé."
        return jsonify({"error": f"Erreur lors de la génération du plan d'action : {error_msg}"}), 500

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def catch_all(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    print("===================================================")
    print(f" RGESN Scoring Application Server is running! (PYTHON)")
    print(f" Web interface: http://localhost:{PORT}")
    print(f" Environment:   Production / GreenIT optimized")
    print("===================================================")
    app.run(host='0.0.0.0', port=PORT)
