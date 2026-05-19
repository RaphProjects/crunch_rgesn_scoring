const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const excelPath = path.join(__dirname, 'Référentiel critères prioritaires RGESN.xlsx');
const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

console.log(`Total parsed objects: ${data.length}`);

// Map the keys dynamically and filter out rows that don't have a Code
const criteria = data
  .map(row => {
    const code = row['Code'] || row['code'] || '';
    const category = row['Catégorie'] || row['catégorie'] || '';
    const priority = row['Priorité (selon le RGESN)'] || row['Priorité'] || '';
    const target = row['Cible'] || '';
    const role = row['Métier'] || '';
    const text = row['Critère'] || '';
    const difficulty = row['Difficulté'] || '';
    const objective = row['Objectif'] || '';
    // Map resources to GR491 column
    const resources = row['GR491'] || row['Ressources externes'] || row['Ressources'] || '';
    
    return {
      code: String(code).trim(),
      category: String(category).trim(),
      priority: String(priority).trim(),
      target: String(target).trim(),
      role: String(role).trim(),
      text: String(text).trim(),
      difficulty: String(difficulty).trim(),
      objective: String(objective).trim(),
      resources: String(resources).trim()
    };
  })
  .filter(c => c.code && c.code !== 'undefined' && c.code.length >= 3);

console.log(`Total valid criteria extracted: ${criteria.length}`);
console.log("Sample valid criteria with resources:", criteria.filter(c => c.resources).slice(0, 3));

fs.writeFileSync(
  path.join(__dirname, 'rgesn_criteria.json'), 
  JSON.stringify(criteria, null, 2), 
  'utf-8'
);

console.log("Successfully exported to rgesn_criteria.json!");
