/**
 * build-workflow.js
 * -----------------
 * Genera el workflow de n8n (n8n/workflow-facturacion.json) a partir de las
 * clases de /src. Copia el código de las clases dentro del nodo Code
 * "Evaluar facturas (POO)", para que la lógica del workflow sea EXACTAMENTE
 * la misma que se prueba con main.js y con `npm test`.
 *
 * Uso: npm run build:n8n   (luego importar el JSON en n8n)
 *
 * Por qué hace falta: el nodo Code de n8n no puede hacer require() de archivos
 * de tu computadora, así que las clases tienen que ir pegadas dentro del nodo.
 * En vez de copiarlas a mano (y arriesgar que queden distintas), este script
 * lo hace automáticamente.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const ORDEN_CLASES = [
  'CalendarioLaboral', 'HistorialTendencia', 'Factura', 'FacturaCredito', 'FacturaContado', 'ProcesadorFacturas',
];

// ---------------------------------------------------------------------------
// 1) Código del nodo Code principal = clases de /src + plantilla de conexión
// ---------------------------------------------------------------------------
function codigoDeClase(nombre) {
  const fuente = fs.readFileSync(path.join(RAIZ, 'src', `${nombre}.js`), 'utf8');
  return fuente
    .split('\n')
    .filter((linea) => !/^const \w+ = require\(/.test(linea) && !/^module\.exports/.test(linea))
    .join('\n')
    .trim();
}

const plantilla = fs.readFileSync(path.join(RAIZ, 'n8n', 'nodo-evaluar-plantilla.js'), 'utf8').trim();
const codigoEvaluar = [
  '// ⚠ CÓDIGO GENERADO por scripts/build-workflow.js a partir de /src.',
  '// Si cambias una regla de negocio, cámbiala en /src y vuelve a ejecutar: npm run build:n8n',
  '',
  ...ORDEN_CLASES.map((nombre) => `// ===== Clase ${nombre} (src/${nombre}.js) =====\n${codigoDeClase(nombre)}\n`),
  plantilla,
  '',
].join('\n');

// ---------------------------------------------------------------------------
// 2) Código de los nodos Code pequeños (preparar datos y redactar alertas)
// ---------------------------------------------------------------------------
const codigoPrepararFeriados = `// Revisa la respuesta de Nager.Date y la deja en un formato simple.
// Si la API falló, n8n deja un campo "error" (el nodo HTTP continúa en vez de detenerse).
const r = $input.first().json;
const ok = r.statusCode === 200 && Array.isArray(r.body) && r.body.length > 0;
let errorFeriados = null;
if (!ok) {
  errorFeriados = r.error
    ? (r.error.message || String(r.error))
    : \`Respuesta inesperada de la API (estado HTTP \${r.statusCode})\`;
}
return [{
  json: {
    feriadosOk: ok,
    feriados: ok ? r.body.map((f) => ({ date: f.date, localName: f.localName })) : [],
    errorFeriados,
  },
}];`;

const codigoPrepararTipoCambio = `// Revisa la respuesta de open.er-api.com y extrae el tipo de cambio USD -> CRC.
// Si la API falla NO se detiene el workflow: el ProcesadorFacturas usará el último del historial.
const r = $input.first().json;
const b = r.body || {};
const ok = r.statusCode === 200 && b.result === 'success' && b.rates && b.rates.CRC > 0;
return [{
  json: {
    tipoCambioOk: Boolean(ok),
    tipoCambio: ok ? Math.round(b.rates.CRC * 100) / 100 : null,
    errorTipoCambio: ok ? null : (r.error ? (r.error.message || String(r.error)) : 'Respuesta inesperada de la API'),
  },
}];`;

const codigoAlertaFeriados = `// ERROR 1: la API de feriados no respondió. Por seguridad no se procesa nada.
const config = $('Configuración').first().json;
const fuentes = $input.first().json;
return [{
  json: {
    asunto: \`⚠ Facturación detenida \${config.hoy}: la API de feriados no respondió\`,
    cuerpo: [
      \`No se procesó ninguna factura el \${config.hoy}.\`,
      '',
      \`Motivo técnico: \${fuentes.errorFeriados}\`,
      '',
      'Regla de seguridad: sin la lista de feriados no se calculan vencimientos,',
      'para no marcar como vencida una factura que todavía está en plazo.',
      'Acción sugerida: volver a ejecutar el workflow más tarde.',
    ].join('\\n'),
    tipoError: 'api_feriados_caida',
  },
}];`;

const codigoAlertaJsonServer = `// ERROR 2: JSON Server no respondió (apagado o URL incorrecta).
const config = $('Configuración').first().json;
const r = $input.first().json;
const motivo = r.error
  ? (r.error.message || String(r.error))
  : \`Estado HTTP \${r.statusCode}\`;
return [{
  json: {
    asunto: \`⚠ Facturación detenida \${config.hoy}: JSON Server no responde\`,
    cuerpo: [
      \`No se pudieron leer las facturas desde \${config.jsonServer}.\`,
      '',
      \`Motivo técnico: \${motivo}\`,
      '',
      'Acción sugerida: verificar que JSON Server esté encendido (npm run api) y volver a ejecutar.',
    ].join('\\n'),
    tipoError: 'json_server_caido',
  },
}];`;

// ---------------------------------------------------------------------------
// 3) Definición del workflow
// ---------------------------------------------------------------------------
const idDe = (nombre) => {
  const h = crypto.createHash('md5').update(`lab1-facturacion:${nombre}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const CONFIG = "$('Configuración').first().json";
const respuestaCompleta = { response: { response: { fullResponse: true, neverError: true } }, timeout: 10000 };

const condicionBooleana = (nombre, expresion) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: idDe(`${nombre}-condicion`),
      leftValue: `={{ ${expresion} }}`,
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
    combinator: 'and',
  },
  options: {},
});

const asignacion = (name, value, type = 'string') => ({ id: idDe(`config-${name}`), name, value, type });

const nodos = [
  {
    name: 'Cada día 7:00 a.m.',
    type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300],
    parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 7 }] } },
  },
  {
    name: 'Configuración',
    type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 300],
    parameters: {
      assignments: {
        assignments: [
          asignacion('jsonServer', 'http://localhost:3000'),
          asignacion('hoy', "={{ $now.setZone('America/Costa_Rica').toFormat('yyyy-MM-dd') }}"),
          asignacion('umbralDiasRiesgo', 3, 'number'),
          asignacion('montoCriticoCRC', 1000000, 'number'),
          asignacion('correoAlertas', 'tu-correo@gmail.com'),
          asignacion('correoRemitente', 'tu-correo@gmail.com'),
        ],
      },
      options: {},
    },
  },
  {
    name: 'API Feriados (Nager.Date)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440, 180],
    parameters: { url: `=https://date.nager.at/api/v3/PublicHolidays/{{ ${CONFIG}.hoy.slice(0, 4) }}/CR`, options: respuestaCompleta },
    onError: 'continueRegularOutput',
  },
  {
    name: 'API Tipo de cambio',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440, 420],
    parameters: { url: 'https://open.er-api.com/v6/latest/USD', options: respuestaCompleta },
    onError: 'continueRegularOutput',
  },
  {
    name: 'Preparar feriados',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 180],
    parameters: { jsCode: codigoPrepararFeriados },
  },
  {
    name: 'Preparar tipo de cambio',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 420],
    parameters: { jsCode: codigoPrepararTipoCambio },
  },
  {
    name: 'Combinar fuentes externas',
    type: 'n8n-nodes-base.merge', typeVersion: 3, position: [880, 300],
    parameters: { mode: 'combine', combineBy: 'combineAll', options: {} },
  },
  {
    name: '¿Hay feriados?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1100, 300],
    parameters: condicionBooleana('hay-feriados', '$json.feriadosOk'),
  },
  {
    name: 'GET facturas no pagadas',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1320, 200],
    parameters: { url: `={{ ${CONFIG}.jsonServer }}/facturas?estado_ne=pagada`, options: respuestaCompleta },
    onError: 'continueRegularOutput',
  },
  {
    name: 'Alerta: API de feriados caída',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 520],
    parameters: { jsCode: codigoAlertaFeriados },
  },
  {
    name: '¿JSON Server respondió?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1540, 200],
    parameters: condicionBooleana('json-server', '$json.statusCode === 200 && Array.isArray($json.body)'),
  },
  {
    name: 'GET historial',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1760, 100],
    parameters: { url: `={{ ${CONFIG}.jsonServer }}/historial?_sort=ejecutadoEn&_order=desc&_limit=5`, options: respuestaCompleta },
    onError: 'continueRegularOutput',
  },
  {
    name: 'Alerta: JSON Server caído',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 400],
    parameters: { jsCode: codigoAlertaJsonServer },
  },
  {
    name: 'Enviar alerta técnica',
    type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [2000, 460],
    parameters: {
      fromEmail: `={{ ${CONFIG}.correoRemitente }}`,
      toEmail: `={{ ${CONFIG}.correoAlertas }}`,
      subject: '={{ $json.asunto }}',
      emailFormat: 'text',
      text: '={{ $json.cuerpo }}',
      options: { appendAttribution: false },
    },
    onError: 'continueRegularOutput',
  },
  {
    name: 'Evaluar facturas (POO)',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [1980, 100],
    parameters: { jsCode: codigoEvaluar },
  },
  {
    name: 'Separar actualizaciones',
    type: 'n8n-nodes-base.splitOut', typeVersion: 1, position: [2200, -20],
    parameters: { fieldToSplitOut: 'actualizaciones', options: {} },
  },
  {
    name: 'PATCH factura (JSON Server)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2420, -20],
    parameters: {
      method: 'PATCH',
      url: `={{ ${CONFIG}.jsonServer }}/facturas/{{ $json.id }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.cambios) }}',
      options: { timeout: 10000 },
    },
    onError: 'continueRegularOutput',
  },
  {
    name: 'POST historial (JSON Server)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2200, 200],
    parameters: {
      method: 'POST',
      url: `={{ ${CONFIG}.jsonServer }}/historial`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.registroHistorial) }}',
      options: { timeout: 10000 },
    },
    onError: 'continueRegularOutput',
  },
  {
    name: '¿Situación crítica?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [2420, 200],
    parameters: condicionBooleana('situacion-critica', "$('Evaluar facturas (POO)').first().json.hayAlerta"),
  },
  {
    name: 'Enviar reporte por correo',
    type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [2660, 120],
    parameters: {
      fromEmail: `={{ ${CONFIG}.correoRemitente }}`,
      toEmail: `={{ ${CONFIG}.correoAlertas }}`,
      subject: "={{ $('Evaluar facturas (POO)').first().json.correo.asunto }}",
      emailFormat: 'text',
      text: "={{ $('Evaluar facturas (POO)').first().json.correo.cuerpo }}",
      options: { appendAttribution: false },
    },
    onError: 'continueRegularOutput',
  },
  {
    name: 'Sin novedades',
    type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [2660, 300],
    parameters: {},
  },
  {
    name: 'Nota: fuentes',
    type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [380, -60],
    parameters: {
      width: 520, height: 200, color: 4,
      content: '## 1. Fuentes externas (Reto 2)\nFeriados de Costa Rica (Nager.Date) y tipo de cambio USD→CRC (open.er-api.com) se piden en paralelo y se **combinan con Merge**.\nSi el tipo de cambio falla, se usa el último guardado en el historial.',
    },
  },
  {
    name: 'Nota: errores',
    type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [1280, 640],
    parameters: {
      width: 700, height: 160, color: 3,
      content: '## Manejo de errores\n**Error 1:** la API de feriados no responde → no se procesa nada (regla de seguridad) y se envía alerta.\n**Error 2:** JSON Server apagado → alerta técnica.\n**Error 3:** factura con datos incompletos → pasa a estado "revision" con el motivo (lo decide la clase Factura).',
    },
  },
  {
    name: 'Nota: POO',
    type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [1920, -260],
    parameters: {
      width: 760, height: 200, color: 5,
      content: '## 2. Lógica de negocio con clases (Reto 1 y Reto 4)\nEl nodo **Evaluar facturas (POO)** contiene las mismas clases de /src: Factura → FacturaCredito / FacturaContado (polimorfismo en calcularFechaVencimiento), CalendarioLaboral, HistorialTendencia y ProcesadorFacturas.\nLuego se actualiza cada factura (PATCH), se guarda la ejecución en el historial (POST) y, si hay situación crítica, se envía correo (Reto 3).',
    },
  },
].map((nodo) => ({ id: idDe(nodo.name), ...nodo }));

const conectar = (...salidas) => ({ main: salidas.map((destinos) => destinos.map((d) => (typeof d === 'string' ? { node: d, type: 'main', index: 0 } : { type: 'main', ...d }))) });

const conexiones = {
  'Cada día 7:00 a.m.': conectar(['Configuración']),
  Configuración: conectar(['API Feriados (Nager.Date)', 'API Tipo de cambio']),
  'API Feriados (Nager.Date)': conectar(['Preparar feriados']),
  'API Tipo de cambio': conectar(['Preparar tipo de cambio']),
  'Preparar feriados': conectar([{ node: 'Combinar fuentes externas', index: 0 }]),
  'Preparar tipo de cambio': conectar([{ node: 'Combinar fuentes externas', index: 1 }]),
  'Combinar fuentes externas': conectar(['¿Hay feriados?']),
  '¿Hay feriados?': conectar(['GET facturas no pagadas'], ['Alerta: API de feriados caída']),
  'Alerta: API de feriados caída': conectar(['Enviar alerta técnica']),
  'GET facturas no pagadas': conectar(['¿JSON Server respondió?']),
  '¿JSON Server respondió?': conectar(['GET historial'], ['Alerta: JSON Server caído']),
  'Alerta: JSON Server caído': conectar(['Enviar alerta técnica']),
  'GET historial': conectar(['Evaluar facturas (POO)']),
  'Evaluar facturas (POO)': conectar(['Separar actualizaciones', 'POST historial (JSON Server)']),
  'Separar actualizaciones': conectar(['PATCH factura (JSON Server)']),
  'POST historial (JSON Server)': conectar(['¿Situación crítica?']),
  '¿Situación crítica?': conectar(['Enviar reporte por correo'], ['Sin novedades']),
};

const workflow = {
  name: 'Lab 1 — Central de facturación con días hábiles (POO + n8n)',
  nodes: nodos,
  connections: conexiones,
  pinData: {},
  settings: { executionOrder: 'v1' },
  active: false,
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

fs.writeFileSync(path.join(RAIZ, 'n8n', 'workflow-facturacion.json'), `${JSON.stringify(workflow, null, 2)}\n`);
fs.writeFileSync(path.join(RAIZ, 'n8n', 'codigo-nodo-evaluar.js'), codigoEvaluar);
console.log('✓ n8n/workflow-facturacion.json generado');
console.log('✓ n8n/codigo-nodo-evaluar.js generado (copia legible del nodo Code principal)');
