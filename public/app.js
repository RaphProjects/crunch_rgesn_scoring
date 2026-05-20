// App State
let projects = [];
let currentProjectId = null;
let currentProject = null;
let criteriaDefinitions = [];
let pollingInterval = null;
let currentProjectSummary = null;
let currentProjectSummaryId = null;
let isFetchingSummary = false;

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

const projectUrlInput = document.getElementById('projectUrl');

// Auto-fill project name as user types a URL
projectUrlInput.addEventListener('input', () => {
  if (projectUrlInput.value) {
    try {
      let urlStr = projectUrlInput.value;
      if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
        urlStr = 'https://' + urlStr;
      }
      const parsed = new URL(urlStr);
      let domain = parsed.hostname;
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      if (!projectNameInput.value || projectNameInput.value.startsWith('Site ') || projectNameInput.value === 'Projet Anonyme') {
        projectNameInput.value = 'Site ' + domain;
      }
    } catch (e) {
      // Ignore URL parsing errors while typing
    }
  }
});

// LLM Settings DOM Elements
const modeRegexBtn = document.getElementById('modeRegexBtn');
const modeLlmBtn = document.getElementById('modeLlmBtn');
const manualFlowClassicBtn = document.getElementById('manualFlowClassicBtn');
const manualFlowChatbotBtn = document.getElementById('manualFlowChatbotBtn');
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
const downloadPdfBtn = document.getElementById('downloadPdfBtn');

const projectErrorAlert = document.getElementById('projectErrorAlert');
const projectErrorMsg = document.getElementById('projectErrorMsg');
const projectProcessingAlert = document.getElementById('projectProcessingAlert');
const projectDashboardContent = document.getElementById('projectDashboardContent');
const manualChatbotView = document.getElementById('manualChatbotView');
const manualChatbotProgress = document.getElementById('manualChatbotProgress');
const manualChatbotMessages = document.getElementById('manualChatbotMessages');
const manualChatbotExitBtn = document.getElementById('manualChatbotExitBtn');

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

manualFlowClassicBtn.addEventListener('click', () => {
  manualFlowClassicBtn.classList.add('active');
  manualFlowChatbotBtn.classList.remove('active');
  localStorage.setItem('ecoaudit_manual_flow', 'classic');
});

manualFlowChatbotBtn.addEventListener('click', () => {
  manualFlowChatbotBtn.classList.add('active');
  manualFlowClassicBtn.classList.remove('active');
  localStorage.setItem('ecoaudit_manual_flow', 'chatbot');
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
  
  const formData = new FormData();
  formData.append('name', projectNameInput.value);

  const hasFile = fileInput.files.length > 0;
  const urlValue = projectUrlInput.value.trim();

  if (!hasFile && !urlValue) {
    alert("Veuillez sélectionner un fichier ZIP et/ou saisir une URL de site web.");
    return;
  }

  if (hasFile) {
    formData.append('file', fileInput.files[0]);
  }
  if (urlValue) {
    formData.append('url', urlValue);
  }

  // Append LLM configurations
  const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
  const activeManualFlow = document.querySelector('.manual-flow-btn.active').dataset.flow;
  formData.append('analysisMode', activeMode);
  formData.append('manualResolutionMode', activeManualFlow);
  
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
    projectUrlInput.value = '';
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
  currentProjectSummary = null;
  currentProjectSummaryId = null;
  
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
      if (manualChatbotView) manualChatbotView.classList.add('hidden');
      if (downloadPdfBtn) downloadPdfBtn.classList.add('hidden');
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
      if (manualChatbotView) manualChatbotView.classList.add('hidden');
      if (downloadPdfBtn) downloadPdfBtn.classList.add('hidden');
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
      // Show PDF download button
      if (downloadPdfBtn) downloadPdfBtn.classList.remove('hidden');

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
      const shouldUseChatbot = currentProject.manualResolutionMode === 'chatbot' && getManualCriteria().length > 0;
      if (shouldUseChatbot) {
        showManualChatbot();
      } else {
        showProjectDashboard();
      }
    }
    
    lucide.createIcons();

  } catch (err) {
    console.error("Failed to load project details", err);
  }
}

// Render Dashboard
function getManualCriteria() {
  if (!currentProject || !currentProject.criteria) return [];
  return Object.values(currentProject.criteria)
    .filter(crit => crit.status === 'Manuel')
    .sort((a, b) => a.code.localeCompare(b.code, 'fr'));
}

function showProjectDashboard() {
  projectDashboardContent.classList.remove('hidden');
  if (manualChatbotView) manualChatbotView.classList.add('hidden');
}

function showManualChatbot() {
  if (!manualChatbotView) return;
  projectDashboardContent.classList.add('hidden');
  manualChatbotView.classList.remove('hidden');
  renderManualChatbot();
  manualChatbotView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderManualChatbot() {
  if (!manualChatbotMessages) return;
  const manualCriteria = getManualCriteria();
  const answeredCount = currentProject && currentProject.criteria
    ? Object.values(currentProject.criteria).filter(crit => crit.type === 'manual' && crit.status !== 'Manuel').length
    : 0;

  if (manualCriteria.length === 0) {
    manualChatbotProgress.textContent = 'Toutes les questions manuelles ont été traitées.';
    manualChatbotMessages.innerHTML = `
      <div class="chat-message">
        <h3>Auto-déclaration terminée</h3>
        <p>Les scores ont été recalculés avec vos réponses. Vous pouvez consulter le tableau de bord complet.</p>
        <div class="chat-actions" style="grid-template-columns: 1fr;">
          <button type="button" class="btn btn-primary" onclick="showProjectDashboard()">
            <i data-lucide="layout-dashboard" class="btn-icon"></i> Voir le tableau de bord
          </button>
        </div>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const current = manualCriteria[0];
  manualChatbotProgress.textContent = `${manualCriteria.length} critère(s) à évaluer • ${answeredCount} réponse(s) enregistrée(s)`;
  manualChatbotMessages.innerHTML = `
    <div class="chat-message">
      <p>Je vais vous poser les critères restés en mode manuel un par un. Pour celui-ci, choisissez le statut qui reflète votre contexte réel.</p>
    </div>
    <div class="chat-message">
      <h3>${escapeHTML(current.code)} - ${escapeHTML(current.category || 'Critère RGESN')}</h3>
      <p>${escapeHTML(current.text || '')}</p>
      <div class="chat-criterion-meta">
        <span class="prio-pill ${(current.priority || '').toLowerCase()}">${escapeHTML(current.priority || '-')}</span>
        <span class="diff-pill ${(current.difficulty || '').toLowerCase()}">${escapeHTML(current.difficulty || '-')}</span>
      </div>
      <p>${escapeHTML(current.objective || current.justification || 'Indiquez le statut applicable pour votre service numérique.')}</p>
      <div class="chat-actions">
        <button class="segment-btn" type="button" onclick="answerManualChatbot('${current.code}', 'Validé')">
          <i data-lucide="check-circle-2"></i> Validé
        </button>
        <button class="segment-btn" type="button" onclick="answerManualChatbot('${current.code}', 'Non-Validé')">
          <i data-lucide="x-circle"></i> Non-validé
        </button>
        <button class="segment-btn" type="button" onclick="answerManualChatbot('${current.code}', 'N/A')">
          <i data-lucide="slash"></i> Non applicable
        </button>
      </div>
    </div>
  `;
  lucide.createIcons();
}

async function answerManualChatbot(code, newStatus) {
  if (!currentProjectId) return;
  try {
    const res = await fetch(`/api/projects/${currentProjectId}/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { [code]: newStatus } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur de mise à jour");

    currentProject = data.project;
    const projIdx = projects.findIndex(p => p.id === currentProjectId);
    if (projIdx !== -1) {
      projects[projIdx].globalScore = currentProject.globalScore;
      projects[projIdx].categoryScores = currentProject.categoryScores;
    }

    renderProjectsList();
    renderDashboard();
    renderManualChatbot();
  } catch (err) {
    alert(err.message);
  }
}

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

  // 3. Render Plan d'action (ALL currently NOT Validated criteria)
  const nonValidatedCriteria = Object.values(currentProject.criteria).filter(crit => 
    crit.status === 'Non-Validé'
  );

  const llmSummaryContainer = document.getElementById('llmSummaryContainer');

  if (nonValidatedCriteria.length === 0) {
    quickWinsDeck.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 20px;">
        <i data-lucide="check-circle" style="color: var(--color-green);"></i>
        <p>Excellent ! Aucun critère n'est non-validé. Votre projet est 100% conforme sur les critères applicables !</p>
      </div>
    `;
    if (llmSummaryContainer) {
      llmSummaryContainer.classList.add('hidden');
    }
  } else {
    if (llmSummaryContainer) {
      llmSummaryContainer.classList.remove('hidden');
    }
    
    // Sort criteria by Priority (Prioritaire first) and then Difficulty (Faible first)
    nonValidatedCriteria.sort((a, b) => {
      const aPrio = a.priority.toLowerCase().includes('prioritaire') ? 0 : 1;
      const bPrio = b.priority.toLowerCase().includes('prioritaire') ? 0 : 1;
      if (aPrio !== bPrio) return aPrio - bPrio;
      
      const difficultyOrder = { 'faible': 0, 'moyen': 1, 'fort': 2 };
      const aDiff = difficultyOrder[a.difficulty.toLowerCase()] ?? 1;
      const bDiff = difficultyOrder[b.difficulty.toLowerCase()] ?? 1;
      return aDiff - bDiff;
    });

    quickWinsDeck.innerHTML = nonValidatedCriteria.map(qw => {
      return `
        <div class="quick-win-card">
          <div class="quick-win-header">
            <span class="quick-win-code">${qw.code}</span>
            <span class="quick-win-cat">${escapeHTML(qw.category)}</span>
          </div>
          <p class="quick-win-text">${escapeHTML(getNegativeFormulation(qw.code, qw.text))}</p>
          <div class="quick-win-footer">
            <span class="quick-win-badge"><i data-lucide="award"></i> ${escapeHTML(qw.priority)} (${escapeHTML(qw.difficulty)})</span>
            <button class="quick-win-action-btn" onclick="openCriterionInExplorer('${qw.code}')">
              Optimiser <i data-lucide="arrow-right"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    // Request LLM summary of Action Plan
    fetchLlmActionPlanSummary();
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
if (manualChatbotExitBtn) {
  manualChatbotExitBtn.addEventListener('click', () => {
    showProjectDashboard();
  });
}

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

// PDF Download handler
if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener('click', async () => {
    if (!currentProjectId) return;
    const originalHTML = downloadPdfBtn.innerHTML;
    downloadPdfBtn.disabled = true;
    downloadPdfBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span> Génération...';
    try {
      const res = await fetch(`/api/projects/${currentProjectId}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur serveur lors de la génération du PDF.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const projectName = (currentProject && currentProject.name) ? currentProject.name.replace(/\s+/g, '_').slice(0, 40) : 'rapport';
      a.download = `rapport_rgesn_${projectName}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (err) {
      alert('Impossible de générer le rapport PDF : ' + err.message);
    } finally {
      downloadPdfBtn.disabled = false;
      downloadPdfBtn.innerHTML = originalHTML;
      lucide.createIcons();
    }
  });
}

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

async function fetchLlmActionPlanSummary(force = false) {
  if (isFetchingSummary) return;
  if (!currentProject) return;

  const textEl = document.getElementById('llmSummaryText');
  if (!textEl) return;

  if (!force && currentProjectSummary && currentProjectSummaryId === currentProjectId) {
    textEl.innerHTML = currentProjectSummary;
    return;
  }

  const nonValidatedCriteria = Object.values(currentProject.criteria).filter(crit => 
    crit.status === 'Non-Validé'
  );

  if (nonValidatedCriteria.length === 0) {
    return;
  }

  isFetchingSummary = true;
  currentProjectSummaryId = currentProjectId;

  textEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div class="spinner" style="width: 14px; height: 14px; border-width: 2px; display: inline-block;"></div>
      <span>L'IA analyse vos ${nonValidatedCriteria.length} critères non-conformes pour rédiger votre plan de route...</span>
    </div>
  `;

  try {
    const provider = llmProvider.value;
    const apiKey = llmApiKey.value;
    const model = llmModel.value;

    const res = await fetch(`/api/projects/${currentProjectId}/summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        llmProvider: provider,
        llmApiKey: apiKey,
        llmModel: model
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur de génération.");

    currentProjectSummary = parseMarkdownToHTML(data.summary);
    textEl.innerHTML = currentProjectSummary;
    lucide.createIcons();
  } catch (err) {
    console.error("Action plan summary failed:", err);
    currentProjectSummary = `
      <div style="color: #f87171; display: flex; align-items: flex-start; gap: 6px;">
        <i data-lucide="alert-circle" style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px;"></i>
        <span>Génération impossible : ${escapeHTML(err.message)}</span>
      </div>
    `;
    textEl.innerHTML = currentProjectSummary;
    lucide.createIcons();
  } finally {
    isFetchingSummary = false;
  }
}

function parseMarkdownToHTML(markdown) {
  if (!markdown) return '';

  let html = markdown;

  // Escape HTML characters except for formatting we will add
  html = escapeHTML(html);

  // Restore basic markdown formatting after escaping

  // Headers (### to #)
  html = html.replace(/^### (.*?)$/gm, '<h4 style="color: #c084fc; font-weight: 700; font-size: 13.5px; margin-top: 14px; margin-bottom: 6px;">$1</h4>');
  html = html.replace(/^## (.*?)$/gm, '<h3 style="color: #c084fc; font-weight: 700; font-size: 14px; margin-top: 16px; margin-bottom: 8px;">$1</h3>');
  html = html.replace(/^# (.*?)$/gm, '<h2 style="color: #c084fc; font-weight: 800; font-size: 15px; margin-top: 18px; margin-bottom: 10px;">$1</h2>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #f1f5f9; font-weight: 600;">$1</strong>');

  // Inline Code
  html = html.replace(/`(.*?)`/g, '<code style="font-family: monospace; padding: 2px 4px; background: rgba(255, 255, 255, 0.08); border-radius: 4px; color: #a78bfa;">$1</code>');

  // Lists
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li style="margin-left: 16px; list-style-type: disc; margin-bottom: 4px; color: var(--text-muted);">$1</li>');

  // Paragraphs
  html = html.split('\n\n').map(p => {
    if (p.trim().startsWith('<li') || p.trim().startsWith('<h')) return p;
    return `<p style="margin-bottom: 10px; color: var(--text-muted);">${p}</p>`;
  }).join('\n');

  return html;
}

function getNegativeFormulation(code, originalText) {
  const formulations = {
    'Str5': "Le service n'a pas été conçu avec des technologies interopérables standardisées (utilisation de technologies spécifiques ou fermées).",
    'Spec1': "Le service n'a pas défini la liste des profils de matériels ou navigateurs cibles de ses utilisateurs.",
    'Spec2': "Le service n'est pas utilisable sur d'anciens modèles de terminaux.",
    'Spec3': "Le service n'est pas utilisable sur d'anciennes versions de navigateurs ou de systèmes d'exploitation.",
    'Spec4': "Le service ne s'adapte pas de manière fluide aux différents types de terminaux d'affichage (manque de responsive design).",
    'Spec5': "Le service n'a pas prévu de stratégie de maintenance ou de décommissionnement technique.",
    'Uxui1': "Le service contient des médias ou animations dont la lecture automatique (autoplay) est active.",
    'Uxui2': "Le service a recours à un défilement infini pour charger son contenu.",
    'Uxui3': "Le service utilise des notifications système sans laisser la possibilité simple de les désactiver.",
    'Cont1': "Le service n'utilise pas de définition de vidéo adaptée au contenu et au contexte de visualisation.",
    'Cont2': "Le service propose des vidéos dont le mode de compression n'est pas optimal ou efficace.",
    'Cont3': "Le service ne propose pas de mode d'écoute seule (sans vidéo) pour ses vidéos.",
    'Bck2': "Le service n'a pas recours à un système de cache serveur pour ses données les plus utilisées.",
    'Bck3': "Le service ne met pas en place de durées limites de conservation sur ses données.",
    'Frnt1': "Le service ne s'astreint pas à un poids maximum et une limite de requête par écran.",
    'Frnt2': "Le service n'utilise pas de mécanismes de mise en cache client pour ses ressources.",
    'Algo3': "Le service ne met pas en place de mécanismes visant à limiter la quantité d'entraînement nécessaire à ses modèles d'IA.",
    'Algo6': "Le service n'utilise pas de stratégie d'inférence optimisée pour ses algorithmes d'IA."
  };
  
  return formulations[code] || originalText;
}

// Init
async function init() {
  // Restore analysis options from localStorage
  const savedMode = localStorage.getItem('ecoaudit_mode') || 'regex';
  const savedManualFlow = localStorage.getItem('ecoaudit_manual_flow') || 'classic';
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

  if (savedManualFlow === 'chatbot') {
    manualFlowChatbotBtn.classList.add('active');
    manualFlowClassicBtn.classList.remove('active');
  } else {
    manualFlowClassicBtn.classList.add('active');
    manualFlowChatbotBtn.classList.remove('active');
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

  // Refresh Action Plan summary button click listener
  const refreshActionPlanBtn = document.getElementById('refreshActionPlanBtn');
  if (refreshActionPlanBtn) {
    refreshActionPlanBtn.addEventListener('click', () => {
      fetchLlmActionPlanSummary(true);
    });
  }

  await loadProjectsList();
  lucide.createIcons();
}

window.onload = init;
