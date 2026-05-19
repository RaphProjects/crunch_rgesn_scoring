import os
from datetime import datetime

LOG_FILE = os.path.join(os.path.dirname(__file__), 'logs.log')

def log_event(module, event_type, message, details=None):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_line = f"[{timestamp}] [{module}] [{event_type}] {message}\n"
    if details:
        log_line += f"  Details: {details}\n"
    
    # Print to console as well
    print(f"[{module}] [{event_type}] {message}")
    
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_line)
    except Exception as e:
        print(f"Failed to write to log file: {e}")
