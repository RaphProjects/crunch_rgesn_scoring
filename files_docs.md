This report provides a comprehensive overview of the **RGESN Scoring** project, a Green IT-focused application designed to audit software for environmental sustainability based on the RGESN framework.

### **Project File Hierarchy**

The project follows a standard full-stack JavaScript structure with a Node.js/Express backend and a vanilla JavaScript/CSS frontend.

``` text
rgesn_scoring/
├── public/                 # Frontend assets (Static)
│   ├── index.html          # Main UI dashboard
│   ├── style.css           # Custom Glassmorphism design system
│   └── app.js              # Client-side logic & UI interactions
├── uploads/                # Temporary storage for uploaded .zip files
├── temp_extractions/       # Workspace for analyzing extracted project code
├── server.py               # (Flask Version) Python entry point for the API
├── analyzer.py             # (Python) Core logic for RGESN static analysis
├── analysis_queue.py       # (Python) Asynchronous job management
├── db.py                   # (Python) JSON-based persistence & score logic
├── queue.js                # (Node.js) Alternative JS queue management
├── db_store.json           # Local database for project audit history
├── rgesn_criteria.json     # Official RGESN reference data
├── package.json            # Node.js dependencies and scripts
└── README.md               # Project documentation and setup guide

```

-----

### **Core Component Descriptions**

| Component           | Key Files                           | Functionality                                                                                                                                                     |
| :------------------ | :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend UI**     | `index.html`, `app.js`, `style.css` | Provides a dashboard for users to upload ZIP files or URLs. It visualizes the **Global Score**, category breakdowns, and technical "findings" for each criterion. |
| **Orchestration**   | `server.py`, `analysis_queue.py`    | Manages API endpoints (`/api/upload`, `/api/projects`). It handles file ingestion and uses a sequential queue to process analyses one by one to avoid CPU spikes. |
| **Analysis Engine** | `analyzer.py`                       | The "Rule Engine." It scans code for patterns like `autoplay` tags, heavy scroll listeners, or missing cache headers to automate 14 specific RGESN criteria.      |
| **Data & Scoring**  | `db.py`, `db_store.json`            | Stores project results and calculates scores using a weighted formula: $Priority \\times Difficulty$. It also handles "N/A" exclusions.                           |

-----

### **Modification Examples**

#### **1. Add a New Automated Rule**

To add a new rule (e.g., checking for a specific library or code pattern):

  * **File to change**: `analyzer.py`.
  * **Action**: In the `analyze_directory` function, create a new `set_auto` call. For example, to check for a `.env` file:
    ``` python
    has_env = any(f['name'] == '.env' for f in file_contents)
    set_auto('CODE_ID', 'Validé' if has_env else 'Non-Validé', "Description of check", ["Findings detail"])
    
    ```

#### **2. Modify Scoring Logic**

To change how weights are applied to "Priority" levels (e.g., making "Recommandé" carry more weight):

  * **File to change**: `db.py`.
  * **Action**: Update the `get_priority_weight` function:
    ``` python
    def get_priority_weight(priority_str):
        p = priority_str.lower()
        if 'prioritaire' in p: return 1.5
        if 'recommandé' in p: return 1.4  # Modified from 1.25
        return 1.0
    
    ```

#### **3. Update UI Branding or Layout**

To modify the visual look or add a new tab to the dashboard:

  * **Files to change**: `index.html` and `style.css`.
  * **Action**: Add your HTML structure in `index.html` and define corresponding styles in `style.css` using the CSS variables defined in `:root` (e.g., `--color-green`).

#### **4. Change the Default AI Model**

If you want the AI-assisted analysis to use a different local model:

  * **File to change**: `analyzer.py`.
  * **Action**: Update the `query_llm` function's `model_name` default for the 'local' provider:
    ``` python
    model_name = model if model else 'gemma:2b'  # Changed from qwen3:0.6b
    
    ```
