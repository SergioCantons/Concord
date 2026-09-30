// Genera vendor/oat-vendor.js (yaml + ajv + esquema OAS 3.0 + fflate) y vendor/icons.js (lucide).
// Usa esbuild-wasm porque el binario nativo de esbuild puede no descargarse en redes restringidas.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild-wasm');

const root = path.join(__dirname, '..');
const ICONS = [
  'file-plus', 'folder-open', 'file-up', 'save', 'undo-2', 'redo-2', 'shield-check', 'git-compare', 'settings',
  'search', 'plus', 'trash-2', 'copy', 'chevron-up', 'chevron-down', 'chevron-right', 'x', 'check', 'alert-triangle',
  'alert-circle', 'info', 'file-code', 'files', 'route', 'braces', 'box', 'server', 'tags', 'lock', 'link', 'external-link',
  'download', 'upload', 'arrow-left-right', 'pencil', 'refresh-cw', 'layers', 'list', 'filter', 'circle-dot', 'history',
  'package', 'file-text', 'archive', 'scissors', 'move', 'panel-left', 'crosshair', 'loader', 'clock', 'folder', 'file', 'sun', 'moon'
];

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'vendor-src', 'entry.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'OATVendor',
    platform: 'browser',
    target: 'es2019',
    outfile: path.join(root, 'vendor', 'oat-vendor.js'),
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' }
  });

  const icons = {};
  for (const name of ICONS) {
    const file = path.join(root, 'node_modules', 'lucide-static', 'icons', name + '.svg');
    if (!fs.existsSync(file)) { console.warn('Icono no encontrado:', name); continue; }
    icons[name] = fs.readFileSync(file, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+class="[^"]*"/, '')
      .replace(/\s+width="24"\s+height="24"/, '')
      .trim();
  }
  fs.writeFileSync(path.join(root, 'vendor', 'icons.js'),
    '// Iconos Lucide (ISC) incluidos localmente.\nwindow.OAT_ICONS = ' + JSON.stringify(icons) + ';\n');
  console.log('vendor generado:', Object.keys(icons).length, 'iconos');
}

main().catch((e) => { console.error(e); process.exit(1); });
