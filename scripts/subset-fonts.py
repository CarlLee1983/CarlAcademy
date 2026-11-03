"""Rebuild local WOFF2 subsets: python3 scripts/subset-fonts.py NOTO.ttf SPACE.ttf.
Requires fonttools[woff] (build-time maintainer tool, not a website dependency).
Sources: google/fonts ofl/notosanstc/NotoSansTC[wght].ttf and
ofl/spacegrotesk/SpaceGrotesk[wght].ttf. Their OFL licenses accompany the output.
"""
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

text = ''.join(p.read_text() for root in ['docs', 'src'] for p in Path(root).rglob('*') if p.suffix in ['.md', '.astro', '.ts'])
text += ''.join(chr(n) for n in range(32, 127))
for source, name, low, high in [(sys.argv[1], 'noto-sans-tc', 400, 700), (sys.argv[2], 'space-grotesk', 400, 700)]:
    font = TTFont(source)
    options = subset.Options()
    options.flavor = 'woff2'
    sub = subset.Subsetter(options=options)
    sub.populate(text=text if name == 'noto-sans-tc' else ''.join(chr(n) for n in range(32, 383)))
    sub.subset(font)
    font = instantiateVariableFont(font, {'wght': (low, high)}, inplace=True)
    font.flavor = 'woff2'
    font.save(f'public/fonts/{name}.woff2')
