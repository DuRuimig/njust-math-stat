const path = require('node:path');
const Database = require('better-sqlite3');

const defaultPath = path.resolve(__dirname, '../../../database/runtime/njust-math-stat.sqlite');

function openDatabase(filename = process.env.DATABASE_PATH || defaultPath) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { openDatabase };
