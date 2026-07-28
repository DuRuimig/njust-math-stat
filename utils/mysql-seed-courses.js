const crypto = require('node:crypto');
const path = require('node:path');

if (process.env.MYSQL_EXECUTE !== '1') {
  throw new Error('MySQL seed is disabled. It does not connect unless MYSQL_EXECUTE=1 is set explicitly.');
}

const root = path.resolve(__dirname, '..');
const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(root, 'project/backend')] }));
const { mysqlConfigFromEnv } = require(path.join(root, 'project/backend/src/db'));
const source = require(path.join(root, 'miniprogram/data/course-library.js'));
const normalizeName = (value) => value.normalize('NFKC').replace(/\s+/g, '').trim();
const stableKey = (course) => `${course.code}:${normalizeName(course.name)}`;
const teacherDirectoryKey = (teacher) => `directory:${crypto.createHash('sha256').update(teacher.academyDirectoryLink || `${teacher.name}|${teacher.department || ''}`).digest('hex')}`;

async function main() {
  const { waitForConnections, connectionLimit, queueLimit, ...connectionConfig } = mysqlConfigFromEnv();
  const connection = await mysql.createConnection(connectionConfig);
  try {
    await connection.beginTransaction();
    for (const course of source.courses) {
      await connection.execute('INSERT INTO courses (id, stable_key, code, normalized_name, name) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE stable_key = stable_key', [crypto.randomUUID(), stableKey(course), String(course.code), normalizeName(course.name), course.name]);
    }
    for (const teacher of source.teachers || []) {
      await connection.execute('INSERT INTO teachers (id, directory_key, name, department, directory_link) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE directory_key = directory_key', [crypto.randomUUID(), teacherDirectoryKey(teacher), teacher.name, teacher.department || null, teacher.academyDirectoryLink || null]);
    }
    await connection.commit();
    process.stdout.write(`Seeded ${source.courses.length} course definitions and ${(source.teachers || []).length} teacher directory entries\n`);
  } catch (error) {
    // A lost MySQL connection rolls its transaction back server-side. Preserve
    // the original database error instead of replacing it with a rollback error.
    try {
      await connection.rollback();
    } catch (_rollbackError) {
      // The original query error is the useful operational signal.
    }
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`MySQL seed failed: ${error.message}\n`);
  process.exitCode = 1;
});
