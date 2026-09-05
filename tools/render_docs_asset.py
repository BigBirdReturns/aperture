"""Render the social preview from owned typography; no font files are copied."""
from pathlib import Path
import html, json, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
site=json.loads((ROOT/'docs/site.json').read_text(encoding="utf-8"))
css=(ROOT/'docs/assets/site.css').read_text(encoding="utf-8")
markup='''<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8"><style>'''+css+'''</style><body><main class="social-canvas"><p class="eyebrow">OPEN-SOURCE LOCAL MODEL SETUP</p><h1>APERTURE<br><span>Your model, configured locally.</span></h1><p>Inspect your hardware, supply a model link or path,<br>and review a memory-aware execution method.</p><div class="social-footer"><span>github.com/BigBirdReturns/aperture</span><span>Release '''+html.escape(site['version'])+'''</span></div></main></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.getenv('APERTURE_TEST_BROWSER') or None)
    page=browser.new_page(viewport={'width':1200,'height':630},device_scale_factor=1)
    page.set_content(markup)
    assert page.evaluate('document.documentElement.scrollHeight<=630'), 'Preview overflows its frame'
    page.screenshot(path=str(ROOT/'docs/assets/social-preview.png'))
    browser.close()
print('Rendered docs/assets/social-preview.png (1200 x 630)')
