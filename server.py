import os
import time
import json
import uuid
from datetime import datetime
from flask import Flask, send_from_directory, request, jsonify
import db
from analysis_queue import analysis_queue
from logger import log_event

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
        if 'file' not in request.files:
            return jsonify({"error": "Veuillez fournir un fichier ZIP de projet."}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "Fichier vide ou invalide."}), 400

        if not file.filename.lower().endswith('.zip'):
            return jsonify({"error": "Uniquement les fichiers ZIP de projets sont acceptés."}), 400

        project_name = request.form.get('name') or file.filename.replace('.zip', '') or "Projet Anonyme"
        project_id = str(uuid.uuid4())

        analysis_mode = request.form.get('analysisMode', 'regex')
        llm_provider = request.form.get('llmProvider', '')
        llm_api_key = request.form.get('llmApiKey', '')
        llm_model = request.form.get('llmModel', '')

        unique_suffix = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        filename = f"file-{unique_suffix}.zip"
        file_path = os.path.join(uploads_dir, filename)
        file.save(file_path)

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
        analysis_queue.enqueue(project_id, file_path, file.filename, {
            "analysisMode": analysis_mode,
            "llmProvider": llm_provider,
            "llmApiKey": llm_api_key,
            "llmModel": llm_model
        })

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

@app.route('/api/projects/<id>', methods=['DELETE'])
def delete_project(id):
    try:
        log_event("SERVER", "API", f"DELETE /api/projects/{id} requested")
        project = db.get_project_by_id(id)
        if not project:
            return jsonify({"error": "Projet introuvable."}), 404
        
        db.delete_project(id)
        return jsonify({"success": True, "message": "Projet supprimé de l'historique."})
    except Exception as e:
        return jsonify({"error": "Erreur lors de la suppression du projet."}), 500

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
