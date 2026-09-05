"""Render the site social card from exact SCG source, without copying fonts."""
from pathlib import Path
import html, json, os
from playwright.sync_api import sync_playwright
from scg_identity import mark_svg
ROOT = Path(__file__).resolve().parents[1]
site = json.loads((ROOT / 'docs/site.json').read_text(encoding='utf-8'))
style = '''*{box-sizing:border-box}body{margin:0;background:#0D0C09;color:#ECE7D8;font-family:"IBM Plex Sans",Arial,sans-serif}.canvas{width:1200px;height:630px;padding:52px 66px;position:relative;border-top:4px solid #7C7F57}.top{display:flex;align-items:center;gap:20px;font:12px/1.8 "IBM Plex Mono",monospace;letter-spacing:.15em}.top svg{width:32px;height:36px;flex-shrink:0}h1{font-size:99px;letter-spacing:.13em;font-weight:600;line-height:1;margin:58px 0 28px}h2{font-size:36px;line-height:1.35;font-weight:400;margin:0;max-width:960px}.sub{font:17px/1.8 "IBM Plex Mono",monospace;color:#ADA99B;margin-top:25px;max-width:1000px}.bottom{position:absolute;bottom:37px;left:66px;right:66px;border-top:1px solid #363724;padding-top:20px;display:flex;justify-content:space-between;font:13px "IBM Plex Mono",monospace;color:#ADA99B}'''
markup = '<!doctype html><html lang="en"><meta charset="utf-8"><style>' + style + '</style><body><main class="canvas"><div class="top">' + mark_svg() + '<span>SANDHU CONSULTING GROUP<br>OPEN-SOURCE LOCAL INFERENCE</span></div><h1>APERTURE</h1><h2>Configure local inference around<br>your chosen model.</h2><p class="sub">Supply a link or local file. Inspect the hardware.<br>Review the configuration and open a supported local session.</p><div class="bottom"><span>bigbirdreturns.github.io/aperture</span><span>RELEASE ' + html.escape(site['version']) + '</span></div></main></body></html>'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.getenv('APERTURE_TEST_BROWSER') or None)
    page = browser.new_page(viewport={'width':1200,'height':630}, device_scale_factor=1)
    page.set_content(markup)
    assert page.evaluate('document.documentElement.scrollHeight <= 630')
    assert page.locator('svg rect').count() == 79
    page.screenshot(path=str(ROOT / 'docs/assets/social-preview.png'))
    browser.close()
print('Rendered 1200 x 630 social preview from the canonical 79-cell SCG mark')
