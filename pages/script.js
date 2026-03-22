const counterEl = document.getElementById('counter');
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
let hasAnyValue = false;

const numberFormatter = new Intl.NumberFormat('pt-BR');

function formatNumber(value) {
  return numberFormatter.format(value);
}

async function fetchCounterValue() {
  const response = await fetch(`./counter.json?t=${Date.now()}`, { cache: 'no-store' });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erro ao buscar contador.');
  }

  if (!Number.isInteger(data.followersNeeded)) {
    throw new Error('Contador invalido.');
  }

  return data.followersNeeded;
}

async function updateCounter() {
  try {
    if (!hasAnyValue) {
      counterEl.textContent = '...';
    }

    const value = await fetchCounterValue();
    counterEl.textContent = formatNumber(value);
    hasAnyValue = true;
  } catch {
    if (!hasAnyValue) {
      counterEl.textContent = '--';
    }
  }
}

updateCounter();
setInterval(updateCounter, REFRESH_INTERVAL_MS);
