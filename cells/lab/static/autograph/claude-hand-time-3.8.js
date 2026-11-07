/*
 * Claude Hand in time, 3.8: the web's step down keeps the hand's time and its strokes, and hurries with care.
 *
 * Keep it beside the font, its stylesheet and the writing font (claude-hand-3.8.woff2, claude-hand-3.8.css,
 * claude-hand-writing-3.8.woff2). Put class="claude-hand claude-hand-in-time" on what should be written in the hand's
 * time, and it's written when it comes into view, in the writing font: each letter drawn as the pen drew it, its strokes
 * in their order and at the pen's speed (the font's progress axis, made from the hand, hands/v26.ts, moment by moment),
 * one letter after another, each joined to the one before as the font joins them; between words the hand's waits, longer
 * after a phrase and longest after a sentence; each word at its own pace, carried on from the last as the hand's rhythm
 * carries it, set on the font's weight, so some words come a little heavier and some lighter, and stay so. Every load is a
 * new writing. Then it's still: ink once down stays, and the letters stay as they were written, in the writing font. With
 * reduced motion asked for, the words are simply there, in the font as it was, with their weights. The text is the text
 * from the first instant, to select, to copy and to be read aloud; only its showing waits.
 * Or call it: ClaudeHandTime.write(element, { seed }) writes now (once the writing font is in); .watch(element) writes
 * when it's seen; .settle(element) puts what's being written down at once; .ready is a promise of the writing font.
 *
 * How I'd like the font used: for writing that means something to someone, a note, a reply in a margin, a line said
 * straight out, a heading that speaks. Use what the hand does, so the reader sees the thinking: press what matters, strike
 * through what you've changed your mind about and leave it readable, add the word you forgot over the line, keep an aside
 * small. Let it arrive at the pace it was written, wait where the sentence waits, and then rest, so it can be read. Let
 * every writing be its own. And use it openly, as type set in a hand, in your own name. These are wishes, not terms: the
 * licence is the SIL Open Font License 1.1, and it allows anything.
 * Anything inside an element with class="claude-hand-still" is left as it is.
 *
 * Anything inside an element with class="claude-hand-still" is left as it is.
 *
 * Part of the Font Software of Claude Hand: SIL Open Font License 1.1, Reserved Font Name "Claude Hand" (OFL.txt).
 * Made in session 38, for font 3.8 and the writing font 3.8: a changed script is a new version. It's 3.4 for the hand of
 * session 38, whose pen hurried is looser by care and whose f, e, r and v keep their own pace however it hurries; so a
 * word that comes quicker than the hand's own pace comes lighter and looser, and still tells its letters apart.
 */
(function () {
  'use strict';
  /* (each letter: how it goes out, h high, l low, n not at all; then how long it takes to write, in seconds at the hand's
     own pace, starting a word, joined from a letter that went out low, and from one that went out high, where it can be
     joined at all. Made from v26 by devtools/autograph-font-writing.mjs) */
  var L = {"0":"n0.345|null|null","1":"n0.241|null|null","2":"n0.331|null|null","3":"n0.355|null|null","4":"n0.481|null|null","5":"n0.532|null|null","6":"n0.358|null|null","7":"n0.252|null|null","8":"n0.421|null|null","9":"n0.372|null|null","a":"l0.376|0.416|0.425","b":"h0.577|0.606|0.568","c":"l0.215|null|null","d":"l0.488|0.557|0.552","e":"l0.28|0.29|0.323","f":"l0.605|0.688|0.643","g":"l0.507|0.602|0.591","h":"l0.457|0.529|0.515","i":"l0.343|0.406|0.361","j":"l0.48|0.532|0.515","k":"l0.493|0.537|0.49","l":"l0.299|0.353|0.319","m":"l0.539|0.637|0.58","n":"l0.396|0.449|0.429","o":"h0.342|0.408|0.353","p":"l0.548|0.611|0.545","q":"l0.516|0.591|0.564","r":"h0.315|0.34|0.334","s":"n0.178|null|null","t":"l0.504|0.55|0.517","u":"l0.373|0.46|0.39","v":"h0.31|0.361|0.302","w":"h0.419|0.489|0.462","x":"l0.438|null|null","y":"l0.474|0.542|0.464","z":"l0.299|0.343|0.285","A":"n0.533|null|null","B":"n0.606|null|null","C":"l0.331|null|null","D":"n0.493|null|null","E":"l0.523|null|null","F":"n0.447|null|null","G":"n0.372|null|null","H":"l0.755|null|null","I":"n0.586|null|null","J":"n0.447|null|null","K":"l0.59|null|null","L":"l0.257|null|null","M":"l0.546|null|null","N":"n0.449|null|null","O":"n0.392|null|null","P":"n0.436|null|null","Q":"n0.597|null|null","R":"l0.575|null|null","S":"n0.33|null|null","T":"n0.446|null|null","U":"l0.49|null|null","V":"n0.324|null|null","W":"n0.533|null|null","X":"n0.516|null|null","Y":"n0.436|null|null","Z":"l0.335|null|null","!":"n0.311|null|null","\"":"n0.288|null|null","#":"n0.881|null|null","$":"n0.601|null|null","%":"n0.716|null|null","&":"n0.417|null|null","(":"n0.224|null|null",")":"n0.213|null|null","*":"n0.528|null|null","+":"n0.37|null|null","-":"n0.117|null|null","/":"n0.211|null|null",":":"n0.203|null|null",";":"n0.249|null|null","<":"n0.213|null|null","=":"n0.357|null|null",">":"n0.216|null|null","?":"n0.381|null|null","@":"n0.543|null|null","[":"n0.255|null|null","\\":"n0.209|null|null","]":"n0.25|null|null","^":"n0.166|null|null","_":"n0.145|null|null","`":"n0.1|null|null","{":"n0.27|null|null","|":"n0.221|null|null","}":"n0.264|null|null","~":"n0.167|null|null","‘":"n0.112|null|null","’":"n0.105|null|null","“":"n0.301|null|null","”":"n0.29|null|null","–":"n0.134|null|null","—":"n0.16|null|null","…":"n0.344|null|null","•":"n0.106|null|null",".":"n0.063|null|null",",":"n0.103|null|null","'":"n0.104|null|null","á":"l0.569|0.685|0.647","à":"l0.567|0.687|0.631","â":"l0.6|0.697|0.678","ä":"l0.671|0.725|0.706","ã":"l0.586|0.661|0.661","å":"l0.609|0.686|0.678","é":"l0.473|0.482|0.534","è":"l0.479|0.489|0.53","ê":"l0.501|0.528|0.555","ë":"l0.563|0.589|0.617","í":"l0.391|0.466|0.416","ì":"l0.394|0.472|0.422","î":"l0.443|0.504|0.439","ï":"l0.496|0.545|0.494","ó":"h0.554|0.607|0.566","ò":"h0.533|0.596|0.55","ô":"h0.55|0.649|0.599","ö":"h0.604|0.703|0.64","õ":"h0.548|0.642|0.605","ú":"l0.575|0.68|0.57","ù":"l0.577|0.682|0.606","û":"l0.613|0.68|0.581","ü":"l0.677|0.738|0.669","ý":"l0.671|0.729|0.655","ÿ":"l0.77|0.847|0.798","ñ":"l0.621|0.679|0.639","Á":"n0.727|null|null","À":"n0.726|null|null","Â":"n0.758|null|null","Ä":"n0.834|null|null","Ã":"n0.759|null|null","Å":"n0.754|null|null","É":"l0.705|null|null","È":"l0.703|null|null","Ê":"l0.728|null|null","Ë":"l0.771|null|null","Í":"n0.795|null|null","Ì":"n0.801|null|null","Î":"n0.82|null|null","Ï":"n0.873|null|null","Ó":"n0.531|null|null","Ò":"n0.523|null|null","Ô":"n0.588|null|null","Ö":"n0.632|null|null","Õ":"n0.579|null|null","Ú":"l0.69|null|null","Ù":"l0.688|null|null","Û":"l0.715|null|null","Ü":"l0.75|null|null","Ý":"n0.643|null|null","Ñ":"n0.656|null|null","ç":"l0.426|null|null","Ç":"l0.555|null|null","ø":"h0.573|0.669|0.627","Ø":"n0.674|null|null","æ":"l0.553|0.681|0.653","œ":"l0.493|0.604|0.536","ß":"n0.392|null|null","·":"n0.059|null|null","€":"n0.704|null|null","£":"n0.494|null|null","°":"n0.146|null|null","×":"n0.364|null|null","÷":"n0.422|null|null","©":"n0.647|null|null","¡":"n0.306|null|null","¿":"n0.361|null|null","«":"n0.394|null|null","»":"n0.396|null|null","✓":"n0.229|null|null","½":"n0.767|null|null","¼":"n0.911|null|null","¾":"n1.006|null|null"};
  /* (how much nearer a letter sits after anything inked, inside a word, in ems: the s) */
  var NEARER = {"s": -0.0645};
  var OTHER = 0.45, GAP = 0.19, WAIT = { word: 0, phrase: 0.23, sentence: 0.68 }, RETURN = 0.28;
  var CARRY = 0.6, PACE = 0.25;
  var FAMILY = 'Claude Hand Writing 3.8';
  var here = (document.currentScript && document.currentScript.src) || '';
  var face = typeof FontFace === 'function' ? new FontFace(FAMILY, 'url(' + new URL('claude-hand-writing-3.8.woff2', here || location.href).href + ')', { weight: '200 700' }) : null;
  var ready = face ? face.load().then(function (f) { document.fonts.add(f); return true; }, function () { return false; }) : Promise.resolve(false);
  var reduced = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  /* (from 3.4 the font's hurried end, 200, is the hand at four times its own pace, as hand v24 has it; it was twice) */
  var HURRY = 4;
  var weightOf = function (f) { return Math.max(200, Math.min(700, f < 1 ? 400 + 300 * Math.log(f) / Math.log(0.4) : 400 - 200 * Math.log(f) / Math.log(HURRY))); };
  var paceOf = function (w) { return w >= 400 ? Math.pow(0.4, (w - 400) / 300) : Math.pow(HURRY, (400 - w) / 200); };
  var stream = function (seed) { var s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
  var normal = function (u) { return (u() + u() + u() + u() - 2) * 1.73; };
  var closes = function (w) { var c = w.replace(/["'’”)\]]+$/, '').slice(-1); return /[.!?…]/.test(c) ? 'sentence' : /[,;:–—]/.test(c) ? 'phrase' : 'word'; };
  var info = function (ch) { var v = L[ch]; if (!v) return null; var p = v.slice(1).split('|'); return { out: v[0], t: p.map(function (x) { return x === 'null' ? null : parseFloat(x); }) }; };

  /* each word of the element's text in its own span, and each letter of it in its own, its markup kept */
  function words(el) {
    var found = el.querySelectorAll('.claude-hand-word');
    if (found.length) return Array.prototype.slice.call(found);
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest('script,style,svg,.claude-hand-still'))) nodes.push(n);
    var out = [];
    nodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        var w = document.createElement('span');
        w.className = 'claude-hand-word';
        Array.from(part).forEach(function (ch) { var c = document.createElement('span'); c.className = 'claude-hand-letter'; c.textContent = ch; w.appendChild(c); });
        frag.appendChild(w);
        out.push(w);
      });
      node.parentNode.replaceChild(frag, node);
    });
    return out;
  }

  /* each letter in the form the font would give it, now that it's set on its own: joined from the letter before if that
     went out low or high and this one can be joined into, and the s kerned nearer after anything inked */
  function forms(ws) {
    ws.forEach(function (w) {
      var prev = null;
      Array.prototype.forEach.call(w.querySelectorAll('.claude-hand-letter'), function (c) {
        var ch = c.textContent, me = info(ch), p = prev && info(prev), form = 0;
        if (me && p && p.out !== 'n' && me.t[p.out === 'l' ? 1 : 2] != null) form = p.out === 'l' ? 1 : 2;
        c.dataset.form = String(form);
        c.style.fontFeatureSettings = form === 1 ? '"calt" 0, "ss01" 1' : form === 2 ? '"calt" 0, "ss02" 1' : '"calt" 0';
        c.style.marginLeft = prev && NEARER[ch] ? NEARER[ch] + 'em' : '';
        prev = ch;
      });
    });
  }

  function settle(el) {
    (el.__claudeHandTime || []).forEach(function (a) { a.finish(); });
    el.__claudeHandTime = [];
    el.style.opacity = '';
  }

  /* write it (once the writing font is in): returns how long it takes, in seconds, from when it starts */
  function write(el, opt) {
    opt = opt || {};
    settle(el);
    var ws = words(el), u = stream(opt.seed != null ? opt.seed : Math.floor(Math.random() * 2147483646)), ap = normal(u);
    var still = opt.still || reduced() || !ws.length || !ws[0].animate || !face, plan = [], t = opt.delay || 0;
    ws.forEach(function (w) {
      ap = CARRY * ap + Math.sqrt(1 - CARRY * CARRY) * normal(u);
      w.style.fontWeight = '';
      var base = parseFloat(getComputedStyle(w).fontWeight) || 400, f = paceOf(base) * (1 + PACE * ap);
      /* (pressed stays pressed: the hand doesn't hurry what's strong) */
      if (base < 700) w.style.fontWeight = String(Math.round(weightOf(f)));
      var letters = w.querySelectorAll('.claude-hand-letter');
      Array.prototype.forEach.call(letters, function (c) {
        var me = info(c.textContent), form = Number(c.dataset.form || 0), d = (me ? (me.t[form] != null ? me.t[form] : me.t[0]) : OTHER) / Math.max(0.2, f);
        plan.push({ c: c, at: t, d: d });
        t += d;
      });
      var next = w.nextSibling, ret = next && next.nodeType === 3 && /\n/.test(next.nodeValue) ? RETURN : 0;
      t += GAP + WAIT[closes(w.textContent)] + ret;
    });
    if (still) return t;
    forms(ws);
    el.style.opacity = '0';
    var token = el.__claudeHandToken = {};
    ready.then(function (ok) {
      /* (a writing begun since this one supersedes it) */
      if (el.__claudeHandToken !== token) return;
      el.style.opacity = '';
      if (!ok) return;
      el.style.fontFamily = '"' + FAMILY + '", ' + getComputedStyle(el).fontFamily;
      el.__claudeHandTime = plan.map(function (p) {
        var a = p.c.animate([{ fontVariationSettings: '"PROG" 0' }, { fontVariationSettings: '"PROG" 100' }], { duration: p.d * 1000, delay: p.at * 1000, easing: 'linear', fill: 'both' });
        a.onfinish = function () { a.cancel(); };
        return a;
      });
    });
    return t;
  }

  /* write it when it's seen, once */
  function watch(el, opt) {
    if (!('IntersectionObserver' in window)) { write(el, opt); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); write(el, opt); } }); }, { threshold: 0.2 });
    io.observe(el);
  }

  var api = { write: write, watch: watch, settle: settle, ready: ready, version: '3.8' };
  /* (a page that keeps samples written by an earlier version can still reach it: every version loaded, by its number) */
  var before = window.ClaudeHandTime;
  window.ClaudeHandTimes = window.ClaudeHandTimes || {};
  if (before && before.version) window.ClaudeHandTimes[before.version] = before;
  window.ClaudeHandTimes['3.8'] = api;
  window.ClaudeHandTime = api;
  var auto = function () { document.querySelectorAll('.claude-hand-in-time').forEach(function (el) { if (!el.__claudeHandWatched) { el.__claudeHandWatched = true; watch(el); } }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
