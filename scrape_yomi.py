"""Scrape yomi.to - Next.js app, need to capture API calls"""
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

        def on_request(req):
            url = req.url
            if any(x in url for x in ['/api/', '/_next/data', 'yomi.to', 'gql', 'graphql']):
                if 'google' not in url and 'facebook' not in url:
                    info = {
                        'method': req.method,
                        'url': url,
                        'headers': dict(req.headers),
                    }
                    api_calls.append(info)
                    print(f"\n>>> [{req.method}] {url}")
                    for k in ['referer', 'origin', 'x-requested-with', 'content-type']:
                        if req.headers.get(k):
                            print(f"    {k}: {req.headers[k]}")

        def on_response(resp):
            url = resp.url
            if '/api/' in url or '/_next/data' in url or 'yomi.to' in url:
                ct = resp.headers.get('content-type', '')
                if 'json' in ct or 'javascript' in ct:
                    print(f"<<< [{resp.status}] {url[:120]}")
                    print(f"    Content-Type: {ct}")

        page.on('request', on_request)
        page.on('response', on_response)

        print("[*] Loading https://yomi.to/")
        await page.goto('https://yomi.to/', wait_until='networkidle', timeout=30000)

        # Wait for dynamic content to render
        await asyncio.sleep(5)

        title = await page.title()
        print(f"\n[*] Title: {title}")

        body_text = await page.evaluate('document.body.innerText')
        print(f"[*] Body text (first 500): {body_text[:500] if body_text else 'None'}")

        print(f"\n\n=== ALL API CALLS ===")
        seen = set()
        for c in api_calls:
            if c['url'] not in seen:
                seen.add(c['url'])
                print(f"[{c['method']}] {c['url']}")

        with open('/tmp/yomi_api_calls.json', 'w') as f:
            json.dump(api_calls, f, indent=2)

        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
