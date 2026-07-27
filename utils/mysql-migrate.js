const fs = require('node:fs');
const path = require('node:path');

if (process.env.MYSQL_EXECUTE !== '1') {
  throw new Error('MySQL migration is disabled. It does not connect unless MYSQL_EXECUTE=1 is set explicitly.');
}

const root = path.resolve(__dirname, '..');
const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(root, 'project/backend')] }));
const { mysqlConfigFromEnv } = require(path.join(root, 'project/backend/src/db'));
const migrationDir = path.join(root, 'database/migrations/mysql');

async function main() {
  const { waitForConnections, connectionLimit, queueLimit, database, ...connectionConfig } = mysqlConfigFromEnv();
  const bootstrapConnection = await mysql.createConnection(connectionConfig);
  try {
    await bootstrapConnection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await bootstrapConnection.end();
  }
  const connection = await mysql.createConnection({ ...connectionConfig, database, multipleStatements: true });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
      const [applied] = await connection.execute('SELECT 1 FROM schema_migrations WHERE version = ?', [file]);
      if (applied.length) continue;
      await connection.beginTransaction();
      try {
        await connection.query(fs.readFileSync(path.join(migrationDir, file), 'utf8'));
        await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
        await connection.commit();
        process.stdout.write(`Applied ${file}\n`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`MySQL migration failed: ${error.message}\n`);
  process.exitCode = 1;
});
