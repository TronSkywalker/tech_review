const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { services, scenarios } = require('../src/catalog.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const flatten = tree => [tree, ...tree.children.flatMap(flatten)];
async function waitFor(check, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await check()) return; } catch {}
    await sleep(100);
  }
  throw new Error('Timed out waiting for demo');
}

test('real multi-process cascades and Sentry envelopes', { timeout: 60000 }, async t => {
  const envelopes = [];
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
      envelopes.push(body.toString());
      res.writeHead(200).end('{}');
    });
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill();
    })));
    await new Promise(resolve => receiver.close(resolve));
  });
  // A local receiver verifies SDK output without a Sentry account or external traffic.
  const env = { ...process.env, SENTRY_DSN: `http://test@127.0.0.1:${receiver.address().port}/1`, HOST: '127.0.0.1', SERVICE_HOST_MODE: '' };
  for (const key of Object.keys(env)) if (key.startsWith('SENTRY_DSN_')) delete env[key];
  const basePort = 24100;
  for (const [index, service] of services.entries()) env[`${service.name.toUpperCase()}_URL`] = `http://127.0.0.1:${basePort + index + 1}`;
  let output = '';
  for (const [index, service] of [...services, { name: 'adapter' }].entries()) {
    const child = spawn(process.execPath, [path.join(__dirname, '../src/server.cjs')], { env: { ...env, SERVICE_NAME: service.name, PORT: String(basePort + index + 1) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    children.push(child);
  }
  const base = `http://127.0.0.1:${basePort + 11}`;
  try {
    await waitFor(async () => {
      const health = await (await fetch(`${base}/api/health`)).json();
      return health.services.every(service => service.status === 'ok');
    });
  } catch (error) { throw new Error(`${error.message}\n${output}`); }
  assert.match(await (await fetch(base)).text(), /Pokétrace/);
  assert.equal((await fetch(`${base}/api/run/unknown`, { method: 'POST' })).status, 400);
  const results = {};
  for (const scenario of scenarios) {
    const response = await fetch(`${base}/api/run/${scenario.id}`, { method: 'POST' });
    const result = await response.json();
    results[scenario.id] = result;
    assert.equal(response.status, scenario.expectedStatus, scenario.id);
    const nodes = flatten(result.tree);
    if (scenario.id === 'loop') {
      assert.ok(nodes.length >= 3 && nodes.length <= 21);
      assert.equal(nodes[0].service, 'pikachu');
      assert.equal(nodes.at(-1).service, 'pikachu');
      assert.equal(nodes.at(-1).loop.closed, true);
      assert.ok(nodes.slice(1, -1).every(node => node.service !== 'pikachu' && !node.loop.closed));
      assert.deepEqual(nodes.at(-1).loop.path, nodes.map(node => node.service));
    } else assert.equal(nodes.length, scenario.id === 'nplus1' ? 18 : 10);
    assert.match(result.traceId, /^[a-f0-9]{32}$/);
    assert.ok(nodes.every(node => node.traceId === result.traceId), `Trace must propagate to every service: ${scenario.id}`);
  }
  assert.ok(flatten(results.slow.tree).find(node => node.service === 'snorlax').durationMs >= 1750);
  assert.deepEqual(flatten(results.error.tree).filter(node => node.status === 'error').map(node => node.service), ['pikachu', 'squirtle', 'gengar']);
  const handled = flatten(results.handled.tree).find(node => node.service === 'psyduck');
  assert.equal(handled.status, 'warning');
  assert.match(handled.eventId, /^[a-f0-9]{32}$/);
  const customLoop = await (await fetch(`${base}/api/run/loop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'eevee' }) })).json();
  assert.equal(customLoop.tree.service, 'eevee');
  assert.equal(flatten(customLoop.tree).at(-1).service, 'eevee');
  assert.equal((await fetch(`${base}/api/run/loop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'missing' }) })).status, 400);
  const loopUrl = `${env.GENGAR_URL}/work/loop`;
  assert.equal((await fetch(`${loopUrl}?path=pikachu,missing`)).status, 400);
  assert.equal((await fetch(`${loopUrl}?path=pikachu,eevee,pikachu`)).status, 400);
  const longPath = ['pikachu', ...Array.from({ length: 18 }, (_, i) => i % 2 ? 'meowth' : 'eevee')];
  const bounded = await (await fetch(`${loopUrl}?path=${longPath.join(',')}`)).json();
  assert.equal(bounded.loop.forcedReturn, true);
  assert.equal(bounded.children[0].service, 'pikachu');
  assert.equal(bounded.children[0].loop.closed, true);
  assert.equal(bounded.children[0].children.length, 0);
  const direct = await (await fetch(loopUrl)).json();
  assert.equal(flatten(direct).at(-1).loop.closed, true);
  await waitFor(() => envelopes.some(body => body.includes('Gengar: reward ledger is haunted')) && envelopes.some(body => body.includes('"type":"transaction"')) && envelopes.some(body => body.includes('"type":"log"')), 15000);
  const events = envelopes.flatMap(body => body.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }));
  const transactions = events.filter(event => event.type === 'transaction' && event.contexts?.trace);
  assert.ok(transactions.some(event => event.contexts.trace.trace_id === results.healthy.traceId));
  // An unreachable dependency should be visible instead of hanging or losing the tree.
  await new Promise(resolve => { children[9].once('exit', resolve); children[9].kill(); });
  const offline = await fetch(`${base}/api/run/healthy`, { method: 'POST' });
  assert.equal(offline.status, 502);
  assert.match(flatten((await offline.json()).tree).find(node => node.service === 'gengar').error, /Cannot reach gengar/);
});
