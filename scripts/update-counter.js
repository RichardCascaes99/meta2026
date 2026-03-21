const fs = require('fs/promises');
const path = require('path');

const MY_USERNAME = 'canaloamador';
const RIVAL_USERNAME = 'mundotrilive';
const OUTPUT_PATH = path.join(__dirname, '..', 'pages', 'counter.json');

function parseFollowersFromHtml(html) {
  const match = html.match(/"edge_followed_by"\s*:\s*\{"count"\s*:\s*(\d+)\}/);
  return match ? Number(match[1]) : null;
}

async function fetchFollowersFromApi(username) {
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
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
      Referer: 'https://www.instagram.com/'
    }
  });

  if (!response.ok) {
    throw new Error(`HTML status ${response.status}`);
  }

  const html = await response.text();
  const followers = parseFollowersFromHtml(html);

  if (followers === null) {
    throw new Error('HTML sem followers');
  }

  return followers;
}

async function fetchFollowers(username) {
  try {
    const followers = await fetchFollowersFromApi(username);
    return { followers, source: 'instagram-api' };
  } catch (apiError) {
    const followers = await fetchFollowersFromHtml(username);
    return {
      followers,
      source: `instagram-html (fallback after ${apiError.message})`
    };
  }
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
    const [myResult, rivalResult] = await Promise.all([
      fetchFollowers(MY_USERNAME),
      fetchFollowers(RIVAL_USERNAME)
    ]);

    const payload = {
      myUsername: MY_USERNAME,
      rivalUsername: RIVAL_USERNAME,
      myFollowers: myResult.followers,
      rivalFollowers: rivalResult.followers,
      followersNeeded: Math.max(rivalResult.followers - myResult.followers + 1, 0),
      updatedAt: new Date().toISOString(),
      source: `${myResult.source}|${rivalResult.source}`
    };

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
