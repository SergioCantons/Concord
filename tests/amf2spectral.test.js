const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/core/amf2spectral.js');
const S = require('../js/core/spectral.js');
const Project = require('../js/core/project.js').Project;
const B = require('../js/core/bundle.js');
const { loadDir } = require('./helpers.js');

function translated(profile) {
  const res = A.translateProfile(profile);
  assert.equal(res.ok, true, (res.errors || []).join('\n'));
  const ruleset = S.parseRuleset(res.spectralText, 'amf.yaml');
  assert.equal(ruleset.ok, true, ruleset.errors.join('\n'));
  assert.equal(ruleset.unsupported.length, 0, ruleset.unsupported.join('\n'));
  return { res, ruleset };
}

function violations(profile, doc) {
  return [...new Set(S.runRuleset(translated(profile).ruleset, doc).map((x) => x.ruleId))].sort();
}

const baseDoc = {
  openapi: '3.0.0',
  info: { title: 'API', version: '1.0.0' },
  paths: {
    '/items': {
      parameters: [{ name: 'okHeader', in: 'header', schema: { type: 'string' } }],
      get: {
        operationId: 'listItems',
        parameters: [
          { name: 'itemId', in: 'query', schema: { type: 'string' } },
          { name: 'password', in: 'query', schema: { type: 'string' } }
        ],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', description: 'campo' } } } } } },
        responses: { 200: { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } } }
      }
    }
  },
  components: {
    parameters: { Shared: { name: 'shared', in: 'path', required: true, schema: { type: 'string' } } },
    responses: { SharedResponse: { description: 'ok', content: { 'application/xml': { schema: { type: 'string' } } } } },
    schemas: {
      Id: { type: 'integer' },
      Price: { type: 'number', minimum: 0, maximum: 20 },
      ShortText: { type: 'string', maxLength: 80 },
      CustomText: { type: 'string', format: 'code' },
      EmptyObject: { type: 'object', properties: {} },
      Tags: { type: 'array', minItems: 0, maxItems: 9, items: { type: 'integer' } },
      SecretBox: { type: 'object', properties: { secret: { type: 'string', description: 'texto libre' } } }
    }
  }
};

const profile = `#%Validation Profile 1.0
profile: Demo AMF
violation:
  - integer-format
  - number-limits
  - object-properties
  - array-limits
  - array-items-string
  - sensitive-parameter
  - json-response
  - secret-description
warning:
  - string-max
  - custom-format-pattern
info:
  - parameter-name
validations:
  integer-format:
    targetClass: shapes.ScalarShape
    message: '{{shacl.name}} debe declarar formato'
    if:
      propertyConstraints:
        shacl.datatype:
          in: [xsd:integer]
    then:
      propertyConstraints:
        shapes.format:
          minCount: 1
  number-limits:
    targetClass: shapes.ScalarShape
    message: Número fuera de rango
    and:
      - propertyConstraints:
          shacl.minInclusive:
            minInclusive: 1
      - propertyConstraints:
          shacl.maxInclusive:
            maxInclusive: 10
  string-max:
    targetClass: shapes.ScalarShape
    propertyConstraints:
      shacl.maxLength:
        maxInclusive: 50
  custom-format-pattern:
    targetClass: shapes.ScalarShape
    if:
      and:
        - propertyConstraints:
            shacl.datatype:
              in: [xsd:string]
        - propertyConstraints:
            shapes.format:
              in: [code]
    then:
      propertyConstraints:
        shacl.pattern:
          minCount: 1
  object-properties:
    targetClass: shacl.NodeShape
    propertyConstraints:
      shacl.property:
        minCount: 1
  array-limits:
    targetClass: shapes.ArrayShape
    propertyConstraints:
      shacl.minCount:
        minInclusive: 1
      shacl.maxCount:
        maxInclusive: 5
  array-items-string:
    targetClass: shapes.ArrayShape
    propertyConstraints:
      shapes.items:
        nested:
          propertyConstraints:
            shacl.datatype:
              in: [xsd:string]
  parameter-name:
    targetClass: apiContract.Parameter
    message: 'Parámetro {{apiContract.paramName}} inválido'
    propertyConstraints:
      apiContract.paramName:
        pattern: '^[a-z][A-Za-z0-9]*$'
  sensitive-parameter:
    targetClass: apiContract.Parameter
    if:
      propertyConstraints:
        apiContract.binding:
          in: [query, path]
    then:
      propertyConstraints:
        apiContract.paramName:
          not:
            in: [password, token]
  json-response:
    targetClass: apiContract.Response
    propertyConstraints:
      apiContract.payload:
        nested:
          propertyConstraints:
            core.mediaType:
              in: [application/json]
  secret-description:
    targetClass: shacl.PropertyShape
    propertyConstraints:
      shacl.name:
        in: [secret]
      core.description:
        pattern: '^Confidencial:'
  unlisted-off:
    targetClass: apiContract.WebAPI
    propertyConstraints:
      core.version:
        pattern: '^2'
  rego-rule:
    targetClass: apiContract.WebAPI
    rego: package demo
`;

test('isProfile detecta perfiles AMF con BOM y espacios', () => {
  assert.equal(A.isProfile('\uFEFF\n  #%Validation Profile 1.0\nprofile: x'), true);
  assert.equal(A.isProfile('openapi: 3.0.0'), false);
});

test('translateProfile genera YAML Spectral válido con severidades, comentarios y reporte', () => {
  const { res, ruleset } = translated(profile);
  assert.equal(res.name, 'Demo AMF');
  assert.match(res.spectralText, /Traducido automáticamente desde el perfil AMF «Demo AMF»/);
  assert.match(res.spectralText, /Regla AMF original: integer-format/);
  assert.equal(ruleset.rules.find((r) => r.id === 'integer-format').severity, 'error');
  assert.equal(ruleset.rules.find((r) => r.id === 'string-max').severity, 'warning');
  assert.equal(ruleset.rules.find((r) => r.id === 'parameter-name').severity, 'info');
  assert.equal(ruleset.rules.find((r) => r.id === 'unlisted-off').severity, 'off');
  assert.equal(ruleset.rules.some((r) => r.id === 'rego-rule'), false);
  assert.equal(res.report.find((r) => r.rule === 'rego-rule').status, 'unsupported');
  assert.equal(res.report.find((r) => r.rule === 'json-response').status, 'partial');
});

test('reglas traducidas detectan violaciones y respetan ejemplos válidos', () => {
  const ids = violations(profile, baseDoc);
  assert.deepEqual(ids, [
    'array-items-string', 'array-limits', 'custom-format-pattern', 'integer-format', 'json-response',
    'number-limits', 'object-properties', 'secret-description', 'sensitive-parameter', 'string-max'
  ].sort());

  const valid = JSON.parse(JSON.stringify(baseDoc));
  valid.paths['/items'].get.parameters = [{ name: 'itemId', in: 'query', schema: { type: 'string' } }];
  valid.paths['/items'].get.responses[200].content = { 'application/json': { schema: { type: 'string' } } };
  valid.components.responses.SharedResponse.content = { 'application/json': { schema: { type: 'string' } } };
  valid.components.schemas.Id.format = 'int32';
  valid.components.schemas.Price.minimum = 1;
  valid.components.schemas.Price.maximum = 10;
  valid.components.schemas.ShortText.maxLength = 50;
  valid.components.schemas.CustomText.pattern = '^[A-Z]+$';
  valid.components.schemas.EmptyObject.properties = { id: { type: 'string', description: 'campo' } };
  valid.components.schemas.Tags.minItems = 1;
  valid.components.schemas.Tags.maxItems = 5;
  valid.components.schemas.Tags.items = { type: 'string', properties: { value: { type: 'string', description: 'campo' } } };
  valid.components.schemas.SecretBox.properties.secret.description = 'Confidencial: dato sensible';
  assert.deepEqual(violations(profile, valid), []);
});

test('mensajes traducen placeholders AMF a placeholders Spectral', () => {
  const { ruleset } = translated(profile);
  const out = S.runRuleset(ruleset, baseDoc).find((x) => x.ruleId === 'integer-format');
  assert.match(out.message, /Id debe declarar formato|format debe declarar formato|type debe declarar formato/);
});

test('errores fatales cubren YAML inválido, cabecera y validations ausente', () => {
  assert.equal(A.translateProfile('openapi: 3.0.0').ok, false);
  assert.match(A.translateProfile('#%Validation Profile 1.0\nprofile: x').errors[0], /validations/);
  assert.match(A.translateProfile('#%Validation Profile 1.0\n: [').errors[0], /YAML/);
});

test('no emite JSON Schema inválido para condicional numérico con double o float', () => {
  const p = `#%Validation Profile 1.0
profile: Regresión double float
violation: [numeric-bounds]
validations:
  numeric-bounds:
    targetClass: shapes.ScalarShape
    if:
      propertyConstraints:
        shacl.datatype:
          in:
            - http://www.w3.org/2001/XMLSchema#double
            - http://www.w3.org/2001/XMLSchema#float
    then:
      and:
        - propertyConstraints:
            shacl.minInclusive:
              minCount: 1
        - propertyConstraints:
            shacl.maxInclusive:
              minCount: 1
`;
  const { res, ruleset } = translated(p);
  assert.equal(res.report.find((r) => r.rule === 'numeric-bounds').status, 'translated');
  const out = S.runRuleset(ruleset, { openapi: '3.0.0', info: {}, paths: {}, components: { schemas: { Amount: { type: 'number', format: 'double' } } } });
  assert.equal(out.some((r) => /no se pudo evaluar|schema is invalid/.test(r.message)), false);
  assert.equal(out.some((r) => r.ruleId === 'numeric-bounds'), true);
});

test('traduce PropertyShape con condición de nombre y shapes.range sin schema inválido', () => {
  const p = `#%Validation Profile 1.0
profile: Regresión propiedades descritas
violation: [named-property-description]
validations:
  named-property-description:
    targetClass: shacl.PropertyShape
    if:
      and:
        - propertyConstraints:
            shacl.name:
              minCount: 1
        - propertyConstraints:
            shacl.name:
              in: [customerId, accountId, transactionId, productId]
    then:
      and:
        - propertyConstraints:
            shapes.range / core.description:
              minCount: 1
        - propertyConstraints:
            shapes.range / core.description:
              pattern: '^(\\[X\\])(.)*$'
`;
  const { res, ruleset } = translated(p);
  assert.equal(res.report.find((r) => r.rule === 'named-property-description').status, 'partial');
  const doc = { components: { schemas: { Item: { type: 'object', properties: { customerId: { type: 'string', description: 'texto' }, other: { type: 'string' } } } } } };
  const out = S.runRuleset(ruleset, doc);
  assert.equal(out.some((r) => /no se pudo evaluar|schema is invalid/.test(r.message)), false);
  assert.equal(out.filter((r) => r.ruleId === 'named-property-description').length, 1);
});

test('response sin content satisface nested payload mediaType de forma vacía', () => {
  const p = `#%Validation Profile 1.0
profile: MediaType vacuo
violation: [json-media]
validations:
  json-media:
    targetClass: apiContract.Response
    propertyConstraints:
      apiContract.payload:
        nested:
          propertyConstraints:
            core.mediaType:
              in: [application/json, application/problem+json]
`;
  const doc = { paths: { '/x': { get: { responses: { 404: { description: 'No existe' }, 200: { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } } } } } } };
  const out = S.runRuleset(translated(p).ruleset, doc);
  assert.equal(out.filter((r) => r.ruleId === 'json-media').length, 1);
  assert.deepEqual(out[0].path, ['paths', '/x', 'get', 'responses', '200']);
});

test('perfil representativo no genera errores de evaluación sobre examples', () => {
  const representative = `#%Validation Profile 1.0
profile: Perfil e2e representativo
violation: [operation-id, property-description, response-json, arrays-bounded, string-format-pattern]
validations:
  operation-id:
    targetClass: apiContract.Operation
    propertyConstraints:
      core.name:
        minCount: 1
  property-description:
    targetClass: shacl.PropertyShape
    if:
      propertyConstraints:
        shacl.name:
          pattern: '^[a-z].*'
    then:
      propertyConstraints:
        core.description:
          minCount: 1
  response-json:
    targetClass: apiContract.Response
    propertyConstraints:
      apiContract.payload:
        nested:
          propertyConstraints:
            core.mediaType:
              in: [application/json, application/problem+json]
  arrays-bounded:
    targetClass: shapes.ArrayShape
    propertyConstraints:
      shacl.minCount:
        minInclusive: 0
      shacl.maxCount:
        maxInclusive: 100
  string-format-pattern:
    targetClass: shapes.ScalarShape
    if:
      and:
        - propertyConstraints:
            shacl.datatype:
              in: [xsd:string]
        - propertyConstraints:
            shapes.format:
              minCount: 1
    then:
      propertyConstraints:
        shacl.pattern:
          minCount: 1
`;
  const ruleset = translated(representative).ruleset;
  for (const dir of ['01-simple', '02-fragmentado', '03-roto', '04-cambiado']) {
    const project = Project.fromFiles(loadDir(dir), 'openapi.yaml');
    const doc = B.bundleProject(project).js;
    const out = S.runRuleset(ruleset, doc || {});
    assert.equal(out.some((r) => /no se pudo evaluar/.test(r.message)), false, dir);
  }
});

test('acepta patrones AMF válidos sin unicode aunque Ajv con u los rechace', () => {
  const p = `#%Validation Profile 1.0
profile: Patrón AMF no unicode
violation: [bracket-prefix]
validations:
  bracket-prefix:
    targetClass: shacl.PropertyShape
    propertyConstraints:
      core.description:
        pattern: '^(\\[X])(.)*$'
`;
  const { res, ruleset } = translated(p);
  assert.equal(res.report.find((r) => r.rule === 'bracket-prefix').status, 'translated');
  const out = S.runRuleset(ruleset, { components: { schemas: { Item: { type: 'object', properties: { id: { type: 'string', description: 'texto' } } } } } });
  assert.equal(out.some((r) => /schema is invalid|no se pudo evaluar/.test(r.message)), false);
  assert.equal(out.some((r) => r.ruleId === 'bracket-prefix'), true);
});

test('mapea alternativas dentro de rutas secuenciales a claves OpenAPI string', () => {
  const p = `#%Validation Profile 1.0
profile: Items sin composición
violation: [array-items-no-composition]
validations:
  array-items-no-composition:
    targetClass: shapes.ArrayShape
    propertyConstraints:
      shapes.items / (shacl.xone | shacl.and | shacl.or):
        maxCount: 0
`;
  const { res, ruleset } = translated(p);
  assert.equal(res.report.find((r) => r.rule === 'array-items-no-composition').status, 'partial');
  const doc = { components: { schemas: { Tags: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }] } } } } };
  const out = S.runRuleset(ruleset, doc);
  assert.equal(out.some((r) => /schema is invalid|no se pudo evaluar/.test(r.message)), false);
  assert.equal(out.some((r) => r.ruleId === 'array-items-no-composition'), true);
});
