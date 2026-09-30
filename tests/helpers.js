const fs = require('fs');
const path = require('path');

const EXAMPLES = path.join(__dirname, '..', 'examples');

/** Carga un directorio de ejemplo como Map ruta-relativa -> texto (separador '/'). */
function loadDir(name) {
  const base = path.join(EXAMPLES, name);
  const out = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ya?ml|json)$/i.test(e.name)) out.set(path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
    }
  })(base);
  return out;
}

module.exports = { loadDir, EXAMPLES };
