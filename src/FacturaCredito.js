const Factura = require('./Factura');

/**
 * FacturaCredito (hija de Factura)
 * --------------------------------
 * Regla propia: el cliente tiene un plazo de crédito en DÍAS HÁBILES
 * (15 por defecto) contados desde la fecha de emisión.
 * Algunos clientes pueden tener otro plazo (campo `diasCredito`), entre 1 y 90.
 */
class FacturaCredito extends Factura {
  static DIAS_CREDITO_POR_DEFECTO = 15;
  static DIAS_CREDITO_MAXIMO = 90;

  constructor(datos = {}) {
    super(datos);
    this.diasCredito = datos.diasCredito === undefined || datos.diasCredito === null
      ? FacturaCredito.DIAS_CREDITO_POR_DEFECTO
      : datos.diasCredito;
  }

  get tipo() {
    return 'credito';
  }

  /** Sobreescribe la validación: además de lo común, revisa el plazo de crédito. */
  validar(hoy) {
    const errores = super.validar(hoy);
    if (!Number.isInteger(this.diasCredito) || this.diasCredito < 1 || this.diasCredito > FacturaCredito.DIAS_CREDITO_MAXIMO) {
      errores.push(`Plazo de crédito inválido (${this.diasCredito}); debe ser entre 1 y ${FacturaCredito.DIAS_CREDITO_MAXIMO} días hábiles`);
    }
    return errores;
  }

  /** POLIMORFISMO: crédito = N días hábiles después de emitida. */
  calcularFechaVencimiento(calendario) {
    return calendario.sumarDiasHabiles(this.fechaEmision, this.diasCredito);
  }

  describirPlazo() {
    return `Crédito a ${this.diasCredito} días hábiles`;
  }
}

module.exports = FacturaCredito;
