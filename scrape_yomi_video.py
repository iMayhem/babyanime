"""Capture actual video URL from yomi.to by loading the megaplay iframe"""
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

        all_reqs = []

        def log(req):
            url = req.url
            if any(x in url for x in ['m3u8', '.mp4', 'master', 'playlist', 'megaplay', 'nekostream', 'dump']):
                info = {
                    'method': req.method,
                    'url': url,
                    'headers': dict(req.headers),
                    'resource_type': req.resource_type,
                }
                all_reqs.append(info)
                print(f"\n>>> [{req.method}] {url}")
                for k in ['referer', 'origin', 'range']:
                    if req.headers.get(k):
                        print(f"    {k}: {req.headers[k]}")

        def log_resp(resp):
            url = resp.url
            if any(x in url for x in ['m3u8', '.mp4', 'master', 'playlist', 'megaplay', 'nekostream', 'dump']):
                ct = resp.headers.get('content-type', '')
                print(f"<<< [{resp.status}] {url[:130]}")
                print(f"    Content-Type: {ct}")

        page.on('request', log)
        page.on('response', log_resp)

        url = 'https://yomi.to/watch/21/1'
        print(f"[*] Loading {url}")
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        await asyncio.sleep(3)

        # Find the megaplay iframe
        iframe_el = await page.query_selector('iframe')
        if iframe_el:
            src = await iframe_el.get_attribute('src')
            print(f"\n[*] Iframe src: {src}")
            # Navigate directly to the iframe source
            print(f"[*] Loading iframe directly...")
            await page.goto(src, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(8)

        # Wait more for video to load
        await asyncio.sleep(5)

        print(f"\n\n=== ALL CAPTURED REQUESTS ===")
        for r in all_reqs:
            print(f"[{r['method']}] {r['url']}")

        # Check for video in the page
        vid = await page.evaluate("""() => {
            const v = document.querySelector('video');
            if (!v) return null;
            return { src: v.src, currentSrc: v.currentSrc };
        }""")
        print(f"\n[*] Video element: {json.dumps(vid) if vid else 'None'}")

        with open('/tmp/yomi_video_reqs.json', 'w') as f:
            json.dump(all_reqs, f, indent=2)

        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
