import os
import shutil
import zipfile
import threading
import queue
import time
import re
import json
import urllib.parse
import requests
from datetime import datetime
import db
from analyzer import analyze_directory
from logger import log_event

def fetch_url_and_build_dir(url, extract_dir):
    log_event("URL_CRAWLER", "START", f"Crawling URL: {url} into {extract_dir}")
    os.makedirs(extract_dir, exist_ok=True)
    
    if not url.startswith('http://') and not url.startswith('https://'):
        url = 'https://' + url

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Encoding': 'gzip, deflate, br'
    }
    
    start_time = time.time()
    res = requests.get(url, headers=headers, timeout=15)
    response_time_ms = int((time.time() - start_time) * 1000)
    res.raise_for_status()
    
    html_content = res.text
    resp_headers = res.headers
    
    headers_comment = "\n<!-- HTTP_HEADERS_START\n"
    for k, v in resp_headers.items():
        headers_comment += f"{k}: {v}\n"
    headers_comment += "HTTP_HEADERS_END -->\n"
    
    full_html = headers_comment + f"<!-- Response Time: {response_time_ms}ms -->\n" + html_content
    
    index_path = os.path.join(extract_dir, 'index.html')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(full_html)
        
    perf_log = {
        "url": url,
        "status_code": res.status_code,
        "responseTimeMs": response_time_ms,
        "sizeBytes": len(res.content),
        "headers": dict(resp_headers)
    }
    with open(os.path.join(extract_dir, 'performance.json'), 'w', encoding='utf-8') as f:
        json.dump(perf_log, f, indent=2)
        
    css_urls = re.findall(r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
    css_urls += re.findall(r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']stylesheet["\']', html_content, re.IGNORECASE)
    
    js_urls = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
    
    css_urls = list(set(css_urls))
    js_urls = list(set(js_urls))
    
    fetched_count = 0
    for css_rel in css_urls[:3]:
        try:
            css_url = urllib.parse.urljoin(url, css_rel)
            css_res = requests.get(css_url, headers=headers, timeout=5)
            if css_res.status_code == 200:
                safe_name = "".join([c if c.isalnum() else "_" for c in css_rel.split('/')[-1]])
                if not safe_name.endswith('.css'):
                    safe_name += '.css'
                with open(os.path.join(extract_dir, safe_name), 'w', encoding='utf-8') as f:
                    f.write(css_res.text)
                fetched_count += 1
        except Exception as e:
            log_event("URL_CRAWLER", "CSS_FETCH_ERROR", f"Failed to fetch CSS {css_rel}: {e}")
            
    for js_rel in js_urls[:3]:
        try:
            js_url = urllib.parse.urljoin(url, js_rel)
            js_res = requests.get(js_url, headers=headers, timeout=5)
            if js_res.status_code == 200:
                safe_name = "".join([c if c.isalnum() else "_" for c in js_rel.split('/')[-1]])
                if not safe_name.endswith('.js'):
                    safe_name += '.js'
                with open(os.path.join(extract_dir, safe_name), 'w', encoding='utf-8') as f:
                    f.write(js_res.text)
                fetched_count += 1
        except Exception as e:
            log_event("URL_CRAWLER", "JS_FETCH_ERROR", f"Failed to fetch JS {js_rel}: {e}")
            
    log_event("URL_CRAWLER", "SUCCESS", f"Successfully crawled {url}. Saved HTML and {fetched_count} assets.")

class AnalysisQueue:
    def __init__(self):
        self.job_queue = queue.Queue()
        self.processing = False
        self.worker_thread = None

    def enqueue(self, project_id, zip_file_path, original_name, llm_config=None, url=None, excluded_criteria=None):
        self.job_queue.put({
            "projectId": project_id,
            "zipFilePath": zip_file_path,
            "originalName": original_name,
            "llmConfig": llm_config,
            "url": url,
            "excludedCriteria": excluded_criteria or []
        })
        log_event("QUEUE", "ENQUEUE", f"Job enqueued for project {project_id}. Queue size: {self.job_queue.qsize()}")
        
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
            url = job.get("url")
            excluded_criteria = job.get("excludedCriteria", [])

            log_event("QUEUE", "JOB_START", f"Starting analysis for project {project_id}...")

            try:
                project = db.get_project_by_id(project_id)
                if not project:
                    raise ValueError(f"Project {project_id} not found in database.")

                project["status"] = "En cours d'analyse"
                db.update_project(project)

                extract_dir = os.path.join(os.path.dirname(__file__), 'temp_extractions', project_id)
                os.makedirs(extract_dir, exist_ok=True)

                file_count = 0

                if zip_file_path:
                    log_event("QUEUE", "EXTRACT", f"Extracting zip file for project {project_id}...")
                    try:
                        with zipfile.ZipFile(zip_file_path, 'r') as zip_ref:
                            zip_ref.extractall(extract_dir)
                    except Exception as zip_error:
                        raise ValueError(f"Failed to extract project ZIP archive: {str(zip_error)}")

                if url:
                    log_event("QUEUE", "CRAWL_START", f"Crawling URL {url} for project {project_id}...")
                    fetch_url_and_build_dir(url, extract_dir)

                def count_files(dir_path):
                    count = 0
                    for entry in os.scandir(dir_path):
                        if entry.is_dir():
                            count += count_files(entry.path)
                        else:
                            count += 1
                    return count

                file_count = count_files(extract_dir)

                log_event("QUEUE", "ANALYZE_START", f"Running static/LLM analyzer on project {project_id}...")
                criteria, llm_diagnostic = analyze_directory(extract_dir, llm_config, excluded_criteria=excluded_criteria)

                scores = db.calculate_project_scores(criteria)

                print(f"[Queue] Cleaning up temporary files for {project_id}...")
                try:
                    shutil.rmtree(extract_dir, ignore_errors=True)
                    if zip_file_path and os.path.exists(zip_file_path):
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
                log_event("QUEUE", "JOB_SUCCESS", f"Finished analysis for project {project_id}. Global Score: {scores['globalScore']}%")

            except Exception as error:
                log_event("QUEUE", "JOB_ERROR", f"Error processing project {project_id}: {error}")
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
