const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/core/spectral.js');

function ruleset(text) {
  const r = S.parseRuleset(text, 'mi-ruleset.yaml');
  assert.equal(r.ok, true, r.errors.join('\n'));
  return r;
}

function messages(rules, doc, opts) { return S.runRuleset(rules, doc, opts).map((r) => r.message); }

test('parseRuleset expande aliases, mapea severidades y registra features no soportadas', () => {
  const r = ruleset(`
x-concord-name: Local
description: Reglas locales
extends: spectral:oas
functions: [custom]
functionsDir: ./functions
overrides: [{ files: ['*.yaml'], rules: {} }]
aliases:
  PathItem: $.paths[*]
  Scoped:
    targets: [{ formats: [oas3] }]
rules:
  paths-ok:
    given: '#PathItem'
    severity: 0
    then: { field: get.operationId, function: defined }
  alias-scoped:
    given: '#Scoped.name'
    then: { function: truthy }
  off-rule:
    given: $.info
    severity: off
    then: { field: title, function: truthy }
  inherited-only: warn
  custom-rule:
    given: $.info
    then: { function: custom }
  oas-rule:
    given: $.info
    then: { function: oasOpIdUnique }
`);
  assert.equal(r.name, 'Local');
  assert.equal(r.description, 'Reglas locales');
  assert.equal(r.rules.find((x) => x.id === 'paths-ok').given[0], '$.paths[*]');
  assert.equal(r.rules.find((x) => x.id === 'paths-ok').severity, 'error');
  assert.equal(r.rules.find((x) => x.id === 'off-rule').severity, 'off');
  assert.equal(r.rules.find((x) => x.id === 'custom-rule').supported, false);
  assert.equal(r.rules.find((x) => x.id === 'oas-rule').supported, false);
  assert.ok(r.unsupported.some((x) => /extends: spectral:oas/.test(x)));
  assert.ok(r.unsupported.some((x) => /targets/.test(x)));
  assert.ok(r.unsupported.some((x) => /atajo/.test(x)));
  assert.ok(r.unsupported.some((x) => /custom/.test(x)));
});

test('parseRuleset informa YAML inválido y rules ausente como errores fatales', () => {
  const invalid = S.parseRuleset('rules: [', 'bad.yaml');
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors[0], /YAML no válido/);
  const noRules = S.parseRuleset('description: nada', 'otro.yaml');
  assert.equal(noRules.name, 'otro');
  assert.equal(noRules.ok, false);
  assert.match(noRules.errors[0], /rules/);
});

test('core functions cubren casos pass/fail y campos @key/missing', () => {
  const r = ruleset(`
rules:
  truthy-title: { given: $.info, then: { field: title, function: truthy } }
  falsy-empty: { given: $.info, then: { field: empty, function: falsy } }
  defined-missing: { given: $.info, then: { field: missing, function: defined } }
  undefined-missing: { given: $.info, then: { field: missing, function: undefined } }
  pattern-bad: { given: $.info, then: { field: version, function: pattern, functionOptions: { match: '/^v\\d+$/' } } }
  casing-bad: { given: $.info, then: { field: badName, function: casing, functionOptions: { type: kebab, disallowDigits: true } } }
  length-bad: { given: $.tags, then: { function: length, functionOptions: { min: 2, max: 3 } } }
  enum-bad: { given: $.info, then: { field: status, function: enumeration, functionOptions: { values: [ok, ready] } } }
  alphabetical-bad: { given: $.tags, then: { function: alphabetical, functionOptions: { keyedBy: name } } }
  xor-bad: { given: $.info, then: { function: xor, functionOptions: { properties: [a, b] } } }
  or-bad: { given: $.info, then: { function: or, functionOptions: { properties: [c, d] } } }
  typed-enum-bad: { given: $.components.schemas.Kind, then: { function: typedEnum } }
  key-bad: { given: $.components.schemas, then: { field: '@key', function: casing, functionOptions: { type: pascal } } }
  off-skip: { given: $.info, severity: off, then: { field: title, function: falsy } }
`);
  const out = S.runRuleset(r, {
    info: { title: '', empty: '', version: '1', badName: 'Bad_1', status: 'bad', a: 1, b: 2 },
    tags: [{ name: 'z' }, { name: 'a' }, { name: 'm' }, { name: 'n' }],
    components: { schemas: { bad_name: { type: 'string' }, Kind: { type: 'string', enum: ['a', 2] } } }
  });
  const ids = out.map((x) => x.ruleId).sort();
  assert.deepEqual(ids, ['alphabetical-bad', 'casing-bad', 'defined-missing', 'enum-bad', 'key-bad', 'length-bad', 'or-bad', 'pattern-bad', 'truthy-title', 'typed-enum-bad', 'xor-bad'].sort());
  assert.ok(!ids.includes('falsy-empty'));
  assert.ok(!ids.includes('undefined-missing'));
  assert.ok(!ids.includes('off-skip'));
  assert.deepEqual(out.find((x) => x.ruleId === 'key-bad').path, ['components', 'schemas', 'bad_name']);
});

test('resolved refs, resolved:false, ciclos y dedupe mapean rutas al documento raw', () => {
  const doc = {
    paths: {
      '/a': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } } },
      '/b': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } } }
    },
    components: { schemas: { Pet: { type: 'object', properties: { id: {} } }, Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } } } }
  };
  const r = ruleset(`
rules:
  ref-resolved:
    given: $..schema.properties.id
    message: '{{path}} {{property}} {{error}}'
    then: { field: type, function: defined }
  ref-raw:
    given: $..schema.$ref
    resolved: false
    then: { function: pattern, functionOptions: { match: Pet } }
  cycle-safe:
    given: $.components.schemas.Node.properties.child.$ref
    then: { function: truthy }
`);
  const out = S.runRuleset(r, doc);
  const resolved = out.filter((x) => x.ruleId === 'ref-resolved');
  assert.equal(resolved.length, 1, 'dedupe elimina el mismo nodo alcanzado por dos refs');
  assert.deepEqual(resolved[0].path, ['components', 'schemas', 'Pet', 'properties', 'id', 'type']);
  assert.match(resolved[0].message, /#\/components\/schemas\/Pet\/properties\/id\/type type/);
  assert.equal(out.filter((x) => x.ruleId === 'ref-raw').length, 0);
  assert.equal(out.filter((x) => x.ruleId === 'cycle-safe').length, 0);
});

test('schema soporta draft-07 con if/then y anyOf', () => {
  const r = ruleset(`
rules:
  schema-check:
    given: $.item
    then:
      function: schema
      functionOptions:
        schema:
          type: object
          required: [kind, id]
          properties:
            kind: { enum: [pet, user] }
            id: { anyOf: [{ type: string, pattern: '^p-' }, { type: string, pattern: '^u-' }] }
          if:
            properties: { kind: { const: pet } }
          then:
            properties: { id: { pattern: '^p-' } }
`);
  assert.ok(S.runRuleset(r, { item: { kind: 'pet', id: 'u-1' } }).length >= 1);
  assert.equal(S.runRuleset(r, { item: { kind: 'user', id: 'u-1' } }).length, 0);
});

test('message placeholders se sustituyen con valor truncado', () => {
  const r = ruleset(`
rules:
  msg:
    description: Descripcion
    given: $.info.title
    message: '{{description}} {{path}} {{property}} {{value}} {{error}}'
    then: { function: pattern, functionOptions: { match: '^ok$' } }
`);
  const out = S.runRuleset(r, { info: { title: 'x'.repeat(150) } });
  assert.equal(out.length, 1);
  assert.match(out[0].message, /^Descripcion #\/info\/title title /);
  assert.ok(!out[0].message.includes('x'.repeat(120)));
  assert.match(out[0].message, /patrón/);
});

test('excepciones de una regla se convierten en resultado error', () => {
  const r = { rules: [{ id: 'boom', severity: 'warning', supported: true, given: ['$'], then: [{ function: 'truthy', functionOptions: {} }], resolved: true }] };
  const old = S.CORE_FUNCTIONS.truthy;
  S.CORE_FUNCTIONS.truthy = () => { throw new Error('boom interno'); };
  try {
    const out = S.runRuleset(r, { ok: true });
    assert.equal(out[0].severity, 'error');
    assert.match(out[0].message, /no se pudo evaluar: boom interno/);
  } finally {
    S.CORE_FUNCTIONS.truthy = old;
  }
});
