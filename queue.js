const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const db = require('./db');
const { analyzeDirectory } = require('./analyzer');

class AnalysisQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Enqueue a new analysis job
   */
  enqueue(projectId, zipFilePath, originalName, llmConfig = null) {
    this.queue.push({ projectId, zipFilePath, originalName, llmConfig });
    console.log(`[Queue] Job enqueued for project ${projectId}. Queue size: ${this.queue.length}`);
    this.processNext();
  }

  /**
   * Process the next job in the queue
   */
  async processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const job = this.queue.shift();
    console.log(`[Queue] Starting analysis for project ${job.projectId}...`);

    try {
      const project = db.getProjectById(job.projectId);
      if (!project) {
        throw new Error(`Project ${job.projectId} not found in database.`);
      }

      // Update status to processing
      project.status = "En cours d'analyse";
      db.updateProject(project);

      // Create a unique temporary directory for extraction
      const extractDir = path.join(__dirname, 'temp_extractions', job.projectId);
      fs.mkdirSync(extractDir, { recursive: true });

      // Extract ZIP
      console.log(`[Queue] Extracting zip file for project ${job.projectId}...`);
      let fileCount = 0;
      try {
        const zip = new AdmZip(job.zipFilePath);
        zip.extractAllTo(extractDir, true);
        
        // Count total extracted files
        const countFiles = (dir) => {
          let count = 0;
          const list = fs.readdirSync(dir);
          list.forEach(file => {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              count += countFiles(fullPath);
            } else {
              count++;
            }
          });
          return count;
        };
        fileCount = countFiles(extractDir);
      } catch (zipError) {
        throw new Error(`Failed to extract project ZIP archive: ${zipError.message}`);
      }

      // Run analyzer
      console.log(`[Queue] Running static analyzer on extracted files...`);
      const { criteria, llmDiagnostic } = await analyzeDirectory(extractDir, job.llmConfig);

      // Calculate initial scores based on scan
      const scores = db.calculateProjectScores(criteria);

      // Clean up extracted files to avoid disk bloat (Green IT cleanup)
      console.log(`[Queue] Cleaning up temporary files for ${job.projectId}...`);
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
        // Also remove uploaded zip
        if (fs.existsSync(job.zipFilePath)) {
          fs.unlinkSync(job.zipFilePath);
        }
      } catch (cleanupError) {
        console.error(`[Queue] Error during temp file cleanup:`, cleanupError);
      }

      // Update project record with results
      project.status = "Terminé";
      project.totalFiles = fileCount;
      project.criteria = criteria;
      project.globalScore = scores.globalScore;
      project.totalPointsObtained = scores.totalPointsObtained;
      project.totalPointsMax = scores.totalPointsMax;
      project.categoryScores = scores.categoryScores;
      project.completedAt = new Date().toISOString();
      
      // Store LLM diagnostics if analysis mode was LLM
      if (llmDiagnostic) {
        project.llmDiagnostic = llmDiagnostic;
      }

      db.updateProject(project);
      console.log(`[Queue] Finished analysis for project ${job.projectId}. Global Score: ${scores.globalScore}%`);

    } catch (error) {
      console.error(`[Queue] Error processing project ${job.projectId}:`, error);
      
      const project = db.getProjectById(job.projectId);
      if (project) {
        project.status = "Erreur";
        project.error = error.message;
        db.updateProject(project);
      }
    } finally {
      this.processing = false;
      // Process next item with a tiny delay to allow CPU cooling (Green IT breathing space)
      setTimeout(() => this.processNext(), 1000);
    }
  }
}

// Create a single global instance
const analysisQueue = new AnalysisQueue();

module.exports = analysisQueue;
