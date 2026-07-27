"""Scrape ani waves.ru - no Cloudflare, easier to work with"""
import asyncio
import json
import re
from playwright.async_api import async_playwright

API_CALLS = []


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

        def log_request(req):
            url = req.url
            if 'ajax' in url or 'api' in url or 'episode' in url or 'server' in url or 'video' in url or '.m3u8' in url or '.mp4' in url:
                info = {
                    'method': req.method,
                    'url': url,
                    'headers': dict(req.headers),
                    'resource_type': req.resource_type,
                }
                API_CALLS.append(info)
                print(f"\n>>> [{req.method}] {url}")
                for k in ['referer', 'origin', 'x-requested-with']:
                    if req.headers.get(k):
                        print(f"    {k}: {req.headers[k]}")

        page.on('request', log_request)

        url = 'https://aniwaves.ru/watch/one-piece-81553/ep-1'
        print(f"[*] Loading {url}")
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        await asyncio.sleep(3)

        # Get page content for static analysis
        content = await page.content()
        html_file = '/tmp/aniwaves_page.html'
        with open(html_file, 'w') as f:
            f.write(content)
        print(f"[*] Saved page HTML: {html_file} ({len(content)} bytes)")

        title = await page.title()
        print(f"[*] Title: {title}")

        # Check for server/player divs
        player_exists = await page.evaluate('!!document.getElementById("player")')
        servers_exists = await page.evaluate('!!document.getElementById("w-servers")')
        print(f"[*] Player div exists: {player_exists}")
        print(f"[*] Servers div exists: {servers_exists}")

        if servers_exists:
            servers_html = await page.evaluate('document.getElementById("w-servers").innerHTML')
            print(f"[*] Servers HTML (first 500): {servers_html[:500] if servers_html else 'empty'}")

        # Wait a bit more for dynamic content
        await asyncio.sleep(5)

        # Check if servers loaded
        servers_html = await page.evaluate('document.getElementById("w-servers")?.innerHTML')
        print(f"[*] Servers HTML after wait: {servers_html[:500] if servers_html else 'empty'}")

        # Try to click a server button if exists
        if servers_html and len(servers_html) > 100:
            # Find the first server link and click it
            try:
                first_server = await page.query_selector('#w-servers a, #w-servers .server, #w-servers button')
                if first_server:
                    await first_server.click()
                    print("[*] Clicked first server")
                    await asyncio.sleep(3)
            except:
                pass

        print(f"\n\n=== API CALLS SUMMARY ===")
        seen = set()
        for call in API_CALLS:
            if call['url'] not in seen:
                seen.add(call['url'])
                print(f"[{call['method']}] {call['url']}")

        # Check for video elements
        video_src = await page.evaluate("""() => {
            const v = document.querySelector('video source, video');
            if (!v) return null;
            return v.src || v.querySelector('source')?.src || null;
        }""")
        print(f"\n[*] Video source: {video_src}")

        # Save all API calls
        with open('/tmp/aniwaves_api_calls.json', 'w') as f:
            json.dump(API_CALLS, f, indent=2)

        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
