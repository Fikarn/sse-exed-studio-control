// Pixel-sampled text contrast, ported unchanged in its rules from the evidence
// sampler (`gold-standard-evidence-2026-09/probe/contrast.py`): for each text
// node the census recorded, sample the rendered PNG around the text box (the
// background the eye actually sees, gradients and glass included), composite
// the text colour over it and compute the WCAG ratio.
//
// Rules: the inner ring (1 px inside the box) for text on a surface; the
// interior mode (the most common colour in the middle band) for text on a
// filled control; SVG text reads `fill`; text at effective opacity < 0.9 and
// text inside a disabled control are exempt (WCAG 1.4.3 exempts inactive
// controls). Text ≥ 24 px, or ≥ 18.66 px at weight 700, needs 3:1; the rest
// 4.5:1.

export function parseColor(s) {
  let m = (s || "").match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  m = (s || "").match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
  if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
  return null;
}

function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

// The inner ring: 1 px inside the box edge, so a filled control reads its fill.
export function ringMedian(png, x, y, w, h) {
  const pad = -1;
  const W = png.width;
  const H = png.height;
  const xs0 = Math.max(0, x - pad);
  const ys0 = Math.max(0, y - pad);
  const xs1 = Math.min(W - 1, x + w + pad);
  const ys1 = Math.min(H - 1, y + h + pad);
  if (xs1 <= xs0 || ys1 <= ys0) return null;
  const rs = [];
  const gs = [];
  const bs = [];
  const step = Math.max(1, Math.floor((xs1 - xs0) / 60));
  for (let xx = xs0; xx <= xs1; xx += step) {
    for (const yy of [ys0, ys1]) {
      const [r, g, b] = pixel(png, xx, yy);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  const stepY = Math.max(1, Math.floor((ys1 - ys0) / 30));
  for (let yy = ys0; yy <= ys1; yy += stepY) {
    for (const xx of [xs0, xs1]) {
      const [r, g, b] = pixel(png, xx, yy);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  if (!rs.length) return null;
  return [median(rs), median(gs), median(bs)];
}

// The most common quantised colour in the middle band of a filled box: the
// fill the text sits on, unaffected by machined edge lines or the pressed-key
// shadow band at the perimeter.
export function interiorMode(png, x, y, w, h) {
  const W = png.width;
  const H = png.height;
  const x0 = Math.max(0, x + 3);
  const x1 = Math.min(W - 1, x + w - 3);
  const y0 = Math.max(0, y + Math.floor(h / 3));
  const y1 = Math.min(H - 1, y + Math.floor((2 * h) / 3));
  if (x1 <= x0 || y1 < y0) return null;
  const bins = new Map();
  const sx = Math.max(1, Math.floor((x1 - x0) / 80));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx += sx) {
      const [r, g, b] = pixel(png, xx, yy);
      const k = `${Math.floor(r / 12)}|${Math.floor(g / 12)}|${Math.floor(b / 12)}`;
      const e = bins.get(k);
      if (e) {
        e[0]++;
        e[1] += r;
        e[2] += g;
        e[3] += b;
      } else bins.set(k, [1, r, g, b]);
    }
  }
  if (!bins.size) return null;
  const [n, r, g, b] = [...bins.values()].reduce((best, e) => (e[0] > best[0] ? e : best));
  return [r / n, g / n, b / n];
}

/**
 * @param {{ width: number, height: number, data: Uint8Array }} png
 * @param {Array<{ color: string, x: number, y: number, w: number, h: number, bgSelf: boolean, opacity: number, disabled?: boolean, size: number, weight: string, text: string, el: string }>} texts
 */
export function sampleContrast(png, texts) {
  const fails = [];
  let measured = 0;
  for (const t of texts) {
    const fg = parseColor(t.color);
    if (!fg || t.w <= 0 || t.h <= 0) continue;
    if (t.x < 0 || t.y < 0 || t.x + t.w > png.width || t.y + t.h > png.height) continue;
    if ((t.opacity ?? 1) < 0.9 || t.disabled) continue;
    const bg = t.bgSelf ? interiorMode(png, t.x, t.y, t.w, t.h) : ringMedian(png, t.x, t.y, t.w, t.h);
    if (!bg) continue;
    measured++;
    const a = fg[3];
    const flat = [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
    const ratio = contrastRatio(flat, bg);
    const bold = parseInt(t.weight, 10) >= 700;
    const large = t.size >= 24 || (bold && t.size >= 18.66);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      fails.push({
        ratio: Math.round(ratio * 100) / 100,
        need,
        size: t.size,
        weight: t.weight,
        text: t.text.slice(0, 32),
        el: t.el.slice(0, 60),
        color: t.color,
        bg: `rgb(${bg.map((v) => Math.round(v)).join(", ")})`,
      });
    }
  }
  fails.sort((a, b) => a.ratio - b.ratio);
  return { measured, fails };
}
