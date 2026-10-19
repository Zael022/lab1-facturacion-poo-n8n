const CalendarioLaboral = require('./CalendarioLaboral');

/**
 * Factura (clase base)
 * --------------------
 * Responsabilidad: guardar los datos de una factura y aplicar las reglas
 * que son IGUALES para cualquier tipo de factura (validar datos, saber si
 * está vencida, convertir el monto a colones, decidir si es crítica).
 *
 * Lo que CAMBIA según el tipo de factura es el plazo de pago. Por eso
 * `calcularFechaVencimiento()` está aquí vacío y cada clase hija
 * (FacturaCredito, FacturaContado) lo sobreescribe a su manera.
 *
 * Analogía: Factura es como el "molde general" de un formulario de cobro.
 * Todas las copias tienen los mismos campos, pero cada departamento
 * (crédito o contado) llena distinto la casilla de "fecha límite".
 */
class Factura {
  static ESTADOS = ['pendiente', 'vencida', 'pagada', 'revision'];
  static MONEDAS = ['CRC', 'USD'];

  constructor(datos = {}) {
    if (new.target === Factura) {
      throw new Error('Factura es una clase base: crea una FacturaCredito o una FacturaContado');
    }
    this.id = datos.id;
    this.cliente = datos.cliente;
    this.correoCliente = datos.correoCliente || null;
    this.monto = datos.monto;
    this.moneda = datos.moneda || 'CRC';
    this.fechaEmision = datos.fechaEmision;
    this.estado = datos.estado || 'pendiente';
  }

  /** Cada clase hija dice qué tipo es ('credito' o 'contado'). */
  get tipo() {
    throw new Error('Cada clase hija debe definir su tipo');
  }

  /** POLIMORFISMO: cada clase hija calcula su vencimiento de forma distinta. */
  calcularFechaVencimiento(calendario) { // eslint-disable-line no-unused-vars
    throw new Error('Cada clase hija debe implementar calcularFechaVencimiento()');
  }

  /** POLIMORFISMO: cada clase hija describe su plazo con sus propias palabras. */
  describirPlazo() {
    throw new Error('Cada clase hija debe implementar describirPlazo()');
  }

  /**
   * REGLA: una factura con datos incompletos o imposibles no se procesa,
   * se manda a "revision" con el motivo. Devuelve la lista de problemas
   * (vacía si todo está bien).
   */
  validar(hoy) {
    const errores = [];
    if (this.id === undefined || this.id === null || this.id === '') {
      errores.push('No tiene identificador');
    }
    if (typeof this.cliente !== 'string' || this.cliente.trim() === '') {
      errores.push('No tiene cliente');
    }
    if (typeof this.monto !== 'number' || !Number.isFinite(this.monto) || this.monto <= 0) {
      errores.push(`Monto inválido (${this.monto})`);
    }
    if (!Factura.MONEDAS.includes(this.moneda)) {
      errores.push(`Moneda no soportada (${this.moneda})`);
    }
    if (!CalendarioLaboral.esFechaValida(this.fechaEmision)) {
      errores.push(`Fecha de emisión inválida o faltante (${this.fechaEmision})`);
    } else if (hoy && this.fechaEmision > hoy) {
      errores.push(`Fecha de emisión en el futuro (${this.fechaEmision})`);
    }
    if (!Factura.ESTADOS.includes(this.estado)) {
      errores.push(`Estado desconocido (${this.estado})`);
    }
    return errores;
  }

  /**
   * Días hábiles que faltan para el vencimiento.
   * Positivo = todavía hay tiempo; 0 = vence hoy; negativo = ya se pasó.
   */
  diasHabilesRestantes(hoy, calendario) {
    return calendario.diasHabilesEntre(hoy, this.calcularFechaVencimiento(calendario));
  }

  /** REGLA: vencida si hoy ya pasó la fecha límite y no está pagada. */
  estaVencida(hoy, calendario) {
    if (this.estado === 'pagada') return false;
    return hoy > this.calcularFechaVencimiento(calendario);
  }

  /** REGLA: "por vencer" si le quedan pocos días hábiles (alerta preventiva). */
  estaPorVencer(hoy, calendario, umbralDias = 3) {
    if (this.estado === 'pagada' || this.estaVencida(hoy, calendario)) return false;
    return this.diasHabilesRestantes(hoy, calendario) <= umbralDias;
  }

  /**
   * REGLA: los montos en dólares se convierten a colones con el tipo de cambio del día.
   * Si no hay tipo de cambio disponible, devuelve null (no se inventa un número).
   */
  montoEnColones(tipoCambio) {
    if (this.moneda === 'CRC') return this.monto;
    if (typeof tipoCambio !== 'number' || !(tipoCambio > 0)) return null;
    return Math.round(this.monto * tipoCambio * 100) / 100;
  }

  /** REGLA: una factura vencida por encima del monto crítico requiere aviso inmediato. */
  esCritica(hoy, calendario, tipoCambio, montoCriticoCRC) {
    const montoCRC = this.montoEnColones(tipoCambio);
    return this.estaVencida(hoy, calendario) && montoCRC !== null && montoCRC >= montoCriticoCRC;
  }

  /**
   * Junta todas las reglas en una sola "decisión" para esta factura.
   * Nota: este método vive en la clase base, pero llama a
   * calcularFechaVencimiento(), que es distinto en cada hija (polimorfismo).
   */
  evaluar(hoy, calendario, { tipoCambio = null, umbralDiasRiesgo = 3, montoCriticoCRC = 1000000 } = {}) {
    const fechaVencimiento = this.calcularFechaVencimiento(calendario);
    const vencida = this.estaVencida(hoy, calendario);
    const porVencer = this.estaPorVencer(hoy, calendario, umbralDiasRiesgo);
    let alerta = null;
    if (vencida) alerta = 'vencida';
    else if (porVencer) alerta = 'por_vencer';

    return {
      id: this.id,
      cliente: this.cliente,
      tipo: this.tipo,
      plazo: this.describirPlazo(),
      estadoAnterior: this.estado,
      estadoNuevo: vencida ? 'vencida' : 'pendiente',
      fechaVencimiento,
      diasHabilesRestantes: this.diasHabilesRestantes(hoy, calendario),
      montoCRC: this.montoEnColones(tipoCambio),
      alerta,
      critica: this.esCritica(hoy, calendario, tipoCambio, montoCriticoCRC),
    };
  }
}

module.exports = Factura;
