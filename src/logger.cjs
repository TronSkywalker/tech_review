const { Sentry } = require('./sentry.cjs');
const { logLabel } = require('./log-label.cjs');
const service = process.env.SERVICE_NAME || 'adapter';

function write(level, message, attributes = {}) {
  const text = `${logLabel(service)} ${message}`;
  console[level](text, ...(Object.keys(attributes).length ? [JSON.stringify(attributes)] : []));
  Sentry.logger[level](text, { ...attributes, service });
}

module.exports = {
  info: (message, attributes) => write('info', message, attributes),
  warn: (message, attributes) => write('warn', message, attributes),
  error: (message, attributes) => write('error', message, attributes),
};
