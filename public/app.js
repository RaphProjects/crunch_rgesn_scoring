// App State
let projects = [];
let currentProjectId = null;
let currentProject = null;
let criteriaDefinitions = [];
let pollingInterval = null;

// DOM Elements
const dragArea = document.getElementById('dragArea');
const browseBtn = document.getElementById('browseBtn');
const fileInput = document.getElementById('fileInput');
const uploadForm = document.getElementById('uploadForm');
const projectNameInput = document.getElementById('projectName');
const fileInfo = document.getElementById('fileInfo');
const fileNameSpan = document.getElementById('fileName');
const submitBtn = document.getElementById('submitBtn');
const projectsList = document.getElementById('projectsList');

// LLM Settings DOM Elements
const modeRegexBtn = document.getElementById('modeRegexBtn');
const modeLlmBtn = document.getElementById('modeLlmBtn');
const llmOptionsPanel = document.getElementById('llmOptionsPanel');
const llmProvider = document.getElementById('llmProvider');
const apiKeyGroup = document.getElementById('apiKeyGroup');
const llmApiKey = document.getElementById('llmApiKey');
const llmModel = document.getElementById('llmModel');
const projectMode = document.getElementById('projectMode');

const welcomeView = document.getElementById('welcomeView');
const projectView = document.getElementById('projectView');

const currentProjectName = document.getElementById('currentProjectName');
const projectStatusBadge = document.getElementById('projectStatusBadge');
const projectDate = document.getElementById('projectDate');
const projectFiles = document.getElementById('projectFiles');
const deleteProjectBtn = document.getElementById('deleteProjectBtn');

const projectErrorAlert = document.getElementById('projectErrorAlert');
const projectErrorMsg = document.getElementById('projectErrorMsg');
const projectProcessingAlert = document.getElementById('projectProcessingAlert');
const projectDashboardContent = document.getElementById('projectDashboardContent');

const globalScorePercent = document.getElementById('globalScorePercent');
const scorePointsObtained = document.getElementById('scorePointsObtained');
const scorePointsMax = document.getElementById('scorePointsMax');
const progressCircle = document.querySelector('.progress-ring__circle');

const categoriesList = document.getElementById('categoriesList');
const quickWinsDeck = document.getElementById('quickWinsDeck');
const criteriaList = document.getElementById('criteriaList');
const criteriaSearch = document.getElementById('criteriaSearch');
const filterTabs = document.querySelectorAll('.filter-tab');

// Ingestion Drag-and-Drop Event Listeners
['dragenter', 'dragover'].forEach(eventName => {
  dragArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    dragArea.classList.add('dragover');
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dragArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    dragArea.classList.remove('dragover');
  }, false);
});

dragArea.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0 && files[0].name.endsWith('.zip')) {
    fileInput.files = files;
    updateFileDisplay(files[0]);
  } else {
    alert("Veuillez déposer un fichier .zip uniquement.");
  }
});

browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    updateFileDisplay(fileInput.files[0]);
  }
});

removeFileBtn.addEventListener('click', () => {
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dragArea.classList.remove('hidden');
});

function sanitizeNoEmail(name) {
  if (!name) return "";
  const emailRegex = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
  let sanitized = name.replace(emailRegex, 'Projet');
  sanitized = sanitized.replace(/\S+@\S+/g, 'Projet');
  sanitized = sanitized.replace(/^[\s-_.,()]+|[\s-_.,()]+$/g, '');
  if (sanitized.trim().toLowerCase() === 'projet' || sanitized.trim() === '') {
    return 'Projet Anonyme';
  }
  return sanitized;
}

function updateFileDisplay(file) {
  fileNameSpan.textContent = sanitizeNoEmail(file.name);
  dragArea.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  
  // Suggest a project name if empty
  if (!projectNameInput.value) {
    projectNameInput.value = sanitizeNoEmail(file.name.replace('.zip', '').replace(/[-_]/g, ' '));
  }
}

// --- LLM AND ANALYSIS OPTIONS TOGGLES ---
modeRegexBtn.addEventListener('click', () => {
  modeRegexBtn.classList.add('active');
  modeLlmBtn.classList.remove('active');
  llmOptionsPanel.classList.add('hidden');
  localStorage.setItem('ecoaudit_mode', 'regex');
});

modeLlmBtn.addEventListener('click', () => {
  modeLlmBtn.classList.add('active');
  modeRegexBtn.classList.remove('active');
  llmOptionsPanel.classList.remove('hidden');
  localStorage.setItem('ecoaudit_mode', 'llm');
});

// Toggle API Key input based on provider
llmProvider.addEventListener('change', () => {
  const provider = llmProvider.value;
  localStorage.setItem('ecoaudit_provider', provider);
  
  // Show API Key field only if not local
  if (provider === 'local') {
    apiKeyGroup.classList.add('hidden');
    llmModel.placeholder = 'qwen3:0.6b, gemma:2b... (par défaut qwen3:0.6b)';
    // Restore or set local model
    const saved = localStorage.getItem('ecoaudit_model_local');
    llmModel.value = saved || 'qwen3:0.6b';
  } else {
    apiKeyGroup.classList.remove('hidden');
    // Restore saved API Key
    llmApiKey.value = localStorage.getItem('ecoaudit_apikey_' + provider) || '';
    
    // Set appropriate placeholder and value for model
    if (provider === 'openai') {
      llmModel.placeholder = 'gpt-4o-mini, gpt-4o... (par défaut gpt-4o-mini)';
      llmModel.value = localStorage.getItem('ecoaudit_model_openai') || 'gpt-4o-mini';
    } else if (provider === 'mistral') {
      llmModel.placeholder = 'mistral-tiny, mistral-large... (par défaut mistral-tiny)';
      llmModel.value = localStorage.getItem('ecoaudit_model_mistral') || 'mistral-tiny';
    } else if (provider === 'anthropic') {
      llmModel.placeholder = 'claude-3-5-haiku, claude-3-5-sonnet... (par défaut claude-3-5-haiku)';
      llmModel.value = localStorage.getItem('ecoaudit_model_anthropic') || 'claude-3-5-haiku';
    }
  }
});

// Input listeners to save to localStorage
llmApiKey.addEventListener('input', () => {
  localStorage.setItem('ecoaudit_apikey_' + llmProvider.value, llmApiKey.value);
});

llmModel.addEventListener('input', () => {
  localStorage.setItem('ecoaudit_model_' + llmProvider.value, llmModel.value);
});

// Form Submission (Upload)
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (fileInput.files.length === 0) {
    alert("Veuillez sélectionner un fichier ZIP.");
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('name', projectNameInput.value);

  // Append LLM configurations
  const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
  formData.append('analysisMode', activeMode);
  
  if (activeMode === 'llm') {
    const provider = llmProvider.value;
    const apiKey = llmApiKey.value;
    const model = llmModel.value;
    
    formData.append('llmProvider', provider);
    formData.append('llmApiKey', apiKey);
    formData.append('llmModel', model);
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></span> Analyse en préparation...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur lors du téléversement.");

    // Clean upload form
    fileInput.value = '';
    projectNameInput.value = '';
    fileInfo.classList.add('hidden');
    dragArea.classList.remove('hidden');

    // Reload projects list and highlight new project
    await loadProjectsList();
    selectProject(data.projectId);

  } catch (error) {
    alert(error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="play" class="btn-icon"></i> Lancer l\'Analyse';
    lucide.createIcons();
  }
});

// Load Projects List
async function loadProjectsList() {
  try {
    const res = await fetch('/api/projects');
    projects = await res.json();
    
    // Sort projects: newest first
    projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    renderProjectsList();
  } catch (err) {
    console.error("Failed to load projects", err);
  }
}

function renderProjectsList() {
  if (projects.length === 0) {
    projectsList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-open"></i>
        <p>Aucun projet analysé</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  projectsList.innerHTML = projects.map(p => {
    const date = new Date(p.createdAt).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short'
    });
    
    const isActive = p.id === currentProjectId ? 'active' : '';
    
    let scoreDisplay = `<div class="project-item-score">${p.globalScore}%</div>`;
    let statusBadge = '';
    
    if (p.status !== 'Terminé') {
      scoreDisplay = '';
      const statusClass = p.status === 'En attente' ? 'pending' : 
                          p.status === "En cours d'analyse" ? 'processing' : 'error';
      const label = p.status === 'En attente' ? 'Attente' : 
                    p.status === "En cours d'analyse" ? 'Scan...' : 'Erreur';
      
      statusBadge = `<span class="project-item-status ${statusClass}">${label}</span>`;
    }

    return `
      <div class="project-item ${isActive}" onclick="selectProject('${p.id}')">
        <div class="project-item-info">
          <span class="project-item-name">${escapeHTML(p.name)}</span>
          <div class="project-item-meta">
            <span>${date}</span>
            <span>${p.totalFiles} fichiers</span>
            ${statusBadge}
          </div>
        </div>
        ${scoreDisplay}
      </div>
    `;
  }).join('');
  
  lucide.createIcons();
}

// Select a Project
async function selectProject(projectId) {
  currentProjectId = projectId;
  
  // Highlight active sidebar item
  const items = document.querySelectorAll('.project-item');
  items.forEach(item => item.classList.remove('active'));
  
  renderProjectsList();
  
  // Cancel previous polling
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  welcomeView.classList.add('hidden');
  projectView.classList.remove('hidden');

  await loadProjectDetails();
}

// Load current project details
async function loadProjectDetails() {
  if (!currentProjectId) return;

  try {
    const res = await fetch(`/api/projects/${currentProjectId}`);
    if (res.status === 404) {
      // If project was deleted, go back to welcome
      showWelcomeView();
      return;
    }
    
    currentProject = await res.json();
    
    // Set labels
    currentProjectName.textContent = currentProject.name;
    projectDate.innerHTML = `<i data-lucide="calendar"></i> ${new Date(currentProject.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    projectFiles.innerHTML = `<i data-lucide="file-code"></i> ${currentProject.totalFiles} fichiers`;
    
    // Display Analysis Mode Badge
    if (currentProject.analysisMode === 'llm') {
      projectMode.innerHTML = `<i data-lucide="cpu"></i> IA (${currentProject.llmProvider.toUpperCase()})`;
      projectMode.classList.remove('hidden');
    } else {
      projectMode.classList.add('hidden');
    }
    
    // Status Badge
    projectStatusBadge.textContent = currentProject.status;
    projectStatusBadge.className = 'badge';
    if (currentProject.status === 'En attente') projectStatusBadge.classList.add('pending');
    else if (currentProject.status === "En cours d'analyse") projectStatusBadge.classList.add('processing');
    else if (currentProject.status === 'Erreur') projectStatusBadge.classList.add('error');
    
    // View switches based on status
    if (currentProject.status === 'En attente' || currentProject.status === "En cours d'analyse") {
      projectErrorAlert.classList.add('hidden');
      projectProcessingAlert.classList.remove('hidden');
      projectDashboardContent.classList.add('hidden');
      const diagCard = document.getElementById('llmDiagnosticCard');
      if (diagCard) diagCard.classList.add('hidden');
      
      // Start Polling
      if (!pollingInterval) {
        pollingInterval = setInterval(loadProjectDetails, 1500);
      }
    } else if (currentProject.status === 'Erreur') {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      projectProcessingAlert.classList.add('hidden');
      projectDashboardContent.classList.add('hidden');
      const diagCard = document.getElementById('llmDiagnosticCard');
      if (diagCard) diagCard.classList.add('hidden');
      
      projectErrorMsg.textContent = currentProject.error || "Une erreur inconnue s'est produite.";
      projectErrorAlert.classList.remove('hidden');
    } else {
      // Completed successfully!
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      projectProcessingAlert.classList.add('hidden');
      projectErrorAlert.classList.add('hidden');
      projectDashboardContent.classList.remove('hidden');

      // LLM Diagnostics Rendering
      const diagCard = document.getElementById('llmDiagnosticCard');
      if (diagCard) {
        if (currentProject.llmDiagnostic) {
          diagCard.classList.remove('hidden');
          
          // Fill details
          document.getElementById('llmDiagProvider').textContent = currentProject.llmDiagnostic.provider.toUpperCase();
          document.getElementById('llmDiagModel').textContent = currentProject.llmDiagnostic.model;
          document.getElementById('llmDiagTime').textContent = (currentProject.llmDiagnostic.responseTime / 1000).toFixed(2) + 's';
          
          const statusBadge = document.getElementById('llmDiagStatusBadge');
          const errorContainer = document.getElementById('llmDiagErrorContainer');
          const rawPre = document.getElementById('llmDiagRawPre');
          const toggleBtn = document.getElementById('toggleLlmRawBtn');
          
          // Reset raw view state
          rawPre.classList.add('hidden');
          toggleBtn.innerHTML = `<i data-lucide="chevron-right" class="btn-icon"></i> Voir la réponse brute de l'IA (JSON)`;
          
          if (currentProject.llmDiagnostic.status === 'success') {
            statusBadge.textContent = 'Succès';
            statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
            statusBadge.style.color = 'var(--color-green)';
            statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            errorContainer.classList.add('hidden');
            
            // Fill raw JSON formatted text
            rawPre.textContent = currentProject.llmDiagnostic.rawOutput;
            document.getElementById('llmDiagOutputContainer').classList.remove('hidden');
          } else {
            statusBadge.textContent = 'Repli Regex';
            statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
            statusBadge.style.color = '#ef4444';
            statusBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            
            document.getElementById('llmDiagErrorMsg').textContent = currentProject.llmDiagnostic.error || 'Erreur inconnue';
            errorContainer.classList.remove('hidden');
            document.getElementById('llmDiagOutputContainer').classList.add('hidden');
          }
        } else {
          diagCard.classList.add('hidden');
        }
      }
      
      // Render dashboard contents
      renderDashboard();
    }
    
    lucide.createIcons();

  } catch (err) {
    console.error("Failed to load project details", err);
  }
}

// Render Dashboard
function renderDashboard() {
  if (!currentProject) return;

  // 1. Global Score Gauge
  const score = currentProject.globalScore;
  globalScorePercent.textContent = score;
  scorePointsObtained.textContent = currentProject.totalPointsObtained;
  scorePointsMax.textContent = currentProject.totalPointsMax;
  
  // Animate Gauge Ring
  const radius = 82;
  const circumference = 2 * Math.PI * radius; // ~515.22
  const offset = circumference - (score / 100) * circumference;
  progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
  progressCircle.style.strokeDashoffset = offset;

  // Update stroke gradient colors or styles based on score value
  if (score < 40) {
    progressCircle.style.stroke = 'var(--color-red)';
  } else if (score < 70) {
    progressCircle.style.stroke = 'var(--color-amber)';
  } else {
    progressCircle.style.stroke = 'url(#gradientGreen)';
  }

  // 2. Render Categories Breakdown
  categoriesList.innerHTML = currentProject.categoryScores.map(cat => {
    return `
      <div class="category-bar-container">
        <div class="category-bar-header">
          <span class="category-name">${escapeHTML(cat.name)}</span>
          <div class="category-stats">
            <span class="category-stats-item validated">${cat.validatedCount} ✔</span>
            <span class="category-stats-item not-validated">${cat.notValidatedCount} ✖</span>
            ${cat.manualCount > 0 ? `<span class="category-stats-item manual">${cat.manualCount} ✍</span>` : ''}
            <span class="category-stats-item score">${cat.score}%</span>
          </div>
        </div>
        <div class="category-progress-track">
          <div class="category-progress-bar" style="width: ${cat.score}%; background: ${getCategoryBarGradient(cat.score)}"></div>
        </div>
      </div>
    `;
  }).join('');

  // 3. Render Quick Wins (Prioritaire + Faible difficulty + Currently NOT Validated)
  const quickWins = Object.values(currentProject.criteria).filter(crit => 
    crit.priority.toLowerCase().includes('prioritaire') && 
    crit.difficulty.toLowerCase().includes('faible') &&
    crit.status === 'Non-Validé'
  );

  if (quickWins.length === 0) {
    quickWinsDeck.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 20px;">
        <i data-lucide="check-circle" style="color: var(--color-green);"></i>
        <p>Excellent ! Aucun Quick Win manquant. Tous vos critères prioritaires simples sont validés !</p>
      </div>
    `;
  } else {
    quickWinsDeck.innerHTML = quickWins.map(qw => {
      return `
        <div class="quick-win-card">
          <div class="quick-win-header">
            <span class="quick-win-code">${qw.code}</span>
            <span class="quick-win-cat">${escapeHTML(qw.category)}</span>
          </div>
          <p class="quick-win-text">${escapeHTML(qw.text)}</p>
          <div class="quick-win-footer">
            <span class="quick-win-badge"><i data-lucide="award"></i> Prioritaire (Faible)</span>
            <button class="quick-win-action-btn" onclick="openCriterionInExplorer('${qw.code}')">
              Optimiser <i data-lucide="arrow-right"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 4. Render Criteria Explorer
  renderCriteriaList();
}

function getCategoryBarGradient(score) {
  if (score < 40) return 'var(--color-red)';
  if (score < 70) return 'linear-gradient(90deg, var(--color-amber) 0%, var(--color-blue) 100%)';
  return 'linear-gradient(90deg, var(--color-blue) 0%, var(--color-green) 100%)';
}

// Render Criteria Explorer list with filters
function renderCriteriaList() {
  if (!currentProject) return;

  const searchQuery = criteriaSearch.value.toLowerCase().trim();
  const activeFilterTab = document.querySelector('.filter-tab.active');
  const filterType = activeFilterTab ? activeFilterTab.dataset.filter : 'all';

  const criteriaArray = Object.values(currentProject.criteria);

  // Filtered array
  const filtered = criteriaArray.filter(crit => {
    // 1. Text Search match
    const textMatch = crit.code.toLowerCase().includes(searchQuery) || 
                      crit.text.toLowerCase().includes(searchQuery) ||
                      crit.category.toLowerCase().includes(searchQuery);
    
    if (!textMatch) return false;

    // 2. Tab Filter match
    if (filterType === 'all') return true;
    if (filterType === 'auto') return crit.type === 'auto';
    if (filterType === 'manual') return crit.type === 'manual';
    
    // Status filters
    return crit.status === filterType;
  });

  if (filtered.length === 0) {
    criteriaList.innerHTML = `
      <div class="empty-state" style="padding: 40px;">
        <i data-lucide="search-x"></i>
        <p>Aucun critère ne correspond à vos filtres de recherche.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  criteriaList.innerHTML = filtered.map(crit => {
    const isManualType = crit.type === 'manual';
    const isAutoType = crit.type === 'auto';

    // Findings section
    let findingsHTML = '';
    if (crit.findings && crit.findings.length > 0) {
      findingsHTML = `
        <div class="findings-box">
          <h4>Traces détectées (Analyseur) :</h4>
          <div class="findings-list">
            ${crit.findings.map(f => `
              <div class="finding-item">
                <i data-lucide="terminal"></i>
                <span>${escapeHTML(f)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // External Reference Resource (GR491, etc)
    let resourcesHTML = '';
    if (crit.resources) {
      resourcesHTML = `
        <div class="details-section">
          <h4>Ressource Externe Référence :</h4>
          <a href="${crit.resources}" target="_blank" class="gr491-link">
            <i data-lucide="external-link"></i> Fiche de référence GR491
          </a>
        </div>
      `;
    }

    // Override Panel
    const actionPanelHTML = `
      <div class="details-action-panel">
        <h3>Déclarer la Conformité</h3>
        <p class="subtitle" style="font-size: 11px; margin-bottom: 8px;">Ajustez manuellement si nécessaire.</p>
        <div class="declaration-segments">
          <button class="segment-btn ${crit.status === 'Validé' ? 'active' : ''}" data-status="Validé" onclick="updateManualStatus('${crit.code}', 'Validé', event)">
            <i data-lucide="check-circle-2"></i> Conforme (Validé)
          </button>
          <button class="segment-btn ${crit.status === 'Non-Validé' ? 'active' : ''}" data-status="Non-Validé" onclick="updateManualStatus('${crit.code}', 'Non-Validé', event)">
            <i data-lucide="x-circle"></i> Non-Conforme (0 pts)
          </button>
          <button class="segment-btn ${crit.status === 'N/A' ? 'active' : ''}" data-status="N/A" onclick="updateManualStatus('${crit.code}', 'N/A', event)">
            <i data-lucide="slash"></i> Non Applicable (Exclu)
          </button>
          ${isManualType ? `
            <button class="segment-btn ${crit.status === 'Manuel' ? 'active' : ''}" data-status="Manuel" onclick="updateManualStatus('${crit.code}', 'Manuel', event)">
              <i data-lucide="help-circle"></i> À évaluer (Manuel)
            </button>
          ` : ''}
        </div>
      </div>
    `;

    return `
      <div class="crit-row" id="crit-row-${crit.code}">
        <div class="crit-summary" onclick="toggleCriterionExpanded('${crit.code}')">
          <span class="crit-code-val">${crit.code}</span>
          <span class="crit-text-val" title="${escapeHTML(crit.text)}">${escapeHTML(crit.text)}</span>
          <span class="crit-cat-val">${escapeHTML(crit.category)}</span>
          <span><span class="prio-pill ${crit.priority.toLowerCase()}">${crit.priority}</span></span>
          <span><span class="diff-pill ${crit.difficulty.toLowerCase()}">${crit.difficulty}</span></span>
          <span><span class="type-pill ${crit.type}">${isAutoType ? 'Auto' : 'Manuel'}</span></span>
          <span><span class="status-pill ${crit.status.toLowerCase().replace('/', '-')}">${crit.status}</span></span>
        </div>
        
        <div class="crit-details">
          <div class="details-grid">
            <div class="details-info">
              <div class="details-section">
                <h4>Objectif Numérique Soutenable :</h4>
                <p>${escapeHTML(crit.objective || "Non spécifié.")}</p>
              </div>
              <div class="details-section">
                <h4>Justification & Analyse :</h4>
                <p style="color: var(--text-muted); italic; font-size: 13px;">${escapeHTML(crit.justification)}</p>
              </div>
              ${resourcesHTML}
              ${findingsHTML}
            </div>
            <div>
              ${actionPanelHTML}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Toggle accordion open/close
function toggleCriterionExpanded(code) {
  const row = document.getElementById(`crit-row-${code}`);
  if (!row) return;

  const isOpen = row.classList.contains('open');
  
  // Close all other rows for cleanliness
  document.querySelectorAll('.crit-row').forEach(r => r.classList.remove('open'));

  if (!isOpen) {
    row.classList.add('open');
    // Smooth scroll inside details
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Focus on a criterion in explorer
function openCriterionInExplorer(code) {
  // Clear search and filters to make sure it shows
  criteriaSearch.value = '';
  filterTabs.forEach(tab => tab.classList.remove('active'));
  document.querySelector('.filter-tab[data-filter="all"]').classList.add('active');

  renderCriteriaList();

  // Highlight and expand row
  setTimeout(() => {
    toggleCriterionExpanded(code);
  }, 100);
}

// Update Manual Status from Segment click
async function updateManualStatus(code, newStatus, event) {
  event.stopPropagation(); // Prevent accordion toggling
  
  if (!currentProject) return;

  try {
    const res = await fetch(`/api/projects/${currentProjectId}/manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        updates: {
          [code]: newStatus
        }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur de mise à jour");

    // Update state and re-render dashboard
    currentProject = data.project;
    
    // Update active project details in projects list array
    const projIdx = projects.findIndex(p => p.id === currentProjectId);
    if (projIdx !== -1) {
      projects[projIdx].globalScore = currentProject.globalScore;
      projects[projIdx].categoryScores = currentProject.categoryScores;
    }
    
    renderProjectsList();
    renderDashboard();
    
    // Re-expand the active one
    const row = document.getElementById(`crit-row-${code}`);
    if (row) row.classList.add('open');

  } catch (err) {
    alert(err.message);
  }
}

// Delete current project
deleteProjectBtn.addEventListener('click', async () => {
  if (!currentProjectId) return;

  if (!confirm(`Voulez-vous vraiment supprimer le projet "${currentProject.name}" de l'historique ? Cette action est irréversible.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/projects/${currentProjectId}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur de suppression.");

    showWelcomeView();
    await loadProjectsList();

  } catch (err) {
    alert(err.message);
  }
});

function showWelcomeView() {
  currentProjectId = null;
  currentProject = null;
  welcomeView.classList.remove('hidden');
  projectView.classList.add('hidden');
  
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  // Unhighlight list items
  const items = document.querySelectorAll('.project-item');
  items.forEach(item => item.classList.remove('active'));
}

// Search and Filters Controls
criteriaSearch.addEventListener('input', () => {
  renderCriteriaList();
});

filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderCriteriaList();
  });
});

// HTML escaping helper
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Init
async function init() {
  // Restore analysis options from localStorage
  const savedMode = localStorage.getItem('ecoaudit_mode') || 'regex';
  const savedProvider = localStorage.getItem('ecoaudit_provider') || 'local';
  
  llmProvider.value = savedProvider;
  
  // Set values and triggers
  if (savedMode === 'llm') {
    modeLlmBtn.classList.add('active');
    modeRegexBtn.classList.remove('active');
    llmOptionsPanel.classList.remove('hidden');
  } else {
    modeRegexBtn.classList.add('active');
    modeLlmBtn.classList.remove('active');
    llmOptionsPanel.classList.add('hidden');
  }
  
  // Trigger provider change to toggle visibility and restore fields
  llmProvider.dispatchEvent(new Event('change'));

  // Toggle Raw LLM response view
  const toggleBtn = document.getElementById('toggleLlmRawBtn');
  const rawPre = document.getElementById('llmDiagRawPre');
  if (toggleBtn && rawPre) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = rawPre.classList.contains('hidden');
      if (isHidden) {
        rawPre.classList.remove('hidden');
        toggleBtn.innerHTML = `<i data-lucide="chevron-down" class="btn-icon"></i> Masquer la réponse brute de l'IA`;
      } else {
        rawPre.classList.add('hidden');
        toggleBtn.innerHTML = `<i data-lucide="chevron-right" class="btn-icon"></i> Voir la réponse brute de l'IA (JSON)`;
      }
      lucide.createIcons();
    });
  }

  await loadProjectsList();
  lucide.createIcons();
}

window.onload = init;
