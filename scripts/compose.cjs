// Regenerate compose.yaml after changing the service catalog: node scripts/compose.cjs
const fs = require('node:fs');
const { services } = require('../src/catalog.cjs');
let yaml = `name: poketrace
x-common: &common
  build: .
  init: true
  env_file:
    - path: .env
      required: false
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 15s
    timeout: 3s
    start_period: 10s
    retries: 3

services:
  adapter:
    <<: *common
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      SERVICE_NAME: adapter
      SERVICE_HOST_MODE: docker
      PORT: "3000"
    depends_on:
`;
for (const service of services) yaml += `      ${service.name}:\n        condition: service_healthy\n`;
for (const service of services) yaml += `  ${service.name}:\n    <<: *common\n    environment:\n      SERVICE_NAME: ${service.name}\n      SERVICE_HOST_MODE: docker\n      PORT: "${service.port}"\n`;
fs.writeFileSync('compose.yaml', yaml);
// Optional connection to the self-hosted Sentry stack, created by sentry:up.
let localSentry = '# Start Sentry first: npm run sentry:up\nservices:\n';
for (const service of [...services, { name: 'adapter' }]) {
  localSentry += `  ${service.name}:\n    networks:\n      - default\n      - observability\n`;
}
localSentry += 'networks:\n  observability:\n    external: true\n    name: poketrace-observability\n';
fs.writeFileSync('compose.local-sentry.yaml', localSentry);
