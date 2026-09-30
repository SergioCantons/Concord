/* Comparador semantico de dos proyectos OpenAPI. Compara el modelo empaquetado (no el texto YAML):
 * ignora orden de claves, comentarios, nombres y distribucion de ficheros. Los $ref a componentes se comparan
 * por nombre (el contenido se compara una sola vez en el componente), lo que hace seguros los esquemas circulares. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./bundle.js'), require('./validate.js'));
  else { root.OAT = root.OAT || {}; root.OAT.compare = factory(root.OAT.util, root.OAT.bundle, root.OAT.validate); }
})(typeof self !== 'undefined' ? self : this, function (U, B, V) {
  'use strict';

  const SET_KEYS = new Set(['required', 'enum', 'tags', 'allOf', 'oneOf', 'anyOf', 'security', 'produces', 'consumes']);
  const DATA_KEYS = new Set(['example', 'examples', 'default', 'const']);
  const COMPONENT_TYPES = ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes', 'links', 'callbacks'];
  const MIN_KEYS = new Set(['minimum', 'minLength', 'minItems', 'minProperties']);
  const MAX_KEYS = new Set(['maximum', 'maxLength', 'maxItems', 'maxProperties']);
  const isObj = U.isObj;
  const eq = U.deepEqual;
  const ser = U.stableStringify;

  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function keysOf(a, b) { const s = new Set(Object.keys(a || {})); Object.keys(b || {}).forEach((k) => s.add(k)); return Array.from(s); }

  function makeSide(js, label) {
    const side = { js, label };
    side.refInfo = (node) => {
      if (!isObj(node) || typeof node.$ref !== 'string') return null;
      const ref = node.$ref;
      const m = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);
      const target = V.resolveInternal(js, ref);
      return { ref, type: m ? m[1] : null, name: m ? U.unescPtr(safeDecode(m[2])) : null, target, unresolved: target === undefined };
    };
    return side;
  }

  /** Recorre operaciones y marca que componentes se usan en peticiones y/o respuestas. */
  function computeUsage(side) {
    const req = new Set(); const res = new Set();
    const js = side.js;
    const mark = (node, set, depth) => {
      if (depth > 60 || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((n) => mark(n, set, depth + 1)); return; }
      if (typeof node.$ref === 'string') {
        const ri = side.refInfo(node);
        if (ri && ri.type) { const k = ri.type + '/' + ri.name; if (set.has(k)) return; set.add(k); }
        if (ri && ri.target !== undefined) mark(ri.target, set, depth + 1);
        return;
      }
      for (const k of Object.keys(node)) { if (DATA_KEYS.has(k)) continue; mark(node[k], set, depth + 1); }
    };
    if (isObj(js.paths)) {
      for (const route of Object.keys(js.paths)) {
        const item = js.paths[route];
        if (!isObj(item)) continue;
        mark(item.parameters, req, 0);
        for (const m of U.HTTP_METHODS) {
          const op = item[m];
          if (!isObj(op)) continue;
          mark(op.parameters, req, 0); mark(op.requestBody, req, 0); mark(op.responses, res, 0);
        }
      }
    }
    return { req, res };
  }

  function compareProjects(baseProject, newProject, options) {
    const opts = Object.assign({ xMode: 'informative' }, options || {});
    const bundleA = B.bundleProject(baseProject);
    const bundleB = B.bundleProject(newProject);
    const A = makeSide(bundleA.js || {}, 'base');
    const N = makeSide(bundleB.js || {}, 'comparado');
    const changes = [];
    const errorKeys = new Set();
    const touched = new Set();
    const usageA = computeUsage(A); const usageB = computeUsage(N);
    const seenPairs = new Map();

    /* ---------- utilidades de emision ---------- */
    function change(kind, segs, title, o) {
      o = o || {};
      const cx = o.cx || {};
      const meta = Object.assign({}, cx.meta || {});
      const c = {
        id: 'C' + String(changes.length + 1).padStart(4, '0'), kind, area: o.area || (cx.meta && cx.meta.area) || 'General', title,
        path: segs.map(String), pathText: U.fmtPath(segs), old: o.old, new: o.new, breaking: !!o.breaking, reason: o.reason || '',
        route: meta.route || null, method: meta.method || null, tags: meta.tags || [], schema: meta.schema || null, section: segs[0] || ''
      };
      if (cx.touchKey) touched.add(cx.touchKey);
      changes.push(c);
      return c;
    }
    function brk(cx, bReq, bRes) {
      const u = cx.usage || { req: false, res: false };
      if (cx.dir === 'request') return !!bReq;
      if (cx.dir === 'response') return !!bRes;
      if (u.req && bReq) return true;
      if (u.res && bRes) return true;
      if (!u.req && !u.res) return !!(bReq || bRes);
      return false;
    }
    function unresolved() { /* los errores de referencia se informan una vez, desde el indice fisico de cada proyecto */ }
    /** Resuelve $ref por valor (con proteccion frente a ciclos); devuelve {node, err}. */
    function deref(side, node, segs, cx) {
      let cur = node;
      for (let i = 0; i < 30; i++) {
        const ri = side.refInfo(cur);
        if (!ri) return { node: cur };
        if (ri.unresolved) { unresolved(side, ri, segs, cx); return { err: true }; }
        cur = ri.target;
      }
      return { err: true };
    }
    function visited(a, b) {
      if (!isObj(a) || !isObj(b)) return false;
      let s = seenPairs.get(a);
      if (!s) { s = new Set(); seenPairs.set(a, s); }
      if (s.has(b)) return true;
      s.add(b);
      return false;
    }

    /* ---------- generico ---------- */
    function ext(k, va, vb, segs, cx) {
      if (opts.xMode === 'ignore' || eq(va, vb)) return;
      const kind = va === undefined ? 'added' : vb === undefined ? 'removed' : 'modified';
      change(kind, segs, 'Extensión ' + k + (kind === 'added' ? ' anadida' : kind === 'removed' ? ' eliminada' : ' modificada'), { cx, area: 'Extensión', old: va, new: vb, breaking: opts.xMode === 'blocking', reason: opts.xMode === 'blocking' ? 'Las extensiones x-* están configuradas como bloqueantes.' : '' });
    }
    function generic(a, b, segs, cx, label) {
      if (eq(a, b)) return;
      if (isObj(a) && isObj(b)) {
        for (const k of keysOf(a, b)) {
          if (k.startsWith('x-')) { ext(k, a[k], b[k], segs.concat([k]), cx); continue; }
          if (a[k] === undefined) change('added', segs.concat([k]), (label ? label + ': ' : '') + k + ' anadido', { cx, new: b[k] });
          else if (b[k] === undefined) change('removed', segs.concat([k]), (label ? label + ': ' : '') + k + ' eliminado', { cx, old: a[k] });
          else generic(a[k], b[k], segs.concat([k]), Object.assign({}, cx, DATA_KEYS.has(k) ? { exact: true } : {}), label);
        }
        return;
      }
      const key = segs[segs.length - 1];
      if (Array.isArray(a) && Array.isArray(b) && SET_KEYS.has(String(key)) && !cx.exact) {
        const sa = new Map(a.map((x) => [ser(x), x])); const sb = new Map(b.map((x) => [ser(x), x]));
        for (const [k, v] of sa) if (!sb.has(k)) change('removed', segs, 'Elemento eliminado de ' + key, { cx, old: v });
        for (const [k, v] of sb) if (!sa.has(k)) change('added', segs, 'Elemento anadido a ' + key, { cx, new: v });
        return;
      }
      if (Array.isArray(a) && Array.isArray(b)) {
        const n = Math.max(a.length, b.length);
        for (let i = 0; i < n; i++) {
          if (i >= a.length) change('added', segs.concat([i]), 'Elemento anadido en ' + key + '[' + i + ']', { cx, new: b[i] });
          else if (i >= b.length) change('removed', segs.concat([i]), 'Elemento eliminado en ' + key + '[' + i + ']', { cx, old: a[i] });
          else generic(a[i], b[i], segs.concat([i]), cx, label);
        }
        return;
      }
      change('modified', segs, (label ? label + ': ' : '') + key + ' modificado', { cx, old: a, new: b });
    }
    function scalar(key, va, vb, segs, cx, label, area) {
      if (eq(va, vb)) return;
      const kind = va === undefined ? 'added' : vb === undefined ? 'removed' : 'modified';
      const t = (label || key) + (kind === 'added' ? ' anadido' : kind === 'removed' ? ' eliminado' : ' modificado');
      change(kind, segs, t, { cx, old: va, new: vb, area });
    }

    /* ---------- schemas ---------- */
    function constraint(k, va, vb, segs, cx) {
      if (eq(va, vb)) return;
      let tighterReq; // true si endurece la validacion
      const num = (x) => (typeof x === 'number' ? x : undefined);
      if (MIN_KEYS.has(k)) tighterReq = vb !== undefined && (va === undefined || num(vb) > num(va));
      else if (MAX_KEYS.has(k)) tighterReq = vb !== undefined && (va === undefined || num(vb) < num(va));
      else if (k === 'uniqueItems') tighterReq = vb === true;
      else if (k === 'nullable') tighterReq = vb !== true;
      else if (k === 'exclusiveMinimum' || k === 'exclusiveMaximum') tighterReq = vb === true || (typeof vb === 'number' && typeof va !== 'number');
      else tighterReq = true; // pattern, multipleOf, format...
      const b = tighterReq ? brk(cx, true, false) : brk(cx, false, true);
      const kind = va === undefined ? 'added' : vb === undefined ? 'removed' : 'modified';
      change(kind, segs, 'Restricción ' + k + (kind === 'added' ? ' anadida' : kind === 'removed' ? ' eliminada' : ' modificada') + ' (' + (va === undefined ? '-' : JSON.stringify(va)) + ' -> ' + (vb === undefined ? '-' : JSON.stringify(vb)) + ')', { cx, old: va, new: vb, breaking: b, area: 'Restricción', reason: b ? (tighterReq ? 'Endurece la validación de datos enviados por el cliente.' : 'Relaja las garantias de los datos recibidos por el cliente.') : '' });
    }
    function setDiff(name, la, lb, segs, cx, ruleAdd, ruleRemove, area) {
      const sa = new Map((la || []).map((x) => [ser(x), x])); const sb = new Map((lb || []).map((x) => [ser(x), x]));
      for (const [k, v] of sa) if (!sb.has(k)) change('removed', segs, 'Valor eliminado de ' + name + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v), { cx, old: v, breaking: brk(cx, ruleRemove[0], ruleRemove[1]), area: area || 'Enum', reason: brk(cx, ruleRemove[0], ruleRemove[1]) ? 'Los clientes pueden depender de este valor.' : '' });
      for (const [k, v] of sb) if (!sa.has(k)) change('added', segs, 'Valor anadido a ' + name + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v), { cx, new: v, breaking: brk(cx, ruleAdd[0], ruleAdd[1]), area: area || 'Enum', reason: brk(cx, ruleAdd[0], ruleAdd[1]) ? 'Los clientes pueden no esperar este valor.' : '' });
    }

    function diffSchema(a, b, segs, cx) {
      const ia = A.refInfo(a); const ib = N.refInfo(b);
      if (ia && ia.unresolved) { unresolved(A, ia, segs, cx); return; }
      if (ib && ib.unresolved) { unresolved(N, ib, segs, cx); return; }
      if (ia && ib && ia.type && ib.type) {
        if (ia.type === ib.type && ia.name === ib.name) return;
        change('modified', segs, 'Schema referenciado cambia: ' + ia.name + ' -> ' + ib.name, { cx, old: a, new: b, breaking: true, area: 'Schema', reason: 'El contrato apunta a otro schema.' });
        return;
      }
      let ra = a; let rb = b;
      if (ia || ib) {
        const da = deref(A, a, segs, cx); const db = deref(N, b, segs, cx);
        if (da.err || db.err) return;
        ra = da.node; rb = db.node;
        if (visited(ra, rb)) return;
      }
      if (!isObj(ra) || !isObj(rb)) { if (!eq(ra, rb)) change('modified', segs, 'Schema modificado', { cx, old: ra, new: rb, breaking: true, area: 'Schema' }); return; }
      for (const k of keysOf(ra, rb)) {
        const va = ra[k]; const vb = rb[k];
        if (k.startsWith('x-')) { ext(k, va, vb, segs.concat([k]), cx); continue; }
        if (eq(va, vb) && !['properties', 'items', 'additionalProperties', 'not'].includes(k)) continue;
        const sub = segs.concat([k]);
        switch (k) {
          case 'properties': {
            const pa = isObj(va) ? va : {}; const pb = isObj(vb) ? vb : {};
            const rqa = Array.isArray(ra.required) ? ra.required : []; const rqb = Array.isArray(rb.required) ? rb.required : [];
            for (const n of keysOf(pa, pb)) {
              const psegs = sub.concat([n]);
              const pcx = Object.assign({}, cx, { meta: Object.assign({}, cx.meta, { property: n }) });
              if (!(n in pa)) { const req = rqb.includes(n); change('added', psegs, 'Propiedad anadida: ' + n + (req ? ' (obligatoria)' : ''), { cx: pcx, new: pb[n], breaking: brk(cx, req, false), area: 'Propiedad', reason: brk(cx, req, false) ? 'Propiedad obligatoria nueva en una petición.' : '' }); }
              else if (!(n in pb)) { const was = rqa.includes(n); change('removed', psegs, 'Propiedad eliminada: ' + n + (was ? ' (era obligatoria)' : ''), { cx: pcx, old: pa[n], breaking: brk(cx, was, true), area: 'Propiedad', reason: brk(cx, was, true) ? (was ? 'Se elimina una propiedad obligatoria.' : 'Los clientes pueden depender de esta propiedad de la respuesta.') : '' }); }
              else diffSchema(pa[n], pb[n], psegs, pcx);
            }
            break;
          }
          case 'required': {
            const rqa = Array.isArray(va) ? va : []; const rqb = Array.isArray(vb) ? vb : [];
            const pa = isObj(ra.properties) ? ra.properties : null; const pb = isObj(rb.properties) ? rb.properties : null;
            const both = (n) => (!pa || n in pa) && (!pb || n in pb);
            for (const n of rqb) if (!rqa.includes(n) && both(n)) change('modified', sub, 'Propiedad pasa a ser obligatoria: ' + n, { cx, old: false, new: true, breaking: brk(cx, true, false), area: 'Propiedad', reason: brk(cx, true, false) ? 'Los clientes deben enviar ahora esta propiedad.' : '' });
            for (const n of rqa) if (!rqb.includes(n) && both(n)) change('modified', sub, 'Propiedad pasa a ser opcional: ' + n, { cx, old: true, new: false, breaking: brk(cx, false, true), area: 'Propiedad', reason: brk(cx, false, true) ? 'La respuesta puede omitir una propiedad con la que contaban los clientes.' : '' });
            break;
          }
          case 'enum':
            if (!Array.isArray(va) || !Array.isArray(vb)) change(va === undefined ? 'added' : vb === undefined ? 'removed' : 'modified', sub, 'enum ' + (va === undefined ? 'anadido' : vb === undefined ? 'eliminado' : 'modificado'), { cx, old: va, new: vb, breaking: va === undefined ? brk(cx, true, false) : brk(cx, false, true), area: 'Enum' });
            else setDiff('enum', va, vb, sub, cx, [false, true], [true, false]);
            break;
          case 'type': case 'format':
            change(va === undefined ? 'added' : vb === undefined ? 'removed' : 'modified', sub, (k === 'type' ? 'Tipo' : 'Formato') + ' cambia: ' + (va === undefined ? '-' : va) + ' -> ' + (vb === undefined ? '-' : vb), { cx, old: va, new: vb, breaking: true, area: 'Schema', reason: 'Cambia la representación de los datos.' });
            break;
          case 'items': case 'not':
            if (va !== undefined && vb !== undefined) diffSchema(va, vb, sub, cx);
            else change(va === undefined ? 'added' : 'removed', sub, k + (va === undefined ? ' anadido' : ' eliminado'), { cx, old: va, new: vb, breaking: true, area: 'Schema' });
            break;
          case 'additionalProperties':
            if (isObj(va) && isObj(vb)) diffSchema(va, vb, sub, cx);
            else if (!eq(va, vb)) { const tighter = vb === false; change('modified', sub, 'additionalProperties cambia', { cx, old: va, new: vb, breaking: tighter ? brk(cx, true, false) : brk(cx, false, true), area: 'Schema' }); }
            break;
          case 'allOf': case 'oneOf': case 'anyOf': {
            const la = Array.isArray(va) ? va : []; const lb = Array.isArray(vb) ? vb : [];
            const canon = (side, x) => { const ri = side.refInfo(x); return ri && ri.type ? '$' + ri.type + '/' + ri.name : ser(x); };
            const ma = new Map(); la.forEach((x) => ma.set(canon(A, x), x));
            const mb = new Map(); lb.forEach((x) => mb.set(canon(N, x), x));
            const onlyA = la.filter((x) => !mb.has(canon(A, x))); const onlyB = lb.filter((x) => !ma.has(canon(N, x)));
            const n = Math.min(onlyA.length, onlyB.length);
            for (let i = 0; i < n; i++) diffSchema(onlyA[i], onlyB[i], sub.concat(['#' + i]), cx);
            const ruleAdd = k === 'allOf' ? [true, false] : [false, true]; const ruleRem = k === 'allOf' ? [false, true] : [true, false];
            for (let i = n; i < onlyA.length; i++) change('removed', sub, 'Variante eliminada de ' + k, { cx, old: onlyA[i], breaking: brk(cx, ruleRem[0], ruleRem[1]), area: 'Composición' });
            for (let i = n; i < onlyB.length; i++) change('added', sub, 'Variante anadida a ' + k, { cx, new: onlyB[i], breaking: brk(cx, ruleAdd[0], ruleAdd[1]), area: 'Composición' });
            break;
          }
          case 'example': case 'examples': case 'default': case 'const':
            change(va === undefined ? 'added' : vb === undefined ? 'removed' : 'modified', sub, k + (va === undefined ? ' anadido' : vb === undefined ? ' eliminado' : ' modificado'), { cx, old: va, new: vb, area: 'Ejemplo', breaking: k === 'default' ? false : false });
            break;
          case 'description': case 'title': case 'deprecated': case 'readOnly': case 'writeOnly': case 'externalDocs': case 'xml':
            generic(va, vb, sub, cx, 'Schema');
            break;
          default:
            if (MIN_KEYS.has(k) || MAX_KEYS.has(k) || ['uniqueItems', 'nullable', 'pattern', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum'].includes(k)) constraint(k, va, vb, sub, cx);
            else generic(va, vb, sub, cx, 'Schema');
        }
      }
    }

    /* ---------- parametros, cuerpos y respuestas ---------- */
    const paramKey = (p) => (p.in || '?') + ':' + (p.name || '?');
    function effectiveParams(side, item, op, segs, cx) {
      const map = new Map();
      const add = (list, base) => {
        (Array.isArray(list) ? list : []).forEach((raw, i) => {
          const ri = side.refInfo(raw);
          const d = deref(side, raw, base.concat([i]), cx);
          if (d.err || !isObj(d.node)) return;
          map.set(paramKey(d.node), { p: d.node, ref: ri && ri.type ? ri.type + '/' + ri.name : null });
        });
      };
      add(item && item.parameters, segs.slice(0, 2).concat(['parameters']));
      add(op && op.parameters, segs.concat(['parameters']));
      return map;
    }
    function diffParam(pa, pb, segs, cx) {
      const c = Object.assign({}, cx, { dir: 'request', meta: Object.assign({}, cx.meta, { area: 'Parámetro' }) });
      for (const k of keysOf(pa, pb)) {
        if (k.startsWith('x-')) { ext(k, pa[k], pb[k], segs.concat([k]), c); continue; }
        if (eq(pa[k], pb[k])) continue;
        if (k === 'name' || k === 'in') continue;
        if (k === 'required') change('modified', segs.concat([k]), 'Parámetro ' + paramKey(pb) + ': ' + (pb.required ? 'pasa a obligatorio' : 'pasa a opcional'), { cx: c, old: !!pa.required, new: !!pb.required, breaking: pb.required === true, area: 'Parámetro', reason: pb.required === true ? 'Los clientes deben enviar ahora este parámetro.' : '' });
        else if (k === 'schema') {
          if (pa.schema && pb.schema) diffSchema(pa.schema, pb.schema, segs.concat(['schema']), c);
          else change(pa.schema ? 'removed' : 'added', segs.concat(['schema']), 'Schema del parámetro ' + (pa.schema ? 'eliminado' : 'anadido'), { cx: c, old: pa.schema, new: pb.schema, breaking: true, area: 'Parámetro' });
        } else if (k === 'content') diffContent(pa.content, pb.content, segs.concat(['content']), c, 'request');
        else if (k === 'style' || k === 'explode') change('modified', segs.concat([k]), 'Parámetro ' + paramKey(pb) + ': ' + k + ' cambia', { cx: c, old: pa[k], new: pb[k], breaking: true, area: 'Parámetro', reason: 'Cambia la serialización del parámetro.' });
        else generic(pa[k], pb[k], segs.concat([k]), c, 'Parámetro ' + paramKey(pb));
      }
    }
    function diffParamMaps(ma, mb, segs, cx) {
      for (const key of keysOf(Object.fromEntries(ma), Object.fromEntries(mb))) {
        const a = ma.get(key); const b = mb.get(key);
        const psegs = segs.concat(['parameters', key]);
        const c = Object.assign({}, cx, { meta: Object.assign({}, cx.meta, { area: 'Parámetro' }) });
        if (!a) change('added', psegs, 'Parámetro anadido: ' + key + (b.p.required ? ' (obligatorio)' : ''), { cx: c, new: b.p, breaking: b.p.required === true, area: 'Parámetro', reason: b.p.required === true ? 'Parámetro obligatorio nuevo: los clientes existentes fallarán.' : '' });
        else if (!b) change('removed', psegs, 'Parámetro eliminado: ' + key + (a.p.required ? ' (era obligatorio)' : ''), { cx: c, old: a.p, breaking: a.p.required === true, area: 'Parámetro', reason: a.p.required === true ? 'Se elimina un parámetro obligatorio.' : '' });
        else if (a.ref && a.ref === b.ref) continue;
        else diffParam(a.p, b.p, psegs, cx);
      }
    }
    function diffContent(ca, cb, segs, cx, dir) {
      ca = isObj(ca) ? ca : {}; cb = isObj(cb) ? cb : {};
      const c = Object.assign({}, cx, { dir });
      for (const mt of keysOf(ca, cb)) {
        const s = segs.concat([mt]);
        if (!(mt in ca)) change('added', s, 'Media type anadido: ' + mt, { cx: c, new: cb[mt], breaking: false, area: 'Contenido' });
        else if (!(mt in cb)) change('removed', s, 'Media type eliminado: ' + mt, { cx: c, old: ca[mt], breaking: true, area: 'Contenido', reason: 'Los clientes pueden usar este formato.' });
        else {
          const ma = ca[mt] || {}; const mb = cb[mt] || {};
          for (const k of keysOf(ma, mb)) {
            if (k.startsWith('x-')) { ext(k, ma[k], mb[k], s.concat([k]), c); continue; }
            if (k === 'schema') {
              if (ma.schema !== undefined && mb.schema !== undefined) diffSchema(ma.schema, mb.schema, s.concat(['schema']), c);
              else if (!eq(ma.schema, mb.schema)) change(ma.schema === undefined ? 'added' : 'removed', s.concat(['schema']), 'Schema de ' + mt + (ma.schema === undefined ? ' anadido' : ' eliminado'), { cx: c, old: ma.schema, new: mb.schema, breaking: true, area: 'Contenido' });
            } else if (!eq(ma[k], mb[k])) generic(ma[k], mb[k], s.concat([k]), Object.assign({}, c, DATA_KEYS.has(k) ? { exact: true } : {}), mt);
          }
        }
      }
    }
    function diffHeaders(ha, hb, segs, cx) {
      ha = isObj(ha) ? ha : {}; hb = isObj(hb) ? hb : {};
      const c = Object.assign({}, cx, { dir: 'response' });
      for (const n of keysOf(ha, hb)) {
        const s = segs.concat([n]);
        if (!(n in ha)) { change('added', s, 'Header anadido: ' + n, { cx: c, new: hb[n], area: 'Header' }); continue; }
        if (!(n in hb)) { change('removed', s, 'Header eliminado: ' + n, { cx: c, old: ha[n], breaking: true, area: 'Header', reason: 'Los clientes pueden depender de este header.' }); continue; }
        const da = deref(A, ha[n], s, c); const db = deref(N, hb[n], s, c);
        if (da.err || db.err || eq(ha[n], hb[n])) continue;
        for (const k of keysOf(da.node, db.node)) {
          if (k === 'schema' && da.node.schema && db.node.schema) diffSchema(da.node.schema, db.node.schema, s.concat(['schema']), c);
          else if (!eq(da.node[k], db.node[k])) generic(da.node[k], db.node[k], s.concat([k]), c, 'Header ' + n);
        }
      }
    }
    function diffRequestBody(ra, rb, segs, cx) {
      const c = Object.assign({}, cx, { meta: Object.assign({}, cx.meta, { area: 'Cuerpo de petición' }) });
      if (ra === undefined && rb === undefined) return;
      if (ra === undefined) { const d = deref(N, rb, segs, c); change('added', segs, 'requestBody anadido' + (d.node && d.node.required ? ' (obligatorio)' : ''), { cx: c, new: d.node || rb, breaking: !!(d.node && d.node.required), area: 'Cuerpo de petición', reason: d.node && d.node.required ? 'Los clientes existentes no envian cuerpo.' : '' }); return; }
      if (rb === undefined) { change('removed', segs, 'requestBody eliminado', { cx: c, old: ra, breaking: false, area: 'Cuerpo de petición' }); return; }
      const ia = A.refInfo(ra); const ib = N.refInfo(rb);
      if (ia && ib && ia.type && ia.type === ib.type && ia.name === ib.name && !ia.unresolved && !ib.unresolved) return;
      const da = deref(A, ra, segs, c); const db = deref(N, rb, segs, c);
      if (da.err || db.err) return;
      if (visited(da.node, db.node)) return;
      for (const k of keysOf(da.node, db.node)) {
        if (k.startsWith('x-')) { ext(k, da.node[k], db.node[k], segs.concat([k]), c); continue; }
        if (k === 'content') diffContent(da.node.content, db.node.content, segs.concat(['content']), c, 'request');
        else if (k === 'required') { if (!eq(da.node.required, db.node.required)) change('modified', segs.concat(['required']), 'requestBody ' + (db.node.required ? 'pasa a obligatorio' : 'pasa a opcional'), { cx: c, old: !!da.node.required, new: !!db.node.required, breaking: db.node.required === true, area: 'Cuerpo de petición' }); }
        else if (!eq(da.node[k], db.node[k])) generic(da.node[k], db.node[k], segs.concat([k]), c, 'requestBody');
      }
    }
    function diffResponses(a, b, segs, cx) {
      a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
      for (const code of keysOf(a, b)) {
        const s = segs.concat([code]);
        const c = Object.assign({}, cx, { meta: Object.assign({}, cx.meta, { area: 'Respuesta', code }) });
        if (code.startsWith('x-')) { ext(code, a[code], b[code], s, c); continue; }
        if (!(code in a)) { change('added', s, 'Respuesta anadida: ' + code, { cx: c, new: b[code], area: 'Respuesta' }); continue; }
        if (!(code in b)) { change('removed', s, 'Respuesta eliminada: ' + code, { cx: c, old: a[code], breaking: true, area: 'Respuesta', reason: 'Se elimina un código HTTP esperado por los clientes.' }); continue; }
        const ia = A.refInfo(a[code]); const ib = N.refInfo(b[code]);
        if (ia && ib && ia.type && ia.type === ib.type && ia.name === ib.name && !ia.unresolved && !ib.unresolved) continue;
        diffResponseObject(a[code], b[code], s, c);
      }
    }
    function diffResponseObject(ra, rb, s, c) {
      const da = deref(A, ra, s, c); const db = deref(N, rb, s, c);
      if (da.err || db.err) return;
      if (visited(da.node, db.node)) return;
      for (const k of keysOf(da.node, db.node)) {
        if (k.startsWith('x-')) { ext(k, da.node[k], db.node[k], s.concat([k]), c); continue; }
        if (eq(da.node[k], db.node[k])) continue;
        if (k === 'content') diffContent(da.node.content, db.node.content, s.concat(['content']), c, 'response');
        else if (k === 'headers') diffHeaders(da.node.headers, db.node.headers, s.concat(['headers']), c);
        else if (k === 'description') change('modified', s.concat([k]), 'Descripción de respuesta ' + (c.meta.code || '') + ' modificada', { cx: c, old: da.node[k], new: db.node[k], area: 'Respuesta' });
        else generic(da.node[k], db.node[k], s.concat([k]), c, 'Respuesta ' + (c.meta.code || ''));
      }
    }

    /* ---------- seguridad ---------- */
    function secKey(req) { const o = {}; Object.keys(req || {}).sort().forEach((k) => { o[k] = (req[k] || []).slice().sort(); }); return ser(o); }
    function diffSecurity(sa, sb, segs, cx, label) {
      if (sa === undefined && sb === undefined) return;
      const la = Array.isArray(sa) ? sa : []; const lb = Array.isArray(sb) ? sb : [];
      const ma = new Map(la.map((r) => [secKey(r), r])); const mb = new Map(lb.map((r) => [secKey(r), r]));
      // Los requisitos son alternativas: quitar una restringe el acceso; anadir la primera (de publico a protegido) tambien.
      for (const [k, v] of ma) if (!mb.has(k)) change('removed', segs, label + ': requisito de seguridad eliminado ' + JSON.stringify(v), { cx, old: v, breaking: lb.length > 0, area: 'Seguridad', reason: lb.length > 0 ? 'Se elimina una alternativa de autenticación: los clientes que la usaban seran rechazados.' : '' });
      for (const [k, v] of mb) if (!ma.has(k)) change('added', segs, label + ': requisito de seguridad anadido ' + JSON.stringify(v), { cx, new: v, breaking: la.length === 0, area: 'Seguridad', reason: la.length === 0 ? 'El acceso pasa de público a protegido.' : '' });
    }

    /* ---------- operaciones ---------- */
    function diffOperation(item, itemB, a, b, route, method, tagsMeta) {
      const segs = ['paths', route, method];
      const cx = { meta: { route, method, tags: tagsMeta, area: 'Operación', section: 'paths' }, touchKey: 'op:' + route + ':' + method, dir: null, usage: null };
      for (const k of keysOf(a, b)) {
        const va = a[k]; const vb = b[k];
        const s = segs.concat([k]);
        if (k.startsWith('x-')) { ext(k, va, vb, s, cx); continue; }
        if (k === 'parameters' || k === 'requestBody' || k === 'responses' || k === 'security') continue;
        if (eq(va, vb)) continue;
        if (k === 'operationId') change('modified', s, 'operationId cambia: ' + va + ' -> ' + vb, { cx, old: va, new: vb, breaking: true, area: 'Operación', reason: 'Afecta a clientes y SDK generados a partir del operationId.' });
        else if (k === 'tags') setDiff('tags', va, vb, s, Object.assign({}, cx, { meta: Object.assign({}, cx.meta, { area: 'Tags' }) }), [false, false], [false, false], 'Tags');
        else if (k === 'summary' || k === 'description') scalar(k, va, vb, s, cx, k === 'summary' ? 'Resumen' : 'Descripción', 'Operación');
        else if (k === 'deprecated') change('modified', s, va ? 'Operación deja de estar deprecada' : 'Operación pasa a estar deprecada', { cx, old: va, new: vb, area: 'Operación' });
        else generic(va, vb, s, cx, 'Operación');
      }
      diffParamMaps(effectiveParams(A, item, a, segs, cx), effectiveParams(N, itemB, b, segs, cx), segs, cx);
      diffRequestBody(a.requestBody, b.requestBody, segs.concat(['requestBody']), cx);
      diffResponses(a.responses, b.responses, segs.concat(['responses']), cx);
      const secA = a.security !== undefined ? a.security : A.js.security; const secB = b.security !== undefined ? b.security : N.js.security;
      if (a.security !== undefined || b.security !== undefined) diffSecurity(secA, secB, segs.concat(['security']), cx, 'Operación');
    }

    function diffPaths() {
      const pa = isObj(A.js.paths) ? A.js.paths : {}; const pb = isObj(N.js.paths) ? N.js.paths : {};
      const removedOps = []; const addedOps = [];
      const opsOf = (item) => (isObj(item) ? U.HTTP_METHODS.filter((m) => isObj(item[m])) : []);
      for (const route of keysOf(pa, pb)) {
        if (route.startsWith('x-')) { ext(route, pa[route], pb[route], ['paths', route], { meta: { area: 'Extensión' } }); continue; }
        const ia = pa[route]; const ib = pb[route];
        if (ia !== undefined && ib === undefined) { opsOf(ia).forEach((m) => removedOps.push({ route, method: m, op: ia[m], item: ia })); if (!opsOf(ia).length) change('removed', ['paths', route], 'Ruta eliminada: ' + route, { cx: { meta: { route, area: 'Ruta' } }, old: ia, breaking: true, area: 'Ruta' }); continue; }
        if (ia === undefined) { opsOf(ib).forEach((m) => addedOps.push({ route, method: m, op: ib[m], item: ib })); if (!opsOf(ib).length) change('added', ['paths', route], 'Ruta anadida: ' + route, { cx: { meta: { route, area: 'Ruta' } }, new: ib, area: 'Ruta' }); continue; }
        const da = deref(A, ia, ['paths', route], {}); const db = deref(N, ib, ['paths', route], {});
        if (da.err || db.err) continue;
        const itemA = da.node; const itemB = db.node;
        for (const m of U.HTTP_METHODS) {
          if (isObj(itemA[m]) && !isObj(itemB[m])) removedOps.push({ route, method: m, op: itemA[m], item: itemA });
          else if (!isObj(itemA[m]) && isObj(itemB[m])) addedOps.push({ route, method: m, op: itemB[m], item: itemB });
          else if (isObj(itemA[m]) && isObj(itemB[m])) diffOperation(itemA, itemB, itemA[m], itemB[m], route, m, Array.isArray(itemB[m].tags) ? itemB[m].tags : Array.isArray(itemA[m].tags) ? itemA[m].tags : []);
        }
        for (const k of keysOf(itemA, itemB)) {
          if (U.HTTP_METHODS.includes(k) || k === 'parameters') continue;
          if (k.startsWith('x-')) { ext(k, itemA[k], itemB[k], ['paths', route, k], { meta: { route, area: 'Extensión' } }); continue; }
          if (!eq(itemA[k], itemB[k])) generic(itemA[k], itemB[k], ['paths', route, k], { meta: { route, area: 'Ruta' } }, 'Ruta ' + route);
        }
      }
      // movimientos: mismo operationId en otra ruta/metodo
      const byId = (list) => { const m = new Map(); list.forEach((o) => { const id = o.op.operationId; if (id) { if (!m.has(id)) m.set(id, []); m.get(id).push(o); } }); return m; };
      const idsAdded = byId(addedOps);
      const usedAdded = new Set();
      for (const r of removedOps) {
        const cand = r.op.operationId && idsAdded.get(r.op.operationId);
        const other = cand && cand.length === 1 && byId(removedOps).get(r.op.operationId).length === 1 ? cand[0] : null;
        if (other) {
          usedAdded.add(other);
          change('moved', ['paths', other.route, other.method], 'Operación movida: ' + r.method.toUpperCase() + ' ' + r.route + ' -> ' + other.method.toUpperCase() + ' ' + other.route, { cx: { meta: { route: other.route, method: other.method, tags: other.op.tags || [], area: 'Operación' } }, old: r.method.toUpperCase() + ' ' + r.route, new: other.method.toUpperCase() + ' ' + other.route, breaking: true, area: 'Operación', reason: 'Cambia la ruta o el método HTTP; los clientes existentes fallarán.' });
          diffOperation(r.item, other.item, r.op, other.op, other.route, other.method, other.op.tags || []);
        } else change('removed', ['paths', r.route, r.method], 'Operación eliminada: ' + r.method.toUpperCase() + ' ' + r.route, { cx: { meta: { route: r.route, method: r.method, tags: r.op.tags || [], area: 'Operación' } }, old: r.op, breaking: true, area: 'Operación', reason: 'Los clientes existentes que usen este endpoint dejaran de funcionar.' });
      }
      for (const ad of addedOps) if (!usedAdded.has(ad)) change('added', ['paths', ad.route, ad.method], 'Operación anadida: ' + ad.method.toUpperCase() + ' ' + ad.route, { cx: { meta: { route: ad.route, method: ad.method, tags: ad.op.tags || [], area: 'Operación' } }, new: ad.op, area: 'Operación' });
      return { pa, pb };
    }

    /* ---------- componentes ---------- */
    function diffComponents() {
      const ca = isObj(A.js.components) ? A.js.components : {}; const cb = isObj(N.js.components) ? N.js.components : {};
      for (const type of COMPONENT_TYPES) {
        const ma = isObj(ca[type]) ? ca[type] : {}; const mb = isObj(cb[type]) ? cb[type] : {};
        const removed = Object.keys(ma).filter((n) => !(n in mb)); const added = Object.keys(mb).filter((n) => !(n in ma));
        const renamed = new Map();
        for (const r of removed) {
          const match = added.find((n) => !Array.from(renamed.values()).includes(n) && eq(ma[r], mb[n]));
          if (match) renamed.set(r, match);
        }
        for (const n of Object.keys(ma)) {
          if (n.startsWith('x-')) { ext(n, ma[n], mb[n], ['components', type, n], { meta: { area: 'Extensión' } }); continue; }
          const segs = ['components', type, n];
          const meta = { area: type === 'schemas' ? 'Schema' : 'Componente', schema: type === 'schemas' ? n : null, component: type + '/' + n, section: 'components' };
          const cx = { meta, touchKey: 'comp:' + type + ':' + n, usage: { req: usageA.req.has(type + '/' + n) || usageB.req.has(type + '/' + n), res: usageA.res.has(type + '/' + n) || usageB.res.has(type + '/' + n) } };
          if (!(n in mb)) {
            if (renamed.has(n)) { change('renamed', ['components', type, renamed.get(n)], 'Componente renombrado: ' + type + '/' + n + ' -> ' + renamed.get(n), { cx, old: n, new: renamed.get(n), breaking: false, area: meta.area, reason: 'Contenido identico con otro nombre; puede afectar a código generado.' }); continue; }
            const used = usageA.req.has(type + '/' + n) || usageA.res.has(type + '/' + n) || type === 'securitySchemes';
            change('removed', segs, 'Componente eliminado: ' + type + '/' + n, { cx, old: ma[n], breaking: used, area: meta.area, reason: used ? 'El componente se usaba en el contrato base.' : '' });
            continue;
          }
          if (eq(ma[n], mb[n])) continue;
          diffComponent(type, ma[n], mb[n], segs, cx);
        }
        for (const n of added) {
          if (Array.from(renamed.values()).includes(n) || n.startsWith('x-')) continue;
          change('added', ['components', type, n], 'Componente anadido: ' + type + '/' + n, { cx: { meta: { area: type === 'schemas' ? 'Schema' : 'Componente', schema: type === 'schemas' ? n : null, section: 'components' } }, new: mb[n], area: type === 'schemas' ? 'Schema' : 'Componente' });
        }
      }
      for (const k of keysOf(ca, cb)) {
        if (COMPONENT_TYPES.includes(k)) continue;
        if (k.startsWith('x-')) ext(k, ca[k], cb[k], ['components', k], { meta: { area: 'Extensión' } });
        else generic(ca[k], cb[k], ['components', k], { meta: { area: 'Componente' } }, 'components');
      }
    }
    function diffComponent(type, a, b, segs, cx) {
      if (type === 'schemas') return diffSchema(a, b, segs, cx);
      if (type === 'parameters') {
        const da = deref(A, a, segs, cx); const db = deref(N, b, segs, cx);
        if (da.err || db.err) return;
        return diffParam(da.node, db.node, segs, cx);
      }
      if (type === 'responses') return diffResponseObject(a, b, segs, Object.assign({}, cx, { meta: Object.assign({}, cx.meta, { code: '' }) }));
      if (type === 'requestBodies') return diffRequestBody(a, b, segs, cx);
      if (type === 'headers') { const n = segs[segs.length - 1]; return diffHeaders({ [n]: a }, { [n]: b }, segs.slice(0, -1), cx); }
      if (type === 'securitySchemes') {
        for (const k of keysOf(a, b)) {
          if (k.startsWith('x-')) { ext(k, a[k], b[k], segs.concat([k]), cx); continue; }
          if (eq(a[k], b[k])) continue;
          const critical = ['type', 'scheme', 'in', 'name', 'flows', 'bearerFormat', 'openIdConnectUrl'].includes(k);
          change(a[k] === undefined ? 'added' : b[k] === undefined ? 'removed' : 'modified', segs.concat([k]), 'Esquema de seguridad ' + segs[2] + ': ' + k + ' cambia', { cx, old: a[k], new: b[k], breaking: critical, area: 'Seguridad', reason: critical ? 'Cambia la forma de autenticarse.' : '' });
        }
        return undefined;
      }
      return generic(a, b, segs, cx, type);
    }

    /* ---------- cabecera del contrato ---------- */
    function diffTop() {
      const a = A.js; const b = N.js;
      const cx = { meta: { area: 'Información', section: 'info' } };
      scalar('openapi', a.openapi, b.openapi, ['openapi'], cx, 'Versión OpenAPI', 'Información');
      if (!eq(a.info, b.info)) generic(a.info || {}, b.info || {}, ['info'], cx, 'Info');
      const sv = (l) => new Map((Array.isArray(l) ? l : []).map((s) => [s && s.url, s]));
      const sa = sv(a.servers); const sb = sv(b.servers);
      const scx = { meta: { area: 'Servidores', section: 'servers' } };
      for (const [u, s] of sa) if (!sb.has(u)) change('removed', ['servers', u], 'Servidor eliminado: ' + u, { cx: scx, old: s, area: 'Servidores' }); else if (!eq(s, sb.get(u))) generic(s, sb.get(u), ['servers', u], scx, 'Servidor ' + u);
      for (const [u, s] of sb) if (!sa.has(u)) change('added', ['servers', u], 'Servidor anadido: ' + u, { cx: scx, new: s, area: 'Servidores' });
      const tv = (l) => new Map((Array.isArray(l) ? l : []).map((t) => [t && t.name, t]));
      const ta = tv(a.tags); const tb = tv(b.tags);
      const tcx = { meta: { area: 'Tags', section: 'tags' } };
      for (const [n, t] of ta) if (!tb.has(n)) change('removed', ['tags', n], 'Tag eliminado: ' + n, { cx: tcx, old: t, area: 'Tags' }); else if (!eq(t, tb.get(n))) generic(t, tb.get(n), ['tags', n], tcx, 'Tag ' + n);
      for (const [n, t] of tb) if (!ta.has(n)) change('added', ['tags', n], 'Tag anadido: ' + n, { cx: tcx, new: t, area: 'Tags' });
      diffSecurity(a.security, b.security, ['security'], { meta: { area: 'Seguridad', section: 'security' } }, 'Contrato');
      for (const k of keysOf(a, b)) {
        if (['openapi', 'info', 'servers', 'tags', 'security', 'paths', 'components'].includes(k)) continue;
        if (k.startsWith('x-')) ext(k, a[k], b[k], [k], { meta: { area: 'Extensión' } });
        else if (!eq(a[k], b[k])) generic(a[k], b[k], [k], { meta: { area: 'Información' } }, k);
      }
    }

    diffTop();
    const { pa, pb } = diffPaths();
    diffComponents();

    // elementos sin cambios
    const unchanged = [];
    for (const route of Object.keys(pa)) {
      if (!isObj(pb[route])) continue;
      const da = deref(A, pa[route], [], {}); const db = deref(N, pb[route], [], {});
      if (da.err || db.err) continue;
      for (const m of U.HTTP_METHODS) if (isObj(da.node[m]) && isObj(db.node[m]) && !touched.has('op:' + route + ':' + m)) unchanged.push({ kind: 'unchanged', area: 'Operación', title: m.toUpperCase() + ' ' + route, route, method: m });
    }
    const csa = A.js.components && A.js.components.schemas; const csb = N.js.components && N.js.components.schemas;
    if (isObj(csa) && isObj(csb)) for (const n of Object.keys(csa)) if (n in csb && !touched.has('comp:schemas:' + n)) unchanged.push({ kind: 'unchanged', area: 'Schema', title: 'schemas/' + n, schema: n });

    // errores de resolucion y sintaxis de cada proyecto
    const sideErrors = [];
    for (const [label, proj] of [['base', baseProject], ['comparado', newProject]]) {
      proj.refIndex().filter((r) => r.error).forEach((r) => {
        sideErrors.push({ side: label, file: r.file, path: U.fmtPath(r.path), ref: r.ref, message: r.message });
        change('error', r.path, 'Referencia sin resolver en ' + label + ': ' + r.ref + ' (' + r.file + ')', { cx: { meta: { area: 'Error' } }, area: 'Error', reason: 'No se puede comparar este elemento porque su referencia no se resuelve; no se considera igual.' });
      });
      proj.files.forEach((f, p) => f.errors.filter((e) => e.severity === 'error').forEach((e) => sideErrors.push({ side: label, file: p, path: 'línea ' + e.line, ref: '', message: 'Sintaxis YAML: ' + e.message })));
    }

    const summary = { added: 0, removed: 0, modified: 0, renamed: 0, moved: 0, error: 0, breaking: 0, nonBreaking: 0, total: changes.length, unchanged: unchanged.length };
    changes.forEach((c) => { summary[c.kind] = (summary[c.kind] || 0) + 1; if (c.kind !== 'error') { if (c.breaking) summary.breaking++; else summary.nonBreaking++; } });
    return { changes, unchanged, summary, sideErrors, incomplete: sideErrors.length > 0 || summary.error > 0, options: opts };
  }

  /* ---------- Exportacion ---------- */
  const KIND_ES = { added: 'Anadido', removed: 'Eliminado', modified: 'Modificado', renamed: 'Renombrado', moved: 'Movido', error: 'Error', unchanged: 'Sin cambios' };
  function fmtVal(v) { if (v === undefined) return '-'; const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 300 ? s.slice(0, 300) + '...' : s; }
  function toJson(result) { return JSON.stringify({ resumen: result.summary, incompleta: result.incomplete, erroresDeResolucion: result.sideErrors, cambios: result.changes }, null, 2); }
  function toMarkdown(result, meta) {
    const s = result.summary;
    const L = ['# Comparación de contratos OpenAPI', '', meta && meta.base ? '- Base: ' + meta.base : '', meta && meta.compared ? '- Comparado: ' + meta.compared : '', '',
      '| Anadidos | Eliminados | Modificados | Renombrados/movidos | Potencialmente incompatibles | Errores |', '|---|---|---|---|---|---|',
      '| ' + s.added + ' | ' + s.removed + ' | ' + s.modified + ' | ' + (s.renamed + (s.moved || 0)) + ' | ' + s.breaking + ' | ' + s.error + ' |', '',
      '> La clasificacion de cambios incompatibles es orientativa y no garantiza compatibilidad.', ''];
    if (result.incomplete) L.push('> **Atención:** hay referencias sin resolver o errores de sintaxis; la comparación puede estar incompleta.', '');
    for (const e of result.sideErrors) L.push('- Error (' + e.side + '): ' + e.file + ' ' + e.path + ' - ' + e.message);
    const groups = {};
    result.changes.forEach((c) => { (groups[c.area] = groups[c.area] || []).push(c); });
    for (const area of Object.keys(groups)) {
      L.push('', '## ' + area, '');
      for (const c of groups[area]) {
        L.push('- **' + KIND_ES[c.kind] + '**' + (c.breaking ? ' [POTENCIALMENTE INCOMPATIBLE]' : '') + ' `' + c.id + '` ' + c.title);
        L.push('  - Ruta: `' + c.pathText + '`');
        if (c.old !== undefined || c.new !== undefined) L.push('  - Antes: `' + fmtVal(c.old).replace(/`/g, "'") + '` / Ahora: `' + fmtVal(c.new).replace(/`/g, "'") + '`');
        if (c.reason) L.push('  - Motivo: ' + c.reason);
      }
    }
    return L.join('\n') + '\n';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toHtml(result, meta) {
    const s = result.summary;
    const rows = result.changes.map((c) => '<tr class="' + c.kind + (c.breaking ? ' brk' : '') + '"><td>' + esc(c.id) + '</td><td>' + esc(KIND_ES[c.kind]) + '</td><td>' + esc(c.area) + '</td><td>' + esc(c.title) + (c.breaking ? ' <b>(incompatible)</b>' : '') + '<br><code>' + esc(c.pathText) + '</code></td><td><code>' + esc(fmtVal(c.old)) + '</code></td><td><code>' + esc(fmtVal(c.new)) + '</code></td><td>' + esc(c.reason) + '</td></tr>').join('\n');
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comparación OpenAPI</title><style>body{font:14px Bahnschrift,"Segoe UI",sans-serif;margin:24px;color:#1f2933}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9dee3;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f5f7}code{font:12px Consolas,monospace;word-break:break-all}tr.brk td:first-child{border-left:4px solid #c0392b}tr.added td:nth-child(2){color:#0f766e}tr.removed td:nth-child(2){color:#b42318}tr.modified td:nth-child(2){color:#b45309}</style></head><body><h1>Comparación de contratos OpenAPI</h1><p>Base: ' + esc((meta && meta.base) || '') + ' &middot; Comparado: ' + esc((meta && meta.compared) || '') + '</p><p>Anadidos: ' + s.added + ' &middot; Eliminados: ' + s.removed + ' &middot; Modificados: ' + s.modified + ' &middot; Potencialmente incompatibles: ' + s.breaking + ' &middot; Errores: ' + s.error + '</p><p><i>La clasificacion de cambios incompatibles es orientativa.</i></p>' + (result.incomplete ? '<p><b>Atención:</b> la comparación puede estar incompleta por referencias sin resolver.</p>' : '') + '<table><thead><tr><th>Id</th><th>Tipo</th><th>Area</th><th>Cambio</th><th>Antes</th><th>Ahora</th><th>Motivo</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>';
  }

  /* ---------- Diff textual (vista secundaria) ---------- */
  function lineDiff(a, b) {
    const x = a.split(/\r?\n/); const y = b.split(/\r?\n/);
    let s = 0;
    while (s < x.length && s < y.length && x[s] === y[s]) s++;
    let ex = x.length; let ey = y.length;
    while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) { ex--; ey--; }
    const xm = x.slice(s, ex); const ym = y.slice(s, ey);
    if (xm.length * ym.length > 6000000) return { tooLarge: true, lines: [] };
    const n = xm.length; const m = ym.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    const W = m + 1;
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = xm[i] === ym[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    const out = [];
    for (let i = 0; i < s; i++) out.push({ t: '=', text: x[i] });
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (xm[i] === ym[j]) { out.push({ t: '=', text: xm[i] }); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) out.push({ t: '-', text: xm[i++] });
      else out.push({ t: '+', text: ym[j++] });
    }
    while (i < n) out.push({ t: '-', text: xm[i++] });
    while (j < m) out.push({ t: '+', text: ym[j++] });
    for (let k = ex; k < x.length; k++) out.push({ t: '=', text: x[k] });
    return { tooLarge: false, lines: out };
  }

  return { compareProjects, toJson, toMarkdown, toHtml, lineDiff, KIND_ES, computeUsage };
});
