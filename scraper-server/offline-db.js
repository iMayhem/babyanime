const DB_URL = 'https://raw.githubusercontent.com/manami-project/anime-offline-database/master/anime-offline-database.json';

let db = null;
let lastFetch = 0;
const REFRESH_MS = 86400000;

async function loadDB() {
  try {
    const resp = await fetch(DB_URL);
    db = await resp.json();
    lastFetch = Date.now();
    console.log('[OfflineDB] Loaded ' + (db.data?.length || 0) + ' entries');
  } catch (err) {
    console.error('[OfflineDB] Fetch failed:', err.message);
    db = db || { data: [] };
  }
}

function ensureDB() {
  if (!db || Date.now() - lastFetch > REFRESH_MS) return loadDB();
  return Promise.resolve();
}

function findByMalId(malId) {
  if (!db || !db.data) return null;
  const idStr = String(malId);
  return db.data.find(e =>
    e.sources?.some(s => s.startsWith('https://myanimelist.net/anime/') && s.endsWith('/' + idStr))
  ) || null;
}

function findByAnilistId(anilistId) {
  if (!db || !db.data) return null;
  const idStr = String(anilistId);
  return db.data.find(e =>
    e.sources?.some(s => s.includes('anilist.co/anime/') && s.endsWith('/' + idStr))
  ) || null;
}

function getAnilistId(entry) {
  if (!entry) return null;
  const s = entry.sources?.find(s => s.includes('anilist.co/anime/'));
  if (!s) return null;
  const m = s.match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1]) : null;
}

function getMalId(entry) {
  if (!entry) return null;
  const s = entry.sources?.find(s => s.startsWith('https://myanimelist.net/anime/'));
  if (!s) return null;
  const m = s.match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1]) : null;
}

async function malToAnilist(malId) {
  await ensureDB();
  const entry = findByMalId(malId);
  if (!entry) return null;
  return { id: getAnilistId(entry), idMal: parseInt(malId), title: entry.title };
}

async function anilistToMal(anilistId) {
  await ensureDB();
  const entry = findByAnilistId(anilistId);
  if (!entry) return null;
  return { malId: getMalId(entry), id: parseInt(anilistId), title: entry.title };
}

async function resolveIds(input) {
  await ensureDB();
  let anilistId = input.anilist_id ? parseInt(input.anilist_id) : null;
  let malId = input.mal_id ? parseInt(input.mal_id) : null;
  if (malId && !anilistId) {
    const mapped = await malToAnilist(malId);
    if (mapped) anilistId = mapped.id;
  }
  if (anilistId && !malId) {
    const mapped = await anilistToMal(anilistId);
    if (mapped) malId = mapped.malId;
  }
  return { anilistId, malId };
}

loadDB();

module.exports = { loadDB, malToAnilist, anilistToMal, resolveIds, getAnilistId, getMalId };
