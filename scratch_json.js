const fs = require('fs');

const jsonText = `{
  "status": "Validé",
  "justification": "test",
  "findings": [
    "item 1"
    "item 2"
  ]
}
{
  "a": "b"
}`;

let cleanText = jsonText;
// fix missing commas
cleanText = cleanText.replace(/"(\s*[\n\r]+\s*)"/g, '",$1"');
cleanText = cleanText.replace(/}(\s*[\n\r]+\s*){/g, '},$1{');
cleanText = cleanText.replace(/](\s*[\n\r]+\s*)\[/g, '],$1[');
cleanText = cleanText.replace(/"(\s*[\n\r]+\s*){/g, '",$1{');
cleanText = cleanText.replace(/}(\s*[\n\r]+\s*)"/g, '},$1"');
cleanText = cleanText.replace(/](\s*[\n\r]+\s*)"/g, '],$1"');
cleanText = cleanText.replace(/"(\s*[\n\r]+\s*)\[/g, '",$1[');
cleanText = cleanText.replace(/}(\s*[\n\r]+\s*)\[/g, '},$1[');
cleanText = cleanText.replace(/](\s*[\n\r]+\s*){/g, '],$1{');

console.log(cleanText);
try { JSON.parse('[' + cleanText + ']') } catch (e) { console.error(e.message) }
