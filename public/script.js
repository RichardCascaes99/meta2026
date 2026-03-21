const counterEl = document.getElementById('counter');

const MY_PROFILE = 'https://www.instagram.com/canaloamador/';
const RIVAL_PROFILE = 'https://www.instagram.com/mundotrilive/';
const REFRESH_INTERVAL_MS = 60 * 1000;

const numberFormatter = new Intl.NumberFormat('pt-BR');

function cleanUsername(value) {
  const rawValue = String(value || '').trim().toLowerCase();

  if (!rawValue) {
    return '';
  }

  let normalized = rawValue
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/^instagram\.com\//, '');

  normalized = normalized.split(/[/?#]/)[0];
  normalized = normalized.replace(/^@/, '');

  return normalized;
}

function formatNumber(value) {
  return numberFormatter.format(value);
}

async function fetchFollowers(username) {
  const response = await fetch(`/api/followers?username=${encodeURIComponent(username)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erro ao buscar seguidores.');
  }

  return data.followers;
}

async function runComparison() {
  const myUsername = cleanUsername(MY_PROFILE);
  const rivalUsername = cleanUsername(RIVAL_PROFILE);

  try {
    counterEl.textContent = '...';

    const [myFollowers, rivalFollowers] = await Promise.all([
      fetchFollowers(myUsername),
      fetchFollowers(rivalUsername)
    ]);

    const followersNeeded = Math.max(rivalFollowers - myFollowers + 1, 0);
    counterEl.textContent = formatNumber(followersNeeded);
  } catch {
    counterEl.textContent = '--';
  }
}

runComparison();
setInterval(runComparison, REFRESH_INTERVAL_MS);
