// =====================================================================
// Parte final del nodo Code "Evaluar facturas (POO)".
// Arriba de este bloque, scripts/build-workflow.js pega las clases de /src
// (CalendarioLaboral, HistorialTendencia, Factura, FacturaCredito,
// FacturaContado, ProcesadorFacturas) SIN cambios. Aquí solo se conectan
// los datos que vienen de los nodos anteriores con esas clases.
// =====================================================================

const config = $('Configuración').first().json;
const fuentes = $('Combinar fuentes externas').first().json;
const respuestaFacturas = $('GET facturas no pagadas').first().json;
const respuestaHistorial = $input.first().json;

// Si el historial no responde, se continúa sin él (la tendencia queda "sin_datos").
const historial = respuestaHistorial.statusCode === 200 && Array.isArray(respuestaHistorial.body)
  ? respuestaHistorial.body
  : [];

const procesador = new ProcesadorFacturas({
  feriados: fuentes.feriados,
  tipoCambio: fuentes.tipoCambio,
  hoy: config.hoy,
  umbralDiasRiesgo: config.umbralDiasRiesgo,
  montoCriticoCRC: config.montoCriticoCRC,
});

const resultado = procesador.procesar(respuestaFacturas.body, historial);

return [{ json: resultado }];
