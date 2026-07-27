"""Scrape ani waves.ru - interactive: click server, capture video URL"""
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

        video_urls = []

        def on_request(req):
            url = req.url
            if any(x in url for x in ['.m3u8', '.mp4', 'vidplay', 'mycloud', 'gcloud']):
                info = {
                    'method': req.method,
                    'url': url,
                    'headers': dict(req.headers),
                    'resource_type': req.resource_type,
                }
                video_urls.append(info)
                print(f"\n>>> VIDEO REQUEST [{req.method}] {url}")
                for k in ['referer', 'origin', 'authorization']:
                    if req.headers.get(k):
                        print(f"    {k}: {req.headers[k]}")

        def on_response(resp):
            url = resp.url
            if any(x in url for x in ['.m3u8', '.mp4', 'vidplay', 'mycloud', 'gcloud', 'ajax/server', 'ajax/episode']):
                if 'application/json' in resp.headers.get('content-type', ''):
                    print(f"\n<<< JSON RESPONSE [{resp.status}] {url}")

        page.on('request', on_request)
        page.on('response', on_response)

        url = 'https://aniwaves.ru/watch/one-piece-81553/ep-1'
        print(f"[*] Loading {url}")
        await page.goto(url, wait_until='networkidle', timeout=30000)

        # Wait for server list to load
        await asyncio.sleep(3)

        # Log what's on the page
        title = await page.title()
        print(f"[*] Title: {title}")

        # Look for server buttons and click the first SUB server
        try:
            server_items = await page.query_selector_all('#w-servers .server, #w-servers li[data-sv-id], #w-servers ul li')
            print(f"[*] Found {len(server_items)} server items")
            if server_items:
                print(f"[*] Clicking first server...")
                await server_items[0].click()
                await asyncio.sleep(5)
        except Exception as e:
            print(f"[!] Server click error: {e}")

        # Wait for video to load
        await asyncio.sleep(5)

        # Check for video element
        video_info = await page.evaluate("""() => {
            const v = document.querySelector('video');
            if (!v) return {src: null, currentSrc: null};
            return {
                src: v.src || null,
                currentSrc: v.currentSrc || null,
                duration: v.duration || null,
            };
        }""")
        print(f"\n[*] Video element info: {json.dumps(video_info, indent=2)}")

        # Check all source elements
        sources = await page.evaluate("""() => {
            const sources = document.querySelectorAll('video source');
            return Array.from(sources).map(s => s.src);
        }""")
        print(f"[*] Video sources: {sources}")

        # Check iframes for embedded video
        iframes = await page.query_selector_all('iframe')
        for idx, iframe in enumerate(iframes):
            src = await iframe.get_attribute('src')
            print(f"[*] Iframe {idx}: {src}")

        print(f"\n\n=== VIDEO REQUESTS CAPTURED ===")
        for v in video_urls:
            print(f"[{v['method']}] {v['url']}")

        # Save all captured data
        with open('/tmp/aniwaves_video_log.json', 'w') as f:
            json.dump(video_urls, f, indent=2)
        print(f"\n[+] Saved video log to /tmp/aniwaves_video_log.json")

        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
