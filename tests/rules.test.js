const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../js/core/project.js');
const V = require('../js/core/validate.js');
const RC = require('../js/core/ruleconfig.js');
const { loadDir } = require('./helpers.js');

const open = (dir) => Project.fromFiles(loadDir(dir), 'openapi.yaml');
const bySev = (r, code) => r.diagnostics.filter((d) => d.code === code).map((d) => d.severity);

test('reglas de serie: catálogo con severidades válidas y reglas bloqueadas', () => {
  const ids = new Set();
  for (const r of V.BUILTIN_RULES) {
    assert.ok(r.id && r.title && r.description && r.category, r.id);
    assert.ok(V.SEVERITIES.includes(r.severity), r.id);
    assert.ok(!ids.has(r.id), 'id repetido ' + r.id);
    ids.add(r.id);
  }
  for (const id of ['yaml-syntax', 'refs', 'structure']) assert.equal(V.BUILTIN_RULES.find((r) => r.id === id).locked, true);
  assert.equal(V.ruleOf('oas-required').id, 'structure');
  assert.equal(V.ruleOf('ref-missing-file').id, 'refs');
});

test('reglas de serie: se puede cambiar la severidad o desactivar; las bloqueadas no cambian', () => {
  const p = open('03-roto');
  const base = V.validateProject(p);
  assert.ok(bySev(base, 'opid-duplicate').every((s) => s === 'error') && bySev(base, 'opid-duplicate').length);
  assert.ok(bySev(base, 'tag-undefined').length);
  const r = V.validateProject(p, { rules: { 'opid-duplicate': 'info', 'tag-undefined': 'off', refs: 'off', 'yaml-syntax': 'info' } });
  assert.ok(bySev(r, 'opid-duplicate').every((s) => s === 'info'));
  assert.equal(bySev(r, 'tag-undefined').length, 0);
  assert.ok(bySev(r, 'ref-missing-file').every((s) => s === 'error') && bySev(r, 'ref-missing-file').length);
  assert.ok(bySev(r, 'yaml-syntax').every((s) => s === 'error'));
  assert.ok(r.diagnostics.every((d) => d.rule), 'cada diagnóstico indica su regla');
});

test('reglas de serie: desactivadas por defecto se activan (operationId obligatorio, un único tag)', () => {
  const p = open('01-simple');
  p.mutate('sin id', (tx) => tx.del(['paths', '/notas/{id}', 'get', 'operationId']));
  assert.equal(bySev(V.validateProject(p), 'opid-missing').length, 0);
  assert.deepEqual(bySev(V.validateProject(p, { rules: { 'opid-missing': 'warning' } }), 'opid-missing'), ['warning']);
});

test('reglas de serie: los ajustes antiguos del navegador se traducen', () => {
  assert.deepEqual(V.legacyRules({ opIdUnique: 'warning', opIdRequired: true, singleTag: true, tagsMustExist: false }),
    { 'opid-duplicate': 'warning', 'opid-missing': 'error', 'tag-single': 'warning', 'tag-undefined': 'off' });
  assert.deepEqual(V.legacyRules({ opIdUnique: 'error', opIdRequired: false, singleTag: false, tagsMustExist: true }), {});
  const r = V.validateProject(open('03-roto'), { opIdUnique: 'off' });
  assert.equal(bySev(r, 'opid-duplicate').length, 0);
});

test('.concord/: los ficheros de configuración no forman parte del contrato pero sí del proyecto', () => {
  const files = loadDir('01-simple');
  files.set('.concord/validation.yaml', 'rules:\n  tag-single: warning\n');
  const p = Project.fromFiles(files, 'openapi.yaml');
  assert.ok(!p.files.has('.concord/validation.yaml'));
  assert.equal(p.extras.get('.concord/validation.yaml'), 'rules:\n  tag-single: warning\n');
  assert.equal(p.isDirty(), false);
  p.setExtra('.concord/rulesets/a.yaml', 'rules: {}\n');
  assert.equal(p.isDirty(), true);
  p.markSaved();
  assert.equal(p.isDirty(), false);
  p.setExtra('.concord/rulesets/a.yaml', null);
  assert.equal(p.isDirty(), true);
  assert.throws(() => p.setExtra('otro.yaml', 'x'));
});

test('.concord/validation.yaml: lectura tolerante y escritura solo de lo que difiere', () => {
  const p = open('01-simple');
  assert.equal(RC.readConfig(p).exists, false);
  p.setExtra('.concord/rulesets/propias.yaml', 'rules: {}\n');
  RC.writeConfig(p, { rules: { 'tag-single': 'warning', 'opid-duplicate': 'error', refs: 'off', inventada: 'error' }, rulesets: { '.concord/rulesets/propias.yaml': { enabled: false, rules: { 'mi-regla': 'off' } }, '.concord/rulesets/borrado.yaml': { enabled: true } } });
  const cfg = RC.readConfig(p);
  assert.equal(cfg.exists, true);
  assert.deepEqual(cfg.rules, { 'tag-single': 'warning' });
  assert.deepEqual(Object.keys(cfg.rulesets), ['.concord/rulesets/propias.yaml']);
  assert.deepEqual(cfg.rulesets['.concord/rulesets/propias.yaml'], { enabled: false, rules: { 'mi-regla': 'off' } });
  p.setExtra(RC.CONFIG_FILE, 'rules: [roto');
  assert.ok(RC.readConfig(p).error);
  assert.equal(RC.rulesetPathFor(p, 'Propias'), '.concord/rulesets/propias-2.yaml');
});

test('conjuntos de reglas del contrato: se cargan de .concord/rulesets, se aplican y se pueden desactivar', () => {
  const p = open('02-fragmentado');
  const cfg = RC.validationConfig(p, {});
  assert.equal(cfg.rulesets.length, 1);
  assert.equal(cfg.rulesets[0].ruleset.ok, true);
  const r = V.validateProject(p, cfg);
  const own = r.diagnostics.filter((d) => d.ruleset === '.concord/rulesets/buenas-practicas.yaml');
  const desc = own.find((d) => d.code === 'texto-con-longitud-maxima' && d.file === 'schemas/producto.yaml');
  assert.ok(desc && /descripcion/.test(desc.message) && desc.line > 1, 'se localiza en el fragmento original');
  assert.ok(own.every((d) => d.category === 'Buenas prácticas (ejemplo)'));
  // severidad por regla y desactivación del conjunto desde .concord/validation.yaml
  RC.writeConfig(p, { rules: {}, rulesets: { '.concord/rulesets/buenas-practicas.yaml': { enabled: true, rules: { 'texto-con-longitud-maxima': 'error', 'operacion-con-descripcion': 'off' } } } });
  const r2 = V.validateProject(p, RC.validationConfig(p, {}));
  assert.ok(r2.diagnostics.filter((d) => d.code === 'texto-con-longitud-maxima').every((d) => d.severity === 'error'));
  assert.equal(r2.diagnostics.filter((d) => d.code === 'operacion-con-descripcion').length, 0);
  RC.writeConfig(p, { rules: {}, rulesets: { '.concord/rulesets/buenas-practicas.yaml': { enabled: false } } });
  assert.equal(V.validateProject(p, RC.validationConfig(p, {})).diagnostics.filter((d) => d.ruleset).length, 0);
});
