import base64, json, gzip, os
from curl_cffi.requests import AsyncSession
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

app = FastAPI(title="arceus", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ANILIST_URL = "https://graphql.anilist.co"
MIRURO_PIPE_URL = "https://www.miruro.tv/api/secure/pipe"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    "Referer": "https://www.miruro.tv/",
    "Origin": "https://www.miruro.tv",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "sec-ch-ua": '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

MEDIA_LIST_FIELDS = """
    id
    title { romaji english native }
    coverImage { large extraLarge }
    bannerImage
    format
    season
    seasonYear
    episodes
    duration
    status
    averageScore
    meanScore
    popularity
    favourites
    trending
    genres
    countryOfOrigin
    isAdult
    nextAiringEpisode { episode airingAt timeUntilAiring }
"""

def _decode_pipe_response(encoded_str: str) -> dict:
    encoded_str += '=' * (4 - len(encoded_str) % 4)
    compressed = base64.urlsafe_b64decode(encoded_str)
    return json.loads(gzip.decompress(compressed).decode('utf-8'))

def _encode_pipe_request(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')

async def _anilist_query(query: str, variables: dict = None):
    async with AsyncSession(impersonate="chrome110") as client:
        res = await client.post(ANILIST_URL, json={"query": query, "variables": variables or {}})
        if res.status_code != 200:
            raise HTTPException(status_code=500, detail="AniList query failed")
        return res.json().get("data", {})

async def _pipe_request(path: str, query_params: dict) -> dict:
    payload = {
        "path": path,
        "method": "GET",
        "query": query_params,
        "body": None,
        "version": "0.1.0",
    }
    encoded_req = _encode_pipe_request(payload)
    async with AsyncSession(impersonate="chrome110") as client:
        res = await client.get(f"{MIRURO_PIPE_URL}?e={encoded_req}", headers=HEADERS)
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=f"Pipe error: {res.text[:500]}")
        return _decode_pipe_response(res.text.strip())

# ----- AniList endpoints -----

@app.get("/search")
async def search_anime(query: str, page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=50)):
    gql = f"""
    query ($search: String, $page: Int, $perPage: Int) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage perPage }}
            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {{
                {MEDIA_LIST_FIELDS}
            }}
        }}
    }}
    """
    data = await _anilist_query(gql, {"search": query, "page": page, "perPage": per_page})
    page_data = data.get("Page", {})
    page_info = page_data.get("pageInfo", {})
    return {
        "page": page_info.get("currentPage", page),
        "perPage": page_info.get("perPage", per_page),
        "total": page_info.get("total", 0),
        "hasNextPage": page_info.get("hasNextPage", False),
        "results": page_data.get("media", []),
    }

@app.get("/info/{anilist_id}")
async def get_anime_info(anilist_id: int):
    gql = f"""
    query ($id: Int) {{
        Media(id: $id, type: ANIME) {{
            {MEDIA_LIST_FIELDS}
        }}
    }}
    """
    data = await _anilist_query(gql, {"id": anilist_id})
    media = data.get("Media")
    if not media:
        raise HTTPException(status_code=404, detail="Anime not found")
    return media

# ----- Miruro pipe endpoints -----

@app.get("/episodes/{anilist_id}")
async def get_episodes(anilist_id: int):
    return await _pipe_request("episodes", {"anilistId": anilist_id})

@app.get("/sources")
async def get_sources(
    episodeId: str = Query(...),
    provider: str = Query(...),
    anilistId: int = Query(...),
    category: str = Query("sub"),
):
    enc_id = base64.urlsafe_b64encode(episodeId.encode()).decode().rstrip('=')
    return await _pipe_request("sources", {
        "episodeId": enc_id,
        "provider": provider,
        "category": category,
        "anilistId": anilistId,
    })

@app.get("/stream")
async def get_stream(
    anilist_id: int = Query(...),
    ep: int = Query(1),
    audio: str = Query("sub"),
    prefer_provider: Optional[str] = Query(None),
):
    episodes_data = await _pipe_request("episodes", {"anilistId": anilist_id})
    providers = episodes_data.get("providers", {})

    prov_order = ["kiwi", "zoro", "arc", "hop", "telli"]
    if prefer_provider and prefer_provider in providers:
        prov_order.insert(0, prefer_provider)

    for prov in prov_order:
        prov_data = providers.get(prov)
        if not prov_data:
            continue
        ep_list = prov_data.get("episodes", {}).get(audio, [])
        if not ep_list:
            ep_list = prov_data.get("episodes", {}).get("sub", [])
        if not ep_list:
            continue

        target = None
        for e in ep_list:
            if e.get("number") == ep:
                target = e
                break
        if not target:
            continue

        episode_id = target["id"]
        enc_id = base64.urlsafe_b64encode(episode_id.encode()).decode().rstrip('=')
        sources_data = await _pipe_request("sources", {
            "episodeId": enc_id,
            "provider": prov,
            "category": audio,
            "anilistId": anilist_id,
        })

        streams = sources_data.get("streams", [])
        if streams:
            result = {
                "provider": prov,
                "episode_id": episode_id,
                "streams": streams,
                "subtitles": sources_data.get("subtitles", []),
                "intro": sources_data.get("intro"),
                "outro": sources_data.get("outro"),
            }
            return result

    raise HTTPException(status_code=404, detail="No stream found")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "arceus"}
