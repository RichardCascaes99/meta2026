const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function normalizeUsername(username) {
  const rawValue = String(username || '').trim().toLowerCase();

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

function isValidUsername(username) {
  return /^[a-z0-9._]{1,30}$/.test(username);
}

async function fetchFollowersFromInstagram(username) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'X-IG-App-ID': '936619743392459',
      Accept: 'application/json',
      Referer: `https://www.instagram.com/${username}/`
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Instagram respondeu com status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const data = await response.json();
  const userData = data?.data?.user;

  const followersCount =
    userData?.edge_followed_by?.count ??
    userData?.follower_count ??
    null;

  if (followersCount === null) {
    throw new Error('Nao foi possivel ler a quantidade de seguidores desse perfil.');
  }

  return Number(followersCount);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/followers', async (req, res) => {
  const username = normalizeUsername(req.query.username);

  if (!isValidUsername(username)) {
    return res.status(400).json({
      error:
        'Username invalido. Use apenas letras, numeros, ponto e underscore (maximo 30).'
    });
  }

  const now = Date.now();
  const cached = cache.get(username);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return res.json({
      username,
      followers: cached.followers,
      source: 'cache'
    });
  }

  try {
    const followers = await fetchFollowersFromInstagram(username);

    cache.set(username, {
      followers,
      timestamp: now
    });

    return res.json({
      username,
      followers,
      source: 'instagram'
    });
  } catch (error) {
    const status = error.status === 404 ? 404 : 502;

    return res.status(status).json({
      error:
        status === 404
          ? 'Perfil nao encontrado no Instagram.'
          : 'Nao foi possivel consultar o Instagram agora. Tente novamente em instantes.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
