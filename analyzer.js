const fs = require('fs');
const path = require('path');

// Load criteria definitions for mapping
let criteriaRepo = [];
try {
  criteriaRepo = require('./rgesn_criteria.json');
} catch (e) {
  console.error("Could not load criteria repo, using empty fallback", e);
}

/**
 * Helper to query LLM endpoints using Node native fetch
 */
async function queryLLM(config, systemPrompt, userPrompt) {
  const { llmProvider, llmApiKey, llmModel } = config;
  
  if (llmProvider === 'local') {
    // Local Ollama compatible endpoint
    const url = 'http://localhost:11434/v1/chat/completions';
    const body = {
      model: llmModel || 'qwen3:0.6b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000) // 30s timeout
    });
    
    if (!response.ok) {
      throw new Error(`Erreur Ollama locale (${response.status}) : ${await response.text()}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  if (llmProvider === 'openai') {
    const url = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: llmModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000) // 45s timeout
    });
    
    if (!response.ok) {
      throw new Error(`Erreur OpenAI (${response.status}) : ${await response.text()}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }

  if (llmProvider === 'mistral') {
    const url = 'https://api.mistral.ai/v1/chat/completions';
    const body = {
      model: llmModel || 'mistral-tiny',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000) // 45s timeout
    });
    
    if (!response.ok) {
      throw new Error(`Erreur Mistral AI (${response.status}) : ${await response.text()}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }

  if (llmProvider === 'anthropic') {
    const url = 'https://api.anthropic.com/v1/messages';
    const body = {
      model: llmModel || 'claude-3-5-haiku',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': llmApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000) // 45s timeout
    });
    
    if (!response.ok) {
      throw new Error(`Erreur Anthropic (${response.status}) : ${await response.text()}`);
    }
    
    const data = await response.json();
    return data.content[0].text;
  }

  throw new Error(`Fournisseur d'IA inconnu ou non supporté : ${llmProvider}`);
}

/**
 * Bulletproof JSON extractor from LLM text output
 */
function extractJson(text) {
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    const cleanText = match ? match[1].trim() : text.trim();
    return JSON.parse(cleanText);
  } catch (e) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const JSONText = text.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(JSONText);
      } catch (err) {}
    }
    throw new Error("Impossible de parser le JSON retourné par l'IA : " + e.message);
  }
}

/**
 * Build rich and lightweight project context for the LLM
 */
function collectProjectContext(dirPath, fileContents) {
  const fileTree = fileContents.map(f => f.relPath);
  const packageJson = fileContents.find(f => f.name === 'package.json');
  const readme = fileContents.find(f => f.name.toLowerCase().includes('readme'));
  const dockerfile = fileContents.find(f => f.name.toLowerCase() === 'dockerfile');
  const requirements = fileContents.find(f => f.name === 'requirements.txt');
  
  let context = `Nom du projet : ${path.basename(dirPath)}\n\n`;
  context += `Arborescence des fichiers :\n${fileTree.slice(0, 100).join('\n')}\n`;
  if (fileTree.length > 100) {
    context += `... et ${fileTree.length - 100} autres fichiers.\n`;
  }
  
  if (packageJson) {
    context += `\n--- FICHIER DE DÉPENDANCE (package.json) ---\n${packageJson.content}\n`;
  }
  if (requirements) {
    context += `\n--- FICHIER DE DÉPENDANCE (requirements.txt) ---\n${requirements.content}\n`;
  }
  if (dockerfile) {
    context += `\n--- CONFIGURATION DE DÉPLOIEMENT (Dockerfile) ---\n${dockerfile.content.slice(0, 1000)}\n`;
  }
  if (readme) {
    context += `\n--- DOCUMENTATION DU PROJET (README) ---\n${readme.content.slice(0, 3000)}\n`;
  }

  const htmlFiles = fileContents.filter(f => f.ext === '.html');
  if (htmlFiles.length > 0) {
    context += `\n--- EXTRAITS HTML (échantillons) ---\n`;
    htmlFiles.slice(0, 3).forEach(f => {
      context += `Fichier ${f.relPath} (premières lignes) :\n${f.content.slice(0, 800)}\n\n`;
    });
  }

  const jsFiles = fileContents.filter(f => ['.js', '.jsx', '.ts', '.tsx'].includes(f.ext));
  if (jsFiles.length > 0) {
    context += `\n--- EXTRAITS CODE SOURCE JS/TS (échantillons) ---\n`;
    jsFiles.slice(0, 3).forEach(f => {
      context += `Fichier ${f.relPath} (premières lignes) :\n${f.content.slice(0, 1000)}\n\n`;
    });
  }

  return context;
}

/**
 * Recursively find all files in a directory, ignoring node_modules and other binary/heavy dirs
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    // Ignore heavy or irrelevant folders
    if (['node_modules', '.git', 'dist', 'build', '.next', 'out', 'bin', 'obj', 'vendor'].includes(file)) {
      return;
    }

    const resPath = path.join(dirPath, file);
    if (fs.statSync(resPath).isDirectory()) {
      getAllFiles(resPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(resPath);
    }
  });

  return arrayOfFiles;
}

/**
 * Scan directory content and analyze it according to RGESN criteria
 */
async function analyzeDirectory(dirPath, llmConfig = null) {
  let llmDiagnostic = null;
  const allFiles = getAllFiles(dirPath);
  
  // File classification helper
  const filesByExt = {
    html: [],
    css: [],
    js: [], // includes ts, jsx, tsx
    json: [],
    yaml: [], // includes yml
    docker: [], // Dockerfile
    python: [], // py
    txt: [], // requirements.txt, etc
    readme: []
  };

  allFiles.forEach(file => {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    
    if (ext === '.html' || ext === '.htm') filesByExt.html.push(file);
    else if (ext === '.css' || ext === '.scss' || ext === '.less') filesByExt.css.push(file);
    else if (['.js', '.jsx', '.ts', '.tsx', '.mjs'].includes(ext)) filesByExt.js.push(file);
    else if (ext === '.json') filesByExt.json.push(file);
    else if (ext === '.yaml' || ext === '.yml') filesByExt.yaml.push(file);
    else if (base === 'dockerfile' || ext === '.dockerfile') filesByExt.docker.push(file);
    else if (ext === '.py') filesByExt.python.push(file);
    else if (ext === '.txt') filesByExt.txt.push(file);
    else if (base === 'readme.md' || base === 'readme.txt') filesByExt.readme.push(file);
  });

  // Load content of key files for quick inspection
  const fileContents = [];
  const readLimit = 200; // Read up to 200 files to avoid out of memory
  
  let filesRead = 0;
  for (const file of allFiles) {
    if (filesRead >= readLimit) break;
    
    const ext = path.extname(file).toLowerCase();
    // Only read text files
    if (['.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.yaml', '.yml', '.py', '.txt', '.md'].includes(ext) || path.basename(file).toLowerCase() === 'dockerfile') {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        fileContents.push({
          path: file,
          relPath: path.relative(dirPath, file),
          name: path.basename(file),
          ext: ext,
          content: content
        });
        filesRead++;
      } catch (err) {
        // Skip files that can't be read
      }
    }
  }

  // (The LLM refinement pipeline has been moved below to run AFTER classical pre-scan)

  // Pre-calculate presence of general structures
  const hasVideos = fileContents.some(f => 
    f.ext === '.html' && (f.content.includes('<video') || f.content.includes('<source')) ||
    f.ext === '.js' && (f.content.includes('createElement("video")') || f.content.includes('document.createElement(\'video\'') || f.content.includes('videoSrc'))
  );

  const hasML = fileContents.some(f => 
    f.ext === '.py' && (f.content.includes('import torch') || f.content.includes('import tensorflow') || f.content.includes('from keras') || f.content.includes('sklearn')) ||
    f.ext === '.json' && f.name === 'package.json' && (f.content.includes('@tensorflow/tfjs') || f.content.includes('onnxruntime'))
  );

  const packageJsonFiles = fileContents.filter(f => f.name === 'package.json');
  const requirementsFiles = fileContents.filter(f => f.name === 'requirements.txt');

  // We define the rules list
  const results = {};

  // Initialize all criteria as "Manuel" (for non-automatable) or "Non-Applicable" / "Non-Validé"
  criteriaRepo.forEach(crit => {
    results[crit.code] = {
      code: crit.code,
      category: crit.category,
      text: crit.text,
      priority: crit.priority,
      difficulty: crit.difficulty,
      objective: crit.objective,
      resources: crit.resources,
      status: 'Manuel', // Default state for manual declaration
      justification: 'Ce critère exige une évaluation humaine ou de gouvernance et ne peut pas être déduit du code source.',
      type: 'manual', // 'auto' or 'manual'
      findings: []
    };
  });

  // Helper to mark a criterion as automated
  const setAuto = (code, status, justification, findings = []) => {
    if (results[code]) {
      results[code].type = 'auto';
      results[code].status = status;
      results[code].justification = justification;
      results[code].findings = findings;
    }
  };

  // --- AUTOMATED RULES SCANNING ---

  // 1. Str5 (Technologies standards vs propriétaires)
  // Target: package.json, requirements.txt
  // Rule: Check dependencies.
  let str5Status = 'Validé';
  let str5Justification = 'Aucune technologie propriétaire ou non-standard majeure détectée dans les fichiers de dépendances.';
  const str5Findings = [];

  packageJsonFiles.forEach(f => {
    try {
      const pkg = JSON.parse(f.content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Look for specific closed or non-standard heavy packages, e.g., Flash, Silverlight, obsolete proprietary SDKs
      const legacyClosedTech = ['flash', 'silverlight', 'activex', 'proprietary-plugin-xyz'];
      legacyClosedTech.forEach(tech => {
        if (Object.keys(allDeps).some(dep => dep.includes(tech))) {
          str5Status = 'Non-Validé';
          str5Justification = `Détection de dépendances liées à des technologies fermées ou obsolètes (${tech}) dans ${f.relPath}.`;
          str5Findings.push(`Dépendance fermée/obsolète trouvée : ${tech} dans ${f.relPath}`);
        }
      });
      
      if (str5Findings.length === 0) {
        str5Findings.push(`Analyse de package.json (${f.relPath}) : ${Object.keys(allDeps).length} dépendances standards analysées (npm).`);
      }
    } catch (e) {
      str5Findings.push(`Erreur de parsing de package.json (${f.relPath})`);
    }
  });

  requirementsFiles.forEach(f => {
    str5Findings.push(`Fichier ${f.relPath} détecté. Utilisation de dépendances Python standard (pip).`);
  });

  if (packageJsonFiles.length === 0 && requirementsFiles.length === 0) {
    str5Status = 'Non-Validé';
    str5Justification = 'Aucun fichier de dépendance standard (package.json, requirements.txt) n\'a été détecté pour valider l\'utilisation de standards interopérables.';
    str5Findings.push('Aucun fichier package.json ou requirements.txt trouvé dans le projet.');
  }
  setAuto('Str5', str5Status, str5Justification, str5Findings);


  // 2. Spec1 (Profils de matériels cibles)
  // Target: package.json (browserslist), .browserslistrc, README.md, manifestes
  let spec1Status = 'Non-Validé';
  let spec1Justification = 'Aucune spécification de profils de matériels cibles ou de navigateurs n\'a été trouvée dans le projet.';
  const spec1Findings = [];

  // Check for browserslist
  const hasBrowserslist = packageJsonFiles.some(f => f.content.includes('"browserslist"')) || 
                           fileContents.some(f => f.name === '.browserslistrc');
  if (hasBrowserslist) {
    spec1Status = 'Validé';
    spec1Justification = 'Définition d\'une cible de terminaux/navigateurs via la configuration "browserslist" détectée.';
    spec1Findings.push('Configuration "browserslist" présente.');
  }

  // Check for README material description
  fileContents.filter(f => f.name.includes('readme')).forEach(f => {
    const readmeContent = f.content.toLowerCase();
    if (readmeContent.includes('matériel') || readmeContent.includes('hardware') || readmeContent.includes('navigateur') || readmeContent.includes('browser support') || readmeContent.includes('configuration requise') || readmeContent.includes('prerequisites')) {
      spec1Status = 'Validé';
      spec1Justification = 'Le README documente le support de matériels ou de navigateurs cibles.';
      spec1Findings.push(`Documentation de support matériel trouvée dans ${f.relPath}`);
    }
  });

  setAuto('Spec1', spec1Status, spec1Justification, spec1Findings);


  // 3. Spec2 & Spec3 (Compatibilité anciens terminaux & OS/navigateurs anciens)
  // Target: browserslist target range, polyfills, babel configurations
  let spec2Status = 'Non-Validé';
  let spec2Justification = 'Aucun mécanisme de rétrocompatibilité (Babel, polyfills, cible browserslist large) n\'a été identifié.';
  const spec2Findings = [];

  let spec3Status = 'Non-Validé';
  let spec3Justification = 'Aucun mécanisme de rétrocompatibilité (Babel, polyfills, cible browserslist large) n\'a été identifié.';
  const spec3Findings = [];

  packageJsonFiles.forEach(f => {
    try {
      const pkg = JSON.parse(f.content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      const polyfills = ['babel', 'core-js', 'postcss', 'polyfill', 'swc', 'tslib'];
      const foundPolyfills = polyfills.filter(p => Object.keys(allDeps).some(dep => dep.includes(p)));
      
      if (foundPolyfills.length > 0) {
        spec2Status = 'Validé';
        spec2Justification = `Présence de compilateurs/polyfills (${foundPolyfills.join(', ')}) pour supporter d'anciens terminaux.`;
        spec2Findings.push(`Outils de rétrocompatibilité détectés : ${foundPolyfills.join(', ')}`);
        
        spec3Status = 'Validé';
        spec3Justification = `Présence de compilateurs/polyfills (${foundPolyfills.join(', ')}) assurant le support d'anciennes versions d'OS/navigateurs.`;
        spec3Findings.push(`Outils de rétrocompatibilité détectés : ${foundPolyfills.join(', ')}`);
      }
    } catch(e) {}
  });

  setAuto('Spec2', spec2Status, spec2Justification, spec2Findings);
  setAuto('Spec3', spec3Status, spec3Justification, spec3Findings);


  // 4. Spec4 (Adaptabilité terminaux d'affichage / Responsive)
  // Target: CSS media queries, viewport meta tag in HTML
  let spec4Status = 'Non-Validé';
  let spec4Justification = 'Aucun élément d\'adaptabilité d\'affichage (responsive design) n\'a été trouvé dans le code CSS ou HTML.';
  const spec4Findings = [];

  // Check for viewport meta tag in HTML
  fileContents.filter(f => f.ext === '.html').forEach(f => {
    if (f.content.includes('<meta name="viewport"') || f.content.includes('width=device-width')) {
      spec4Status = 'Validé';
      spec4Justification = 'Balise meta viewport détectée pour l\'adaptation mobile et multi-écrans.';
      spec4Findings.push(`Balise <meta name="viewport"> trouvée dans ${f.relPath}`);
    }
  });

  // Check for media queries in CSS or HTML
  fileContents.filter(f => f.ext === '.css' || f.ext === '.html').forEach(f => {
    if (f.content.includes('@media') || f.content.includes('media-query') || f.content.includes('flexbox') || f.content.includes('grid-layout')) {
      spec4Status = 'Validé';
      spec4Justification = 'Utilisation de règles CSS adaptatives (@media queries, flexbox, grid) pour le responsive design.';
      spec4Findings.push(`Règles responsives/adaptatives détectées dans ${f.relPath}`);
    }
  });

  setAuto('Spec4', spec4Status, spec4Justification, spec4Findings);


  // 5. Spec5 (CI/CD, stratégie de maintenance & décommissionnement)
  // Target: YAML workflows, Dockerfiles, cleanup configs
  let spec5Status = 'Non-Validé';
  let spec5Justification = 'Aucune configuration CI/CD ou fichier Docker de déploiement n\'a été trouvé pour évaluer la stratégie de maintenance technique et de nettoyage.';
  const spec5Findings = [];

  const infraFiles = fileContents.filter(f => f.ext === '.yaml' || f.ext === '.yml' || f.name.toLowerCase() === 'dockerfile' || f.name.includes('docker-compose'));
  if (infraFiles.length > 0) {
    spec5Status = 'Validé';
    spec5Justification = 'Fichiers de configuration CI/CD ou d\'infrastructure détectés permettant d\'intégrer une stratégie de maintenance automatisée.';
    infraFiles.forEach(f => {
      let detail = `Fichier d'infrastructure trouvé : ${f.relPath}.`;
      if (f.content.includes('prune') || f.content.includes('clean') || f.content.includes('rm ') || f.content.includes('cache-from') || f.content.includes('minify')) {
        detail += ' Comporte des commandes de nettoyage/optimisation des ressources.';
      }
      spec5Findings.push(detail);
    });
  }

  setAuto('Spec5', spec5Status, spec5Justification, spec5Findings);


  // 6. Uxui1 (Désactivation lecture automatique médias)
  // Target: HTML, JS
  let uxui1Status = 'Validé';
  let uxui1Justification = 'Aucune balise de lecture automatique (autoplay) de contenu média n\'a été détectée dans le code.';
  const uxui1Findings = [];

  fileContents.filter(f => f.ext === '.html' || f.ext === '.js').forEach(f => {
    // Search for autoplay attribute in audio/video elements
    // E.g. <video autoplay ...> or autoplay in JS
    const autoplayRegex = /<(video|audio)[^>]*\bautoplay\b/gi;
    let match;
    while ((match = autoplayRegex.exec(f.content)) !== null) {
      uxui1Status = 'Non-Validé';
      uxui1Justification = 'Détection de lecture automatique (autoplay) pour des éléments multimédias, ce qui surconsomme des données et de l\'énergie sans contrôle utilisateur.';
      uxui1Findings.push(`Élément <${match[1]}> avec autoplay détecté dans ${f.relPath}`);
    }

    if (f.content.includes('.autoplay = true') || f.content.includes('autoplay: true')) {
      uxui1Status = 'Non-Validé';
      uxui1Justification = 'Détection de script activant l\'autoplay de médias.';
      uxui1Findings.push(`Script d'autoplay détecté dans ${f.relPath}`);
    }
  });

  setAuto('Uxui1', uxui1Status, uxui1Justification, uxui1Findings);


  // 7. Uxui2 (Absence de défilement infini)
  // Target: JS scroll listeners and libraries
  let uxui2Status = 'Validé';
  let uxui2Justification = 'Aucune implémentation de défilement infini (infinite scroll) n\'a été détectée.';
  const uxui2Findings = [];

  fileContents.filter(f => f.ext === '.js' || f.ext === '.jsx' || f.ext === '.tsx').forEach(f => {
    // Detect scroll listeners + bottom page checks typical of infinite scroll
    if (f.content.includes("scroll") && (f.content.includes("innerHeight") || f.content.includes("scrollHeight") || f.content.includes("scrollTop"))) {
      uxui2Status = 'Non-Validé';
      uxui2Justification = 'Détection d\'écouteurs d\'événements de scroll couplés à des calculs de hauteur de page (pattern typique de défilement infini), ce qui pousse à un chargement continu de ressources.';
      uxui2Findings.push(`Pattern d'écoute de scroll lourd détecté dans ${f.relPath}`);
    }

    const infiniteScrollKeywords = ['infinitescroll', 'infinite-scroll', 'react-infinite-scroll', 'scroll-bottom-load'];
    infiniteScrollKeywords.forEach(kw => {
      if (f.content.toLowerCase().includes(kw)) {
        uxui2Status = 'Non-Validé';
        uxui2Justification = `Détection de la bibliothèque ou du mot-clé de défilement infini "${kw}".`;
        uxui2Findings.push(`Mot-clé "${kw}" trouvé dans ${f.relPath}`);
      }
    });
  });

  setAuto('Uxui2', uxui2Status, uxui2Justification, uxui2Findings);


  // 8. Uxui3 (Notifications et possibilité de les désactiver)
  // Target: HTML/JS Notification APIs
  let uxui3Status = 'Validé';
  let uxui3Justification = 'Le service n\'utilise pas les APIs de notification système, limitant l\'envoi de requêtes réseau intempestives.';
  const uxui3Findings = [];

  fileContents.filter(f => f.ext === '.js' || f.ext === '.html').forEach(f => {
    if (f.content.includes('Notification.requestPermission') || f.content.includes('pushManager.subscribe') || f.content.includes('new Notification(')) {
      uxui3Status = 'Non-Validé';
      uxui3Justification = 'Le service numérique utilise les API de notifications ou de Push. Assurez-vous que l\'utilisateur peut facilement les désactiver.';
      uxui3Findings.push(`API de Notification système utilisée dans ${f.relPath}`);
    }
  });

  setAuto('Uxui3', uxui3Status, uxui3Justification, uxui3Findings);


  // 9. Cont1, Cont2, Cont3 (Vidéos adaptées, compressées et option écoute seule)
  // Target: Video elements in HTML. If none, these criteria are Non-Applicable (N/A)
  if (!hasVideos) {
    setAuto('Cont1', 'N/A', 'Le projet ne comporte aucun contenu vidéo détecté dans les fichiers HTML/JS.', ['Aucun tag <video> détecté.']);
    setAuto('Cont2', 'N/A', 'Le projet ne comporte aucun contenu vidéo détecté dans les fichiers HTML/JS.', ['Aucun tag <video> détecté.']);
    setAuto('Cont3', 'N/A', 'Le projet ne comporte aucun contenu vidéo détecté dans les fichiers HTML/JS.', ['Aucun tag <video> détecté.']);
  } else {
    // Cont1 - Vidéo adaptée
    let cont1Status = 'Non-Validé';
    let cont1Justification = 'Des balises vidéo sont présentes mais aucune source multiple (résolutions ou media-queries adaptées) n\'a été détectée.';
    const cont1Findings = [];

    fileContents.filter(f => f.ext === '.html').forEach(f => {
      if (f.content.includes('<video')) {
        cont1Findings.push(`Élément <video> trouvé dans ${f.relPath}`);
        // Check if multiple sources or responsive sources exist
        const sourceMatches = f.content.match(/<source/g);
        if (sourceMatches && sourceMatches.length > 1) {
          cont1Status = 'Validé';
          cont1Justification = 'Détection de multiples balises <source> dans les vidéos, suggérant l\'adaptation des formats selon la bande passante ou la taille d\'affichage.';
          cont1Findings.push(`${sourceMatches.length} balises <source> trouvées dans le fichier.`);
        }
      }
    });
    setAuto('Cont1', cont1Status, cont1Justification, cont1Findings);

    // Cont2 - Mode de compression efficace
    let cont2Status = 'Non-Validé';
    let cont2Justification = 'Des vidéos sont présentes mais n\'utilisent pas de codecs modernes et efficaces (WebM, AV1, H.265) dans les sources.';
    const cont2Findings = [];

    fileContents.filter(f => f.ext === '.html' || f.ext === '.js').forEach(f => {
      const modernCodecs = ['webm', 'av1', 'h265', 'hevc', 'vp9'];
      modernCodecs.forEach(codec => {
        if (f.content.toLowerCase().includes(codec)) {
          cont2Status = 'Validé';
          cont2Justification = `Utilisation de formats de compression vidéo modernes et frugaux (${codec}) détectée.`;
          cont2Findings.push(`Codec moderne "${codec}" référencé dans ${f.relPath}`);
        }
      });
    });
    setAuto('Cont2', cont2Status, cont2Justification, cont2Findings);

    // Cont3 - Mode écoute seule
    let cont3Status = 'Non-Validé';
    let cont3Justification = 'Aucune option d\'écoute seule (sans piste vidéo) n\'a été détectée pour les flux vidéo.';
    const cont3Findings = [];
    
    fileContents.filter(f => f.ext === '.html' || f.ext === '.js').forEach(f => {
      const audioOnlyKeywords = ['écoute seule', 'audio-only', 'audioonly', 'désactiver la vidéo', 'piste audio', 'sans vidéo', 'mute video'];
      audioOnlyKeywords.forEach(kw => {
        if (f.content.toLowerCase().includes(kw)) {
          cont3Status = 'Validé';
          cont3Justification = `Détection d'un contrôle ou d'un terme suggérant un mode d'écoute audio seule ("${kw}").`;
          cont3Findings.push(`Terminologie d'écoute seule trouvée : "${kw}" dans ${f.relPath}`);
        }
      });
    });
    setAuto('Cont3', cont3Status, cont3Justification, cont3Findings);
  }


  // 10. Bck2 (Système de cache serveur)
  // Target: Backend files, dependency files
  let bck2Status = 'Non-Validé';
  let bck2Justification = 'Aucun mécanisme de cache serveur (Redis, Memcached, cache HTTP, cache-manager) n\'a été identifié.';
  const bck2Findings = [];

  packageJsonFiles.forEach(f => {
    try {
      const pkg = JSON.parse(f.content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const cacheDeps = ['redis', 'memcached', 'cache-manager', 'node-cache', 'apc', 'varnish'];
      const found = cacheDeps.filter(d => Object.keys(allDeps).some(dep => dep.includes(d)));
      if (found.length > 0) {
        bck2Status = 'Validé';
        bck2Justification = `Dépendances de cache serveur trouvées dans package.json : ${found.join(', ')}.`;
        bck2Findings.push(`Bibliothèques de cache installées : ${found.join(', ')}`);
      }
    } catch(e){}
  });

  fileContents.filter(f => ['.js', '.py'].includes(f.ext)).forEach(f => {
    const cacheKeywords = ['redis.createClient', 'memcached', 'Cache-Control', 'max-age', 'getAsync(', 'setAsync('];
    cacheKeywords.forEach(kw => {
      if (f.content.includes(kw)) {
        bck2Status = 'Validé';
        bck2Justification = `Utilisation de l'API de cache serveur ("${kw}") détectée dans le code backend.`;
        bck2Findings.push(`Code de cache trouvé : "${kw}" dans ${f.relPath}`);
      }
    });
  });

  setAuto('Bck2', bck2Status, bck2Justification, bck2Findings);


  // 11. Bck3 (Durées de conservation et d'archivage des données)
  // Target: Server code, DB models, schema files
  let bck3Status = 'Non-Validé';
  let bck3Justification = 'Aucun mécanisme de conservation limitée ou de nettoyage des données obsolètes (TTL, archivage automatique, scripts de purge) n\'a été détecté.';
  const bck3Findings = [];

  fileContents.forEach(f => {
    if (f.content.includes('expireAfterSeconds') || f.content.includes('TTL') || f.content.includes('deleteMany') || f.content.includes('DELETE FROM') && f.content.includes('created_at') || f.content.includes('purge') || f.content.includes('cleanup') || f.content.includes('retention')) {
      bck3Status = 'Validé';
      bck3Justification = 'Mécanisme d\'archivage ou de suppression automatique détecté (TTL, requête de purge, cron job).';
      bck3Findings.push(`Pattern de rétention de données trouvé dans ${f.relPath}`);
    }
  });

  setAuto('Bck3', bck3Status, bck3Justification, bck3Findings);


  // 12. Frnt1 (Limite de poids et de requêtes par écran / Performance Budget)
  // Target: Build tools, package.json
  let frnt1Status = 'Non-Validé';
  let frnt1Justification = 'Aucune configuration de budget de performance (webpack performance, bundlewatch, size-limit) n\'a été identifiée.';
  const frnt1Findings = [];

  packageJsonFiles.forEach(f => {
    try {
      const pkg = JSON.parse(f.content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const budgetTools = ['size-limit', 'bundlewatch', 'webpack-bundle-analyzer', 'lighthouse-ci'];
      const found = budgetTools.filter(t => Object.keys(allDeps).some(dep => dep.includes(t)));
      if (found.length > 0) {
        frnt1Status = 'Validé';
        frnt1Justification = `Outils de budget de performance frontend ou d'analyse de bundles configurés : ${found.join(', ')}.`;
        frnt1Findings.push(`Outils de budget installés : ${found.join(', ')}`);
      }
    } catch(e){}
  });

  fileContents.forEach(f => {
    if (f.content.includes('performance') && f.content.includes('maxAssetSize') || f.content.includes('performance.hints') || f.content.includes('budget') && f.content.includes('path')) {
      frnt1Status = 'Validé';
      frnt1Justification = 'Configuration explicite de budget de performance détectée (ex: webpack maxAssetSize).';
      frnt1Findings.push(`Fichier de budget de bundle ou configuration trouvé dans ${f.relPath}`);
    }
  });

  setAuto('Frnt1', frnt1Status, frnt1Justification, frnt1Findings);


  // 13. Frnt2 (Mécanismes de mise en cache côté client / Service Workers)
  // Target: HTML, JS, Sw.js
  let frnt2Status = 'Non-Validé';
  let frnt2Justification = 'Aucun mécanisme de mise en cache client (Service Workers, Cache-Control Header, caches.open) n\'a été détecté.';
  const frnt2Findings = [];

  const hasServiceWorker = fileContents.some(f => f.name.includes('sw.js') || f.name.includes('service-worker') || f.content.includes('.register(\'/sw.js\'') || f.content.includes('navigator.serviceWorker.register'));
  if (hasServiceWorker) {
    frnt2Status = 'Validé';
    frnt2Justification = 'Utilisation d\'un Service Worker détectée pour le cache hors-ligne et client (PWA).';
    frnt2Findings.push('Service Worker ou script d\'enregistrement détecté.');
  }

  fileContents.forEach(f => {
    if (f.content.includes('caches.open') || f.content.includes('cacheName') || f.content.includes('cache-control') && f.content.includes('max-age')) {
      frnt2Status = 'Validé';
      frnt2Justification = 'Code d\'utilisation de cache client (CacheStorage API) ou en-têtes HTTP de cache détectés.';
      frnt2Findings.push(`API de cache client ou en-têtes trouvés dans ${f.relPath}`);
    }
  });

  setAuto('Frnt2', frnt2Status, frnt2Justification, frnt2Findings);


  // 14. Algo3 & Algo6 (Entraînement Machine Learning & Inférence frugale)
  // Target: ML libraries in Python/JS. If none, these are Non-Applicable (N/A)
  if (!hasML) {
    setAuto('Algo3', 'N/A', 'Le projet ne fait pas usage de modèles d\'intelligence artificielle ou de machine learning (TensorFlow, PyTorch, Scikit-learn non détectés).', ['Pas de librairies ML détectées.']);
    setAuto('Algo6', 'N/A', 'Le projet ne fait pas usage de modèles d\'intelligence artificielle ou de machine learning (TensorFlow, PyTorch, Scikit-learn non détectés).', ['Pas de librairies ML détectées.']);
  } else {
    // Algo3 - Limitation de l'entraînement
    let algo3Status = 'Non-Validé';
    let algo3Justification = 'Présence de librairies ML, mais aucune méthode de limitation de l\'entraînement (EarlyStopping, transfert de connaissances, modèles pré-entraînés) n\'a été formellement identifiée.';
    const algo3Findings = [];

    fileContents.filter(f => f.ext === '.py').forEach(f => {
      const reductionKeywords = ['EarlyStopping', 'early_stopping', 'pretrained=True', 'load_state_dict', 'transfer_learning', 'freeze_layers', 'checkpoint'];
      reductionKeywords.forEach(kw => {
        if (f.content.includes(kw)) {
          algo3Status = 'Validé';
          algo3Justification = `Mécanisme de limitation d'entraînement ou utilisation de modèle pré-entraîné détecté ("${kw}").`;
          algo3Findings.push(`Pattern d'entraînement économe trouvé : "${kw}" dans ${f.relPath}`);
        }
      });
    });
    setAuto('Algo3', algo3Status, algo3Justification, algo3Findings);

    // Algo6 - Inférence frugale
    let algo6Status = 'Non-Validé';
    let algo6Justification = 'Présence de librairies ML, mais aucune optimisation d\'inférence (quantification, élagage, ONNX, TFLite) n\'a été détectée.';
    const algo6Findings = [];

    fileContents.filter(f => f.ext === '.py' || f.ext === '.js').forEach(f => {
      const inferenceKeywords = ['quantize', 'quantization', 'prune', 'pruning', 'onnx', 'tfjs', 'tflite', 'tensorrt', 'convert_to_onnx'];
      inferenceKeywords.forEach(kw => {
        if (f.content.toLowerCase().includes(kw)) {
          algo6Status = 'Validé';
          algo6Justification = `Stratégie d'inférence optimisée détectée via quantification, élagage ou format optimisé ("${kw}").`;
          algo6Findings.push(`Pattern d'inférence économe trouvé : "${kw}" dans ${f.relPath}`);
        }
      });
    });
    setAuto('Algo6', algo6Status, algo6Justification, algo6Findings);
  }

  // --- LLM REFINEMENT PIPELINE ---
  if (llmConfig && llmConfig.analysisMode === 'llm') {
    const startTime = Date.now();
    const provider = llmConfig.llmProvider;
    const model = llmConfig.llmModel || (provider === 'local' ? 'qwen3:0.6b' : provider === 'openai' ? 'gpt-4o-mini' : provider === 'mistral' ? 'mistral-tiny' : 'claude-3-5-haiku');
    let responseText;

    try {
      console.log(`[Analyzer] Running LLM-assisted analysis using ${provider}...`);
      
      const projectContext = collectProjectContext(dirPath, fileContents);
      
      const llmTargetCodes = [
        'Str5', 'Spec1', 'Spec2', 'Spec3', 'Spec4', 'Spec5',
        'Uxui1', 'Uxui2', 'Uxui3', 'Cont1', 'Cont2', 'Cont3',
        'Bck2', 'Bck3', 'Frnt1', 'Frnt2', 'Algo3', 'Algo6'
      ];
      
      let fullRawOutput = "";
      
      // Loop sequentially through each criterion to prevent small models from collapsing
      for (const code of llmTargetCodes) {
        const initial = results[code];
        if (!initial) continue;
        
        const systemPrompt = `Tu es un auditeur expert du Référentiel Général d'Éco-conception de Services Numériques (RGESN).
Ton rôle est de valider ou corriger la pré-analyse statique (regex) pour UN SEUL critère : "${code}".
Voici le texte du critère à évaluer : "${initial.text}"

Tu dois renvoyer STRICTEMENT ET UNIQUEMENT un objet JSON valide pour ce critère, sans aucun texte explicatif avant ou après.

Format attendu pour ton JSON :
{
  "status": "Validé" | "Non-Validé" | "N/A" | "Manuel",
  "justification": "Explication critique et détaillée de ta décision basée sur les extraits de code fournis.",
  "findings": ["extrait 1", "extrait 2"]
}

CONSIGNES DE RIGUEUR EXTRÊME :
1. Ne valide pas paresseusement. Sois extrêmement critique : si le code manque de configuration ou présente un anti-pattern flagrant, retourne "Non-Validé". 
2. Si le projet n'utilise manifestement pas la fonctionnalité associée (ex: pas de vidéo pour les critères Cont1-3, pas d'IA pour Algo3-6), retourne "N/A".
3. Si les éléments ne te permettent pas de conclure avec certitude, utilise "Manuel".`;

        const userPrompt = `Détails structurels et extraits de fichiers du projet :
${projectContext}

Résultat de notre pré-analyse statique (Regex) pour le critère "${code}" :
- Statut pré-détecté : "${initial.status}"
- Justification initiale : "${initial.justification}"
- Indices (findings) trouvés : ${JSON.stringify(initial.findings)}

Analyse rigoureusement ces éléments pour ce critère uniquement. Renvoie l'objet JSON contenant "status", "justification" et "findings".`;

        let criterionRawOutput = "";
        try {
          criterionRawOutput = await queryLLM(llmConfig, systemPrompt, userPrompt);
          fullRawOutput += `--- Critère ${code} ---\n${criterionRawOutput}\n\n`;
          
          const parsedData = extractJson(criterionRawOutput);
          
          if (parsedData && parsedData.status) {
            results[code].status = parsedData.status;
            results[code].justification = `[Audit IA] ${parsedData.justification || initial.justification}`;
            results[code].findings = parsedData.findings && parsedData.findings.length > 0 ? parsedData.findings : initial.findings;
            results[code].type = ['Validé', 'Non-Validé', 'N/A'].includes(parsedData.status) ? 'auto' : 'manual';
          }
        } catch (critError) {
          console.error(`[Analyzer] Erreur d'analyse LLM pour le critère ${code}:`, critError);
          fullRawOutput += `--- Critère ${code} (ERREUR) ---\n${critError.message}\nOutput: ${criterionRawOutput}\n\n`;
        }
      }
      
      const duration = Date.now() - startTime;
      llmDiagnostic = {
        status: 'success',
        provider,
        model,
        responseTime: duration,
        rawOutput: fullRawOutput.trim()
      };
      console.log(`[Analyzer] LLM-assisted multi-query analysis completed successfully in ${duration}ms!`);
      
    } catch (llmError) {
      console.error(`[Analyzer] LLM analysis failed, falling back to Classical Static Analysis. Error:`, llmError);
      const duration = Date.now() - startTime;
      llmDiagnostic = {
        status: 'failed',
        provider,
        model,
        responseTime: duration,
        error: llmError.message || String(llmError),
        rawOutput: typeof fullRawOutput !== 'undefined' ? fullRawOutput : "Aucune réponse reçue du modèle."
      };
    }
  }

  // --- MANUAL DECLARATION CRITERIA ---
  // The rest of the criteria (such as Acc1-5, Heb1-3, Str1-4, Spec6-7, Arch1-2, etc.) remain as 'Manuel'
  // by default so they can be set by the user.

  return { criteria: results, llmDiagnostic };
}

module.exports = {
  analyzeDirectory
};
