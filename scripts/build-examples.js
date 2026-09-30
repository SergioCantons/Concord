// Genera js/ui/examples-data.js a partir de examples/ (los ejemplos se incrustan porque file:// no permite leer ficheros).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const defs = [
  { key: 'fragmentado', dir: '02-fragmentado', title: 'Ejemplo: API de Tienda (fragmentada)' },
  { key: 'simple', dir: '01-simple', title: 'Ejemplo: API de notas (un solo fichero)' },
  { key: 'roto', dir: '03-roto', title: 'Ejemplo: contrato con errores' },
  { key: 'cambiado', dir: '04-cambiado', title: 'Ejemplo: API de Tienda v1.3 (un solo fichero, con cambios)' }
];

function walk(base, dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(base, full, out);
    else if (/\.(ya?ml|json)$/i.test(e.name)) out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

const data = {};
for (const d of defs) data[d.key] = { title: d.title, root: 'openapi.yaml', files: walk(path.join(root, 'examples', d.dir), path.join(root, 'examples', d.dir), {}) };
fs.writeFileSync(path.join(root, 'js', 'ui', 'examples-data.js'), '// Generado por scripts/build-examples.js\nwindow.OAT = window.OAT || {};\nwindow.OAT.EXAMPLES = ' + JSON.stringify(data) + ';\n');
console.log('ejemplos incrustados:', Object.keys(data).join(', '));
