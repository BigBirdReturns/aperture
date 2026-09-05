"""Check published links, accessibility structure, release identity, and CLI flags."""
from __future__ import annotations
import argparse, hashlib, json, re, subprocess, sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
ROOT=Path(__file__).resolve().parents[1]
class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.ids=[];self.links=[];self.assets=[];self.h1=0;self.language=None;self.imgs=[];self.canonical=None;self.scripts=[];self.headings=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id' in a:self.ids.append(a['id'])
        if tag=='html':self.language=a.get('lang')
        if tag=='h1':self.h1+=1
        if tag=='a' and 'href' in a:self.links.append(a['href'])
        if tag=='img':self.imgs.append(a);self.assets.append(a.get('src',''))
        if tag=='script':self.scripts.append(a.get('src',''));self.assets.append(a.get('src',''))
        if tag=='link' and a.get('rel') in ['stylesheet','icon']:self.assets.append(a.get('href',''))
        if tag=='link' and a.get('rel')=='canonical':self.canonical=a.get('href')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('site',type=Path);ap.add_argument('--source-only',action='store_true');args=ap.parse_args()
    site=args.site.resolve();meta=json.loads((ROOT/'docs/site.json').read_text(encoding="utf-8"));fail=[];pages={};checked=0
    def require(ok,message):
        if not ok:fail.append(message)
    for path in site.glob('*.html'):
        p=Page();p.feed(path.read_text(encoding='utf-8'));pages[path.resolve()]=p
        require(p.h1==1,f'{path.name}: requires exactly one h1')
        require(p.language=='en',f'{path.name}: missing document language')
        require(len(p.ids)==len(set(p.ids)),f'{path.name}: duplicate IDs')
        if path.name!='404.html':require(bool(p.canonical),f'{path.name}: canonical missing')
        for image in p.imgs:require('alt' in image,f'{path.name}: image alt missing')
        for s in p.scripts:require(bool(s) and not urlsplit(s).scheme,f'{path.name}: nonlocal or inline script')
    for path,p in pages.items():
        for href in p.links+p.assets:
            u=urlsplit(href)
            require(u.scheme not in ['javascript','data'],f'{path.name}: unsafe navigation')
            if u.scheme or u.netloc:continue
            target=(path.parent/unquote(u.path)).resolve() if u.path else path
            if target.is_dir():target/='index.html'
            require(target.is_relative_to(site),f'{path.name}: local link escapes site')
            require(target.exists(),f'{path.name}: missing {href}')
            if u.fragment and target in pages:require(unquote(u.fragment) in pages[target].ids,f'{path.name}: missing anchor {href}')
            checked+=1
    require((site/'assets/social-preview.png').is_file(),'Social preview missing')
    require(len(json.loads((site/'search-index.json').read_text(encoding="utf-8")))==8,'Search index does not cover all guides')
    for path in [ROOT/'README.md',*list((ROOT/'docs/pages').glob('*.md'))]:
        txt=path.read_text(encoding='utf-8')
        require('\u2014' not in txt,f'{path.name}: em dash outside house voice')
        require(not re.search(r'S:\\\\|D:\\\\|C:\\\\Users\\|sandbox:/',txt),f'{path.name}: private path or chat link')
        for version in re.findall(r'bigbirdreturns-aperture-([\d.]+)\.tgz',txt):
            require(version==meta['version'],f'{path.name}: stale package version {version}')
    reference=(ROOT/'docs/pages/reference.md').read_text(encoding='utf-8')
    runtime_checked=False
    if not args.source_only:
        pkg=json.loads((ROOT/'package.json').read_text(encoding="utf-8"))
        require(pkg['version']==meta['version'],'Runtime version and published docs differ')
        result=subprocess.run(['node','bin/aperture.mjs','--help'],cwd=ROOT,capture_output=True,text=True,timeout=30,encoding='utf-8')
        require(result.returncode==0,'CLI help failed')
        options=set(re.findall(r'--[a-z][a-z-]*',result.stdout))
        missing=options-set(re.findall(r'--[a-z][a-z-]*',reference))
        require(not missing,'Undocumented CLI flags: '+str(sorted(missing)))
        runtime_checked=True
    require(meta['native_prefit_before_download'] is False,'Update admission copy/tests deliberately if released behavior changes')
    report={'pages_checked':len(pages),'local_links_checked':checked,'runtime_help_checked':runtime_checked,'release':meta['version'],'failures':fail}
    print(json.dumps(report,indent=2));return bool(fail)
if __name__=='__main__':sys.exit(main())
