// ⚠ CÓDIGO GENERADO por scripts/build-workflow.js a partir de /src.
// Si cambias una regla de negocio, cámbiala en /src y vuelve a ejecutar: npm run build:n8n

// ===== Clase CalendarioLaboral (src/CalendarioLaboral.js) =====
/**
 * CalendarioLaboral
 * -----------------
 * Responsabilidad: saber qué días son hábiles en Costa Rica.
 * Un día hábil NO es sábado, NO es domingo y NO es feriado.
 *
 * Analogía: es como el "calendario de pared" de la oficina de cobros,
 * donde alguien marcó en rojo los feriados. Las facturas le preguntan
 * a este calendario "¿cuál es el día hábil número 15 a partir de aquí?".
 *
 * Decisión técnica: todas las fechas se manejan como texto 'YYYY-MM-DD'
 * y los cálculos se hacen en UTC. Así evitamos que la zona horaria
 * (Costa Rica es UTC-6) "corra" una fecha un día hacia atrás.
 */
class CalendarioLaboral {
  /**
   * @param {Array<string|{date:string, localName?:string, name?:string}>} feriados
   *   Acepta fechas sueltas ('2026-09-15') o el formato de la API Nager.Date
   *   ({ date: '2026-09-15', localName: 'Día de la Independencia' }).
   */
  constructor(feriados = []) {
    this.feriados = new Map();
    const lista = Array.isArray(feriados) ? feriados : [];
    for (const feriado of lista) {
      const fecha = typeof feriado === 'string' ? feriado : feriado && feriado.date;
      if (CalendarioLaboral.esFechaValida(fecha)) {
        const nombre = typeof feriado === 'string'
          ? 'Feriado'
          : (feriado.localName || feriado.name || 'Feriado');
        this.feriados.set(fecha, nombre);
      }
    }
  }

  // ---------- Utilidades de fechas (métodos estáticos) ----------

  /** ¿El texto es una fecha real con formato YYYY-MM-DD? (rechaza '2026-02-30') */
  static esFechaValida(texto) {
    if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const fecha = CalendarioLaboral.aFecha(texto);
    return CalendarioLaboral.aTexto(fecha) === texto;
  }

  /** '2026-09-15' -> objeto Date en UTC */
  static aFecha(texto) {
    const [anio, mes, dia] = texto.split('-').map(Number);
    return new Date(Date.UTC(anio, mes - 1, dia));
  }

  /** objeto Date -> '2026-09-15' */
  static aTexto(fecha) {
    return fecha.toISOString().slice(0, 10);
  }

  /** Suma días de calendario (incluye fines de semana y feriados). */
  static sumarDias(texto, cantidad) {
    const fecha = CalendarioLaboral.aFecha(texto);
    fecha.setUTCDate(fecha.getUTCDate() + cantidad);
    return CalendarioLaboral.aTexto(fecha);
  }

  // ---------- Reglas del calendario ----------

  cantidadFeriados() {
    return this.feriados.size;
  }

  esFinDeSemana(fecha) {
    const dia = CalendarioLaboral.aFecha(fecha).getUTCDay(); // 0 = domingo, 6 = sábado
    return dia === 0 || dia === 6;
  }

  esFeriado(fecha) {
    return this.feriados.has(fecha);
  }

  nombreFeriado(fecha) {
    return this.feriados.get(fecha) || null;
  }

  /** REGLA: un día hábil no es fin de semana ni feriado. */
  esDiaHabil(fecha) {
    return !this.esFinDeSemana(fecha) && !this.esFeriado(fecha);
  }

  /**
   * Devuelve la fecha que cae `cantidad` días hábiles DESPUÉS de `desde`.
   * El día de inicio no cuenta (igual que un plazo legal: se empieza a contar al día siguiente).
   */
  sumarDiasHabiles(desde, cantidad) {
    if (!CalendarioLaboral.esFechaValida(desde)) {
      throw new Error(`Fecha de inicio inválida: ${desde}`);
    }
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw new Error(`La cantidad de días hábiles debe ser un entero positivo (recibido: ${cantidad})`);
    }
    let fecha = desde;
    let contados = 0;
    while (contados < cantidad) {
      fecha = CalendarioLaboral.sumarDias(fecha, 1);
      if (this.esDiaHabil(fecha)) contados++;
    }
    return fecha;
  }

  /**
   * Cuenta los días hábiles entre dos fechas (sin contar `desde`, contando `hasta`).
   * Si `hasta` es anterior a `desde`, el resultado es negativo (ya pasó).
   */
  diasHabilesEntre(desde, hasta) {
    if (desde === hasta) return 0;
    const signo = hasta > desde ? 1 : -1;
    const inicio = signo === 1 ? desde : hasta;
    const fin = signo === 1 ? hasta : desde;
    let fecha = inicio;
    let cuenta = 0;
    while (fecha < fin) {
      fecha = CalendarioLaboral.sumarDias(fecha, 1);
      if (this.esDiaHabil(fecha)) cuenta++;
    }
    return cuenta * signo;
  }
}

// ===== Clase HistorialTendencia (src/HistorialTendencia.js) =====
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

// ===== Clase Factura (src/Factura.js) =====
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

// ===== Clase FacturaCredito (src/FacturaCredito.js) =====
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

// ===== Clase FacturaContado (src/FacturaContado.js) =====
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

// ===== Clase ProcesadorFacturas (src/ProcesadorFacturas.js) =====
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
