/* Motor Spectral offline: reglas YAML/JSON, JSONPath y funciones principales sin red. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./vendor.js'));
  else { root.OAT = root.OAT || {}; root.OAT.spectral = factory(root.OAT.util, root.OAT.vendor); }
})(typeof self !== 'undefined' ? self : this, function (U, vendor) {
  'use strict';

  const schemaCache = new Map();

  function ptrToSegs(ptr, root) {
    const raw = U.fromPtr(ptr || '');
    const out = [];
    let cur = root;
    for (const s of raw) {
      const seg = Array.isArray(cur) && /^\d+$/.test(s) ? Number(s) : s;
      out.push(seg);
      cur = cur && typeof cur === 'object' ? cur[seg] : undefined;
    }
    return out;
  }

  function getAt(doc, segs) {
    let cur = doc;
    for (const s of segs) {
      if (cur === null || typeof cur !== 'object' || !(s in cur)) return undefined;
      cur = cur[s];
    }
    return cur;
  }

  function jsonPath(path, json) {
    return vendor.JSONPath({ path, json, resultType: 'all', ignoreEvalErrors: true })
      .map((r) => ({ value: r.value, path: ptrToSegs(r.pointer || '', json), parentProperty: r.parentProperty }));
  }

  function parseRef(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
    return U.fromPtr(ref.slice(1));
  }

  function resolveDocument(raw) {
    const origins = new WeakMap();
    let resolvedRoot;
    function note(v, rawPath) { if (v && typeof v === 'object') origins.set(v, rawPath.slice()); return v; }
    function copy(node, rawPath, refStack) {
      if (Array.isArray(node)) return note(node.map((v, i) => copy(v, rawPath.concat(i), refStack)), rawPath);
      if (!U.isObj(node)) return node;
      const refPath = parseRef(node.$ref);
      if (refPath) {
        const key = U.toPtr(refPath); const target = getAt(raw, refPath);
        if (refStack.indexOf(key) >= 0 || target === undefined) return note({ $ref: node.$ref }, rawPath);
        return copy(target, refPath, refStack.concat(key));
      }
      const out = {};
      note(out, rawPath);
      for (const k of Object.keys(node)) out[k] = copy(node[k], rawPath.concat(k), refStack);
      return out;
    }
    resolvedRoot = copy(raw, [], []);
    return {
      doc: resolvedRoot,
      originOf(pathSegs) {
        let cur = resolvedRoot;
        let best = origins.get(cur) || [];
        let depth = 0;
        for (let i = 0; i < pathSegs.length; i++) {
          if (cur === null || typeof cur !== 'object') break;
          cur = cur[pathSegs[i]];
          if (cur && typeof cur === 'object' && origins.has(cur)) { best = origins.get(cur); depth = i + 1; }
        }
        return best.concat(pathSegs.slice(depth));
      }
    };
  }

  function basename(fileName) { return U.basename(fileName || 'ruleset').replace(/\.(ya?ml|json)$/i, '') || 'ruleset'; }

  function severity(v) { return v === 0 || v === 'error' ? 'error' : v === 1 || v === 'warn' || v === 'warning' ? 'warning' : v === 2 || v === 3 || v === 'info' || v === 'hint' ? 'info' : v === 'off' || v === false ? 'off' : 'warning'; }

  function arr(v) { return Array.isArray(v) ? v : [v]; }
  function isRuleObj(v) { return U.isObj(v) && ('given' in v || 'then' in v || 'description' in v || 'severity' in v); }

  function aliasValue(name, aliases, unsupported) {
    const def = aliases ? aliases[name] : undefined;
    if (typeof def === 'string' || Array.isArray(def)) return arr(def).filter((x) => typeof x === 'string');
    if (def && typeof def === 'object' && def.targets) unsupported.push('El alias #' + name + ' usa targets con ambito, no soportado: se ignora');
    return [];
  }

  function expandGiven(given, aliases, unsupported) {
    const out = [];
    for (const g of arr(given)) {
      if (typeof g !== 'string') continue;
      if (g[0] !== '#') { out.push(g); continue; }
      const m = /^#([A-Za-z0-9_-]+)(.*)$/.exec(g);
      if (!m) continue;
      const suffix = m[2] || '';
      const values = aliasValue(m[1], aliases, unsupported);
      if (!values.length) unsupported.push('El alias #' + m[1] + ' no se puede expandir: se ignora');
      for (const base of values) out.push(base + suffix);
    }
    return out;
  }

  function normalizeThen(then) {
    return arr(then).filter(U.isObj).map((t) => ({ field: t.field, function: t.function, functionOptions: t.functionOptions }));
  }

  function parseRuleset(text, fileName) {
    let doc;
    const errors = [];
    const unsupported = [];
    try { doc = vendor.YAML.parse(text); } catch (e) { errors.push('YAML no válido: ' + e.message); }
    const base = { ok: false, name: basename(fileName), description: undefined, format: 'spectral', rules: [], errors, unsupported };
    if (errors.length) return base;
    if (!U.isObj(doc)) { errors.push('El ruleset debe ser un objeto.'); return base; }
    base.name = typeof doc['x-concord-name'] === 'string' ? doc['x-concord-name'] : basename(fileName);
    base.description = typeof doc.description === 'string' ? doc.description : undefined;
    if (doc.extends) unsupported.push('extends: ' + arr(doc.extends).join(', ') + ' no está disponible sin conexión; se ignora');
    if (doc.functions) unsupported.push('functions no está disponible sin conexión; las funciones personalizadas se omiten');
    if (doc.functionsDir) unsupported.push('functionsDir no está disponible sin conexión; se ignora');
    if (doc.overrides) unsupported.push('overrides no está soportado: no se aplica');
    if (!U.isObj(doc.rules)) { errors.push('El ruleset debe contener un mapa "rules".'); return base; }
    for (const id of Object.keys(doc.rules)) {
      const r = doc.rules[id];
      if (!isRuleObj(r)) {
        unsupported.push('La regla ' + id + ' es un atajo para una regla extendida; se ignora');
        continue;
      }
      const ruleUnsupported = [];
      const given = expandGiven(r.given, doc.aliases, unsupported); const then = normalizeThen(r.then);
      let supported = !!given.length && !!then.length; let reason = supported ? undefined : 'La regla no tiene given/then evaluable.';
      for (const t of then) {
        const fn = t.function;
        if (typeof fn !== 'string' || !CORE_FUNCTIONS[fn]) {
          reason = (/^oas|^unreferencedReusableObject$/.test(fn || '') ? 'La función ' + fn + ' depende de Spectral/OAS y no está soportada offline.' : 'La regla ' + id + ' usa la función personalizada ' + fn + ', no soportada: se omite');
          ruleUnsupported.push(reason);
          supported = false;
        }
      }
      unsupported.push.apply(unsupported, ruleUnsupported);
      base.rules.push({ id, description: r.description, message: r.message, severity: severity(r.severity), recommended: r.recommended !== false, given, then, resolved: r.resolved !== false, formats: Array.isArray(r.formats) ? r.formats.slice() : null, supported, reason, documentationUrl: r.documentationUrl });
    }
    base.ok = errors.length === 0;
    return base;
  }

  function valueText(v) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return String(s === undefined ? 'undefined' : s).slice(0, 100);
  }

  function renderMessage(rule, fnMsg, path, value) {
    const tpl = rule.message || fnMsg || rule.description || rule.id;
    const prop = path.length ? String(path[path.length - 1]) : '';
    return String(tpl)
      .replace(/\{\{error\}\}/g, fnMsg || '')
      .replace(/\{\{description\}\}/g, rule.description || '')
      .replace(/\{\{path\}\}/g, '#' + U.toPtr(path))
      .replace(/\{\{property\}\}/g, prop)
      .replace(/\{\{value\}\}/g, valueText(value));
  }

  function fieldTargets(match, then) {
    if (then.field === undefined) return [{ value: match.value, path: match.path }];
    if (then.field === '@key') {
      if (match.value === null || typeof match.value !== 'object') return [];
      return Object.keys(match.value).map((k) => ({ value: k, path: match.path.concat(k) }));
    }
    if (typeof then.field !== 'string') return [];
    if (then.field[0] === '$') return jsonPath(then.field, match.value).map((r) => ({ value: r.value, path: match.path.concat(r.path) }));
    const segs = then.field.split('.').filter(Boolean);
    return [{ value: getAt(match.value, segs), path: match.path.concat(segs) }];
  }

  function runRuleset(ruleset, doc, opts) {
    const prepared = opts && opts.resolved ? opts.resolved : resolveDocument(doc);
    const out = [];
    const seen = new Set();
    for (const rule of ruleset.rules || []) {
      if (rule.severity === 'off' || rule.supported === false) continue;
      try {
        const source = rule.resolved === false ? { doc, originOf: (p) => p } : prepared;
        for (const g of rule.given) for (const match of jsonPath(g, source.doc)) for (const then of rule.then) {
          const fn = CORE_FUNCTIONS[then.function];
          for (const target of fieldTargets(match, then)) {
            const fails = fn(target.value, then.functionOptions || {}, { path: target.path, document: source.doc }) || [];
            for (const f of fails) {
              const rel = Array.isArray(f.path) ? f.path : []; const rawPath = source.originOf(target.path.concat(rel));
              const msg = renderMessage(rule, f.message, rawPath, target.value); const key = rule.id + '|' + U.toPtr(rawPath) + '|' + msg;
              if (seen.has(key)) continue;
              seen.add(key); out.push({ ruleId: rule.id, severity: rule.severity, message: msg, path: rawPath, value: target.value });
            }
          }
        }
      } catch (e) {
        out.push({ ruleId: rule.id, severity: 'error', message: 'La regla ' + rule.id + ' no se pudo evaluar: ' + e.message, path: [], value: undefined });
      }
    }
    return out;
  }

  function fail(message, path) { return [{ message, path }]; }
  function valueLen(v) { return typeof v === 'string' || Array.isArray(v) ? v.length : U.isObj(v) ? Object.keys(v).length : typeof v === 'number' ? v : 0; }

  function makeRegex(v) { const s = String(v || ''); const m = /^\/(.*)\/([a-z]*)$/.exec(s); return m ? new RegExp(m[1], m[2]) : new RegExp(s); }

  function casingOk(s, opt) {
    if (opt.disallowDigits && /\d/.test(s)) return false;
    if (opt.separator && opt.separator.char && !opt.separator.allowLeading && s[0] === opt.separator.char) return false;
    const t = opt.type || 'camel';
    const map = {
      flat: /^[a-z][a-z0-9]*$/,
      camel: /^[a-z][A-Za-z0-9]*$/,
      pascal: /^[A-Z][A-Za-z0-9]*$/,
      kebab: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
      cobol: /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/,
      snake: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
      macro: /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
    };
    return (map[t] || map.camel).test(s);
  }

  function typeMatches(v, type) { return type === 'array' ? Array.isArray(v) : type === 'integer' ? Number.isInteger(v) : type === 'null' ? v === null : type === 'object' ? U.isObj(v) : type === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === type; }

  const CORE_FUNCTIONS = {
    truthy(v) { return v ? undefined : fail('debe tener un valor verdadero'); },
    falsy(v) { return v ? fail('debe estar vacío o ser falso') : undefined; },
    defined(v) { return v === undefined ? fail('debe estar definido') : undefined; },
    undefined(v) { return v === undefined ? undefined : fail('no debe estar definido'); },
    pattern(v, opt) {
      const text = String(v === undefined ? '' : v);
      if (opt.match && !makeRegex(opt.match).test(text)) return fail('debe cumplir el patrón ' + opt.match);
      if (opt.notMatch && makeRegex(opt.notMatch).test(text)) return fail('no debe cumplir el patrón ' + opt.notMatch);
      return undefined;
    },
    casing(v, opt) { return typeof v === 'string' && casingOk(v, opt || {}) ? undefined : fail('debe usar formato ' + ((opt || {}).type || 'camel')); },
    length(v, opt) {
      const n = valueLen(v);
      if (opt.min !== undefined && n < opt.min) return fail('debe tener longitud mínima ' + opt.min);
      if (opt.max !== undefined && n > opt.max) return fail('debe tener longitud máxima ' + opt.max);
      return undefined;
    },
    enumeration(v, opt) { return (opt.values || []).some((x) => U.deepEqual(x, v)) ? undefined : fail('debe ser uno de los valores permitidos'); },
    alphabetical(v, opt) {
      const values = Array.isArray(v) ? v.map((x) => opt.keyedBy && x ? x[opt.keyedBy] : x) : U.isObj(v) ? Object.keys(v) : [];
      const sorted = values.slice().sort((a, b) => String(a).localeCompare(String(b)));
      return U.deepEqual(values, sorted) ? undefined : fail('debe estar ordenado alfabéticamente');
    },
    schema(v, opt) {
      if (!opt.schema) return fail('schema requiere functionOptions.schema');
      const key = JSON.stringify({ schema: opt.schema, allErrors: opt.allErrors !== false }); let validate = schemaCache.get(key);
      if (!validate) { const Ajv = vendor.Ajv8 || vendor.Ajv; const ajv = new Ajv({ strict: false, allErrors: opt.allErrors !== false, validateFormats: true, unicodeRegExp: false }); if (vendor.addFormats) vendor.addFormats(ajv); validate = ajv.compile(opt.schema); schemaCache.set(key, validate); }
      return validate(v) ? undefined : (validate.errors || []).map((e) => ({ message: e.instancePath + ' ' + e.message }));
    },
    xor(v, opt) {
      const n = (opt.properties || []).filter((p) => getAt(v, String(p).split('.')) !== undefined).length;
      return n === 1 ? undefined : fail('debe definir exactamente una de: ' + (opt.properties || []).join(', '));
    },
    or(v, opt) {
      const n = (opt.properties || []).filter((p) => getAt(v, String(p).split('.')) !== undefined).length;
      return n >= 1 ? undefined : fail('debe definir al menos una de: ' + (opt.properties || []).join(', '));
    },
    typedEnum(v, opt) { const values = Array.isArray(v) ? v : U.isObj(v) && Array.isArray(v.enum) ? v.enum : []; const type = opt.type || (opt.schema && opt.schema.type) || (U.isObj(v) && v.type); return !type || !values.length || values.every((x) => typeMatches(x, type)) ? undefined : fail('los valores enum deben coincidir con el tipo ' + type); }
  };

  return { parseRuleset, runRuleset, resolveDocument, CORE_FUNCTIONS };
});
