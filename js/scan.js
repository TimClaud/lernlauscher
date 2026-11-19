// Scanner: Ecken finden, schräge Fotos gerade ziehen, Schrift schärfen – alles auf dem Gerät.
import { loadImage } from './ai.js';

// --- Ecken automatisch finden (helles Blatt auf dunklerem Untergrund) ---
export async function autoCorners(blob) {
  const img = await loadImage(blob);
  const W = 320, sc = W / Math.max(img.width, img.height);
  const w = Math.max(8, Math.round(img.width * sc)), h = Math.max(8, Math.round(img.height * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = v; hist[v]++;
  }
  // Otsu-Schwelle
  const total = w * h; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2; if (between > max) { max = between; thr = i; }
  }
  // größte helle zusammenhängende Fläche
  const lab = new Int32Array(w * h).fill(-1);
  let best = null, bestSize = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (lab[start] !== -1 || gray[start] <= thr) continue;
    let size = 0; const pts = { tl: [0, 0, Infinity], tr: [0, 0, -Infinity], br: [0, 0, -Infinity], bl: [0, 0, Infinity] };
    stack.push(start); lab[start] = start;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p / w) | 0;
      if (x + y < pts.tl[2]) pts.tl = [x, y, x + y];
      if (x - y > pts.tr[2]) pts.tr = [x, y, x - y];
      if (x + y > pts.br[2]) pts.br = [x, y, x + y];
      if (x - y < pts.bl[2]) pts.bl = [x, y, x - y];
      const nb = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || q >= w * h) continue;
        if ((k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
        if (lab[q] === -1 && gray[q] > thr) { lab[q] = start; stack.push(q); }
      }
    }
    if (size > bestSize) { bestSize = size; best = pts; }
  }
  const frac = bestSize / total;
  if (!best || frac < 0.15 || frac > 0.98) return defaultCorners();
  const n = (p) => [Math.min(1, Math.max(0, p[0] / w)), Math.min(1, Math.max(0, p[1] / h))];
  const corners = [n(best.tl), n(best.tr), n(best.br), n(best.bl)];
  // Plausibilität: Fläche des Vierecks
  if (quadArea(corners) < 0.12) return defaultCorners();
  return corners;
}
export const defaultCorners = () => [[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]];
function quadArea(q) {
  let a = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

// --- Perspektive (Homographie) ---
function homography(src, dst) {
  // löst H so, dass dst = H * src (8 Unbekannte)
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const hh = solve(A, b);
  return [...hh, 1];
}
function solve(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const div = M[c][c] || 1e-12;
    for (let k = c; k <= n; k++) M[c][k] /= div;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map(r => r[n]);
}

export async function processScan(blob, cornersNorm, mode = 'magic', maxSide = 2000) {
  const img = await loadImage(blob);
  const iw = img.width, ih = img.height;
  // Quelle ggf. verkleinern, damit iPhones nicht an Speichergrenzen stoßen
  const srcScale = Math.min(1, 3000 / Math.max(iw, ih));
  const sw = Math.round(iw * srcScale), sh = Math.round(ih * srcScale);
  const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
  const sg = sc.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0, sw, sh);
  const sdata = sg.getImageData(0, 0, sw, sh).data;
  const q = cornersNorm.map(([x, y]) => [x * sw, y * sh]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let oh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(ow, oh));
  ow = Math.max(10, Math.round(ow * k)); oh = Math.max(10, Math.round(oh * k));
  const H = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], q);
  const oc = document.createElement('canvas'); oc.width = ow; oc.height = oh;
  const og = oc.getContext('2d');
  const out = og.createImageData(ow, oh);
  const od = out.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const den = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / den;
      const sy = (H[3] * x + H[4] * y + H[5]) / den;
      const o = (y * ow + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue; }
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sdata[i00 + ch] * (1 - fx) + sdata[i10 + ch] * fx;
        const bot = sdata[i01 + ch] * (1 - fx) + sdata[i11 + ch] * fx;
        od[o + ch] = top * (1 - fy) + bot * fy;
      }
      od[o + 3] = 255;
    }
  }
  enhance(out, mode);
  og.putImageData(out, 0, 0);
  return await new Promise(r => oc.toBlob(r, 'image/jpeg', 0.88));
}

// --- Bildverbesserung ---
// magic: Beleuchtung ausgleichen (Papier wird weiß, Schrift bleibt farbig) + schärfen
// bw: wie magic, dann Graustufen mit starkem Kontrast (wie ein Kopierer)
// board: Tafel/Whiteboard – Kontrast & Sättigung anheben, schärfen
// original: nur gerade ziehen
function enhance(img, mode) {
  if (mode === 'original') return;
  const { width: w, height: h, data: d } = img;
  if (mode === 'magic' || mode === 'bw') {
    const bg = backgroundMap(d, w, h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const b = Math.max(40, bg[p]);
      for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] / b * 255 * 1.02);
    }
    if (mode === 'bw') {
      for (let i = 0; i < d.length; i += 4) {
        let v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        v = clamp((v - 128) * 1.9 + 150);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    } else {
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp((d[i + c] - 128) * 1.15 + 136);
    }
    sharpen(d, w, h, 0.6);
  } else if (mode === 'board') {
    autoLevels(d);
    for (let i = 0; i < d.length; i += 4) {
      const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
      for (let c = 0; c < 3; c++) d[i + c] = clamp(avg + (d[i + c] - avg) * 1.35);
    }
    sharpen(d, w, h, 0.8);
  }
}
const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v;

function backgroundMap(d, w, h) {
  // Helligkeit des Papiers schätzen: verkleinern, Maximum-Filter, Weichzeichnen, wieder hochrechnen
  const f = 16, sw = Math.ceil(w / f), sh = Math.ceil(h / f);
  const small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let m = 0;
    for (let yy = y * f; yy < Math.min(h, (y + 1) * f); yy += 2) for (let xx = x * f; xx < Math.min(w, (x + 1) * f); xx += 2) {
      const i = (yy * w + xx) * 4; const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (v > m) m = v;
    }
    small[y * sw + x] = m;
  }
  let a = boxBlur(maxFilter(small, sw, sh, 2), sw, sh, 2);
  a = boxBlur(a, sw, sh, 2);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(sh - 1.001, Math.max(0, y / f - 0.5)), y0 = gy | 0, fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(sw - 1.001, Math.max(0, x / f - 0.5)), x0 = gx | 0, fx = gx - x0;
      const y1 = Math.min(sh - 1, y0 + 1), x1 = Math.min(sw - 1, x0 + 1);
      const v = a[y0 * sw + x0] * (1 - fx) * (1 - fy) + a[y0 * sw + x1] * fx * (1 - fy) + a[y1 * sw + x0] * (1 - fx) * fy + a[y1 * sw + x1] * fx * fy;
      out[y * w + x] = v;
    }
  }
  return out;
}
function maxFilter(a, w, h, r) {
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = a[yy * w + xx]; if (v > m) m = v;
    }
    o[y * w + x] = m;
  }
  return o;
}
function boxBlur(a, w, h, r) {
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += a[yy * w + xx]; n++;
    }
    o[y * w + x] = s / n;
  }
  return o;
}
function autoLevels(d) {
  const hist = new Array(256).fill(0); let n = 0;
  for (let i = 0; i < d.length; i += 16) { hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++; n++; }
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
  const sc = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp((d[i + c] - lo) * sc);
}
function sharpen(d, w, h, amount) {
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const blur = (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]) / 4;
      d[i + c] = clamp(src[i + c] + (src[i + c] - blur) * amount * 2);
    }
  }
}

// --- PDF ---
let jsPDFp = null;
function loadJsPDF() {
  if (!jsPDFp) jsPDFp = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { jsPDFp = null; rej(new Error('PDF-Modul konnte nicht geladen werden (offline?)')); };
    document.head.appendChild(s);
  });
  return jsPDFp;
}
export async function pagesToPdf(blobs, title = 'Scan') {
  const jsPDF = await loadJsPDF();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title });
  for (let i = 0; i < blobs.length; i++) {
    const img = await loadImage(blobs[i]);
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blobs[i]); });
    if (i) pdf.addPage('a4');
    const pw = 210, ph = 297, m = 6;
    const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const w = img.width * s, h = img.height * s;
    pdf.addImage(dataUrl, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST');
  }
  return pdf.output('blob');
}
