"""Validate frozen SCG source and render its exact 79-cell derivative mark."""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'scg-pixel-mark.js': 'bc9a3eb2db82b21c6fdb58acb1d017c5a48cdedf',
    'scg.tokens.css': '5d03305a3fb7cd0982b1e34242ecc3588629f17f',
    'SCG_MARK_CONSTITUTION.md': '6ce2a3a6262a1190764117ec04ce687a1708271c',
}

def validate() -> dict:
    source = ROOT / 'docs/identity'
    for name, expected in SOURCES.items():
        data = (source / name).read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if actual != expected:
            raise ValueError(f'Canonical SCG identity mismatch: {name}')
    text = (source / 'scg-pixel-mark.js').read_text(encoding='utf-8')
    rows = re.findall(r"    '([.Wo]+)',", text)
    if len(rows) != 18 or any(len(row) != 16 for row in rows):
        raise ValueError('SCG derivative must retain the original 16 x 18 grid')
    if sum(c != '.' for row in rows for c in row) != 79:
        raise ValueError('SCG derivative must retain exactly 79 occupied cells')
    return {'rows': rows, 'sources': SOURCES}

def mark_svg() -> str:
    rows = validate()['rows']
    colours = {'W': '#ECE7D8', 'o': '#7C7F57'}
    rects = []
    for y, row in enumerate(rows):
        for x, cell in enumerate(row):
            if cell in colours:
                rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{colours[cell]}"/>')
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 18" width="32" height="36" shape-rendering="crispEdges">' + ''.join(rects) + '</svg>\n'

def render() -> dict:
    checked = validate()
    svg = mark_svg()
    assets = ROOT / 'docs/assets'
    for name in ('mark.svg', 'favicon.svg'):
        (assets / name).write_text(svg, encoding='utf-8', newline='\n')
    receipt = {'source_repository': 'BigBirdReturns/axm-tools', 'git_blobs': checked['sources'], 'columns': 16, 'rows': 18, 'occupied_cells': 79, 'reinterpretation': False, 'font_files_distributed': False}
    (assets / 'identity.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8', newline='\n')
    return receipt

if __name__ == '__main__':
    print(json.dumps(render(), indent=2))
