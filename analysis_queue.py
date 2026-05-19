import os
import shutil
import zipfile
import threading
import queue
import time
from datetime import datetime
import db
from analyzer import analyze_directory

class AnalysisQueue:
    def __init__(self):
        self.job_queue = queue.Queue()
        self.processing = False
        self.worker_thread = None

    def enqueue(self, project_id, zip_file_path, original_name, llm_config=None):
        self.job_queue.put({
            "projectId": project_id,
            "zipFilePath": zip_file_path,
            "originalName": original_name,
            "llmConfig": llm_config
        })
        print(f"[Queue] Job enqueued for project {project_id}. Queue size: {self.job_queue.qsize()}")
        
        if self.worker_thread is None or not self.worker_thread.is_alive():
            self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
            self.worker_thread.start()

    def _worker_loop(self):
        self.processing = True
        while True:
            try:
                job = self.job_queue.get(timeout=2)
            except queue.Empty:
                break

            project_id = job["projectId"]
            zip_file_path = job["zipFilePath"]
            llm_config = job["llmConfig"]

            print(f"[Queue] Starting analysis for project {project_id}...")

            try:
                project = db.get_project_by_id(project_id)
                if not project:
                    raise ValueError(f"Project {project_id} not found in database.")

                project["status"] = "En cours d'analyse"
                db.update_project(project)

                extract_dir = os.path.join(os.path.dirname(__file__), 'temp_extractions', project_id)
                os.makedirs(extract_dir, exist_ok=True)

                print(f"[Queue] Extracting zip file for project {project_id}...")
                file_count = 0
                try:
                    with zipfile.ZipFile(zip_file_path, 'r') as zip_ref:
                        zip_ref.extractall(extract_dir)

                    def count_files(dir_path):
                        count = 0
                        for entry in os.scandir(dir_path):
                            if entry.is_dir():
                                count += count_files(entry.path)
                            else:
                                count += 1
                        return count

                    file_count = count_files(extract_dir)
                except Exception as zip_error:
                    raise ValueError(f"Failed to extract project ZIP archive: {str(zip_error)}")

                print(f"[Queue] Running static analyzer on extracted files...")
                criteria, llm_diagnostic = analyze_directory(extract_dir, llm_config)

                scores = db.calculate_project_scores(criteria)

                print(f"[Queue] Cleaning up temporary files for {project_id}...")
                try:
                    shutil.rmtree(extract_dir, ignore_errors=True)
                    if os.path.exists(zip_file_path):
                        os.remove(zip_file_path)
                except Exception as cleanup_error:
                    print(f"[Queue] Error during temp file cleanup: {cleanup_error}")

                project["status"] = "Terminé"
                project["totalFiles"] = file_count
                project["criteria"] = criteria
                project["globalScore"] = scores["globalScore"]
                project["totalPointsObtained"] = scores["totalPointsObtained"]
                project["totalPointsMax"] = scores["totalPointsMax"]
                project["categoryScores"] = scores["categoryScores"]
                project["completedAt"] = datetime.utcnow().isoformat() + "Z"

                if llm_diagnostic:
                    project["llmDiagnostic"] = llm_diagnostic

                db.update_project(project)
                print(f"[Queue] Finished analysis for project {project_id}. Global Score: {scores['globalScore']}%")

            except Exception as error:
                print(f"[Queue] Error processing project {project_id}: {error}")
                project = db.get_project_by_id(project_id)
                if project:
                    project["status"] = "Erreur"
                    project["error"] = str(error)
                    db.update_project(project)
            finally:
                self.job_queue.task_done()
                time.sleep(1)

        self.processing = False

analysis_queue = AnalysisQueue()
