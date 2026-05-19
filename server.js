const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const analysisQueue = require('./queue');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON body parser
app.use(express.json());

// Setup static files directory
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for secure and temporary file uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Uniquement les fichiers ZIP de projets sont acceptés.'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max limit
});

// Create temp_extractions directory on boot
const tempExtractionsDir = path.join(__dirname, 'temp_extractions');
if (!fs.existsSync(tempExtractionsDir)) {
  fs.mkdirSync(tempExtractionsDir, { recursive: true });
}

// --- API ENDPOINTS ---

/**
 * Get all criteria definitions
 */
app.get('/api/criteria', (req, res) => {
  try {
    const criteria = require('./rgesn_criteria.json');
    res.json(criteria);
  } catch (e) {
    res.status(500).json({ error: "Impossible de charger le référentiel des critères." });
  }
});

/**
 * Get list of all projects and scores
 */
app.get('/api/projects', (req, res) => {
  try {
    const projects = db.getProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des projets." });
  }
});

/**
 * Get detailed project audit
 */
app.get('/api/projects/:id', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération du projet." });
  }
});

/**
 * Upload a project ZIP and queue it for analysis
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Veuillez fournir un fichier ZIP de projet." });
    }

    const projectName = req.body.name || req.file.originalname.replace('.zip', '') || "Projet Anonyme";
    const projectId = uuidv4();

    const analysisMode = req.body.analysisMode || 'regex';
    const llmProvider = req.body.llmProvider || '';
    const llmApiKey = req.body.llmApiKey || '';
    const llmModel = req.body.llmModel || '';

    // Create placeholder project in DB
    const newProject = {
      id: projectId,
      name: projectName,
      createdAt: new Date().toISOString(),
      status: "En attente",
      globalScore: 0,
      totalFiles: 0,
      totalPointsObtained: 0,
      totalPointsMax: 0,
      criteria: {},
      categoryScores: [],
      error: null,
      analysisMode,
      llmProvider,
      llmModel
    };

    db.addProject(newProject);

    // Queue the background analysis with in-memory configs (keys are not persisted in DB)
    analysisQueue.enqueue(projectId, req.file.path, req.file.originalname, {
      analysisMode,
      llmProvider,
      llmApiKey,
      llmModel
    });

    res.json({
      success: true,
      message: "Projet téléversé et mis en file d'attente pour analyse.",
      projectId: projectId
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message || "Erreur lors du téléversement du projet." });
  }
});

/**
 * Update manual criteria status
 */
app.post('/api/projects/:id/manual', (req, res) => {
  try {
    const { updates } = req.body; // Map of { [critCode]: 'Validé' | 'Non-Validé' | 'N/A' }
    
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: "Corps de requête invalide. Attendu: { updates: { Code: statut } }" });
    }

    const project = db.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    // Apply manual overrides
    Object.keys(updates).forEach(code => {
      if (project.criteria[code]) {
        const newStatus = updates[code];
        if (['Validé', 'Non-Validé', 'N/A', 'Manuel'].includes(newStatus)) {
          project.criteria[code].status = newStatus;
          
          if (newStatus === 'Manuel') {
            project.criteria[code].justification = "Évaluation manuelle requise.";
          } else {
            project.criteria[code].justification = "Évalué manuellement par l'utilisateur.";
          }
        }
      }
    });

    // Recalculate global and category scores
    const scores = db.calculateProjectScores(project.criteria);
    project.globalScore = scores.globalScore;
    project.totalPointsObtained = scores.totalPointsObtained;
    project.totalPointsMax = scores.totalPointsMax;
    project.categoryScores = scores.categoryScores;

    db.updateProject(project);

    res.json({
      success: true,
      message: "Déclarations manuelles enregistrées et scores recalculés.",
      project: project
    });

  } catch (error) {
    console.error("Manual declaration update error:", error);
    res.status(500).json({ error: "Erreur lors de la mise à jour des critères manuels." });
  }
});

/**
 * Delete project
 */
app.delete('/api/projects/:id', (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }
    
    db.deleteProject(req.params.id);
    res.json({ success: true, message: "Projet supprimé de l'historique." });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la suppression du projet." });
  }
});

// Fallback to SPA homepage
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` RGESN Scoring Application Server is running!`);
  console.log(` Web interface: http://localhost:${PORT}`);
  console.log(` Environment:   Production / GreenIT optimized`);
  console.log(`===================================================`);
});
