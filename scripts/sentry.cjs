const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const checkout = path.join(root, '.sentry', 'self-hosted');
const version = '26.8.0';
const commit = '73fe2f2747800873f0896aec283c45b6dcf34432';
const action = process.argv[2];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}${result.stderr ? `: ${result.stderr.toString().trim()}` : ''}`);
  return result.stdout?.toString().trim();
}

function prepare() {
  if (!fs.existsSync(checkout)) {
    fs.mkdirSync(path.dirname(checkout), { recursive: true });
    run('git', ['-c', 'core.autocrlf=false', 'clone', '--depth', '1', '--branch', version, 'https://github.com/getsentry/self-hosted.git', checkout]);
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: checkout, stdio: 'pipe' });
  if (head !== commit) throw new Error(`Expected Sentry ${version} (${commit}), found ${head}. Existing checkout was left intact.`);
  // Preserve generated secrets and any user edits on subsequent runs.
  const envPath = path.join(checkout, '.env.custom');
  if (!fs.existsSync(envPath)) {
    const defaults = fs.readFileSync(path.join(checkout, '.env'), 'utf8');
    const env = defaults
      .replace(/^COMPOSE_PROJECT_NAME=.*$/m, 'COMPOSE_PROJECT_NAME=poketrace-sentry')
      .replace(/^SENTRY_BIND=.*$/m, 'SENTRY_BIND=127.0.0.1:9000')
      .replace(/^SENTRY_EVENT_RETENTION_DAYS=.*$/m, 'SENTRY_EVENT_RETENTION_DAYS=7')
      .replace(/^LAUNCHPAD_RPC_SHARED_SECRET=.*$/m, `LAUNCHPAD_RPC_SHARED_SECRET=${randomBytes(32).toString('hex')}`);
    fs.writeFileSync(envPath, env);
  }
  const overridePath = path.join(checkout, 'docker-compose.override.yml');
  if (!fs.existsSync(overridePath)) fs.copyFileSync(path.join(root, 'infra/sentry/compose.override.yaml'), overridePath);
  const configPath = path.join(checkout, 'sentry/config.yml');
  if (!fs.existsSync(configPath)) {
    const config = fs.readFileSync(path.join(checkout, 'sentry/config.example.yml'), 'utf8')
      .replace('# system.url-prefix: https://example.sentry.com', "system.url-prefix: 'http://localhost:9000'");
    fs.writeFileSync(configPath, config);
  }
  console.log(`Sentry ${version} prepared in .sentry/self-hosted (feature-complete, http://localhost:9000).`);
}

function checkResources() {
  const info = JSON.parse(run('docker', ['info', '--format', '{{json .}}'], { stdio: 'pipe' }));
  const memoryMiB = Math.floor(info.MemTotal / 1024 / 1024);
  if (info.OSType !== 'linux') throw new Error('Sentry requires Docker Linux containers.');
  if (memoryMiB < 14000 || info.NCPU < 4) {
    throw new Error(`Sentry requires at least 14000 MiB RAM and 4 CPUs in Docker; found ${memoryMiB} MiB and ${info.NCPU} CPUs. Increase Docker/WSL memory before installing (16 GB allocated is a practical target).`);
  }
}

function install() {
  checkResources();
  const args = ['install.sh', '--skip-user-creation', '--no-report-self-hosted-issues', '--no-apply-automatic-config-updates'];
  if (process.platform === 'win32') {
    const output = spawnSync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le' });
    const distributions = (output.stdout || '').replace(/\0/g, '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('docker-desktop'));
    const distro = process.env.SENTRY_WSL_DISTRO || distributions[0];
    if (!distro || !distributions.includes(distro)) throw new Error('Install a WSL Linux distribution (e.g. Ubuntu), enable its Docker Desktop WSL integration, then retry. Optionally select it with SENTRY_WSL_DISTRO.');
    run('wsl.exe', ['--distribution', distro, '--cd', checkout, '--exec', 'bash', ...args]);
  } else {
    run('bash', args, { cwd: checkout });
  }
  fs.writeFileSync(path.join(checkout, '.poketrace-installed'), `${version}\n`);
  console.log('Installation complete. Run npm run sentry:user, then npm run sentry:up.');
}

try {
  const commands = {
    up: ['up', '-d', '--wait', '--wait-timeout', '600'],
    down: ['down'], status: ['ps', '--all'], logs: ['logs', '--follow', '--tail', '100'],
    user: ['run', '--rm', 'web', 'createuser', '--superuser'], config: ['config', '--quiet'],
  };
  if (!['prepare', 'install', ...Object.keys(commands)].includes(action)) throw new Error('Usage: node scripts/sentry.cjs prepare|install|up|down|status|logs|user|config');
  if (action === 'prepare' || action === 'install') prepare();
  if (action === 'install') install();
  if (commands[action]) {
    if (!fs.existsSync(path.join(checkout, '.env.custom'))) throw new Error('Run npm run sentry:prepare first.');
    if (['up', 'user'].includes(action) && !fs.existsSync(path.join(checkout, '.poketrace-installed'))) throw new Error('Run npm run sentry:install successfully before starting Sentry or creating an administrator.');
    if (action === 'up') checkResources();
    // Load the full upstream environment, including image build args and profiles.
    run('docker', ['compose', '--env-file', path.join(checkout, '.env.custom'), '-f', path.join(root, 'compose.sentry.yaml'), '--profile', 'feature-complete', ...commands[action]]);
  }
} catch (error) {
  console.error(`Sentry setup: ${error.message}`);
  process.exitCode = 1;
}
