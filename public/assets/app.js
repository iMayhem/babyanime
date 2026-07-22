// Theme Switcher
(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('theme');
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const currentTheme = savedTheme || (systemDark ? 'dark' : 'light');
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
  const epsCount = anime.episodes || (anime.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : null);
  const epsText = epsCount ? `${epsCount} Ep` : '';
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

// --- SEAMLESS CSS-ORDER HOLD-TO-SWAP ENGINE (NO BUFFERING / NO FLICKER) ---
function setupHoldToSwap() {
  const oldControls = document.getElementById('layoutControlWrap');
  if (oldControls) oldControls.remove();
  document.querySelectorAll('.panel-drag-handle').forEach(h => h.remove());

  let holdTimer = null;
  let isSwapping = false;
  let draggedElem = null;
  let parentContainer = null;
  let startX = 0, startY = 0;
  let preventNextClick = false;
  let lastSwapTime = 0;
  let lastSwappedTarget = null;

  // Intercept click event on document if we just completed a swap
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
    if (['input', 'select', 'textarea', 'option', 'iframe'].includes(tag)) return null;
    if (target.closest('input, select, textarea, iframe')) return null;

    return target.closest('.card, .anime-card, .shelf-item, .ep-btn, .pill-opt, .genre-tag, .room-card, .airing-card, .player-column, .sidebar-column, .airing-sidebar, .details-box, .episodes-panel, .selector-section');
  }

  function onPointerDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;

    const item = getSwappableItem(e.target);
    if (!item || !item.parentNode) return;

    const container = item.parentNode;
    if (container.children.length < 2) return;

    const pageX = e.type.startsWith('touch') ? e.touches[0].pageX : e.pageX;
    const pageY = e.type.startsWith('touch') ? e.touches[0].pageY : e.pageY;

    startX = pageX;
    startY = pageY;

    // Restore saved order if exists
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

    // Initialize CSS order for siblings if missing
    Array.from(container.children).forEach((child, idx) => {
      if (!child.style.order) {
        child.style.order = idx;
      }
    });

    holdTimer = setTimeout(() => {
      isSwapping = true;
      preventNextClick = true;
      draggedElem = item;
      parentContainer = container;

      draggedElem.classList.add('panel-swapping-active');
      if (navigator.vibrate) navigator.vibrate(35);

      document.addEventListener('mousemove', onPointerMove, { passive: false });
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
    }, 180);

    document.addEventListener('mouseup', cancelHold);
    document.addEventListener('touchend', cancelHold);
    document.addEventListener('mousemove', checkEarlyCancel);
    document.addEventListener('touchmove', checkEarlyCancel);
  }

  function checkEarlyCancel(e) {
    if (isSwapping) return;
    const pageX = e.type.startsWith('touch') ? e.touches[0].pageX : e.pageX;
    const pageY = e.type.startsWith('touch') ? e.touches[0].pageY : e.pageY;
    if (Math.hypot(pageX - startX, pageY - startY) > 8) {
      cancelHold();
    }
  }

  function cancelHold() {
    if (holdTimer) clearTimeout(holdTimer);
    document.removeEventListener('mouseup', cancelHold);
    document.removeEventListener('touchend', cancelHold);
    document.removeEventListener('mousemove', checkEarlyCancel);
    document.removeEventListener('touchmove', checkEarlyCancel);
  }

  function onPointerMove(e) {
    if (!isSwapping || !draggedElem || !parentContainer) return;
    if (e.cancelable) e.preventDefault();

    const now = Date.now();
    if (now - lastSwapTime < 220) return;

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

    draggedElem.style.pointerEvents = 'none';
    const targetUnder = document.elementFromPoint(clientX, clientY);
    draggedElem.style.pointerEvents = '';

    if (!targetUnder) return;

    const targetItem = targetUnder.closest('.card, .anime-card, .shelf-item, .ep-btn, .pill-opt, .genre-tag, .room-card, .airing-card, .player-column, .sidebar-column, .airing-sidebar, .details-box, .episodes-panel, .selector-section');

    if (targetItem && targetItem !== draggedElem && targetItem.parentNode === parentContainer && targetItem !== lastSwappedTarget) {
      const draggedOrder = parseInt(draggedElem.style.order || 0);
      const targetOrder = parseInt(targetItem.style.order || 0);

      draggedElem.style.order = targetOrder;
      targetItem.style.order = draggedOrder;

      lastSwappedTarget = targetItem;
      lastSwapTime = now;
    }
  }

  function onPointerUp(e) {
    cancelHold();
    if (!isSwapping) return;
    isSwapping = false;

    if (draggedElem) {
      draggedElem.classList.remove('panel-swapping-active');
      draggedElem = null;
    }

    lastSwappedTarget = null;

    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);

    if (parentContainer) {
      const containerId = parentContainer.id || parentContainer.className.split(' ')[0];
      const orderMap = {};
      Array.from(parentContainer.children).forEach((c, idx) => {
        const id = c.id || `${containerId}_item_${idx}`;
        orderMap[id] = c.style.order;
      });
      localStorage.setItem('babyanime_order_map_' + containerId, JSON.stringify(orderMap));
    }

    setTimeout(() => {
      preventNextClick = false;
    }, 120);
  }

  document.addEventListener('mousedown', onPointerDown);
  document.addEventListener('touchstart', onPointerDown, { passive: false });
}
