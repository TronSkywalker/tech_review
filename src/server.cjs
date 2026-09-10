const { Sentry, sentryEnabled } = require('./sentry.cjs');
const logger = require('./logger.cjs');
const express = require('express');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
const { services, graph, scenarios, serviceUrl } = require('./catalog.cjs');
const name = process.env.SERVICE_NAME || 'adapter';
const isAdapter = name === 'adapter';
const config = services.find(s => s.name === name);
if (!isAdapter && !config) throw new Error(`Invalid SERVICE_NAME: ${name}`);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2kb' }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get('/health', (_req, res) => res.json({ service: name, status: 'ok', sentryEnabled }));
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

async function callService(target, scenario, requestId, loopPath) {
  return Sentry.startSpan({ name: `call ${target}`, op: 'demo.dependency', attributes: { 'demo.target': target } }, async () => {
    const started = performance.now();
    try {
      // Native fetch is instrumented by Sentry; trace and baggage headers propagate automatically.
      const url = new URL(`${serviceUrl(target)}/work/${scenario}`);
      if (loopPath) url.searchParams.set('path', loopPath.join(','));
      const response = await fetch(url, {
        headers: { 'x-demo-request-id': requestId }, signal: AbortSignal.timeout(scenario === 'loop' ? 30000 : 6000),
      });
      return await response.json();
    } catch (error) {
      Sentry.captureException(error, { tags: { dependency: target } });
      return { service: target, status: 'error', durationMs: Math.round(performance.now() - started), error: `Cannot reach ${target}: ${error.message}`, children: [] };
    }
  });
}

app.param('scenario', (req, res, next, value) => {
  if (!scenarios.some(s => s.id === value)) return res.status(400).json({ error: 'Unknown scenario' });
  Sentry.setTag('scenario', value);
  next();
});

if (isAdapter) {
  app.get('/api/catalog', (_req, res) => res.json({ services, graph, scenarios }));
  app.get('/api/health', async (_req, res) => {
    const results = await Promise.all(services.map(async service => {
      try {
        const response = await fetch(`${serviceUrl(service.name)}/health`, { signal: AbortSignal.timeout(1200) });
        if (!response.ok) throw new Error('Unhealthy');
        return await response.json();
      } catch { return { service: service.name, status: 'offline', sentryEnabled: false }; }
    }));
    res.json({ adapter: { service: name, status: 'ok', sentryEnabled }, services: results });
  });
  app.post('/api/run/:scenario', async (req, res) => {
    const scenario = req.params.scenario;
    const entry = scenario === 'loop' ? (req.body?.service ?? 'pikachu') : 'pikachu';
    if (!services.some(service => service.name === entry)) return res.status(400).json({ error: 'Unknown starting Pokémon' });
    const started = performance.now();
    const tree = await callService(entry, scenario, req.requestId);
    const traceId = Sentry.getTraceData()['sentry-trace']?.split('-')[0] || null;
    logger.info('Demo scenario completed', { scenario, requestId: req.requestId, status: tree.status });
    res.status(tree.status === 'error' ? 502 : 200).json({ scenario, requestId: req.requestId, traceId, sentryEnabled, durationMs: Math.round(performance.now() - started), tree });
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
} else {
  app.get('/work/:scenario', async (req, res) => {
    const scenario = req.params.scenario;
    let loop;
    if (scenario === 'loop') {
      const rawPath = req.query.path;
      if (rawPath !== undefined && typeof rawPath !== 'string') return res.status(400).json({ error: 'Invalid loop path' });
      const visited = rawPath === undefined ? [] : rawPath.split(',');
      if (visited.length > 20 || visited.some((service, i) => !services.some(s => s.name === service) || (i > 0 && (service === visited[i - 1] || service === visited[0]))) || visited.at(-1) === name || (visited.length === 20 && name !== visited[0])) {
        return res.status(400).json({ error: 'Invalid loop path' });
      }
      loop = { path: [...visited, name], closed: visited.length > 0 && name === visited[0] };
    }
    const requestId = req.get('x-demo-request-id') || req.requestId;
    const started = performance.now();
    const children = [];
    let eventId;
    let warning;
    let failure;
    Sentry.setTag('demo.request_id', requestId);
    logger.info('Work started', { scenario, requestId });
    Sentry.addBreadcrumb({ category: 'demo', message: `${name} started ${scenario}`, level: 'info' });
    try {
      await Sentry.startSpan({ name: `${name}: ${config.role}`, op: 'demo.work' }, async () => {
        await sleep(scenario === 'slow' && name === 'snorlax' ? 1800 : 25 + config.port % 25);
        if (loop) {
          Sentry.setTag('loop.origin', loop.path[0]);
          if (loop.closed) {
            logger.info('Loop closed: returned to starting Pokémon', { requestId, scenario, path: loop.path.join(' → ') });
            return;
          }
          const candidates = services.filter(service => service.name !== name);
          // Repeated intermediate services are allowed. Force a return after 20
          // visits so an unlucky random walk cannot keep growing indefinitely.
          loop.forcedReturn = loop.path.length >= 20;
          const target = loop.forcedReturn ? loop.path[0] : candidates[randomInt(candidates.length)].name;
          logger.info('Loop calling next Pokémon', { requestId, scenario, target, hop: loop.path.length, forcedReturn: loop.forcedReturn });
          children.push(await callService(target, scenario, requestId, loop.path));
          if (children[0].status === 'error') throw new Error(`${name}: downstream dependency failed`);
          return;
        }
        if (scenario === 'error' && name === 'gengar') throw new Error('Gengar: reward ledger is haunted');
        if (scenario === 'handled' && name === 'psyduck') {
          const error = new Error('Psyduck: risk engine is confused');
          eventId = Sentry.captureException(error);
          warning = 'Risk check failed; using a safe demo fallback';
          logger.warn(warning, { scenario, requestId });
        }
        children.push(...await Promise.all((graph[name] || []).map(target => callService(target, scenario, requestId))));
        if (scenario === 'nplus1' && name === 'eevee') {
          for (let i = 0; i < 8; i++) children.push(await callService('meowth', scenario, requestId));
        }
        if (children.some(child => child.status === 'error')) throw new Error(`${name}: downstream dependency failed`);
      });
    } catch (error) {
      failure = error.message;
      eventId = Sentry.captureException(error);
      logger.error(failure, { scenario, requestId });
    }
    const result = { service: name, status: failure ? 'error' : warning ? 'warning' : 'ok', durationMs: Math.round(performance.now() - started), traceId: Sentry.getTraceData()['sentry-trace']?.split('-')[0] || null, sentryEnabled, children, ...(failure && { error: failure }), ...(warning && { warning }), ...(eventId && { eventId }) };
    if (loop) result.loop = loop;
    logger.info('Work completed', { scenario, requestId, status: result.status, durationMs: result.durationMs });
    res.status(failure ? 502 : 200).json(result);
  });
}
Sentry.setupExpressErrorHandler(app);
app.use((error, _req, res, _next) => res.status(error.status === 400 ? 400 : 500).json({ error: error.status === 400 ? 'Invalid JSON body' : 'Unexpected server error' }));
const port = Number(process.env.PORT || (isAdapter ? 3000 : config.port));
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => logger.info(`Ready on ${port} (Sentry ${sentryEnabled ? 'enabled' : 'not configured'})`));
server.on('error', error => { logger.error(error.message); process.exit(1); });
async function shutdown() {
  server.close();
  await Sentry.close(2000);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
