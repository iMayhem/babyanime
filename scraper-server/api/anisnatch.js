const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Load ajax.min.js runtime helper
let xhrAjaxClient = null;

function initAniSnatchClient() {
    if (xhrAjaxClient) return xhrAjaxClient;

    const ajaxJsPath = path.join(__dirname, 'anisnatch_ajax.js');
    let ajaxCode = '';
    if (fs.existsSync(ajaxJsPath)) {
        ajaxCode = fs.readFileSync(ajaxJsPath, 'utf8');
    } else {
        // Fallback to /tmp if local missing
        ajaxCode = fs.readFileSync('/tmp/anisnatch_ajax.js', 'utf8');
    }

    const sandbox = {
        console: console,
        Math: Math,
        Date: Date,
        JSON: JSON,
        Uint8Array: Uint8Array,
        Array: Array,
        Buffer: Buffer,
        String: String,
        parseInt: parseInt,
        parseFloat: parseFloat,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
        atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
        accurateTime: () => Math.floor(Date.now() / 1000),
        pako: {
            ungzip: (bytes) => zlib.gunzipSync(Buffer.from(bytes)).toString('utf8')
        },
        XMLHttpRequest: class {
            constructor() {
                this.headers = {};
                this.response = null;
                this.status = 200;
            }
            open(method, url) {
                this.method = method;
                this.url = url;
            }
            setRequestHeader(k, v) {
                this.headers[k] = v;
            }
            async send(body) {
                try {
                    const res = await fetch(this.url, {
                        method: this.method,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': 'https://anisnatch.top/',
                            'Origin': 'https://anisnatch.top'
                        },
                        body: body
                    });
                    this.status = res.status;
                    this.response = await res.arrayBuffer();
                    if (this.onload) this.onload();
                } catch (e) {
                    if (this.onerror) this.onerror(e);
                }
            }
        }
    };

    sandbox.window = sandbox;
    sandbox.global = sandbox;

    const script = new (require('vm').Script)(ajaxCode);
    const ctx = new (require('vm').createContext)(sandbox);
    script.runInContext(ctx);

    xhrAjaxClient = ctx.xhrAjax;
    return xhrAjaxClient;
}

async function callAniSnatchApi(endpoint, payloadObj) {
    const xhrAjax = initAniSnatchClient();
    const url = `https://anisnatch.top/${endpoint}`;
    const payloadStr = JSON.stringify(payloadObj);
    const reqObj = xhrAjax(url, payloadStr);
    return await reqObj.promise;
}

// Fetch anime title from AniList by ID
async function getTitleFromAniList(anilistId) {
    try {
        const query = `{\n  Media(id: ${anilistId}, type: ANIME) {\n    title { romaji english }\n  }\n}`;
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await res.json();
        const titles = data?.data?.Media?.title;
        return titles?.english || titles?.romaji || null;
    } catch (e) {
        console.warn('[AniSnatch] AniList title fetch error:', e.message);
        return null;
    }
}

// Search AniSnatch for anime ID by title (or AniList ID match in results)
async function searchAnime(titleQuery, targetAnilistId = null) {
    try {
        const res = await callAniSnatchApi('api/search', { keyword: String(titleQuery), page: 1 });
        if (res && res.success && res.data && Array.isArray(res.data.anime)) {
            const list = res.data.anime;
            // Prefer exact AniList ID match
            if (targetAnilistId) {
                const match = list.find(item => String(item.al) === String(targetAnilistId));
                if (match) return match.id;
            }
            if (list.length > 0) return list[0].id;
        }
    } catch (e) {
        console.warn('[AniSnatch] search error:', e.message);
    }
    return null;
}

// Extract direct stream links from server objects
function parseServerSource(item) {
    if (!item || !item.source) return null;
    const src = item.source;
    const parts = src.split('/');
    const type = parts[0];
    const b64Data = parts[1];

    let url = null;
    let subtitles = [];

    try {
        if (type === 'vibeplayer') {
            // Decode base64 → vivibebe.site/<hash> embed URL
            const embedUrl = Buffer.from(b64Data, 'base64').toString('utf8');
            let embedTarget = embedUrl;
            if (embedTarget.includes('/sub=')) {
                const subParts = embedTarget.split('/sub=');
                embedTarget = subParts[0];
                subtitles.push({ language: 'English', url: decodeURIComponent(subParts[1]) });
            }
            // Convert embed URL to direct HLS: vivibebe.site/<hash> → vivibebe.site/public/stream/<hash>/master.m3u8
            const hashMatch = embedTarget.match(/vivibebe\.site\/([a-f0-9]+)$/i);
            if (hashMatch) {
                const hash = hashMatch[1];
                url = `https://vivibebe.site/public/stream/${hash}/master.m3u8`;
            } else {
                url = embedTarget;
            }
        } else if (type === 'kwik') {
            const decoded = Buffer.from(decodeURIComponent(b64Data), 'base64').toString('utf8');
            const kwikData = JSON.parse(decoded);
            url = kwikData['1080'] || kwikData['720'] || kwikData['360'] || Object.values(kwikData)[0];
        } else if (type === 'yt-mp4' || type === 'mp4' || type === 'ok') {
            url = `https://dl.anisnatch.top/${b64Data}`;
        }
    } catch (e) {}

    return { url, subtitles };
}

// Main getStreams implementation
async function getStreams(id, mediaType = 'tv', season = 1, episode = 1) {
    let cleanId = String(id || '');
    if (cleanId.startsWith('anilist:')) {
        cleanId = cleanId.replace('anilist:', '');
    }

    const epNum = parseInt(episode) || 1;

    try {
        let res = null;

        // If it's an AniList ID, resolve title first then search AniSnatch by title
        if (/^\d+$/.test(cleanId)) {
            console.log(`[AniSnatch] Resolving AniList ID ${cleanId} → title`);
            const title = await getTitleFromAniList(cleanId);
            console.log(`[AniSnatch] Title resolved: ${title}`);
            if (title) {
                const snatchId = await searchAnime(title, cleanId);
                console.log(`[AniSnatch] AniSnatch internal ID: ${snatchId}`);
                if (snatchId) {
                    res = await callAniSnatchApi('api/loadSVs', { id: parseInt(snatchId), ep: epNum });
                    console.log(`[AniSnatch] loadSVs success: ${res && res.success}`);
                }
            }
        }

        if (!res || !res.success || !res.server) {
            return [];
        }

        const streams = [];
        const servers = res.server;

        ['sub', 'soft-sub', 'dub'].forEach(subType => {
            if (Array.isArray(servers[subType])) {
                servers[subType].forEach(item => {
                    const parsed = parseServerSource(item);
                    if (parsed && parsed.url) {
                        streams.push({
                            name: `EREN ${item.title || item.server || 'Server'} (${subType.toUpperCase()})`,
                            title: item.title || 'Eren Stream',
                            url: parsed.url,
                            quality: item.title && item.title.includes('HD') ? '1080p' : 'Auto',
                            format: parsed.url.includes('.m3u8') ? 'hls' : 'mp4',
                            headers: { 'Referer': 'https://anisnatch.top/' },
                            subtitles: parsed.subtitles || [],
                            provider: 'Eren'
                        });
                    }
                });
            }
        });

        return streams;
    } catch (err) {
        console.error('[AniSnatch] getStreams Error:', err.message);
        return [];
    }
}

module.exports = { getStreams };
