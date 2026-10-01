/* Traduce perfiles AMF Validation Profile 1.0 a rulesets Spectral locales. */
// allow: SIZE_OK — traductor autocontenido pedido como módulo único UMD para uso offline en navegador/Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./vendor.js'));
  else { root.OAT = root.OAT || {}; root.OAT.amf2spectral = factory(root.OAT.util, root.OAT.vendor); }
})(typeof self !== 'undefined' ? self : this, function (U, vendor) {
  'use strict';

  const OPS = 'get,put,post,delete,options,head,patch,trace';
  const SCHEMA_NODE = '$..[?(@ && typeof @ === "object" && (@.type || @.properties || @.items || @.allOf || @.oneOf || @.anyOf || @.format || @.enum))]';
  const TARGETS = {
    'apiContract.WebAPI': ['$'],
    'apiContract.EndPoint': ['$.paths[*]'],
    'apiContract.Operation': ['$.paths[*][' + OPS + ']'],
    'apiContract.Parameter': ['$.paths[*][' + OPS + '].parameters[*]', '$.paths[*].parameters[*]', '$.components.parameters[*]'],
    'apiContract.Response': ['$.paths[*][' + OPS + '].responses[*]', '$.components.responses[*]'],
    'apiContract.Request': ['$.paths[*][' + OPS + '].requestBody'],
    'apiContract.Payload': ['$.paths[*][' + OPS + '].requestBody.content[*]', '$.paths[*][' + OPS + '].responses[*].content[*]'],
    'shapes.ScalarShape': ['$..[?(@ && typeof @ === "object" && (@.type==="string" || @.type==="integer" || @.type==="number" || @.type==="boolean" || (!@.type && (@.format || @.enum))))]'],
    'shapes.ArrayShape': ['$..[?(@ && typeof @ === "object" && (@.type==="array" || @.items))]'],
    'shacl.NodeShape': ['$..[?(@ && typeof @ === "object" && (@.type==="object" || @.properties))]'],
    'shacl.PropertyShape': ['$..properties[*]']
  };
  const FIELD = {
    'core.name': { WebAPI: 'info.title', Operation: 'operationId', Parameter: 'name', PropertyShape: '@key', default: 'name' },
    'core.version': { WebAPI: 'info.version', default: 'version' },
    'core.description': { default: 'description' },
    'apiContract.paramName': { default: 'name' },
    'apiContract.binding': { default: 'in' },
    'apiContract.required': { default: 'required' },
    'apiContract.payload': { default: 'content' },
    'core.mediaType': { default: '@key' },
    'shapes.schema': { default: 'schema' },
    'shapes.format': { default: 'format' },
    'shapes.items': { default: 'items' },
    'shacl.name': { PropertyShape: '@key', default: 'name' },
    'shacl.minInclusive': { default: 'minimum' },
    'shacl.maxInclusive': { default: 'maximum' },
    'shacl.minExclusive': { default: 'exclusiveMinimum' },
    'shacl.maxExclusive': { default: 'exclusiveMaximum' },
    'shacl.minCount': { default: 'minItems' },
    'shacl.maxCount': { default: 'maxItems' },
    'shacl.minLength': { default: 'minLength' },
    'shacl.maxLength': { default: 'maxLength' },
    'shacl.pattern': { default: 'pattern' },
    'shacl.property': { default: 'properties' },
    'shacl.closed': { default: 'additionalProperties' },
    'shacl.xone': { default: 'oneOf' },
    'shacl.and': { default: 'allOf' },
    'shacl.or': { default: 'anyOf' },
    'shacl.datatype': { datatype: true }
  };
  const DATATYPES = {
    string: { type: 'string' }, 'xsd:string': { type: 'string' }, 'http://www.w3.org/2001/XMLSchema#string': { type: 'string' },
    date: { type: 'string', format: 'date' }, 'xsd:date': { type: 'string', format: 'date' }, 'http://www.w3.org/2001/XMLSchema#date': { type: 'string', format: 'date' },
    dateTime: { type: 'string', format: 'date-time' }, 'xsd:dateTime': { type: 'string', format: 'date-time' }, 'http://www.w3.org/2001/XMLSchema#dateTime': { type: 'string', format: 'date-time' },
    base64Binary: { type: 'string', format: 'byte' }, 'xsd:base64Binary': { type: 'string', format: 'byte' },
    hexBinary: { type: 'string', format: 'binary' }, 'xsd:hexBinary': { type: 'string', format: 'binary' },
    integer: { type: 'integer' }, 'xsd:integer': { type: 'integer' }, 'http://www.w3.org/2001/XMLSchema#integer': { type: 'integer' },
    long: { type: 'integer', format: 'int64' }, 'xsd:long': { type: 'integer', format: 'int64' },
    number: { type: 'number' }, 'http://a.ml/vocabularies/shapes#number': { type: 'number' },
    float: { type: 'number', format: 'float' }, 'xsd:float': { type: 'number', format: 'float' }, 'http://www.w3.org/2001/XMLSchema#float': { type: 'number', format: 'float' },
    double: { type: 'number', format: 'double' }, 'xsd:double': { type: 'number', format: 'double' }, 'http://www.w3.org/2001/XMLSchema#double': { type: 'number', format: 'double' },
    boolean: { type: 'boolean' }, 'xsd:boolean': { type: 'boolean' }, 'http://www.w3.org/2001/XMLSchema#boolean': { type: 'boolean' }
  };
  const UNSUPPORTED_KEYS = ['rego', 'functionConstraint', 'extends'];

  function arr(v) { return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]; }
  function isObj(v) { return U && U.isObj ? U.isObj(v) : v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isProfile(text) { return String(text || '').replace(/^\uFEFF/, '').replace(/^\s+/, '').startsWith('#%Validation Profile'); }
  function localClass(s) { return String(s || '').replace(/^.*[.#:]/, ''); }
  function cleanMessage(s) { return String(s || 'Validación AMF incumplida').replace(/\{\{\s*(shacl\.name|core\.name|apiContract\.paramName)\s*\}\}/g, '{{property}}'); }
  function statusText(status, reason) { return status === 'partial' ? 'Traducción parcial: ' + reason : status === 'translated' ? 'Traducción equivalente para OpenAPI 3.0.' : reason; }
  function severityOf(id, doc) {
    if (arr(doc.violation).indexOf(id) >= 0) return 'error';
    if (arr(doc.warning).indexOf(id) >= 0) return 'warn';
    if (arr(doc.info).indexOf(id) >= 0) return 'info';
    return 'off';
  }
  function addAll(dst, src) { for (const x of src || []) dst.push(x); return dst; }
  function req(schema, key) { schema.required = schema.required || []; if (schema.required.indexOf(key) < 0) schema.required.push(key); }
  function propSchema(key, sub, required) { const s = { type: 'object', properties: {} }; s.properties[key] = sub; if (required) req(s, key); return s; }
  function presentPropSchema(key, sub) { const s = propSchema(key, sub, false); req(s, key); return s; }
  function emptySchema(s) { return isObj(s) && Object.keys(s).length === 0; }
  function mergeAll(parts) { const p = parts.filter((x) => x && !emptySchema(x)); return p.length === 0 ? {} : p.length === 1 ? p[0] : { allOf: p }; }
  function asValues(v) { return arr(v).map((x) => isObj(x) && typeof x['@id'] === 'string' ? x['@id'] : x); }

  function datatypeSchema(values) {
    const schemas = asValues(values).map((v) => DATATYPES[String(v)] || DATATYPES[String(v).replace(/^xsd:/, 'xsd:')]).filter(Boolean);
    if (!schemas.length) return null;
    return schemas.length === 1 ? clone(schemas[0]) : { anyOf: schemas.map(clone) };
  }

  function schemaNodeForDatatype(values) {
    const schemas = asValues(values).map((v) => DATATYPES[String(v)]).filter(Boolean).map((s) => {
      const out = { type: 'object', properties: { type: { const: s.type } } };
      if (s.format) out.properties.format = { const: s.format };
      return out;
    });
    if (!schemas.length) return null;
    return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
  }

  function fieldFor(path, cls) {
    if (/^apiExt\./.test(path)) return 'x-' + path.slice(7);
    const m = FIELD[path];
    if (!m) return null;
    if (m.datatype) return '@datatype';
    return m[localClass(cls)] || m.default || null;
  }

  function valueFacetSchema(facets, keyField) {
    const s = {};
    if ('in' in facets) s.enum = asValues(facets.in);
    if ('pattern' in facets) s.pattern = String(facets.pattern);
    if ('minLength' in facets) s.minLength = Number(facets.minLength);
    if ('maxLength' in facets) s.maxLength = Number(facets.maxLength);
    if ('minInclusive' in facets) s.minimum = Number(facets.minInclusive);
    if ('maxInclusive' in facets) s.maximum = Number(facets.maxInclusive);
    if ('minExclusive' in facets) s.exclusiveMinimum = Number(facets.minExclusive);
    if ('maxExclusive' in facets) s.exclusiveMaximum = Number(facets.maxExclusive);
    if ('exactCount' in facets) { s.minItems = Number(facets.exactCount); s.maxItems = Number(facets.exactCount); }
    if ('containsAll' in facets) s.allOf = asValues(facets.containsAll).map((v) => ({ contains: { const: v } }));
    if ('containsSome' in facets) s.contains = { enum: asValues(facets.containsSome) };
    if ('datatype' in facets) return datatypeSchema(facets.datatype) || s;
    if (keyField === 'properties') {
      if ('minCount' in facets) s.minProperties = Number(facets.minCount);
      if ('maxCount' in facets) s.maxProperties = Number(facets.maxCount);
    }
    return s;
  }

  function constraintForField(field, facets, cls) {
    if ('lessThanProperty' in facets || 'lessThanOrEqualsToProperty' in facets || 'equalsToProperty' in facets || 'disjointWithProperty' in facets) return { unsupported: 'comparación entre propiedades no soportada' };
    if ('not' in facets) {
      const inner = constraintForField(field, facets.not, cls);
      return inner.unsupported ? inner : { schema: { not: inner.schema } };
    }
    if (field === '@datatype') {
      if ('in' in facets) { const s = schemaNodeForDatatype(facets.in); return s ? { schema: s } : { unsupported: 'datatype sin mapeo OpenAPI: ' + asValues(facets.in).join(', ') }; }
      return { unsupported: 'faceta datatype no soportada' };
    }
    if ('nested' in facets) return nestedConstraint(field, facets.nested, cls);
    if (field === '@key') return { schema: valueFacetSchema(facets, field) };
    if (localClass(cls) === 'ScalarShape' && ['format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern'].indexOf(field) >= 0) return { schema: propSchema(field, valueFacetSchema(facets, field), ('minCount' in facets && Number(facets.minCount) > 0) || 'in' in facets || 'pattern' in facets) };
    if (localClass(cls) === 'NodeShape' && field === 'properties') return { schema: propSchema('properties', valueFacetSchema(facets, field), true) };
    if (localClass(cls) === 'ArrayShape' && (field === 'minItems' || field === 'maxItems')) return { schema: propSchema(field, valueFacetSchema(facets, field), false) };
    if (field === 'name' && ('pattern' in facets || 'in' in facets || 'minLength' in facets || 'maxLength' in facets)) return { schema: presentPropSchema('name', valueFacetSchema(facets, field)) };
    if (field === 'description' && ('pattern' in facets || 'in' in facets || 'minLength' in facets || 'maxLength' in facets)) return { schema: presentPropSchema('description', valueFacetSchema(facets, field)) };
    if (localClass(cls) === 'ArrayShape' && field === 'items' && facets.nested && facets.nested.propertyConstraints && facets.nested.propertyConstraints['shacl.datatype']) {
      const dt = facets.nested.propertyConstraints['shacl.datatype'];
      if (dt.in) return { schema: propSchema('items', schemaNodeForDatatype(dt.in) || {}, true) };
    }
    const s = valueFacetSchema(facets, field);
    const needsValue = ('minCount' in facets && Number(facets.minCount) > 0) || ('exactCount' in facets && Number(facets.exactCount) > 0);
    if (field === 'content' && s.enum) return { schema: propSchema('content', { type: 'object', propertyNames: { enum: s.enum }, additionalProperties: true, minProperties: 1, maxProperties: s.enum.length }, needsValue) };
    if ('minCount' in facets && !('minItems' in s) && field !== 'properties') { if (Number(facets.minCount) > 0) return { schema: propSchema(field, {}, true) }; }
    if ('maxCount' in facets && Number(facets.maxCount) === 0) return { schema: { not: { required: [field] } } };
    return { schema: propSchema(field, s, needsValue) };
  }

  function nestedConstraint(field, nested, cls) {
    const body = nested && nested.propertyConstraints ? nested : { propertyConstraints: nested && nested.propertyConstraints || {} };
    const sub = bodySchema(body, cls);
    if (sub.unsupported) return sub;
    if (field === 'content' && body.propertyConstraints && body.propertyConstraints['core.mediaType']) {
      const f = body.propertyConstraints['core.mediaType'];
      if (f && f.in) return { schema: propSchema('content', { type: 'object', propertyNames: { enum: asValues(f.in) }, additionalProperties: true, minProperties: 1, maxProperties: asValues(f.in).length }, false), partial: 'se valida la clave del media type en content; AMF lo modela como payload' };
    }
    return { schema: propSchema(field, sub.schema || {}, true) };
  }

  function pathParts(path) { return String(path).replace(/[()]/g, '').split('/').map((x) => x.trim()).filter(Boolean); }
  function splitTopLevel(s, sep) {
    const out = []; let cur = ''; let depth = 0;
    for (const ch of String(s)) {
      if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;
      if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  }
  function pathAlternatives(path) { return splitTopLevel(path, '|'); }
  function segmentAlternatives(seg) { return splitTopLevel(String(seg).replace(/^\(|\)$/g, ''), '|'); }

  function propertyConstraint(path, facets, cls) {
    const alts = pathAlternatives(path);
    if (alts.length > 1) {
      const anyOf = alts.map((p) => propertyConstraint(p, facets, cls).schema).filter(Boolean);
      return anyOf.length ? { schema: { anyOf }, partial: 'ruta alternativa AMF aproximada con anyOf' } : { unsupported: 'ruta alternativa no soportada' };
    }
    const parts = pathParts(path);
    if (parts.length > 1) {
      const last = segmentAlternatives(parts[parts.length - 1]);
      let inner;
      if (last.length > 1) {
        const schemas = [];
        for (const alt of last) {
          const c = constraintForField(fieldFor(alt, cls), facets, cls);
          if (c.unsupported) return c;
          schemas.push(c.schema);
        }
        inner = { schema: Number(facets.maxCount) === 0 ? { allOf: schemas } : { anyOf: schemas }, partial: 'ruta alternativa AMF aproximada con ' + (Number(facets.maxCount) === 0 ? 'allOf' : 'anyOf') };
      } else inner = constraintForField(fieldFor(parts[parts.length - 1], cls), facets, cls);
      for (let i = parts.length - 2; i >= 0 && !inner.unsupported; i--) {
        const f = fieldFor(parts[i], cls);
        if (f && f !== '@self') inner = { schema: propSchema(f, inner.schema, true), partial: 'ruta secuencial AMF aproximada con propiedades anidadas' };
      }
      return inner;
    }
    const field = fieldFor(path, cls);
    if (!field) return { unsupported: 'propiedad AMF ' + path + ' no mapeada a OpenAPI 3.0' };
    return constraintForField(field, facets || {}, cls);
  }

  function propertyConstraintsSchema(pcs, cls) {
    const parts = []; const partial = [];
    for (const path of Object.keys(pcs || {})) {
      const c = propertyConstraint(path, pcs[path], cls);
      if (c.unsupported) return { unsupported: c.unsupported };
      if (c.partial) partial.push(c.partial);
      parts.push(c.schema);
    }
    return { schema: mergeAll(parts), partial };
  }

  function bodySchema(body, cls) {
    if (!isObj(body)) return { schema: {} };
    if (body.propertyConstraints) return propertyConstraintsSchema(body.propertyConstraints, cls);
    if (body.and) return combine('allOf', body.and, cls);
    if (body.or) return combine('anyOf', body.or, cls);
    if (body.xone) return combine('oneOf', body.xone, cls);
    if (body.not) { const n = bodySchema(body.not, cls); return n.unsupported ? n : { schema: { not: n.schema }, partial: n.partial }; }
    if (body.if || body.then || body.else) {
      const out = {}; const partial = [];
      for (const k of ['if', 'then', 'else']) if (body[k]) { const r = bodySchema(body[k], cls); if (r.unsupported) return r; out[k] = r.schema; addAll(partial, r.partial); }
      return { schema: out, partial };
    }
    return { schema: {} };
  }

  function conditionalBodySchema(body, cls) {
    if (!isObj(body)) return { schema: {} };
    if (body.if && body.then) {
      const cond = bodySchema(body.if, cls);
      if (cond.unsupported) return cond;
      const then = conditionalBodySchema(body.then, cls);
      if (then.unsupported) return then;
      const out = { anyOf: [{ not: cond.schema }, then.schema] };
      return { schema: out, partial: addAll(addAll([], cond.partial), then.partial) };
    }
    return bodySchema(body, cls);
  }

  function combine(key, nodes, cls) {
    const partial = []; const schemas = [];
    for (const n of arr(nodes)) {
      const r = bodySchema(n, cls);
      if (r.unsupported) return r;
      if (!emptySchema(r.schema)) schemas.push(r.schema); addAll(partial, r.partial);
    }
    if (!schemas.length) return { schema: {}, partial };
    const out = {}; out[key] = schemas;
    return { schema: out, partial };
  }

  function nameFacetFromNode(node) {
    if (!isObj(node)) return null;
    if (node.propertyConstraints && (node.propertyConstraints['shacl.name'] || node.propertyConstraints['core.name'])) return node.propertyConstraints['shacl.name'] || node.propertyConstraints['core.name'];
    for (const key of ['if', 'then', 'else', 'not']) { const found = nameFacetFromNode(node[key]); if (found && (found.in || found.pattern)) return found; }
    for (const key of ['and', 'or', 'xone']) for (const sub of arr(node[key])) { const found = nameFacetFromNode(sub); if (found && (found.in || found.pattern)) return found; }
    return null;
  }

  function keyFilterFromRule(rule, cls) {
    if (localClass(cls) !== 'PropertyShape') return null;
    const f = nameFacetFromNode(rule);
    if (!f) return null;
    if (f.in) return '[?(' + asValues(f.in).map((x) => '@property=="' + String(x).replace(/"/g, '\\"') + '"').join(' || ') + ')]';
    if (f.pattern) return '[?(/' + String(f.pattern).replace(/\//g, '\\/') + '/.test(@property))]';
    return null;
  }

  function removeKeyConstraint(rule, cls) {
    const copy = clone(rule);
    function walk(node) {
      if (!isObj(node)) return;
      if (node.propertyConstraints) { delete node.propertyConstraints['shacl.name']; delete node.propertyConstraints['core.name']; }
      for (const key of ['if', 'then', 'else', 'not']) walk(node[key]);
      for (const key of ['and', 'or', 'xone']) for (const sub of arr(node[key])) walk(sub);
    }
    if (localClass(cls) === 'PropertyShape') walk(copy);
    return copy;
  }

  function compileSchema(schema) {
    try {
      const Ajv = vendor.Ajv8 || vendor.Ajv;
      const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true, unicodeRegExp: false });
      if (vendor.addFormats) vendor.addFormats(ajv);
      ajv.compile(schema || {});
      return null;
    } catch (e) { return e && e.message ? e.message : String(e); }
  }

  function translateRule(id, rule, severity) {
    for (const k of UNSUPPORTED_KEYS) if (rule[k] !== undefined) return { id, status: 'unsupported', reason: k + ' no se puede traducir a Spectral offline.' };
    if (!rule.targetClass || !TARGETS[rule.targetClass]) return { id, status: 'unsupported', reason: 'targetClass no soportado: ' + (rule.targetClass || '(vacío)') };
    const filter = keyFilterFromRule(rule, rule.targetClass);
    const body = removeKeyConstraint(rule, rule.targetClass);
    const built = conditionalBodySchema(body, rule.targetClass);
    if (built.unsupported) return { id, status: 'unsupported', reason: built.unsupported };
    const partial = [];
    addAll(partial, built.partial);
    if (rule.targetClass === 'apiContract.Request') partial.push('apiContract.Request se limita a requestBody; parámetros query/header no son hijos del requestBody en OpenAPI 3.0');
    if (filter) partial.push('la condición sobre el nombre se aplica como filtro JSONPath @property');
    const given = TARGETS[rule.targetClass].map((g) => filter && g === '$..properties[*]' ? '$..properties' + filter : g);
    const spectralRule = {
      description: String(rule.message || rule.description || id),
      message: cleanMessage(rule.message || rule.description || id),
      severity,
      given,
      then: { function: 'schema', functionOptions: { schema: built.schema || {} } }
    };
    const schemaError = compileSchema(spectralRule.then.functionOptions.schema);
    if (schemaError) return { id, status: 'unsupported', reason: 'schema JSON no válido para Ajv: ' + schemaError };
    return { id, status: partial.length ? 'partial' : 'translated', reason: partial.length ? partial.join('; ') : 'Traducción equivalente para OpenAPI 3.0.', rule: spectralRule };
  }

  function addComments(yaml, profile, report) {
    const byRule = new Map(report.map((r) => [r.rule, r]));
    const lines = yaml.split('\n'); const out = ['# Traducido automáticamente desde el perfil AMF «' + profile + '» (' + new Date().toISOString() + ').'];
    for (const line of lines) {
      const m = /^  ([A-Za-z0-9_.-]+):\s*$/.exec(line);
      if (m && byRule.has(m[1])) out.push('  # Regla AMF original: ' + m[1] + ' — ' + statusText(byRule.get(m[1]).status, byRule.get(m[1]).reason));
      out.push(line);
    }
    return out.join('\n');
  }

  function translateProfile(text) {
    const errors = []; const report = [];
    if (!isProfile(text)) return { ok: false, name: '', spectralText: '', report, errors: ['El fichero no empieza con #%Validation Profile.'] };
    let doc;
    try { doc = vendor.YAML.parse(String(text)); } catch (e) { return { ok: false, name: '', spectralText: '', report, errors: ['YAML no válido: ' + e.message] }; }
    if (!isObj(doc)) errors.push('El perfil AMF debe ser un objeto YAML.');
    if (!errors.length && !isObj(doc.validations)) errors.push('El perfil AMF debe contener un mapa validations.');
    const name = !errors.length && typeof doc.profile === 'string' ? doc.profile : 'perfil-amf';
    if (errors.length) return { ok: false, name, spectralText: '', report, errors };
    const rules = {};
    for (const id of Object.keys(doc.validations)) {
      const tr = translateRule(id, doc.validations[id] || {}, severityOf(id, doc));
      report.push({ rule: id, status: tr.status, reason: tr.reason });
      if (tr.rule) rules[id] = tr.rule;
    }
    const spectral = { 'x-concord-name': name, description: 'Ruleset traducido desde perfil AMF Validation Profile 1.0 «' + name + '».', rules };
    const spectralText = addComments(vendor.YAML.stringify(spectral), name, report);
    return { ok: true, name, spectralText, report, errors: [] };
  }

  return { isProfile, translateProfile };
});
