const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../js/core/project.js');
const { validateProject } = require('../js/core/validate.js');
const ops = require('../js/core/ops.js');
const { loadDir } = require('./helpers.js');

const open = (dir) => Project.fromFiles(loadDir(dir), 'openapi.yaml');
const codes = (r) => r.diagnostics.map((d) => d.code);

test('caso 1: contrato simple con un endpoint y schema inline es valido', () => {
  const p = open('01-simple');
  const r = validateProject(p);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
  const m = p.getModel();
  assert.equal(m.paths.length, 1);
  assert.equal(m.paths[0].methods[0].operationId, 'obtenerNota');
});

test('caso 2: contrato fragmentado (espacios/unicode, refs circulares y refs de vuelta al raiz) valida sin errores', () => {
  const p = open('02-fragmentado');
  const r = validateProject(p);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), []);
  assert.ok(p.files.has('Módulos comunes/error básico.yaml'));
  assert.equal(p.refIndex().filter((x) => x.error).length, 0);
  const m = p.getModel();
  assert.equal(m.paths.length, 4);
  assert.equal(m.components.schemas.length, 7);
  assert.ok(r.bundle.cycles > 0, 'se detecta la referencia circular de Categoria');
  // el bundle resuelve todo: no queda ningun $ref a fichero externo
  assert.ok(!/\$ref: \.{0,2}\//.test(r.bundle.doc.toString()));
});

test('caso 3: referencia rota y YAML invalido se localizan con fichero, linea y ruta', () => {
  const p = open('03-roto');
  const r = validateProject(p);
  const broken = r.diagnostics.find((d) => d.code === 'ref-missing-file');
  assert.ok(broken);
  assert.equal(broken.file, 'openapi.yaml');
  assert.ok(broken.line > 1);
  assert.deepEqual(broken.path.slice(-2), ['schema', '$ref']);
  const syntax = r.diagnostics.find((d) => d.code === 'yaml-syntax');
  assert.equal(syntax.file, 'schemas/mal-formado.yaml');
  assert.ok(syntax.line >= 3 && syntax.col >= 1);
  const missingPtr = r.diagnostics.find((d) => d.code === 'ref-missing-pointer');
  assert.ok(missingPtr && /Usuarios/.test(missingPtr.message));
  for (const c of ['opid-duplicate', 'path-param-missing', 'response-code', 'tag-undefined']) assert.ok(codes(r).includes(c), c);
  assert.ok(r.diagnostics.some((d) => d.code === 'oas-additionalProperties' && /campoDesconocido/.test(d.message)));
  assert.ok(r.diagnostics.every((d) => d.message && d.severity));
});

test('caso 4: nuevo endpoint con parametro de path lo declara obligatorio; sin declararlo se avisa', () => {
  const p = open('01-simple');
  ops.addOperation(p, '/etiquetas/{etiquetaId}', 'get', { tags: ['notas'] });
  let r = validateProject(p);
  assert.equal(r.diagnostics.filter((d) => d.severity === 'error').length, 0);
  const prm = p.read(['paths', '/etiquetas/{etiquetaId}', 'get', 'parameters', 0], true);
  assert.equal(prm.in, 'path'); assert.equal(prm.required, true);
  // quitar el parametro -> aviso accionable
  p.mutate('quitar', (tx) => tx.del(['paths', '/etiquetas/{etiquetaId}', 'get', 'parameters']));
  r = validateProject(p);
  const d = r.diagnostics.find((x) => x.code === 'path-param-missing');
  assert.ok(d && /etiquetaId/.test(d.message) && d.suggestion);
  // parametro declarado con required false -> error
  p.mutate('mal', (tx) => tx.set(['paths', '/etiquetas/{etiquetaId}', 'get', 'parameters'], [{ name: 'etiquetaId', in: 'path', required: false, schema: { type: 'string' } }]));
  assert.ok(codes(validateProject(p)).includes('path-param-required'));
});

test('caso 5: duplicar endpoint genera operationId unico', () => {
  const p = open('02-fragmentado');
  ops.duplicateOperation(p, '/productos', 'get', { toRoute: '/productos/destacados', toMethod: 'get' });
  const opId = p.read(['paths', '/productos/destacados', 'get', 'operationId'], true);
  assert.equal(opId, 'listarProductosCopia');
  ops.duplicateOperation(p, '/productos', 'get', { toRoute: '/productos/nuevos', toMethod: 'get' });
  assert.equal(p.read(['paths', '/productos/nuevos', 'get', 'operationId'], true), 'listarProductosCopia2');
  const r = validateProject(p);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), []);
  // los $ref relativos del fragment original siguen resolviendo desde la nueva ubicacion (raiz)
  assert.equal(p.refIndex().filter((x) => x.error).length, 0);
});

test('caso 6: editar un schema compartido mantiene todas las referencias resolviendo', () => {
  const p = open('02-fragmentado');
  const before = p.usagesOfLogical(['components', 'schemas', 'Producto']).length;
  assert.ok(before >= 4, 'Producto se usa desde varias operaciones');
  ops.addProperty(p, ['components', 'schemas', 'Producto'], 'sku', { type: 'string', maxLength: 20 }, true);
  ops.renameComponent(p, 'schemas', 'Producto', 'Articulo');
  assert.equal(p.refIndex().filter((x) => x.error).length, 0);
  assert.equal(p.usagesOfLogical(['components', 'schemas', 'Articulo']).length, before);
  const r = validateProject(p);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), []);
  assert.deepEqual(p.read(['components', 'schemas', 'Articulo', 'required'], true), ['id', 'nombre', 'precio', 'sku']);
});

test('caso 6b: renombrar un schema reescribe $ref en el raiz, en fragments y en discriminator.mapping', () => {
  const p = Project.fromFiles({
    'openapi.yaml': 'openapi: 3.0.3\ninfo: {title: t, version: "1"}\npaths:\n  /a:\n    $ref: ./a.yaml\ncomponents:\n  schemas:\n    Animal:\n      type: object\n      discriminator:\n        propertyName: t\n        mapping:\n          perro: "#/components/schemas/Perro"\n    Perro:\n      type: object\n',
    'a.yaml': 'get:\n  responses:\n    "200":\n      description: ok\n      content:\n        application/json:\n          schema:\n            $ref: "./openapi.yaml#/components/schemas/Perro"\n'
  }, 'openapi.yaml');
  ops.renameComponent(p, 'schemas', 'Perro', 'Can');
  const t = p.texts();
  assert.match(t.get('a.yaml'), /openapi\.yaml#\/components\/schemas\/Can/);
  assert.match(t.get('openapi.yaml'), /perro: "#\/components\/schemas\/Can"/);
  assert.equal(p.refIndex().filter((x) => x.error).length, 0);
});

test('caso 7: eliminar un schema usado exige confirmacion y lista consumidores', () => {
  const p = open('02-fragmentado');
  assert.throws(() => ops.deleteComponent(p, 'schemas', 'Error'), (e) => Array.isArray(e.consumers) && e.consumers.length >= 3 && !!e.consumers[0].label);
  assert.ok(p.read(['components', 'schemas', 'Error'], false), 'no se ha eliminado');
  ops.deleteComponent(p, 'schemas', 'Error', { force: true });
  const r = validateProject(p);
  assert.ok(r.diagnostics.some((d) => d.severity === 'error' && d.code.startsWith('ref-')), 'quedan referencias rotas explicadas');
  p.undo();
  assert.equal(validateProject(p).diagnostics.filter((d) => d.severity === 'error').length, 0);
});

test('caso 13: editar una extension x-* la conserva al guardar (fichero unico y fragments)', () => {
  const p = open('02-fragmentado');
  p.mutate('x', (tx) => { tx.set(['info', 'x-owner'], 'otro-equipo'); tx.set(['components', 'schemas', 'Producto', 'x-internal-name'], 'Nuevo'); });
  const t = p.texts();
  assert.match(t.get('openapi.yaml'), /x-owner: otro-equipo # extension propietaria/);
  assert.match(t.get('schemas/producto.yaml'), /x-internal-name: Nuevo/);
});

test('caso 14: cancelar/rechazar cambios no pierde el trabajo y YAML invalido queda como borrador', () => {
  const p = open('01-simple');
  ops.addOperation(p, '/x', 'get');
  assert.equal(p.isDirty(), true);
  const snapshot = p.texts().get('openapi.yaml');
  // edicion YAML invalida: no sustituye el modelo, se conserva como borrador
  const res = p.setFileText('openapi.yaml', snapshot + '\nfoo: [sin cerrar');
  assert.equal(res.ok, false);
  assert.equal(p.texts().get('openapi.yaml'), snapshot);
  assert.ok(p.hasDraft());
  assert.equal(p.file('openapi.yaml').draft.errors[0].line >= 1, true);
  // cancelar el borrador vuelve al ultimo estado valido sin perder los cambios sin guardar
  p.discardDraft('openapi.yaml');
  assert.equal(p.hasDraft(), false);
  assert.equal(p.texts().get('openapi.yaml'), snapshot);
  assert.equal(p.isDirty(), true);
  p.undo(); p.redo();
  assert.equal(p.texts().get('openapi.yaml'), snapshot);
});
