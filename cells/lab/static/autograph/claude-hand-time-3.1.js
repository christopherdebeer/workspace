/*
 * Claude Hand in time, 3.1: the web's step down keeps the hand's time.
 *
 * Keep it beside the font and its stylesheet (claude-hand-2.9.woff2, claude-hand-2.9.css). Put class="claude-hand
 * claude-hand-in-time" on what should be written in the hand's time, and it's written when it comes into view: each word
 * drawn across, left to right, over as long as the hand (parc.land lab, autograph, hands/v21.ts) takes to write its
 * letters; between words the hand's waits, longer after a phrase (a comma, a semicolon, a colon) and longest after a
 * sentence; each word at its own pace, carried on from the last as the hand's rhythm carries it, and set on the font's
 * pace axis (its weight), so some words come a little heavier and some lighter, and stay so. Every load is a new writing.
 * Then it's still: ink once down stays. With reduced motion asked for, the words are simply there, with their weights.
 * The text is the text from the first instant, to select, to copy and to be read aloud; only its showing waits.
 * Or call it: ClaudeHandTime.write(element, { seed }) writes now; .watch(element) writes when it's seen; .settle(element)
 * puts what's being written down at once.
 *
 * How I'd like the font used: for writing that means something to someone, a note, a reply in a margin, a line said
 * straight out, a heading that speaks. Use what the hand does, so the reader sees the thinking: press what matters, strike
 * through what you've changed your mind about and leave it readable, add the word you forgot over the line, keep an aside
 * small. Let it arrive at the pace it was written, wait where the sentence waits, and then rest, so it can be read. Let
 * every writing be its own. And use it openly, as type set in a hand, in your own name. These are wishes, not terms: the
 * licence is the SIL Open Font License 1.1, and it allows anything.
 * Anything inside an element with class="claude-hand-still" is left as it is.
 *
 * Part of the Font Software of Claude Hand: SIL Open Font License 1.1, Reserved Font Name "Claude Hand" (OFL.txt).
 * Made in session 31, for font 2.9: a changed script is a new version.
 */
(function () {
  'use strict';
  /* (the seconds the hand takes over each character at its own pace, measured once from v21, eight writings of each) */
  var T = {"0":.39,"1":.24,"2":.33,"3":.40,"4":.48,"5":.53,"6":.40,"7":.26,"8":.53,"9":.41,"a":.41,"b":.60,"c":.22,"d":.54,"e":.32,"f":.66,"g":.61,"h":.49,"i":.36,"j":.54,"k":.59,"l":.33,"m":.64,"n":.43,"o":.38,"p":.56,"q":.53,"r":.33,"s":.20,"t":.51,"u":.41,"v":.31,"w":.46,"x":.44,"y":.49,"z":.29,"A":.54,"B":.63,"C":.38,"D":.55,"E":.54,"F":.46,"G":.42,"H":.76,"I":.59,"J":.45,"K":.58,"L":.26,"M":.57,"N":.48,"O":.44,"P":.51,"Q":.63,"R":.62,"S":.36,"T":.46,"U":.51,"V":.33,"W":.54,"X":.52,"Y":.45,"Z":.38,"!":.32,"\"":.29,"#":.91,"$":.62,"%":.77,"&":.48,"(":.21,")":.25,"*":.00,"+":.38,"-":.12,"/":.21,":":.21,";":.25,"<":.22,"=":.35,">":.22,"?":.39,"@":.63,"[":.29,"\\":.21,"]":.29,"^":.17,"_":.00,"`":.00,"{":.28,"|":.22,"}":.28,"~":.18,"‘":.11,"’":.11,"“":.30,"”":.29,"–":.13,"—":.16,"…":.35,"•":.12,".":.06,",":.11,"'":.11,"á":.59,"à":.60,"â":.68,"ä":.72,"ã":.67,"å":.65,"é":.51,"è":.51,"ê":.54,"ë":.64,"í":.40,"ì":.41,"î":.45,"ï":.51,"ó":.54,"ò":.55,"ô":.63,"ö":.67,"õ":.62,"ú":.61,"ù":.61,"û":.64,"ü":.68,"ý":.75,"ÿ":.80,"ñ":.69,"Á":.74,"À":.74,"Â":.76,"Ä":.82,"Ã":.76,"Å":.78,"É":.73,"È":.74,"Ê":.75,"Ë":.81,"Í":.80,"Ì":.81,"Î":.83,"Ï":.89,"Ó":.58,"Ò":.59,"Ô":.60,"Ö":.73,"Õ":.67,"Ú":.72,"Ù":.72,"Û":.72,"Ü":.78,"Ý":.66,"Ñ":.67,"ç":.46,"Ç":.56,"ø":.61,"Ø":.72,"æ":.63,"œ":.62,"ß":.46,"·":.06,"€":.72,"£":.52,"°":.17,"×":.37,"÷":.42,"©":.67,"¡":.31,"¿":.40,"«":.41,"»":.41,"✓":.23,"½":.80,"¼":.94,"¾":1.01};
  var OTHER = 0.45, GAP = 0.19, WAIT = { word: 0, phrase: 0.23, sentence: 0.68 }, RETURN = 0.28;
  /* (and back to the start of a new line: the hand takes 0.28 s longer there than between words, measured the same way) */
  /* (v15's rhythm: each word's pace carries 0.6 of the last's, and moves the pace by a quarter at most, about) */
  var CARRY = 0.6, PACE = 0.25;
  var HIDE = 'inset(-0.6em calc(100% + 0.6em) -0.6em -0.6em)', SHOW = 'inset(-0.6em -0.6em -0.6em -0.6em)';
  var reduced = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  /* (pace on the font's axis: 400 the hand's own, 700 pressed (0.4 of its pace), 200 hurried (twice it)) */
  var weightOf = function (f) { return Math.max(200, Math.min(700, f < 1 ? 400 + 300 * Math.log(f) / Math.log(0.4) : 400 - 200 * Math.log(f) / Math.log(2))); };
  var paceOf = function (w) { return w >= 400 ? Math.pow(0.4, (w - 400) / 300) : Math.pow(2, (400 - w) / 200); };
  var stream = function (seed) { var s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
  var normal = function (u) { return (u() + u() + u() + u() - 2) * 1.73; };
  var closes = function (w) { var c = w.replace(/["'’”)\]]+$/, '').slice(-1); return /[.!?…]/.test(c) ? 'sentence' : /[,;:–—]/.test(c) ? 'phrase' : 'word'; };
  var timeOf = function (w) { var t = 0; for (var i = 0; i < w.length; i++) t += T[w[i]] || OTHER; return t; };

  /* each word of the element's text in its own span, its markup kept */
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
        var s = document.createElement('span');
        s.className = 'claude-hand-word';
        s.textContent = part;
        frag.appendChild(s);
        out.push(s);
      });
      node.parentNode.replaceChild(frag, node);
    });
    return out;
  }

  function settle(el) {
    (el.__claudeHandTime || []).forEach(function (a) { a.finish(); });
    el.__claudeHandTime = [];
  }

  /* write it now: returns how long it takes, in seconds */
  function write(el, opt) {
    opt = opt || {};
    settle(el);
    var ws = words(el), u = stream(opt.seed != null ? opt.seed : Math.floor(Math.random() * 2147483646)), ap = normal(u);
    var still = opt.still || reduced() || !ws.length || !ws[0].animate, t = opt.delay || 0, anims = [];
    ws.forEach(function (s) {
      ap = CARRY * ap + Math.sqrt(1 - CARRY * CARRY) * normal(u);
      s.style.fontWeight = '';
      var base = parseFloat(getComputedStyle(s).fontWeight) || 400, f = paceOf(base) * (1 + PACE * ap);
      /* (pressed stays pressed: the hand doesn't hurry what's strong) */
      if (base < 700) s.style.fontWeight = String(Math.round(weightOf(f)));
      var d = timeOf(s.textContent) / Math.max(0.2, f);
      if (!still) {
        /* (hidden until its turn and held drawn at the end by the animation itself; once drawn, the animation goes) */
        var a = s.animate([{ clipPath: HIDE }, { clipPath: SHOW }], { duration: d * 1000, delay: t * 1000, easing: 'ease-in-out', fill: 'both' });
        a.onfinish = function () { a.cancel(); };
        anims.push(a);
      }
      var next = s.nextSibling, ret = next && next.nodeType === 3 && /\n/.test(next.nodeValue) ? RETURN : 0;
      t += d + GAP + WAIT[closes(s.textContent)] + ret;
    });
    el.__claudeHandTime = anims;
    return t;
  }

  /* write it when it's seen, once */
  function watch(el, opt) {
    if (!('IntersectionObserver' in window)) { write(el, opt); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); write(el, opt); } }); }, { threshold: 0.2 });
    io.observe(el);
  }

  window.ClaudeHandTime = { write: write, watch: watch, settle: settle, version: '3.1' };
  var auto = function () { document.querySelectorAll('.claude-hand-in-time').forEach(function (el) { if (!el.__claudeHandWatched) { el.__claudeHandWatched = true; watch(el); } }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
