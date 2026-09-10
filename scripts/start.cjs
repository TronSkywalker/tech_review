const { spawn } = require('node:child_process');
const path = require('node:path');
const { services } = require('../src/catalog.cjs');
const { logLabel } = require('../src/log-label.cjs');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => process.exit(code), 3000);
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => { clearTimeout(timer); process.exit(code); });
}
for (const service of [...services, { name: 'adapter', port: Number(process.env.PORT || 3000) }]) {
  const child = spawn(process.execPath, [path.join(__dirname, '../src/server.cjs')], {
    env: { ...process.env, SERVICE_NAME: service.name, PORT: String(service.port) }, stdio: 'inherit',
  });
  children.push(child);
  child.on('error', error => { console.error(`${logLabel(service.name)} ${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${logLabel(service.name)} Stopped unexpectedly (${code})`); stop(1); } });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
