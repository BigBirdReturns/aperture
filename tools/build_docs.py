"""Build a version-bound, self-contained Aperture documentation site."""
from __future__ import annotations
import argparse, html, json, re, shutil
from pathlib import Path
from scg_identity import render as render_identity
from urllib.parse import urlsplit
from markdown_it import MarkdownIt
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parents[1]
PAGES = [
    ("quickstart", "Get started", "Installation, permissions, the first session, and returning later."),
    ("models", "Model sources", "Local files, repository links, numbered shards, and access."),
    ("memory", "Memory and placement", "Physical capacity, available headroom, and CPU/GPU split execution."),
    ("reference", "Command reference", "Every released command, flag, and independent permission."),
    ("troubleshooting", "Troubleshooting", "Recover from installation, download, backend, and model errors."),
    ("privacy", "Privacy and local data", "What is read, retained, transmitted, and kept under your control."),
    ("experiments", "Bounded experiments", "Run the optional comparison and interpret its local evidence."),
    ("support", "Verified support", "Implemented paths, native observations, and limits of the evidence."),
    ("releases", "Releases", "Versioned changes, pending work, and maintenance guidance."),
    ("maintenance", "Maintenance", "Build, verify, and publish the release-bound documentation."),
]

def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"

def render_markdown(source: str) -> tuple[str, list[dict], str]:
    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    tokens = md.parse(source)
    if tokens and tokens[0].type == "heading_open" and tokens[0].tag == "h1":
        tokens = tokens[3:]
    toc, seen = [], {}
    for i, token in enumerate(tokens):
        if token.type == "heading_open":
            title = tokens[i+1].content
            anchor = slugify(title)
            seen[anchor] = seen.get(anchor, 0) + 1
            if seen[anchor] > 1: anchor += f"-{seen[anchor]}"
            token.attrSet("id", anchor)
            if token.tag == "h2": toc.append({"id": anchor, "text": title})
        for child in token.children or []:
            if child.type == "link_open":
                href = child.attrGet("href") or ""
                u = urlsplit(href)
                if not u.scheme and not u.netloc and u.path.endswith(".md"):
                    name = Path(u.path).stem
                    if name in {p[0] for p in PAGES}:
                        child.attrSet("href", name + ".html" + ("#" + u.fragment if u.fragment else ""))
    counter = [0]
    def fence(tokens, idx, options, env):
        counter[0] += 1
        token = tokens[idx]; ident = f"code-{counter[0]}"
        label = token.info.strip() or "text"
        copy = '<button class="copy js-control" type="button" data-copy="'+ident+'">Copy text</button>'
        return '<div class="codebox"><div class="code-label"><span>'+html.escape(label)+'</span>'+copy+'</div><pre><code id="'+ident+'">'+html.escape(token.content.rstrip())+'</code></pre><p class="copy-status" role="status"></p></div>\n'
    md.renderer.rules["fence"] = fence
    body = md.renderer.render(tokens, md.options, {})
    body = body.replace('<table>', '<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable reference table"><table>').replace('</table>', '</table></div>')
    text = ' '.join(token.content for token in tokens if token.type in {"inline", "fence"})
    return body, toc, text

def build(output: Path):
    render_identity()
    output = output.resolve()
    if output == ROOT or output in (ROOT / "docs", ROOT / "docs/pages"):
        raise ValueError("Choose a separate generated output directory")
    output.mkdir(parents=True, exist_ok=True)
    site = json.loads((ROOT / "docs/site.json").read_text(encoding="utf-8"))
    pages = [{"slug":s,"title":t,"description":d} for s,t,d in PAGES]
    env = Environment(loader=FileSystemLoader(ROOT / "docs/templates"),autoescape=select_autoescape(["html"]))
    template = env.get_template("page.html")
    index = []
    for i,page in enumerate(pages):
        content,toc,text = render_markdown((ROOT / f"docs/pages/{page['slug']}.md").read_text(encoding="utf-8"))
        values = dict(page, site=site,pages=pages,home=False,content=content,toc=toc,previous=pages[i-1] if i else None,next=pages[i+1] if i+1<len(pages) else None)
        (output / f"{page['slug']}.html").write_text(template.render(**values),encoding='utf-8',newline='\n')
        index.append(dict(page,url=f"{page['slug']}.html",text=text))
    (output / 'index.html').write_text(template.render(site=site,pages=pages,home=True,slug='index',title='Aperture · Local model setup',description='Choose a model, inspect your hardware, and review a memory-aware local execution configuration.'),encoding='utf-8',newline='\n')
    shutil.copytree(ROOT / 'docs/assets',output / 'assets',dirs_exist_ok=True)
    (output / 'search-index.json').write_text(json.dumps(index,ensure_ascii=False),encoding='utf-8',newline='\n')
    (output / 'release.json').write_text(json.dumps(site,indent=2)+'\n',encoding='utf-8',newline='\n')
    (output / '.nojekyll').write_text('',encoding='utf-8',newline='\n')
    (output / 'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: '+site['base_url']+'/sitemap.xml\n',encoding='utf-8',newline='\n')
    urls = [site['base_url']+'/']+[site['base_url']+'/'+p['slug']+'.html' for p in pages]
    sitemap = '<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join('<url><loc>'+html.escape(u)+'</loc><lastmod>'+site['reviewed']+'</lastmod></url>' for u in urls)+'</urlset>\n'
    (output / 'sitemap.xml').write_text(sitemap,encoding='utf-8',newline='\n')
    # Absolute project URLs keep the error page usable at nested invalid paths.
    (output / '404.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found · Aperture</title><link rel="stylesheet" href="'+site['base_url']+'/assets/site.css"><link rel="stylesheet" href="'+site['base_url']+'/assets/scg.css"><body><main class="shell section"><p class="eyebrow">Aperture documentation</p><h1>That page could not be found.</h1><p>Return to <a href="'+site['base_url']+'/">Aperture</a> or open <a href="'+site['base_url']+'/quickstart.html">Get started</a>.</p></main></body></html>',encoding='utf-8',newline='\n')
    print(json.dumps({'output':str(output),'pages':len(pages)+1,'release':site['version']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT/'_site')
    build(parser.parse_args().out)
