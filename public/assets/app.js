// Theme Switcher
(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('theme');
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const currentTheme = savedTheme || (systemDark ? 'dark' : 'light');
  root.setAttribute('data-theme', currentTheme);
})();

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupMascot();
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

// Animated Anime Sticker Card
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
    // Fade out
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px) scale(0.92)';
    setTimeout(() => {
      img.src = `https://media.giphy.com/media/${s.id}/giphy.gif`;
      if (lbl) lbl.textContent = s.name;
      // Fade back in
      card.style.opacity = '1';
      card.style.transform = 'translateY(0) scale(1)';
    }, 350);
  }

  // Load initial sticker
  loadSticker(current);

  // Auto-rotate every 30 seconds
  setInterval(() => {
    current = (current + 1) % stickers.length;
    loadSticker(current);
  }, 30000);

  // Click to cycle manually
  card.style.pointerEvents = 'auto';
  card.style.cursor = 'pointer';
  card.title = 'Click to change character';
  card.addEventListener('click', () => {
    current = (current + 1) % stickers.length;
    loadSticker(current);
  });
}

// GraphQL Query Helper for AniList
async function queryAniList(query, variables) {
  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    const result = await response.json();
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  } catch (err) {
    console.error('AniList API Error:', err);
    throw err;
  }
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
  const epsText = anime.episodes ? `${anime.episodes} Ep` : '';
  const metaText = [yearText, epsText].filter(Boolean).join(' · ');

  return `
    <div class="anime-card" onclick="window.location.href='${watchUrl}'">
      <div class="anime-poster-wrap">
        ${scoreBadge}
        ${typeBadge}
        <img class="anime-poster" src="${coverImg}" alt="${titleText}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22150%22 viewBox=%220 0 100 150%22><rect width=%22100%22 height=%22150%22 fill=%22%23262e42%22/><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23939db4%22 font-family=%22sans-serif%22 font-size=%2212%22>No Cover</text></svg>'">
      </div>
      <div class="anime-info">
        <h3 class="anime-title" title="${titleText}">${titleText}</h3>
        <div class="anime-meta">${metaText}</div>
      </div>
    </div>
  `;
}
