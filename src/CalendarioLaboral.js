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

module.exports = CalendarioLaboral;
