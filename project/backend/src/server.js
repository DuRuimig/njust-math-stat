const { createApp } = require('./app');

const port = Number(process.env.PORT || 2001);
createApp().listen(port, () => {
  process.stdout.write(`Backend listening on http://localhost:${port}\n`);
});
