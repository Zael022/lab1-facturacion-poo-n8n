// Restaura db.json con los datos originales (útil antes de cada demo,
// porque el workflow modifica las facturas y agrega registros al historial).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
fs.copyFileSync(path.join(raiz, 'db.seed.json'), path.join(raiz, 'db.json'));
console.log('db.json restaurado desde db.seed.json');
