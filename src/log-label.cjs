const emojis = {
  adapter: '🔌', pikachu: '⚡', bulbasaur: '🌱', charmander: '🔥',
  squirtle: '💧', eevee: '🦊', jigglypuff: '🎵', meowth: '🪙',
  psyduck: '🦆', snorlax: '💤', gengar: '👻',
};

function logLabel(service) {
  return `${emojis[service] || '📦'} [${service}]`;
}

module.exports = { logLabel };
