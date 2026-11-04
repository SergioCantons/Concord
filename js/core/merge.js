/* Fusion de contratos: traslada cambios detectados por el comparador de un proyecto (origen) a otro (destino).
 * Cada cambio se convierte en una operacion sobre el destino con la granularidad mas fina segura:
 * la ruta exacta del cambio si existe tal cual en ambos contratos o, si no, el ancestro real mas cercano
 * (parametro, respuesta, operacion, componente...). Los $ref se reescriben para el fichero donde se escribe
 * el valor, los componentes y tags que falten en el destino se copian tambien (dependencias) y todo se
 * aplica en una sola edicion del destino, de modo que se deshace en un paso. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./bundle.js'));
  else { root.OAT = root.OAT || {}; root.OAT.merge = factory(root.OAT.util, root.OAT.bundle); }
})(typeof self !== 'undefined' ? self : this, function (U, B) {
  'use strict';

  const isObj = U.isObj;
  const isRefObj = (v) => isObj(v) && typeof v.$ref === 'string';
  const paramKey = (p) => (p.in || '?') + ':' + (p.name || '?');
  const MERGEABLE = new Set(['added', 'removed', 'modified', 'renamed', 'moved']);
  const LIST_KEYS = { servers: 'url', tags: 'name' };
  // Valores de datos: se copian tal cual (un "$ref" dentro de un ejemplo no es una referencia).
  const DATA_KEYS = new Set(['example', 'default', 'enum', 'const']);
  // Mapas cuyas claves son nombres (una respuesta "default", una propiedad "enum"...), no palabras clave.
  const NAME_MAPS = new Set(['properties', 'patternProperties', 'responses', 'schemas', 'parameters', 'examples', 'headers', 'links', 'callbacks', 'requestBodies', 'securitySchemes', 'content', 'paths', 'definitions', 'securityDefinitions', 'variables', 'encoding', 'mapping', 'scopes']);
  // Contenedores de elementos reutilizables (OpenAPI 3.x y Swagger 2.0).
  const SWAGGER2_ROOTS = new Set(['definitions', 'parameters', 'responses', 'securityDefinitions']);
  const SKIP_MSG = {
    op: 'La operación no existe en uno de los dos contratos: traslada antes la operación (o su movimiento).',
    comp: 'El componente no existe en uno de los dos contratos: traslada antes el componente (o su renombrado).'
  };

  /** Valor en una ruta sin atravesar $ref intermedios. found=false si la ruta no es "real" en ese documento
   * (pasa por un $ref, usa una clave no numerica en una lista...). Si falta un tramo, la ruta se puede crear. */
  function plainGet(js, segs) {
    let cur = js;
    for (let i = 0; i < segs.length; i++) {
      if (i > 0 && isRefObj(cur)) return { found: false };
      if (Array.isArray(cur)) {
        if (!/^\d+$/.test(String(segs[i]))) return { found: false };
        cur = cur[Number(segs[i])];
      } else if (isObj(cur)) cur = Object.prototype.hasOwnProperty.call(cur, segs[i]) ? cur[segs[i]] : undefined;
      else return { found: false };
      if (cur === undefined) return { found: true, value: undefined };
    }
    return { found: true, value: cur };
  }
  const valAt = (js, segs) => plainGet(js, segs).value;
  function getSegs(js, segs) {
    let cur = js;
    for (const s of segs) { if (cur === null || typeof cur !== 'object') return undefined; cur = cur[s]; }
    return cur;
  }
  function derefJs(js, v) {
    for (let i = 0; i < 30 && isRefObj(v) && v.$ref.startsWith('#'); i++) v = getSegs(js, U.fromPtr(v.$ref.slice(1)));
    return v;
  }
  function parseOpRef(s) { const m = /^([A-Z]+) (.+)$/.exec(String(s || '')); return m ? { method: m[1].toLowerCase(), route: m[2] } : null; }
  /** Raiz del elemento reutilizable al que apunta un puntero (components/T/N o definitions/N...), o null. */
  function reusableRoot(segs) {
    if (segs[0] === 'components' && segs.length >= 3) return segs.slice(0, 3);
    if (SWAGGER2_ROOTS.has(segs[0]) && segs.length >= 2) return segs.slice(0, 2);
    return null;
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const samePath = (a, b) => a.length === b.length && a.every((s, i) => String(s) === String(b[i]));
  const isPrefix = (a, b) => a.length < b.length && a.every((s, i) => String(s) === String(b[i]));

  /** Ruta minima (unidad) por debajo de la cual nunca se sube al buscar un ancestro real. */
  function floorOf(path) {
    if (path[0] === 'paths') return path.length >= 3 && U.HTTP_METHODS.includes(path[2]) ? 3 : 2;
    if (path[0] === 'components') return Math.min(3, path.length);
    return 1;
  }

  function planOne(c, ctx) {
    const p = planCore(c, ctx);
    if (p.skip) return p;
    // Una operacion nueva necesita su ruta con los datos comunes (parametros de ruta, resumen...); una ruta que
    // desaparece del origen se elimina del destino cuando se queda sin operaciones.
    const routes = new Set(p.ops.map((o) => o.type === 'param' ? o.route : o.path && o.path[0] === 'paths' && o.path.length >= 2 ? o.path[1] : null).filter((r) => r !== null));
    const extra = [];
    for (const r of routes) {
      const inS = isObj(ctx.sJs.paths) && ctx.sJs.paths[r] !== undefined; const inT = isObj(ctx.tJs.paths) && ctx.tJs.paths[r] !== undefined;
      if (inS && !inT) extra.push({ type: 'routeShell', route: r });
      if (!inS && inT) p.ops.push({ type: 'routeCleanup', route: r });
    }
    p.ops = extra.concat(p.ops);
    p.ops.forEach((o) => { o.cid = c.id; });
    return p;
  }
  function planCore(c, ctx) {
    if (!MERGEABLE.has(c.kind)) return { skip: 'Este cambio no se puede trasladar.' };
    const { sJs, tJs, fromNext } = ctx;
    if (c.kind === 'renamed') {
      const type = c.path[1];
      const from = fromNext ? c.old : c.new; const to = fromNext ? c.new : c.old;
      return { ops: [{ type: 'rename', parent: ['components', type], from, to }], scope: 'components.' + type + '.' + from + ' \u2192 ' + to, action: 'rename' };
    }
    if (c.kind === 'moved') {
      const o = parseOpRef(c.old); const n = parseOpRef(c.new);
      if (!o || !n) return { skip: 'Movimiento no reconocido.' };
      const src = fromNext ? n : o; const dst = fromNext ? o : n;
      const sp = ['paths', src.route, src.method]; const dp = ['paths', dst.route, dst.method];
      const v = valAt(sJs, sp);
      if (v === undefined) return { skip: 'No se encuentra la operación en el origen.' };
      return { ops: [{ type: 'set', path: sp, value: v }, { type: 'set', path: dp, value: undefined }], scope: dst.method.toUpperCase() + ' ' + dst.route + ' \u2192 ' + src.method.toUpperCase() + ' ' + src.route, action: 'move' };
    }
    const path = c.path.map(String);
    if (LIST_KEYS[path[0]] && path.length >= 2) return { ops: [{ type: 'listItem', list: [path[0]], field: LIST_KEYS[path[0]], key: path[1] }], scope: path[0] + ' \u203A ' + path[1] };
    // Un cambio dentro de una operacion o componente que solo existe en un lado (p. ej. una operacion movida)
    // no se puede aplicar suelto: crearia una operacion incompleta o borraria datos del destino.
    if (path[0] === 'paths' && U.HTTP_METHODS.includes(path[2]) && path.length > 3 && (valAt(sJs, path.slice(0, 3)) === undefined || valAt(tJs, path.slice(0, 3)) === undefined)) return { skip: SKIP_MSG.op };
    if (path[0] === 'components' && path.length > 3 && (valAt(sJs, path.slice(0, 3)) === undefined || valAt(tJs, path.slice(0, 3)) === undefined)) return { skip: SKIP_MSG.comp };
    const pi = path[0] === 'paths' ? path.indexOf('parameters') : -1;
    if (pi >= 3 && pi + 1 < path.length && /^[^:]+:/.test(path[pi + 1]) && U.HTTP_METHODS.includes(path[2])) {
      return { ops: [{ type: 'param', route: path[1], method: path[2], key: path[pi + 1] }], scope: path[2].toUpperCase() + ' ' + path[1] + ' \u203A parámetro ' + path[pi + 1] };
    }
    const floor = floorOf(path);
    for (let n = path.length; n >= floor; n--) {
      const cand = path.slice(0, n);
      const s = plainGet(sJs, cand); const t = plainGet(tJs, cand);
      if (!s.found || !t.found) continue;
      if (s.value === undefined && t.value === undefined) continue;
      // Los elementos de una lista se trasladan con la lista completa (los indices cambian al borrar/insertar).
      if (n - 1 >= floor && /^\d+$/.test(cand[n - 1]) && (Array.isArray(valAt(sJs, cand.slice(0, -1))) || Array.isArray(valAt(tJs, cand.slice(0, -1))))) continue;
      const ops = [{ type: 'set', path: cand, value: s.value }];
      // Al anadir o quitar una propiedad, su obligatoriedad (lista "required" del schema) viaja con ella.
      if (n >= 2 && cand[n - 2] === 'properties' && (s.value === undefined || t.value === undefined)) ops.push({ type: 'reqSync', schema: cand.slice(0, -2), name: cand[n - 1] });
      return { ops, scope: U.fmtPath(cand) };
    }
    return { skip: 'No se pudo localizar el elemento en ambos contratos (referencias internas).' };
  }

  /** Previsualiza qué se copiará para cada cambio sin modificar nada. */
  function planChanges(target, source, changes, opts) {
    const ctx = { sJs: B.bundleProject(source).js || {}, tJs: B.bundleProject(target).js || {}, fromNext: !!(opts && opts.fromNext) };
    return changes.map((c) => { const p = planOne(c, ctx); return { id: c.id, skip: p.skip, scope: p.scope, action: p.action || 'copy' }; });
  }

  /**
   * Aplica los cambios al destino en una sola edicion (un paso de deshacer).
   * opts.fromNext: true si source es el contrato comparado y target el base.
   * Devuelve { applied: [ids], skipped: [{id, reason}], deps: ['schemas/X', 'tags/t'], brokenRefs }.
   */
  function applyChanges(target, source, changes, opts) {
    opts = opts || {};
    const sBundle = B.bundleProject(source);
    const ctx = { sJs: sBundle.js || {}, tJs: B.bundleProject(target).js || {}, fromNext: !!opts.fromNext };
    const sJs = ctx.sJs;
    const skipped = []; let ops = []; const planned = [];
    for (const c of changes) {
      const p = planOne(c, ctx);
      if (p.skip) { skipped.push({ id: c.id, reason: p.skip }); continue; }
      planned.push(c.id);
      ops = ops.concat(p.ops);
    }
    // Una operacion cuya ruta esta contenida en un "set" ya incluido es redundante.
    const sets = ops.filter((o) => o.type === 'set');
    // Cambios internos de una operacion/componente que solo existe en un lado: valen si el lote ya lo traslada entero.
    for (let i = skipped.length - 1; i >= 0; i--) {
      const c = changes.find((x) => x.id === skipped[i].id);
      if (c && (skipped[i].reason === SKIP_MSG.op || skipped[i].reason === SKIP_MSG.comp) && sets.some((x) => isPrefix(x.path, c.path.map(String)))) { planned.push(c.id); skipped.splice(i, 1); }
    }
    const pathOf = (o) => o.type === 'set' ? o.path : o.type === 'param' ? ['paths', o.route, o.method, 'parameters'] : o.type === 'listItem' ? o.list : o.type === 'reqSync' ? o.schema.concat(['required']) : null;
    const covered = (o) => { const p = pathOf(o); return !!p && sets.some((x) => x !== o && isPrefix(x.path, p)); };
    const seen = new Set();
    ops = ops.filter((o) => {
      if (covered(o)) return false;
      const k = JSON.stringify(Object.assign({}, o, { cid: undefined, value: undefined }));
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    const deps = []; const failed = new Set();
    if (!ops.length) return { applied: [], skipped, deps, brokenRefs: 0 };

    // Componentes del origen definidos en su propio fichero: su contenido se referencia por nombre, no se copia en linea.
    const compByOrigin = new Map();
    const reusableMaps = isObj(sJs.components) ? Object.keys(sJs.components).map((t) => ['components', t]) : [];
    SWAGGER2_ROOTS.forEach((r) => { if (isObj(sJs[r]) && !sJs.openapi) reusableMaps.push([r]); });
    for (const base of reusableMaps) {
      const m = getSegs(sJs, base);
      if (!isObj(m)) continue;
      for (const n of Object.keys(m)) {
        const p = source.phys(base.concat([n]), true);
        if (!p.error && p.file !== source.rootFile) compByOrigin.set(p.file + '\u0000' + U.toPtr(p.path.map(String)), base.concat([n]));
      }
    }

    const errorsBefore = target.refIndex().filter((r) => r.error).length;
    const labelText = opts.label || ('Fusionar ' + planned.length + ' cambio(s)');
    target.mutate(labelText, (tx) => {
      const queue = []; const queued = new Set(); const usedTags = new Set();
      const destFile = (logical) => { const p = target.phys(logical.slice(0, -1), true); return p.error ? target.rootFile : p.file; };
      const exists = (segs) => { const p = target.physNode(segs, false); return !!(p && p.node !== undefined); };
      const need = (root) => { const k = U.toPtr(root); if (!exists(root) && getSegs(sJs, root) !== undefined && !queued.has(k)) { queued.add(k); queue.push(root); } };
      /** $ref (texto) para el fichero de destino a partir de un puntero interno del documento empaquetado del origen. */
      const refFor = (segs, file) => {
        const root = reusableRoot(segs);
        if (root) need(root);
        let loc = target.phys(segs, false);
        if (!loc.error && root && segs.length === root.length) {
          // Un componente que delega en otro fichero se referencia directamente en ese fichero; un alias interno, no.
          const node = target.getNodeAt(loc.file, loc.path);
          const ref = node && node.items ? (node.items.find((it) => it.key && (it.key.value === '$ref')) || {}).value : null;
          if (ref && typeof ref.value === 'string' && !ref.value.startsWith('#')) { const f = target.phys(segs, true); if (!f.error) loc = f; }
        }
        return loc.error ? null : target.makeRef(file, loc.file, loc.path);
      };
      /** Componente del origen cuyo fichero propio es el origen del nodo empaquetado en segs, o null. */
      const compAt = (segs) => {
        const o = segs && segs.length ? sBundle.origins.get(U.toPtr(segs.map(String))) : null;
        return o ? compByOrigin.get(o.file + '\u0000' + U.toPtr(o.path.map(String))) || null : null;
      };
      /** Copia profunda del valor del origen (situado en srcSegs del documento empaquetado) adaptada al destino.
       * cctx.self: componente que se esta copiando (su propio contenido se copia, no se referencia a si mismo). */
      const conv = (v, file, srcSegs, stack, cctx) => {
        cctx = cctx || {};
        if (Array.isArray(v)) return v.map((x, i) => conv(x, file, srcSegs && srcSegs.concat([String(i)]), stack, { parent: cctx.parent }));
        if (!isObj(v)) return v;
        const isSelf = (c) => cctx.self && samePath(c, cctx.self);
        const here = compAt(srcSegs);
        if (here && !samePath(here, srcSegs) && !isSelf(here)) { const r = refFor(here, file); if (r) return { $ref: r }; }
        if (typeof v.$ref === 'string' && v.$ref.startsWith('#')) {
          const segs = U.fromPtr(v.$ref.slice(1));
          const there = compAt(segs);
          // El contenido del componente quedo empaquetado en otro sitio: se copia aqui (es el propio componente).
          if (there && isSelf(there) && !stack.includes(v.$ref)) return conv(getSegs(sJs, segs), file, segs, stack.concat([v.$ref]), cctx);
          if (there) { const r = refFor(there, file); if (r) return Object.assign({}, v, { $ref: r }); }
          if (reusableRoot(segs)) { const r = refFor(segs, file); return Object.assign({}, v, { $ref: r || v.$ref }); }
          // Puntero a otra parte del documento empaquetado (fichero repetido): se incorpora su contenido;
          // en un ciclo se referencia la misma ubicacion en el destino.
          const inner = getSegs(sJs, segs);
          if (inner === undefined || stack.includes(v.$ref) || stack.length > 40) { const r = refFor(segs, file); return Object.assign({}, v, { $ref: r || v.$ref }); }
          return conv(inner, file, segs, stack.concat([v.$ref]), cctx);
        }
        const o = {};
        for (const k of Object.keys(v)) {
          const val = v[k];
          const names = NAME_MAPS.has(cctx.parent);
          if ((!names && DATA_KEYS.has(k)) || k.startsWith('x-') || (cctx.exObj && k === 'value')) o[k] = clone(val);
          else if (k === 'mapping' && cctx.parent === 'discriminator' && isObj(val)) {
            o[k] = {};
            // Los valores del mapping son referencias escritas en el fichero de origen del nodo: se resuelven alli.
            const from = srcSegs ? sBundle.originOf(srcSegs.concat([k])).file : source.rootFile;
            for (const mk of Object.keys(val)) {
              const sv = val[mk];
              let logical = null;
              if (typeof sv === 'string' && sv.indexOf('#/') >= 0) {
                const t = source.resolveRef(from, sv);
                if (!t.error) logical = t.file === source.rootFile ? t.segs : source.toLogical(t.file, t.segs);
              }
              o[k][mk] = logical ? (refFor(logical.map(String), file) || sv) : sv;
            }
          } else o[k] = conv(val, file, srcSegs && srcSegs.concat([k]), stack, { parent: k, exObj: cctx.parent === 'examples' });
        }
        return o;
      };
      const collectTags = (v, depth) => {
        if (!isObj(v) || depth > 3) return;
        if (Array.isArray(v.tags) && (v.responses !== undefined || v.operationId !== undefined)) v.tags.forEach((t) => typeof t === 'string' && usedTags.add(t));
        U.HTTP_METHODS.forEach((m) => collectTags(v[m], depth + 1));
      };
      const write = (logical, value, srcSegs) => {
        if (value === undefined) { tx.del(logical); return; }
        if (logical[0] === 'paths') collectTags(value, 0);
        tx.set(logical, conv(value, destFile(logical), srcSegs || logical, [], { parent: String(logical[logical.length - 1]) }));
      };
      const routeOf = (r) => { const js = B.bundleProject(target).js; return js && isObj(js.paths) ? derefJs(js, js.paths[r]) : undefined; };
      // Primero los renombrados (usan el indice de referencias anterior a la edicion), luego las rutas nuevas.
      const rank = (o) => o.type === 'rename' ? -2 : o.type === 'routeShell' ? -1 : o.type === 'routeCleanup' ? 2 : o.type === 'reqSync' ? 1 : 0;
      ops.sort((a, b) => rank(a) - rank(b));
      for (const o of ops) {
        if (o.type === 'set') write(o.path, o.value);
        else if (o.type === 'routeShell') {
          const item = derefJs(sJs, sJs.paths[o.route]);
          if (!isObj(item) || routeOf(o.route) !== undefined) continue;
          const shell = {};
          for (const k of Object.keys(item)) if (!U.HTTP_METHODS.includes(k)) shell[k] = item[k];
          write(['paths', o.route], shell);
        } else if (o.type === 'routeCleanup') {
          const item = routeOf(o.route);
          if (item !== undefined && !(isObj(item) && U.HTTP_METHODS.some((m) => isObj(item[m])))) tx.del(['paths', o.route]);
        } else if (o.type === 'rename') {
          if (!exists(o.parent.concat([o.from])) || exists(o.parent.concat([o.to]))) { failed.add(o.cid); continue; }
          target._cache = {};
          tx.renameWithRefs(o.parent, o.from, o.to);
        } else if (o.type === 'reqSync') {
          const src = valAt(sJs, o.schema.concat(['required']));
          const want = Array.isArray(src) && src.includes(o.name);
          const cur = target.read(o.schema.concat(['required']), true);
          const list = Array.isArray(cur) ? cur : [];
          if (want && !list.includes(o.name)) tx.set(o.schema.concat(['required']), list.concat([o.name]));
          else if (!want && list.includes(o.name)) { const next = list.filter((x) => x !== o.name); tx.set(o.schema.concat(['required']), next.length ? next : undefined); }
        } else if (o.type === 'listItem') applyListItem(tx, target, sJs, o, conv, destFile);
        else if (o.type === 'param') applyParam(tx, target, sJs, o, conv, destFile);
      }
      for (let i = 0; i < queue.length && i < 1000; i++) {
        const root = queue[i];
        if (exists(root)) continue;
        try { tx.set(root, conv(getSegs(sJs, root), destFile(root), root, [], { parent: String(root[root.length - 1]), self: root })); deps.push(root.slice(1).join('/')); } catch (e) { skipped.push({ id: null, reason: 'No se pudo copiar ' + root.join('/') + ': ' + e.message }); }
      }
      // Tags usados por las operaciones copiadas y declarados en el origen pero no en el destino.
      if (usedTags.size && Array.isArray(sJs.tags)) {
        const declared = new Set((target.read(['tags'], true) || []).map((t) => t && t.name));
        for (const t of usedTags) {
          if (declared.has(t)) continue;
          const def = sJs.tags.find((x) => x && x.name === t);
          if (!def) continue;
          tx.push(['tags'], conv(def, destFile(['tags', '0']), null, []));
          deps.push('tags/' + t);
        }
      }
    }, { coalesce: false });
    const applied = planned.filter((id) => !failed.has(id));
    failed.forEach((id) => skipped.push({ id, reason: 'El elemento ya no está como se esperaba en el destino.' }));
    const brokenRefs = Math.max(0, target.refIndex().filter((r) => r.error).length - errorsBefore);
    return { applied, skipped, deps, brokenRefs };
  }

  function applyListItem(tx, target, sJs, o, conv, destFile) {
    const src = (Array.isArray(sJs[o.list[0]]) ? sJs[o.list[0]] : []).find((x) => x && String(x[o.field]) === o.key);
    const cur = target.read(o.list, true);
    const list = Array.isArray(cur) ? cur : [];
    const idx = list.findIndex((x) => x && String(x[o.field]) === o.key);
    if (src === undefined) { if (idx >= 0) tx.del(o.list.concat([idx])); return; }
    const file = destFile(o.list.concat(['0']));
    if (idx >= 0) tx.set(o.list.concat([idx]), conv(src, file, null, []));
    else tx.push(o.list, conv(src, file, null, []));
  }

  /** Sincroniza un parametro (in:name) en cada nivel (operacion y ruta) con lo que tenga el origen en ese nivel. */
  function applyParam(tx, target, sJs, o, conv, destFile) {
    const holderPath = (level) => level === 'op' ? ['paths', o.route, o.method, 'parameters'] : ['paths', o.route, 'parameters'];
    const find = (js, level) => {
      const list = valAt(js, holderPath(level));
      if (!Array.isArray(list)) return -1;
      return list.findIndex((p) => { const d = derefJs(js, p); return isObj(d) && paramKey(d) === o.key; });
    };
    for (const level of ['op', 'path']) {
      const tJs = B.bundleProject(target).js || {};
      const lp = holderPath(level);
      const si = find(sJs, level); const ti = find(tJs, level);
      if (si < 0) {
        if (ti >= 0) { tx.del(lp.concat([ti])); const rest = target.read(lp, true); if (Array.isArray(rest) && !rest.length) tx.del(lp); }
        continue;
      }
      const value = valAt(sJs, lp.concat([String(si)]));
      const file = destFile(lp.concat(['0']));
      const v = conv(value, file, lp.concat([String(si)]), []);
      if (ti >= 0) tx.set(lp.concat([ti]), v); else tx.push(lp, v);
    }
  }

  return { applyChanges, planChanges, MERGEABLE };
});
