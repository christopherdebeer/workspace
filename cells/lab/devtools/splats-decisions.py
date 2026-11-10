# Decisions as the unit: a drawing rule learned from drawn teachers (python3 cells/lab/devtools/splats-decisions.py
# [styles, comma-separated; default the three sumi executions]).
#
# A restyled view, projected onto the scene's geometry, is a short list of decisions (splats-field-measure.py): how
# much ink along each edge in sight, how much tone on each face, the ground's shadow. Here each decision is predicted
# from what the hand could see of its edge or face: what kind of thing it is, which object's, how its faces are turned
# to the eye and across the picture (the teachers' light is the picture's, upper left), whether it's on the outline,
# how it runs on the screen, how big and how high it is. One small network for every edge and face (a rule, not a
# table), so it's taught by every decision in every view at once, and asked about a view it never saw.
#
# Tested leaving one view out at a time (all six in turn), against:
# - blank paper;
# - its own mean: each edge's or face's average over the other five views (a table, no view dependence);
# - a table with a view term: the same, plus a linear fit in the view direction per entry;
# - another hand's decisions for the same view (a sibling execution, where there is one).
# Writes devtools/out/field/decision-rule.json (the rule fitted to all views, for the page).
import json, sys, importlib.util, itertools, numpy as np
base = __file__.rsplit('/', 1)[0]
spec = importlib.util.spec_from_file_location('measure', f'{base}/splats-field-measure.py'); Mz = importlib.util.module_from_spec(spec); spec.loader.exec_module(Mz)
STY = (sys.argv[1] if len(sys.argv) > 1 else 'sumi,sumi-bold,sumi-light').split(','); VIEWS = Mz.VIEWS; M = Mz.M; T = Mz.T
norm = lambda a: a / (np.linalg.norm(a, axis=-1, keepdims=True) + 1e-12)
# (each face: its object, its normal faced away from the object's middle, its middle)
objs = sorted(set(Mz.OBJ)); omid = {o: T[Mz.OBJ == o].reshape(-1, 3).mean(0) for o in objs}
F = []
for f, (o, n, d) in enumerate(Mz.faces):
  c = T[Mz.face_of == f].reshape(-1, 3).mean(0); out = c - omid[o]
  if abs(n[1]) < 0.5: out = np.array([out[0], 0, out[2]])
  F.append({'obj': o, 'n': n if np.dot(n, out) >= 0 else -n, 'c': c})
KINDS = ['crease', 'silhouette', 'line seam', 'line node', 'line niche', 'face', 'ground, lower', 'ground, upper']
def kind(name):
  if name.startswith('line'): return 'line seam' if 'seam' in name else 'line niche' if 'niche' in name else 'line node'
  return next(k for k in KINDS if name.startswith(k))
NF = len(KINDS) + len(objs) + 12
def features(name, view):
  cam = next(c for c in M['cams'] if c['name'] == view); E = np.array(cam['eye']); fw = norm(np.array(cam['target']) - E); r = norm(np.cross(fw, [0, 1, 0])); u = np.cross(r, fw)
  x = np.zeros(NF); k = kind(name); x[KINDS.index(k)] = 1; o0 = len(KINDS); g = o0 + len(objs)
  pts = Mz.GEO[view]['edges'].get(name)
  if pts is not None and len(pts) > 2:
    # (how it runs on the screen, how long, where)
    c = pts.mean(0); d = pts - c; cv = d.T @ d; w, v = np.linalg.eigh(cv); a = v[:, -1]; th = np.arctan2(a[1], a[0])
    x[g + 6] = np.cos(2 * th); x[g + 7] = np.sin(2 * th); x[g + 8] = min(1, len(pts) / 400); x[g + 9] = c[1] / Mz.H; x[g + 10] = c[0] / Mz.W
  if k == 'crease':
    f1, f2 = (int(v) for v in name.split(' ')[1].split('-')); A, B = F[f1], F[f2]; x[o0 + objs.index(A['obj'])] = 1
    a1 = float(np.dot(A['n'], norm(E - A['c']))); a2 = float(np.dot(B['n'], norm(E - B['c'])))
    x[g] = min(a1, a2); x[g + 1] = max(a1, a2); x[g + 2] = float((a1 > 0) != (a2 > 0))
    nm = A['n'] if a1 > a2 else B['n']; x[g + 3] = float(nm @ r); x[g + 4] = float(nm @ u); x[g + 5] = float(nm[1])
    x[g + 11] = float(np.dot(A['n'], B['n']))
  elif k == 'silhouette': x[o0 + objs.index(int(name.split('obj')[1]))] = 1
  elif k == 'line node': x[o0 + (1 if 'front' in name else 2 if 'back' in name else 3)] = 1
  elif k == 'line seam': x[o0] = 1
  elif k == 'line niche': x[o0 + len(objs) - 1] = 1
  elif k == 'face':
    A = F[int(name.split(' ')[1])]; x[o0 + objs.index(A['obj'])] = 1; a = float(np.dot(A['n'], norm(E - A['c'])))
    x[g] = a; x[g + 1] = a; x[g + 3] = float(A['n'] @ r); x[g + 4] = float(A['n'] @ u); x[g + 5] = float(A['n'][1])
    m = Mz.GEO[view]['fid'] == int(name.split(' ')[1]); ys = np.where(m.any(1))[0]
    x[g + 8] = min(1, m.sum() / 40000); x[g + 9] = (ys.mean() / Mz.H) if len(ys) else 0
  return x

DEC = {(s, v): Mz.decisions(Mz.darkness(s, v), v) for s in STY for v in VIEWS}
rows = [(s, v, n, features(n, v), y) for (s, v), d in DEC.items() for n, y in d.items()]
print(f'{len(rows)} decisions: {len(STY)} executions x {len(VIEWS)} views, {len(rows) // (len(STY) * len(VIEWS))} a view; {NF} features (+ the execution)')

def fit(train, seed=0, hidden=16, iters=3000, wd=3e-3):
  # (a small network: features and the execution (one-hot, so each hand has its own weight of ink) -> a decision in 0..1)
  rng = np.random.default_rng(seed)
  X = np.array([np.concatenate([x, np.eye(len(STY))[STY.index(s)]]) for s, v, n, x, y in train]); Y = np.array([y for *_, y in train])
  W1 = rng.normal(0, 0.3, (X.shape[1], hidden)); b1 = np.zeros(hidden); W2 = rng.normal(0, 0.3, hidden); b2 = -1.0
  P = [W1, b1, W2]; m = [np.zeros_like(p) for p in P]; v2 = [np.zeros_like(p) for p in P]; mb = vb = 0.0
  for it in range(1, iters + 1):
    Hh = np.tanh(X @ W1 + b1); z = Hh @ W2 + b2; p = 1 / (1 + np.exp(-z)); g = 2 * (p - Y) * p * (1 - p) / len(Y)
    gW2 = Hh.T @ g + wd * W2; gH = np.outer(g, W2) * (1 - Hh ** 2); gW1 = X.T @ gH + wd * W1; gb1 = gH.sum(0); gb2 = g.sum()
    for i, gp in enumerate((gW1, gb1, gW2)):
      m[i] = 0.9 * m[i] + 0.1 * gp; v2[i] = 0.999 * v2[i] + 0.001 * gp * gp; P[i] -= 0.02 * (m[i] / (1 - 0.9 ** it)) / (np.sqrt(v2[i] / (1 - 0.999 ** it)) + 1e-8)
    mb = 0.9 * mb + 0.1 * gb2; vb = 0.999 * vb + 0.001 * gb2 * gb2; b2 -= 0.02 * (mb / (1 - 0.9 ** it)) / (np.sqrt(vb / (1 - 0.999 ** it)) + 1e-8)
  return {'W1': W1, 'b1': b1, 'W2': W2, 'b2': float(b2)}
def predict(net, s, x): h = np.tanh(np.concatenate([x, np.eye(len(STY))[STY.index(s)]]) @ net['W1'] + net['b1']); return float(1 / (1 + np.exp(-(h @ net['W2'] + net['b2']))))

res = {k: [] for k in ('blank', 'own mean', 'table + view', 'rule', 'rule, this hand alone', 'sibling')}; cor = {k: [] for k in res}
for hold in VIEWS:
  tr = [r for r in rows if r[1] != hold]; net = fit(tr)
  for s in STY:
    te = [r for r in rows if r[1] == hold and r[0] == s]; y = np.array([r[4] for r in te])
    net1 = fit([r for r in tr if r[0] == s])
    own = {};
    for r in tr:
      if r[0] == s: own.setdefault(r[2], []).append((r[1], r[4]))
    gm = np.mean([r[4] for r in tr if r[0] == s])
    cam = {c['name']: norm(np.array(c['eye']) - np.array(c['target'])) for c in M['cams']}
    def table(n, viewterm):
      if n not in own: return gm
      vs, ys = zip(*own[n]); ys = np.array(ys)
      if not viewterm or len(ys) < 4: return float(ys.mean())
      A = np.array([np.concatenate([[1], cam[v]]) for v in vs]); w = np.linalg.solve(A.T @ A + 0.05 * np.eye(4), A.T @ ys)
      return float(np.clip(np.concatenate([[1], cam[hold]]) @ w, 0, 1))
    preds = {'blank': np.zeros_like(y), 'own mean': np.array([table(r[2], False) for r in te]), 'table + view': np.array([table(r[2], True) for r in te]),
             'rule': np.array([predict(net, s, r[3]) for r in te]), 'rule, this hand alone': np.array([predict(net1, s, r[3]) for r in te])}
    sib = [t for t in STY if t != s and {s, t} == {'sumi-bold', 'sumi-light'}]
    if sib: preds['sibling'] = np.array([DEC[(sib[0], hold)].get(r[2], 0) for r in te])
    for k, p in preds.items():
      res[k].append(float(((p - y) ** 2).mean()) * 1000)
      if p.std() > 0: cor[k].append(float(np.corrcoef(p, y)[0, 1]))
print(f'\nleaving one view out, all six in turn, {len(STY)} executions:\n  {"what predicts the held-out view":34s} {"decision error":>15s} {"agreement":>10s}')
for k in res:
  if res[k]: print(f'  {k:34s} {np.mean(res[k]):15.1f} {(np.mean(cor[k]) if cor[k] else float("nan")):10.2f}')
# ─── does the rule carry to geometry it never saw? each object held out whole (every view), the rule taught by the
# others, against the average decision for that kind of thing (crease, face, …) among the others ───
o0 = len(KINDS); names = {1: 'the stone', 2: 'a culm', 3: 'a culm', 4: 'a culm', 5: 'the corner'}
print(f'\nleaving one object out (all its edges and faces, every view):\n  {"object":12s} {"decisions":>10s} {"blank":>8s} {"kind mean":>10s} {"rule":>8s} {"rule agreement":>15s}')
tot = {'blank': [], 'kind': [], 'rule': [], 'r': []}
for oi, o in enumerate(objs):
  te = [r for r in rows if r[3][o0 + oi] == 1]; tr = [r for r in rows if r[3][o0:o0 + len(objs)].sum() == 1 and r[3][o0 + oi] == 0]
  if len(te) < 12: continue
  # (the held-out object's own slot tells the rule nothing: it's never been on in training)
  netO = fit(tr); y = np.array([r[4] for r in te]); pr = np.array([predict(netO, r[0], r[3]) for r in te])
  km = {}
  for r in tr: km.setdefault((r[0], kind(r[2])), []).append(r[4])
  pk = np.array([np.mean(km.get((r[0], kind(r[2])), [0.3])) for r in te])
  eb, ek, er = float((y ** 2).mean()) * 1000, float(((pk - y) ** 2).mean()) * 1000, float(((pr - y) ** 2).mean()) * 1000; c = float(np.corrcoef(pr, y)[0, 1])
  tot['blank'].append(eb); tot['kind'].append(ek); tot['rule'].append(er); tot['r'].append(c)
  print(f'  {names.get(int(o), str(o)):12s} {len(te):10d} {eb:8.1f} {ek:10.1f} {er:8.1f} {c:15.2f}')
print(f'  {"mean":12s} {"":10s} {np.mean(tot["blank"]):8.1f} {np.mean(tot["kind"]):10.1f} {np.mean(tot["rule"]):8.1f} {np.mean(tot["r"]):15.2f}')
net = fit(rows)
json.dump({'styles': STY, 'kinds': KINDS, 'objects': [int(o) for o in objs], 'features': NF, 'W1': net['W1'].tolist(), 'b1': net['b1'].tolist(), 'W2': net['W2'].tolist(), 'b2': net['b2']}, open(f'{base}/out/field/decision-rule.json', 'w'))
print('\nwrote devtools/out/field/decision-rule.json (the rule fitted to every view)')

# ─── the decisions as a table for the page (client/splats/taught.ts): each entry's place in the scene (a few points),
# its kind, and each teacher's decision for it, averaged over the views it's in sight; and the same leaving the right
# view out, so a drawing made from the table can be scored on a view the table never saw ───
def place(name):
  k = kind(name)
  if k == 'crease':
    f1, f2 = (int(v) for v in name.split(' ')[1].split('-')); pts = []
    for (a, b), ts in Mz.edges.items():
      if len(ts) == 2 and sorted((int(Mz.face_of[ts[0]]), int(Mz.face_of[ts[1]]))) == [f1, f2]: pts += [np.array(a), (np.array(a) + np.array(b)) / 2, np.array(b)]
    return pts
  if k == 'silhouette': o = int(name.split('obj')[1]); v = T[Mz.OBJ == o].reshape(-1, 3); return list(v[:: max(1, len(v) // 8)])
  if k.startswith('line'): return [np.array(q) for L in M['lines'] if f'line {L["name"]}' == name for q in L['pts'][:: max(1, len(L['pts']) // 6)]]
  if k == 'face': v = T[Mz.face_of == int(name.split(' ')[1])].reshape(-1, 3); return [v.mean(0)] + list(v[:: max(1, len(v) // 5)])
  return []
names = sorted({n for d in DEC.values() for n in d})
table = {}
for s_ in STY:
  for tag, vs in ((s_, VIEWS), (f'{s_}-minus-right', [v for v in VIEWS if v != 'right'])):
    table[tag] = [round(float(np.mean([DEC[(s_, v)][n] for v in vs if n in DEC[(s_, v)]])) if any(n in DEC[(s_, v)] for v in vs) else -1, 3) for n in names]
def obj_of(name, pts):
  k = kind(name)
  if k == 'crease': return int(F[int(name.split(' ')[1].split('-')[0])]['obj'])
  if k == 'face': return int(F[int(name.split(' ')[1])]['obj'])
  if k == 'silhouette': return int(name.split('obj')[1])
  if not pts: return 0
  c = np.mean(pts, 0); return int(min(objs, key=lambda o: np.hypot(omid[o][0] - c[0], omid[o][2] - c[2])))
ents = []
for n in names: pl = place(n); ents.append({'name': n, 'kind': kind(n), 'obj': obj_of(n, pl), 'pts': [[round(float(c), 3) for c in q] for q in pl][:10]})
open(f'{base}/../client/splats/taught.ts', 'w').write(
  '/**\n * What drawn teachers decided, as a table (devtools/splats-decisions.py): for each edge and face of the composed scene\n'
  ' * (its place, a few points; its kind), each teacher\'s decision: how much ink lies along it, or how much tone is on it,\n'
  ' * averaged over the views it\'s in sight (0 none … 1 full; -1 never in sight). The teachers are an image model\'s sumi-e\n'
  ' * restyles of the scene\'s wireframes; "-minus-right" leaves the right view out, for scoring a drawing on a view the\n'
  ' * table never saw.\n */\n'
  f'export const TAUGHT: {{ entries: Array<{{ name: string; kind: string; obj: number; pts: number[][] }}>; teachers: Record<string, number[]> }} = {json.dumps({"entries": ents, "teachers": table}, separators=(",", ":"))};\n')
print(f'wrote client/splats/taught.ts ({len(ents)} entries, {len(table)} tables)')

