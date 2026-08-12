require("dotenv").config(); // 👈 OBLIGATORIO, PRIMERA LÍNEA

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 30000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  maxIdle: Number(process.env.MYSQL_MAX_IDLE || 10),
  idleTimeout: Number(process.env.MYSQL_IDLE_TIMEOUT_MS || 60000)
});

module.exports = pool;
