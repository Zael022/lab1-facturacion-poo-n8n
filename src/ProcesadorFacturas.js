const CalendarioLaboral = require('./CalendarioLaboral');
const FacturaCredito = require('./FacturaCredito');
const FacturaContado = require('./FacturaContado');
const HistorialTendencia = require('./HistorialTendencia');

/**
 * ProcesadorFacturas
 * ------------------
 * Responsabilidad: coordinar a las demás clases. Recibe los datos "crudos"
 * (facturas de JSON Server, feriados de Nager.Date, tipo de cambio e historial),
 * crea los objetos correctos y produce UNA decisión para el workflow:
 *   - qué cambios hay que guardar en cada factura,
 *   - el resumen de la ejecución (para el historial),
 *   - la tendencia,
 *   - y el correo de alerta si hay una situación crítica.
 *
 * Esta es la MISMA clase que corre dentro del nodo Code de n8n
 * ("Evaluar facturas (POO)"). El script scripts/build-workflow.js copia
 * estas clases al nodo, así nunca existen dos lógicas distintas.
 *
 * Analogía: es el "jefe de cobros". No calcula fechas él mismo; le pide a cada
 * factura que se evalúe y al calendario que cuente días, y luego arma el informe.
 */
class ProcesadorFacturas {
  constructor({
    feriados,
    tipoCambio = null,
    hoy,
    umbralDiasRiesgo = 3,
    montoCriticoCRC = 1000000,
    ejecutadoEn = new Date().toISOString(),
  } = {}) {
    if (!CalendarioLaboral.esFechaValida(hoy)) {
      throw new Error(`La fecha de hoy es inválida: ${hoy}`);
    }
    // REGLA DE SEGURIDAD: sin feriados no se calcula nada. Calcular "a ciegas"
    // podría marcar como vencida una factura que todavía está en plazo.
    const calendario = new CalendarioLaboral(feriados);
    if (calendario.cantidadFeriados() === 0) {
      throw new Error('No se recibieron feriados válidos; no es seguro calcular vencimientos.');
    }
    this.calendario = calendario;
    this.tipoCambio = typeof tipoCambio === 'number' && tipoCambio > 0 ? tipoCambio : null;
    this.hoy = hoy;
    this.umbralDiasRiesgo = umbralDiasRiesgo;
    this.montoCriticoCRC = montoCriticoCRC;
    this.ejecutadoEn = ejecutadoEn;
  }

  /** Fábrica: según el campo "tipo" crea la clase hija correcta (o null si no existe). */
  static crearFactura(datos) {
    if (!datos || typeof datos !== 'object') return null;
    if (datos.tipo === 'credito') return new FacturaCredito(datos);
    if (datos.tipo === 'contado') return new FacturaContado(datos);
    return null;
  }

  /**
   * @param {Array<object>} facturasJSON facturas no pagadas (JSON Server)
   * @param {Array<object>} historialJSON últimas ejecuciones guardadas (JSON Server)
   */
  procesar(facturasJSON = [], historialJSON = []) {
    const historial = new HistorialTendencia(historialJSON);

    // REGLA: si la API de tipo de cambio falló, se usa el último tipo de cambio del historial.
    let tipoCambio = this.tipoCambio;
    let fuenteTipoCambio = 'API open.er-api.com';
    if (tipoCambio === null) {
      tipoCambio = historial.ultimoTipoCambio();
      fuenteTipoCambio = tipoCambio !== null ? 'último valor del historial (API no disponible)' : 'no disponible';
    }

    const opciones = { tipoCambio, umbralDiasRiesgo: this.umbralDiasRiesgo, montoCriticoCRC: this.montoCriticoCRC };
    const actualizaciones = [];
    const evaluadas = [];
    const enRevision = [];

    for (const datos of Array.isArray(facturasJSON) ? facturasJSON : []) {
      const id = datos && datos.id !== undefined ? datos.id : null;
      const estadoAnterior = (datos && datos.estado) || 'pendiente';
      if (estadoAnterior === 'pagada') continue; // REGLA: una factura pagada nunca se toca.

      const factura = ProcesadorFacturas.crearFactura(datos);
      const errores = factura
        ? factura.validar(this.hoy)
        : [`Tipo de factura desconocido (${datos && datos.tipo})`];

      if (errores.length > 0) {
        enRevision.push({ id, cliente: (datos && datos.cliente) || '(sin cliente)', estadoAnterior, motivo: errores.join('; ') });
        if (id !== null) {
          actualizaciones.push({
            id,
            cambios: { estado: 'revision', motivoRevision: errores.join('; '), alerta: 'datos_incompletos', ultimaRevision: this.hoy },
          });
        }
        continue;
      }

      const decision = factura.evaluar(this.hoy, this.calendario, opciones);
      evaluadas.push(decision);
      actualizaciones.push({
        id: decision.id,
        cambios: {
          estado: decision.estadoNuevo,
          fechaVencimiento: decision.fechaVencimiento,
          diasHabilesRestantes: decision.diasHabilesRestantes,
          montoCRC: decision.montoCRC,
          alerta: decision.alerta,
          motivoRevision: null,
          ultimaRevision: this.hoy,
        },
      });
    }

    const vencidas = evaluadas.filter((d) => d.estadoNuevo === 'vencida');
    const vencidasNuevas = vencidas.filter((d) => d.estadoAnterior !== 'vencida');
    const porVencer = evaluadas.filter((d) => d.alerta === 'por_vencer');
    const criticas = evaluadas.filter((d) => d.critica);
    const revisionNuevas = enRevision.filter((r) => r.estadoAnterior !== 'revision');

    const tasaMorosidad = evaluadas.length === 0
      ? 0
      : Math.round((vencidas.length / evaluadas.length) * 10000) / 100;
    const montoVencidoCRC = Math.round(
      vencidas.reduce((total, d) => total + (d.montoCRC || 0), 0) * 100,
    ) / 100;
    const vencidasSinConvertir = vencidas.filter((d) => d.montoCRC === null).length;

    const tendencia = historial.calcularTendencia(tasaMorosidad);

    const resumen = {
      fecha: this.hoy,
      ejecutadoEn: this.ejecutadoEn,
      totalRecibidas: evaluadas.length + enRevision.length,
      totalEvaluadas: evaluadas.length,
      vencidas: vencidas.length,
      vencidasNuevas: vencidasNuevas.length,
      porVencer: porVencer.length,
      enRevision: enRevision.length,
      criticas: criticas.length,
      tasaMorosidad,
      montoVencidoCRC,
      vencidasSinConvertir,
      tipoCambio,
      fuenteTipoCambio,
      tendencia: tendencia.tendencia,
    };

    // REGLA: se avisa por correo si aparecen vencidas nuevas, datos malos nuevos o la morosidad empeora.
    const hayAlerta = vencidasNuevas.length > 0 || revisionNuevas.length > 0 || tendencia.tendencia === 'empeorando';

    return {
      resumen,
      tendencia,
      actualizaciones,
      detalle: { vencidas, porVencer, criticas, enRevision },
      hayAlerta,
      correo: this.redactarCorreo(resumen, tendencia, { vencidasNuevas, criticas, porVencer, enRevision }),
      registroHistorial: resumen,
    };
  }

  redactarCorreo(resumen, tendencia, { vencidasNuevas, criticas, porVencer, enRevision }) {
    const colones = (n) => (n === null ? 'sin convertir' : `₡${Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const lineas = [];
    lineas.push(`Reporte de facturación — ${resumen.fecha}`);
    lineas.push('');
    lineas.push(`Facturas evaluadas: ${resumen.totalEvaluadas}`);
    lineas.push(`Vencidas: ${resumen.vencidas} (nuevas hoy: ${resumen.vencidasNuevas})`);
    lineas.push(`Por vencer (≤ ${this.umbralDiasRiesgo} días hábiles): ${resumen.porVencer}`);
    lineas.push(`En revisión por datos incompletos: ${resumen.enRevision}`);
    lineas.push(`Monto vencido: ${colones(resumen.montoVencidoCRC)}`);
    lineas.push(`Tipo de cambio usado: ${resumen.tipoCambio ?? 'no disponible'} (${resumen.fuenteTipoCambio})`);
    lineas.push(`Tasa de morosidad: ${resumen.tasaMorosidad}% — tendencia: ${tendencia.tendencia.toUpperCase()}`);
    lineas.push(tendencia.mensaje);

    if (criticas.length > 0) {
      lineas.push('', `⚠ FACTURAS CRÍTICAS (vencidas ≥ ${colones(this.montoCriticoCRC)}):`);
      criticas.forEach((d) => lineas.push(`  - ${d.id} | ${d.cliente} | ${colones(d.montoCRC)} | venció ${d.fechaVencimiento}`));
    }
    if (vencidasNuevas.length > 0) {
      lineas.push('', 'Vencidas nuevas:');
      vencidasNuevas.forEach((d) => lineas.push(`  - ${d.id} | ${d.cliente} | ${d.plazo} | venció ${d.fechaVencimiento}`));
    }
    if (porVencer.length > 0) {
      lineas.push('', 'Por vencer pronto:');
      porVencer.forEach((d) => lineas.push(`  - ${d.id} | ${d.cliente} | vence ${d.fechaVencimiento} (${d.diasHabilesRestantes} días hábiles)`));
    }
    if (enRevision.length > 0) {
      lineas.push('', 'Requieren revisión manual:');
      enRevision.forEach((r) => lineas.push(`  - ${r.id ?? '(sin id)'} | ${r.cliente} | ${r.motivo}`));
    }

    const asunto = criticas.length > 0
      ? `⚠ ${criticas.length} factura(s) crítica(s) vencida(s) — ${resumen.fecha}`
      : `Reporte de facturación ${resumen.fecha}: ${resumen.vencidasNuevas} vencida(s) nueva(s), tendencia ${tendencia.tendencia}`;

    return { asunto, cuerpo: lineas.join('\n') };
  }
}

module.exports = ProcesadorFacturas;
