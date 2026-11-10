# Walking into a wash: the board (python3 cells/lab/devtools/splats-walk-board.py, after splats-walk.mjs).
# static/splats/b-walk.jpg: one canopy patch on a straight approach, four ways (devtools/out/walk/strip-*.png).
import json, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/'; OUT = D + 'out/walk/'
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except Exception: F = ImageFont.load_default()
J = json.load(open(OUT + 'walk.json')); n = max(J['ways']['fronds']['drawn']); w0 = max(J['ways']['wash']['drawn'])
ROWS = [('fronds', f'every strand and leaf, all the way ({n:,} deposits): the reference for tone'), ('wash', f'the far wash alone ({w0} deposits), fitted to the fronds as they look from 12 m and 9 m'),
        ('hand-over', 'hand-over: the wash far off, the fronds close to, complementary between about 7 m and 3.5 m'), ('switch', 'the same two swapped all at once at 5 m')]
AT = ['12 m', '9 m', '7 m', '5.6 m', '4.4 m', '3.2 m', '2 m', '0.8 m']
W = 1762; strips = [Image.open(f'{OUT}strip-{k}.png').convert('RGB') for k, _ in ROWS]; k = W / strips[0].width; h = round(strips[0].height * k)
B = Image.new('RGB', (W + 20, 22 + len(ROWS) * (h + 24) + 6), (250, 247, 240)); dr = ImageDraw.Draw(B)
for i, a in enumerate(AT): dr.text((10 + (i + 1) * W / 8 - 12 - dr.textlength(a, font=F), 4), a, fill=(110, 104, 96), font=F)
for r, (_, label) in enumerate(ROWS):
    y = 22 + r * (h + 24); dr.text((10, y), label, fill=(40, 36, 32), font=F); B.paste(strips[r].resize((W, h), Image.LANCZOS), (10, y + 20))
B.save(D + '../static/splats/b-walk.jpg', quality=88); print('b-walk.jpg', B.size)
