"""AniHQ.cc Scraper - bypasses Cloudflare Turnstile using nodriver (headless Chromium)"""
import asyncio
import json
import re
import nodriver as uc


async def scrape_anihq():
    browser = await uc.start(no_sandbox=True, headless=True)
    page = await browser.get('https://anihq.cc/')

    print("[*] Waiting for Cloudflare challenge...")

    # Wait & interact to trigger Turnstile resolution
    for i in range(90):
        await asyncio.sleep(1)
        content = await page.get_content()

        if 'Just a moment' not in content and 'challenge' not in content.lower()[:2000]:
            print(f"[+] Cloudflare bypassed after ~{i+1}s")
            break

        # Try clicking to trigger Turnstile
        if i == 5:
            print("  -> Clicking to trigger Turnstile...")
            try:
                await page.mouse_click(200, 200)
            except Exception:
                pass

        if i % 15 == 14:
            print(f"  Still waiting... ({i+1}s)")
    else:
        print("[-] Failed to bypass Cloudflare")
        await browser.stop()
        return

    # Give dynamic content time to load
    await asyncio.sleep(5)
    print(f"[*] Final URL: {page.url}")
    print(f"[*] Page title: {page.title}")

    # Get rendered content
    content = await page.get_content()
    body_text = await page.evaluate('document.body.innerText')
    body_text = str(body_text)

    # Extract API endpoints
    apis = set(re.findall(r'https?://[^"\'<> )]+/api/[^"\'<> )]+', content))
    wp_apis = set(re.findall(r'https?://anihq\.cc/wp-json/[^"\'<> )]+', content))
    graphql = set(re.findall(r'https?://[^"\'<> )]+/graphql[^"\'<> )]*', content))

    print(f"\n=== SITE ANALYSIS ===")
    print(f"[*] Content length: {len(content)} bytes")
    print(f"[*] Body text: {len(body_text)} chars")

    print(f"\n=== API ENDPOINTS ===")
    for a in sorted(apis):
        print(f"  {a}")
    for a in sorted(wp_apis):
        print(f"  {a}")
    for a in sorted(graphql):
        print(f"  {a}")

    print(f"\n=== REFERRER / SECURITY HEADERS (from HTML) ===")
    # Check meta tags for security policies
    for m in re.findall(r'<meta[^>]+>', content):
        if 'referrer' in m.lower() or 'policy' in m.lower():
            print(f"  {m}")

    try:
        perms = await page.evaluate('navigator.permissions.query({name: "notifications"})')
        print(f"\n  Permissions API available")
    except:
        pass

    print(f"\n=== TOP 50 VISIBLE LINES ===")
    lines = [l.strip() for l in body_text.split('\n') if l.strip()]
    for line in lines[:80]:
        print(f"  {line}")

    # Save outputs
    with open('/tmp/anihq_rendered.html', 'w') as f:
        f.write(content)
    with open('/tmp/anihq_body.txt', 'w') as f:
        f.write(body_text)

    print(f"\n[+] Saved: /tmp/anihq_rendered.html ({len(content)} bytes)")
    print(f"[+] Saved: /tmp/anihq_body.txt ({len(body_text)} chars)")

    await browser.stop()
    return {'content': content, 'body': body_text}


if __name__ == '__main__':
    asyncio.run(scrape_anihq())
