const fs = require('fs');
const src = fs.readFileSync('/home/invincible/projects/cli-ad-demo/tests/db/contacts.test.js', 'utf8');
let depth = 0;
let inStr = false;
let inTpl = false;
let q = null;
const lines = src.split('\n');
for (let ln = 0; ln < lines.length; ln++) {
  const line = lines[ln];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inTpl) {
      if (c === '`') inTpl = false;
      continue;
    }
    if (inStr) {
      if (c === q && line[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '`') {
      inTpl = true;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      q = c;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') {
      depth++;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth < 0) {
        console.log('negative at line', ln + 1, 'char', c);
        process.exit(1);
      }
    }
  }
  if (depth < 0) {
    console.log('negative at line', ln + 1);
    process.exit(1);
  }
}
console.log('final depth:', depth);
// Report unclosed blocks