# Editor y comparador de contratos OpenAPI

Herramienta local (HTML + CSS + JavaScript, sin framework, sin servidor y sin red) para editar, validar, guardar (documento único o fragments) y comparar semánticamente contratos OpenAPI 3.0.x en YAML.
## Uso (usuario final)

1. Descomprime o copia la carpeta del proyecto.
2. Haz doble clic en `index.html`. Funciona desde `file://`; no hace falta Node, `npm` ni servidor. Las dependencias ya están empaquetadas en `vendor/`.
3. Desde la pantalla de inicio: crear un contrato desde plantilla, abrir una carpeta, abrir ficheros sueltos, cargar un ejemplo o comparar dos contratos.

Guía breve:

- **Añadir/duplicar/eliminar endpoints**: explorador lateral, sección de paths; el menú de cada operación permite duplicar (genera un `operationId` único), cambiar de tag, mover/renombrar la ruta o eliminar (con confirmación).
- **Editar schemas**: sección de componentes; propiedades, `required`, restricciones, `enum`, composición (`allOf`/`oneOf`/`anyOf`), extraer un schema inline a componente, renombrar (reescribe los `$ref`) y eliminar (avisa de los consumidores).
- **YAML avanzado**: pestaña de YAML por fichero; un YAML inválido se guarda como borrador y no se pierde.
- **Guardar** (`Ctrl+S`): elegir documento único o fragments, estrategia (tags, paths, componentes, schemas o reglas propias), número objetivo, nombres y carpeta; se muestra la previsualización (creados/modificados/sin uso) y una verificación del resultado antes de escribir.
- **Comparar**: cargar base y comparado (botones o arrastrando ficheros YAML/JSON o su carpeta sobre cada tarjeta; pueden tener distinta distribución de ficheros), filtrar, buscar y exportar a Markdown, HTML o JSON. Las vistas *Formulario* (cambios semánticos), *YAML* (diff textual por fichero) y *Dividida* (ambas, solo en pantallas anchas) conservan los contratos elegidos y el resultado.
- Atajos: `Ctrl+S` guardar, `Ctrl+K` buscar, `Ctrl+Z` / `Ctrl+Y` deshacer/rehacer (fuera de campos de texto).
- **Paneles ajustables**: arrastra los separadores para cambiar el ancho del explorador, el alto del panel de validación, el reparto de la vista dividida (formulario/YAML) y, en el comparador, el reparto entre cambios y diff, y entre la lista de cambios y su detalle. También con el teclado (foco en el separador + flechas; `Mayús` para pasos grandes). Doble clic o `Intro` vuelven al tamaño original. Los tamaños se guardan en `localStorage`.

## Desarrollo

Requiere Node.js (probado con v24) solo para desarrollar; la aplicación en sí no lo necesita.

```
npm ci              # instala dependencias exactas de package-lock.json
npm run build       # regenera vendor/oat-vendor.js, vendor/icons.js y js/ui/examples-data.js
npm run build:examples   # solo incrusta los ejemplos de examples/
npm test            # node --test tests/*.test.js (sin dependencias de test extra)
```

Los ficheros generados (`vendor/*`, `js/ui/examples-data.js`) están versionados para que `index.html` funcione sin construir nada. Si cambias `examples/` o `vendor-src/`, ejecuta `npm run build`.

Estructura: `js/core/` (modelo, proyecto/AST, `$ref`, validación, operaciones, comparación, exportación, escritura segura; también se ejecuta bajo Node en las pruebas), `js/ui/` (interfaz), `css/`, `vendor-src/` y `scripts/` (empaquetado), `examples/` y `tests/`.

### Dependencias y justificación

| Paquete | Versión (lock) | Uso | Motivo |
|---|---|---|---|
| `yaml` | 2.9.1 | Parser/serializador YAML | Trabaja sobre un AST que conserva comentarios, orden y `x-*`; el editor modifica el AST en vez de regenerar el documento. |
| `@apidevtools/openapi-schemas` | 2.1.0 | JSON Schema oficial de OpenAPI 3.0 | Validación estructural sin reescribirla a mano. |
| `ajv-draft-04` + `ajv-formats` | 1.0.0 + 3.0.1 | Ejecutar ese esquema (draft-04) | El esquema oficial 3.0 usa draft-04. |
| `fflate` | 0.8.3 | ZIP | Alternativa de guardado cuando no hay acceso a carpeta. |
| `esbuild-wasm` (dev) | 0.28.2 | Empaquetar lo anterior en un único script | Versión WASM: no depende de descargar un binario nativo. |
| `lucide-static` (dev) | 1.49.0 | Iconos SVG (52) | Incluidos localmente en `vendor/icons.js`. |

Tamaño del código empaquetado: `vendor/oat-vendor.js` ≈ 327 KB (minificado) y `vendor/icons.js` ≈ 19 KB. No se usa framework de UI: la interfaz es DOM nativo para mantener la carga instantánea y evitar una cadena de construcción en tiempo de uso.

## Privacidad y funcionamiento local

- No hay llamadas de red: ni al abrir, ni al validar, ni al comparar. Las referencias `$ref` remotas (`http://`, `https://`) están siempre deshabilitadas y se reportan como error accionable. No hay telemetría ni IA.
- Los contratos no salen del equipo. Datos que el navegador guarda localmente:
  - Preferencias de validación y tamaños de los paneles en `localStorage`.
  - Contratos recientes (carpetas y ficheros sueltos, hasta 8) en IndexedDB: solo los identificadores que da el navegador, no su contenido. Se pueden vaciar desde el propio menú de recientes.
  - Recuperación de sesión: **desactivada por defecto**; si se activa en ajustes, copia el contenido de los ficheros en `localStorage` mientras hay cambios sin guardar.
- Las rutas de `$ref` se resuelven dentro de la carpeta del proyecto; las que salen de ella o son absolutas se marcan como error. La escritura rechaza rutas con `..`, absolutas, con unidad (`C:`) o dentro de `.oat-backup/`.

## Navegadores, permisos y límites del sistema de ficheros

- Con navegadores Chromium (Chrome, Edge) se usa la API File System Access: al abrir una carpeta se concede permiso de lectura y escritura a esa carpeta, y se puede guardar directamente en disco. Esa API puede no estar disponible o exigir contexto seguro en otros navegadores.
- Sin esa API (p. ej. Firefox) se abre la carpeta/ficheros mediante selector de ficheros (solo lectura). El guardado se hace descargando un **ZIP** (o un único YAML si el resultado es un solo fichero); hay que extraerlo manualmente. No se puede sobrescribir en disco en ese modo.
- Los contratos recientes solo existen con esa API (Chromium). Aparecen en el menú de abrir y en el botón **Recientes** de cada tarjeta del comparador. Al reabrirlos puede que el navegador vuelva a pedir permiso (escritura para carpetas y lectura para ficheros). Si ya no existen, se quitan de la lista. Lo que se suelta arrastrando no se guarda en recientes.
- Solo se leen `.yaml`, `.yml` y `.json` de hasta 8 MB por fichero; se omiten `node_modules`, `.git`, `.oat-backup`, `.svn`, `.idea` y `.vscode`.
- Al escribir se valida el nombre para Windows (caracteres y nombres reservados).

## Protección frente a pérdidas

- Antes de sobrescribir ficheros existentes se pide confirmación y se copian a `.oat-backup/AAAAMMDD-HHMMSS/` dentro de la carpeta del proyecto.
- Si falla una escritura, se restauran los ficheros ya escritos (rollback) y se elimina lo creado. La API del navegador escribe cada fichero de forma atómica; el conjunto de ficheros no es una transacción del sistema operativo, por lo que el rollback es "mejor esfuerzo".
- Los ficheros que quedan sin uso tras fragmentar **no se borran**: solo se listan como "sin uso".
- Deshacer/rehacer, aviso de cambios sin guardar al cerrar (`beforeunload`) y borrador cuando el YAML es inválido.

## Limitaciones conocidas

**Comentarios y formato**
- Las ediciones se hacen sobre el AST, así que comentarios, `x-*` y claves desconocidas se conservan en los ficheros y nodos que no se tocan y, en general, al empaquetar/fragmentar. Al guardar se reserializa cada fichero modificado: el formato (indentación, comillas, ancho de línea, saltos de línea) puede normalizarse, y algunos comentarios situados en posiciones inusuales (p. ej. entre una clave y su valor, o junto a un `$ref` que se sustituye) pueden moverse o perderse. Las propiedades hermanas de un `$ref` se descartan al empaquetar (aviso en OpenAPI 3.0).
- Anclas y alias YAML se expanden al empaquetar.

**OpenAPI y referencias**
- Soporte completo solo para OpenAPI **3.0.x**. Para 3.1.x se muestra un aviso y se omite la validación estructural (se aplican las reglas comunes); el modelo no contempla aún construcciones propias de 3.1 (p. ej. `type` como lista, `webhooks`, `$defs`).
- Swagger 2.0 no está soportado.
- Solo punteros JSON (`#/ruta`); no se resuelven anclas con nombre (`$anchor`, `$id`).
- `$ref` remotos deshabilitados; no hay opción para activarlos.
- Los `$ref` circulares se detectan y no bloquean la aplicación; en la comparación los ciclos se despliegan hasta repetirse, por lo que un único cambio dentro de un ciclo puede aparecer varias veces.

**Comparación**
- Es semántica sobre el modelo con referencias resueltas; ignora orden de claves, formato y comentarios. La clasificación de cambios incompatibles es orientativa, no una garantía.
- Los cambios de nombre/movimiento solo se infieren cuando el contenido es idéntico.
- Se ejecuta en el hilo principal (sin Web Worker): con contratos muy grandes la interfaz puede notarse bloqueada durante el cálculo.

**Interfaz y funcionalidad no cubierta o parcial**
- Sin autocompletado contextual en el editor YAML (es un `textarea`; se evita cualquier dependencia pesada).
- El idioma es solo español (no configurable). No hay recorrido de rutas con carga bajo demanda ni virtualización específica; el rendimiento con miles de schemas no se ha medido.
- La fragmentación no elimina ficheros antiguos ni actualiza ficheros ajenos al proyecto.
- No se ha añadido edición visual dedicada a todos los campos posibles (callbacks, links, etc.); se pueden editar con el YAML avanzado.
- La interfaz no está cubierta por pruebas automáticas; solo se ha revisado manualmente.

No se debe considerar cumplida la totalidad de los criterios de aceptación del MVP solo por esta documentación: los criterios sobre el núcleo (referencias, guardado, fragmentos, comparación) están cubiertos por pruebas; los de interfaz requieren verificación manual en el navegador.

## Cobertura real de pruebas

`npm test` ejecuta 27 pruebas de `node:test` sobre `js/core/` (sin navegador):

| Área | Qué se comprueba |
|---|---|
| Casos mínimos 1–7, 13, 14 (`tests/cases.test.js`) | Contrato simple; fragmentado con espacios/Unicode y `$ref` circulares; referencia rota y YAML inválido con fichero/línea/ruta; endpoint con parámetro de path; duplicado con `operationId` único; schema compartido; renombrar schema (incl. `discriminator.mapping`); eliminar schema usado; `x-*` conservado; cambios rechazados/borrador. |
| Casos 9–11 (`tests/compare.test.js`) | Igualdad con distinto orden/formato (incl. ciclos), endpoint eliminado + parámetro obligatorio + cambio de tipo (incompatibles), distinta distribución de ficheros, referencias sin resolver, exportación Markdown/HTML/JSON y diff textual. |
| Casos 8, 11b, 12 (`tests/export.test.js`) | Exportar documento único y fragments con las cuatro estrategias y número objetivo, recarga + validación + comparación sin cambios; confirmación de sobrescritura, copia de seguridad, rollback ante fallo y rechazo de rutas fuera de la carpeta. |
| `tests/project.test.js` | Edición sobre el AST conservando comentarios y `x-*`, con fragment compartido. |

No hay pruebas de la interfaz, de la API File System Access real (se usa una E/S en memoria), de rendimiento ni de OpenAPI 3.1.

## Ejemplos

`examples/01-simple`, `02-fragmentado` (rutas con espacios, refs circulares y refs de vuelta al raíz), `03-roto` (referencia rota y YAML mal formado) y `04-cambiado` (para probar la comparación). Se incrustan en la aplicación con `npm run build:examples`.
