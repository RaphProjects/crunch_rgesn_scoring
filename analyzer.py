import os
import re
import json
import time
import requests
import ollama
import subprocess
from logger import log_event

def clean_json_string(json_text):
    in_string = False
    escaped = False
    result = []
    
    i = 0
    n = len(json_text)
    while i < n:
        char = json_text[i]
        
        if char == '"' and not escaped:
            in_string = not in_string
            result.append(char)
        elif in_string:
            if escaped:
                if char not in ['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']:
                    result.append('\\' + char)
                else:
                    result.append(char)
                escaped = False
            elif char == '\\':
                escaped = True
                result.append(char)
            elif char == '\n':
                result.append('\\n')
            elif char == '\r':
                result.append('\\r')
            elif char == '\t':
                result.append('\\t')
            else:
                result.append(char)
        else:
            result.append(char)
            escaped = False
        i += 1
    return "".join(result)

def extract_json(text):
    clean_text = text.strip()
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', clean_text)
    if match:
        clean_text = match.group(1).strip()
    else:
        first_brace = clean_text.find('{')
        last_brace = clean_text.rfind('}')
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            clean_text = clean_text[first_brace:last_brace+1]
    
    # Common JSON repairs
    clean_text = re.sub(r'"(\s*[\n\r]+\s*)"', '",\\1"', clean_text)
    clean_text = re.sub(r'}(\s*[\n\r]+\s*){', '},\\1{', clean_text)
    clean_text = re.sub(r'](\s*[\n\r]+\s*)\[', '],\\1[', clean_text)
    clean_text = re.sub(r'"(\s*[\n\r]+\s*){', '",\\1{', clean_text)
    clean_text = re.sub(r'}(\s*[\n\r]+\s*)"', '},\\1"', clean_text)
    clean_text = re.sub(r'](\s*[\n\r]+\s*)"', '],\\1"', clean_text)
    clean_text = re.sub(r'"(\s*[\n\r]+\s*)\[', '",\\1[', clean_text)
    clean_text = re.sub(r'}(\s*[\n\r]+\s*)\[', '},\\1[', clean_text)
    clean_text = re.sub(r'](\s*[\n\r]+\s*){', '],\\1{', clean_text)
    
    # Fix trailing commas
    clean_text = re.sub(r',\s*([\]}])', r'\1', clean_text)
    
    try:
        return json.loads(clean_json_string(clean_text))
    except Exception as e:
        raise ValueError(f"Impossible de parser le JSON retourné par l'IA : {str(e)} (Clean text: {clean_text[:100]}...)")

def should_anonymize_provider(provider):
    return provider in ['openai', 'mistral', 'anthropic']

def anonymize_for_external_llm(text):
    if not text:
        return ""
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_anonymizer import AnonymizerEngine

        analyzer = AnalyzerEngine()
        anonymizer = AnonymizerEngine()
        results = analyzer.analyze(text=str(text), language="fr")
        return anonymizer.anonymize(text=str(text), analyzer_results=results).text
    except Exception:
        anonymized = str(text)
        patterns = [
            (r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', '[EMAIL]'),
            (r'https?://[^\s\]\)\}>"\']+', '[URL]'),
            (r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '[IP]'),
            (r'\b(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}\b', '[PHONE]'),
            (r'(?i)\b(api[_-]?key|token|secret|password|passwd|bearer)\s*[:=]\s*[^\s,;]+', r'\1=[SECRET]'),
            (r'(?i)\b(sk-[a-z0-9_-]{10,}|xox[baprs]-[a-z0-9-]+)\b', '[SECRET]'),
            (r'(?i)\b(c:\\|/home/|/users/)[^\s\]\)\}>"\']+', '[PATH]'),
        ]
        for pattern, replacement in patterns:
            anonymized = re.sub(pattern, replacement, anonymized)
        return anonymized

def query_llm(config, system_prompt, user_prompt):
    provider = config.get('llmProvider')
    model = config.get('llmModel')
    api_key = config.get('llmApiKey')
    model_name = model if model else 'default'
    if should_anonymize_provider(provider):
        system_prompt = anonymize_for_external_llm(system_prompt)
        user_prompt = anonymize_for_external_llm(user_prompt)

    log_event("LLM_CLIENT", "REQUEST", f"Querying provider: {provider}, model: {model_name}", f"System Prompt:\n{system_prompt}\n\nUser Prompt:\n{user_prompt}")

    if provider == 'local':
        messages = [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt}
        ]
        model_name = model if model else 'qwen3:0.6b'
        response = ollama.chat(
            model=model_name,
            messages=messages,
            options={'temperature': 0.1},
            format='json'
        )
        content = response['message']['content']
        log_event("LLM_CLIENT", "RESPONSE", f"Success from provider: {provider}", f"Raw Response:\n{content}")
        return content

    if provider == 'openai':
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
            'temperature': 0.1,
            'response_format': {'type': 'json_object'}
        }
        res = requests.post(url, json=body, headers=headers, timeout=45)
        res.raise_for_status()
        content = res.json()['choices'][0]['message']['content']
        log_event("LLM_CLIENT", "RESPONSE", f"Success from provider: {provider}", f"Raw Response:\n{content}")
        return content

    if provider == 'mistral':
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
            'temperature': 0.1,
            'response_format': {'type': 'json_object'}
        }
        res = requests.post(url, json=body, headers=headers, timeout=45)
        res.raise_for_status()
        content = res.json()['choices'][0]['message']['content']
        log_event("LLM_CLIENT", "RESPONSE", f"Success from provider: {provider}", f"Raw Response:\n{content}")
        return content

    if provider == 'anthropic':
        url = 'https://api.anthropic.com/v1/messages'
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01'
        }
        body = {
            'model': model if model else 'claude-3-5-haiku',
            'max_tokens': 4000,
            'system': system_prompt,
            'messages': [
                {'role': 'user', 'content': user_prompt}
            ],
            'temperature': 0.1
        }
        res = requests.post(url, json=body, headers=headers, timeout=45)
        res.raise_for_status()
        content = res.json()['content'][0]['text']
        log_event("LLM_CLIENT", "RESPONSE", f"Success from provider: {provider}", f"Raw Response:\n{content}")
        return content

    raise ValueError(f"Fournisseur d'IA inconnu ou non supporté : {provider}")

def extract_pdf_text(file_path, max_chars=12000):
    try:
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        parts = []
        for page in reader.pages[:20]:
            text = page.extract_text() or ""
            if text:
                parts.append(text)
            if sum(len(p) for p in parts) >= max_chars:
                break
        return "\n".join(parts)[:max_chars]
    except Exception:
        pass

    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(file_path)
        parts = []
        for page in reader.pages[:20]:
            text = page.extract_text() or ""
            if text:
                parts.append(text)
            if sum(len(p) for p in parts) >= max_chars:
                break
        return "\n".join(parts)[:max_chars]
    except Exception:
        pass

    try:
        completed = subprocess.run(
            ["pdftotext", "-layout", file_path, "-"],
            capture_output=True,
            text=True,
            timeout=20,
            encoding="utf-8",
            errors="ignore"
        )
        if completed.returncode == 0:
            return completed.stdout[:max_chars]
    except Exception:
        pass

    return ""

def normalize_text_for_match(text):
    text = (text or "").lower()
    replacements = {
        "é": "e", "è": "e", "ê": "e", "ë": "e",
        "à": "a", "â": "a", "ä": "a",
        "î": "i", "ï": "i",
        "ô": "o", "ö": "o",
        "ù": "u", "û": "u", "ü": "u",
        "ç": "c", "œ": "oe", "æ": "ae",
        "’": "'", "“": '"', "”": '"'
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return re.sub(r"[^a-z0-9]+", " ", text)

def extract_keywords(text, limit=10):
    stopwords = {
        "service", "numerique", "utilise", "utiliser", "avoir", "avec", "pour", "dans",
        "dont", "des", "les", "une", "aux", "sur", "son", "ses", "leur", "leurs",
        "est", "sont", "elle", "mise", "place", "recours", "adapte", "contexte",
        "fonction", "fonctionnement", "utilisateur", "utilisateurs"
    }
    words = normalize_text_for_match(text).split()
    keywords = []
    for word in words:
        if len(word) < 5 or word in stopwords:
            continue
        if word not in keywords:
            keywords.append(word)
        if len(keywords) >= limit:
            break
    return keywords

def build_document_evidence(criteria_repo, file_contents):
    docs = [
        f for f in file_contents
        if f.get('ext') in ['.md', '.txt', '.pdf'] or 'readme' in f.get('name', '').lower() or 'doc' in f.get('relPath', '').lower()
    ]
    evidence = {crit.get('code'): [] for crit in criteria_repo}
    if not docs:
        return evidence

    for crit in criteria_repo:
        code = crit.get('code')
        keywords = extract_keywords(" ".join([
            crit.get('text', ''),
            crit.get('objective', ''),
            crit.get('category', ''),
            crit.get('target', ''),
        ]), limit=14)
        for doc in docs:
            content = doc.get('content', '')
            normalized = normalize_text_for_match(content)
            has_code = bool(code and re.search(rf"\b{re.escape(code.lower())}\b", content.lower()))
            score = sum(1 for kw in keywords if kw in normalized)
            if has_code or score >= 4:
                snippet = content[:900].replace("\r", " ").strip()
                evidence[code].append({
                    "file": doc.get('relPath'),
                    "reason": "code cité" if has_code else f"{score} mots-clés concordants",
                    "snippet": snippet
                })
                if len(evidence[code]) >= 3:
                    break
    return evidence

def select_llm_target_codes(results, criteria_repo, document_evidence, target_count=35):
    ordered_codes = [crit.get('code') for crit in criteria_repo if crit.get('code') in results]
    selected = []

    def add(code):
        if code in results and code not in selected:
            selected.append(code)

    for code in ordered_codes:
        if document_evidence.get(code):
            add(code)

    for code in ordered_codes:
        if results[code].get('type') == 'auto':
            add(code)

    priority_codes = [
        'Str1', 'Str2', 'Str5', 'Str6', 'Str7', 'Str8', 'Str10',
        'Spec6', 'Spec8', 'Spec9', 'Spec10',
        'Arch1', 'Arch2', 'Arch3', 'Arch4', 'Arch5', 'Arch6', 'Arch7',
        'Uxui3', 'Uxui4', 'Uxui5', 'Uxui6', 'Uxui7', 'Uxui12', 'Uxui14', 'Uxui15',
        'Heb1', 'Heb2', 'Heb3', 'Heb4', 'Heb5', 'Heb6', 'Heb7', 'Heb8', 'Heb9', 'Heb10',
    ]
    for code in priority_codes:
        add(code)
        if len(selected) >= target_count:
            break

    return [code for code in ordered_codes if code in selected][:target_count]

def collect_project_context(dir_path, file_contents):
    file_tree = [f['relPath'] for f in file_contents]
    package_json = next((f for f in file_contents if f['name'] == 'package.json'), None)
    readme = next((f for f in file_contents if 'readme' in f['name'].lower()), None)
    dockerfile = next((f for f in file_contents if f['name'].lower() == 'dockerfile'), None)
    requirements = next((f for f in file_contents if f['name'] == 'requirements.txt'), None)

    context = f"Nom du projet : {os.path.basename(dir_path)}\n\n"
    context += f"Arborescence des fichiers :\n" + "\n".join(file_tree[:100]) + "\n"
    if len(file_tree) > 100:
        context += f"... et {len(file_tree) - 100} autres fichiers.\n"

    if package_json:
        context += f"\n--- FICHIER DE DÉPENDANCE (package.json) ---\n{package_json['content']}\n"
    if requirements:
        context += f"\n--- FICHIER DE DÉPENDANCE (requirements.txt) ---\n{requirements['content']}\n"
    if dockerfile:
        context += f"\n--- CONFIGURATION DE DÉPLOIEMENT (Dockerfile) ---\n{dockerfile['content'][:1000]}\n"
    if readme:
        context += f"\n--- DOCUMENTATION DU PROJET (README) ---\n{readme['content'][:3000]}\n"

    doc_files = [
        f for f in file_contents
        if f['ext'] in ['.md', '.txt', '.pdf'] and f is not readme
    ]
    if doc_files:
        context += "\n--- DOCUMENTATION COMPLEMENTAIRE (.md/.txt/.pdf) ---\n"
        for f in doc_files[:8]:
            context += f"Fichier {f['relPath']} :\n{f['content'][:2500]}\n\n"

    html_files = [f for f in file_contents if f['ext'] == '.html']
    if html_files:
        context += f"\n--- EXTRAITS HTML (échantillons) ---\n"
        for f in html_files[:3]:
            context += f"Fichier {f['relPath']} (premières lignes) :\n{f['content'][:800]}\n\n"

    js_files = [f for f in file_contents if f['ext'] in ['.js', '.jsx', '.ts', '.tsx']]
    if js_files:
        context += f"\n--- EXTRAITS CODE SOURCE JS/TS (échantillons) ---\n"
        for f in js_files[:3]:
            context += f"Fichier {f['relPath']} (premières lignes) :\n{f['content'][:1000]}\n\n"

    return context

def get_all_files(dir_path, array_of_files=None):
    if array_of_files is None:
        array_of_files = []
    
    try:
        files = os.listdir(dir_path)
    except Exception:
        return array_of_files

    for file in files:
        if file in ['node_modules', '.git', 'dist', 'build', '.next', 'out', 'bin', 'obj', 'vendor']:
            continue
        res_path = os.path.join(dir_path, file)
        if os.path.isdir(res_path):
            get_all_files(res_path, array_of_files)
        else:
            array_of_files.append(res_path)
            
    return array_of_files

def is_uninteresting_file_name(path):
    name = os.path.basename(path).lower()
    rel = path.replace('\\', '/').lower()
    ext = os.path.splitext(name)[1].lower()

    always_keep = {
        'package.json', 'requirements.txt', 'pyproject.toml', 'composer.json',
        'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
        'readme.md', 'readme.txt'
    }
    if name in always_keep or ext in ['.md', '.pdf']:
        return False

    generated_markers = [
        '.min.', '.bundle.', '.chunk.', '.map', 'source-map', 'sourcemap',
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
        'license', 'licence', 'changelog', 'copying',
        'jquery', 'bootstrap', 'vendor', 'polyfill', 'runtime~',
        '__generated__', '.generated.', 'generated_', '_generated',
        'swagger.json', 'openapi.json'
    ]
    if any(marker in name for marker in generated_markers):
        return True

    ignored_exts = {
        '.map', '.lock', '.log', '.png', '.jpg', '.jpeg', '.gif', '.webp',
        '.avif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp4',
        '.webm', '.mp3', '.wav'
    }
    if ext in ignored_exts:
        return True

    return any(part in rel for part in ['/coverage/', '/snapshots/', '/fixtures/', '/mocks/'])

def analyze_directory(dir_path, llm_config=None, excluded_criteria=None):
    log_event("ANALYZER", "START", f"Starting static analysis for directory: {dir_path}")
    llm_diagnostic = None
    all_files = get_all_files(dir_path)
    def file_read_priority(path):
        name = os.path.basename(path).lower()
        ext = os.path.splitext(path)[1].lower()
        rel = os.path.relpath(path, dir_path).replace('\\', '/').lower()
        if ext in ['.md', '.pdf'] or 'readme' in name or 'doc' in rel:
            return 0
        if name in ['package.json', 'requirements.txt', 'dockerfile'] or ext in ['.yaml', '.yml', '.json']:
            return 1
        if ext in ['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py']:
            return 2
        return 3

    all_files = [f for f in all_files if not is_uninteresting_file_name(f)]
    all_files.sort(key=file_read_priority)

    file_contents = []
    read_limit = 320
    files_read = 0

    for file in all_files:
        if files_read >= read_limit:
            break
        _, ext = os.path.splitext(file)
        ext = ext.lower()
        base = os.path.basename(file).lower()

        if ext in ['.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.yaml', '.yml', '.py', '.txt', '.md'] or base == 'dockerfile':
            try:
                with open(file, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                file_contents.append({
                    "path": file,
                    "relPath": os.path.relpath(file, dir_path).replace('\\', '/'),
                    "name": os.path.basename(file),
                    "ext": ext,
                    "content": content
                })
                files_read += 1
            except Exception:
                pass
        elif ext == '.pdf':
            content = extract_pdf_text(file)
            if content:
                file_contents.append({
                    "path": file,
                    "relPath": os.path.relpath(file, dir_path).replace('\\', '/'),
                    "name": os.path.basename(file),
                    "ext": ext,
                    "content": content
                })
                files_read += 1

    has_videos = any(
        (f['ext'] == '.html' and ('<video' in f['content'] or '<source' in f['content'])) or
        (f['ext'] == '.js' and ('createElement("video")' in f['content'] or "document.createElement('video'" in f['content'] or 'videoSrc' in f['content']))
        for f in file_contents
    )

    has_ml = any(
        (f['ext'] == '.py' and ('import torch' in f['content'] or 'import tensorflow' in f['content'] or 'from keras' in f['content'] or 'sklearn' in f['content'])) or
        (f['ext'] == '.json' and f['name'] == 'package.json' and ('@tensorflow/tfjs' in f['content'] or 'onnxruntime' in f['content']))
        for f in file_contents
    )

    package_json_files = [f for f in file_contents if f['name'] == 'package.json']
    requirements_files = [f for f in file_contents if f['name'] == 'requirements.txt']

    criteria_repo_path = os.path.join(os.path.dirname(__file__), 'rgesn_criteria.json')
    try:
        with open(criteria_repo_path, 'r', encoding='utf-8') as f:
            criteria_repo = json.load(f)
    except Exception:
        criteria_repo = []
    excluded_criteria = set(excluded_criteria or [])
    criteria_repo = [crit for crit in criteria_repo if crit.get('code') not in excluded_criteria]

    results = {}
    for crit in criteria_repo:
        code = crit.get('code')
        if not code:
            continue
        results[code] = {
            "code": code,
            "category": crit.get('category', 'Autre'),
            "text": crit.get('text', ''),
            "priority": crit.get('priority', ''),
            "difficulty": crit.get('difficulty', ''),
            "objective": crit.get('objective', ''),
            "target": crit.get('target', ''),
            "role": crit.get('role', ''),
            "resources": crit.get('resources', ''),
            "status": 'Manuel',
            "justification": 'Ce critère exige une évaluation humaine ou de gouvernance et ne peut pas être déduit du code source.',
            "type": 'manual',
            "findings": []
        }

    def set_auto(code, status, justification, findings=None):
        if findings is None:
            findings = []
        if code in results:
            results[code]["type"] = "auto"
            results[code]["status"] = status
            results[code]["justification"] = justification
            results[code]["findings"] = findings

    # --- AUTOMATED RULES SCANNING ---

    document_evidence = build_document_evidence(criteria_repo, file_contents)

    # 1. Str9 - technologies standard interopérables
    str5_status = 'Validé'
    str5_justification = 'Aucune technologie propriétaire ou non-standard majeure détectée dans les fichiers de dépendances.'
    str5_findings = []

    for f in package_json_files:
        try:
            pkg = json.loads(f['content'])
            all_deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
            legacy_closed_tech = ['flash', 'silverlight', 'activex', 'proprietary-plugin-xyz']
            for tech in legacy_closed_tech:
                if any(tech in dep for dep in all_deps):
                    str5_status = 'Non-Validé'
                    str5_justification = f"Détection de dépendances liées à des technologies fermées ou obsolètes ({tech}) dans {f['relPath']}."
                    str5_findings.append(f"Dépendance fermée/obsolète trouvée : {tech} dans {f['relPath']}")
            
            if not str5_findings:
                str5_findings.append(f"Analyse de package.json ({f['relPath']}) : {len(all_deps)} dépendances standards analysées (npm).")
        except Exception:
            str5_findings.append(f"Erreur de parsing de package.json ({f['relPath']})")

    for f in requirements_files:
        str5_findings.append(f"Fichier {f['relPath']} détecté. Utilisation de dépendances Python standard (pip).")

    if not package_json_files and not requirements_files:
        str5_status = 'Non-Validé'
        str5_justification = "Aucun fichier de dépendance standard (package.json, requirements.txt) n'a été détecté pour valider l'utilisation de standards interopérables."
        str5_findings.append("Aucun fichier package.json ou requirements.txt trouvé dans le projet.")

    set_auto('Str9', str5_status, str5_justification, str5_findings)

    # 2. Spec1
    spec1_status = 'Non-Validé'
    spec1_justification = "Aucune spécification de profils de matériels cibles ou de navigateurs n'a été trouvée dans le projet."
    spec1_findings = []

    has_browserslist = any('"browserslist"' in f['content'] for f in package_json_files) or \
                       any(f['name'] == '.browserslistrc' for f in file_contents)
    if has_browserslist:
        spec1_status = 'Validé'
        spec1_justification = "Définition d'une cible de terminaux/navigateurs via la configuration \"browserslist\" détectée."
        spec1_findings.append('Configuration "browserslist" présente.')

    for f in file_contents:
        if 'readme' in f['name'].lower():
            content_lower = f['content'].lower()
            if any(k in content_lower for k in ['matériel', 'hardware', 'navigateur', 'browser support', 'configuration requise', 'prerequisites']):
                spec1_status = 'Validé'
                spec1_justification = "Le README documente le support de matériels ou de navigateurs cibles."
                spec1_findings.append(f"Documentation de support matériel trouvée dans {f['relPath']}")

    set_auto('Spec1', spec1_status, spec1_justification, spec1_findings)

    # 3. Spec2, Spec3 & Spec4
    spec2_status = 'Non-Validé'
    spec2_justification = "Aucun mécanisme de rétrocompatibilité (Babel, polyfills, cible browserslist large) n'a été identifié."
    spec2_findings = []

    spec3_status = 'Non-Validé'
    spec3_justification = "Aucun mécanisme d'utilisation bas débit ou hors connexion (Service Worker, mode offline, cache applicatif) n'a été identifié."
    spec3_findings = []

    spec4_status = 'Non-Validé'
    spec4_justification = "Aucun mécanisme de rétrocompatibilité (Babel, polyfills, cible browserslist large) n'a été identifié."
    spec4_findings = []

    for f in package_json_files:
        try:
            pkg = json.loads(f['content'])
            all_deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
            polyfills = ['babel', 'core-js', 'postcss', 'polyfill', 'swc', 'tslib']
            found_polyfills = [p for p in polyfills if any(p in dep for dep in all_deps)]
            
            if found_polyfills:
                spec2_status = 'Validé'
                spec2_justification = f"Présence de compilateurs/polyfills ({', '.join(found_polyfills)}) pour supporter d'anciens terminaux."
                spec2_findings.append(f"Outils de rétrocompatibilité détectés : {', '.join(found_polyfills)}")

                spec4_status = 'Validé'
                spec4_justification = f"Présence de compilateurs/polyfills ({', '.join(found_polyfills)}) assurant le support d'anciennes versions d'OS/navigateurs."
                spec4_findings.append(f"Outils de rétrocompatibilité détectés : {', '.join(found_polyfills)}")
        except Exception:
            pass

    if any('serviceworker' in f['content'].replace(' ', '').lower() or 'offline' in f['content'].lower() or 'caches.open' in f['content'] for f in file_contents):
        spec3_status = 'Validé'
        spec3_justification = "Présence d'indices de fonctionnement hors connexion ou de cache applicatif pour limiter les transferts."
        spec3_findings.append("Service Worker, mode offline ou CacheStorage détecté.")

    set_auto('Spec2', spec2_status, spec2_justification, spec2_findings)
    set_auto('Spec3', spec3_status, spec3_justification, spec3_findings)
    set_auto('Spec4', spec4_status, spec4_justification, spec4_findings)

    # 4. Spec5
    spec4_status = 'Non-Validé'
    spec4_justification = "Aucun élément d'adaptabilité d'affichage (responsive design) n'a été trouvé dans le code CSS ou HTML."
    spec4_findings = []

    for f in file_contents:
        if f['ext'] == '.html':
            if '<meta name="viewport"' in f['content'] or 'width=device-width' in f['content']:
                spec4_status = 'Validé'
                spec4_justification = "Balise meta viewport détectée pour l'adaptation mobile et multi-écrans."
                spec4_findings.append(f"Balise <meta name=\"viewport\"> trouvée dans {f['relPath']}")

        if f['ext'] in ['.css', '.html']:
            if any(k in f['content'] for k in ['@media', 'media-query', 'flexbox', 'grid-layout']):
                spec4_status = 'Validé'
                spec4_justification = "Utilisation de règles CSS adaptatives (@media queries, flexbox, grid) pour le responsive design."
                spec4_findings.append(f"Règles responsives/adaptatives détectées dans {f['relPath']}")

    set_auto('Spec5', spec4_status, spec4_justification, spec4_findings)

    # 5. Spec7
    spec5_status = 'Non-Validé'
    spec5_justification = "Aucune configuration CI/CD ou fichier Docker de déploiement n'a été trouvé pour évaluer la stratégie de maintenance technique et de nettoyage."
    spec5_findings = []

    infra_files = [f for f in file_contents if f['ext'] in ['.yaml', '.yml'] or f['name'].lower() == 'dockerfile' or 'docker-compose' in f['name']]
    if infra_files:
        spec5_status = 'Validé'
        spec5_justification = "Fichiers de configuration CI/CD ou d'infrastructure détectés permettant d'intégrer une stratégie de maintenance automatisée."
        for f in infra_files:
            detail = f"Fichier d'infrastructure trouvé : {f['relPath']}."
            if any(k in f['content'] for k in ['prune', 'clean', 'rm ', 'cache-from', 'minify']):
                detail += " Comporte des commandes de nettoyage/optimisation des ressources."
            spec5_findings.append(detail)

    set_auto('Spec7', spec5_status, spec5_justification, spec5_findings)

    # 6. Uxui1
    uxui1_status = 'Validé'
    uxui1_justification = "Aucune balise de lecture automatique (autoplay) de contenu média n'a été détectée dans le code."
    uxui1_findings = []

    for f in file_contents:
        if f['ext'] in ['.html', '.js']:
            autoplay_matches = re.findall(r'<(video|audio)[^>]*\bautoplay\b', f['content'], re.IGNORECASE)
            for match in autoplay_matches:
                uxui1_status = 'Non-Validé'
                uxui1_justification = "Détection de lecture automatique (autoplay) pour des éléments multimédias, ce qui surconsomme des données et de l'énergie sans contrôle utilisateur."
                uxui1_findings.append(f"Élément <{match}> avec autoplay détecté dans {f['relPath']}")

            if '.autoplay = true' in f['content'] or 'autoplay: true' in f['content']:
                uxui1_status = 'Non-Validé'
                uxui1_justification = "Détection de script activant l'autoplay de médias."
                uxui1_findings.append(f"Script d'autoplay détecté dans {f['relPath']}")

    set_auto('Uxui1', uxui1_status, uxui1_justification, uxui1_findings)

    # 7. Uxui2
    uxui2_status = 'Validé'
    uxui2_justification = "Aucune implémentation de défilement infini (infinite scroll) n'a été détectée."
    uxui2_findings = []

    for f in file_contents:
        if f['ext'] in ['.js', '.jsx', '.tsx']:
            if 'scroll' in f['content'] and any(k in f['content'] for k in ['innerHeight', 'scrollHeight', 'scrollTop']):
                uxui2_status = 'Non-Validé'
                uxui2_justification = "Détection d'écouteurs d'événements de scroll couplés à des calculs de hauteur de page (pattern typique de défilement infini), ce qui pousse à un chargement continu de ressources."
                uxui2_findings.append(f"Pattern d'écoute de scroll lourd détecté dans {f['relPath']}")

            infinite_scroll_keywords = ['infinitescroll', 'infinite-scroll', 'react-infinite-scroll', 'scroll-bottom-load']
            for kw in infinite_scroll_keywords:
                if kw in f['content'].lower():
                    uxui2_status = 'Non-Validé'
                    uxui2_justification = f"Détection de la bibliothèque ou du mot-clé de défilement infini \"{kw}\"."
                    uxui2_findings.append(f"Mot-clé \"{kw}\" trouvé dans {f['relPath']}")

    set_auto('Uxui2', uxui2_status, uxui2_justification, uxui2_findings)

    # 8. Uxui13
    uxui3_status = 'Validé'
    uxui3_justification = "Le service n'utilise pas les APIs de notification système, limitant l'envoi de requêtes réseau intempestives."
    uxui3_findings = []

    for f in file_contents:
        if f['ext'] in ['.js', '.html']:
            if any(k in f['content'] for k in ['Notification.requestPermission', 'pushManager.subscribe', 'new Notification(']):
                uxui3_status = 'Non-Validé'
                uxui3_justification = "Le service numérique utilise les API de notifications ou de Push. Assurez-vous que l'utilisateur peut facilement les désactiver."
                uxui3_findings.append(f"API de Notification système utilisée dans {f['relPath']}")

    set_auto('Uxui13', uxui3_status, uxui3_justification, uxui3_findings)

    font_findings = []
    for f in file_contents:
        if f['ext'] in ['.html', '.css']:
            font_refs = re.findall(r'@font-face|fonts\.googleapis|\.woff2?|font-family', f['content'], re.IGNORECASE)
            if font_refs:
                font_findings.append(f"Références de polices détectées dans {f['relPath']}")
    if not font_findings:
        set_auto('Uxui8', 'Validé', "Aucune police distante ou police additionnelle téléchargée n'a été détectée.", ["Pas de @font-face ni Google Fonts détectés."])
    else:
        set_auto('Uxui8', 'Manuel', "Des polices personnalisées sont présentes ; il faut confirmer que leur nombre est limité.", font_findings[:5])

    input_request_findings = []
    for f in file_contents:
        if f['ext'] in ['.js', '.jsx', '.ts', '.tsx']:
            content_lower = f['content'].lower()
            if any(k in content_lower for k in ['keyup', 'keydown', 'input', 'onchange']) and any(k in content_lower for k in ['fetch(', 'axios.', 'xmlhttprequest']):
                input_request_findings.append(f"Requête réseau potentiellement déclenchée par saisie dans {f['relPath']}")
    if input_request_findings:
        set_auto('Uxui9', 'Manuel', "Des requêtes semblent liées à la saisie utilisateur ; la limitation/debounce doit être confirmée.", input_request_findings[:5])
    else:
        set_auto('Uxui9', 'Validé', "Aucun pattern de requête serveur déclenchée à la saisie utilisateur n'a été détecté.", ["Pas de fetch/axios couplé à input/key events détecté."])

    form_findings = []
    for f in file_contents:
        if f['ext'] in ['.html', '.jsx', '.tsx']:
            if '<form' in f['content'].lower() or 'type="file"' in f['content'].lower():
                form_findings.append(f"Formulaire ou upload détecté dans {f['relPath']}")
    if not form_findings:
        set_auto('Uxui10', 'N/A', "Aucun formulaire utilisateur n'a été détecté dans les fichiers analysés.", ["Pas de balise <form> détectée."])
        set_auto('Uxui11', 'N/A', "Aucun transfert de fichier utilisateur n'a été détecté dans les fichiers analysés.", ["Pas d'input file détecté."])
    else:
        set_auto('Uxui10', 'Manuel', "Des formulaires sont présents ; les indications de format de saisie doivent être confirmées.", form_findings[:5])
        has_upload = any('type="file"' in f['content'].lower() for f in file_contents)
        if has_upload:
            set_auto('Uxui11', 'Manuel', "Un transfert de fichier est présent ; l'information préalable sur poids et formats doit être confirmée.", form_findings[:5])
        else:
            set_auto('Uxui11', 'N/A', "Aucun transfert de fichier utilisateur n'a été détecté.", ["Pas d'input file détecté."])

    # 9. Cont1, Cont2, Cont3, Cont4, Cont5, Cont6, Cont7, Cont8
    has_images = any(
        (f['ext'] == '.html' and re.search(r'<img\b|<picture\b', f['content'], re.IGNORECASE)) or
        any(ext in f['name'].lower() for ext in ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg'])
        for f in file_contents
    )
    if not has_images:
        set_auto('Cont1', 'N/A', "Le projet ne comporte aucune image détectée dans les fichiers analysés.", ["Aucune balise <img>/<picture> ou image statique détectée."])
        set_auto('Cont2', 'N/A', "Le projet ne comporte aucune image détectée dans les fichiers analysés.", ["Aucune balise <img>/<picture> ou image statique détectée."])
    else:
        modern_image = any(any(fmt in f['content'].lower() or fmt in f['name'].lower() for fmt in ['webp', 'avif', 'svg']) for f in file_contents)
        status = 'Validé' if modern_image else 'Manuel'
        justification = "Formats image sobres ou vectoriels détectés (WebP, AVIF ou SVG)." if modern_image else "Des images sont présentes, mais le niveau d'adaptation/compression doit être confirmé."
        findings = ["Format image moderne détecté."] if modern_image else ["Images détectées sans preuve suffisante de format/compression adaptés."]
        set_auto('Cont1', status, justification, findings)
        set_auto('Cont2', status, justification, findings)

    if not has_videos:
        set_auto('Cont3', 'N/A', "Le projet ne comporte aucun contenu vidéo détecté dans les fichiers HTML/JS.", ["Aucun tag <video> détecté."])
        set_auto('Cont4', 'N/A', "Le projet ne comporte aucun contenu vidéo détecté dans les fichiers HTML/JS.", ["Aucun tag <video> détecté."])
        set_auto('Cont5', 'N/A', "Le projet ne comporte aucun contenu vidéo détecté dans les fichiers HTML/JS.", ["Aucun tag <video> détecté."])
    else:
        cont1_status = 'Non-Validé'
        cont1_justification = "Des balises vidéo sont présentes mais aucune source multiple (résolutions ou media-queries adaptées) n'a été détectée."
        cont1_findings = []
        for f in file_contents:
            if f['ext'] == '.html' and '<video' in f['content']:
                cont1_findings.append(f"Élément <video> trouvé dans {f['relPath']}")
                source_matches = len(re.findall(r'<source', f['content']))
                if source_matches > 1:
                    cont1_status = 'Validé'
                    cont1_justification = "Détection de multiples balises <source> dans les vidéos, suggérant l'adaptation des formats selon la bande passante ou la taille d'affichage."
                    cont1_findings.append(f"{source_matches} balises <source> trouvées dans le fichier.")
        set_auto('Cont3', cont1_status, cont1_justification, cont1_findings)

        cont2_status = 'Non-Validé'
        cont2_justification = "Des vidéos sont présentes mais n'utilisent pas de codecs modernes et efficaces (WebM, AV1, H.265) dans les sources."
        cont2_findings = []
        for f in file_contents:
            if f['ext'] in ['.html', '.js']:
                modern_codecs = ['webm', 'av1', 'h265', 'hevc', 'vp9']
                for codec in modern_codecs:
                    if codec in f['content'].lower():
                        cont2_status = 'Validé'
                        cont2_justification = f"Utilisation de formats de compression vidéo modernes et frugaux ({codec}) détectée."
                        cont2_findings.append(f"Codec moderne \"{codec}\" référencé dans {f['relPath']}")
        set_auto('Cont4', cont2_status, cont2_justification, cont2_findings)

        cont3_status = 'Non-Validé'
        cont3_justification = "Aucune option d'écoute seule (sans piste vidéo) n'a été détectée pour les flux vidéo."
        cont3_findings = []
        for f in file_contents:
            if f['ext'] in ['.html', '.js']:
                audio_only_keywords = ['écoute seule', 'audio-only', 'audioonly', 'désactiver la vidéo', 'piste audio', 'sans vidéo', 'mute video']
                for kw in audio_only_keywords:
                    if kw in f['content'].lower():
                        cont3_status = 'Validé'
                        cont3_justification = f"Détection d'un contrôle ou d'un terme suggérant un mode d'écoute audio seule (\"{kw}\")."
                        cont3_findings.append(f"Terminologie d'écoute seule trouvée : \"{kw}\" dans {f['relPath']}")
        set_auto('Cont5', cont3_status, cont3_justification, cont3_findings)

    has_audio = any(
        (f['ext'] == '.html' and re.search(r'<audio\b', f['content'], re.IGNORECASE)) or
        any(ext in f['name'].lower() for ext in ['.mp3', '.ogg', '.opus', '.wav'])
        for f in file_contents
    )
    if not has_audio:
        set_auto('Cont6', 'N/A', "Le projet ne comporte aucun contenu audio détecté.", ["Aucune balise <audio> ni fichier audio détecté."])
    else:
        efficient_audio = any(any(fmt in f['content'].lower() or fmt in f['name'].lower() for fmt in ['opus', 'ogg', 'webm']) for f in file_contents)
        set_auto(
            'Cont6',
            'Validé' if efficient_audio else 'Manuel',
            "Format audio efficace détecté." if efficient_audio else "Des contenus audio sont présents ; le mode de compression doit être confirmé.",
            ["Audio Opus/Ogg/WebM détecté."] if efficient_audio else ["Contenu audio détecté."]
        )

    doc_exts = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods']
    has_documents = any(any(f['name'].lower().endswith(ext) for ext in doc_exts) for f in file_contents)
    if not has_documents:
        set_auto('Cont7', 'N/A', "Aucun document téléchargeable n'a été détecté dans les fichiers analysés.", ["Pas de document bureautique/PDF détecté."])
    else:
        set_auto('Cont7', 'Manuel', "Des documents sont présents ; l'adaptation du format au contexte d'utilisation doit être confirmée.", ["Document téléchargeable détecté."])

    archive_keywords = ['archive', 'archivage', 'obsolete', 'obsolète', 'perime', 'périmé', 'cleanup', 'purge', 'retention']
    archive_findings = []
    for f in file_contents:
        if any(kw in f['content'].lower() for kw in archive_keywords):
            archive_findings.append(f"Stratégie d'archivage/suppression mentionnée dans {f['relPath']}")
    if archive_findings:
        set_auto('Cont8', 'Validé', "Une stratégie d'archivage ou suppression des contenus obsolètes est mentionnée.", archive_findings[:5])

    # 10. Bck1
    bck2_status = 'Non-Validé'
    bck2_justification = "Aucun mécanisme de cache serveur (Redis, Memcached, cache HTTP, cache-manager) n'a été identifié."
    bck2_findings = []

    for f in package_json_files:
        try:
            pkg = json.loads(f['content'])
            all_deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
            cache_deps = ['redis', 'memcached', 'cache-manager', 'node-cache', 'apc', 'varnish']
            found_cache = [d for d in cache_deps if any(d in dep for dep in all_deps)]
            if found_cache:
                bck2_status = 'Validé'
                bck2_justification = f"Dépendances de cache serveur trouvées dans package.json : {', '.join(found_cache)}."
                bck2_findings.append(f"Bibliothèques de cache installées : {', '.join(found_cache)}")
        except Exception:
            pass

    for f in file_contents:
        if f['ext'] in ['.js', '.py']:
            cache_keywords = ['redis.createClient', 'memcached', 'Cache-Control', 'max-age', 'getAsync(', 'setAsync(']
            for kw in cache_keywords:
                if kw in f['content']:
                    bck2_status = 'Validé'
                    bck2_justification = f"Utilisation de l'API de cache serveur (\"{kw}\") détectée dans le code backend."
                    bck2_findings.append(f"Code de cache trouvé : \"{kw}\" dans {f['relPath']}")

    set_auto('Bck1', bck2_status, bck2_justification, bck2_findings)

    # 11. Bck2
    bck3_status = 'Non-Validé'
    bck3_justification = "Aucun mécanisme de conservation limitée ou de nettoyage des données obsolètes (TTL, archivage automatique, scripts de purge) n'a été détecté."
    bck3_findings = []

    for f in file_contents:
        if any(k in f['content'] for k in ['expireAfterSeconds', 'TTL', 'deleteMany', 'DELETE FROM', 'created_at', 'purge', 'cleanup', 'retention']):
            bck3_status = 'Validé'
            bck3_justification = "Mécanisme d'archivage ou de suppression automatique détecté (TTL, requête de purge, cron job)."
            bck3_findings.append(f"Pattern de rétention de données trouvé dans {f['relPath']}")

    set_auto('Bck2', bck3_status, bck3_justification, bck3_findings)

    background_findings = []
    for f in file_contents:
        content_lower = f['content'].lower()
        if any(k in content_lower for k in ['queue', 'worker', 'background job', 'celery', 'bullmq', 'sidekiq', 'progress', 'status']) and any(k in content_lower for k in ['poll', 'websocket', 'sse', 'progress', 'notification']):
            background_findings.append(f"Traitement arrière-plan ou suivi d'état détecté dans {f['relPath']}")
    if background_findings:
        set_auto('Bck3', 'Validé', "Des mécanismes de traitement en arrière-plan ou de suivi utilisateur sont détectés.", background_findings[:5])

    consensus_keywords = ['blockchain', 'proof-of-work', 'proof of work', 'pow', 'consensus', 'mining', 'ethereum']
    consensus_findings = []
    for f in file_contents:
        if any(k in f['content'].lower() for k in consensus_keywords):
            consensus_findings.append(f"Mécanisme de consensus potentiel détecté dans {f['relPath']}")
    if not consensus_findings:
        set_auto('Bck4', 'N/A', "Aucun mécanisme de consensus distribué n'a été détecté.", ["Pas de blockchain/mining/consensus détecté."])
    else:
        set_auto('Bck4', 'Manuel', "Un mécanisme de consensus est potentiellement présent ; sa sobriété doit être confirmée.", consensus_findings[:5])

    # 12. Frnt1
    frnt1_status = 'Non-Validé'
    frnt1_justification = "Aucune configuration de budget de performance (webpack performance, bundlewatch, size-limit) n'a été identifiée."
    frnt1_findings = []

    for f in package_json_files:
        try:
            pkg = json.loads(f['content'])
            all_deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
            budget_tools = ['size-limit', 'bundlewatch', 'webpack-bundle-analyzer', 'lighthouse-ci']
            found_tools = [t for t in budget_tools if any(t in dep for dep in all_deps)]
            if found_tools:
                frnt1_status = 'Validé'
                frnt1_justification = f"Outils de budget de performance frontend ou d'analyse de bundles configurés : {', '.join(found_tools)}."
                frnt1_findings.append(f"Outils de budget installés : {', '.join(found_tools)}")
        except Exception:
            pass

    for f in file_contents:
        if ('performance' in f['content'] and 'maxAssetSize' in f['content']) or \
           'performance.hints' in f['content'] or \
           ('budget' in f['content'] and 'path' in f['content']):
            frnt1_status = 'Validé'
            frnt1_justification = "Configuration explicite de budget de performance détectée (ex: webpack maxAssetSize)."
            frnt1_findings.append(f"Fichier de budget de bundle ou configuration trouvé dans {f['relPath']}")

    set_auto('Frnt1', frnt1_status, frnt1_justification, frnt1_findings)

    # 13. Frnt2
    frnt2_status = 'Non-Validé'
    frnt2_justification = "Aucun mécanisme de mise en cache client (Service Workers, Cache-Control Header, caches.open) n'a été détecté."
    frnt2_findings = []

    has_service_worker = any(
        'sw.js' in f['name'] or 'service-worker' in f['name'] or \
        ".register('/sw.js'" in f['content'] or 'navigator.serviceWorker.register' in f['content']
        for f in file_contents
    )
    if has_service_worker:
        frnt2_status = 'Validé'
        frnt2_justification = "Utilisation d'un Service Worker détectée pour le cache hors-ligne et client (PWA)."
        frnt2_findings.append("Service Worker ou script d'enregistrement détecté.")

    for f in file_contents:
        if 'caches.open' in f['content'] or 'cacheName' in f['content'] or \
           ('cache-control' in f['content'] and 'max-age' in f['content']):
            frnt2_status = 'Validé'
            frnt2_justification = "Code d'utilisation de cache client (CacheStorage API) ou en-têtes HTTP de cache détectés."
            frnt2_findings.append(f"API de cache client ou en-têtes trouvés dans {f['relPath']}")

    set_auto('Frnt2', frnt2_status, frnt2_justification, frnt2_findings)

    compression_findings = []
    if any(k in ''.join(f['content'][:2000] for f in file_contents).lower() for k in ['gzip', 'brotli', 'br ', 'compression', 'zstd']):
        compression_findings.append("Configuration ou mention de compression de transfert détectée.")
        set_auto('Frnt3', 'Validé', "Des mécanismes de compression de ressources transférées sont mentionnés ou configurés.", compression_findings)

    lazy_findings = []
    for f in file_contents:
        if any(k in f['content'].lower() for k in ['loading="lazy"', 'lazyload', 'intersectionobserver', 'dynamic import(', 'import(']):
            lazy_findings.append(f"Chargement différé ou conditionnel détecté dans {f['relPath']}")
    if lazy_findings:
        set_auto('Frnt5', 'Validé', "Le code contient des mécanismes de chargement différé ou conditionnel limitant les ressources inutilisées.", lazy_findings[:5])

    sensor_keywords = ['geolocation', 'devicemotion', 'deviceorientation', 'getusermedia', 'accelerometer', 'gyroscope']
    sensor_findings = []
    for f in file_contents:
        if f['ext'] in ['.js', '.jsx', '.ts', '.tsx', '.html']:
            for kw in sensor_keywords:
                if kw in f['content'].lower():
                    sensor_findings.append(f"API capteur \"{kw}\" détectée dans {f['relPath']}")
    if not sensor_findings:
        set_auto('Frnt6', 'N/A', "Aucun usage de capteurs de terminaux utilisateurs n'a été détecté.", ["Pas d'API capteur détectée."])
    else:
        set_auto('Frnt6', 'Manuel', "Des APIs capteurs sont présentes ; leur stricte nécessité doit être confirmée.", sensor_findings[:5])

    static_domains = set()
    for f in file_contents:
        if f['ext'] in ['.html', '.css', '.js']:
            static_domains.update(re.findall(r'https?://([^/"\']+)', f['content']))
    if static_domains:
        status = 'Validé' if len(static_domains) <= 1 else 'Manuel'
        set_auto('Frnt7', status, f"{len(static_domains)} domaine(s) externe(s) de ressources statiques détecté(s).", [f"Domaine: {d}" for d in sorted(static_domains)[:8]])

    # 14. Algo1-7
    if not has_ml:
        set_auto('Algo1', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning.", ["Pas de librairies ML détectées."])
        set_auto('Algo2', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning.", ["Pas de librairies ML détectées."])
        set_auto('Algo3', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning (TensorFlow, PyTorch, Scikit-learn non détectés).", ["Pas de librairies ML détectées."])
        set_auto('Algo4', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning.", ["Pas de librairies ML détectées."])
        set_auto('Algo5', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning.", ["Pas de librairies ML détectées."])
        set_auto('Algo6', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning.", ["Pas de librairies ML détectées."])
        set_auto('Algo7', 'N/A', "Le projet ne fait pas usage de modèles d'intelligence artificielle ou de machine learning.", ["Pas de librairies ML détectées."])
    else:
        # Algo3
        algo3_status = 'Non-Validé'
        algo3_justification = "Présence de librairies ML, mais aucune méthode de limitation de l'entraînement (EarlyStopping, transfert de connaissances, modèles pré-entraînés) n'a été formellement identifiée."
        algo3_findings = []
        for f in file_contents:
            if f['ext'] == '.py':
                reduction_keywords = ['EarlyStopping', 'early_stopping', 'pretrained=True', 'load_state_dict', 'transfer_learning', 'freeze_layers', 'checkpoint']
                for kw in reduction_keywords:
                    if kw in f['content']:
                        algo3_status = 'Validé'
                        algo3_justification = f"Mécanisme de limitation d'entraînement ou utilisation de modèle pré-entraîné détecté (\"{kw}\")."
                        algo3_findings.append(f"Pattern d'entraînement économe trouvé : \"{kw}\" dans {f['relPath']}")
        set_auto('Algo3', algo3_status, algo3_justification, algo3_findings)

        # Algo6 / Algo7
        algo6_status = 'Non-Validé'
        algo6_justification = "Présence de librairies ML, mais aucune compression de modèle (quantification, élagage, formats compacts) n'a été détectée."
        algo6_findings = []
        algo7_status = 'Non-Validé'
        algo7_justification = "Présence de librairies ML, mais aucune stratégie d'inférence optimisée (ONNX, TFLite, TensorRT, batch adapté) n'a été détectée."
        algo7_findings = []
        for f in file_contents:
            if f['ext'] in ['.py', '.js']:
                compression_keywords = ['quantize', 'quantization', 'prune', 'pruning', 'distillation', 'compress']
                inference_keywords = ['onnx', 'tfjs', 'tflite', 'tensorrt', 'convert_to_onnx', 'batch_size', 'inference']
                for kw in compression_keywords:
                    if kw in f['content'].lower():
                        algo6_status = 'Validé'
                        algo6_justification = f"Technique de compression ou réduction de modèle détectée (\"{kw}\")."
                        algo6_findings.append(f"Compression de modèle trouvée : \"{kw}\" dans {f['relPath']}")
                for kw in inference_keywords:
                    if kw in f['content'].lower():
                        algo7_status = 'Validé'
                        algo7_justification = f"Stratégie d'inférence optimisée détectée via format ou exécution optimisée (\"{kw}\")."
                        algo7_findings.append(f"Pattern d'inférence économe trouvé : \"{kw}\" dans {f['relPath']}")
        set_auto('Algo6', algo6_status, algo6_justification, algo6_findings)
        set_auto('Algo7', algo7_status, algo7_justification, algo7_findings)

    # --- LLM REFINEMENT PIPELINE ---
    if llm_config and llm_config.get('analysisMode') == 'llm':
        start_time_ms = int(time.time() * 1000)
        provider = llm_config.get('llmProvider')
        model = llm_config.get('llmModel')
        if not model:
            if provider == 'local': model = 'qwen3:0.6b'
            elif provider == 'openai': model = 'gpt-4o-mini'
            elif provider == 'mistral': model = 'mistral-tiny'
            else: model = 'claude-3-5-haiku'

        try:
            log_event("ANALYZER", "LLM_START", f"Running LLM-assisted analysis using provider: {provider}, model: {model}")
            project_context = collect_project_context(dir_path, file_contents)

            llm_target_codes = select_llm_target_codes(results, criteria_repo, document_evidence)
            full_raw_output = ""

            for code in llm_target_codes:
                initial = results.get(code)
                if not initial:
                    continue

                system_prompt = f"""Tu es un auditeur expert du Référentiel Général d'Éco-conception de Services Numériques (RGESN).
Ton rôle est de valider ou corriger la pré-analyse statique (regex) pour UN SEUL critère : "{code}".
Voici le texte du critère à évaluer : "{initial['text']}"
Objectif du critère : "{initial.get('objective', '')}"
Cible / contexte d'applicabilité : "{initial.get('target', '')}"

Tu dois renvoyer STRICTEMENT ET UNIQUEMENT un objet JSON valide pour ce critère, sans aucun texte explicatif avant ou après.

Format attendu pour ton JSON :
{{
  "status": "Validé" | "Non-Validé" | "N/A" | "Manuel",
  "justification": "Explication critique et détaillée de ta décision basée sur les extraits de code fournis.",
  "findings": ["extrait 1", "extrait 2"]
}}

CONSIGNES DE RIGUEUR EXTRÊME :
1. Ne valide pas paresseusement. Sois extrêmement critique : si le code manque de configuration ou présente un anti-pattern flagrant, retourne "Non-Validé". 
2. Si le projet n'utilise manifestement pas la fonctionnalité associée (ex: pas de vidéo pour les critères Cont3-5, pas d'IA pour Algo1-7), retourne ABSOLUMENT ET IMPÉRATIVEMENT "N/A". Ne mets jamais "Non-Validé" si le service ne comporte aucune vidéo ou aucun modèle d'IA !
3. Si les éléments ne te permettent pas de conclure avec certitude, utilise "Manuel"."""

                user_prompt = f"""Détails structurels et extraits de fichiers du projet :
{project_context}

Résultat de notre pré-analyse statique (Regex) pour le critère "{code}" :
- Statut pré-détecté : "{initial['status']}"
- Justification initiale : "{initial['justification']}"
- Indices (findings) trouvés : {json.dumps(initial['findings'], ensure_ascii=False)}
- Indices documentaires trouvés : {json.dumps(document_evidence.get(code, []), ensure_ascii=False)}

Analyse rigoureusement ces éléments pour ce critère uniquement. Renvoie l'objet JSON contenant "status", "justification" et "findings"."""

                criterion_raw_output = ""
                try:
                    criterion_raw_output = query_llm(llm_config, system_prompt, user_prompt)
                    full_raw_output += f"--- Critère {code} ---\n{criterion_raw_output}\n\n"

                    parsed_data = extract_json(criterion_raw_output)

                    if parsed_data and parsed_data.get('status'):
                        new_status = parsed_data['status']
                        
                        # Programmatic post-processing: enforce N/A for video / ML if not present
                        if code in ['Cont3', 'Cont4', 'Cont5'] and not has_videos:
                            new_status = 'N/A'
                        if code in ['Algo1', 'Algo2', 'Algo3', 'Algo4', 'Algo5', 'Algo6', 'Algo7'] and not has_ml:
                            new_status = 'N/A'
                            
                        results[code]["status"] = new_status
                        results[code]["justification"] = f"[Audit IA] {parsed_data.get('justification') or initial['justification']}"
                        results[code]["findings"] = parsed_data.get('findings') if parsed_data.get('findings') and len(parsed_data['findings']) > 0 else initial['findings']
                        results[code]["type"] = 'auto' if new_status in ['Validé', 'Non-Validé', 'N/A'] else 'manual'
                        log_event("ANALYZER", "LLM_CRITERION_SUCCESS", f"Criterion {code} updated by LLM: status={new_status}")
                except Exception as crit_error:
                    log_event("ANALYZER", "LLM_CRITERION_ERROR", f"Error refining criterion {code} with LLM: {crit_error}")
                    full_raw_output += f"--- Critère {code} (ERREUR) ---\n{str(crit_error)}\nOutput: {criterion_raw_output}\n\n"

            duration = int(time.time() * 1000) - start_time_ms
            llm_diagnostic = {
                "status": "success",
                "provider": provider,
                "model": model,
                "responseTime": duration,
                "targetCount": len(llm_target_codes),
                "targetCodes": llm_target_codes,
                "rawOutput": full_raw_output.strip()
            }
            log_event("ANALYZER", "LLM_COMPLETE", f"LLM-assisted analysis completed successfully in {duration}ms!")

        except Exception as llm_error:
            log_event("ANALYZER", "LLM_FAILED", f"LLM analysis failed, falling back to Classical Static Analysis: {llm_error}")
            duration = int(time.time() * 1000) - start_time_ms
            llm_diagnostic = {
                "status": "failed",
                "provider": provider,
                "model": model,
                "responseTime": duration,
                "error": str(llm_error),
                "rawOutput": full_raw_output.strip() if 'full_raw_output' in locals() else "Aucune réponse reçue du modèle."
            }

    return results, llm_diagnostic
