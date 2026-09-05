"""Check actual local or deployed documentation in Chromium; never run inference."""
from __future__ import annotations
import argparse, functools, http.server, json, os, re, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def contrast(a, b):
    def luminance(s):
        rgb = [int(v) / 255 for v in re.findall(r'\d+', s)[:3]]
        linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
        return sum(v * w for v, w in zip(linear, [.2126, .7152, .0722]))
    lo, hi = sorted([luminance(a), luminance(b)])
    return (hi + .05) / (lo + .05)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('site', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--base-url', help='Verify this deployed URL instead of a local server')
    args = parser.parse_args(); folder = args.site.resolve()
    out = args.out or Path(tempfile.mkdtemp(prefix='aperture-docs-browser-'))
    out.mkdir(parents=True, exist_ok=True)
    server = None
    if args.base_url:
        base = args.base_url.rstrip('/')
    else:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(folder)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
    errors, cases, ratios = [], [], {}
    pages = sorted(p.name for p in folder.glob('*.html') if p.name != '404.html')
    site = json.loads((folder / 'release.json').read_text(encoding='utf-8'))
    guide_count = len(json.loads((folder / 'search-index.json').read_text(encoding='utf-8')))
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, executable_path=os.getenv('APERTURE_TEST_BROWSER') or None)
            context = browser.new_context(permissions=['clipboard-read', 'clipboard-write'])
            page = context.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
            for width in (1440, 1024, 768, 390, 320):
                page.set_viewport_size({'width': width, 'height': 1000})
                for filename in pages:
                    response = page.goto(base + '/' + filename, wait_until='networkidle')
                    assert response.status == 200, (filename, response.status)
                    assert page.locator('h1').count() == 1, (filename, 'title')
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (width, filename, 'overflow')
                    assert not page.locator('img').evaluate_all('(imgs)=>imgs.some(i=>!i.complete||!i.naturalWidth)'), (filename, 'image')
                    assert page.locator('.topbar .scg-mark').count() == 1
                    assert page.locator('footer .scg-mark').count() == 0
                    cases.append({'page': filename, 'width': width})
                page.goto(base + '/index.html', wait_until='networkidle')
                if width in (1440, 390):
                    page.screenshot(path=str(out / f'home-{width}.png'), full_page=True)
                    page.screenshot(path=str(out / f'first-screen-{width}.png'))
                c = page.evaluate("""()=>{const s=getComputedStyle(document.body),a=getComputedStyle(document.querySelector('.toplinks a'));return {bg:s.backgroundColor,text:s.color,nav:a.color}}""")
                ratios[str(width)] = {'body': contrast(c['bg'], c['text']), 'nav': contrast(c['bg'], c['nav'])}
                assert min(ratios[str(width)].values()) >= 4.5
                assert c['bg'] == 'rgb(13, 12, 9)', c
            page.set_viewport_size({'width':1440, 'height':1000})
            page.goto(base + '/index.html', wait_until='networkidle')
            for platform, exe in [('windows', 'npx.cmd'), ('posix', 'npx')]:
                page.select_option('#platform', platform)
                for distribution in ('package', 'git'):
                    page.select_option('#distribution', distribution)
                    expected = f'{exe} --yes --package={site["package_url"]} aperture' if distribution == 'package' else f'{exe} --yes github:BigBirdReturns/aperture#{site["tag"]}'
                    assert page.locator('#install-code').inner_text() == expected
                    page.locator('[data-copy="install-code"]').click()
                    assert page.evaluate('navigator.clipboard.readText()') == expected
            page.fill('#search', 'CUDA')
            page.wait_for_function("document.querySelector('#search-status').textContent.includes('found')")
            assert page.locator('#search-results a').count() > 0
            page.keyboard.press('Escape'); assert page.locator('#search-results').is_hidden()
            page.fill('#search', 'nonexistent-page-998822')
            page.wait_for_function("document.querySelector('#search-status').textContent.includes('No matching')")
            page.reload(); page.keyboard.press('Tab')
            assert page.locator('.skip').evaluate('(e)=>document.activeElement===e')
            page.keyboard.press('Enter'); assert page.locator('#main').evaluate('(e)=>document.activeElement===e')
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})")
            page.locator('[data-copy="install-code"]').click()
            page.wait_for_function("document.querySelector('.install-command .copy-status').textContent.includes('Clipboard unavailable')")
            page.emulate_media(reduced_motion='reduce', color_scheme='light')
            assert page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
            assert page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(13, 12, 9)'
            page.emulate_media(media='print'); assert page.locator('.eco-nav').is_hidden()
            page.emulate_media(media='screen')
            nojs = browser.new_context(java_script_enabled=False, viewport={'width':390,'height':850})
            p = nojs.new_page(); p.goto(base + '/quickstart.html')
            assert p.locator('.sidebar nav a').count() == guide_count
            assert p.locator('.sidebar nav').is_visible()
            assert p.locator('[data-copy]').first.is_hidden()
            assert 'npx.cmd --yes' in p.locator('main').inner_text()
            blocked = browser.new_context(); p = blocked.new_page()
            p.route('**/search-index.json', lambda route: route.abort())
            p.goto(base + '/index.html'); p.fill('#search', 'context')
            p.wait_for_function("document.querySelector('#search-status').textContent.includes('unavailable')")
            if args.base_url:
                response = page.goto(base + '/missing-documentation-check/unknown', wait_until='networkidle')
                assert response.status == 404
                assert page.locator('h1').inner_text() == 'That page could not be found.'
                assert page.locator('a').first.get_attribute('href') == base + '/'
            assert not errors, errors
            browser.close()
        report = {'base_url': base if args.base_url else 'local HTTP server', 'layout_cases':len(cases), 'guide_count':guide_count, 'theme':'SCG practice', 'widths':[1440,1024,768,390,320], 'body_nav_contrast':ratios, 'real_clipboard_combinations':4, 'negative_clipboard_test':'permission failure simulated', 'search_checked':True, 'no_javascript_checked':True, 'keyboard_checked':True, 'page_errors':errors, 'native_inference_performed':False}
        (out / 'browser-checks.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2))
        print('Evidence directory:', out)
    finally:
        if server:
            server.shutdown(); server.server_close()

if __name__ == '__main__':
    main()
