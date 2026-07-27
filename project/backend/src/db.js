const path = require('node:path');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');

const defaultPath = path.resolve(__dirname, '../../../database/runtime/njust-math-stat.sqlite');

function sqliteDatabase(filename = process.env.DATABASE_PATH || defaultPath) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.kind = 'sqlite';
  return db;
}

function mysqlConfigFromEnv(env = process.env) {
  const address = String(env.MYSQL_HOST || env.MYSQL_ADDRESS || '').trim();
  const username = String(env.MYSQL_USER || env.MYSQL_USERNAME || '').trim();
  const [host, addressPort] = address.split(':');
  const database = String(env.MYSQL_DATABASE || '').trim();
  const missing = [
    !host && 'MYSQL_HOST',
    !database && 'MYSQL_DATABASE',
    !username && 'MYSQL_USER',
    !env.MYSQL_PASSWORD && 'MYSQL_PASSWORD',
  ].filter(Boolean);
  if (missing.length) throw new Error(`MySQL configuration is incomplete: ${missing.join(', ')}`);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw new Error('MYSQL_DATABASE must use letters, numbers, or underscores only');
  const port = Number(env.MYSQL_PORT || addressPort || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_PORT must be a valid TCP port');
  const connectionLimit = Number(env.MYSQL_CONNECTION_LIMIT || 10);
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 100) throw new Error('MYSQL_CONNECTION_LIMIT must be an integer between 1 and 100');
  return {
    host,
    port,
    database,
    user: username,
    password: env.MYSQL_PASSWORD,
    // MySQL's default FOUND_ROWS flag reports duplicate no-op inserts as affected.
    // Disable it so duplicate-like behavior matches SQLite's `changes` result.
    flags: '-FOUND_ROWS',
    waitForConnections: true,
    connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
  };
}

async function openDatabase(env = process.env) {
  const driver = env.DB_DRIVER || (env.NODE_ENV === 'production' ? 'mysql' : 'sqlite');
  if (driver === 'sqlite') {
    return sqliteDatabase(env.DATABASE_PATH || defaultPath);
  }
  if (driver !== 'mysql') throw new Error('DB_DRIVER must be sqlite or mysql');
  const pool = mysql.createPool(mysqlConfigFromEnv(env));
  await pool.query('SELECT 1');
  pool.kind = 'mysql';
  return pool;
}

module.exports = { openDatabase, sqliteDatabase, mysqlConfigFromEnv };
