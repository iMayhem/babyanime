"""Opens anihq.cc in a visible browser and logs all network requests to console."""
import asyncio
import json
from datetime import datetime
from playwright.async_api import async_playwright


REQUEST_LOG = []
RESPONSE_LOG = []


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            executable_path='/usr/bin/chromium',
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ]
        )
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            locale='en-US',
        )
        page = await context.new_page()

        def on_request(req):
            info = {
                'ts': datetime.now().isoformat(),
                'method': req.method,
                'url': req.url,
                'headers': dict(req.headers),
                'resource_type': req.resource_type,
            }
            REQUEST_LOG.append(info)
            # Print immediately
            ref = req.headers.get('referer', '')
            origin = req.headers.get('origin', '')
            print(f"\n>>> [{req.method}] {req.url}")
            if ref:
                print(f"    Referer: {ref}")
            if origin:
                print(f"    Origin: {origin}")
            if req.headers.get('authorization'):
                print(f"    Auth: {req.headers['authorization'][:50]}...")
            print(f"    Type: {req.resource_type}")
            print(f"    Time: {info['ts']}")

        def on_response(resp):
            info = {
                'ts': datetime.now().isoformat(),
                'url': resp.url,
                'status': resp.status,
                'headers': dict(resp.headers),
            }
            RESPONSE_LOG.append(info)
            ct = resp.headers.get('content-type', '')
            if 'json' in ct or 'text' in ct:
                print(f"<<< [{resp.status}] {resp.url}")
                print(f"    Content-Type: {ct}")

        page.on('request', on_request)
        page.on('response', on_response)

        print("=" * 80)
        print("Opening https://anihq.cc/ in browser...")
        print("All network requests will be logged below.")
        print("Close the browser window when done, or press Ctrl+C to stop.")
        print("=" * 80)

        await page.goto('https://anihq.cc/', wait_until='domcontentloaded', timeout=60000)

        # Keep running until user closes browser
        while True:
            try:
                await asyncio.sleep(2)
                # Check if browser still connected
                pages = context.pages
                if not pages:
                    print("\n[!] Browser closed. Stopping.")
                    break
            except KeyboardInterrupt:
                break
            except Exception:
                break

        # Save full log
        with open('/tmp/anihq_network_log.json', 'w') as f:
            json.dump({'requests': REQUEST_LOG, 'responses': RESPONSE_LOG}, f, indent=2)
        print(f"\n[+] Network log saved to /tmp/anihq_network_log.json")
        print(f"[+] Total requests: {len(REQUEST_LOG)}, responses: {len(RESPONSE_LOG)}")

        await browser.close()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[!] Stopped by user")
    except Exception as e:
        print(f"\n[!] Error: {e}")
