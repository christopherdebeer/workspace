# One limb, three renderers: the boards (python3 cells/lab/devtools/splats-limb-board2.py, after splats-limb-shots.mjs
# run both ways). static/splats/b-limb-fit.jpg: from the teacher's own cameras (two it was fitted to, two it wasn't):
# the teacher's drawing of this limb (the rest of its restyle faded), the sweep as deposits, the sweep on a surface,
# the deposits fitted. static/splats/b-limb-renderers.jpg: the three from the scene's camera: far, medium, close, and
# close with the limb's crown bent. static/splats/b-limb-move2.jpg: each along the camera's move.
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)) + '/'; OUT = D + 'out/limb/'; ST = D + '../static/splats/'
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15); FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
except Exception: F = FS = ImageFont.load_default()
INK, GREY, PAPER = (40, 36, 32), (110, 104, 96), np.array([250, 244, 232], np.float32)
KEY = 'tunnel/arch 2'; spines = json.load(open(D + 'out/pool/spines.json'))
WAYS = [('sweep', 'the sweep,\nas deposits', '3,240 Gaussian deposits\non the gesture\'s lattice'), ('shader', 'the sweep,\non a surface', 'no deposits: the same\ngesture worked out\na pixel at a time'), ('fitted', 'deposits,\nfitted', 'the same 3,240, three in\nten moved, each one\'s ink,\nplace and size fitted'), ('baked', 'the teacher\'s ink,\non the surface', 'no deposits: its two\ndrawings painted onto\nthe limb as a texture')]
def teacher(view, n, box=None):
    im = np.asarray(Image.open(D + f'conservatory/teachers2/{n}-{view}.jpg').convert('RGB').resize((1536, 1024)), np.float32)
    pts = [x for x in spines if x['view'] == view and x['key'] == KEY][0]['pts']; near = np.zeros((1024, 1536), bool); yy, xx = np.mgrid[0:1024, 0:1536]
    for p in pts[::2]:
        r = p[2] * 1.5 + 6; x0, x1, y0, y1 = int(max(0, p[0] - r)), int(min(1536, p[0] + r + 1)), int(max(0, p[1] - r)), int(min(1024, p[1] + r + 1))
        if x1 > x0 and y1 > y0: near[y0:y1, x0:x1] |= np.hypot(xx[y0:y1, x0:x1] - p[0], yy[y0:y1, x0:x1] - p[1]) < r
    out = np.where(near[..., None], im, PAPER + (im - PAPER) * 0.22); return Image.fromarray(out.astype(np.uint8))
# ─── from the teacher's cameras ───
VIEWS = [('tunnel', 1, 'fitted to'), ('back-along-the-tunnel', 7, 'fitted to'), ('canopy', 5, 'not fitted to'), ('sideways-from-the-stones', 8, 'not fitted to')]
TW, TH, PAD, LEFT, TOP = 432, 288, 6, 170, 44
B = Image.new('RGB', (LEFT + len(VIEWS) * (TW + PAD), TOP + (len(WAYS) + 1) * (TH + PAD)), (255, 255, 255)); dr = ImageDraw.Draw(B)
for c, (v, n, how) in enumerate(VIEWS):
    dr.text((LEFT + c * (TW + PAD) + 6, 6), v.replace('-', ' '), fill=INK, font=F); dr.text((LEFT + c * (TW + PAD) + 6, 26), how, fill=GREY, font=FS)
    B.paste(teacher(v, n).resize((TW, TH), Image.LANCZOS), (LEFT + c * (TW + PAD), TOP))
    for r, (way, _, _) in enumerate(WAYS): B.paste(Image.open(f'{OUT}r-{way}-{v}.png').convert('RGB').resize((TW, TH), Image.LANCZOS), (LEFT + c * (TW + PAD), TOP + (r + 1) * (TH + PAD)))
dr.multiline_text((8, TOP + 8), 'the teacher', fill=INK, font=F); dr.multiline_text((8, TOP + 34), 'its drawing of this\nlimb; the rest of its\nrestyle faded', fill=GREY, font=FS, spacing=3)
for r, (_, label, sub) in enumerate(WAYS): y = TOP + (r + 1) * (TH + PAD); dr.multiline_text((8, y + 8), label, fill=INK, font=F, spacing=4); dr.multiline_text((8, y + 54), sub, fill=GREY, font=FS, spacing=3)
B.save(ST + 'b-limb-fit.jpg', quality=88); print('b-limb-fit.jpg', B.size)
# ─── from the scene's camera: far, medium, close, close and bent ───
if os.path.exists(f'{OUT}shader-far.png'):
    COLS = [('far', 'far', None), ('medium', 'mid', None), ('close', 'close', None), ('close, its crown bent', 'bent', None)]
    TW, TH = 432, 288; B = Image.new('RGB', (LEFT + len(COLS) * (TW + PAD), 30 + len(WAYS) * (TH + PAD)), (255, 255, 255)); dr = ImageDraw.Draw(B)
    for c, (label, at, _) in enumerate(COLS):
        dr.text((LEFT + c * (TW + PAD) + 6, 6), label, fill=INK, font=F)
        for r, (way, _, _) in enumerate(WAYS): B.paste(Image.open(f'{OUT}{way}-{at}.png').convert('RGB').resize((TW, TH), Image.LANCZOS), (LEFT + c * (TW + PAD), 30 + r * (TH + PAD)))
    for r, (_, label, sub) in enumerate(WAYS): y = 30 + r * (TH + PAD); dr.multiline_text((8, y + 8), label, fill=INK, font=F, spacing=4); dr.multiline_text((8, y + 54), sub, fill=GREY, font=FS, spacing=3)
    B.save(ST + 'b-limb-renderers.jpg', quality=88); print('b-limb-renderers.jpg', B.size)
    # (close up, at the shots' own size: what an edge and a dry stretch look like)
    CW = 440; B = Image.new('RGB', (len(WAYS) * (CW + PAD) - PAD, CW + 30), (255, 255, 255)); dr = ImageDraw.Draw(B)
    for c, (way, label, _) in enumerate(WAYS): im = Image.open(f'{OUT}{way}-close.png').convert('RGB'); w, h = im.size; B.paste(im.crop((w // 2 - 60, 30, w // 2 - 60 + CW, 30 + CW)), (c * (CW + PAD), 30)); dr.text((c * (CW + PAD) + 4, 6), label.replace('\n', ' '), fill=INK, font=F)
    B.save(ST + 'b-limb-edges.jpg', quality=90); print('b-limb-edges.jpg', B.size)
    mv = json.load(open(OUT + 'move.json')) if os.path.exists(OUT + 'move.json') else {}
    if all(w in mv for w, _, _ in WAYS):
        ks = sorted({int(f.split('-move-')[1][:2]) for f in os.listdir(OUT) if f.startswith('shader-move-')}); MW, MH = 240, 160
        B = Image.new('RGB', (LEFT + len(ks) * (MW + 3), 30 + len(WAYS) * (MH + PAD)), (255, 255, 255)); dr = ImageDraw.Draw(B)
        for c, k in enumerate(ks): dr.text((LEFT + c * (MW + 3) + 4, 8), f"{mv['sweep']['series'][k]['d']:.1f} m", fill=INK, font=FS)
        for r, (way, label, _) in enumerate(WAYS):
            y = 30 + r * (MH + PAD); dr.multiline_text((8, y + 8), label, fill=INK, font=F, spacing=4); dr.multiline_text((8, y + 60), f"largest step in ink\nbetween frames\n×{2.718281828 ** mv[way]['worst']:.2f} at {mv[way]['at']} m", fill=GREY, font=FS, spacing=3)
            for c, k in enumerate(ks): B.paste(Image.open(f'{OUT}{way}-move-{k:02d}.png').convert('RGB').resize((MW, MH), Image.LANCZOS), (LEFT + c * (MW + 3), y))
        B.save(ST + 'b-limb-move2.jpg', quality=86); print('b-limb-move2.jpg', B.size)
