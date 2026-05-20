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

def safe_url_filename(url, fallback):
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.strip('/').replace('/', '_')
    if not path:
        path = fallback
    name = "".join(c if c.isalnum() or c in ['_', '-'] else "_" for c in path)
    return (name[:70] or fallback) + ".html"

def safe_url_dirname(url, fallback):
    parsed = urllib.parse.urlparse(url if '://' in url else 'https://' + url)
    host = parsed.netloc.replace(':', '_') or fallback
    path = parsed.path.strip('/').replace('/', '_')
    raw = f"{host}_{path}" if path else host
    name = "".join(c if c.isalnum() or c in ['_', '-'] else "_" for c in raw)
    return name[:70] or fallback

def extract_internal_links(html_content, base_url, max_links=4):
    parsed_base = urllib.parse.urlparse(base_url)
    base_host = parsed_base.netloc.lower()
    links = []
    seen = set()
    hrefs = re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html_content, re.IGNORECASE)

    ignored_exts = (
        '.pdf', '.zip', '.rar', '.7z', '.png', '.jpg', '.jpeg', '.gif', '.webp',
        '.svg', '.ico', '.css', '.js', '.json', '.xml', '.mp4', '.mp3', '.webm',
        '.woff', '.woff2', '.ttf'
    )
    ignored_prefixes = ('mailto:', 'tel:', 'javascript:', 'data:')

    for href in hrefs:
        href = href.strip()
        if not href or href.startswith('#') or href.lower().startswith(ignored_prefixes):
            continue
        absolute = urllib.parse.urljoin(base_url, href)
        parsed = urllib.parse.urlparse(absolute)
        if parsed.scheme not in ['http', 'https']:
            continue
        if parsed.netloc.lower() != base_host:
            continue
        normalized = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path or '/', '', parsed.query, ''))
        lower_path = parsed.path.lower()
        if lower_path.endswith(ignored_exts):
            continue
        if normalized in seen or normalized.rstrip('/') == base_url.rstrip('/'):
            continue
        seen.add(normalized)
        links.append(normalized)
        if len(links) >= max_links:
            break

    return links

def fetch_url_and_build_dir(url, extract_dir):
    log_event("URL_CRAWLER", "START", f"Crawling URL: {url} into {extract_dir}")
    os.makedirs(extract_dir, exist_ok=True)
    
    if not url.startswith('http://') and not url.startswith('https://'):
        url = 'https://' + url

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Encoding': 'gzip, deflate, br'
    }
    
    def fetch_html_page(page_url, filename):
        start_time = time.time()
        res = requests.get(page_url, headers=headers, timeout=15)
        response_time_ms = int((time.time() - start_time) * 1000)
        res.raise_for_status()

        content_type = res.headers.get('Content-Type', '')
        if 'text/html' not in content_type and 'application/xhtml' not in content_type and not res.text.lstrip().lower().startswith('<!doctype html'):
            raise ValueError(f"URL non HTML ignorée ({content_type or 'content-type absent'})")

        headers_comment = "\n<!-- HTTP_HEADERS_START\n"
        for k, v in res.headers.items():
            headers_comment += f"{k}: {v}\n"
        headers_comment += "HTTP_HEADERS_END -->\n"
        full_html = headers_comment + f"<!-- Source URL: {page_url} -->\n<!-- Response Time: {response_time_ms}ms -->\n" + res.text

        with open(os.path.join(extract_dir, filename), 'w', encoding='utf-8') as f:
            f.write(full_html)

        return {
            "url": page_url,
            "filename": filename,
            "status_code": res.status_code,
            "responseTimeMs": response_time_ms,
            "sizeBytes": len(res.content),
            "headers": dict(res.headers),
            "html": res.text
        }

    main_page = fetch_html_page(url, 'index.html')
    html_content = main_page["html"]
    page_logs = [{k: v for k, v in main_page.items() if k != "html"}]

    extra_links = extract_internal_links(html_content, url, max_links=4)
    pages_dir = os.path.join(extract_dir, 'pages')
    os.makedirs(pages_dir, exist_ok=True)
    for idx, page_url in enumerate(extra_links, start=1):
        try:
            filename = os.path.join('pages', f"page_{idx:02d}_{safe_url_filename(page_url, f'page_{idx:02d}')}")
            page = fetch_html_page(page_url, filename)
            page_logs.append({k: v for k, v in page.items() if k != "html"})
            log_event("URL_CRAWLER", "PAGE_FETCHED", f"Fetched internal page {idx}/{len(extra_links)}: {page_url}")
        except Exception as e:
            page_logs.append({
                "url": page_url,
                "status": "ignored",
                "error": str(e)
            })
            log_event("URL_CRAWLER", "PAGE_FETCH_ERROR", f"Failed to fetch internal page {page_url}: {e}")

    perf_log = {
        "url": url,
        "pages": page_logs,
        "maxExtraPages": 4
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
            
    fetched_pages = len([p for p in page_logs if p.get("filename")])
    log_event("URL_CRAWLER", "SUCCESS", f"Successfully crawled {url}. Saved {fetched_pages} HTML page(s) and {fetched_count} asset(s).")

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

                urls = url if isinstance(url, list) else ([url] if url else [])
                if urls:
                    log_event("QUEUE", "CRAWL_START", f"Crawling {len(urls)} URL(s) for project {project_id}: {urls}")
                    if len(urls) == 1:
                        fetch_url_and_build_dir(urls[0], extract_dir)
                    else:
                        for idx, page_url in enumerate(urls, start=1):
                            url_dir = os.path.join(extract_dir, f"url_{idx:02d}_{safe_url_dirname(page_url, f'url_{idx:02d}')}")
                            os.makedirs(url_dir, exist_ok=True)
                            try:
                                fetch_url_and_build_dir(page_url, url_dir)
                            except Exception as crawl_error:
                                log_event("QUEUE", "CRAWL_URL_ERROR", f"Failed to crawl URL {page_url} for project {project_id}: {crawl_error}")
                                with open(os.path.join(url_dir, 'crawl_error.txt'), 'w', encoding='utf-8') as f:
                                    f.write(str(crawl_error))

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
                criteria, llm_diagnostic, file_inventory = analyze_directory(extract_dir, llm_config, excluded_criteria=excluded_criteria)
                manual_count = len([crit for crit in criteria.values() if crit.get("status") == "Manuel"])
                log_event(
                    "QUEUE",
                    "MANUAL_CRITERIA_COUNT",
                    f"Project {project_id}: manualResolutionMode={(llm_config or {}).get('manualResolutionMode')}, manual criteria after analysis={manual_count}"
                )

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
                project["fileInventory"] = file_inventory
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
