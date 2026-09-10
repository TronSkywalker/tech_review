const services = [
  ['pikachu', 'Mission coordinator', 4101, 'electric'],
  ['bulbasaur', 'Inventory', 4102, 'grass'],
  ['charmander', 'Preparation', 4103, 'fire'],
  ['squirtle', 'Delivery', 4104, 'water'],
  ['eevee', 'Recommendations', 4105, 'normal'],
  ['jigglypuff', 'Notifications', 4106, 'fairy'],
  ['meowth', 'Payments', 4107, 'normal'],
  ['psyduck', 'Risk checks', 4108, 'water'],
  ['snorlax', 'Warehouse', 4109, 'normal'],
  ['gengar', 'Rewards', 4110, 'ghost'],
].map(([name, role, port, type]) => ({ name, role, port, type }));
const graph = {
  pikachu: ['bulbasaur', 'charmander', 'squirtle'],
  bulbasaur: ['eevee', 'snorlax'], charmander: ['meowth', 'psyduck'],
  squirtle: ['jigglypuff', 'gengar'],
};
const scenarios = [
  { id: 'healthy', title: 'Launch an expedition', label: 'Distributed tracing', description: 'One request visits all ten services. Follow the parallel branches across projects.', expectedStatus: 200 },
  { id: 'slow', title: 'Wake up Snorlax', label: 'Slow dependency', description: 'Warehouse work takes 1.8 seconds. Find the bottleneck in the trace waterfall.', expectedStatus: 200 },
  { id: 'error', title: 'Haunt the delivery', label: 'Error monitoring', description: 'Gengar throws an error. Watch it propagate through Squirtle and Pikachu.', expectedStatus: 502 },
  { id: 'handled', title: 'Confuse Psyduck', label: 'Handled exception', description: 'A risk check fails but falls back safely. The request succeeds and an issue is captured.', expectedStatus: 200 },
  { id: 'nplus1', title: 'Collect every evolution', label: 'Repeated calls', description: 'Eevee makes eight sequential calls to Meowth. Spot the N+1 pattern in the trace.', expectedStatus: 200 },
];
function serviceUrl(name) {
  const service = services.find(s => s.name === name);
  if (!service) throw new Error(`Unknown service: ${name}`);
  return process.env[`${name.toUpperCase()}_URL`] || `http://${process.env.SERVICE_HOST_MODE === 'docker' ? name : '127.0.0.1'}:${service.port}`;
}
module.exports = { services, graph, scenarios, serviceUrl };
