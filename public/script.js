const counterEl = document.getElementById('counter');

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
let hasAnyValue = false;

const numberFormatter = new Intl.NumberFormat('pt-BR');

function formatNumber(value) {
  return numberFormatter.format(value);
}

async function fetchCounterValue() {
  const response = await fetch(`/api/counter?t=${Date.now()}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erro ao buscar contador.');
  }

  return data.followersNeeded;
}

async function runComparison() {
  try {
    if (!hasAnyValue) {
      counterEl.textContent = '...';
    }

    const followersNeeded = await fetchCounterValue();
    counterEl.textContent = formatNumber(followersNeeded);
    hasAnyValue = true;
  } catch (error) {
    if (!hasAnyValue) {
      counterEl.textContent = '--';
    }
  }
}

runComparison();
setInterval(runComparison, REFRESH_INTERVAL_MS);
