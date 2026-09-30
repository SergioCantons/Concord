/* Operaciones de alto nivel sobre el contrato (endpoints, schemas, propiedades, componentes, tags).
 * Todas son atomicas (Project.mutate): se pueden deshacer y no dejan estados a medias. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./project.js'));
  else { root.OAT = root.OAT || {}; root.OAT.ops = factory(root.OAT.util, root.OAT.project); }
})(typeof self !== 'undefined' ? self : this, function (U, P) {
  'use strict';

  const METHODS = U.HTTP_METHODS;

  function pathParamsFromRoute(route) {
    const out = [];
    route.replace(/\{([^}]+)\}/g, (m, n) => { out.push(n); return m; });
    return out;
  }
  function operationIds(project) {
    const set = new Set();
    project.getModel().paths.forEach((p) => p.methods.forEach((m) => { if (m.operationId) set.add(m.operationId); }));
    return set;
  }
  function uniqueOperationId(project, base, ignore) {
    const used = operationIds(project);
    if (ignore) used.delete(ignore);
    if (!used.has(base)) return base;
    let i = 2;
    const stem = base + 'Copia';
    if (!used.has(stem)) return stem;
    while (used.has(stem + i)) i++;
    return stem + i;
  }
  function defaultOperationId(method, route) {
    const words = route.split('/').filter(Boolean).map((s) => s.replace(/[{}]/g, '')).reduce((a, s) => a.concat(s.split(/[^A-Za-z0-9]+/)), []).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    return method + words.join('');
  }
  function need(cond, msg) { if (!cond) throw new Error(msg); }
  function checkName(name, what) {
    need(typeof name === 'string' && name.trim(), 'El nombre de ' + what + ' no puede estar vacio');
  }

  /* ---------- Endpoints ---------- */
  function addPath(project, route) {
    need(typeof route === 'string' && route.startsWith('/'), 'La ruta debe empezar por "/"');
    need(!project.getModel().paths.some((p) => p.path === route), 'La ruta ya existe: ' + route);
    return project.mutate('Añadir ruta ' + route, (tx) => { tx.set(['paths', route], {}); });
  }
  function newOperationBody(project, route, method, opts) {
    opts = opts || {};
    const op = {};
    if (opts.tags && opts.tags.length) op.tags = opts.tags;
    op.summary = opts.summary || 'Nueva operación ' + method.toUpperCase();
    op.operationId = opts.operationId || uniqueOperationId(project, defaultOperationId(method, route));
    const params = pathParamsFromRoute(route);
    if (params.length) op.parameters = params.map((n) => ({ name: n, in: 'path', required: true, schema: { type: 'string' } }));
    op.responses = { '200': { description: 'Operación correcta' } };
    return op;
  }
  function addOperation(project, route, method, opts) {
    method = method.toLowerCase();
    need(METHODS.includes(method), 'Método HTTP no válido: ' + method);
    return project.mutate('Añadir ' + method.toUpperCase() + ' ' + route, (tx) => {
      const existing = project.read(['paths', route], true);
      if (existing === undefined) tx.set(['paths', route], {});
      need(!(existing && existing[method]), route + ' ya tiene el método ' + method.toUpperCase());
      tx.set(['paths', route, method], newOperationBody(project, route, method, opts));
    });
  }
  function duplicateOperation(project, route, method, opts) {
    opts = opts || {};
    const toRoute = opts.toRoute || route;
    const toMethod = (opts.toMethod || method).toLowerCase();
    need(toRoute !== route || toMethod !== method, 'Indica otra ruta u otro método para el duplicado');
    need(toRoute.startsWith('/'), 'La ruta debe empezar por "/"');
    return project.mutate('Duplicar ' + method.toUpperCase() + ' ' + route, (tx) => {
      const existing = project.read(['paths', toRoute], true);
      if (existing === undefined) tx.set(['paths', toRoute], {});
      need(!(existing && existing[toMethod]), toRoute + ' ya tiene el método ' + toMethod.toUpperCase());
      tx.copyNode(['paths', route, method], ['paths', toRoute, toMethod]);
      const orig = project.read(['paths', route, method], true) || {};
      const id = opts.operationId || uniqueOperationId(project, orig.operationId || defaultOperationId(toMethod, toRoute));
      tx.set(['paths', toRoute, toMethod, 'operationId'], id);
      const missing = pathParamsFromRoute(toRoute);
      if (missing.length && toRoute !== route) {
        const have = new Set(((orig.parameters) || []).filter((p) => p && p.in === 'path').map((p) => p.name));
        missing.filter((n) => !have.has(n)).forEach((n) => tx.push(['paths', toRoute, toMethod, 'parameters'], { name: n, in: 'path', required: true, schema: { type: 'string' } }));
      }
    });
  }
  function renameRoute(project, oldRoute, newRoute) {
    need(typeof newRoute === 'string' && newRoute.startsWith('/'), 'La ruta debe empezar por "/"');
    need(oldRoute === newRoute || !project.getModel().paths.some((p) => p.path === newRoute), 'La ruta ya existe: ' + newRoute);
    return project.mutate('Renombrar ruta ' + oldRoute, (tx) => { tx.renameWithRefs(['paths'], oldRoute, newRoute); });
  }
  function changeMethod(project, route, oldMethod, newMethod) {
    newMethod = newMethod.toLowerCase();
    need(METHODS.includes(newMethod), 'Método HTTP no válido');
    const item = project.read(['paths', route], true) || {};
    need(!item[newMethod], route + ' ya tiene el método ' + newMethod.toUpperCase());
    return project.mutate('Cambiar método ' + oldMethod.toUpperCase(), (tx) => { tx.renameKey(['paths', route], oldMethod, newMethod); });
  }
  function deleteOperation(project, route, method) {
    return project.mutate('Eliminar ' + method.toUpperCase() + ' ' + route, (tx) => { tx.del(['paths', route, method]); });
  }
  function deletePath(project, route) {
    return project.mutate('Eliminar ruta ' + route, (tx) => { tx.del(['paths', route]); });
  }
  function setOperationTags(project, route, method, tags) {
    return project.mutate('Cambiar tags', (tx) => { tx.set(['paths', route, method, 'tags'], tags.length ? tags : undefined); });
  }
  function renameTag(project, oldName, newName) {
    need(newName && newName.trim(), 'El nombre del tag no puede estar vacio');
    return project.mutate('Renombrar tag ' + oldName, (tx) => {
      const tags = project.read(['tags'], true) || [];
      tags.forEach((t, i) => { if (t && t.name === oldName) tx.set(['tags', i, 'name'], newName); });
      project.getModel().paths.forEach((pi) => pi.methods.forEach((m) => {
        const i = m.tags.indexOf(oldName);
        if (i >= 0) tx.set(['paths', pi.path, m.method, 'tags', i], newName);
      }));
    });
  }

  /* ---------- Componentes y schemas ---------- */
  function componentRef(project, holderLogical, type, name) {
    const target = project.phys(['components', type, name], false);
    need(!target.error, 'No se puede resolver components.' + type + '.' + name);
    const holder = project.phys(holderLogical.slice(0, -1), true);
    const from = holder.error ? project.rootFile : holder.file;
    return project.makeRef(from, target.file, target.path);
  }
  function describeUsage(project, u) {
    const holder = u.path.slice(0, -1);
    const logical = project.toLogical(u.file, holder);
    return { file: u.file, yamlPath: U.fmtPath(u.path), logical, label: logical ? U.fmtPath(logical) : u.file + ': ' + U.fmtPath(holder), ref: u.ref };
  }
  function componentConsumers(project, type, name) {
    return project.usagesOfLogical(['components', type, name]).map((u) => describeUsage(project, u));
  }
  function addComponent(project, type, name, value) {
    checkName(name, 'componente');
    need(/^[A-Za-z0-9._-]+$/.test(name), 'El nombre solo admite letras, numeros, punto, guion y guion bajo');
    need(project.read(['components', type, name], false) === undefined, 'Ya existe ' + name);
    return project.mutate('Crear ' + type + ' ' + name, (tx) => { tx.set(['components', type, name], value); });
  }
  function addSchema(project, name, kind) {
    const body = kind === 'array' ? { type: 'array', items: { type: 'string' } } : kind === 'string' ? { type: 'string' } : kind === 'enum' ? { type: 'string', enum: ['valor1', 'valor2'] } : { type: 'object', properties: {} };
    return addComponent(project, 'schemas', name, body);
  }
  function duplicateComponentAs(project, type, name, newName) {
    need(/^[A-Za-z0-9._-]+$/.test(newName), 'El nombre solo admite letras, numeros, punto, guion y guion bajo');
    return project.mutate('Duplicar ' + name, (tx) => { tx.duplicate(['components', type], name, newName); });
  }
  function renameComponent(project, type, name, newName) {
    need(/^[A-Za-z0-9._-]+$/.test(newName), 'El nombre solo admite letras, numeros, punto, guion y guion bajo');
    return project.mutate('Renombrar ' + name + ' a ' + newName, (tx) => tx.renameWithRefs(['components', type], name, newName));
  }
  /** Elimina un componente; si tiene consumidores y no se fuerza, lanza un error con la lista. */
  function deleteComponent(project, type, name, opts) {
    const consumers = componentConsumers(project, type, name);
    if (consumers.length && !(opts && opts.force)) {
      const e = new Error('"' + name + '" esta referenciado en ' + consumers.length + ' sitio(s)');
      e.consumers = consumers;
      throw e;
    }
    return project.mutate('Eliminar ' + name, (tx) => { tx.del(['components', type, name]); });
  }
  function extractInline(project, logical, name) {
    need(/^[A-Za-z0-9._-]+$/.test(name), 'El nombre solo admite letras, numeros, punto, guion y guion bajo');
    return project.mutate('Extraer schema ' + name, (tx) => tx.extractToComponent(logical, 'schemas', name));
  }
  function setRef(project, logical, type, name) {
    return project.mutate('Insertar referencia a ' + name, (tx) => { tx.set(logical, { $ref: componentRef(project, logical, type, name) }); });
  }

  /* ---------- Propiedades ---------- */
  function addProperty(project, schemaLogical, name, def, required) {
    checkName(name, 'propiedad');
    const props = project.read(schemaLogical.concat(['properties']), true);
    need(!(props && Object.prototype.hasOwnProperty.call(props, name)), 'Ya existe la propiedad ' + name);
    return project.mutate('Añadir propiedad ' + name, (tx) => {
      tx.set(schemaLogical.concat(['properties', name]), def || { type: 'string' });
      if (required) tx.push(schemaLogical.concat(['required']), name);
    });
  }
  function renameProperty(project, schemaLogical, oldName, newName) {
    checkName(newName, 'propiedad');
    return project.mutate('Renombrar propiedad ' + oldName, (tx) => {
      tx.renameKey(schemaLogical.concat(['properties']), oldName, newName);
      const req = project.read(schemaLogical.concat(['required']), true);
      if (Array.isArray(req)) { const i = req.indexOf(oldName); if (i >= 0) tx.set(schemaLogical.concat(['required', i]), newName); }
    });
  }
  function deleteProperty(project, schemaLogical, name) {
    return project.mutate('Eliminar propiedad ' + name, (tx) => {
      tx.del(schemaLogical.concat(['properties', name]));
      const req = project.read(schemaLogical.concat(['required']), true);
      if (Array.isArray(req)) {
        const next = req.filter((r) => r !== name);
        tx.set(schemaLogical.concat(['required']), next.length ? next : undefined);
      }
    });
  }
  function moveProperty(project, schemaLogical, name, delta) {
    return project.mutate('Reordenar propiedad ' + name, (tx) => { tx.reorder(schemaLogical.concat(['properties']), name, delta); });
  }
  function setRequired(project, schemaLogical, name, on) {
    return project.mutate('Cambiar obligatoriedad de ' + name, (tx) => {
      const req = (project.read(schemaLogical.concat(['required']), true) || []).slice();
      const i = req.indexOf(name);
      if (on && i < 0) req.push(name); else if (!on && i >= 0) req.splice(i, 1);
      tx.set(schemaLogical.concat(['required']), req.length ? req : undefined);
    }, { coalesce: false });
  }

  return {
    METHODS, pathParamsFromRoute, operationIds, uniqueOperationId, defaultOperationId, addPath, addOperation, duplicateOperation, renameRoute, changeMethod,
    deleteOperation, deletePath, setOperationTags, renameTag, componentRef, describeUsage, componentConsumers, addComponent, addSchema,
    duplicateComponent: duplicateComponentAs, renameComponent, deleteComponent, extractInline, setRef, addProperty, renameProperty, deleteProperty,
    moveProperty, setRequired, newOperationBody
  };
});
