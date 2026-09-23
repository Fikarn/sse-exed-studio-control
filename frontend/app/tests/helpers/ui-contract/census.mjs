// The in-page census of the UI contract (visual overhaul A, Slice 0).
//
// Ported from the evidence probe that measured the A mocks
// (`gold-standard-evidence-2026-09/probe/concepts.mjs`, CENSUS) so the program
// is measured by the same rules as the mocks. It runs inside the page via
// `page.evaluate(censusInPage)` and must stay self-contained: no imports, no
// closures over module scope.
//
// Per board it records: text nodes (size / weight / family / transform /
// colour / box / own-background / effective opacity / disabled), pointer
// targets (short side; `data-take` marks take-time controls), radii, light
// (box-shadows with their offsets and blur, gradients, backdrop blur, with the
// element hooks that make a shadow or gradient legitimate), motion (running
// animations, CSS-animated elements, transitions), chrome regions
// (`data-region`), page scroll, targets off the viewport and the operator-copy
// scan. The Node side (`measure.mjs`) adds the pixel-sampled contrast.

export function censusInPage() {
  const alpha = (s) => {
    let m = (s || "").match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (m) return m[4] === undefined ? 1 : +m[4];
    m = (s || "").match(/^color\(srgb\s+[\d.]+\s+[\d.]+\s+[\d.]+(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return m[1] === undefined ? 1 : +m[1];
    return 0;
  };
  const splitShadows = (s) => {
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.map((p) => {
      const inset = /\binset\b/.test(p);
      const nums = p
        .replace(/rgba?\([^)]*\)|color\([^)]*\)|inset/g, "")
        .trim()
        .split(/\s+/)
        .map(parseFloat)
        .filter((n) => !Number.isNaN(n));
      return { inset, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, raw: p };
    });
  };
  const root = document.body;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cls = (el) =>
    (typeof el.className === "string" ? el.className : (el.className && el.className.baseVal) || "")
      .split(/\s+/)
      .filter(Boolean)[0] || "";
  const ident = (el) => {
    const testId = el.getAttribute("data-testid");
    return el.tagName.toLowerCase() + (testId ? "[" + testId + "]" : "") + (cls(el) ? "." + cls(el) : "");
  };
  const vis = (el, r) => {
    if (!r || r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  // Allowed radii per system §5: 4 · 8 · 12 · pill. A pill is any radius at or
  // above 999 px or a 50 % circle; 0 is "no radius" and not counted.
  const radiusAllowed = (value) => {
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.every((p) => {
      if (p.endsWith("%")) return parseFloat(p) === 50;
      const n = parseFloat(p);
      return n === 0 || n === 4 || n === 8 || n === 12 || n >= 999;
    });
  };
  // The Console's audio scene primitive is called a snapshot at the desk, so
  // the copy scan exempts that word inside the audio workspace and inside the
  // cluster the workspace portals into the shell.
  const audioRoots = [...root.querySelectorAll('[data-testid="audio-workspace"], [data-audio-cluster]')];
  const FORBIDDEN = [
    { name: "engine", re: /\bengine\b/i, exempt: /\bengine log\b/i },
    { name: "backend", re: /\bbackend\b/i },
    { name: "transport", re: /\btransport\b/i },
    { name: "IPC", re: /\bIPC\b/ },
    { name: "OSC ping", re: /\bOSC ping\b/i },
  ];

  const texts = [];
  const sizes = new Map();
  const fams = new Map();
  const weights = new Map();
  const textColors = new Set();
  const bgColors = new Set();
  const radii = new Map();
  const shadowKinds = new Map();
  let upper = 0;
  let shadowN = 0;
  let gradN = 0;
  let gradOff = 0;
  let blurN = 0;
  let animN = 0;
  let transN = 0;
  let badLight = 0;
  let bigBlur = 0;
  let bigBlurUnlit = 0;
  let radiiOff = 0;
  const gradEls = [];
  // Visual overhaul A, Slice 9: the light counts alone say a board is off
  // policy but not what to fix, so each offender names itself. Diagnostic
  // only — no measure reads these.
  const gradOffEls = [];
  const negOffsetEls = [];
  const bigBlurUnlitEls = [];
  const backdropEls = [];
  const copy = [];
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!vis(el, r)) continue;
    const cs = getComputedStyle(el);
    const br = cs.borderRadius;
    if (br && br !== "0px") {
      radii.set(br, (radii.get(br) || 0) + 1);
      if (!radiusAllowed(br)) radiiOff++;
    }
    if (alpha(cs.backgroundColor) > 0) bgColors.add(cs.backgroundColor);
    if (cs.boxShadow && cs.boxShadow !== "none") {
      shadowN++;
      const lit = el.closest('[data-lit], [data-level="float"]') !== null;
      for (const s of splitShadows(cs.boxShadow)) {
        const k = (s.inset ? "inset " : "") + s.x + "," + s.y + "," + s.blur;
        shadowKinds.set(k, (shadowKinds.get(k) || 0) + 1);
        if (!s.inset && (s.x < 0 || s.y < 0)) {
          badLight++;
          if (negOffsetEls.length < 12) negOffsetEls.push(`${ident(el)} ${s.raw}`);
        }
        if (!s.inset && s.blur > 8) {
          bigBlur++;
          if (!lit) {
            bigBlurUnlit++;
            if (bigBlurUnlitEls.length < 12) bigBlurUnlitEls.push(`${ident(el)} ${s.raw}`);
          }
        }
      }
    }
    if (cs.backgroundImage && /gradient/.test(cs.backgroundImage)) {
      gradN++;
      if (!el.closest("[data-material], [data-signal]")) {
        gradOff++;
        if (gradOffEls.length < 12) gradOffEls.push(ident(el));
      }
      if (gradEls.length < 6) gradEls.push(ident(el));
    }
    if (cs.backdropFilter && cs.backdropFilter !== "none") {
      blurN++;
      if (backdropEls.length < 12) backdropEls.push(`${ident(el)} ${cs.backdropFilter}`);
    }
    if (cs.animationName && cs.animationName !== "none") animN++;
    if (cs.transitionDuration && cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) transN++;
    let txt = "";
    for (const n of el.childNodes) if (n.nodeType === 3) txt += n.textContent;
    txt = txt.replace(/\s+/g, " ").trim();
    if (!txt) continue;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    // Operator copy (system §9): the forbidden words, "snapshot" outside the
    // Console's scene primitive, and a raw AUDIO_* code as the first thing read.
    for (const f of FORBIDDEN) {
      if (f.re.test(txt) && !(f.exempt && f.exempt.test(txt)))
        copy.push({ word: f.name, el: ident(el), text: txt.slice(0, 60) });
    }
    if (/\bsnapshots?\b/i.test(txt) && !audioRoots.some((audioRoot) => audioRoot.contains(el)))
      copy.push({ word: "snapshot", el: ident(el), text: txt.slice(0, 60) });
    // The state display's code slot (`data-state-code`) is the one place a raw
    // fault code stands alone by design — it is never the first thing the
    // sentence beside it says.
    if (/^AUDIO_[A-Z_]+/.test(txt) && !el.hasAttribute("data-state-code"))
      copy.push({ word: "AUDIO_* first", el: ident(el), text: txt.slice(0, 60) });
    // SVG text paints with `fill`, not `color`; read the colour the eye sees.
    const color = el.namespaceURI === "http://www.w3.org/2000/svg" ? cs.fill : cs.color;
    if (!alpha(color)) continue;
    let eff = 1;
    let node = el;
    while (node && node !== document.body) {
      eff *= +getComputedStyle(node).opacity;
      node = node.parentElement;
    }
    const disabled = el.closest('[disabled], [aria-disabled="true"]') !== null;
    const size = parseFloat(cs.fontSize);
    sizes.set(size, (sizes.get(size) || 0) + 1);
    const fam = cs.fontFamily
      .split(",")[0]
      .replace(/["']/g, "")
      .replace(/ Variable$/, "")
      .trim();
    fams.set(fam, (fams.get(fam) || 0) + 1);
    weights.set(cs.fontWeight, (weights.get(cs.fontWeight) || 0) + 1);
    textColors.add(color);
    if (cs.textTransform === "uppercase") upper++;
    texts.push({
      el: ident(el),
      text: txt.slice(0, 50),
      size,
      weight: cs.fontWeight,
      family: fam,
      transform: cs.textTransform,
      color,
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      bgSelf: alpha(cs.backgroundColor) > 0 || /inset/.test(cs.boxShadow) || parseFloat(cs.borderTopWidth) > 0,
      opacity: +eff.toFixed(2),
      disabled,
    });
  }
  const sel =
    'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="switch"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"]), [data-key], [data-target]';
  const targets = [];
  let offViewport = 0;
  for (const el of root.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!vis(el, r)) continue;
    const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";
    // Visual overhaul A, Slice 11: this stays strict. A rule that let a target
    // count as reachable when some ancestor scrolls was tried and reverted: it
    // changed no number on any of the 81 boards, and §1 says nothing scrolls, so
    // the measure that says "on the board or not on it" is the one to keep.
    const fits = r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
    if (!fits) offViewport++;
    targets.push({
      el: ident(el),
      label: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      w: Math.round(r.width),
      h: Math.round(r.height),
      minSide: Math.round(Math.min(r.width, r.height)),
      take: el.hasAttribute("data-take"),
      disabled,
      fits,
    });
  }
  const regions = [...root.querySelectorAll("[data-region]")].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      name: el.getAttribute("data-region"),
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  const runningAnims = document.getAnimations().filter((a) => a.playState === "running");
  const running = runningAnims.length;
  // Slice 9: name what is still moving on a board at rest.
  const runningEls = runningAnims.slice(0, 12).map((a) => {
    const target = a.effect && a.effect.target ? ident(a.effect.target) : "?";
    const name = a.animationName || (a.transitionProperty ? `transition:${a.transitionProperty}` : "animation");
    return `${target} ${name}`;
  });
  const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    vw,
    vh,
    texts,
    targets,
    regions,
    copy,
    fontSizes: sortMap(sizes).sort((a, b) => a[0] - b[0]),
    minFontSize: sizes.size ? Math.min(...sizes.keys()) : null,
    families: sortMap(fams),
    weights: sortMap(weights),
    uppercase: upper,
    textCount: texts.length,
    textColorCount: textColors.size,
    bgColorCount: bgColors.size,
    radii: sortMap(radii),
    radiiOff,
    light: {
      shadows: shadowN,
      shadowKinds: sortMap(shadowKinds).slice(0, 12),
      outerNegativeOffset: badLight,
      outerNegativeOffsetEls: negOffsetEls,
      outerBlurOver8: bigBlur,
      outerBlurOver8Unlit: bigBlurUnlit,
      outerBlurOver8UnlitEls: bigBlurUnlitEls,
      gradients: gradN,
      gradientsOffPolicy: gradOff,
      gradientEls: gradEls,
      gradientsOffEls: gradOffEls,
      backdropBlur: blurN,
      backdropBlurEls: backdropEls,
    },
    motion: { runningAnimations: running, runningEls, cssAnimated: animN, transitions: transN },
    offViewport,
    scroll: { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight },
  };
}
