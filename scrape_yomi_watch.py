"""Scrape yomi.to watch page - capture video source & API calls"""
import asyncio
import json
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium',
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        )
        page = await context.new_page()

        api_calls = []
        video_urls = set()

        def on_request(req):
            url = req.url
            # Log interesting requests
            if any(x in url for x in ['/api/', '/watch/', 'm3u8', '.mp4', 'vidplay', 'mycloud', 'gcloud', 'yomi.to']):
                if 'google' not in url and 'facebook' not in url:
                    API_CALLS.append({
                        'method': req.method,
                        'url': url,
                        'headers': dict(req.headers),
                    })
                    print(f">>> [{req.method}] {url[:150]}")
                    for k in ['referer', 'origin', 'x-requested-with', 'content-type']:
                        if req.headers.get(k):
                            print(f"    {k}: {req.headers[k]}")
            if any(x in url for x in ['m3u8', '.mp4', 'master', 'playlist']):
                video_urls.add(url)
                print(f"  *** VIDEO URL: {url}")

        page.on('request', on_request)

        url = 'https://yomi.to/watch/21/1'
        print(f"[*] Loading {url}")
        await page.goto(url, wait_until='networkidle', timeout=30000)
        await asyncio.sleep(5)

        title = await page.title()
        print(f"\n[*] Title: {title}")

        # Get rendered content
        body = await page.evaluate('document.body.innerText')
        print(f"[*] Body (first 800): {body[:800] if body else 'None'}")

        # Check for video element
        vid = await page.evaluate("""() => {
            const v = document.querySelector('video');
            if (!v) return null;
            return {
                src: v.src,
                currentSrc: v.currentSrc,
                poster: v.poster,
            };
        }""")
        print(f"[*] Video element: {json.dumps(vid, indent=2) if vid else 'None'}")

        # Check for iframes
        iframes = await page.query_selector_all('iframe')
        print(f"[*] Iframes found: {len(iframes)}")
        for i, f in enumerate(iframes):
            src = await f.get_attribute('src')
            print(f"  Iframe {i}: {src}")

        # Check for embed links
        embeds = await page.evaluate("""() => {
            const els = document.querySelectorAll('[src], [href], [data-src]');
            return Array.from(els)
                .map(e => e.src || e.href || e.getAttribute('data-src'))
                .filter(s => s && (s.includes('m3u8') || s.includes('.mp4') || s.includes('embed') || s.includes('video')));
        }""")
        print(f"[*] Video/embed sources: {embeds}")

        print(f"\n[*] Video URLs found: {video_urls}")

        with open('/tmp/yomi_watch_api.json', 'w') as f:
            json.dump(API_CALLS, f, indent=2)

        await browser.close()


API_CALLS = []
if __name__ == '__main__':
    asyncio.run(main())
