const test = require('node:test');
const assert = require('node:assert/strict');
const { YAML } = require('../vendor-src/entry.js');
const { Project } = require('../js/core/project.js');
const { bundleProject } = require('../js/core/bundle.js');
const { compareProjects, toMarkdown, toHtml, toJson, lineDiff } = require('../js/core/compare.js');
const { loadDir } = require('./helpers.js');

const open = (dir) => Project.fromFiles(loadDir(dir), 'openapi.yaml');

/** Reescribe un contrato como YAML unico con las claves en orden inverso (y listas tipo conjunto invertidas). */
function shuffledSingleFile(project) {
  const js = bundleProject(project).js;
  const SET = new Set(['required', 'enum', 'tags']);
  const rev = (v, key) => {
    if (Array.isArray(v)) { const m = v.map((x) => rev(x)); return SET.has(key) ? m.reverse() : m; }
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).reverse().forEach((k) => { o[k] = rev(v[k], k); }); return o; }
    return v;
  };
  return Project.fromFiles({ 'contrato-unico.yaml': '# reescrito\n' + YAML.stringify(rev(js)) }, 'contrato-unico.yaml');
}

test('caso 9: mismo contrato con distinto orden de claves y formato no genera cambios (incluye schema circular)', () => {
  const a = open('02-fragmentado');
  const b = shuffledSingleFile(a);
  const r = compareProjects(a, b);
  assert.deepEqual(r.changes.map((c) => c.title), []);
  assert.equal(r.incomplete, false);
  assert.equal(r.unchanged.filter((u) => u.area === 'Operación').length, 8);
  assert.ok(r.unchanged.some((u) => u.schema === 'Categoria'));
});

test('caso 10: endpoint eliminado, parametro obligatorio anadido y tipo de propiedad cambiado se marcan como incompatibles', () => {
  const r = compareProjects(open('02-fragmentado'), open('04-cambiado'));
  const by = (pred) => r.changes.filter(pred);
  const removedOp = by((c) => c.kind === 'removed' && c.method === 'delete' && c.route === '/productos/{productoId}');
  assert.equal(removedOp.length, 1); assert.equal(removedOp[0].breaking, true);
  const reqParam = by((c) => c.kind === 'modified' && /categoria.*obligatorio/.test(c.title) && c.route === '/productos' && c.method === 'get');
  assert.equal(reqParam.length, 1); assert.equal(reqParam[0].breaking, true);
  const typeChange = by((c) => c.kind === 'modified' && /Tipo cambia: number -> string/.test(c.title) && c.pathText.includes('precio'));
  assert.ok(typeChange.length >= 1); assert.ok(typeChange.every((c) => c.breaking));
  // nueva operacion y version: no incompatibles
  const added = by((c) => c.kind === 'added' && c.route === '/categorias');
  assert.equal(added.length, 1); assert.equal(added[0].breaking, false);
  assert.ok(by((c) => c.pathText === 'info.version').every((c) => !c.breaking));
  // sensible al contexto: quitar 'enviado' del enum de una respuesta no es incompatible, del parametro de peticion si
  const enumResp = by((c) => c.kind === 'removed' && /enviado/.test(c.title) && c.schema === 'Pedido');
  assert.equal(enumResp.length, 1); assert.equal(enumResp[0].breaking, false);
  const enumReq = by((c) => c.kind === 'removed' && /enviado/.test(c.title) && c.method === 'get' && c.route === '/pedidos');
  assert.equal(enumReq.length, 1); assert.equal(enumReq[0].breaking, true);
  assert.ok(r.summary.breaking >= 4);
  // cada cambio tiene ruta, id y area
  assert.ok(r.changes.every((c) => c.id && c.pathText && c.area));
});

test('caso 11: distinta distribucion de ficheros y nombres se compara igual (fragmentado vs unico)', () => {
  const frag = open('02-fragmentado');
  const renamedFiles = new Map();
  for (const [p, t] of loadDir('02-fragmentado')) renamedFiles.set(p === 'openapi.yaml' ? p : 'otra estructura/' + p.replace(/\//g, '_'), t);
  // reescribe las referencias relativas a la nueva estructura plana
  const fixed = new Map();
  for (const [p, t] of renamedFiles) {
    fixed.set(p, t.replace(/\$ref: (['"]?)((?:\.\.?\/)[^'"\n]*?\.yaml)(['"]?)/g, (m, q1, ref, q2) => {
      const base = ref.split('/').pop();
      const target = Array.from(renamedFiles.keys()).find((k) => k.endsWith('_' + base) || k.endsWith('/' + base));
      if (!target) return m;
      const from = p === 'openapi.yaml' ? '' : 'otra estructura';
      const rel = from ? (target.startsWith('otra estructura/') ? './' + target.slice('otra estructura/'.length) : '../' + target) : './' + target;
      return '$ref: ' + q1 + rel + q2;
    }));
  }
  // los $ref internos hacia el raiz (openapi.yaml#...) tambien deben cambiar
  for (const [p, t] of fixed) if (p !== 'openapi.yaml') fixed.set(p, t.replace(/\.\.\/openapi\.yaml#/g, '../openapi.yaml#'));
  const other = Project.fromFiles(fixed, 'openapi.yaml');
  assert.equal(other.refIndex().filter((x) => x.error).length, 0, JSON.stringify(other.refIndex().filter((x) => x.error).map((x) => x.file + ' ' + x.ref)));
  assert.deepEqual(compareProjects(frag, other).changes, []);
  assert.deepEqual(compareProjects(frag, shuffledSingleFile(other)).changes, []);
});

test('referencias sin resolver producen error de comparacion, nunca una falsa igualdad', () => {
  const a = open('03-roto'); const b = open('03-roto');
  const r = compareProjects(a, b);
  assert.equal(r.incomplete, true);
  assert.ok(r.sideErrors.length >= 2);
  assert.ok(r.changes.some((c) => c.kind === 'error' && /sin resolver/.test(c.title)));
});

test('un schema con distinto contenido pero mismo nombre se reporta en el componente, no en cada consumidor', () => {
  const a = open('02-fragmentado');
  const b = open('02-fragmentado');
  b.mutate('cambio', (tx) => tx.set(['components', 'schemas', 'ProductoNuevo', 'properties', 'nombre', 'maxLength'], 60));
  const r = compareProjects(a, b);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].schema, 'ProductoNuevo');
  assert.equal(r.changes[0].breaking, true, 'ProductoNuevo se usa en peticiones: endurecer maxLength es incompatible');
  // el mismo cambio en un schema que solo se usa en respuestas no es incompatible
  const c = open('02-fragmentado');
  c.mutate('cambio', (tx) => tx.set(['components', 'schemas', 'Producto', 'properties', 'nombre', 'maxLength'], 60));
  assert.equal(compareProjects(a, c).changes[0].breaking, false);
});

test('exportacion a Markdown, HTML y JSON y diff textual', () => {
  const r = compareProjects(open('02-fragmentado'), open('04-cambiado'));
  const md = toMarkdown(r, { base: 'a', compared: 'b' });
  assert.match(md, /POTENCIALMENTE INCOMPATIBLE/);
  assert.match(md, /orientativa/);
  assert.match(toHtml(r, { base: '<x>' }), /&lt;x&gt;/);
  assert.equal(JSON.parse(toJson(r)).cambios.length, r.changes.length);
  const d = lineDiff('a\nb\nc', 'a\nx\nc');
  assert.deepEqual(d.lines.map((l) => l.t), ['=', '-', '+', '=']);
});
