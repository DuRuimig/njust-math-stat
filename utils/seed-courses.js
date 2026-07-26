const crypto = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const Database = require(require.resolve('better-sqlite3', { paths: [path.join(root, 'project/backend')] }));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'database/runtime/njust-math-stat.sqlite');
const source = require(path.join(root, 'miniprogram/data/course-library.js'));
const teacherDirectory = { teachers: source.teachers || [] };
const normalizeName = (value) => value.normalize('NFKC').replace(/\s+/g, '').trim();
const stableKey = (course) => `${course.code}:${normalizeName(course.name)}`;
const teacherDirectoryKey = (teacher) => {
  const sourceKey = teacher.academyDirectoryLink || `${teacher.name}|${teacher.department || ''}`;
  return `directory:${crypto.createHash('sha256').update(sourceKey).digest('hex')}`;
};

if (process.env.DB_DRIVER === 'mysql') throw new Error('SQLite seed refuses DB_DRIVER=mysql; use npm run db:mysql:seed with MYSQL_EXECUTE=1');

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
const insert = db.prepare(`
  INSERT INTO courses (id, stable_key, code, normalized_name, name)
  VALUES (@id, @stableKey, @code, @normalizedName, @name)
  ON CONFLICT(stable_key) DO NOTHING
`);
const insertTeacher = db.prepare(`
  INSERT INTO teachers (id, directory_key, name, department, directory_link)
  VALUES (@id, @directoryKey, @name, @department, @directoryLink)
  ON CONFLICT(directory_key) DO NOTHING
`);
const seed = db.transaction(() => {
  for (const course of source.courses) {
    insert.run({
      id: crypto.randomUUID(),
      stableKey: stableKey(course),
      code: String(course.code),
      normalizedName: normalizeName(course.name),
      name: course.name,
    });
  }
  for (const teacher of teacherDirectory.teachers) {
    insertTeacher.run({
      id: crypto.randomUUID(),
      directoryKey: teacherDirectoryKey(teacher),
      name: teacher.name,
      department: teacher.department,
      directoryLink: teacher.academyDirectoryLink,
    });
  }
});
seed();
const count = db.prepare('SELECT COUNT(*) AS count FROM courses').get().count;
const teacherCount = db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count;
process.stdout.write(`Seeded ${count} stable course entities and ${teacherCount} teacher directory entities\n`);
db.close();
