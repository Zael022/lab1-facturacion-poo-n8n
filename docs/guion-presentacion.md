# Guion para la presentación en vivo (≈ 10 minutos)

## Antes de empezar (preparación)

1. `npm run reset` para dejar los datos originales.
2. Terminal 1: `npm run api` (JSON Server encendido).
3. n8n abierto con el workflow importado y el correo configurado.
4. En el nodo **Configuración**, pon `hoy` = `2026-10-28` (o la fecha de la presentación) para que el resultado sea predecible.
5. Ten abierto `http://localhost:3000/facturas` en el navegador.

---

## 1. El problema (1 min)

> "Una empresa da crédito a 15 días **hábiles**. Contar eso a mano es fácil de equivocarse: hay que saltar fines de semana y feriados como el 15 de setiembre. Un día mal contado significa cobrarle mora a alguien que estaba al día. Mi solución lo calcula sola todas las mañanas, marca las vencidas y avisa por correo."

## 2. Las clases (3 min) — mostrar `/src` y correr `node main.js 2026-10-28`

- **CalendarioLaboral**: sabe qué días son hábiles. En la salida, la sección 1 muestra que 15 días hábiles desde el 8 de setiembre dan el 29 sin feriados y el **30 con feriados**: el 15 de setiembre corre el plazo un día.
- **Factura** (base) → **FacturaCredito** / **FacturaContado** (hijas). En la sección 2, el **mismo método** `calcularFechaVencimiento()` da 6 de noviembre en crédito y 19 de octubre en contado. Eso es polimorfismo.
- **HistorialTendencia**: compara con ejecuciones anteriores.
- **ProcesadorFacturas**: el "jefe de cobros", que coordina a las demás clases.
- Opcional: `npm test` → 14 pruebas en verde.

## 3. Cómo la misma lógica vive en n8n (1 min)

- Abrir el nodo **Evaluar facturas (POO)**: arriba están las mismas clases, y al final solo `new ProcesadorFacturas(...).procesar(...)`.
- Explicar `npm run build:n8n`: copia las clases de `/src` al nodo, así nunca hay dos lógicas distintas.

## 4. Workflow funcionando de principio a fin (3 min)

1. **Execute workflow**.
2. Recorrer nodos: feriados y tipo de cambio → **Merge** → IF → GET facturas → GET historial → **Evaluar** → PATCH / POST → IF crítico → correo.
3. Refrescar `localhost:3000/facturas`: F-001, F-002, F-003 y F-012 ahora están `vencida`, con su `fechaVencimiento`; F-008, F-009 y F-010 quedaron en `revision` con su motivo.
4. `localhost:3000/historial`: apareció el registro nuevo con tendencia `empeorando`.
5. Mostrar el correo recibido.

## 5. Caso de error en vivo (1 min) — elegir uno

- **JSON Server caído**: detener `npm run api` (Ctrl+C) y ejecutar. Se toma la rama "no" de "¿JSON Server respondió?" y llega el correo de alerta técnica.
- **API de feriados caída**: en el nodo "API Feriados" cambiar la URL a `https://date.nager.at/api/v3/PublicHolidays/2026/XX` (país inexistente). El workflow **no procesa nada** y explica por qué.
- **Dato incompleto**: ya se vio con F-008, F-009 y F-010.

## 6. Conclusiones (1 min)

> "Lo más difícil fue que n8n trabaja con *items* (datos sueltos) y la POO con objetos que tienen comportamiento. Lo resolví separando responsabilidades: n8n trae y guarda datos; las clases toman todas las decisiones. El otro reto fue que el mismo código corriera igual en Node y dentro del nodo Code, sin copiar a mano."

---

## Preguntas probables y cómo responderlas

- **¿Por qué `Factura` no se puede instanciar?** Porque no tiene sentido una factura sin tipo de plazo. El constructor revisa `new.target` y obliga a crear una hija.
- **¿Dónde está el polimorfismo?** `evaluar()` está en la clase base y llama a `calcularFechaVencimiento()` sin saber el tipo. Cada hija responde distinto.
- **¿Por qué fechas como texto y UTC?** Con un `Date` local, Costa Rica (UTC-6) puede correr la fecha un día hacia atrás. En formato `AAAA-MM-DD` además se pueden comparar con `<` y `>`.
- **¿Por qué no se procesa sin feriados?** Es preferible no hacer nada a marcar mal una factura como vencida. La regla existe en el IF y también en el constructor de `ProcesadorFacturas`.
- **¿Por qué "respuesta completa" en los HTTP Request?** Así recibo el código de estado y el workflow no se cae ante un error. El IF decide qué hacer.
- **¿Por qué `estado_ne=pagada` y no solo `pendiente`?** Para volver a evaluar las vencidas y las que están en revisión. Si alguien corrige un dato malo, la factura se reevalúa sola.
- **¿Qué pasa en diciembre con facturas que vencen en enero?** Es una limitación conocida: solo se piden los feriados del año actual. La mejora sería pedir también los del año siguiente.
