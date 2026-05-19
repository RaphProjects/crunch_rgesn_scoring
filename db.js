const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db_store.json');

// Initialize database file if it doesn't exist
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ projects: [] }, null, 2), 'utf-8');
}

/**
 * Read the current database state
 */
function readDb() {
  try {
    const data = fs.readFileSync(dbPath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return { projects: [] };
  }
}

/**
 * Write state back to the database
 */
function writeDb(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to write to DB store", e);
  }
}

/**
 * Convert text weights to numerical values
 */
function getPriorityValue(priorityStr) {
  const p = priorityStr.toLowerCase();
  if (p.includes('prioritaire')) return 3;
  if (p.includes('recommandé')) return 1;
  return 1; // Default fallback
}

function getDifficultyValue(difficultyStr) {
  const d = difficultyStr.toLowerCase();
  if (d.includes('faible')) return 1;
  if (d.includes('moyen')) return 2;
  if (d.includes('fort') || d.includes('forte')) return 3;
  return 2; // Default fallback
}

/**
 * Calculate all scores for a project based on its criteria state
 */
function calculateProjectScores(criteria) {
  let totalPointsObtained = 0;
  let totalPointsMax = 0;

  // Breakdown by category
  const categories = {};

  Object.values(criteria).forEach(crit => {
    const prioVal = getPriorityValue(crit.priority);
    const diffVal = getDifficultyValue(crit.difficulty);
    const maxVal = prioVal * diffVal;

    // Initialize category tracking if not present
    if (!categories[crit.category]) {
      categories[crit.category] = {
        name: crit.category,
        obtained: 0,
        max: 0,
        validatedCount: 0,
        notValidatedCount: 0,
        naCount: 0,
        manualCount: 0,
        totalCount: 0
      };
    }

    const cat = categories[crit.category];
    cat.totalCount++;

    if (crit.status === 'Validé') {
      const points = maxVal;
      totalPointsObtained += points;
      totalPointsMax += maxVal;
      
      cat.obtained += points;
      cat.max += maxVal;
      cat.validatedCount++;
    } else if (crit.status === 'Non-Validé') {
      totalPointsMax += maxVal;
      
      cat.max += maxVal;
      cat.notValidatedCount++;
    } else if (crit.status === 'N/A') {
      // Excluded from scoring
      cat.naCount++;
    } else if (crit.status === 'Manuel') {
      // Manual check - not yet answered, treated as 0 points but maximum is counted
      totalPointsMax += maxVal;
      cat.max += maxVal;
      cat.manualCount++;
    }
  });

  // Calculate global score
  const globalScore = totalPointsMax > 0 
    ? Math.round((totalPointsObtained / totalPointsMax) * 100) 
    : 100;

  // Finalize category scores
  const categoryScores = Object.values(categories).map(cat => {
    return {
      name: cat.name,
      score: cat.max > 0 ? Math.round((cat.obtained / cat.max) * 100) : 100,
      obtained: cat.obtained,
      max: cat.max,
      validatedCount: cat.validatedCount,
      notValidatedCount: cat.notValidatedCount,
      naCount: cat.naCount,
      manualCount: cat.manualCount,
      totalCount: cat.totalCount
    };
  });

  return {
    globalScore,
    totalPointsObtained,
    totalPointsMax,
    categoryScores
  };
}

/**
 * Get all projects from database (short details)
 */
function getProjects() {
  const db = readDb();
  return db.projects.map(p => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    status: p.status,
    globalScore: p.globalScore,
    totalFiles: p.totalFiles,
    categories: p.categories
  }));
}

/**
 * Find project by ID
 */
function getProjectById(id) {
  const db = readDb();
  return db.projects.find(p => p.id === id);
}

/**
 * Add a new project to the database
 */
function addProject(project) {
  const db = readDb();
  db.projects.push(project);
  writeDb(db);
}

/**
 * Update project details
 */
function updateProject(project) {
  const db = readDb();
  const index = db.projects.findIndex(p => p.id === project.id);
  if (index !== -1) {
    db.projects[index] = project;
    writeDb(db);
    return true;
  }
  return false;
}

/**
 * Delete project from database
 */
function deleteProject(id) {
  const db = readDb();
  db.projects = db.projects.filter(p => p.id !== id);
  writeDb(db);
}

module.exports = {
  getProjects,
  getProjectById,
  addProject,
  updateProject,
  deleteProject,
  calculateProjectScores
};
