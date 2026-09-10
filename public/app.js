const $ = selector => document.querySelector(selector);
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
const icons = ['↻', '↗', '◷', 'ϟ', '◎', '⋮'];
let catalog;
async function refreshHealth() {
  $('#refresh').disabled = true;
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('Health check failed');
    const health = await response.json();
    const online = health.services.filter(service => service.status === 'ok').length;
    const configured = health.services.filter(service => service.sentryEnabled).length;
    $('#connection').textContent = `${online}/10 online · ${configured}/10 Sentry`;
    $('#services').replaceChildren(...catalog.services.map(service => {
      const state = health.services.find(item => item.service === service.name);
      const card = element('article', 'service');
      const top = element('div', 'service-top');
      const dot = element('span', `dot ${state?.status || 'offline'}`);
      dot.title = state?.status || 'offline';
      top.append(element('h3', '', service.name), dot);
      card.append(top, element('p', '', service.role), element('small', '', `:${service.port} · ${state?.status !== 'ok' ? 'OFFLINE' : state.sentryEnabled ? 'SENTRY READY' : 'NO DSN'}`));
      return card;
    }));
  } catch { $('#connection').textContent = 'Adapter unreachable'; }
  finally { $('#refresh').disabled = false; }
}
function countCalls(node) { return 1 + node.children.reduce((sum, child) => sum + countCalls(child), 0); }
function treeView(node, total) {
  const li = element('li');
  const row = element('div', `node ${node.status}`);
  const bar = element('span', 'bar');
  const fill = element('i');
  fill.style.width = `${Math.max(2, Math.min(100, node.durationMs / Math.max(total, 1) * 100))}%`;
  bar.append(fill);
  row.append(element('b', '', node.service), element('span', 'status', node.status), bar, element('span', 'duration', `${node.durationMs} ms`));
  li.append(row);
  if (node.loop?.closed) li.append(element('p', 'node-message', `↻ Loop closed: ${node.loop.path.join(' → ')}`));
  if (node.loop?.forcedReturn) li.append(element('p', 'node-message', '20 visits reached — returning to the starting Pokémon.'));
  if (node.error || node.warning) li.append(element('p', 'node-message', node.error || node.warning));
  if (node.children.length) {
    const ul = element('ul');
    ul.append(...node.children.map(child => treeView(child, total)));
    li.append(ul);
  }
  return li;
}
async function run(scenario) {
  document.querySelectorAll('.run').forEach(button => button.disabled = true);
  $('#run-status').textContent = `Running ${scenario.title.toLowerCase()}…`;
  try {
    const response = await fetch(`/api/run/${scenario.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario.id === 'loop' ? { service: $('#loop-start').value } : {}),
    });
    const result = await response.json();
    if (!result.tree) throw new Error(result.error || 'Invalid adapter response');
    $('#empty').hidden = true;
    $('#result').hidden = false;
    $('#metrics').replaceChildren(...[['Scenario', scenario.label], ['HTTP status', response.status], ['Total time', `${result.durationMs} ms`], ['Service calls', countCalls(result.tree)]].map(([label, value]) => {
      const metric = element('div', 'metric');
      metric.append(element('small', '', label), element('strong', '', value));
      return metric;
    }));
    $('#trace').textContent = `Request: ${result.requestId} · ${result.sentryEnabled ? `Sentry trace: ${result.traceId}` : 'Sentry adapter DSN not configured'}`;
    const ul = element('ul');
    ul.append(treeView(result.tree, result.durationMs));
    $('#tree').replaceChildren(ul);
    $('#raw').textContent = JSON.stringify(result, null, 2);
    $('#run-status').textContent = response.status === scenario.expectedStatus ? 'Complete · expected result' : 'Complete · unexpected result';
  } catch (error) { $('#run-status').textContent = `Request failed: ${error.message}`; }
  finally { document.querySelectorAll('.run').forEach(button => button.disabled = false); }
}
async function init() {
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error('Catalog unavailable');
    catalog = await response.json();
    $('#scenarios').replaceChildren(...catalog.scenarios.map((scenario, index) => {
      const card = element('article', 'scenario');
      const button = element('button', 'run', 'Run scenario');
      button.setAttribute('aria-label', `Run: ${scenario.title}`);
      button.append(element('span', '', '↗'));
      button.addEventListener('click', () => run(scenario));
      card.append(element('div', 'icon', icons[index]), element('div', 'label', scenario.label), element('h3', '', scenario.title), element('p', '', scenario.description), button);
      if (scenario.id === 'loop') {
        const select = element('select', 'run');
        select.id = 'loop-start';
        select.setAttribute('aria-label', 'Starting Pokémon');
        select.append(...catalog.services.map(service => {
          const option = element('option', '', service.name);
          option.value = service.name;
          return option;
        }));
        card.insertBefore(select, button);
      }
      return card;
    }));
    $('#refresh').addEventListener('click', refreshHealth);
    await refreshHealth();
  } catch { $('#connection').textContent = 'Adapter unreachable'; $('#run-status').textContent = 'Could not load scenarios. Refresh to retry.'; }
}
init();
