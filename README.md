# Laboratorio #1 — Central de facturación con días hábiles (POO + n8n)

Solución del **escenario 1** más los **4 retos de la extensión**:

- Un workflow de n8n que cada mañana lee las facturas no pagadas de **JSON Server**, consulta los **feriados de Costa Rica** (Nager.Date) y el **tipo de cambio USD→CRC** (open.er-api.com), calcula la fecha real de vencimiento saltando fines de semana y feriados, marca las facturas **vencidas**, guarda un **historial** y envía un **correo** cuando hay una situación crítica.
- Toda la lógica de negocio está en **clases de JavaScript puro** (`/src`), probadas con `main.js` y con `npm test`. **Esas mismas clases** son las que corren dentro del nodo Code del workflow.

## Estructura

```
├── src/                         ← Clases (POO). Única fuente de las reglas de negocio
│   ├── CalendarioLaboral.js     días hábiles, feriados, sumar días hábiles
│   ├── Factura.js               clase base (abstracta): validar, estaVencida, estaPorVencer, montoEnColones, esCritica, evaluar
│   ├── FacturaCredito.js        hija: vence a N días hábiles (15 por defecto)
│   ├── FacturaContado.js        hija: vence el siguiente día hábil
│   ├── HistorialTendencia.js    ¿la morosidad mejora o empeora?
│   ├── ProcesadorFacturas.js    coordina todo y produce la decisión final
│   └── index.js
├── main.js                      prueba independiente de las clases (sin n8n)
├── tests/clases.test.js         pruebas automáticas (npm test)
├── db.json / db.seed.json       datos de JSON Server (db.seed.json = copia original)
├── data/feriados-cr-2026-respaldo.json   respaldo local de feriados (solo para main.js)
├── n8n/
│   ├── workflow-facturacion.json   ← IMPORTAR ESTE en n8n
│   ├── codigo-nodo-evaluar.js      copia legible del nodo Code principal (generado)
│   └── nodo-evaluar-plantilla.js   parte final del nodo Code (conecta datos ↔ clases)
├── scripts/
│   ├── build-workflow.js        genera el workflow copiando las clases de /src al nodo Code
│   └── reset-db.js              restaura db.json para repetir la demo
└── docs/
    ├── Documento-logica-de-negocio.docx
    ├── guion-presentacion.md
    └── diagrama-flujo.png
```

## Cómo ejecutarlo

Requisitos: Node.js 18 o superior y n8n (en `npx n8n`, instalado o en Docker).

```bash
npm install          # instala json-server
npm test             # 14 pruebas de las clases
npm start            # main.js con la fecha de hoy
node main.js 2026-10-28   # main.js simulando otra fecha
npm run api          # levanta JSON Server en http://localhost:3000 (dejarlo abierto)
```

### Importar el workflow en n8n

1. En n8n: **Workflows → Import from File** → `n8n/workflow-facturacion.json`.
2. Abre el nodo **Configuración** y revisa:
   - `jsonServer`: `http://localhost:3000`. **Si n8n corre en Docker**, cámbialo a `http://host.docker.internal:3000`.
   - `hoy`: por defecto es la fecha actual de Costa Rica. Para la demo puedes escribir una fecha fija, ej. `2026-10-28`.
   - `correoAlertas` y `correoRemitente`: tu correo.
3. En los nodos **Enviar reporte por correo** y **Enviar alerta técnica** crea una credencial **SMTP**. Con Gmail: host `smtp.gmail.com`, puerto `465`, SSL activado, usuario = tu correo, contraseña = una **contraseña de aplicación** (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones).
4. Con JSON Server encendido, presiona **Execute workflow**.

Antes de cada demo: `npm run reset` (el workflow modifica `db.json`).

### Si cambias una regla de negocio

Cámbiala **solo** en `/src`, corre `npm test` y luego `npm run build:n8n` para regenerar el workflow. Vuelve a importarlo en n8n. Así nunca existen dos lógicas distintas.

## Reglas de negocio

| # | Regla | Clase / método |
|---|---|---|
| 1 | Crédito vence a 15 días hábiles (o el plazo propio del cliente, 1-90) | `FacturaCredito.calcularFechaVencimiento()` |
| 2 | Contado vence el siguiente día hábil | `FacturaContado.calcularFechaVencimiento()` |
| 3 | Día hábil = no es sábado, domingo ni feriado de CR | `CalendarioLaboral.esDiaHabil()` |
| 4 | Vencida si hoy pasó la fecha límite; una pagada nunca se toca | `Factura.estaVencida()` |
| 5 | Por vencer si quedan ≤ 3 días hábiles | `Factura.estaPorVencer()` |
| 6 | Datos incompletos → estado `revision` con motivo | `Factura.validar()` |
| 7 | USD → CRC con el tipo de cambio del día; si falla, el último del historial | `Factura.montoEnColones()`, `HistorialTendencia.ultimoTipoCambio()` |
| 8 | Crítica = vencida con monto ≥ ₡1 000 000 | `Factura.esCritica()` |
| 9 | Sin feriados no se calcula nada | constructor de `ProcesadorFacturas` |
| 10 | Tendencia vs. promedio de las últimas 3 ejecuciones | `HistorialTendencia.calcularTendencia()` |

## Manejo de errores

| Situación | Qué pasa |
|---|---|
| API de feriados caída | IF "¿Hay feriados?" → no procesa nada y envía alerta técnica |
| JSON Server apagado | IF "¿JSON Server respondió?" → alerta técnica |
| Factura con datos incompletos / tipo desconocido | pasa a `revision` con el motivo, las demás siguen |
| API de tipo de cambio caída | se usa el último tipo de cambio del historial |
| Historial no disponible | tendencia = `sin_datos`, el proceso continúa |

## Retos de la extensión

- **Reto 1:** `Factura` → `FacturaCredito` / `FacturaContado` (polimorfismo en `calcularFechaVencimiento()` y `describirPlazo()`).
- **Reto 2:** segunda API (tipo de cambio) + nodo **Merge**.
- **Reto 3:** correo de reporte y correo de alerta técnica.
- **Reto 4:** colección `historial` + clase `HistorialTendencia`.
