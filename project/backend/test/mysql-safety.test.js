const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { mysqlConfigFromEnv, openDatabase } = require('../src/db');

const root = path.resolve(__dirname, '../../..');
const scripts = ['mysql-migrate.js', 'mysql-seed-courses.js'];

describe('MySQL 运维命令安全开关', () => {
  it.each(scripts)('%s 未显式授权时不连接数据库', (script) => {
    const result = spawnSync(process.execPath, [path.join(root, 'utils', script)], {
      cwd: root,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MYSQL_EXECUTE=1');
  });

  it('关闭 FOUND_ROWS 以保持重复点赞语义与 SQLite 一致', () => {
    const config = mysqlConfigFromEnv({
      MYSQL_HOST: 'mysql.internal',
      MYSQL_DATABASE: 'course_library',
      MYSQL_USER: 'service_user',
      MYSQL_PASSWORD: 'test-only',
    });
    expect(config.flags).toBe('-FOUND_ROWS');
  });

  it('兼容云托管提供的地址和用户名变量', () => {
    const config = mysqlConfigFromEnv({
      MYSQL_ADDRESS: 'mysql.internal:3307',
      MYSQL_DATABASE: 'njust_math_stat',
      MYSQL_USERNAME: 'service_user',
      MYSQL_PASSWORD: 'test-only',
    });
    expect(config).toMatchObject({
      host: 'mysql.internal',
      port: 3307,
      database: 'njust_math_stat',
      user: 'service_user',
    });
  });

  it('体验版可在生产模式下显式使用 SQLite', async () => {
    const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'njust-preview-')), 'preview.sqlite');
    const db = await openDatabase({ NODE_ENV: 'production', DB_DRIVER: 'sqlite', DATABASE_PATH: databasePath });
    expect(db.kind).toBe('sqlite');
    db.close();
  });
});
