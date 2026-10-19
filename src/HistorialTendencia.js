/**
 * HistorialTendencia
 * ------------------
 * Responsabilidad: mirar las ejecuciones anteriores del workflow
 * (guardadas en la colección "historial" de JSON Server) y decidir si
 * la morosidad va MEJORANDO, EMPEORANDO o se mantiene ESTABLE.
 *
 * Analogía: es como comparar tus notas de los últimos parciales.
 * No basta con ver la nota de hoy; importa si vienes subiendo o bajando.
 *
 * Regla: se compara la tasa de morosidad de hoy contra el PROMEDIO de las
 * últimas ejecuciones. Una diferencia menor al margen se considera "estable"
 * (para no alarmar por cambios mínimos).
 */
class HistorialTendencia {
  static MARGEN_PUNTOS = 2;       // diferencia mínima (en puntos %) para hablar de cambio
  static EJECUCIONES_A_COMPARAR = 3;

  constructor(registros = []) {
    const lista = Array.isArray(registros) ? registros : [];
    // Solo se usan registros con una tasa numérica; se ordenan del más reciente al más antiguo.
    this.registros = lista
      .filter((r) => r && typeof r.tasaMorosidad === 'number' && Number.isFinite(r.tasaMorosidad))
      .sort((a, b) => String(b.ejecutadoEn || b.fecha).localeCompare(String(a.ejecutadoEn || a.fecha)));
  }

  cantidad() {
    return this.registros.length;
  }

  /** Último tipo de cambio válido guardado (respaldo si la API de tipo de cambio falla). */
  ultimoTipoCambio() {
    const registro = this.registros.find((r) => typeof r.tipoCambio === 'number' && r.tipoCambio > 0);
    return registro ? registro.tipoCambio : null;
  }

  promedioReciente() {
    const recientes = this.registros.slice(0, HistorialTendencia.EJECUCIONES_A_COMPARAR);
    if (recientes.length === 0) return null;
    const suma = recientes.reduce((total, r) => total + r.tasaMorosidad, 0);
    return Math.round((suma / recientes.length) * 100) / 100;
  }

  /**
   * @param {number} tasaActual tasa de morosidad (%) de la ejecución actual
   * @returns {{tendencia: string, promedioAnterior: number|null, diferencia: number|null, mensaje: string}}
   */
  calcularTendencia(tasaActual) {
    const promedio = this.promedioReciente();
    if (promedio === null) {
      return {
        tendencia: 'sin_datos',
        promedioAnterior: null,
        diferencia: null,
        mensaje: 'Es la primera ejecución registrada; todavía no hay con qué comparar.',
      };
    }
    const diferencia = Math.round((tasaActual - promedio) * 100) / 100;
    let tendencia = 'estable';
    if (diferencia >= HistorialTendencia.MARGEN_PUNTOS) tendencia = 'empeorando';
    else if (diferencia <= -HistorialTendencia.MARGEN_PUNTOS) tendencia = 'mejorando';

    const textos = {
      empeorando: `La morosidad subió ${diferencia} puntos respecto al promedio reciente (${promedio}%).`,
      mejorando: `La morosidad bajó ${Math.abs(diferencia)} puntos respecto al promedio reciente (${promedio}%).`,
      estable: `La morosidad se mantiene cerca del promedio reciente (${promedio}%).`,
    };
    return { tendencia, promedioAnterior: promedio, diferencia, mensaje: textos[tendencia] };
  }
}

module.exports = HistorialTendencia;
