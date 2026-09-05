"""Exercise the real generated site in Chromium. No inference or hardware scan."""
from __future__ import annotations
import argparse, functools, http.server, json, os, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def rgb(s):
    import re
    return [int(v)/255 for v in re.findall(r'\d+',s)[:3]]
def contrast(a,b):
    def lum(c):return sum(x*w for x,w in zip([(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4) for v in c],[.2126,.7152,.0722]))
    x,y=sorted([lum(rgb(a)),lum(rgb(b))]);return (y+.05)/(x+.05)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('site',type=Path);parser.add_argument('--out',type=Path);args=parser.parse_args()
    folder=args.site.resolve();out=args.out or Path(tempfile.mkdtemp(prefix='aperture-docs-browser-'));out.mkdir(parents=True,exist_ok=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(folder)))
    threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
    errors=[];cases=[];ratios={}
    try:
      with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=os.getenv('APERTURE_TEST_BROWSER') or None,args=['--no-sandbox'])
        context=browser.new_context(permissions=['clipboard-read','clipboard-write']);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        pages=sorted(p.name for p in folder.glob('*.html') if p.name!='404.html')
        for width in (1440,768,390,320):
          page.set_viewport_size({'width':width,'height':1000})
          for mode in ('dark','light'):
            for filename in pages:
              page.goto(base+'/'+filename,wait_until='networkidle');page.select_option('#theme',mode)
              assert page.locator('h1').count()==1,(width,mode,filename,'title')
              assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(width,mode,filename,'horizontal overflow')
              assert not page.locator('img').evaluate_all('(imgs)=>imgs.some(i=>!i.complete||!i.naturalWidth)'),(filename,'broken image')
              cases.append({'page':filename,'width':width,'mode':mode})
            if width in (1440,390):
              page.goto(base+'/index.html');page.select_option('#theme',mode);page.screenshot(path=str(out/f'home-{width}-{mode}.png'),full_page=True)
            c=page.evaluate("""()=>{const s=getComputedStyle(document.body),a=getComputedStyle(document.querySelector('.toplinks a'));return {bg:s.backgroundColor,text:s.color,nav:a.color}}""")
            ratios[mode]={'body':contrast(c['bg'],c['text']),'nav':contrast(c['bg'],c['nav'])}
            assert min(ratios[mode].values())>=4.5,ratios[mode]
        page.set_viewport_size({'width':1440,'height':1000});page.goto(base+'/index.html')
        page.select_option('#theme','dark');page.reload();assert page.locator('html').get_attribute('data-theme')=='dark'
        page.select_option('#theme','auto');page.emulate_media(color_scheme='light');light=page.evaluate('getComputedStyle(document.body).backgroundColor');page.emulate_media(color_scheme='dark');dark=page.evaluate('getComputedStyle(document.body).backgroundColor');assert dark!=light
        page.select_option('#platform','windows');page.select_option('#distribution','package');text=page.locator('#install-code').inner_text();assert text.startswith('npx.cmd --yes --package=')
        page.locator('[data-copy="install-code"]').click();assert page.evaluate('navigator.clipboard.readText()')==text
        page.select_option('#platform','posix');page.select_option('#distribution','git');assert page.locator('#install-code').inner_text()=='npx --yes github:BigBirdReturns/aperture#v0.4.1'
        page.fill('#search','CUDA');page.wait_for_function("document.querySelector('#search-status').textContent.includes('found')");assert page.locator('#search-results a').count()>0
        page.keyboard.press('Escape');assert page.locator('#search-results').is_hidden()
        page.fill('#search','<img src=x onerror=alert(1)>');page.wait_for_function("document.querySelector('#search-status').textContent.includes('No matching')");assert page.locator('#search-results img').count()==0
        page.reload();page.keyboard.press('Tab');assert page.locator('.skip').evaluate('(e)=>document.activeElement===e');page.keyboard.press('Enter');assert page.locator('#main').evaluate('(e)=>document.activeElement===e')
        page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})")
        page.locator('[data-copy="install-code"]').click();assert 'Clipboard unavailable' in page.locator('.install-command .copy-status').inner_text()
        page.emulate_media(reduced_motion='reduce');assert page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
        page.emulate_media(media='print');assert page.locator('.eco-nav').is_hidden();page.emulate_media(media='screen')
        nojs=browser.new_context(java_script_enabled=False,color_scheme='dark',viewport={'width':390,'height':850});p=nojs.new_page();p.goto(base+'/quickstart.html');assert p.locator('.sidebar nav a').count()==8;assert p.locator('.sidebar nav').is_visible();assert p.locator('[data-copy]').first.is_hidden();assert p.locator('main').inner_text().find('npx.cmd --yes')>=0
        blocked=browser.new_context();p=blocked.new_page();p.route('**/search-index.json',lambda route:route.abort());p.goto(base+'/index.html');p.fill('#search','context');p.wait_for_function("document.querySelector('#search-status').textContent.includes('unavailable')")
        assert not errors,errors
        browser.close()
      report={'layout_cases':len(cases),'widths':[1440,768,390,320],'modes':['dark','light'],'body_nav_contrast':ratios,'interaction_checks':['copy contents','clipboard denial fallback','platform command','distribution command','search results','search literal text','search failure','Escape','theme persistence','auto system theme','skip link','reduced motion','print','no JavaScript navigation'],'page_errors':errors,'native_inference_performed':False}
      (out/'browser-checks.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));print('Evidence directory:',out)
    finally:server.shutdown();server.server_close()
if __name__=='__main__':main()
