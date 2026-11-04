// Random encounters for the thought exercise in static/labyrinth-encounters.md (node cells/lab/devtools/labyrinth-encounters-draw.mjs SEED N): two pieces, a relation, the action that brought them together, seeded so the draw is honest
let s = Number(process.argv[2] || 20261020);
const R = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(R() * a.length)];
const PIECES = ['tower', 'house', 'thin wall', 'thick wall', 'bridge', 'walkway (raised)', 'stair flight', 'terrace', 'arcade', 'pool', 'water channel', 'pitched roof', 'dome', 'court', 'cypress', 'pergola', 'bench', 'window', 'buttress', 'balcony', 'gate (arch)', 'earth bank', 'path (paved)', 'pier', 'rock outcrop', 'well', 'basin cascade', 'colonnade'];
const RELATIONS = ['end to side', 'side to side, touching', 'end to end', 'crossing through', 'on top of', 'beneath', 'corner to corner, diagonal', 'near miss, one cell gap', 'at a different height, overlapping in plan', 'wrapping round', 'inside', 'against, at an angle'];
const ACTIONS = ['A drawn toward B', 'B grown toward A', 'A placed onto B', 'A drawn through B', 'A raised beside B', 'A lowered into B', 'B added after A, overlapping', 'A repeated against B'];
for (let n = 1; n <= Number(process.argv[3] || 24); n++) { let a = pick(PIECES), b = pick(PIECES); console.log(`${String(n).padStart(2, '0')}  A=${a} · B=${b} · ${pick(RELATIONS)} · ${pick(ACTIONS)}`); }
