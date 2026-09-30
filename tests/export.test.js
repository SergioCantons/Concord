const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../js/core/project.js');
const { planExport } = require('../js/core/export.js');
const { applyPlan, memoryIo } = require('../js/core/writer.js');
const { validateProject } = require('../js/core/validate.js');
const { compareProjects } = require('../js/core/compare.js');
const { loadDir } = require('./helpers.js');

const open = (dir) => Project.fromFiles(loadDir(dir), 'openapi.yaml');
const reopen = (plan) => Project.fromFiles(plan.files, plan.rootPath);

test('exportar a documento unico: sin $ref a ficheros, comentarios y x-* conservados, se recarga y valida', () => {
  const p = open('02-fragmentado');
  const plan = planExport(p, { mode: 'single', rootName: 'unico.yaml', outDir: 'salida' });
  assert.deepEqual([...plan.files.keys()], ['salida/unico.yaml']);
  const text = plan.files.get('salida/unico.yaml');
  assert.ok(!/\$ref: ['"]?\.{0,2}\//.test(text));
  assert.match(text, /# Schema compartido por varias operaciones/);
  assert.match(text, /x-internal-name: ProductRecord/);
  assert.match(text, /x-owner: equipo-catalogo # extension propietaria/);
  assert.equal(plan.verification.ok, true, plan.verification.errors.join('; '));
  assert.equal(plan.preview.created.length, 1);
});

for (const strategy of ['tags', 'paths', 'components', 'schemas']) {
  test('caso 8 (' + strategy + '): exportar con numero objetivo de fragments, reabrir y validar sin referencias rotas', () => {
    const p = Project.fromFiles(loadDir('04-cambiado'), 'openapi.yaml');
    const plan = planExport(p, { mode: 'fragments', strategy, target: 5, outDir: 'frag' });
    assert.equal(plan.verification.ok, true, plan.verification.errors.join('; '));
    const q = reopen(plan);
    assert.equal(q.refIndex().filter((r) => r.error).length, 0);
    assert.deepEqual(validateProject(q).diagnostics.filter((d) => d.severity === 'error'), []);
    assert.deepEqual(compareProjects(p, q).changes, []);
    assert.ok(plan.files.size > 1);
    assert.ok([...plan.files.keys()].every((k) => k.startsWith('frag/')));
    if (strategy === 'tags' || strategy === 'components') assert.equal(plan.groups.length, 5 <= plan.natural ? 5 : plan.groups.length);
  });
}

test('el numero objetivo se respeta cuando es posible (fusionar y dividir grupos)', () => {
  const p = open('02-fragmentado');
  const few = planExport(p, { strategy: 'paths', target: 3 });
  assert.ok(few.groups.length <= 5, 'fusiona grupos de paths');
  const many = planExport(p, { strategy: 'components', target: 8 });
  assert.equal(many.groups.length, 8);
  assert.equal(many.verification.ok, true, many.verification.errors.join('; '));
  const impossible = planExport(p, { strategy: 'components', target: 1 });
  assert.ok(impossible.notes.some((n) => /objetivo/.test(n)));
  assert.equal(impossible.verification.ok, true);
});

test('caso 11b: reorganizar un contrato fragmentado en otra distribucion mantiene la semantica y cambia los nombres', () => {
  const p = open('02-fragmentado');
  const plan = planExport(p, { strategy: 'tags', target: 6, naming: 'snake', groupNames: { 'paths/productos': 'dominio/catalogo' } });
  assert.ok(plan.files.has('dominio/catalogo.yaml'));
  const q = reopen(plan);
  assert.deepEqual(compareProjects(p, q).changes, []);
  assert.ok(plan.preview.created.length > 0 && plan.preview.unused.length > 0, 'ficheros nuevos y ficheros que quedan sin usar (no se eliminan)');
  // reglas personalizadas
  const c = planExport(p, { strategy: 'custom', customRules: 'paths:/productos* => api/productos\nschemas:* => modelos/schemas\nresponses:* => comunes/respuestas' });
  assert.ok(c.files.has('api/productos.yaml') && c.files.has('modelos/schemas.yaml'));
  assert.equal(c.verification.ok, true, c.verification.errors.join('; '));
});

test('caso 12: sobrescribir un fichero existente solicita confirmacion y hace copia de seguridad; rechazar no escribe', async () => {
  const p = open('02-fragmentado');
  p.mutate('e', (tx) => tx.set(['info', 'title'], 'Otro titulo'));
  const plan = planExport(p, { mode: 'single', rootName: 'openapi.yaml' });
  const disk = new Map([['openapi.yaml', 'contenido original']]);
  let asked = null;
  let r = await applyPlan(plan.files, memoryIo(disk), { confirmOverwrite: async (list) => { asked = list; return false; } });
  assert.equal(r.cancelled, true);
  assert.deepEqual(asked, ['openapi.yaml']);
  assert.equal(disk.get('openapi.yaml'), 'contenido original');
  r = await applyPlan(plan.files, memoryIo(disk), { confirmOverwrite: async () => true, now: new Date(2026, 0, 2, 3, 4, 5) });
  assert.equal(r.ok, true);
  assert.equal(disk.get('.oat-backup/20260102-030405/openapi.yaml'), 'contenido original');
  assert.match(disk.get('openapi.yaml'), /Otro titulo/);
  // sin conflictos (fichero nuevo) no se pide confirmacion
  const fresh = new Map();
  r = await applyPlan(plan.files, memoryIo(fresh), { confirmOverwrite: async () => { throw new Error('no debe preguntar'); } });
  assert.equal(r.ok, true);
});

test('un fallo de escritura revierte los ficheros ya escritos (rollback)', async () => {
  const p = open('02-fragmentado');
  const plan = planExport(p, { strategy: 'tags', target: 4 });
  const disk = new Map(loadDir('02-fragmentado'));
  const original = new Map(disk);
  let n = 0;
  const io = memoryIo(disk, { beforeWrite: (path) => { if (!path.startsWith('.oat-backup') && ++n === 3) throw new Error('disco lleno'); } });
  const r = await applyPlan(plan.files, io, { confirmOverwrite: async () => true });
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  for (const [k, v] of original) assert.equal(disk.get(k), v, k);
  for (const k of disk.keys()) assert.ok(original.has(k) || k.startsWith('.oat-backup'), 'no quedan ficheros nuevos: ' + k);
});

test('el escritor rechaza rutas fuera de la carpeta, absolutas o dentro de .oat-backup sin tocar nada', async () => {
  for (const bad of ['../fuera.yaml', 'a/../../fuera.yaml', 'C:/x.yaml', '/abs.yaml', 'a\\b.yaml', '.oat-backup/x.yaml']) {
    const disk = new Map([['openapi.yaml', 'x']]);
    const r = await applyPlan(new Map([['openapi.yaml', 'y'], [bad, 'z']]), memoryIo(disk), { confirmOverwrite: async () => true });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /Ruta no permitida/);
    assert.deepEqual([...disk.keys()], ['openapi.yaml']);
    assert.equal(disk.get('openapi.yaml'), 'x');
  }
});
