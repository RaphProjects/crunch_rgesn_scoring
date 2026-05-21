import json
import os
import tempfile
import threading
import time

DB_PATH = os.path.join(os.path.dirname(__file__), 'db_store.json')
_db_lock = threading.Lock()

if not os.path.exists(DB_PATH):
    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump({"projects": []}, f, indent=2, ensure_ascii=False)


def _read_db_unlocked():
    """Read JSON store. Returns None if the file is temporarily unreadable."""
    try:
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return {"projects": []}
    data.setdefault("projects", [])
    return data


def read_db():
    with _db_lock:
        for attempt in range(8):
            data = _read_db_unlocked()
            if data is not None:
                return data
            time.sleep(0.025 * (attempt + 1))
        print("[DB] Warning: could not read db_store.json after retries; using empty store.")
        return {"projects": []}


def write_db(data):
    with _db_lock:
        _write_db_unlocked(data)


def _write_db_unlocked(data):
    directory = os.path.dirname(DB_PATH) or "."
    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, DB_PATH)
    except Exception as e:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        print("Failed to write to DB store", e)
        raise


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
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
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
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
        for p in db_data.get("projects", []):
            if p.get("id") == id:
                return p
    return None


def add_project(project):
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
        db_data.setdefault("projects", []).append(project)
        _write_db_unlocked(db_data)


def update_project(project):
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
        projects = db_data.setdefault("projects", [])
        for idx, p in enumerate(projects):
            if p.get("id") == project.get("id"):
                projects[idx] = project
                _write_db_unlocked(db_data)
                return True
        return False


def patch_project(project_id, patch):
    """Merge fields into an existing project without replacing the whole record."""
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
        projects = db_data.setdefault("projects", [])
        for idx, p in enumerate(projects):
            if p.get("id") != project_id:
                continue
            updated = {**p, **patch}
            if "analysisProgress" in patch and isinstance(patch["analysisProgress"], dict):
                previous = p.get("analysisProgress") or {}
                incoming = dict(patch["analysisProgress"])
                if "percent" in incoming and incoming["percent"] is not None:
                    incoming["percent"] = max(
                        int(previous.get("percent", 0)),
                        min(99, int(incoming["percent"])),
                    )
                updated["analysisProgress"] = {**previous, **incoming}
            projects[idx] = updated
            _write_db_unlocked(db_data)
            return updated
        return None


def delete_project(id):
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
        db_data["projects"] = [p for p in db_data.get("projects", []) if p.get("id") != id]
        _write_db_unlocked(db_data)


def _run_score_migration():
    with _db_lock:
        db_data = _read_db_unlocked() or {"projects": []}
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
            _write_db_unlocked(db_data)
            print("[DB] Automatically migrated project scores using the new RGESN formula.")


try:
    _run_score_migration()
except Exception as migration_error:
    print("[DB] Error running automatic score migration:", migration_error)
