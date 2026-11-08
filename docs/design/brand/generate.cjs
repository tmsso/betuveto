// Regenerates the outlined brand SVGs in this folder from Baloo 2 ExtraBold (docs/design-handback.md §1).
// Needs opentype.js, which is not a project dependency:
//   npm --prefix frontend i --no-save opentype.js@1.3.4
//   NODE_PATH=frontend/node_modules node docs/design/brand/generate.cjs
const ot = require('opentype.js');
const fs = require('fs');
const path = require('path');
const F = path.resolve(__dirname, '../../../frontend/node_modules/@fontsource/baloo-2/files') + '/';
const lat = ot.loadSync(F + 'baloo-2-latin-800-normal.woff'), ext = ot.loadSync(F + 'baloo-2-latin-ext-800-normal.woff');
const OUT = __dirname + '/';
const fontFor = (ch) => (lat.charToGlyphIndex(ch) > 0 ? lat : ext);
const glyphPath = (ch, x, y, size) => fontFor(ch).getPath(ch, x, y, size);
const adv = (ch, size) => { const f = fontFor(ch); return f.charToGlyph(ch).advanceWidth * size / f.unitsPerEm; };
// split path data into subpaths with bbox
const subpaths = (p) => { const out = []; let cur = null;
  for (const c of p.commands) { if (c.type === 'M') { cur = { cmds: [], ys: [] }; out.push(cur); } cur.cmds.push(c); for (const k of ['y', 'y1', 'y2']) if (c[k] !== undefined) cur.ys.push(c[k]); }
  return out.map((s) => { const q = new ot.Path(); q.commands = s.cmds; return { d: q.toPathData(2), maxY: Math.max(...s.ys) }; }); };

const T = '#0b6b6b', S = '#f2a516', F_ = '#fbf3df', E = '#c9b27e', INK = '#0d1b1f', INKT = '#1b2a30', TE = '#084f4f', SE = '#c4830a';
const tile = (L, [x, y, s, r], [face, edge, ink], k = 0.8) => {
  const cx = x + s / 2, cy = y + s / 2, size = s * k, bev = s * 0.1, ty = cy - bev / 2 + size * 0.32;
  const d = glyphPath(L, cx - adv(L, size) / 2, ty, size).toPathData(2);
  const f = (n) => +n.toFixed(2);
  return `<g transform="rotate(${r} ${f(cx)} ${f(cy)})"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${f(s * .24)}" fill="${edge}"/><rect x="${x}" y="${y}" width="${s}" height="${f(s - bev)}" rx="${f(s * .24)}" fill="${face}"/><path d="${d}" fill="${ink}"/></g>`;
};
const GEO = { B: [4, 25, 32, -7], V: [28, 7, 31, 10] };
const markInner = (onBrand) => onBrand
  ? tile('V', GEO.V, [S, SE, INK]) + tile('B', GEO.B, [F_, E, T])
  : tile('V', GEO.V, [T, TE, S]) + tile('B', GEO.B, [F_, E, T]);
const svg = (w, h, inner, title, vb) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb || `0 0 ${w} ${h}`}" role="img" aria-label="${title}"><title>${title}</title>${inner}</svg>\n`;

fs.writeFileSync(OUT + 'logo-mark.svg', svg(64, 64, markInner(false), 'Betűvető'));
fs.writeFileSync(OUT + 'logo-mark-on-brand.svg', svg(64, 64, markInner(true), 'Betűvető'));
// maskable: teal full bleed, mark scaled into the inner 80% safe zone (mark ~ 0.62 of canvas)
fs.writeFileSync(OUT + 'logo-maskable.svg', svg(512, 512, `<rect width="512" height="512" fill="${T}"/><g transform="translate(96 96) scale(5)">${markInner(true)}</g>`, 'Betűvető'));

// wordmark, outlined, accents split
const word = (text, size, ink, accent, x0 = 0, base) => { let x = x0, parts = '';
  base = base ?? size * 0.776;
  for (const ch of text) { const p = glyphPath(ch, x, base, size);
    if ('űőŰŐ'.includes(ch)) { const sps = subpaths(p), cut = base - 0.515 * size;
      parts += `<path d="${sps.filter((q) => q.maxY >= cut).map((q) => q.d).join('')}" fill="${ink}"/><path d="${sps.filter((q) => q.maxY < cut).map((q) => q.d).join('')}" fill="${accent}"/>`; }
    else parts += `<path d="${p.toPathData(2)}" fill="${ink}"/>`;
    x += adv(ch, size); }
  return { parts, width: x - x0 }; };
const W = word('Betűvető', 100, INKT, S);
fs.writeFileSync(OUT + 'logo-wordmark.svg', svg(Math.ceil(W.width), 104, W.parts, 'Betűvető'));
const WD = word('Betűvető', 100, '#e4eeec', '#f5b83d');
fs.writeFileSync(OUT + 'logo-wordmark-dark.svg', svg(Math.ceil(WD.width), 104, WD.parts, 'Betűvető'));
const WB = word('Betűvető', 100, '#ffffff', S);
fs.writeFileSync(OUT + 'logo-wordmark-on-brand.svg', svg(Math.ceil(WB.width), 104, WB.parts, 'Betűvető'));
// horizontal lockup: mark 120 + gap 22 + wordmark 96px
const H = word('Betűvető', 96, INKT, S, 142, 60 - 96 * 0.776 / 2 + 96 * 0.776 * 0.62);
const hw = Math.ceil(142 + H.width);
fs.writeFileSync(OUT + 'logo-horizontal.svg', svg(hw, 120, `<g transform="scale(1.875)">${markInner(false)}</g>${H.parts}`, 'Betűvető'));
// stacked on brand
const ST = word('Betűvető', 56, '#ffffff', S, 0, 0);
const sw = Math.ceil(ST.width), stw = Math.max(sw, 132) + 64;
fs.writeFileSync(OUT + 'logo-stacked-on-brand.svg', svg(stw, 260, `<rect width="${stw}" height="260" rx="24" fill="${T}"/><g transform="translate(${(stw - 132) / 2} 24) scale(2.0625)">${markInner(true)}</g><g transform="translate(${(stw - sw) / 2} 222)">${ST.parts}</g>`, 'Betűvető'));
console.log(fs.readdirSync(OUT).join(' '));
