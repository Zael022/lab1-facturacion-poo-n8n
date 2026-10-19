// Pruebas automáticas de las clases. Ejecutar con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CalendarioLaboral, Factura, FacturaCredito, FacturaContado, HistorialTendencia, ProcesadorFacturas,
} = require('../src');
const feriados = require('../data/feriados-cr-2026-respaldo.json');

const calendario = new CalendarioLaboral(feriados);

test('CalendarioLaboral: fines de semana y feriados no son hábiles', () => {
  assert.equal(calendario.esDiaHabil('2026-09-15'), false); // Independencia
  assert.equal(calendario.esDiaHabil('2026-10-17'), false); // sábado
  assert.equal(calendario.esDiaHabil('2026-10-19'), true);  // lunes normal
});

test('CalendarioLaboral: sumar días hábiles salta el feriado del 15 de setiembre', () => {
  assert.equal(calendario.sumarDiasHabiles('2026-09-08', 15), '2026-09-30');
  assert.equal(new CalendarioLaboral(['1900-01-01']).sumarDiasHabiles('2026-09-08', 15), '2026-09-29');
});

test('CalendarioLaboral: viernes + 1 día hábil = lunes', () => {
  assert.equal(calendario.sumarDiasHabiles('2026-10-16', 1), '2026-10-19');
});

test('CalendarioLaboral: rechaza fechas imposibles', () => {
  assert.equal(CalendarioLaboral.esFechaValida('2026-02-30'), false);
  assert.throws(() => calendario.sumarDiasHabiles('no-es-fecha', 3));
});

test('Factura es abstracta: no se puede instanciar directamente', () => {
  assert.throws(() => new Factura({ id: 'X' }), /clase base/);
});

test('Polimorfismo: crédito y contado calculan distinto con el mismo método', () => {
  const datos = { id: 'A', cliente: 'Cliente', monto: 1000, fechaEmision: '2026-10-16' };
  const facturas = [new FacturaCredito(datos), new FacturaContado(datos)];
  const fechas = facturas.map((f) => f.calcularFechaVencimiento(calendario));
  assert.deepEqual(fechas, ['2026-11-06', '2026-10-19']);
  assert.ok(facturas.every((f) => f instanceof Factura));
});

test('FacturaCredito respeta un plazo personalizado y valida el rango', () => {
  const f = new FacturaCredito({ id: 'B', cliente: 'C', monto: 1, fechaEmision: '2026-10-01', diasCredito: 30 });
  assert.equal(f.calcularFechaVencimiento(calendario), '2026-11-12');
  const mala = new FacturaCredito({ id: 'C', cliente: 'C', monto: 1, fechaEmision: '2026-10-01', diasCredito: 200 });
  assert.equal(mala.validar('2026-10-19').length, 1);
});

test('Factura: vencida, por vencer y pagada', () => {
  const f = new FacturaCredito({ id: 'D', cliente: 'C', monto: 1, fechaEmision: '2026-09-08' });
  assert.equal(f.estaVencida('2026-09-30', calendario), false); // vence ese mismo día
  assert.equal(f.estaVencida('2026-10-01', calendario), true);
  assert.equal(f.estaPorVencer('2026-09-28', calendario, 3), true);
  const pagada = new FacturaCredito({ id: 'E', cliente: 'C', monto: 1, fechaEmision: '2026-01-05', estado: 'pagada' });
  assert.equal(pagada.estaVencida('2026-10-19', calendario), false);
});

test('Factura: conversión de dólares a colones', () => {
  const usd = new FacturaContado({ id: 'F', cliente: 'C', monto: 100, moneda: 'USD', fechaEmision: '2026-10-01' });
  assert.equal(usd.montoEnColones(505.25), 50525);
  assert.equal(usd.montoEnColones(null), null);
});

test('Factura: validación detecta datos incompletos', () => {
  const f = new FacturaCredito({ id: 'G', cliente: '', monto: -5, moneda: 'EUR' });
  assert.equal(f.validar('2026-10-19').length, 4);
  const futura = new FacturaContado({ id: 'H', cliente: 'C', monto: 1, fechaEmision: '2027-01-10' });
  assert.match(futura.validar('2026-10-19')[0], /futuro/);
});

test('HistorialTendencia: empeorando, mejorando, estable y sin datos', () => {
  const historial = new HistorialTendencia([
    { ejecutadoEn: '2026-10-14', tasaMorosidad: 20, tipoCambio: 500 },
    { ejecutadoEn: '2026-10-15', tasaMorosidad: 20, tipoCambio: 505 },
  ]);
  assert.equal(historial.calcularTendencia(30).tendencia, 'empeorando');
  assert.equal(historial.calcularTendencia(10).tendencia, 'mejorando');
  assert.equal(historial.calcularTendencia(21).tendencia, 'estable');
  assert.equal(historial.ultimoTipoCambio(), 505);
  assert.equal(new HistorialTendencia([]).calcularTendencia(50).tendencia, 'sin_datos');
});

test('ProcesadorFacturas: no procesa sin feriados', () => {
  assert.throws(() => new ProcesadorFacturas({ feriados: [], hoy: '2026-10-19' }), /feriados/);
});

test('ProcesadorFacturas: procesa el db.seed.json completo', () => {
  const db = require('../db.seed.json');
  const procesador = new ProcesadorFacturas({ feriados, tipoCambio: 500, hoy: '2026-10-28', ejecutadoEn: 'x' });
  const r = procesador.procesar(db.facturas, db.historial);
  assert.equal(r.resumen.totalEvaluadas, 8);
  assert.equal(r.resumen.vencidas, 5);
  assert.equal(r.resumen.enRevision, 3);
  assert.equal(r.resumen.criticas, 2);
  assert.equal(r.tendencia.tendencia, 'empeorando');
  assert.equal(r.hayAlerta, true);
  assert.ok(!r.actualizaciones.some((a) => a.id === 'F-007'), 'la factura pagada no se toca');
});

test('ProcesadorFacturas: sin tipo de cambio usa el último del historial', () => {
  const db = require('../db.seed.json');
  const procesador = new ProcesadorFacturas({ feriados, tipoCambio: null, hoy: '2026-10-28' });
  const r = procesador.procesar(db.facturas, db.historial);
  assert.equal(r.resumen.tipoCambio, 505.2);
  assert.match(r.resumen.fuenteTipoCambio, /historial/);
});
