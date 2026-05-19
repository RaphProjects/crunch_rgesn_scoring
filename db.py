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

def get_priority_weight(priority_str):
    p = priority_str.lower() if priority_str else ''
    if 'prioritaire' in p:
        return 1.5
    if 'recommandé' in p:
        return 1.25
    return 1.0

def calculate_project_scores(criteria):
    total_points_obtained = 0.0
    total_points_max = 0.0
    categories = {}

    for crit in criteria.values():
        weight = get_priority_weight(crit.get('priority', ''))

        cat_name = crit.get('category')
        if not cat_name:
            continue
            
        if cat_name not in categories:
            categories[cat_name] = {
                "name": cat_name,
                "obtained": 0.0,
                "max": 0.0,
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
            total_points_obtained += weight
            total_points_max += weight
            cat["obtained"] += weight
            cat["max"] += weight
            cat["validatedCount"] += 1
        elif status == 'Non-Validé':
            total_points_max += weight
            cat["max"] += weight
            cat["notValidatedCount"] += 1
        elif status == 'N/A':
            cat["naCount"] += 1
        elif status == 'Manuel':
            total_points_max += weight
            cat["max"] += weight
            cat["manualCount"] += 1

    global_score = round((total_points_obtained / total_points_max) * 100) if total_points_max > 0 else 100

    category_scores = []
    for cat in categories.values():
        category_scores.append({
            "name": cat["name"],
            "score": round((cat["obtained"] / cat["max"]) * 100) if cat["max"] > 0 else 100,
            "obtained": round(cat["obtained"], 2),
            "max": round(cat["max"], 2),
            "validatedCount": cat["validatedCount"],
            "notValidatedCount": cat["notValidatedCount"],
            "naCount": cat["naCount"],
            "manualCount": cat["manualCount"],
            "totalCount": cat["totalCount"]
        })

    return {
        "globalScore": global_score,
        "totalPointsObtained": round(total_points_obtained, 2),
        "totalPointsMax": round(total_points_max, 2),
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

# Automatic migration to recalculate scores for all projects with the correct formula
try:
    db_data = read_db()
    updated = False
    for project in db_data.get("projects", []):
        if "criteria" in project and project.get("status") == "Terminé":
            scores = calculate_project_scores(project["criteria"])
            if (project.get("globalScore") != scores["globalScore"] or 
                project.get("totalPointsObtained") != scores["totalPointsObtained"] or
                project.get("totalPointsMax") != scores["totalPointsMax"] or
                project.get("categoryScores") != scores["categoryScores"]):
                
                project["globalScore"] = scores["globalScore"]
                project["totalPointsObtained"] = scores["totalPointsObtained"]
                project["totalPointsMax"] = scores["totalPointsMax"]
                project["categoryScores"] = scores["categoryScores"]
                updated = True
    if updated:
        write_db(db_data)
        print("[DB] Automatically migrated project scores using the new RGESN formula.")
except Exception as migration_error:
    print("[DB] Error running automatic score migration:", migration_error)
