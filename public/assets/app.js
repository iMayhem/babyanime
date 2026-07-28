// Theme Switcher
(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('theme');
  const currentTheme = savedTheme || 'light';
  root.setAttribute('data-theme', currentTheme);
  const savedClr = localStorage.getItem('clr');
  if (savedClr) root.setAttribute('data-clr', savedClr);
})();

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupMascot();
  setupHoldToSwap();
});

function setupTheme() {
  const root = document.documentElement;
  const themeBtn = document.getElementById('themeBtn');
  if (!themeBtn) return;

  themeBtn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}

// Animated Anime Sticker Card with Draggable functionality
function setupMascot() {
  const card = document.getElementById('stickerCard');
  const img  = document.getElementById('stickerImg');
  const lbl  = document.getElementById('stickerLabel');
  if (!card || !img) return;

  // Verified GIPHY transparent animated stickers
  const stickers = [
    { id: 'oXQA2xlxat5uW5qhzO', name: 'Hatsune Miku' },
    { id: 't12ZLwjimzf1RbRQB6', name: 'Nezuko' },
    { id: 'ugvKQ6MDlA1KAGbZIq', name: 'Anime Chibi' },
    { id: 'NyMaiJVuPmPKcYbbKd', name: 'Anime Girl' },
    { id: 'XJtM2nNFCzT3etvzOB', name: 'Kawaii' },
  ];

  let current = Math.floor(Math.random() * stickers.length);

  function loadSticker(idx) {
    const s = stickers[idx];
    img.style.opacity = '0';
    setTimeout(() => {
      img.src = `https://media.giphy.com/media/${s.id}/giphy.gif`;
      if (lbl) lbl.textContent = s.name;
      img.style.opacity = '1';
    }, 200);
  }

  // Load initial sticker
  loadSticker(current);

  // Auto-rotate every 30 seconds
  setInterval(() => {
    current = (current + 1) % stickers.length;
    loadSticker(current);
  }, 30000);

  // --- DRAGGABLE & CLICK SYSTEM ---
  card.style.pointerEvents = 'auto';
  card.style.cursor = 'grab';
  card.title = 'Drag to move anywhere • Click to change character';

  // Restore saved position from localStorage if exists
  const savedPos = localStorage.getItem('babyanime_mascot_pos');
  if (savedPos) {
    try {
      const pos = JSON.parse(savedPos);
      if (typeof pos.left === 'number' && typeof pos.top === 'number') {
        card.style.left = `${pos.left}px`;
        card.style.top = `${pos.top}px`;
        card.style.right = 'auto';
        card.style.bottom = 'auto';
        card.style.animation = 'none'; // disable float when custom placed
      }
    } catch (e) {}
  }

  let isDragging = false;
  let hasMoved = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  function onPointerDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    
    isDragging = true;
    hasMoved = false;

    const pageX = e.type.startsWith('touch') ? e.touches[0].pageX : e.pageX;
    const pageY = e.type.startsWith('touch') ? e.touches[0].pageY : e.pageY;

    startX = pageX;
    startY = pageY;

    const rect = card.getBoundingClientRect();
    initialLeft = rect.left + window.scrollX;
    initialTop = rect.top + window.scrollY;

    card.style.cursor = 'grabbing';
    card.style.transition = 'none';
    card.style.animation = 'none';

    document.addEventListener('mousemove', onPointerMove, { passive: false });
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  }

  function onPointerMove(e) {
    if (!isDragging) return;

    const pageX = e.type.startsWith('touch') ? e.touches[0].pageX : e.pageX;
    const pageY = e.type.startsWith('touch') ? e.touches[0].pageY : e.pageY;

    const deltaX = pageX - startX;
    const deltaY = pageY - startY;

    if (Math.hypot(deltaX, deltaY) > 4) {
      hasMoved = true;
      if (e.cancelable) e.preventDefault();
    }

    if (!hasMoved) return;

    let newLeft = initialLeft + deltaX - window.scrollX;
    let newTop = initialTop + deltaY - window.scrollY;

    const maxLeft = window.innerWidth - card.offsetWidth - 10;
    const maxTop = window.innerHeight - card.offsetHeight - 10;

    newLeft = Math.max(10, Math.min(newLeft, maxLeft));
    newTop = Math.max(10, Math.min(newTop, maxTop));

    card.style.left = `${newLeft}px`;
    card.style.top = `${newTop}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.position = 'fixed';
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    card.style.cursor = 'grab';

    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);

    if (hasMoved) {
      const rect = card.getBoundingClientRect();
      localStorage.setItem('babyanime_mascot_pos', JSON.stringify({
        left: rect.left,
        top: rect.top
      }));
    } else {
      current = (current + 1) % stickers.length;
      loadSticker(current);
    }
  }

  card.addEventListener('mousedown', onPointerDown);
  card.addEventListener('touchstart', onPointerDown, { passive: false });
}

// GraphQL Query Helper for AniList
const aniListCache = new Map();
const aniListInFlight = new Map();

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function queryAniList(query, variables) {
  const cacheKey = JSON.stringify({ query: hashStr(query), variables });
  const cacheVal = JSON.stringify({ query, variables });

  // L1: in-memory cache (10 min)
  const mem = aniListCache.get(cacheKey);
  if (mem && Date.now() - mem.ts < 600000) return mem.data;

  // L2: localStorage cache (24h)
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const ls = JSON.parse(raw);
      if (Date.now() - ls.ts < 86400000) {
        aniListCache.set(cacheKey, ls);
        return ls.data;
      }
      localStorage.removeItem(cacheKey);
    }
  } catch (_) {}

  // Dedup in-flight requests
  if (aniListInFlight.has(cacheKey)) return aniListInFlight.get(cacheKey);

  const promise = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        const response = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: cacheVal,
        });
        if (response.status === 429) { lastErr = new Error('429'); continue; }
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const result = await response.json();
        if (result.errors) throw new Error(result.errors[0].message);
        const entry = { data: result.data, ts: Date.now() };
        aniListCache.set(cacheKey, entry);
        try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch (_) {}
        return result.data;
      } catch (err) {
        lastErr = err;
        if (!err.message.includes('429')) break;
      }
    }
    throw lastErr;
  })();

  aniListInFlight.set(cacheKey, promise);
  promise.catch(() => {}).finally(() => aniListInFlight.delete(cacheKey));
  return promise;
}

// Fetch metadata from MAL (Jikan API v4) as a secondary fallback
async function fetchMALMetadata(malId) {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}`);
    if (!response.ok) {
      throw new Error(`Jikan HTTP Error: ${response.status}`);
    }
    const result = await response.json();
    return result.data;
  } catch (err) {
    console.error('Jikan API Error:', err);
    throw err;
  }
}

// LocalStorage helpers
const LIBRARY_KEYS = {
  BOOKMARKS: 'babyanime_bookmarks',
  HISTORY: 'babyanime_history'
};

function getBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEYS.BOOKMARKS)) || [];
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks) {
  localStorage.setItem(LIBRARY_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
}

function isBookmarked(id, type = 'anilist') {
  const bookmarks = getBookmarks();
  return bookmarks.some(b => b.id === String(id) && b.type === type);
}

function toggleBookmark(animeData) {
  let bookmarks = getBookmarks();
  const idStr = String(animeData.id);
  const type = animeData.type || 'anilist';
  
  if (isBookmarked(idStr, type)) {
    bookmarks = bookmarks.filter(b => !(b.id === idStr && b.type === type));
  } else {
    bookmarks.push({
      id: idStr,
      type: type,
      title: animeData.title,
      coverImage: animeData.coverImage,
      episodes: animeData.episodes,
      addedAt: Date.now()
    });
  }
  saveBookmarks(bookmarks);
  return isBookmarked(idStr, type);
}

function getWatchHistory() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEYS.HISTORY)) || [];
  } catch {
    return [];
  }
}

function saveWatchHistory(history) {
  localStorage.setItem(LIBRARY_KEYS.HISTORY, JSON.stringify(history));
}

function addToHistory(animeData, episode, percent = 0) {
  let history = getWatchHistory();
  const idStr = String(animeData.id);
  const type = animeData.type || 'anilist';
  
  // Remove existing entry for the same anime (to push to top)
  history = history.filter(h => !(h.id === idStr && h.type === type));
  
  history.unshift({
    id: idStr,
    type: type,
    title: animeData.title,
    coverImage: animeData.coverImage,
    episode: episode,
    percent: percent,
    updatedAt: Date.now()
  });
  
  // Cap history at 15 items
  if (history.length > 15) {
    history = history.slice(0, 15);
  }
  saveWatchHistory(history);
}

// UI render helpers
function createAnimeCardHTML(anime) {
  const id = anime.id || anime.idMal;
  const isMal = !!anime.idMal && !anime.id;
  const watchUrl = `/watch.html?${isMal ? 'mal_id' : 'id'}=${id}`;
  const titleText = anime.title.english || anime.title.romaji || anime.title.userPreferred || 'Unknown Title';
  const coverImg = anime.coverImage.large || anime.coverImage.medium || '';
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : (anime.score ? anime.score.toFixed(1) : null);
  const scoreBadge = score ? `<div class="score-badge">★ ${score}</div>` : '';
  const formatText = anime.format || anime.type || '';
  const typeBadge = formatText ? `<div class="type-badge">${formatText}</div>` : '';
  const yearText = anime.seasonYear || (anime.aired && anime.aired.prop && anime.aired.prop.from && anime.aired.prop.from.year) || '';
  const epsCount = anime.episodes || (anime.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : null);
  const epsText = epsCount ? `${epsCount} Ep` : '';
  const metaText = [yearText, epsText].filter(Boolean).join(' · ');

  const fallbackSvg = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22150%22 viewBox=%220 0 100 150%22><rect width=%22100%22 height=%22150%22 fill=%22%23262e42%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23939db4%22 font-size=%2212%22>No Cover</text></svg>';
  return `
    <a href="${watchUrl}" class="anime-card-link">
    <div class="anime-card">
      <div class="anime-poster-wrap">
        ${scoreBadge}
        ${typeBadge}
        <img class="anime-poster" src="${coverImg}" alt="${titleText}" loading="lazy" onerror="this.src='${fallbackSvg}'">
      </div>
      <div class="anime-info">
        <h3 class="anime-title" title="${titleText}">${titleText}</h3>
        <div class="anime-meta">${metaText}</div>
      </div>
    </div>
    </a>
  `;
}

// ============================================
// Supabase Auth & Data Layer
// ============================================
const SUPABASE_URL = 'https://mdrnjwljpbmfhttadwxj.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kcm5qd2xqcGJtZmh0dGFkd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDk5NzcsImV4cCI6MjEwMDgyNTk3N30.jHFqFNI288mw5v-l2r8HSXOMXkfSj362HJxXedK7DE4';

let _sb = null;
let _currentUser = null;
let _authReady = false;
const _authCallbacks = [];

function sbClient() {
  if (!_sb && typeof supabase !== 'undefined') _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _sb;
}

function sbReady() { return !!_sb; }

async function initAuth() {
  const sb = sbClient();
  if (!sb) { setTimeout(initAuth, 300); return; }
  const stored = localStorage.getItem('ba_user');
  if (stored) {
    try { _currentUser = JSON.parse(stored); } catch {}
  }
  _authReady = true;
  _authCallbacks.forEach(cb => cb(_currentUser, 'INIT'));
}

function onAuth(cb) { _authCallbacks.push(cb); if (_authReady) cb(_currentUser, 'INIT'); }

function getCurrentUser() { return _currentUser; }

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signUp(username, password) {
  const sb = sbClient(); if (!sb) return { error: 'Supabase not ready' };
  if (password.length < 6) return { error: { message: 'Password must be at least 6 characters' } };
  if (username.length < 3) return { error: { message: 'Username must be at least 3 characters' } };
  const password_hash = await hashPassword(password);
  try {
    const { data, error } = await sb.from('users').insert({ username, password_hash }).select('id, username, created_at').single();
    if (error) {
      if (error.code === '23505') return { error: { message: 'Username already taken' } };
      return { error: { message: error.message } };
    }
    _currentUser = data;
    localStorage.setItem('ba_user', JSON.stringify(data));
    _authCallbacks.forEach(cb => cb(_currentUser, 'SIGNED_IN'));
    syncLocalToRemote();
    return { data: { user: data, session: true } };
  } catch (err) {
    return { error: { message: 'Something went wrong' } };
  }
}

async function signIn(username, password) {
  const sb = sbClient(); if (!sb) return { error: 'Supabase not ready' };
  const password_hash = await hashPassword(password);
  try {
    const { data, error } = await sb.from('users').select('id, username, created_at').eq('username', username).eq('password_hash', password_hash).maybeSingle();
    if (error) return { error: { message: error.message } };
    if (!data) return { error: { message: 'Invalid username or password' } };
    _currentUser = data;
    localStorage.setItem('ba_user', JSON.stringify(data));
    _authCallbacks.forEach(cb => cb(_currentUser, 'SIGNED_IN'));
    syncLocalToRemote();
    return { data: { user: data, session: true } };
  } catch (err) {
    return { error: { message: 'Something went wrong' } };
  }
}

async function signOut() {
  _currentUser = null;
  localStorage.removeItem('ba_user');
  _authCallbacks.forEach(cb => cb(null, 'SIGNED_OUT'));
}

async function syncLocalToRemote() {
  if (!_currentUser) return;
  const sb = sbClient(); if (!sb) return;
  const uid = _currentUser.id;
  try {
    const bm = JSON.parse(localStorage.getItem('babyanime_bookmarks') || '[]');
    for (const b of bm) {
      await sb.from('bookmarks').upsert({ user_id: uid, anime_id: String(b.id), title: b.title, cover_image: b.coverImage, type: b.type || 'anilist' }, { onConflict: 'user_id,anime_id' }).then(() => {}).catch(() => {});
    }
  } catch(e) {}
  try {
    const hx = JSON.parse(localStorage.getItem('babyanime_history') || '[]');
    for (const h of hx) {
      await sb.from('watch_history').upsert({ user_id: uid, anime_id: String(h.id), episode: h.episode, title: h.title, cover_image: h.coverImage, type: h.type || 'anilist' }, { onConflict: 'user_id,anime_id,episode' }).then(() => {}).catch(() => {});
    }
  } catch(e) {}
}

async function fetchRemoteBookmarks() {
  if (!_currentUser) return null;
  const sb = sbClient(); if (!sb) return null;
  try {
    const { data } = await sb.from('bookmarks').select('*').eq('user_id', _currentUser.id);
    if (data) return data.map(b => ({
      id: b.anime_id, type: b.type || 'anilist', title: b.title, coverImage: b.cover_image, episodes: null, addedAt: new Date(b.created_at).getTime()
    }));
  } catch(e) {}
  return null;
}

async function fetchRemoteHistory() {
  if (!_currentUser) return null;
  const sb = sbClient(); if (!sb) return null;
  try {
    const { data } = await sb.from('watch_history').select('*').eq('user_id', _currentUser.id).order('updated_at', { ascending: false }).limit(15);
    if (data) return data.map(h => ({
      id: h.anime_id, type: h.type || 'anilist', title: h.title, coverImage: h.cover_image, episode: h.episode, percent: 0, updatedAt: new Date(h.updated_at).getTime()
    }));
  } catch(e) {}
  return null;
}

// Override bookmark/history functions to sync with Supabase
(function() {
  const _origToggle = window.toggleBookmark;
  const _origAddHistory = window.addToHistory;
  const _origGetBookmarks = window.getBookmarks;
  const _origGetHistory = window.getWatchHistory;

  window.getBookmarks = function() {
    return _origGetBookmarks ? _origGetBookmarks() : (() => { try { return JSON.parse(localStorage.getItem('babyanime_bookmarks')) || []; } catch { return []; } })();
  };

  window.getWatchHistory = function() {
    return _origGetHistory ? _origGetHistory() : (() => { try { return JSON.parse(localStorage.getItem('babyanime_history')) || []; } catch { return []; } })();
  };

  window.toggleBookmark = function(animeData) {
    const result = _origToggle ? _origToggle(animeData) : (() => { /* fallback */ return false; })();
    if (_currentUser) {
      const idStr = String(animeData.id);
      const type = animeData.type || 'anilist';
      const sb = sbClient();
      if (sb) {
        if (result) {
          const title = typeof animeData.title === 'object' ? (animeData.title.english || animeData.title.romaji || '') : animeData.title;
          const cover = typeof animeData.coverImage === 'object' ? (animeData.coverImage.large || '') : animeData.coverImage;
          sb.from('bookmarks').upsert({ user_id: _currentUser.id, anime_id: idStr, title, cover_image: cover, type }, { onConflict: 'user_id,anime_id' }).then(() => {}).catch(() => {});
        } else {
          sb.from('bookmarks').delete().eq('user_id', _currentUser.id).eq('anime_id', idStr).then(() => {}).catch(() => {});
        }
      }
    }
    return result;
  };

  window.addToHistory = function(animeData, episode, percent) {
    if (_origAddHistory) _origAddHistory(animeData, episode, percent);
    if (_currentUser) {
      const idStr = String(animeData.id);
      const sb = sbClient();
      if (sb) {
        const title = typeof animeData.title === 'object' ? (animeData.title.english || animeData.title.romaji || '') : animeData.title;
        const cover = typeof animeData.coverImage === 'object' ? (animeData.coverImage.large || '') : animeData.coverImage;
        sb.from('watch_history').upsert({ user_id: _currentUser.id, anime_id: idStr, episode, title, cover_image: cover, type: animeData.type || 'anilist' }, { onConflict: 'user_id,anime_id,episode' }).then(() => {}).catch(() => {});
      }
    }
  };
})();

// ============================================
// Anime character names for watch-together
// ============================================
const ANIME_CHARACTERS = [
  'Naruto Uzumaki', 'Sasuke Uchiha', 'Sakura Haruno', 'Kakashi Hatake', 'Hinata Hyuga',
  'Monkey D. Luffy', 'Roronoa Zoro', 'Nami', 'Sanji', 'Tony Tony Chopper', 'Jimbei',
  'Ichigo Kurosaki', 'Rukia Kuchiki', 'Orihime Inoue', 'Uryu Ishida',
  'Son Goku', 'Vegeta', 'Piccolo', 'Gohan', 'Bulma',
  'Eren Yeager', 'Mikasa Ackerman', 'Levi Ackerman', 'Armin Arlert',
  'Tanjiro Kamado', 'Nezuko Kamado', 'Zenitsu Agatsuma', 'Inosuke Hashibira', 'Giyu Tomioka',
  'Edward Elric', 'Alphonse Elric', 'Roy Mustang', 'Winry Rockbell',
  'Light Yagami', 'L Lawliet', 'Misa Misa', 'Near',
  'Gon Freecss', 'Killua Zoldyck', 'Kurapika', 'Leorio Paradinight', 'Hisoka',
  'Yuji Itadori', 'Megumi Fushiguro', 'Nobara Kugisaki', 'Satoru Gojo',
  'Izuku Midoriya', 'Katsuki Bakugo', 'Shoto Todoroki', 'All Might', 'Ochaco Uraraka',
  'Lelouch Lamperouge', 'C.C.', 'Suzaku Kururugi', 'Kallen Stadtfeld',
  'Spike Spiegel', 'Faye Valentine', 'Jet Black', 'Ein',
  'Saitama', 'Genos', 'Fubuki', 'King',
  'Jotaro Kujo', 'Dio Brando', 'Joseph Joestar', 'Kakyoin',
  'Simon', 'Kamina', 'Yoko Littner', 'Viral',
  'Kirito', 'Asuna Yuuki', 'Leafa', 'Sinon',
  'Senku Ishigami', 'Kohaku', 'Gen Asagiri', 'Chrome',
  'Koro-sensei', 'Nagisa Shiota', 'Karma Akabane',
  'Touma Kamijou', 'Index', 'Accelerator',
  'Shinji Ikari', 'Rei Ayanami', 'Asuka Langley', 'Misato Katsuragi',
  'Guts', 'Griffith', 'Casca',
  'Alucard', 'Seras Victoria', 'Integra Hellsing',
  'Vash the Stampede', 'Nicholas D. Wolfwood', 'Meryl Stryfe',
  'Kenshin Himura', 'Kaoru Kamiya', 'Sanosuke Sagara',
  'Holo', 'Lawrence Craft',
  'Mob', 'Reigen Arataka',
];

function getRandomAnimeName() {
  const stored = sessionStorage.getItem('babyanime_party_name');
  if (stored) return stored;
  const name = ANIME_CHARACTERS[Math.floor(Math.random() * ANIME_CHARACTERS.length)];
  sessionStorage.setItem('babyanime_party_name', name);
  return name;
}

// --- TAP-TO-SELECT & TAP-TO-SWAP LAYOUT ENGINE ---
function setupHoldToSwap() {
  const oldControls = document.getElementById('layoutControlWrap');
  if (oldControls) oldControls.remove();
  document.querySelectorAll('.panel-drag-handle').forEach(h => h.remove());

  let selectedElem = null;
  let holdTimer = null;
  let preventNextClick = false;

  // Restore saved CSS order for main layout containers on load
  document.querySelectorAll('.schedule-sidebar, .watch-container, .sidebar-column, .home-layout, .rooms-grid, .shelves-container, .toggles').forEach(container => {
    const containerId = container.id || container.className.split(' ')[0];
    const savedMap = localStorage.getItem('babyanime_order_map_' + containerId);
    if (savedMap) {
      try {
        const orderMap = JSON.parse(savedMap);
        Array.from(container.children).forEach((child, idx) => {
          const id = child.id || `${containerId}_item_${idx}`;
          if (orderMap[id] !== undefined) {
            child.style.order = orderMap[id];
          }
        });
      } catch (err) {}
    }
  });

  // Intercept click event on document if a swap tap just completed
  document.addEventListener('click', (e) => {
    if (preventNextClick) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      preventNextClick = false;
      return false;
    }
  }, true);

  function getSwappableItem(target) {
    if (!target) return null;
    const tag = target.tagName.toLowerCase();
    if (['input', 'select', 'textarea', 'option'].includes(tag)) return null;
    if (target.closest('input, select, textarea, .clr-dot, .schedule-tab-btn')) return null;

    return target.closest('.card, .anime-card, .shelf-item, .ep-btn, .pill-opt, .genre-tag, .room-card, .airing-card, .player-column, .sidebar-column, .airing-sidebar, .details-box, .episodes-panel, .selector-section, .tab-btn, .tt, .player-wrapper, .player-card, #playerContainer');
  }

  function clearSelection() {
    if (selectedElem) {
      selectedElem.classList.remove('panel-selected-active');
      selectedElem = null;
    }
  }

  function onPointerDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;

    const item = getSwappableItem(e.target);
    if (!item || !item.parentNode) {
      clearSelection();
      return;
    }

    const container = item.parentNode;
    if (container.children.length < 2) return;

    // Initialize CSS order for siblings if missing
    Array.from(container.children).forEach((child, idx) => {
      if (!child.style.order) {
        child.style.order = idx;
      }
    });

    // If an item is already selected
    if (selectedElem) {
      if (selectedElem === item) {
        // Tapped same item -> Deselect
        clearSelection();
        preventNextClick = true;
        return;
      }

      // Check if elements share same parent OR can swap top-level grid columns
      let itemA = selectedElem;
      let itemB = item;

      if (itemA.parentNode !== itemB.parentNode) {
        const topParentA = itemA.closest('.watch-container, .home-layout, .layout-container');
        const topParentB = itemB.closest('.watch-container, .home-layout, .layout-container');
        if (topParentA && topParentA === topParentB) {
          itemA = Array.from(topParentA.children).find(c => c.contains(selectedElem));
          itemB = Array.from(topParentA.children).find(c => c.contains(item));
        }
      }

      if (itemA && itemB && itemA !== itemB && itemA.parentNode === itemB.parentNode) {
        const swapContainer = itemA.parentNode;
        Array.from(swapContainer.children).forEach((c, idx) => {
          if (!c.style.order) c.style.order = idx;
        });

        const orderA = parseInt(itemA.style.order || 0);
        const orderB = parseInt(itemB.style.order || 0);

        itemA.style.order = orderB;
        itemB.style.order = orderA;

        // Save layout order map
        const containerId = swapContainer.id || swapContainer.className.split(' ')[0];
        const orderMap = {};
        Array.from(swapContainer.children).forEach((c, idx) => {
          const id = c.id || `${containerId}_item_${idx}`;
          orderMap[id] = c.style.order;
        });
        localStorage.setItem('babyanime_order_map_' + containerId, JSON.stringify(orderMap));

        clearSelection();
        preventNextClick = true;
        if (navigator.vibrate) navigator.vibrate(40);
        return;
      } else {
        // Tapped item in unrelated container -> Switch selection
        clearSelection();
      }
    }

    // Press & hold (160ms) to select
    holdTimer = setTimeout(() => {
      selectedElem = item;
      selectedElem.classList.add('panel-selected-active');
      if (navigator.vibrate) navigator.vibrate(30);
      preventNextClick = true;
    }, 160);

    function cancelHoldTimer() {
      if (holdTimer) clearTimeout(holdTimer);
      document.removeEventListener('mouseup', cancelHoldTimer);
      document.removeEventListener('touchend', cancelHoldTimer);
    }

    document.addEventListener('mouseup', cancelHoldTimer);
    document.addEventListener('touchend', cancelHoldTimer);
  }

  document.addEventListener('mousedown', onPointerDown);
  document.addEventListener('touchstart', onPointerDown, { passive: false });
}
