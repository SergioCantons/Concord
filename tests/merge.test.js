const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../js/core/project.js');
const { compareProjects } = require('../js/core/compare.js');
const { applyChanges, planChanges } = require('../js/core/merge.js');
const { loadDir } = require('./helpers.js');

const open = (dir) => Project.fromFiles(loadDir(dir), 'openapi.yaml');
const brokenRefs = (p) => p.refIndex().filter((r) => r.error).length;

// Hipotesis falsable: aplicar todos los cambios en cualquier sentido deja los dos contratos semanticamente iguales,
// sin referencias rotas, aunque uno sea multi-fichero y el otro un fichero unico.
test('fusionar todos los cambios en cualquier sentido iguala los contratos', () => {
  const pairs = [['02-fragmentado', '04-cambiado'], ['04-cambiado', '02-fragmentado'], ['01-simple', '02-fragmentado'], ['02-fragmentado', '01-simple']];
  for (const [a, b] of pairs) {
    for (const fromNext of [true, false]) {
      const base = open(a); const next = open(b);
      const r = compareProjects(base, next);
      const target = fromNext ? base : next; const source = fromNext ? next : base;
      const untouched = (fromNext ? next : base).texts();
      const res = applyChanges(target, source, r.changes, { fromNext });
      assert.equal(res.skipped.length, 0, a + '->' + b);
      assert.equal(res.brokenRefs, 0, a + '->' + b);
      assert.equal(brokenRefs(target), 0);
      assert.deepEqual(compareProjects(base, next).changes.map((c) => c.title), [], a + ' / ' + b + ' fromNext=' + fromNext);
      assert.deepEqual(source.texts(), untouched, 'el origen no se modifica');
      // un solo paso de deshacer
      assert.equal(target.past.length, 1);
    }
  }
});

test('una operacion nueva arrastra los componentes que necesita y se deshace en un paso', () => {
  const base = open('01-simple'); const next = open('02-fragmentado');
  const before = base.texts();
  const r = compareProjects(base, next);
  const c = r.changes.find((x) => x.kind === 'added' && x.route === '/productos' && x.method === 'get');
  const res = applyChanges(base, next, [c], { fromNext: true });
  assert.deepEqual(res.applied, [c.id]);
  assert.ok(res.deps.includes('schemas/Producto'));
  assert.ok(res.deps.includes('parameters/Limite'));
  assert.equal(brokenRefs(base), 0);
  const after = compareProjects(base, next);
  assert.ok(!after.changes.some((x) => x.route === '/productos' && x.method === 'get'));
  // el resto de diferencias sigue ahi
  assert.ok(after.changes.some((x) => x.route === '/pedidos'));
  base.undo();
  assert.deepEqual(base.texts(), before);
});

test('"deshacer" un cambio en el comparado: recupera la operacion eliminada sin tocar el base', () => {
  const base = open('02-fragmentado'); const next = open('04-cambiado');
  const r = compareProjects(base, next);
  const c = r.changes.find((x) => x.kind === 'removed' && x.method === 'delete');
  const baseBefore = base.texts();
  applyChanges(next, base, [c], { fromNext: false });
  assert.deepEqual(base.texts(), baseBefore);
  assert.match(next.texts().get('openapi.yaml'), /delete:/);
  assert.ok(!compareProjects(base, next).changes.some((x) => x.method === 'delete'));
  assert.equal(brokenRefs(next), 0);
});

test('los cambios en schemas compartidos se escriben en su fragmento con referencias relativas validas', () => {
  const base = open('02-fragmentado'); const next = open('04-cambiado');
  const r = compareProjects(base, next);
  const cs = r.changes.filter((x) => x.schema === 'Producto');
  const plan = planChanges(base, next, cs, { fromNext: true });
  assert.ok(plan.every((p) => p.scope && p.scope.startsWith('components.schemas.Producto')));
  const before = base.texts();
  applyChanges(base, next, cs, { fromNext: true });
  const changed = [...base.texts()].filter(([k, v]) => before.get(k) !== v).map(([k]) => k);
  assert.deepEqual(changed, ['schemas/producto.yaml']);
  assert.match(base.texts().get('schemas/producto.yaml'), /# Schema compartido por varias operaciones/);
  assert.equal(brokenRefs(base), 0);
});

test('parametros: se sustituye solo el parametro afectado', () => {
  const base = open('02-fragmentado'); const next = open('04-cambiado');
  const r = compareProjects(base, next);
  const c = r.changes.find((x) => x.pathText.includes('query:categoria'));
  const plan = planChanges(base, next, [c], { fromNext: true });
  assert.match(plan[0].scope, /parámetro query:categoria/);
  applyChanges(base, next, [c], { fromNext: true });
  const left = compareProjects(base, next).changes;
  assert.ok(!left.some((x) => x.pathText.includes('query:categoria')));
  assert.equal(left.length, r.changes.length - 1);
});

test('los errores y los elementos sin cambios no se trasladan', () => {
  const base = open('01-simple'); const next = open('01-simple');
  const res = applyChanges(base, next, [{ id: 'E1', kind: 'error', path: [] }], { fromNext: true });
  assert.deepEqual(res.applied, []);
  assert.equal(res.skipped.length, 1);
  assert.equal(base.past.length, 0);
});

test('renombrados y operaciones movidas se trasladan en ambos sentidos', () => {
  const mk = (schema, route) => Project.fromFiles({ 'openapi.yaml': 'openapi: 3.0.3\ninfo: {title: t, version: "1"}\npaths:\n  ' + route + ':\n    get:\n      operationId: listar\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema: {$ref: "#/components/schemas/' + schema + '"}\ncomponents:\n  schemas:\n    ' + schema + ': {type: object, properties: {id: {type: string}}}\n' }, 'openapi.yaml');
  for (const fromNext of [true, false]) {
    const base = mk('Antiguo', '/a'); const next = mk('Nuevo', '/b');
    const r = compareProjects(base, next);
    assert.ok(['moved', 'renamed'].every((k) => r.changes.some((c) => c.kind === k)));
    const target = fromNext ? base : next;
    const res = applyChanges(target, fromNext ? next : base, r.changes, { fromNext });
    assert.equal(res.applied.length, r.changes.length);
    assert.deepEqual(compareProjects(base, next).changes, []);
    assert.equal(brokenRefs(target), 0);
  }
});

const one = (yaml) => Project.fromFiles({ 'openapi.yaml': 'openapi: 3.0.3\ninfo: {title: t, version: "1"}\n' + yaml }, 'openapi.yaml');
const mergeAll = (base, next, fromNext = true) => applyChanges(fromNext ? base : next, fromNext ? next : base, compareProjects(base, next).changes, { fromNext });
const op = (extra) => 'paths:\n  /a:\n    get:\n      responses:\n        "200":\n          description: ok\n' + (extra || '');

test('quitar varios elementos de una lista no deja elementos sueltos', () => {
  const mk = (ex) => one(op('          content:\n            application/json:\n              example: ' + ex + '\n'));
  const base = mk('[1, 2, 3, 4, 5]'); const next = mk('[1, 2, 3]');
  mergeAll(base, next);
  assert.deepEqual(compareProjects(base, next).changes, []);
});

test('anadir o quitar una propiedad lleva consigo su obligatoriedad', () => {
  const mk = (props, req) => one('paths: {}\ncomponents:\n  schemas:\n    S:\n      type: object\n      required: [' + req + ']\n      properties:\n' + props);
  const base = mk('        a: {type: string}\n', 'a'); const next = mk('        a: {type: string}\n        b: {type: string}\n', 'a, b');
  mergeAll(base, next);
  assert.deepEqual(base.read(['components', 'schemas', 'S', 'required']), ['a', 'b']);
  assert.deepEqual(compareProjects(base, next).changes, []);
  const b2 = mk('        a: {type: string}\n        b: {type: string}\n', 'a, b'); const n2 = mk('        a: {type: string}\n', 'a');
  mergeAll(b2, n2);
  assert.deepEqual(b2.read(['components', 'schemas', 'S', 'required']), ['a']);
});
const open01 = () => open('01-simple');

test('un cambio interno de una operacion movida no se aplica suelto (no crea operaciones incompletas)', () => {
  const mk = (route, summary) => one('paths:\n  ' + route + ':\n    get:\n      operationId: op\n      summary: ' + summary + '\n      responses:\n        "200": {description: ok}\n');
  const base = mk('/a', 'uno'); const next = mk('/b', 'dos');
  const r = compareProjects(base, next);
  const inner = r.changes.filter((c) => c.kind !== 'moved');
  assert.ok(inner.length);
  const res = applyChanges(base, next, inner, { fromNext: true });
  assert.equal(res.applied.length, 0);
  assert.equal(base.past.length, 0);
});

test('parametros repartidos entre ruta y operacion no se duplican', () => {
  const base = one('paths:\n  /a:\n    parameters:\n      - {name: x, in: query, schema: {type: string}, description: v1}\n    get:\n      parameters:\n        - {name: x, in: query, schema: {type: string}, description: v2}\n      responses:\n        "200": {description: ok}\n');
  const next = one('paths:\n  /a:\n    parameters:\n      - {name: x, in: query, schema: {type: string}, description: v3}\n    get:\n      responses:\n        "200": {description: ok}\n');
  mergeAll(base, next);
  assert.equal(base.read(['paths', '/a', 'parameters']).length, 1);
  assert.equal(base.read(['paths', '/a', 'get', 'parameters']), undefined);
  assert.deepEqual(compareProjects(base, next).changes, []);
});

test('discriminator.mapping se reescribe y copia sus componentes; los $ref dentro de ejemplos no se tocan', () => {
  const base = one('paths: {}\ncomponents:\n  schemas: {}\n');
  const next = Project.fromFiles({
    'openapi.yaml': 'openapi: 3.0.3\ninfo: {title: t, version: "1"}\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: schemas/pet.yaml\n    Cat:\n      type: object\n      example: {$ref: "#/components/schemas/NoExiste"}\n',
    'schemas/pet.yaml': 'type: object\ndiscriminator:\n  propertyName: kind\n  mapping:\n    cat: "../openapi.yaml#/components/schemas/Cat"\n'
  }, 'openapi.yaml');
  const r = compareProjects(base, next);
  const res = applyChanges(base, next, r.changes.filter((c) => c.title.includes('Pet')), { fromNext: true });
  assert.ok(res.deps.includes('schemas/Cat'));
  assert.equal(base.read(['components', 'schemas', 'Pet', 'discriminator', 'mapping', 'cat']), '#/components/schemas/Cat');
  assert.deepEqual(base.read(['components', 'schemas', 'Cat', 'example']), { $ref: '#/components/schemas/NoExiste' });
  assert.equal(res.brokenRefs, 0);
});

test('los schemas definidos en su propio fichero se copian como componentes con nombre', () => {
  const base = open('01-simple'); const next = open('02-fragmentado');
  const c = compareProjects(base, next).changes.find((x) => x.kind === 'added' && x.route === '/productos' && x.method === 'get');
  const res = applyChanges(base, next, [c], { fromNext: true });
  assert.ok(res.deps.includes('schemas/Categoria'));
  assert.ok(res.deps.includes('schemas/Error'));
  assert.ok(res.deps.includes('tags/productos'), 'la definicion del tag tambien se copia');
  assert.deepEqual(base.read(['components', 'schemas', 'Producto', 'properties', 'categoria']), { $ref: '#/components/schemas/Categoria' });
  assert.deepEqual(base.read(['components', 'schemas', 'Categoria', 'properties', 'padre']), { $ref: '#/components/schemas/Categoria' });
  assert.equal(res.brokenRefs, 0);
});

test('un alias interno de componente se respeta al reescribir referencias', () => {
  const comps = (extra) => 'components:\n  schemas:\n    Y: {type: string}\n    X: {$ref: "#/components/schemas/Y"}\n' + (extra || '');
  const base = one('paths: {}\n' + comps());
  const next = one(op('          content:\n            application/json:\n              schema: {$ref: "#/components/schemas/X"}\n') + comps());
  mergeAll(base, next);
  assert.deepEqual(base.read(['paths', '/a', 'get', 'responses', '200', 'content', 'application/json', 'schema']), { $ref: '#/components/schemas/X' });
});

test('si la edicion falla a medias, el destino queda intacto', () => {
  const p = open('02-fragmentado');
  const before = p.texts();
  assert.throws(() => p.mutate('x', (tx) => { tx.set(['info', 'version'], '9'); throw new Error('boom'); }));
  assert.deepEqual(p.texts(), before);
  assert.equal(p.read(['info', 'version']), '1.2.0');
});
