const { createApp } = require('./app');
const { openDatabase } = require('./db');

const port = Number(process.env.PORT || 2001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

async function start() {
  const db = await openDatabase();
  const server = createApp({ db });
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Backend listening on http://0.0.0.0:${port}\n`);
  });
}

start().catch((error) => {
  process.stderr.write(`Backend startup failed: ${error.message}\n`);
  process.exitCode = 1;
});
