/** Afterword: RSVP with peripheral context, on a steady beat; the URL fragment is the only state store.
 * - every word lands on a beat; punctuation and paragraph ends add rests in half-beats, so the pulse never wavers;
 * - the BPM (top right) is set by tapping it (tap tempo) or by the slider, and holds until changed;
 * - previous words end where the current word begins, upcoming words begin where it ends, just above and below it. */
type Mode = 'off' | 'rail' | 'passage';
type Sound = 'off' | 'click' | 'bass' | 'both';
type Group = 'clause' | 'sentence' | '2' | '3' | '4' | '6' | '8';
type State = { text: string; i: number; bpm: number; mode: Mode; span: number; opacity: number; pause: number; font: number; sound: Sound; volume: number; group: Group; ui: 'full' | 'min'; run: boolean };
type Word = { w: string; par: boolean; sent: boolean; clause: boolean };
const SAMPLE = "Reading is not a race between the eye and the page. The mind gathers meaning in phrases, anticipates what might come next, and sometimes moves backward to repair an incomplete thought.\n\nWhat changes when the next few words remain visible, but subdued? Perhaps a small preview restores anticipation without demanding a saccade. Perhaps a trace of previous words makes regression possible without losing the reading point.\n\nThis is an experiment, not a promise of faster comprehension. Find a pace that lets the sentence form. Then touch the surface: left to step back, right to step forward, swipe to scan, or use the timeline to seek.";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const num = (s: string | null, d: number, a: number, b: number) => clamp(s !== null && s.trim() !== '' && Number.isFinite(+s) ? +s : d, a, b);
const GROUPS: Group[] = ['clause', 'sentence', '2', '3', '4', '6', '8'];
function decode(): State {
  const p = new URLSearchParams(location.hash.slice(1)), m = p.get('mode'), s = p.get('sound'), g = p.get('group') as Group | null;
  return {
    text: p.get('text') ?? SAMPLE, i: Math.floor(num(p.get('i'), 0, 0, 1e6)),
    // (bpm; an old link's wpm read as the same number of beats)
    bpm: Math.round(num(p.get('bpm') ?? p.get('wpm'), 300, 40, 1200)), mode: m === 'off' || m === 'passage' ? m : 'rail',
    span: Math.round(num(p.get('span'), 7, 1, 24)), opacity: Math.round(num(p.get('opacity'), 42, 0, 100)),
    pause: num(p.get('pause'), 1, 0, 3), font: Math.round(num(p.get('font'), 46, 28, 72)),
    sound: s === 'click' || s === 'bass' || s === 'both' ? s : 'off', volume: num(p.get('volume'), 38, 0, 100),
    group: g && GROUPS.includes(g) ? g : 'clause', ui: p.get('ui') === 'min' ? 'min' : 'full', run: false,
  };
}
const preview = new URLSearchParams(location.search).has('preview');
let state = decode(), words: Word[] = [], timer: ReturnType<typeof setTimeout> | null = null, audio: AudioContext | null = null;
// (the beat clock: when the current word's onset was, so the next lands a whole number of half-beats later, without drift)
let onset = 0;
let gesture: { id: number; x: number; y: number; initial: number; moved: boolean } | null = null;
const taps: number[] = [];
const stage = $('stage'), before = $('before'), after = $('after'), progress = $<HTMLInputElement>('progress'), wordEl = $('word');
const controlIds = ['bpm', 'mode', 'span', 'opacity', 'pause', 'font', 'sound', 'volume', 'group'] as const;

/** words with what ends them: a paragraph (a blank line), a sentence, a clause */
function split(s: string): Word[] {
  const out: Word[] = [];
  for (const para of s.split(/\n\s*\n/)) {
    const ws = para.match(/\S+/gu) || [];
    ws.forEach((w, k) => {
      const sent = /[.!?。！？…]["'”’)\]]*$/u.test(w), clause = sent || /[,，;:—–]["'”’)\]]*$/u.test(w);
      out.push({ w, par: k === ws.length - 1, sent, clause });
    });
  }
  return out;
}
function fragment() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (k !== 'run') p.set(k, String(v));
  return '#' + p.toString();
}
/** the address rewritten only when you stop, seek or change a setting (never on every word while it plays) */
function save() { if (!preview) history.replaceState(null, '', location.pathname + location.search + fragment()); }
function rebuild() { words = split(state.text); if (!words.length) words = [{ w: '—', par: true, sent: true, clause: true }]; state.i = clamp(Math.floor(state.i), 0, words.length - 1); progress.max = String(words.length - 1); }
function orp(w: string) {
  const chars = Array.from(w), letters: number[] = [];
  chars.forEach((c, i) => { if (/[\p{L}\p{N}]/u.test(c)) letters.push(i); });
  const n = letters.length, rank = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  return letters[Math.min(rank, n - 1)] ?? Math.floor(chars.length / 2);
}
/** where the context starts: in a passage, at the start of a sentence (never mid-sentence at the top edge) */
function from(i: number, n: number) {
  let a = Math.max(0, i - n);
  if (state.mode === 'passage') for (let k = a; k < i; k++) if (k === 0 || words[k - 1].sent) { a = k; break; }
  return a;
}
function ghost(el: HTMLElement, a: number, b: number, prior: boolean) {
  // (in a box of its own, so the previous words can sit at the foot of theirs, running into the word)
  const box = document.createElement('div'); box.className = 'ghost-box';
  el.replaceChildren(box); el.classList.toggle('passage', state.mode === 'passage');
  for (let k = a; k < b; k++) {
    const s = document.createElement('span'); s.className = 'ghost-token';
    const distance = prior ? b - 1 - k : k - a;
    if (state.mode !== 'passage') s.style.opacity = String(clamp(1 - distance / Math.max(1, state.span * 1.9), 0.22, 1));
    s.textContent = words[k].w;
    // (the previous words' last, held to a spacer the width of the gap to the word, so the line ends where the word begins)
    if (prior && k === b - 1) { const tail = Object.assign(document.createElement('span'), { className: 'tail' }); tail.append(s, Object.assign(document.createElement('span'), { className: 'run-in' })); box.appendChild(tail); }
    else box.appendChild(s);
    // (a paragraph's end is a break in the passage, as on the page)
    if (state.mode === 'passage' && words[k].par && k < b - 1) box.appendChild(Object.assign(document.createElement('span'), { className: 'par-gap' }));
    else if (k < b - 1) box.appendChild(document.createTextNode(' '));
  }
}
/** the context laid round the word as prose flowing through it: both blocks the full width; the previous words right-set,
 * their last line ending where the word starts (a spacer holds the gap), just above it; the next words' first line
 * indented to start where the word ends, just below it, the rest running on from the margin */
function place() {
  const W = stage.clientWidth, H = stage.clientHeight, sr = stage.getBoundingClientRect();
  const wb = $('word-before').getBoundingClientRect(), wa = $('word-after').getBoundingClientRect(), an = $('word-anchor').getBoundingClientRect();
  const left = (wb.width > 0 ? wb.left : an.left) - sr.left, right = (wa.width > 0 ? wa.right : an.right) - sr.left;
  const top = an.top - sr.top, bottom = an.bottom - sr.top, m = W * 0.05, gap = 6;
  Object.assign(before.style, { left: m + 'px', right: m + 'px', bottom: H - top + gap + 'px', top: 'auto' });
  Object.assign(after.style, { left: m + 'px', right: m + 'px', top: bottom + gap + 'px', bottom: 'auto' });
  const runIn = before.querySelector<HTMLElement>('.run-in'), box = after.querySelector<HTMLElement>('.ghost-box');
  // (unless the word leaves too little room beside it (under 30% of the width): then the line is a whole one of its own)
  if (runIn) runIn.style.width = left - m < W * 0.3 ? '0px' : Math.max(0, W - m - left + 4) + 'px';
  if (box) box.style.textIndent = W - m - right < W * 0.3 ? '0px' : Math.max(0, right - m + 4) + 'px';
}
/** the word's size: yours, unless a long word would run off the page, then only that word smaller */
function fit() {
  wordEl.style.fontSize = state.font + 'px';
  const W = stage.clientWidth, half = W / 2 - W * 0.04, an = $('word-anchor').getBoundingClientRect().width / 2;
  const need = Math.max($('word-before').getBoundingClientRect().width, $('word-after').getBoundingClientRect().width) + an;
  if (need > half) wordEl.style.fontSize = Math.max(16, Math.floor(state.font * (half / need))) + 'px';
}
function paint() {
  state.i = clamp(state.i, 0, words.length - 1);
  const w = words[state.i].w, chars = Array.from(w), p = orp(w);
  $('word-before').textContent = chars.slice(0, p).join('');
  $('word-anchor').textContent = chars[p] || ' ';
  $('word-after').textContent = chars.slice(p + 1).join('');
  $('readout').textContent = String(state.i + 1) + ' / ' + words.length;
  $('percentage').textContent = Math.round((100 * (state.i + 1)) / words.length) + '%';
  progress.value = String(state.i);
  $('mini-fill').style.width = (100 * state.i) / Math.max(1, words.length - 1) + '%';
  stage.style.setProperty('--ghost-opacity', String(state.mode === 'off' ? 0 : state.opacity / 100));
  stage.classList.toggle('no-context', state.mode === 'off');
  const n = state.mode === 'passage' ? state.span * 5 : state.span;
  ghost(before, from(state.i, n), state.i, true);
  ghost(after, state.i + 1, Math.min(words.length, state.i + 1 + n), false);
  fit(); place();
  stage.setAttribute('aria-label', 'Current word ' + w + '. Tap left to step back, right to step on, centre to play or pause. Drag to scan.');
}
function seek(i: number) { state.i = clamp(Math.round(i), 0, words.length - 1); paint(); }
function move(d: number) { seek(state.i + d); save(); }
/** how many beats a word holds: one, half again for a long word, and a rest after it for its punctuation (a comma half a
 * beat, a clause or sentence one, a paragraph two), the rests scaled by the pause setting in whole half-beats */
function beats(k: number) {
  const { w, par, sent, clause } = words[k], n = Array.from(w).filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
  let rest = par ? 2 : sent ? 1 : /[;:—–]["'”’)\]]*$/u.test(w) ? 1 : clause ? 0.5 : 0;
  rest = Math.round(rest * state.pause * 2) / 2;
  return 1 + (n >= 11 ? 0.5 : 0) + rest;
}
const period = () => 60000 / state.bpm;
function enableAudio() {
  if (state.sound === 'off' || preview) return;
  try {
    if (!audio) { const C = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext; audio = new C(); }
    if (audio.state !== 'running') void audio.resume();
  } catch { $('audio-status').textContent = 'Audio unavailable in this browser.'; }
}
function note(freq: number, len: number, gain: number, low = 0) {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime + 0.004, o = audio.createOscillator(), g = audio.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
  if (low) o.frequency.exponentialRampToValueAtTime(low, t + len * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + 0.007);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + len + 0.012);
  o.onended = () => { o.disconnect(); g.disconnect(); };
}
/** the bass on the words that start something: a clause, a sentence, or (to compare) every N words */
function accent(i: number) {
  if (state.group === 'clause') return i === 0 || words[i - 1].clause;
  if (state.group === 'sentence') return i === 0 || words[i - 1].sent;
  return i % +state.group === 0;
}
function beat() {
  pulse();
  if (!audio || audio.state !== 'running' || state.sound === 'off') return;
  const v = state.volume / 100;
  if (state.sound === 'click' || state.sound === 'both') note(1150, 0.032, 0.065 * v);
  if ((state.sound === 'bass' || state.sound === 'both') && accent(state.i)) note(118, 0.17, 0.23 * v, 54);
}
/** the readout's dot, on each word's beat */
function pulse() { const d = $('bpm-dot'); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); }
function stop(persist = true) {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  const was = state.run; state.run = false; $('play').textContent = '▶'; $('mini-play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Play reading');
  if (was && persist) save();
}
function schedule() {
  if (timer !== null) clearTimeout(timer);
  const at = onset + beats(state.i) * period();
  timer = setTimeout(next, Math.max(0, at - performance.now()));
}
function next() {
  timer = null; if (!state.run) return;
  if (state.i >= words.length - 1) { stop(); return; }
  onset += beats(state.i) * period();
  // (fallen far behind (a hidden tab, a stall): the beat picks up from now, not in a rush to catch up)
  if (performance.now() - onset > period()) onset = performance.now();
  state.i++; paint(); beat(); schedule();
}
function start() {
  if (state.run) return;
  if (state.i === words.length - 1) state.i = 0;
  state.run = true; enableAudio(); paint();
  $('play').textContent = 'Ⅱ'; $('mini-play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause reading');
  onset = performance.now(); beat(); schedule();
}
function toggle() { if (state.run) stop(); else start(); }
/** tap tempo: two or more taps on the BPM, each within two seconds of the last, set it from their mean interval; it holds
 * until you tap again or move the slider */
function tap() {
  const t = performance.now();
  if (taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(t); if (taps.length > 6) taps.shift();
  pulse();
  if (taps.length < 2) { $('bpm-unit').textContent = 'tap'; return; }
  const mean = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  state.bpm = clamp(Math.round(60000 / mean), 40, 1200);
  $('bpm-unit').textContent = 'bpm';
  refresh(); save();
  if (state.run) schedule();
}
function refresh() {
  $<HTMLInputElement>('bpm').value = String(state.bpm);
  $<HTMLSelectElement>('mode').value = state.mode;
  $<HTMLInputElement>('span').value = String(state.span);
  $<HTMLInputElement>('opacity').value = String(state.opacity);
  $<HTMLInputElement>('pause').value = String(state.pause);
  $<HTMLInputElement>('font').value = String(state.font);
  $<HTMLSelectElement>('sound').value = state.sound;
  $<HTMLInputElement>('volume').value = String(state.volume);
  $<HTMLSelectElement>('group').value = state.group;
  $('bpm-label').textContent = String(state.bpm);
  $('bpm-value').textContent = String(state.bpm);
  $('span-label').textContent = String(state.span);
  $('opacity-label').textContent = String(state.opacity) + '%';
  $('pause-label').textContent = state.pause.toFixed(1);
  $('font-label').textContent = String(state.font) + 'px';
  $('volume-label').textContent = String(state.volume) + '%';
  $('sound-options').hidden = state.sound === 'off';
  document.documentElement.classList.toggle('min', state.ui === 'min');
  $('collapse').setAttribute('aria-expanded', String(state.ui === 'full'));
}
function bind() {
  $('play').addEventListener('click', toggle);
  $('mini-play').addEventListener('click', toggle);
  $('back').addEventListener('click', () => { stop(); move(-1); });
  $('forward').addEventListener('click', () => { stop(); move(1); });
  $('back-sentence').addEventListener('click', () => { stop(); move(-10); });
  $('forward-sentence').addEventListener('click', () => { stop(); move(10); });
  $('bpm-tap').addEventListener('click', tap);
  $('collapse').addEventListener('click', () => { state.ui = 'min'; refresh(); save(); requestAnimationFrame(paint); });
  $('expand').addEventListener('click', () => { state.ui = 'full'; refresh(); save(); requestAnimationFrame(paint); });
  progress.addEventListener('pointerdown', () => stop());
  progress.addEventListener('input', () => seek(+progress.value));
  progress.addEventListener('change', () => save());
  stage.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, initial: state.i, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e: PointerEvent) => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 14) gesture.moved = true;
    if (!gesture.moved) return;
    if (state.run) stop(false);
    // (drag the text as you'd drag a page: leftward brings on what's next)
    const n = -Math.sign(dx) * Math.floor(Math.pow(Math.abs(dx) / 19, 1.24));
    seek(gesture.initial + n);
  });
  stage.addEventListener('pointerup', (e: PointerEvent) => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const g = gesture; gesture = null;
    if (!g.moved) {
      const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x < 0.34) { stop(); move(-1); } else if (x > 0.66) { stop(); move(1); } else toggle();
    } else save();
  });
  stage.addEventListener('pointercancel', () => { gesture = null; save(); });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,button,details,[contenteditable]')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); move(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); stop(); move(1); } else if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 't') tap();
  });
  for (const key of controlIds) {
    const el = $(key) as HTMLInputElement | HTMLSelectElement;
    el.addEventListener('input', () => {
      if (key === 'bpm') state.bpm = +el.value;
      else if (key === 'mode') state.mode = el.value as Mode;
      else if (key === 'span') state.span = +el.value;
      else if (key === 'opacity') state.opacity = +el.value;
      else if (key === 'pause') state.pause = +el.value;
      else if (key === 'font') state.font = +el.value;
      else if (key === 'sound') state.sound = el.value as Sound;
      else if (key === 'volume') state.volume = +el.value;
      else if (key === 'group') state.group = el.value as Group;
      if (key === 'sound' && state.run) enableAudio();
      if ((key === 'bpm' || key === 'pause') && state.run) schedule();
      refresh(); paint();
    });
    el.addEventListener('change', () => save());
  }
  $('edit').addEventListener('click', () => { stop(); $<HTMLTextAreaElement>('source').value = state.text; $('editor').hidden = false; $<HTMLTextAreaElement>('source').focus(); });
  $('close-editor').addEventListener('click', () => { $('editor').hidden = true; });
  $('close-editor-bottom').addEventListener('click', () => { $('editor').hidden = true; });
  $('use-text').addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('source').value.trim();
    if (!text) { $('edit-status').textContent = 'Paste or type some text first.'; return; }
    state.text = text; state.i = 0; rebuild(); paint(); save();
    $('editor').hidden = true; $('edit-status').textContent = '';
  });
  $('copy').addEventListener('click', async () => {
    save();
    try { await navigator.clipboard.writeText(location.href); $('share-status').textContent = 'Link copied with text, position and settings.'; }
    catch { $('share-status').textContent = 'Copy this page address from your browser to share the reading.'; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  addEventListener('hashchange', () => { if (location.hash === fragment()) return; stop(false); state = decode(); rebuild(); refresh(); paint(); });
  addEventListener('resize', () => paint());
}
rebuild(); refresh(); paint();
if (preview) { document.documentElement.classList.add('preview'); state.mode = 'passage'; state.span = 5; state.i = 12; paint(); }
else bind();
if (document.fonts) void document.fonts.ready.then(() => paint());
(window as any).__rsvp = {
  probe: () => ({ index: state.i, count: words.length, word: words[state.i].w, bpm: state.bpm, mode: state.mode, sound: state.sound, playing: state.run, ui: state.ui, beats: beats(state.i) }),
  seek: (i: number) => { stop(); seek(i); }, tap,
};
export {};
