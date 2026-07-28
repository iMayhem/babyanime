const TMDB_API_KEY = process.env.TMDB_API_KEY || "1865f43a0549ca50d341dd9ab8b29f49";
const offlineDb = require("./offline-db");

const ANILIST_URL = "https://graphql.anilist.co";
const ANILIST_MEDIA_QUERY = `
  query ($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      id
      idMal
      format
      episodes
      status
      title { romaji english }
      startDate { year month day }
      seasonYear
    }
  }
`;

async function anilistGraphQL(query, variables) {
  const resp = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`AniList HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

async function searchTmdbByTitle(title, type, year) {
  const searchType = type === "movie" ? "movie" : "tv";
  let url = `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(title)}&api_key=${TMDB_API_KEY}`;
  if (year) url += `&year=${year}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.results && data.results.length > 0) {
      for (const r of data.results) {
        const rYear = (r.release_date || r.first_air_date || "").split("-")[0];
        if (year && rYear && rYear === String(year)) return r;
      }
      return data.results[0];
    }
  } catch {}
  return null;
}

async function resolve(input) {
  let anilistId = input.anilist_id ? parseInt(input.anilist_id) : null;
  let malId = input.mal_id ? parseInt(input.mal_id) : null;
  let season = parseInt(input.season) || 1;
  let episode = parseInt(input.ep) || 1;

  if (!anilistId && !malId) {
    throw new Error("Provide either anilist_id or mal_id");
  }

  // Resolve IDs via offline DB first (no API call)
  if (malId && !anilistId) {
    const mapped = await offlineDb.malToAnilist(malId);
    if (mapped) anilistId = mapped.id;
  }
  if (anilistId && !malId) {
    const mapped = await offlineDb.anilistToMal(anilistId);
    if (mapped) malId = mapped.malId;
  }

  // Fetch metadata from AniList (single call using whichever ID we have)
  let anilistMeta = null;
  if (anilistId) {
    try {
      const data = await anilistGraphQL(ANILIST_MEDIA_QUERY, { id: anilistId });
      if (data && data.Media) {
        anilistMeta = data.Media;
        malId = malId || anilistMeta.idMal;
      }
    } catch {}
  }

  const type = anilistMeta
    ? ["MOVIE", "ONE_SHOT"].includes(anilistMeta.format) ? "movie" : "tv"
    : input.type || "tv";

  let tmdbId = null;
  let tmdbMeta = null;

  if (anilistMeta) {
    const title = anilistMeta.title.english || anilistMeta.title.romaji || "";
    const year = anilistMeta.seasonYear || (anilistMeta.startDate ? anilistMeta.startDate.year : null);

    tmdbMeta = await searchTmdbByTitle(title, type, year);
    if (!tmdbMeta) {
      const altTitle = anilistMeta.title.romaji || anilistMeta.title.english || "";
      if (altTitle !== title) {
        tmdbMeta = await searchTmdbByTitle(altTitle, type, year);
      }
    }

    if (!tmdbMeta) {
      const stripped = title.replace(/[\s-]+(?:Season|Part|Cour|Arc|S)\s*\d+/i, "").trim();
      if (stripped && stripped !== title) {
        tmdbMeta = await searchTmdbByTitle(stripped, type, year);
      }
    }

    if (!tmdbMeta) {
      const strippedAlt = (anilistMeta.title.romaji || anilistMeta.title.english || "").replace(/[\s-]+(?:Season|Part|Cour|Arc|S)\s*\d+/i, "").trim();
      if (strippedAlt && strippedAlt !== (anilistMeta.title.romaji || anilistMeta.title.english || "") && strippedAlt !== title) {
        tmdbMeta = await searchTmdbByTitle(strippedAlt, type, year);
      }
    }

    if (!tmdbMeta) {
      const strippedNoYear = title.replace(/[\s-]+(?:Season|Part|Cour|Arc|S)\s*\d+/i, "").trim();
      if (strippedNoYear) {
        tmdbMeta = await searchTmdbByTitle(strippedNoYear, type, null);
      }
    }

    if (!tmdbMeta) {
      const altNoYear = (anilistMeta.title.romaji || anilistMeta.title.english || "").replace(/[\s-]+(?:Season|Part|Cour|Arc|S)\s*\d+/i, "").trim();
      if (altNoYear && altNoYear !== strippedNoYear) {
        tmdbMeta = await searchTmdbByTitle(altNoYear, type, null);
      }
    }

    if (tmdbMeta) tmdbId = tmdbMeta.id;
  }

  if (!tmdbId && malId) {
    try {
      const resp = await fetch(
        `https://api.themoviedb.org/3/find/${malId}?external_source=anime_mal_id&api_key=${TMDB_API_KEY}`
      );
      if (resp.ok) {
        const data = await resp.json();
        const results = data.tv_results || data.movie_results || [];
        if (results.length > 0) {
          tmdbId = results[0].id;
          tmdbMeta = results[0];
        }
      }
    } catch {}
  }

  const title = anilistMeta
    ? anilistMeta.title.english || anilistMeta.title.romaji || "Unknown"
    : "Unknown";

  return {
    anilistId,
    malId,
    tmdbId,
    type,
    season,
    episode,
    title,
    format: anilistMeta ? anilistMeta.format : null,
  };
}

module.exports = { resolve };
