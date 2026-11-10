# The marks fits as boards (python3 cells/lab/devtools/splats-marks-board.py [out.jpg] [names…]): a row a teacher mark;
# across: the teacher, then each way of drawing it (devtools/out/marks/render-<name>-<way>.png), at twice the size.
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); D = f'{HERE}/out/marks/'
out = sys.argv[1] if len(sys.argv) > 1 else D + 'board.jpg'; names = sys.argv[2:] or [t['name'] for t in json.load(open(D + 'targets.json'))]
WAYS = sys.argv and os.environ.get('WAYS', 'teacher,independent,organised,organised+deposits,brush').split(',')
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except Exception: F = None
K = float(os.environ.get('K', 2)); rows = []
for n in names:
  cells = []
  for w in WAYS:
    ws = [w] if w != 'style' else [f for f in os.listdir(D) if f.startswith(f'render-{n}-style of ') and 'browser' not in f]
    f = D + (ws[0] if w == 'style' and ws else f'render-{n}-{w}.png')
    if not os.path.exists(f): continue
    im = Image.open(f).convert('RGB'); k = max(K, min(3.2, 170 / im.width))  # (a narrow sheet drawn larger, so its labels fit)
    cells.append((w if w != 'style' else ws[0][len(f'render-{n}-'):-4], im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)))
  if cells: rows.append((n, cells))
W = max(sum(c[1].width + 10 for c in r[1]) for r in rows) + 10; H = sum(r[1][0][1].height + 34 for r in rows) + 10
B = Image.new('RGB', (W, H), (250, 247, 240)); dr = ImageDraw.Draw(B); y = 8
for n, cells in rows:
  x = 10
  for w, im in cells: dr.text((x + 2, y), f'{n}: {w}' if w == 'teacher' else w, fill=(40, 36, 30), font=F); B.paste(im, (x, y + 22)); x += im.width + 10
  y += cells[0][1].height + 34
B.save(out, quality=88); print(out, B.size)
