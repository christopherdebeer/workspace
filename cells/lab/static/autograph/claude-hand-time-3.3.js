/*
 * Claude Hand in time, 3.3: the web's step down keeps the hand's time and its strokes, in the looser hand (v23).
 *
 * Keep it beside the font, its stylesheet and the writing font (claude-hand-3.3.woff2, claude-hand-3.3.css,
 * claude-hand-writing-3.3.woff2). Put class="claude-hand claude-hand-in-time" on what should be written in the hand's
 * time, and it's written when it comes into view, in the writing font: each letter drawn as the pen drew it, its strokes
 * in their order and at the pen's speed (the font's progress axis, made from the hand, hands/v23.ts, moment by moment),
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
 * Made in session 33, for font 3.3 and the writing font 3.3: a changed script is a new version. It's 3.2 (session 32)
 * for the looser hand: the same writing, its letters' times and its writing font the hand's of session 33.
 */
(function () {
  'use strict';
  /* (each letter: how it goes out, h high, l low, n not at all; then how long it takes to write, in seconds at the hand's
     own pace, starting a word, joined from a letter that went out low, and from one that went out high, where it can be
     joined at all. Made from v23 by devtools/autograph-font-writing.mjs) */
  var L = {"0":"n0.495|null|null","1":"n0.391|null|null","2":"n0.481|null|null","3":"n0.505|null|null","4":"n0.781|null|null","5":"n0.832|null|null","6":"n0.513|null|null","7":"n0.402|null|null","8":"n0.571|null|null","9":"n0.517|null|null","a":"l0.526|0.561|0.575","b":"h0.732|0.75|0.713","c":"l0.36|null|null","d":"l0.638|0.707|0.702","e":"l0.421|0.446|0.453","f":"l0.901|0.988|0.943","g":"l0.657|0.752|0.741","h":"l0.607|0.679|0.67","i":"l0.593|0.686|0.626","j":"l0.755|0.777|0.795","k":"l0.643|0.687|0.64","l":"l0.45|0.508|0.469","m":"l0.689|0.787|0.73","n":"l0.546|0.604|0.579","o":"h0.492|0.553|0.498","p":"l0.699|0.756|0.69","q":"l0.666|0.736|0.714","r":"h0.469|0.49|0.484","s":"n0.328|null|null","t":"l0.804|0.84|0.817","u":"l0.523|0.61|0.54","v":"h0.448|0.511|0.452","w":"h0.569|0.639|0.617","x":"l0.738|null|null","y":"l0.624|0.693|0.609","z":"l0.449|0.493|0.435","A":"n0.833|null|null","B":"n0.755|null|null","C":"l0.481|null|null","D":"n0.643|null|null","E":"l0.823|null|null","F":"n0.747|null|null","G":"n0.522|null|null","H":"l1.205|null|null","I":"n1.036|null|null","J":"n0.747|null|null","K":"l0.879|null|null","L":"l0.402|null|null","M":"l0.696|null|null","N":"n0.599|null|null","O":"n0.547|null|null","P":"n0.581|null|null","Q":"n0.897|null|null","R":"l0.725|null|null","S":"n0.48|null|null","T":"n0.756|null|null","U":"l0.64|null|null","V":"n0.469|null|null","W":"n0.678|null|null","X":"n0.816|null|null","Y":"n0.726|null|null","Z":"l0.48|null|null","!":"n0.596|null|null","\"":"n0.588|null|null","#":"n1.501|null|null","$":"n0.89|null|null","%":"n1.165|null|null","&":"n0.568|null|null","(":"n0.379|null|null",")":"n0.363|null|null","*":"n0.978|null|null","+":"n0.66|null|null","-":"n0.262|null|null","/":"n0.361|null|null",":":"n0.463|null|null",";":"n0.539|null|null","<":"n0.363|null|null","=":"n0.647|null|null",">":"n0.361|null|null","?":"n0.67|null|null","@":"n0.689|null|null","[":"n0.405|null|null","\\":"n0.359|null|null","]":"n0.4|null|null","^":"n0.311|null|null","_":"n0.295|null|null","`":"n0.25|null|null","{":"n0.42|null|null","|":"n0.366|null|null","}":"n0.414|null|null","~":"n0.322|null|null","‘":"n0.262|null|null","’":"n0.255|null|null","“":"n0.591|null|null","”":"n0.59|null|null","–":"n0.279|null|null","—":"n0.31|null|null","…":"n0.769|null|null","•":"n0.211|null|null",".":"n0.203|null|null",",":"n0.253|null|null","'":"n0.255|null|null","á":"l0.869|0.996|0.947","à":"l0.867|0.992|0.931","â":"l0.9|0.997|0.978","ä":"l1.101|1.15|1.131","ã":"l0.886|0.951|0.961","å":"l0.904|0.981|0.978","é":"l0.773|0.782|0.834","è":"l0.779|0.779|0.83","ê":"l0.796|0.828|0.855","ë":"l0.988|1.019|1.027","í":"l0.701|0.766|0.711","ì":"l0.694|0.782|0.712","î":"l0.743|0.809|0.739","ï":"l0.921|0.97|0.899","ó":"h0.864|0.907|0.876","ò":"h0.833|0.886|0.845","ô":"h0.85|0.949|0.899","ö":"h1.024|1.118|1.045","õ":"h0.848|0.942|0.91","ú":"l0.875|0.99|0.88","ù":"l0.877|0.982|0.916","û":"l0.913|0.975|0.881","ü":"l1.097|1.168|1.084","ý":"l0.971|1.029|0.945","ÿ":"l1.185|1.287|1.248","ñ":"l0.921|0.979|0.929","Á":"n1.177|null|null","À":"n1.166|null|null","Â":"n1.208|null|null","Ä":"n1.394|null|null","Ã":"n1.21|null|null","Å":"n1.179|null|null","É":"l1.155|null|null","È":"l1.153|null|null","Ê":"l1.183|null|null","Ë":"l1.276|null|null","Í":"n1.375|null|null","Ì":"n1.396|null|null","Î":"n1.405|null|null","Ï":"n1.573|null|null","Ó":"n0.832|null|null","Ò":"n0.823|null|null","Ô":"n0.898|null|null","Ö":"n1.017|null|null","Õ":"n0.879|null|null","Ú":"l0.995|null|null","Ù":"l0.983|null|null","Û":"l1.015|null|null","Ü":"l1.12|null|null","Ý":"n1.093|null|null","Ñ":"n0.961|null|null","ç":"l0.736|null|null","Ç":"l0.86|null|null","ø":"h0.863|0.959|0.927","Ø":"n0.974|null|null","æ":"l0.703|0.831|0.803","œ":"l0.643|0.754|0.681","ß":"n0.542|null|null","·":"n0.204|null|null","€":"n1.154|null|null","£":"n0.794|null|null","°":"n0.296|null|null","×":"n0.664|null|null","÷":"n0.852|null|null","©":"n0.952|null|null","¡":"n0.591|null|null","¿":"n0.646|null|null","«":"n0.694|null|null","»":"n0.686|null|null","✓":"n0.374|null|null","½":"n1.217|null|null","¼":"n1.511|null|null","¾":"n1.611|null|null"};
  /* (how much nearer a letter sits after anything inked, inside a word, in ems: the s) */
  var NEARER = {"s": -0.0645};
  var OTHER = 0.45, GAP = 0.19, WAIT = { word: 0, phrase: 0.23, sentence: 0.68 }, RETURN = 0.28;
  var CARRY = 0.6, PACE = 0.25;
  var FAMILY = 'Claude Hand Writing 3.3';
  var here = (document.currentScript && document.currentScript.src) || '';
  var face = typeof FontFace === 'function' ? new FontFace(FAMILY, 'url(' + new URL('claude-hand-writing-3.3.woff2', here || location.href).href + ')', { weight: '400 700' }) : null;
  var ready = face ? face.load().then(function (f) { document.fonts.add(f); return true; }, function () { return false; }) : Promise.resolve(false);
  var reduced = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var weightOf = function (f) { return Math.max(200, Math.min(700, f < 1 ? 400 + 300 * Math.log(f) / Math.log(0.4) : 400 - 200 * Math.log(f) / Math.log(2))); };
  var paceOf = function (w) { return w >= 400 ? Math.pow(0.4, (w - 400) / 300) : Math.pow(2, (400 - w) / 200); };
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

  var api = { write: write, watch: watch, settle: settle, ready: ready, version: '3.3' };
  /* (a page that keeps samples written by an earlier version can still reach it: every version loaded, by its number) */
  var before = window.ClaudeHandTime;
  window.ClaudeHandTimes = window.ClaudeHandTimes || {};
  if (before && before.version) window.ClaudeHandTimes[before.version] = before;
  window.ClaudeHandTimes['3.3'] = api;
  window.ClaudeHandTime = api;
  var auto = function () { document.querySelectorAll('.claude-hand-in-time').forEach(function (el) { if (!el.__claudeHandWatched) { el.__claudeHandWatched = true; watch(el); } }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
