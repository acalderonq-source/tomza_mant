require('dotenv').config();
const pool = require('../db');

(async () => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS ahora');
    console.log('✅ Conectado a Railway:', rows[0]);
  } catch (err) {
    console.error('❌ ERROR conexión:', err);
  } finally {
    process.exit();
  }
})();
