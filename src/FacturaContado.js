const Factura = require('./Factura');

/**
 * FacturaContado (hija de Factura)
 * --------------------------------
 * Regla propia: una venta de contado debe quedar pagada a más tardar
 * el SIGUIENTE DÍA HÁBIL después de emitida (por ejemplo, si se emitió
 * un viernes, el plazo llega hasta el lunes; si el lunes es feriado, el martes).
 */
class FacturaContado extends Factura {
  static DIAS_PLAZO = 1;

  get tipo() {
    return 'contado';
  }

  /** POLIMORFISMO: contado = el siguiente día hábil. */
  calcularFechaVencimiento(calendario) {
    return calendario.sumarDiasHabiles(this.fechaEmision, FacturaContado.DIAS_PLAZO);
  }

  describirPlazo() {
    return 'Contado: se paga el siguiente día hábil';
  }
}

module.exports = FacturaContado;
