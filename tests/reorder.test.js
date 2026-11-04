const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../js/core/project.js');
const ops = require('../js/core/ops.js');
const { loadDir } = require('./helpers.js');

// Hipotesis falsable: el explorador refleja el orden del contrato y reordenar solo mueve la clave.
test('el modelo conserva el orden de aparicion de rutas y schemas', () => {
  const p = Project.fromFiles(loadDir('02-fragmentado'), 'openapi.yaml');
  const m = p.getModel();
  assert.deepEqual(m.paths.map((x) => x.path), ['/productos', '/productos/{productoId}', '/pedidos', '/pedidos/{pedidoId}']);
  assert.equal(m.files[0].path, 'openapi.yaml');
  // los ficheros siguen el orden en que se referencian desde el raiz
  assert.ok(m.files.findIndex((f) => f.path === 'paths/productos.yaml') < m.files.findIndex((f) => f.path === 'paths/pedidos.yaml'));
});

test('movePath / moveComponent / moveTag reordenan y se pueden deshacer', () => {
  const p = Project.fromFiles(loadDir('02-fragmentado'), 'openapi.yaml');
  const before = p.texts().get('openapi.yaml');
  ops.movePath(p, '/pedidos', '/productos', false);
  assert.deepEqual(p.getModel().paths.map((x) => x.path), ['/pedidos', '/productos', '/productos/{productoId}', '/pedidos/{pedidoId}']);
  ops.movePath(p, '/pedidos', '/pedidos/{pedidoId}', true);
  assert.deepEqual(p.getModel().paths.map((x) => x.path), ['/productos', '/productos/{productoId}', '/pedidos/{pedidoId}', '/pedidos']);
  ops.moveTag(p, 'pedidos', 'productos', false);
  assert.deepEqual(p.read(['tags']).map((t) => t.name), ['pedidos', 'productos']);
  const schemas = p.getModel().components.schemas.map((c) => c.name);
  ops.moveComponent(p, 'schemas', schemas[schemas.length - 1], schemas[0], false);
  const now = p.getModel().components.schemas.map((c) => c.name);
  assert.deepEqual(now, [schemas[schemas.length - 1]].concat(schemas.slice(0, -1)));
  // mover sobre la misma posicion no genera historial
  const depth = p.past.length;
  ops.movePath(p, '/productos', '/productos/{productoId}', false);
  assert.equal(p.past.length, depth);
  while (p.canUndo()) p.undo();
  assert.equal(p.texts().get('openapi.yaml'), before);
});

test('moveMethod reordena los metodos de una ruta', () => {
  const p = Project.fromFiles(new Map([['openapi.yaml', 'openapi: 3.0.3\ninfo: {title: t, version: "1"}\npaths:\n  /a:\n    get: {responses: {"200": {description: ok}}}\n    # comentario de post\n    post: {responses: {"200": {description: ok}}}\n']]), 'openapi.yaml');
  ops.moveMethod(p, '/a', 'post', 'get', false);
  assert.deepEqual(p.getModel().paths[0].methods.map((m) => m.method), ['post', 'get']);
  assert.match(p.texts().get('openapi.yaml'), /# comentario de post\n\s+post:/);
});

test('el comentario del primer elemento viaja con el al reordenar', () => {
  const p = Project.fromFiles(new Map([['openapi.yaml', 'openapi: 3.0.3\ninfo: {title: t, version: "1"}\npaths:\n  # comentario a\n  /a: {}\n  # comentario b\n  /b: {}\ntags:\n  # tag a\n  - name: a\n  - name: b\n']]), 'openapi.yaml');
  ops.movePath(p, '/a', '/b', true);
  assert.match(p.texts().get('openapi.yaml'), /paths:\n  # comentario b\n  \/b: \{\}\n  # comentario a\n  \/a: \{\}/);
  ops.moveTag(p, 'b', 'a', false);
  assert.match(p.texts().get('openapi.yaml'), /tags:\n  - name: b\n  # tag a\n  - name: a/);
});

test('moveMethod en un path item de otro fichero solo toca el fragmento', () => {
  const p = Project.fromFiles(loadDir('02-fragmentado'), 'openapi.yaml');
  const route = p.getModel().paths.find((x) => x.methods.length > 1 && x.file !== 'openapi.yaml');
  assert.ok(route, 'el ejemplo debe tener una ruta con varios metodos en un fragmento');
  const before = p.texts();
  const [m0, m1] = route.methods.map((m) => m.method);
  ops.moveMethod(p, route.path, m1, m0, false);
  assert.deepEqual(p.getModel().paths.find((x) => x.path === route.path).methods.slice(0, 2).map((m) => m.method), [m1, m0]);
  const changed = [...p.texts()].filter(([k, v]) => before.get(k) !== v).map(([k]) => k);
  assert.deepEqual(changed, [route.file]);
});
