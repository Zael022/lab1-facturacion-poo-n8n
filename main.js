/**
 * main.js — Prueba independiente de las clases (sin n8n).
 *
 * Uso:
 *   node main.js               -> usa la fecha de hoy (hora de Costa Rica)
 *   node main.js 2026-10-28    -> simula que "hoy" es esa fecha
 *
 * Intenta usar datos REALES:
 *   - Facturas e historial desde JSON Server (http://localhost:3000). Si no está
 *     encendido, los lee directamente de db.json.
 *   - Feriados desde la API Nager.Date. Si no responde, usa el respaldo local.
 *   - Tipo de cambio desde open.er-api.com. Si no responde, usa el del historial.
 * Cada respaldo se avisa en consola: así también se ven los casos de error.
 */
const fs = require('fs');
const path = require('path');
const {
  CalendarioLaboral, FacturaCredito, FacturaContado, HistorialTendencia, ProcesadorFacturas,
} = require('./src');

const JSON_SERVER = process.env.JSON_SERVER_URL || 'http://localhost:3000';
const TIEMPO_ESPERA_MS = 5000;

function hoyEnCostaRica() {
  // 'en-CA' formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());
}

async function pedirJSON(url) {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_ESPERA_MS) });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  return respuesta.json();
}

async function obtenerDatosJSONServer() {
  try {
    const facturas = await pedirJSON(`${JSON_SERVER}/facturas?estado_ne=pagada`);
    const historial = await pedirJSON(`${JSON_SERVER}/historial?_sort=ejecutadoEn&_order=desc&_limit=5`);
    return { facturas, historial, fuente: `JSON Server (${JSON_SERVER})` };
  } catch (error) {
    console.warn(`⚠ JSON Server no respondió (${error.message}). Leyendo db.json directamente.`);
    const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
    return {
      facturas: db.facturas.filter((f) => f.estado !== 'pagada'),
      historial: db.historial,
      fuente: 'archivo db.json (respaldo)',
    };
  }
}

async function obtenerFeriados(anio) {
  try {
    const feriados = await pedirJSON(`https://date.nager.at/api/v3/PublicHolidays/${anio}/CR`);
    if (!Array.isArray(feriados) || feriados.length === 0) throw new Error('respuesta vacía');
    return { feriados, fuente: 'API Nager.Date' };
  } catch (error) {
    console.warn(`⚠ La API de feriados no respondió (${error.message}). Usando respaldo local.`);
    const archivo = path.join(__dirname, 'data', `feriados-cr-${anio}-respaldo.json`);
    if (!fs.existsSync(archivo)) return { feriados: [], fuente: 'ninguna' };
    return { feriados: JSON.parse(fs.readFileSync(archivo, 'utf8')), fuente: 'respaldo local (data/)' };
  }
}

async function obtenerTipoCambio() {
  try {
    const datos = await pedirJSON('https://open.er-api.com/v6/latest/USD');
    if (datos.result !== 'success' || !(datos.rates && datos.rates.CRC > 0)) throw new Error('respuesta inesperada');
    return datos.rates.CRC;
  } catch (error) {
    console.warn(`⚠ La API de tipo de cambio no respondió (${error.message}). Se usará el último del historial.`);
    return null;
  }
}

function titulo(texto) {
  console.log(`\n${'='.repeat(70)}\n${texto}\n${'='.repeat(70)}`);
}

async function main() {
  const hoy = process.argv[2] || hoyEnCostaRica();
  if (!CalendarioLaboral.esFechaValida(hoy)) {
    console.error(`Fecha inválida: ${hoy}. Usa el formato AAAA-MM-DD.`);
    process.exit(1);
  }

  titulo(`CENTRAL DE FACTURACIÓN CON DÍAS HÁBILES — hoy: ${hoy}`);
  const [datos, feriadosInfo, tipoCambio] = await Promise.all([
    obtenerDatosJSONServer(),
    obtenerFeriados(hoy.slice(0, 4)),
    obtenerTipoCambio(),
  ]);
  console.log(`Facturas:     ${datos.facturas.length} no pagadas, desde ${datos.fuente}`);
  console.log(`Feriados:     ${feriadosInfo.feriados.length}, desde ${feriadosInfo.fuente}`);
  console.log(`Tipo cambio:  ${tipoCambio ?? 'no disponible (se usará el historial)'}`);

  // ---------------------------------------------------------------
  titulo('1. CalendarioLaboral — reglas de días hábiles');
  const calendario = new CalendarioLaboral(feriadosInfo.feriados);
  for (const fecha of ['2026-09-15', '2026-09-19', '2026-09-16']) {
    const motivo = calendario.esFeriado(fecha)
      ? `feriado: ${calendario.nombreFeriado(fecha)}`
      : (calendario.esFinDeSemana(fecha) ? 'fin de semana' : 'día normal');
    console.log(`${fecha} ¿es hábil? ${calendario.esDiaHabil(fecha) ? 'Sí' : 'No'} (${motivo})`);
  }
  const sinFeriados = new CalendarioLaboral(['1900-01-01']); // calendario que solo salta fines de semana
  console.log(`15 días hábiles desde 2026-09-08 SIN contar feriados: ${sinFeriados.sumarDiasHabiles('2026-09-08', 15)}`);
  console.log(`15 días hábiles desde 2026-09-08 CON feriados:       ${calendario.sumarDiasHabiles('2026-09-08', 15)}  <- se corre un día por el 15 de setiembre`);

  // ---------------------------------------------------------------
  titulo('2. Herencia y polimorfismo — el mismo método, distinto resultado');
  const credito = new FacturaCredito({ id: 'DEMO-1', cliente: 'Cliente crédito', monto: 100000, fechaEmision: '2026-10-16' });
  const contado = new FacturaContado({ id: 'DEMO-2', cliente: 'Cliente contado', monto: 100000, fechaEmision: '2026-10-16' });
  for (const factura of [credito, contado]) {
    console.log(`${factura.constructor.name.padEnd(15)} emitida 2026-10-16 -> calcularFechaVencimiento(): ${factura.calcularFechaVencimiento(calendario)}  (${factura.describirPlazo()})`);
  }

  // ---------------------------------------------------------------
  titulo('3. Cada factura real evaluada con sus métodos');
  const tipoCambioUsado = tipoCambio ?? new HistorialTendencia(datos.historial).ultimoTipoCambio();
  for (const fila of datos.facturas) {
    const factura = ProcesadorFacturas.crearFactura(fila);
    if (!factura) {
      console.log(`${String(fila.id).padEnd(6)} ✗ tipo desconocido "${fila.tipo}" -> va a revisión`);
      continue;
    }
    const errores = factura.validar(hoy);
    if (errores.length > 0) {
      console.log(`${String(fila.id).padEnd(6)} ✗ datos inválidos -> va a revisión: ${errores.join('; ')}`);
      continue;
    }
    const vence = factura.calcularFechaVencimiento(calendario);
    const restantes = factura.diasHabilesRestantes(hoy, calendario);
    let estado = 'al día';
    if (factura.estaVencida(hoy, calendario)) estado = 'VENCIDA';
    else if (factura.estaPorVencer(hoy, calendario)) estado = 'por vencer';
    const montoCRC = factura.montoEnColones(tipoCambioUsado);
    const montoTexto = montoCRC === null ? 'sin tipo de cambio' : `₡${montoCRC.toLocaleString('es-CR')}`;
    console.log(
      `${factura.id.padEnd(6)} ${factura.tipo.padEnd(8)} ${factura.cliente.padEnd(24)} vence ${vence}  `
      + `días hábiles: ${String(restantes).padStart(4)}  ${estado.padEnd(10)} ${montoTexto}`,
    );
  }

  // ---------------------------------------------------------------
  titulo('4. ProcesadorFacturas — exactamente lo que hace el nodo Code de n8n');
  let resultado;
  try {
    const procesador = new ProcesadorFacturas({ feriados: feriadosInfo.feriados, tipoCambio, hoy });
    resultado = procesador.procesar(datos.facturas, datos.historial);
  } catch (error) {
    console.error(`✗ No se procesó nada: ${error.message}`);
    process.exit(1);
  }
  console.log('Resumen (lo que se guarda en "historial"):');
  console.log(resultado.resumen);
  console.log(`\nTendencia: ${resultado.tendencia.tendencia} — ${resultado.tendencia.mensaje}`);
  console.log(`Actualizaciones que se enviarían a JSON Server: ${resultado.actualizaciones.length}`);
  console.log(`¿Se envía correo de alerta? ${resultado.hayAlerta ? 'Sí' : 'No'}`);
  console.log(`\nAsunto: ${resultado.correo.asunto}\n${'-'.repeat(70)}\n${resultado.correo.cuerpo}`);

  // ---------------------------------------------------------------
  titulo('5. Caso de error: ¿qué pasa si no llegan los feriados?');
  try {
    new ProcesadorFacturas({ feriados: [], tipoCambio, hoy });
  } catch (error) {
    console.log(`✓ Error controlado: ${error.message}`);
  }
}

main();
