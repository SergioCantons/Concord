// Genera src/domain/core-bridge.mjs: el núcleo CommonJS (js/core) empaquetado como módulo ES para la vista previa React.
// Es un artefacto local (no versionado); su contrato tipado está en src/domain/core-bridge.d.mts.
// El núcleo no se modifica, así que la aplicación actual (index.html) y las pruebas de Node siguen igual.
const path = require('path');
const esbuild = require('esbuild-wasm');

const root = path.join(__dirname, '..');

esbuild.build({
  stdin: {
    contents: "import core from './js/core/project.js';\nexport const { Project } = core;\n",
    resolveDir: root,
    sourcefile: 'core-bridge-entry.js'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(root, 'src', 'domain', 'core-bridge.mjs'),
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning'
}).catch((e) => { console.error(e); process.exit(1); });
