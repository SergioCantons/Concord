const test = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../js/core/project.js');
const { loadDir } = require('./helpers.js');

// Hipotesis falsable: editar via AST conserva comentarios y claves x-*, y un schema compartido
// en un fragment se actualiza para todos los consumidores sin tocar el resto de ficheros.
test('edicion AST conserva comentarios, x-* y edita el fragment compartido', () => {
  const p = Project.fromFiles(loadDir('02-fragmentado'), 'openapi.yaml');
  const before = p.texts();
  p.mutate('Editar nombre maximo', (tx) => {
    tx.set(['components', 'schemas', 'Producto', 'properties', 'nombre', 'maxLength'], 200);
    tx.set(['info', 'x-owner'], 'equipo-nuevo');
  });
  const after = p.texts();
  assert.match(after.get('schemas/producto.yaml'), /maxLength: 200/);
  assert.match(after.get('schemas/producto.yaml'), /# Schema compartido por varias operaciones/);
  assert.match(after.get('schemas/producto.yaml'), /x-internal-name: ProductRecord/);
  assert.match(after.get('openapi.yaml'), /x-owner: equipo-nuevo # extension propietaria/);
  assert.match(after.get('openapi.yaml'), /# Ejemplo ficticio/);
  // solo cambian los ficheros tocados
  const changed = [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k).sort();
  assert.deepEqual(changed, ['openapi.yaml', 'schemas/producto.yaml']);
  // el resto del fichero editado queda identico
  const a = before.get('schemas/producto.yaml').replace('maxLength: 120', 'maxLength: 200');
  assert.equal(after.get('schemas/producto.yaml'), a);
  // deshacer restaura exactamente
  p.undo();
  assert.equal(p.texts().get('schemas/producto.yaml'), before.get('schemas/producto.yaml'));
  assert.equal(p.isDirty(), false);
});
