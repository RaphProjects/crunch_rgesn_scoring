"""Persist analysis progress and ETA on project records for UI polling."""
import threading
from datetime import datetime, timezone

import db

_heartbeat_stop = {}
_heartbeat_lock = threading.Lock()


def estimate_job_duration(job):
    """Heuristic total duration (seconds) from job shape."""
    seconds = 35
    if job.get("zipFilePath"):
        seconds += 18
    url = job.get("url")
    urls = url if isinstance(url, list) else ([url] if url else [])
    seconds += len(urls) * 22
    llm_config = job.get("llmConfig") or {}
    if llm_config.get("analysisMode") == "llm":
        excluded = job.get("excludedCriteria") or []
        llm_targets = max(8, 78 - len(excluded))
        seconds += 40 + llm_targets * 4
    return max(25, min(900, int(seconds)))


def _parse_started_at(iso_value):
    if not iso_value:
        return None
    try:
        normalized = iso_value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except (TypeError, ValueError):
        return None


def _compute_eta_seconds(started_at, percent, estimated_total):
    started_dt = _parse_started_at(started_at)
    if not started_dt:
        return max(0, int(estimated_total))
    elapsed = max(0, (datetime.now(timezone.utc) - started_dt).total_seconds())
    if percent >= 5:
        return max(0, int(elapsed * (100 - percent) / percent))
    return max(0, int(estimated_total - elapsed))


def update_project_progress(
    project_id,
    percent,
    stage,
    label,
    *,
    reset_started=False,
    estimated_total=None,
):
    project = db.get_project_by_id(project_id)
    if not project:
        return

    previous = project.get("analysisProgress") or {}
    if reset_started or not previous.get("startedAt"):
        started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        started_at = previous.get("startedAt")

    estimated = estimated_total
    if estimated is None:
        estimated = previous.get("estimatedTotalSeconds") or 60

    floor = previous.get("percent", 0)
    if reset_started:
        floor = 0
    percent = max(floor, min(99, int(percent)))

    progress = {
        "percent": percent,
        "stage": stage,
        "stageLabel": label,
        "startedAt": started_at,
        "estimatedTotalSeconds": int(estimated),
        "etaSeconds": _compute_eta_seconds(started_at, percent, estimated),
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    db.patch_project(project_id, {"analysisProgress": progress})


def tick_smooth_progress(project_id, estimated_total=None):
    """Time-based bump so the UI advances between sparse milestones."""
    project = db.get_project_by_id(project_id)
    if not project:
        return
    if project.get("status") not in ("En attente", "En cours d'analyse"):
        return

    previous = project.get("analysisProgress") or {}
    started_at = previous.get("startedAt")
    if not started_at:
        return

    estimated = estimated_total or previous.get("estimatedTotalSeconds") or 60
    started_dt = _parse_started_at(started_at)
    if not started_dt:
        return

    elapsed = max(0, (datetime.now(timezone.utc) - started_dt).total_seconds())
    floor = int(previous.get("percent", 2))
    time_percent = min(94, max(floor, int((elapsed / max(estimated, 1)) * 94)))

    if time_percent <= floor:
        return

    update_project_progress(
        project_id,
        time_percent,
        previous.get("stage", "analyze"),
        previous.get("stageLabel", "Analyse en cours..."),
        estimated_total=estimated,
    )


def start_progress_heartbeat(project_id, estimated_total):
    stop_event = threading.Event()

    def _run():
        while not stop_event.wait(1.2):
            tick_smooth_progress(project_id, estimated_total)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    with _heartbeat_lock:
        previous = _heartbeat_stop.get(project_id)
        if previous:
            previous.set()
        _heartbeat_stop[project_id] = stop_event

    return stop_event


def stop_progress_heartbeat(project_id):
    with _heartbeat_lock:
        stop_event = _heartbeat_stop.pop(project_id, None)
    if stop_event:
        stop_event.set()


def finish_project_progress(project_id):
    stop_progress_heartbeat(project_id)
    project = db.get_project_by_id(project_id)
    if not project:
        return
    previous = project.get("analysisProgress") or {}
    update_project_progress(
        project_id,
        100,
        "done",
        "Analyse terminée !",
        estimated_total=previous.get("estimatedTotalSeconds"),
    )


def clear_project_progress(project_id):
    stop_progress_heartbeat(project_id)
    db.patch_project(project_id, {"analysisProgress": None})
