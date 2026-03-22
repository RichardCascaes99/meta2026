const fs = require('fs/promises');
const path = require('path');

const MY_USERNAME = 'canaloamador';
const RIVAL_USERNAME = 'mundotrilive';
const OUTPUT_PATH = path.join(__dirname, '..', 'pages', 'counter.json');
const INSTAGRAM_APP_ID = '936619743392459';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

async function openInstagramProfile(username) {
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  const profileResponse = await fetch(profileUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
      Referer: 'https://www.instagram.com/'
    }
  });

  if (!profileResponse.ok) {
    throw new Error(`Profile status ${profileResponse.status}`);
  }

  const html = await profileResponse.text();
  const cookieHeader = parseCookieHeader(profileResponse);
  const lsdToken = parseLsdToken(html);
  const csrfToken = readCookieValue(cookieHeader, 'csrftoken');

  return {
    profileUrl,
    html,
    cookieHeader,
    lsdToken,
    csrfToken
  };
}

async function fetchFollowersFromApiWithSession(username) {
  const profile = await openInstagramProfile(username);
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const headers = {
    'User-Agent': USER_AGENT,
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

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API with session status ${response.status} (${body.slice(0, 160)})`);
  }

  const data = await response.json();
  const userData = data?.data?.user;
  const followers = userData?.edge_followed_by?.count ?? userData?.follower_count ?? null;

  if (followers === null) {
    throw new Error('API with session sem followers');
  }

  return Number(followers);
}

async function fetchFollowersFromApiSimple(username) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'X-IG-App-ID': INSTAGRAM_APP_ID,
      Accept: 'application/json',
      Referer: `https://www.instagram.com/${username}/`
    }
  });

  if (!response.ok) {
    throw new Error(`API status ${response.status}`);
  }

  const data = await response.json();
  const userData = data?.data?.user;
  const followers = userData?.edge_followed_by?.count ?? userData?.follower_count ?? null;

  if (followers === null) {
    throw new Error('API sem followers');
  }

  return Number(followers);
}

async function fetchFollowersFromHtml(username) {
  const encodedUsername = encodeURIComponent(username);
  const urls = [
    `https://www.instagram.com/${encodedUsername}/embed/`,
    `https://www.instagram.com/${encodedUsername}/`
  ];
  const attempts = [];

  for (const url of urls) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Referer: 'https://www.instagram.com/'
      }
    });

    if (!response.ok) {
      attempts.push(`${url} -> status ${response.status}`);
      continue;
    }

    const html = await response.text();
    const followers = parseFollowersFromHtml(html);

    if (followers !== null) {
      return followers;
    }

    attempts.push(`${url} -> sem contagem`);
  }

  throw new Error(`HTML sem followers (${attempts.join(' | ')})`);
}

async function fetchFollowersFromProxy(username) {
  const encodedUsername = encodeURIComponent(username);
  const instagramUrl = `https://www.instagram.com/${encodedUsername}/embed/`;
  const proxyUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(instagramUrl)}`;

  const response = await fetch(proxyUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html'
    }
  });

  if (!response.ok) {
    throw new Error(`Proxy status ${response.status}`);
  }

  const html = await response.text();

  if (/Please wait a few minutes before you try again\./i.test(html)) {
    throw new Error('Proxy bloqueado pelo Instagram');
  }

  const followers = parseFollowersFromHtml(html);
  if (followers === null) {
    throw new Error('Proxy HTML sem followers');
  }

  return Number(followers);
}

async function fetchFollowers(username) {
  try {
    const followers = await fetchFollowersFromApiWithSession(username);
    return { followers, source: 'instagram-api-with-session' };
  } catch (sessionError) {
    try {
      const followers = await fetchFollowersFromApiSimple(username);
      return {
        followers,
        source: `instagram-api-simple (fallback after ${sessionError.message})`
      };
    } catch (simpleError) {
      try {
        const followers = await fetchFollowersFromHtml(username);
        return {
          followers,
          source: `instagram-html (fallback after ${sessionError.message} | ${simpleError.message})`
        };
      } catch (htmlError) {
        const followers = await fetchFollowersFromProxy(username);
        return {
          followers,
          source: `instagram-proxy (fallback after ${sessionError.message} | ${simpleError.message} | ${htmlError.message})`
        };
      }
    }
  }
}

async function fetchFollowersWithRetry(username, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchFollowers(username);
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
  }

  throw lastError;
}

async function readExistingCounter() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCounterFile(payload) {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

async function main() {
  const existing = await readExistingCounter();

  try {
    let myResult = null;
    let rivalResult = null;
    const errors = [];

    try {
      myResult = await fetchFollowersWithRetry(MY_USERNAME);
    } catch (error) {
      errors.push(`my(${MY_USERNAME}): ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1300));

    try {
      rivalResult = await fetchFollowersWithRetry(RIVAL_USERNAME);
    } catch (error) {
      errors.push(`rival(${RIVAL_USERNAME}): ${error.message}`);
    }

    const myFollowers =
      myResult?.followers ??
      (Number.isInteger(existing?.myFollowers) ? existing.myFollowers : null);
    const rivalFollowers =
      rivalResult?.followers ??
      (Number.isInteger(existing?.rivalFollowers) ? existing.rivalFollowers : null);

    if (!Number.isInteger(myFollowers) || !Number.isInteger(rivalFollowers)) {
      throw new Error(
        errors.length > 0 ? errors.join(' | ') : 'Sem dados suficientes para atualizar.'
      );
    }

    const payload = {
      myUsername: MY_USERNAME,
      rivalUsername: RIVAL_USERNAME,
      myFollowers,
      rivalFollowers,
      followersNeeded: Math.max(rivalFollowers - myFollowers + 1, 0),
      updatedAt: new Date().toISOString(),
      source: `${myResult?.source || 'stale-my'}|${rivalResult?.source || 'stale-rival'}`
    };

    if (errors.length > 0) {
      payload.lastAttemptAt = new Date().toISOString();
      payload.lastError = errors.join(' | ');
    }

    await writeCounterFile(payload);
    console.log(`Counter atualizado: ${payload.followersNeeded}`);
    return;
  } catch (error) {
    if (existing && Number.isInteger(existing.followersNeeded)) {
      const payload = {
        ...existing,
        lastAttemptAt: new Date().toISOString(),
        lastError: error.message
      };

      await writeCounterFile(payload);
      console.log('Falha de consulta, mantendo ultimo valor valido.');
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error('Erro ao atualizar counter.json:', error.message);
  process.exit(1);
});
