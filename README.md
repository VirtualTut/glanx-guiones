# Glanx Guiones

Herramienta web de **Glanx Studio** para escribir guiones y preparar la producción. Todo sale del mismo guion.

**Abrir:** https://virtualtut.github.io/glanx-guiones/

## Qué tiene
- **Guion:** editor con formato de guion. `Enter` pasa al siguiente elemento (escena → acción, personaje → diálogo…), `Tab` cambia el tipo y `Ctrl+1…6` elige un tipo concreto. Si escribes `INT.` o `EXT.` se convierte en escena sola. Puedes pegar un guion entero en texto.
- **Desglose:** por escena: reparto (sale solo de los personajes), utilería, vestuario, maquillaje, efectos, vehículos, sonido… Selecciona palabras en el texto para etiquetarlas. También hay un resumen de todo el guion.
- **Planos:** lista de planos por escena con tamaño, lente, movimiento, descripción, duración e imagen de referencia.
- **Plan de rodaje:** cada escena es una tira (con el color de INT/EXT y día/noche); se arrastra al día en que se graba.
- **Presupuesto:** departamentos y conceptos, previsto contra real, imprevistos y moneda (COP por defecto).
- **Moodboard:** imágenes de referencia por escena o generales (arrastrar, pegar con Ctrl+V o elegir).

## Exportar e importar
- PDF del guion con portada y formato estándar (Courier, carta) e impresión de cualquier pestaña.
- Fountain (`.fountain`) y Final Draft (`.fdx`).
- **Respaldo completo (`.json`)**: guion, desglose, planos, plan, presupuesto e imágenes. Se importa desde el inicio.

## Dónde se guardan los datos
Solo en el navegador de cada persona (localStorage, y las imágenes en IndexedDB). En este repositorio solo está el código: los guiones **no** se suben a GitHub. Para pasarlos a otra persona o tener una copia, exporta el respaldo `.json` y súbelo a Drive.

Es una página estática: `index.html`, `styles.css` y `app.js`, sin dependencias ni compilación.
