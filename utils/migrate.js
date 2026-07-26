const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const Database = require(require.resolve('better-sqlite3', { paths: [path.join(root, 'project/backend')] }));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'database/runtime/njust-math-stat.sqlite');
const migrationDir = path.join(root, 'database/migrations');

if (process.env.DB_DRIVER === 'mysql') throw new Error('SQLite migration refuses DB_DRIVER=mysql; use npm run db:mysql:migrate with MYSQL_EXECUTE=1');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(file);
  if (!applied) {
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(migrationDir, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
    })();
    process.stdout.write(`Applied ${file}\n`);
  }
}
db.close();
