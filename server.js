const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_TTL_MS = 60 * 1000;
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const SNAPSHOT_PATH = path.join(__dirname, 'data', 'tracker-snapshot.json');
const INSTAGRAM_APP_ID = '936619743392459';
const INSTAGRAM_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MY_USERNAME = normalizeUsername(
  process.env.MY_INSTAGRAM_USERNAME || 'canaloamador'
);
const RIVAL_USERNAME = normalizeUsername(
  process.env.RIVAL_INSTAGRAM_USERNAME || 'mundotrilive'
);

const followersCache = new Map();
let refreshInFlight = null;

const trackerState = {
  myUsername: MY_USERNAME,
  rivalUsername: RIVAL_USERNAME,
  myFollowers: null,
  rivalFollowers: null,
  followersNeeded: null,
  updatedAt: null,
  lastAttemptAt: null,
  source: null,
  error: null
};

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

function formatSafeError(error) {
  if (error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Erro desconhecido';
}

function parseFollowersFromHtml(html) {
  const patterns = [
    /"edge_followed_by"\s*:\s*\{"count"\s*:\s*(\d+)\}/,
    /\\"edge_followed_by\\"\s*:\s*\{\\"count\\"\s*:\s*(\d+)\}/,
    /"follower_count"\s*:\s*(\d+)/,
    /\\"follower_count\\"\s*:\s*(\d+)/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function parseLsdToken(html) {
  const match = html.match(/"LSD",\[\],\{"token":"([^"]+)"/);
  return match ? match[1] : '';
}

function parseCookieHeader(profileResponse) {
  if (typeof profileResponse.headers.getSetCookie === 'function') {
    const setCookies = profileResponse.headers.getSetCookie();
    if (setCookies.length > 0) {
      return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
    }
  }

  const rawSetCookie = profileResponse.headers.get('set-cookie') || '';
  if (!rawSetCookie) {
    return '';
  }

  return rawSetCookie
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function readCookieValue(cookieHeader, cookieName) {
  const pattern = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`);
  const match = cookieHeader.match(pattern);
  return match ? match[1] : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openInstagramProfile(username) {
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  const profileResponse = await fetch(profileUrl, {
    headers: {
      'User-Agent': INSTAGRAM_USER_AGENT,
      Accept: 'text/html',
      Referer: 'https://www.instagram.com/'
    }
  });

  if (!profileResponse.ok) {
    const error = new Error(`Instagram profile status ${profileResponse.status}`);
    error.status = profileResponse.status;
    throw error;
  }

  const html = await profileResponse.text();
  const cookieHeader = parseCookieHeader(profileResponse);
  const lsdToken = parseLsdToken(html);
  const csrfToken = readCookieValue(cookieHeader, 'csrftoken');

  return {
    html,
    profileUrl,
    cookieHeader,
    lsdToken,
    csrfToken
  };
}

async function fetchFollowersFromInstagramApiWithSession(username) {
  const profile = await openInstagramProfile(username);
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const headers = {
    'User-Agent': INSTAGRAM_USER_AGENT,
    'X-IG-App-ID': INSTAGRAM_APP_ID,
    Accept: 'application/json',
    Referer: profile.profileUrl,
    'X-Requested-With': 'XMLHttpRequest'
  };

  if (profile.lsdToken) {
    headers['X-FB-LSD'] = profile.lsdToken;
  }

  if (profile.csrfToken) {
    headers['X-CSRFToken'] = profile.csrfToken;
  }

  if (profile.cookieHeader) {
    headers.Cookie = profile.cookieHeader;
  }

  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(
      `Instagram API with session status ${response.status} (${body.slice(0, 140)})`
    );
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const userData = data?.data?.user;
  const followersCount =
    userData?.edge_followed_by?.count ?? userData?.follower_count ?? null;

  if (followersCount === null) {
    throw new Error('Instagram API sem contagem de seguidores.');
  }

  return Number(followersCount);
}

async function fetchFollowersFromInstagramApiSimple(username) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': INSTAGRAM_USER_AGENT,
      'X-IG-App-ID': INSTAGRAM_APP_ID,
      Accept: 'application/json',
      Referer: `https://www.instagram.com/${username}/`
    }
  });

  if (!response.ok) {
    const error = new Error(`Instagram API simple status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const userData = data?.data?.user;
  const followersCount =
    userData?.edge_followed_by?.count ?? userData?.follower_count ?? null;

  if (followersCount === null) {
    throw new Error('Instagram API simple sem contagem de seguidores.');
  }

  return Number(followersCount);
}

async function fetchFollowersFromInstagramHtml(username) {
  const encodedUsername = encodeURIComponent(username);
  const urls = [
    `https://www.instagram.com/${encodedUsername}/embed/`,
    `https://www.instagram.com/${encodedUsername}/`
  ];
  const attempts = [];

  for (const url of urls) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': INSTAGRAM_USER_AGENT,
        Accept: 'text/html',
        Referer: 'https://www.instagram.com/'
      }
    });

    if (!response.ok) {
      attempts.push(`${url} -> status ${response.status}`);
      continue;
    }

    const html = await response.text();
    const followersCount = parseFollowersFromHtml(html);

    if (followersCount !== null) {
      return followersCount;
    }

    attempts.push(`${url} -> sem contagem`);
  }

  throw new Error(
    `Instagram HTML sem contagem de seguidores (${attempts.join(' | ')})`
  );
}

async function fetchFollowersFromInstagramProxy(username) {
  const encodedUsername = encodeURIComponent(username);
  const instagramUrl = `https://www.instagram.com/${encodedUsername}/embed/`;
  const proxyUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(instagramUrl)}`;

  const response = await fetch(proxyUrl, {
    headers: {
      'User-Agent': INSTAGRAM_USER_AGENT,
      Accept: 'text/html'
    }
  });

  if (!response.ok) {
    const error = new Error(`Instagram proxy status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const html = await response.text();
  if (/Please wait a few minutes before you try again\./i.test(html)) {
    throw new Error('Instagram proxy bloqueado temporariamente.');
  }

  const followersCount = parseFollowersFromHtml(html);
  if (followersCount === null) {
    throw new Error('Instagram proxy sem contagem de seguidores.');
  }

  return Number(followersCount);
}

async function fetchFollowersWithFallback(username) {
  try {
    const followers = await fetchFollowersFromInstagramApiWithSession(username);
    return { followers, source: 'instagram-api-with-session' };
  } catch (sessionError) {
    try {
      const followers = await fetchFollowersFromInstagramApiSimple(username);
      return { followers, source: 'instagram-api-simple' };
    } catch (simpleError) {
      try {
        const followers = await fetchFollowersFromInstagramHtml(username);
        return { followers, source: 'instagram-html' };
      } catch (htmlError) {
        try {
          const followers = await fetchFollowersFromInstagramProxy(username);
          return { followers, source: 'instagram-proxy' };
        } catch (proxyError) {
          const mergedError = new Error(
            `Falha ao consultar ${username}. API session: ${formatSafeError(
              sessionError
            )}. API simple: ${formatSafeError(
              simpleError
            )}. HTML: ${formatSafeError(htmlError)}. Proxy: ${formatSafeError(
              proxyError
            )}`
          );
          mergedError.status =
            sessionError.status ||
            simpleError.status ||
            htmlError.status ||
            proxyError.status;
          throw mergedError;
        }
      }
    }
  }
}

async function getFollowersByUsername(username, useCache = true) {
  const now = Date.now();
  const cached = followersCache.get(username);

  if (useCache && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return {
      followers: cached.followers,
      source: 'cache'
    };
  }

  const result = await fetchFollowersWithFallback(username);

  followersCache.set(username, {
    followers: result.followers,
    timestamp: now
  });

  return result;
}

async function persistSnapshot() {
  const snapshot = {
    myUsername: trackerState.myUsername,
    rivalUsername: trackerState.rivalUsername,
    myFollowers: trackerState.myFollowers,
    rivalFollowers: trackerState.rivalFollowers,
    followersNeeded: trackerState.followersNeeded,
    updatedAt: trackerState.updatedAt,
    source: trackerState.source
  };

  await fsp.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fsp.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
}

function restoreSnapshotIfPresent() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    return;
  }

  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const snapshot = JSON.parse(raw);

    if (
      Number.isInteger(snapshot.myFollowers) &&
      Number.isInteger(snapshot.rivalFollowers) &&
      Number.isInteger(snapshot.followersNeeded)
    ) {
      trackerState.myFollowers = snapshot.myFollowers;
      trackerState.rivalFollowers = snapshot.rivalFollowers;
      trackerState.followersNeeded = snapshot.followersNeeded;
      trackerState.updatedAt = snapshot.updatedAt || null;
      trackerState.source = snapshot.source || 'snapshot';
    }
  } catch (error) {
    console.error('Nao foi possivel restaurar snapshot local:', error.message);
  }
}

async function refreshTrackedProfiles() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    trackerState.lastAttemptAt = new Date().toISOString();
    trackerState.error = null;

    let myResult = null;
    let rivalResult = null;
    let firstError = null;

    try {
      myResult = await getFollowersByUsername(MY_USERNAME, false);
    } catch (error) {
      firstError = error;
      console.error(`Falha ao atualizar ${MY_USERNAME}:`, formatSafeError(error));
    }

    await sleep(1200);

    try {
      rivalResult = await getFollowersByUsername(RIVAL_USERNAME, false);
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
      console.error(
        `Falha ao atualizar ${RIVAL_USERNAME}:`,
        formatSafeError(error)
      );
    }

    const nextMyFollowers =
      myResult?.followers ?? trackerState.myFollowers ?? null;
    const nextRivalFollowers =
      rivalResult?.followers ?? trackerState.rivalFollowers ?? null;

    if (!Number.isInteger(nextMyFollowers) || !Number.isInteger(nextRivalFollowers)) {
      if (firstError) {
        throw firstError;
      }
      throw new Error('Sem dados suficientes para atualizar o contador.');
    }

    trackerState.myFollowers = nextMyFollowers;
    trackerState.rivalFollowers = nextRivalFollowers;
    trackerState.followersNeeded = Math.max(
      nextRivalFollowers - nextMyFollowers + 1,
      0
    );
    trackerState.updatedAt = new Date().toISOString();
    trackerState.source = `${myResult?.source || 'stale-my'}|${
      rivalResult?.source || 'stale-rival'
    }`;

    await persistSnapshot();
  })();

  try {
    await refreshInFlight;
  } catch (error) {
    trackerState.error = formatSafeError(error);
    console.error('Falha ao atualizar contagem:', trackerState.error);
  } finally {
    refreshInFlight = null;
  }
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

  try {
    const result = await getFollowersByUsername(username, true);
    return res.json({
      username,
      followers: result.followers,
      source: result.source
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

app.get('/api/counter', async (_req, res) => {
  if (!isValidUsername(MY_USERNAME) || !isValidUsername(RIVAL_USERNAME)) {
    return res.status(500).json({
      error: 'Usuarios do contador estao invalidos no servidor.'
    });
  }

  if (trackerState.followersNeeded === null) {
    await refreshTrackedProfiles();
  }

  if (trackerState.followersNeeded === null) {
    return res.status(503).json({
      error:
        'Ainda nao foi possivel obter os seguidores dos perfis. Tente novamente em instantes.'
    });
  }

  return res.json({
    followersNeeded: trackerState.followersNeeded,
    updatedAt: trackerState.updatedAt,
    source: trackerState.source
  });
});

restoreSnapshotIfPresent();
refreshTrackedProfiles();
setInterval(() => {
  refreshTrackedProfiles();
}, UPDATE_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(
    `Atualizacao automatica a cada 1 hora (${MY_USERNAME} vs ${RIVAL_USERNAME}).`
  );
});
