# One limb, three ways: the boards (python3 cells/lab/devtools/splats-limb-board.py, after splats-limb-shots.mjs).
# static/splats/b-limb.jpg: the teacher's drawings of this limb where it's about as large (its restyles of three of the
# room's views, the limb's line marked at its ends), over the limb in parts, as a sweep, and as a sweep with accents,
# each from far, medium and close in the real renderer.
# static/splats/b-limb-move.jpg: each way along the camera's move, far to close.
import json, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = D + 'out/limb/'; ST = D + '../static/splats/'
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15); FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
except Exception: F = FS = ImageFont.load_default()
PAPER = (239, 231, 216); INK = (40, 36, 32)
TW, TH = 480, 320; PAD = 6; LEFT = 150; TOP = 30
KEY = 'tunnel/arch 2'
spines = json.load(open(D + 'out/pool/spines.json'))
TEACH = [('far', 'sideways-from-the-stones', '8-sideways-from-the-stones'), ('medium', 'back-along-the-tunnel', '7-back-along-the-tunnel'), ('close', 'tunnel', '1-tunnel')]
def teacher(view, f):
    im = Image.open(D + f'conservatory/teachers2/{f}.jpg').convert('RGB'); W, H = im.size
    pts = [x for x in spines if x['view'] == view and x['key'] == KEY][0]['pts']
    im = im.resize((TW, TH), Image.LANCZOS); dr = ImageDraw.Draw(im); k = TW / W
    # (which limb: a tick across its line a little way in from each end of what's in the picture, and one at its middle)
    seen = [p for p in pts if 0 <= p[0] < W and 0 <= p[1] < H]
    for q in (seen[len(seen) // 8], seen[len(seen) // 2], seen[-len(seen) // 8 - 1]):
        i = pts.index(q); a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]; tx, ty = b[0] - a[0], b[1] - a[1]; L = (tx * tx + ty * ty) ** 0.5 or 1; nx, ny = -ty / L, tx / L; r = q[2] * k * 1.5 + 6
        for s in (-1, 1): dr.line([(q[0] * k + s * nx * r, q[1] * k + s * ny * r), (q[0] * k + s * nx * (r + 9), q[1] * k + s * ny * (r + 9))], fill=(200, 60, 40), width=2)
    return im
ROWS = [('the teacher', None), ('in parts', 'parts'), ('a sweep', 'sweep'), ('a sweep\nwith accents', 'accents')]
COLS = [('far', 'far'), ('medium', 'mid'), ('close', 'close')]
B = Image.new('RGB', (LEFT + 3 * (TW + PAD), TOP + len(ROWS) * (TH + PAD)), (255, 255, 255)); dr = ImageDraw.Draw(B)
for c, (label, _) in enumerate(COLS): dr.text((LEFT + c * (TW + PAD) + 6, 6), label, fill=INK, font=F)
for r, (label, way) in enumerate(ROWS):
    y = TOP + r * (TH + PAD); dr.multiline_text((8, y + 8), label, fill=INK, font=F, spacing=4)
    if way is None: dr.multiline_text((8, y + 34), 'its restyles of\nthree views of\nthe room; this\nlimb between\nthe red ticks', fill=(110, 104, 96), font=FS, spacing=3)
    for c, (_, at) in enumerate(COLS):
        im = teacher(TEACH[c][1], TEACH[c][2]) if way is None else Image.open(f'{OUT}{way}-{at}.png').convert('RGB').resize((TW, TH), Image.LANCZOS)
        B.paste(im, (LEFT + c * (TW + PAD), y))
B.save(ST + 'b-limb.jpg', quality=88); print(ST + 'b-limb.jpg', B.size)
# ─── the move ───
mv = json.load(open(OUT + 'move.json')); ks = sorted({int(f.split('-move-')[1][:2]) for f in os.listdir(OUT) if '-move-' in f}); MW, MH = 240, 160
B = Image.new('RGB', (LEFT + len(ks) * (MW + 3), TOP + 3 * (MH + PAD)), (255, 255, 255)); dr = ImageDraw.Draw(B)
for c, k in enumerate(ks): dr.text((LEFT + c * (MW + 3) + 4, 8), f"{mv['parts']['series'][k]['d']:.1f} m", fill=INK, font=FS)
for r, (label, way) in enumerate(ROWS[1:]):
    y = TOP + r * (MH + PAD); dr.multiline_text((8, y + 8), label, fill=INK, font=F, spacing=4)
    dr.multiline_text((8, y + 60), f"largest step in ink\nbetween frames\n×{2.718281828 ** mv[way]['worst']:.2f} at {mv[way]['at']} m", fill=(110, 104, 96), font=FS, spacing=3)
    for c, k in enumerate(ks): B.paste(Image.open(f'{OUT}{way}-move-{k:02d}.png').convert('RGB').resize((MW, MH), Image.LANCZOS), (LEFT + c * (MW + 3), y))
B.save(ST + 'b-limb-move.jpg', quality=86); print(ST + 'b-limb-move.jpg', B.size)
