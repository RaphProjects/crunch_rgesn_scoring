import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'db_store.json')

if not os.path.exists(DB_PATH):
    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump({"projects": []}, f, indent=2, ensure_ascii=False)

def read_db():
    try:
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {"projects": []}

def write_db(data):
    try:
        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("Failed to write to DB store", e)

def get_priority_value(priority_str):
    p = priority_str.lower() if priority_str else ''
    if 'prioritaire' in p:
        return 3
    if 'recommandé' in p:
        return 1
    return 1

def get_difficulty_value(difficulty_str):
    d = difficulty_str.lower() if difficulty_str else ''
    if 'faible' in d:
        return 1
    if 'moyen' in d:
        return 2
    if 'fort' in d or 'forte' in d:
        return 3
    return 2

def calculate_project_scores(criteria):
    total_points_obtained = 0
    total_points_max = 0
    categories = {}

    for crit in criteria.values():
        prio_val = get_priority_value(crit.get('priority', ''))
        diff_val = get_difficulty_value(crit.get('difficulty', ''))
        max_val = prio_val * diff_val

        cat_name = crit.get('category')
        if not cat_name:
            continue
            
        if cat_name not in categories:
            categories[cat_name] = {
                "name": cat_name,
                "obtained": 0,
                "max": 0,
                "validatedCount": 0,
                "notValidatedCount": 0,
                "naCount": 0,
                "manualCount": 0,
                "totalCount": 0
            }

        cat = categories[cat_name]
        cat["totalCount"] += 1

        status = crit.get('status')
        if status == 'Validé':
            points = max_val
            total_points_obtained += points
            total_points_max += max_val
            cat["obtained"] += points
            cat["max"] += max_val
            cat["validatedCount"] += 1
        elif status == 'Non-Validé':
            total_points_max += max_val
            cat["max"] += max_val
            cat["notValidatedCount"] += 1
        elif status == 'N/A':
            cat["naCount"] += 1
        elif status == 'Manuel':
            total_points_max += max_val
            cat["max"] += max_val
            cat["manualCount"] += 1

    global_score = round((total_points_obtained / total_points_max) * 100) if total_points_max > 0 else 100

    category_scores = []
    for cat in categories.values():
        category_scores.append({
            "name": cat["name"],
            "score": round((cat["obtained"] / cat["max"]) * 100) if cat["max"] > 0 else 100,
            "obtained": cat["obtained"],
            "max": cat["max"],
            "validatedCount": cat["validatedCount"],
            "notValidatedCount": cat["notValidatedCount"],
            "naCount": cat["naCount"],
            "manualCount": cat["manualCount"],
            "totalCount": cat["totalCount"]
        })

    return {
        "globalScore": global_score,
        "totalPointsObtained": total_points_obtained,
        "totalPointsMax": total_points_max,
        "categoryScores": category_scores
    }

def get_projects():
    db_data = read_db()
    return [{
        "id": p.get("id"),
        "name": p.get("name"),
        "createdAt": p.get("createdAt"),
        "status": p.get("status"),
        "globalScore": p.get("globalScore"),
        "totalFiles": p.get("totalFiles"),
        "categories": p.get("categories") or p.get("categoryScores")
    } for p in db_data.get("projects", [])]

def get_project_by_id(id):
    db_data = read_db()
    for p in db_data.get("projects", []):
        if p.get("id") == id:
            return p
    return None

def add_project(project):
    db_data = read_db()
    db_data.setdefault("projects", []).append(project)
    write_db(db_data)

def update_project(project):
    db_data = read_db()
    projects = db_data.setdefault("projects", [])
    for idx, p in enumerate(projects):
        if p.get("id") == project.get("id"):
            projects[idx] = project
            write_db(db_data)
            return True
    return False

def delete_project(id):
    db_data = read_db()
    db_data["projects"] = [p for p in db_data.get("projects", []) if p.get("id") != id]
    write_db(db_data)
