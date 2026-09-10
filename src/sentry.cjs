// Load before Express and HTTP so the SDK can instrument incoming/outgoing calls.
const Sentry = require('@sentry/node');
const service = process.env.SERVICE_NAME || 'adapter';
const dsn = process.env[`SENTRY_DSN_${service.toUpperCase()}`] || process.env.SENTRY_DSN;
Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || 'showcase',
  release: process.env.SENTRY_RELEASE || 'pokemon-showcase@1.0.0',
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: false,
  initialScope: { tags: { service } },
});
module.exports = { Sentry, sentryEnabled: Boolean(dsn) };
