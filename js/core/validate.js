/* Validacion en niveles: sintaxis YAML, referencias, estructura OpenAPI 3.0 (esquema oficial + Ajv) y reglas propias. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./project.js'), require('./bundle.js'), require('./vendor.js'));
  else { root.OAT = root.OAT || {}; root.OAT.validate = factory(root.OAT.util, root.OAT.project, root.OAT.bundle, root.OAT.vendor); }
})(typeof self !== 'undefined' ? self : this, function (U, P, B, vendor) {
  'use strict';

  const DEFAULT_CONFIG = { structural: true, rules: {}, rulesets: [] };

  /**
   * Catálogo de reglas de serie. `locked`: siempre activas con su severidad (sintaxis, referencias y estructura OpenAPI);
   * el resto admite cambiar la severidad o desactivarse ('off'). `codes` agrupa los códigos de diagnóstico que emite la regla.
   */
  const BUILTIN_RULES = [
    { id: 'yaml-syntax', category: 'YAML', severity: 'error', locked: true, codes: ['yaml-syntax', 'yaml-draft'], title: 'Sintaxis YAML válida', description: 'Cada fichero debe ser YAML o JSON bien formado. Un borrador inválido del editor YAML no se aplica hasta corregirlo.' },
    { id: 'refs', category: 'Referencias', severity: 'error', locked: true, codes: ['ref-missing-file', 'ref-missing-pointer', 'ref-remote', 'ref-outside', 'ref-anchor', 'ref-loop', 'ref-kind'], title: 'Referencias ($ref) resolubles', description: 'Todo $ref debe apuntar a un fichero de la carpeta del proyecto y a un destino existente del tipo adecuado (un parámetro a components/parameters, un schema a components/schemas...). Las referencias remotas no se permiten.', example: { valid: '$ref: "#/components/schemas/Producto"', invalid: '$ref: "#/components/schemas/NoExiste"' } },
    { id: 'structure', category: 'Estructura', severity: 'error', locked: true, codes: ['no-root', 'root-not-object', 'oas-version', 'oas31', 'truncated'], prefix: 'oas-', title: 'Estructura OpenAPI 3.0', description: 'El contrato debe cumplir el esquema oficial de OpenAPI 3.0 (campos obligatorios, tipos, nombres de componentes...).' },
    { id: 'ref-siblings', category: 'Referencias', severity: 'warning', title: 'Sin propiedades junto a $ref', description: 'En OpenAPI 3.0 las propiedades hermanas de un $ref se ignoran; conviene moverlas al destino.', example: { valid: 'schema:\n  $ref: "#/components/schemas/Id"', invalid: 'schema:\n  $ref: "#/components/schemas/Id"\n  description: Se ignora' } },
    { id: 'path-format', category: 'Rutas', severity: 'error', title: 'Las rutas empiezan por "/"', description: 'Cada clave de paths debe empezar por una barra.', example: { valid: '/productos:', invalid: 'productos:' } },
    { id: 'path-duplicate', category: 'Rutas', severity: 'error', title: 'Rutas no duplicadas', description: 'Dos rutas que solo difieren en el nombre de sus parámetros son la misma ruta.', example: { valid: '/productos/{id}:', invalid: '/productos/{id}:\n/productos/{productoId}:' } },
    { id: 'param-duplicate', category: 'Parámetros', severity: 'error', title: 'Parámetros no duplicados', description: 'Una operación no puede declarar dos veces el mismo parámetro (mismo nombre y ubicación).' },
    { id: 'path-param-missing', category: 'Parámetros', severity: 'error', title: 'Parámetros de ruta declarados', description: 'Cada {parámetro} de la ruta debe declararse como parámetro in: path.', example: { valid: '/productos/{id}:\n  get:\n    parameters:\n      - name: id\n        in: path\n        required: true', invalid: '/productos/{id}:\n  get:\n    parameters: []' } },
    { id: 'path-param-unused', category: 'Parámetros', severity: 'error', title: 'Parámetros de ruta usados', description: 'Un parámetro in: path debe aparecer en la ruta.' },
    { id: 'path-param-required', category: 'Parámetros', severity: 'error', title: 'Parámetros de ruta obligatorios', description: 'Los parámetros in: path deben tener required: true.' },
    { id: 'opid-duplicate', category: 'Operaciones', severity: 'error', title: 'operationId único', description: 'Cada operación debe tener un operationId distinto.' },
    { id: 'opid-missing', category: 'Operaciones', severity: 'off', title: 'operationId obligatorio', description: 'Todas las operaciones deben definir operationId.' },
    { id: 'body-in-get', category: 'Operaciones', severity: 'warning', title: 'Sin requestBody en GET/HEAD', description: 'Un cuerpo de petición en GET o HEAD no tiene semántica definida.' },
    { id: 'tag-undefined', category: 'Tags', severity: 'warning', title: 'Tags declarados', description: 'Los tags usados en las operaciones deben declararse en la lista tags del contrato.' },
    { id: 'tag-single', category: 'Tags', severity: 'off', title: 'Un único tag por operación', description: 'Cada operación debe tener exactamente un tag.' },
    { id: 'response-code', category: 'Respuestas', severity: 'error', title: 'Códigos de respuesta válidos', description: 'Las respuestas usan códigos HTTP de 100 a 599, rangos como 2XX o "default".', example: { valid: '"404":', invalid: '"99":' } },
    { id: 'media-type', category: 'Contenido', severity: 'warning', title: 'Media types bien formados', description: 'Los tipos de contenido siguen el formato tipo/subtipo.', example: { valid: 'application/json:', invalid: 'json:' } },
    { id: 'security-undefined', category: 'Seguridad', severity: 'error', title: 'Esquemas de seguridad definidos', description: 'Los requisitos de seguridad solo pueden usar esquemas declarados en components.securitySchemes.' }
  ];
  const RULE_BY_CODE = new Map();
  BUILTIN_RULES.forEach((r) => (r.codes || [r.id]).forEach((c) => RULE_BY_CODE.set(c, r)));
  const ruleOf = (code) => RULE_BY_CODE.get(code) || BUILTIN_RULES.find((r) => r.prefix && String(code).startsWith(r.prefix)) || null;
  const SEVERITIES = ['error', 'warning', 'info', 'off'];

  /** Traduce los ajustes antiguos (opIdUnique, opIdRequired, singleTag, tagsMustExist) al mapa de severidades por regla. */
  function legacyRules(s) {
    const out = {};
    if (!s) return out;
    if (s.opIdUnique && s.opIdUnique !== 'error') out['opid-duplicate'] = s.opIdUnique;
    if (s.opIdRequired) out['opid-missing'] = 'error';
    if (s.singleTag) out['tag-single'] = 'warning';
    if (s.tagsMustExist === false) out['tag-undefined'] = 'off';
    return out;
  }

  let validatorFn = null;
  function getValidator() {
    if (!validatorFn) {
      const ajv = new vendor.Ajv({ strict: false, allErrors: true, validateFormats: true });
      vendor.addFormats(ajv);
      validatorFn = ajv.compile(vendor.oas30Schema);
    }
    return validatorFn;
  }

  function ptrToSegs(p) { return p ? p.split('/').slice(1).map(U.unescPtr) : []; }
  function resolveInternal(js, ref) {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
    let cur = js;
    for (const s of ptrToSegs(ref.slice(1))) { if (cur === null || typeof cur !== 'object') return undefined; cur = cur[s]; }
    return cur;
  }

  const TYPE_ES = { object: 'un objeto', array: 'una lista', string: 'texto', number: 'un número', integer: 'un entero', boolean: 'verdadero/falso' };
  function translate(err) {
    const k = err.keyword; const p = err.params || {};
    switch (k) {
      case 'required': return { msg: 'Falta la propiedad obligatoria "' + p.missingProperty + '"', sug: 'Añade "' + p.missingProperty + '" en este objeto.', loc: 'self' };
      case 'additionalProperties':
        if (/Reference/.test(err.schemaPath)) return { msg: 'Junto a $ref no se permiten otras propiedades ("' + p.additionalProperty + '")', sug: 'Elimina la propiedad o quita el $ref.', loc: 'child', child: p.additionalProperty };
        if (/\/components\/[^/]+$/.test(err.instancePath)) return { msg: 'Nombre de componente no válido "' + p.additionalProperty + '"', sug: 'Usa solo letras, numeros, punto, guion y guion bajo.', loc: 'child', child: p.additionalProperty };
        return { msg: 'Propiedad no permitida "' + p.additionalProperty + '"', sug: 'Eliminala, corrige el nombre o usa el prefijo x- para extensiones propias.', loc: 'child', child: p.additionalProperty };
      case 'type': return { msg: 'Debe ser ' + (TYPE_ES[p.type] || p.type), sug: 'Cambia el valor por uno de tipo ' + p.type + '.', loc: 'self' };
      case 'enum': return { msg: 'Valor no permitido. Valores válidos: ' + (p.allowedValues || []).join(', '), sug: 'Elige uno de los valores válidos.', loc: 'self' };
      case 'pattern': return { msg: 'No cumple el patron ' + p.pattern, sug: 'Revisa el formato del valor.', loc: 'self' };
      case 'format': return { msg: 'Formato no válido (' + p.format + ')', sug: 'Revisa el formato del valor.', loc: 'self' };
      case 'minProperties': return { msg: 'Debe contener al menos ' + p.limit + ' elemento(s)', sug: 'Añade al menos un elemento.', loc: 'self' };
      case 'minItems': return { msg: 'Debe contener al menos ' + p.limit + ' elemento(s)', sug: 'Añade elementos a la lista.', loc: 'self' };
      case 'uniqueItems': return { msg: 'Los elementos de la lista deben ser únicos', sug: 'Elimina los duplicados.', loc: 'self' };
      case 'minimum': case 'maximum': case 'exclusiveMinimum': return { msg: 'Valor fuera de rango (' + err.message + ')', sug: 'Corrige el valor.', loc: 'self' };
      default: return { msg: err.message, sug: 'Revisa la especificación OpenAPI 3.0 para este campo.', loc: 'self' };
    }
  }

  /** Motor Spectral: global en el navegador, módulo en Node (se carga solo si hay conjuntos de reglas). */
  function spectralLib() {
    if (typeof self !== 'undefined' && self.OAT && self.OAT.spectral) return self.OAT.spectral;
    return require('./spectral.js');
  }

  function effectiveSeverity(rule, overrides) {
    const o = overrides && overrides[rule.id];
    return !rule.locked && SEVERITIES.includes(o) ? o : rule.severity;
  }

  function validateProject(project, userConfig) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
    const overrides = Object.assign(legacyRules(userConfig), cfg.rules || {});
    const diags = [];
    const add = (d) => {
      const rule = d.rule ? null : ruleOf(d.code);
      if (rule) {
        d.rule = rule.id;
        if (!rule.locked) { const s = effectiveSeverity(rule, overrides); if (s === 'off') return; d.severity = s; }
      }
      if (d.file && !d.line) { const l = project.locate(d.file, d.path || []); d.line = l.line; d.col = l.col; }
      d.id = diags.length + 1;
      diags.push(d);
    };
    const addJs = (bundle, segs, d) => { const o = bundle.originOf(segs); add(Object.assign({ file: o.file, path: o.path, jsPath: segs }, d)); };

    /* 1. Sintaxis */
    for (const [file, f] of project.files) {
      for (const e of f.errors) add({ severity: e.severity, code: 'yaml-syntax', category: 'YAML', message: e.message, file, path: [], line: e.line, col: e.col, suggestion: 'Corrige la sintaxis YAML en la línea ' + e.line + ', columna ' + e.col + '.' });
      if (f.draft) for (const e of f.draft.errors) add({ severity: 'error', code: 'yaml-draft', category: 'YAML', message: 'Borrador sin aplicar: ' + e.message, file, path: [], line: e.line, col: e.col, suggestion: 'El editor visual conserva el ultimo YAML válido; corrige el borrador para aplicarlo.' });
    }

    const rf = project.file(project.rootFile);
    if (!rf) { add({ severity: 'error', code: 'no-root', category: 'Proyecto', message: 'No hay fichero raíz.', suggestion: 'Abre o crea un contrato.' }); return finish(null); }
    const bundle = B.bundleProject(project);
    const js = bundle.js;
    if (!U.isObj(js)) {
      add({ severity: 'error', code: 'root-not-object', category: 'Estructura', message: 'El fichero raíz no contiene un objeto OpenAPI.', file: project.rootFile, path: [], suggestion: 'El documento debe empezar por "openapi: 3.0.3" y contener "info" y "paths".' });
      return finish(bundle);
    }

    /* 2. Referencias */
    for (const r of project.refIndex()) {
      if (r.error) {
        const sug = { 'missing-file': 'Crea el fichero, corrige la ruta relativa o ajusta el $ref.', 'missing-pointer': 'Comprueba que el destino existe y que el puntero JSON es correcto (~1 representa /).', remote: 'Descarga el fichero y referencialo en local.', outside: 'Mueve el fichero dentro de la carpeta del proyecto.', anchor: 'Usa un puntero JSON que empiece por #/.', loop: 'Rompe la cadena de referencias.' }[r.error] || 'Corrige la referencia.';
        add({ severity: 'error', code: 'ref-' + r.error, category: 'Referencias', message: 'Referencia rota "' + r.ref + '": ' + r.message, file: r.file, path: r.path, suggestion: sug });
      } else if (r.kind === '$ref') {
        const holder = r.path.slice(0, -1);
        const m = /(?:^|\/)components\/([^/]+)\//.exec(r.ref.slice(r.ref.indexOf('#') + 1));
        if (m) {
          const last = holder[holder.length - 1]; const prev = holder[holder.length - 2];
          let want = null;
          if (last === 'schema' || last === 'items' || last === 'additionalProperties' || last === 'not' || ['allOf', 'oneOf', 'anyOf', 'properties'].includes(prev)) want = 'schemas';
          else if (prev === 'parameters' && typeof last === 'number') want = 'parameters';
          else if (prev === 'responses') want = 'responses';
          else if (last === 'requestBody') want = 'requestBodies';
          else if (prev === 'headers') want = 'headers';
          else if (prev === 'examples') want = 'examples';
          else if (prev === 'links') want = 'links';
          else if (prev === 'callbacks') want = 'callbacks';
          if (want && m[1] !== want) add({ severity: 'error', code: 'ref-kind', category: 'Referencias', message: 'Referencia incompatible: se esperaba components/' + want + ' y apunta a components/' + m[1], file: r.file, path: r.path, suggestion: 'Apunta a un componente de tipo ' + want + '.' });
        }
      }
    }
    for (const n of bundle.notes) add({ severity: 'warning', code: n.code, category: 'Referencias', message: n.message, file: n.file, path: n.path, suggestion: 'Mueve esas propiedades al destino de la referencia.' });

    /* 3. Version y estructura */
    const ver = String(js.openapi === undefined ? '' : js.openapi);
    let is30 = /^3\.0\.\d+$/.test(ver);
    if (/^3\.1\.\d+$/.test(ver)) add({ severity: 'warning', code: 'oas31', category: 'Estructura', message: 'OpenAPI ' + ver + ' no esta totalmente soportado: se omite la validación estructural y solo se aplican las reglas comunes.', file: project.rootFile, path: ['openapi'], suggestion: 'Usa OpenAPI 3.0.x para una validación completa.' });
    else if (!is30) add({ severity: 'error', code: 'oas-version', category: 'Estructura', message: ver ? 'Versión de OpenAPI no soportada: ' + ver : 'Falta el campo "openapi"', file: project.rootFile, path: ['openapi'], suggestion: 'Declara "openapi: 3.0.3".' });

    if (is30 && cfg.structural) {
      const validate = getValidator();
      validate(js);
      const errs = (validate.errors || []).filter((e) => !(e.keyword === 'additionalProperties' && e.params && e.params.additionalProperty === '$ref'));
      const byPath = new Map();
      for (const e of errs) { if (!byPath.has(e.instancePath)) byPath.set(e.instancePath, []); byPath.get(e.instancePath).push(e); }
      const seen = new Set();
      let count = 0;
      for (const [ip, list] of byPath) {
        let keep = list.filter((e) => !['oneOf', 'anyOf', 'if', 'not', 'allOf'].includes(e.keyword));
        if (keep.some((e) => !/Reference/.test(e.schemaPath))) keep = keep.filter((e) => !/Reference/.test(e.schemaPath) || e.keyword === 'additionalProperties');
        if (!keep.length) keep = list.slice(0, 1).map((e) => Object.assign({}, e, { keyword: '_generic', message: 'No cumple ninguna de las variantes permitidas' }));
        for (const e of keep) {
          if (e.keyword === 'additionalProperties' && /\/responses$/.test(ip)) continue;
          const t = e.keyword === '_generic' ? { msg: e.message, sug: 'Revisa la estructura de este elemento.', loc: 'self' } : translate(e);
          const segs = ptrToSegs(ip);
          const target = t.loc === 'child' ? segs.concat([t.child]) : segs;
          const key = ip + '|' + t.msg;
          if (seen.has(key)) continue;
          seen.add(key);
          if (++count > 300) break;
          addJs(bundle, target, { severity: 'error', code: 'oas-' + e.keyword, category: 'Estructura', message: t.msg, suggestion: t.sug });
        }
      }
      if (count > 300) add({ severity: 'info', code: 'truncated', category: 'Estructura', message: 'Se muestran solo los primeros 300 errores estructurales.', file: project.rootFile, path: [] });
    }

    /* 4. Reglas propias */
    const paths = U.isObj(js.paths) ? js.paths : {};
    const routeMap = new Map();
    const opIds = new Map();
    const tagNames = new Set((Array.isArray(js.tags) ? js.tags : []).map((t) => t && t.name));
    const schemes = U.isObj(js.components) && U.isObj(js.components.securitySchemes) ? js.components.securitySchemes : {};
    const resolveItem = (it) => (U.isObj(it) && typeof it.$ref === 'string' ? resolveInternal(js, it.$ref) : it);
    const checkSecurity = (sec, segs) => {
      if (!Array.isArray(sec)) return;
      sec.forEach((req, i) => { if (U.isObj(req)) for (const name of Object.keys(req)) if (!(name in schemes)) addJs(bundle, segs.concat([i, name]), { severity: 'error', code: 'security-undefined', category: 'Seguridad', message: 'El esquema de seguridad "' + name + '" no esta definido en components.securitySchemes', suggestion: 'Define el esquema o corrige el nombre.' }); });
    };
    checkSecurity(js.security, ['security']);

    for (const route of Object.keys(paths)) {
      if (route.startsWith('x-')) continue;
      const item = paths[route];
      if (!route.startsWith('/')) addJs(bundle, ['paths', route], { severity: 'error', code: 'path-format', category: 'Rutas', message: 'La ruta "' + route + '" debe empezar por "/"', suggestion: 'Renombra la ruta.' });
      const norm = route.replace(/\{[^}]*\}/g, '{}');
      if (!routeMap.has(norm)) routeMap.set(norm, []);
      routeMap.get(norm).push(route);
      if (!U.isObj(item)) continue;
      const shared = Array.isArray(item.parameters) ? item.parameters.map(resolveItem).filter(U.isObj) : [];
      const templ = [];
      route.replace(/\{([^}]*)\}/g, (m, n) => { templ.push(n); return m; });
      for (const method of U.HTTP_METHODS) {
        const op = item[method];
        if (!U.isObj(op)) continue;
        const base = ['paths', route, method];
        const own = Array.isArray(op.parameters) ? op.parameters.map(resolveItem).filter(U.isObj) : [];
        const eff = new Map();
        shared.forEach((p) => eff.set(p.in + ':' + p.name, p));
        own.forEach((p) => eff.set(p.in + ':' + p.name, p));
        const seenP = new Set();
        (Array.isArray(op.parameters) ? op.parameters : []).forEach((raw, i) => {
          const p = resolveItem(raw);
          if (!U.isObj(p)) return;
          const key = p.in + ':' + p.name;
          if (seenP.has(key)) addJs(bundle, base.concat(['parameters', i]), { severity: 'error', code: 'param-duplicate', category: 'Parámetros', message: 'Parámetro duplicado "' + p.name + '" en ' + p.in, suggestion: 'Elimina uno de los dos parámetros.' });
          seenP.add(key);
        });
        for (const n of templ) {
          const p = eff.get('path:' + n);
          if (!p) addJs(bundle, base, { severity: 'error', code: 'path-param-missing', category: 'Parámetros', message: 'El parámetro de ruta {' + n + '} no esta declarado en ' + method.toUpperCase() + ' ' + route, suggestion: 'Añade un parámetro in: path llamado "' + n + '" con required: true.', fix: { type: 'add-path-param', name: n } });
        }
        for (const p of eff.values()) {
          if (p.in !== 'path') continue;
          if (!templ.includes(p.name)) addJs(bundle, base.concat(['parameters']), { severity: 'error', code: 'path-param-unused', category: 'Parámetros', message: 'El parámetro de ruta "' + p.name + '" no aparece en la ruta ' + route, suggestion: 'Añade {' + p.name + '} a la ruta o elimina el parámetro.' });
          else if (p.required !== true) addJs(bundle, base.concat(['parameters']), { severity: 'error', code: 'path-param-required', category: 'Parámetros', message: 'El parámetro de ruta "' + p.name + '" debe tener required: true', suggestion: 'Marca el parámetro como obligatorio.' });
        }
        if (typeof op.operationId === 'string' && op.operationId) {
          if (!opIds.has(op.operationId)) opIds.set(op.operationId, []);
          opIds.get(op.operationId).push(base);
        } else addJs(bundle, base, { severity: 'error', code: 'opid-missing', category: 'Operaciones', message: 'La operación no tiene operationId', suggestion: 'Define un operationId único.' });
        const tags = Array.isArray(op.tags) ? op.tags : [];
        tags.forEach((t, i) => { if (!tagNames.has(t)) addJs(bundle, base.concat(['tags', i]), { severity: 'warning', code: 'tag-undefined', category: 'Tags', message: 'El tag "' + t + '" no esta declarado en tags', suggestion: 'Declara el tag a nivel de contrato o corrige el nombre.' }); });
        if (tags.length !== 1) addJs(bundle, base.concat(['tags']), { severity: 'warning', code: 'tag-single', category: 'Tags', message: 'Cada operación debe tener exactamente un tag (tiene ' + tags.length + ')', suggestion: 'Deja un único tag.' });
        if (op.requestBody && (method === 'get' || method === 'head')) addJs(bundle, base.concat(['requestBody']), { severity: 'warning', code: 'body-in-get', category: 'Operaciones', message: 'Un requestBody en ' + method.toUpperCase() + ' no tiene semántica definida', suggestion: 'Usa parámetros de consulta o cambia el método.' });
        if (U.isObj(op.responses)) {
          for (const code of Object.keys(op.responses)) {
            if (code.startsWith('x-')) continue;
            if (!/^([1-5]\d\d|[1-5]XX|default)$/.test(code)) addJs(bundle, base.concat(['responses', code]), { severity: 'error', code: 'response-code', category: 'Respuestas', message: 'Código de respuesta no válido "' + code + '"', suggestion: 'Usa un código HTTP de 100 a 599, un rango como 2XX o "default".' });
          }
        }
        const mediaCheck = (content, segs) => {
          if (!U.isObj(content)) return;
          for (const mt of Object.keys(content)) if (!/^[\w!#$&^.+*-]+\/[\w!#$&^.+*-]+(\s*;.*)?$/.test(mt)) addJs(bundle, segs.concat([mt]), { severity: 'warning', code: 'media-type', category: 'Contenido', message: 'Media type sospechoso "' + mt + '"', suggestion: 'Usa el formato tipo/subtipo, por ejemplo application/json.' });
        };
        if (U.isObj(op.requestBody)) mediaCheck(op.requestBody.content, base.concat(['requestBody', 'content']));
        if (U.isObj(op.responses)) for (const code of Object.keys(op.responses)) if (U.isObj(op.responses[code])) mediaCheck(op.responses[code].content, base.concat(['responses', code, 'content']));
        checkSecurity(op.security, base.concat(['security']));
      }
    }
    for (const [, list] of routeMap) if (list.length > 1) list.forEach((r) => addJs(bundle, ['paths', r], { severity: 'error', code: 'path-duplicate', category: 'Rutas', message: 'Ruta duplicada o equivalente: ' + list.join(' y '), suggestion: 'Unifica las rutas; los nombres de parámetro no distinguen rutas.' }));
    for (const [id, list] of opIds) if (list.length > 1) list.forEach((b) => addJs(bundle, b.concat(['operationId']), { severity: 'error', code: 'opid-duplicate', category: 'Operaciones', message: 'operationId duplicado "' + id + '" (' + list.map((x) => x[2].toUpperCase() + ' ' + x[1]).join(', ') + ')', suggestion: 'Usa un operationId distinto en cada operación.' }));

    /* 5. Conjuntos de reglas propios (Spectral) */
    const active = (cfg.rulesets || []).filter((rs) => rs && rs.enabled !== false && rs.ruleset && Array.isArray(rs.ruleset.rules) && rs.ruleset.rules.length);
    if (active.length) {
      const S = spectralLib();
      const resolved = S.resolveDocument(js);
      for (const rs of active) {
        const over = rs.rules || {};
        const rules = rs.ruleset.rules.map((r) => (SEVERITIES.includes(over[r.id]) ? Object.assign({}, r, { severity: over[r.id] }) : r));
        const byId = new Map(rules.map((r) => [r.id, r]));
        for (const res of S.runRuleset(Object.assign({}, rs.ruleset, { rules }), js, { resolved })) {
          const r = byId.get(res.ruleId);
          const desc = r && r.description && r.description !== res.message ? r.description : '';
          addJs(bundle, res.path || [], { rule: rs.id + '#' + res.ruleId, ruleset: rs.id, severity: res.severity, code: res.ruleId, category: rs.name || 'Reglas propias', message: res.message, suggestion: desc });
        }
      }
    }

    return finish(bundle);

    function finish(b) {
      const order = { error: 0, warning: 1, info: 2 };
      diags.sort((x, y) => order[x.severity] - order[y.severity] || String(x.file).localeCompare(String(y.file)) || (x.line || 0) - (y.line || 0));
      diags.forEach((d, i) => { d.id = i + 1; });
      const stats = { errors: 0, warnings: 0, infos: 0 };
      diags.forEach((d) => { if (d.severity === 'error') stats.errors++; else if (d.severity === 'warning') stats.warnings++; else stats.infos++; });
      return { diagnostics: diags, stats, bundle: b, version: project.version };
    }
  }

  return { validateProject, DEFAULT_CONFIG, BUILTIN_RULES, SEVERITIES, ruleOf, effectiveSeverity, legacyRules, resolveInternal };
});
