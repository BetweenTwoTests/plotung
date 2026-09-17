/* Framework-free Canvas2D viewer: camera, culled drawing with level of detail, picking, minimap.
 * It knows nothing about control panels; wire it to any UI (see demo/demo.js). */
import { LEAF, DUP, TRANS, SPEC, SPECLOSS, STUB, TYPE_NAME, LANE, GAP, HB } from './model.js';
import { layout, laneX, pipeEdges } from './layout.js';

export const LIGHT_THEME = { bg: '#f1f2f4', tube: '#dfe3ea', tubeEdge: '#a3adbd', band: '#d3d9e3', grid: '#e3e5ea', ink: '#171a20', ink2: '#565d6b', ink3: '#868d99', heat: '#2a78d6', panel: '#f7f8fa' };
export const DARK_THEME = { bg: '#13151a', tube: '#242932', tubeEdge: '#4c5566', band: '#2c323d', grid: '#1c1f26', ink: '#eceef2', ink2: '#a8aeb9', ink3: '#6e7583', heat: '#3987e5', panel: '#1b1e24' };
// categorical slots in a CVD-checked order (light / dark steps of the same hues)
export const LIGHT_FAMILY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const DARK_FAMILY_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const MIN_SCALE = 2e-5, MAX_SCALE = 800;
const clampNum = (v, a, b) => Math.min(b, Math.max(a, v));
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function withAlpha(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
function famPaths(n) { const a = []; for (let i = 0; i < n; i++) a.push(new Path2D()); return a; }
const heatBucket = (copies) => copies <= 0 ? 0 : copies < 0.5 ? 1 : copies < 1 ? 2 : copies < 2 ? 3 : copies < 4 ? 4 : 5;
const HEAT_T = [0, 0.18, 0.34, 0.5, 0.68, 0.86];
function distSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? clampNum(((px - x0) * dx + (py - y0) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
}

/**
 * createViewer(canvas, options) -> viewer
 * options:
 *   minimap        a second <canvas> for the overview, or null
 *   labelFor(s)    leaf label for species node s
 *   familyColors   hex strings, one per gene family
 *   theme          see LIGHT_THEME for keys
 *   labelFont, rulerFont   canvas font strings
 *   rulerInset     px from the left edge for level labels (number or () => number)
 *   onHover(hit, x, y)     hit is {kind:'gene'|'transfer'|'pipe'|'clade', id} or null
 *   onDoubleClick(hit)     defaults to fitting the clade under the cursor
 *   onFrame(stats)         called after every frame with draw counts and ms
 *   reduceMotion           boolean; defaults to the prefers-reduced-motion media query
 */
export function createViewer(canvas, options = {}) {
  const o = {
    minimap: null, labelFor: (s) => `species ${s}`, familyColors: LIGHT_FAMILY_COLORS, theme: LIGHT_THEME,
    labelFont: '11px system-ui, sans-serif', rulerFont: '10px ui-monospace, monospace', rulerInset: 8,
    onHover: null, onDoubleClick: null, onFrame: null, reduceMotion: null,
    ...options,
  };
  const ctx = canvas.getContext('2d');
  const mm = o.minimap || null, mctx = mm ? mm.getContext('2d') : null;
  const reduceMotion = o.reduceMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let theme = { ...LIGHT_THEME, ...o.theme };
  let fam = o.familyColors.slice();
  let labelFor = o.labelFor;

  const st = {
    data: null,
    cam: { sx: 1, sy: 1, tx: 0, ty: 0 },
    slanted: false, showTransfers: true, showLosses: true, labels: true, heat: true,
    zoomMode: 'both', axisLock: null,
    hover: null, frame: 0, mainFrame: -1, w: 0, h: 0, dpr: 1,
    pipeFrame: null, mmCam: null, mmCache: null, mmDirty: true, dirty: false, anim: null,
    stats: { pipes: 0, wedges: 0, segs: 0, transfers: 0, ms: 0 }, destroyed: false,
  };

  // ------------------------------------------------------------ sizing
  function resize() {
    const r = canvas.getBoundingClientRect();
    st.w = Math.max(1, r.width); st.h = Math.max(1, r.height);
    st.dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    canvas.width = Math.round(st.w * st.dpr); canvas.height = Math.round(st.h * st.dpr);
    if (mm) { const mr = mm.getBoundingClientRect(); mm.width = Math.round(mr.width * st.dpr); mm.height = Math.round(mr.height * st.dpr); }
    st.mmDirty = true;
    invalidate();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) { ro.observe(canvas); if (mm) ro.observe(mm); }

  // ------------------------------------------------------------ camera
  function fitBox(x0, x1, y0, y1, w, h, pad, bottomPad) {
    const sx = (w - 2 * pad) / Math.max(1e-9, x1 - x0), sy = (h - 2 * pad - bottomPad) / Math.max(1e-9, y1 - y0);
    return { sx: clampNum(sx, MIN_SCALE, MAX_SCALE), sy: clampNum(sy, MIN_SCALE, MAX_SCALE), tx: pad - x0 * sx, ty: pad - y0 * sy };
  }
  function fitAll(animate) {
    if (!st.data) return;
    const { S, Lay } = st.data;
    setCamera(fitBox(0, Lay.worldWidth, -1, S.maxDepth, st.w, st.h, 40, st.labels ? 80 : 0), animate);
  }
  function fitClade(s, animate) {
    if (!st.data) return;
    const { S, Lay } = st.data;
    const yTop = S.yTop[s], yBot = S.firstChild[s] < 0 ? S.y[s] : S.maxDepth;
    setCamera(fitBox(Lay.xLeft[s], Lay.xLeft[s] + Lay.ext[s], yTop, yBot, st.w, st.h, 40, st.labels && yBot === S.maxDepth ? 80 : 0), animate);
  }
  function setCamera(c, animate) {
    if (!animate || reduceMotion) { Object.assign(st.cam, c); st.anim = null; invalidate(); return; }
    const from = { ...st.cam }, t0 = performance.now(), dur = 320;
    st.anim = (now) => {
      const u = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - u, 3);
      const sx = Math.exp(Math.log(from.sx) + (Math.log(c.sx) - Math.log(from.sx)) * e);
      const sy = Math.exp(Math.log(from.sy) + (Math.log(c.sy) - Math.log(from.sy)) * e);
      const cxFrom = (st.w / 2 - from.tx) / from.sx, cxTo = (st.w / 2 - c.tx) / c.sx;
      const cyFrom = (st.h / 2 - from.ty) / from.sy, cyTo = (st.h / 2 - c.ty) / c.sy;
      const cx = cxFrom + (cxTo - cxFrom) * e, cy = cyFrom + (cyTo - cyFrom) * e;
      st.cam.sx = sx; st.cam.sy = sy; st.cam.tx = st.w / 2 - cx * sx; st.cam.ty = st.h / 2 - cy * sy;
      if (u >= 1) { Object.assign(st.cam, c); st.anim = null; }
      return u < 1;
    };
    invalidate();
  }
  function zoomAt(fx, fy, mx, my) {
    const c = st.cam;
    const nsx = clampNum(c.sx * fx, MIN_SCALE, MAX_SCALE), nsy = clampNum(c.sy * fy, MIN_SCALE, MAX_SCALE);
    c.tx = mx - (mx - c.tx) * (nsx / c.sx); c.ty = my - (my - c.ty) * (nsy / c.sy);
    c.sx = nsx; c.sy = nsy;
    invalidate();
  }
  function pan(dx, dy) { st.cam.tx += dx; st.cam.ty += dy; invalidate(); }
  function invalidate() { if (!st.dirty && !st.destroyed) { st.dirty = true; requestAnimationFrame(frame); } }
  function frame(now) {
    st.dirty = false;
    if (st.destroyed) return;
    if (st.anim && !st.anim(now)) st.anim = null;
    render();
    if (st.anim) invalidate();
  }

  // ------------------------------------------------------------ scene
  // connector from the parent plus this node's own segment, in screen space
  function nodeSegment(P, v, s, cam, slanted, S, G, Lay) {
    const { sx, sy, tx, ty } = cam;
    const tv = G.type[v], p = G.parent[v], pty = p >= 0 ? G.type[p] : -1;
    const fromSpec = pty === SPEC || pty === SPECLOSS;
    const t0 = Lay.tStart[v] + (fromSpec ? HB : 0);
    let t1 = Lay.gT[v] - ((tv === SPEC || tv === SPECLOSS) ? HB : 0);
    if (t1 < t0) t1 = t0;
    const ln = Lay.lane[v];
    const x0 = laneX(S, Lay, s, ln, t0, slanted) * sx + tx, y0 = t0 * sy + ty;
    const x1 = laneX(S, Lay, s, ln, t1, slanted) * sx + tx, y1 = t1 * sy + ty;
    if (fromSpec) {
      const ps = G.pipe[p], tp = Lay.gT[p] - HB;
      P.moveTo(laneX(S, Lay, ps, Lay.lane[p], tp, slanted) * sx + tx, tp * sy + ty);
      P.lineTo(x0, y0);
    } else if (pty === DUP) {
      P.moveTo(laneX(S, Lay, s, Lay.lane[p], t0, slanted) * sx + tx, y0);
      P.lineTo(x0, y0);
    } else P.moveTo(x0, y0);
    P.lineTo(x1, y1);
    return [x1, y1];
  }

  function drawScene(g, w, h, cam, mini) {
    const { S, G, Lay } = st.data;
    const { sx, sy, tx, ty } = cam;
    const slanted = st.slanted;
    const frameId = ++st.frame;
    const pf = st.pipeFrame;
    const collapsePx = mini ? 1.25 : 3, genePx = 2.5;
    const tubes = new Path2D(), walls = new Path2D(), bands = new Path2D();
    const wedges = famPaths(6);
    const visible = [], leaves = [];
    let nPipes = 0, nWedges = 0, nSeg = 0, nT = 0;
    const stack = [0];
    while (stack.length) {
      const s = stack.pop();
      const xl = Lay.xLeft[s] * sx + tx, xr = xl + Lay.ext[s] * sx;
      if (xr < -1 || xl > w + 1) continue;
      const yT = S.yTop[s] * sy + ty, yB = S.maxDepth * sy + ty;
      if (yB < -1 || yT > h + 1) continue;
      const isLeaf = S.firstChild[s] < 0;
      const yP = S.y[s] * sy + ty;
      let tl, tr;
      if (slanted) { tl = Lay.topL[s] * sx + tx; tr = tl + Lay.topW[s] * sx; }
      else { tl = (Lay.x[s] - Lay.W[s] / 2) * sx + tx; tr = tl + Lay.W[s] * sx; }
      if (!isLeaf && (xr - xl) < collapsePx) {
        const P = wedges[st.heat ? heatBucket(Lay.subGenes[s] / S.below[s]) : 0];
        P.moveTo(tl, yT); P.lineTo(tr, yT); P.lineTo(xr, yB); P.lineTo(xl, yB); P.closePath();
        nWedges++;
        continue;
      }
      pf[s] = frameId; nPipes++;
      if (yP >= -1 && yT <= h + 1) {
        const bl = ((slanted ? Lay.xs[s] : Lay.x[s]) - Lay.W[s] / 2) * sx + tx, br = bl + Lay.W[s] * sx;
        if (slanted) { tubes.moveTo(tl, yT); tubes.lineTo(tr, yT); tubes.lineTo(br, yP); tubes.lineTo(bl, yP); tubes.closePath(); }
        else tubes.rect(bl, yT, br - bl, yP - yT);
        walls.moveTo(tl, yT); walls.lineTo(bl, yP); walls.moveTo(tr, yT); walls.lineTo(br, yP);
        if (Lay.W[s] * sx >= genePx && Lay.pipeStart[s] < Lay.pipeStart[s + 1]) visible.push(s);
        if (isLeaf) leaves.push(s);
      }
      if (!isLeaf) {
        if (!slanted && yP >= -20 && yP <= h + 20) {
          let l = Lay.x[s] - Lay.W[s] / 2, r = Lay.x[s] + Lay.W[s] / 2, last = -1;
          for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) { l = Math.min(l, Lay.x[c] - Lay.W[c] / 2); last = c; }
          r = Math.max(r, Lay.x[last] + Lay.W[last] / 2);
          const bh = Math.max(2, 2 * HB * sy);
          bands.rect(l * sx + tx, yP - bh / 2, (r - l) * sx, bh);
        }
        for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) stack.push(c);
      }
    }

    // upper tree
    g.fillStyle = theme.tube; g.fill(tubes);
    g.fillStyle = theme.band; g.fill(bands);
    g.lineWidth = 1; g.strokeStyle = theme.tubeEdge; g.stroke(walls);
    for (let b = 0; b < 6; b++) {
      g.fillStyle = HEAT_T[b] === 0 ? theme.tube : mixHex(theme.tube, theme.heat, HEAT_T[b]);
      g.fill(wedges[b]);
    }
    if (!mini) { g.strokeStyle = withAlpha(theme.tubeEdge, 0.5); for (let b = 0; b < 6; b++) g.stroke(wedges[b]); }

    // lower trees
    const nf = fam.length;
    const segs = famPaths(nf), squares = [], xmarks = famPaths(nf), dots = famPaths(nf);
    for (let f = 0; f < nf; f++) squares.push([]);
    const dense = sx * LANE < 0.7;
    const showL = st.showLosses, dotZoom = sx * LANE >= 5;
    const sq = clampNum(sx * LANE * 0.45, 4, 9), xr_ = clampNum(sx * LANE * 0.35, 3, 6);
    for (let i = 0; i < visible.length; i++) {
      const s = visible[i];
      const a = Lay.pipeStart[s], b = Lay.pipeStart[s + 1];
      if (dense) { // lanes are sub-pixel: paint the occupied lane band as one translucent block
        const L = Lay.L[s];
        if (L === 0) continue;
        const x0 = laneX(S, Lay, s, -0.5, S.yTop[s], slanted) * sx + tx, x1 = laneX(S, Lay, s, L - 0.5, S.yTop[s], slanted) * sx + tx;
        g.fillStyle = withAlpha(theme.ink, 0.28);
        g.fillRect(x0, S.yTop[s] * sy + ty, Math.max(1, x1 - x0), (S.y[s] - S.yTop[s]) * sy);
        continue;
      }
      for (let j = a; j < b; j++) {
        const v = Lay.pipeNodes[j], tv = G.type[v];
        if (tv === STUB && !showL) continue;
        const f = G.family[v] % nf;
        const [x1, y1] = nodeSegment(segs[f], v, s, cam, slanted, S, G, Lay);
        nSeg++;
        if (tv === DUP) squares[f].push(x1, y1);
        else if (tv === STUB) { const P = xmarks[f]; P.moveTo(x1 - xr_, y1 - xr_); P.lineTo(x1 + xr_, y1 + xr_); P.moveTo(x1 + xr_, y1 - xr_); P.lineTo(x1 - xr_, y1 + xr_); }
        else if ((tv === SPEC || tv === SPECLOSS) && dotZoom) { dots[f].moveTo(x1 + 2.5, y1); dots[f].arc(x1, y1, 2.5, 0, Math.PI * 2); }
      }
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = mini ? 1 : clampNum(sx * LANE * 0.16, 1, 2);
    for (let f = 0; f < nf; f++) { g.strokeStyle = fam[f]; g.stroke(segs[f]); }

    // transfers: only once lanes are resolvable, fading in with zoom so they never bury the tree
    if (st.showTransfers && !dense) {
      const tr = Lay.transfers, arrows = famPaths(nf), heads = famPaths(nf);
      const bul = clampNum(0.3 * sy, 6, 40), hl = mini ? 3 : 6;
      const alpha = mini ? 0.8 : clampNum(sx * LANE / 3, 0.4, 1);
      for (let i = 0; i < tr.length; i++) {
        const v = tr[i], s = G.pipe[v], rc = Lay.recipient[v], r = G.pipe[rc];
        if (pf[s] !== frameId && pf[r] !== frameId) continue;
        const t = Lay.gT[v], y = t * sy + ty;
        if (y < -50 || y > h + 50) continue;
        const x0 = laneX(S, Lay, s, Lay.lane[v], t, slanted) * sx + tx, x1 = laneX(S, Lay, r, Lay.lane[rc], t, slanted) * sx + tx;
        if (Math.max(x0, x1) < -1 || Math.min(x0, x1) > w + 1) continue;
        const f = G.family[v] % nf, cx = (x0 + x1) / 2, cy = y - bul;
        arrows[f].moveTo(x0, y); arrows[f].quadraticCurveTo(cx, cy, x1, y);
        const ang = Math.atan2(y - cy, x1 - cx);
        heads[f].moveTo(x1, y);
        heads[f].lineTo(x1 - hl * Math.cos(ang - 0.42), y - hl * Math.sin(ang - 0.42));
        heads[f].lineTo(x1 - hl * Math.cos(ang + 0.42), y - hl * Math.sin(ang + 0.42));
        heads[f].closePath();
        nT++;
      }
      g.setLineDash([4, 3]); g.lineWidth = mini ? 1 : 1.25; g.globalAlpha = alpha;
      for (let f = 0; f < nf; f++) { g.strokeStyle = fam[f]; g.stroke(arrows[f]); }
      g.setLineDash([]);
      for (let f = 0; f < nf; f++) { g.fillStyle = fam[f]; g.fill(heads[f]); }
      g.globalAlpha = 1;
    }

    // glyphs (a surface ring under each mark keeps overlapping marks legible)
    if (!mini) {
      for (let f = 0; f < nf; f++) {
        const q = squares[f];
        if (q.length) {
          g.fillStyle = theme.bg;
          for (let i = 0; i < q.length; i += 2) g.fillRect(q[i] - sq / 2 - 1, q[i + 1] - sq / 2 - 1, sq + 2, sq + 2);
          g.fillStyle = fam[f];
          for (let i = 0; i < q.length; i += 2) g.fillRect(q[i] - sq / 2, q[i + 1] - sq / 2, sq, sq);
        }
        g.lineWidth = 3; g.strokeStyle = theme.bg; g.stroke(xmarks[f]);
        g.lineWidth = 1.5; g.strokeStyle = fam[f]; g.stroke(xmarks[f]);
        g.lineWidth = 2; g.strokeStyle = theme.bg; g.stroke(dots[f]);
        g.fillStyle = fam[f]; g.fill(dots[f]);
      }
    }

    // leaf labels
    if (!mini && st.labels) {
      const yB = S.maxDepth * sy + ty + 8;
      if (yB < h) {
        g.fillStyle = theme.ink2; g.textBaseline = 'middle'; g.font = o.labelFont;
        for (let i = 0; i < leaves.length; i++) {
          const s = leaves[i], pitch = (Lay.ext[s] + GAP) * sx;
          if (pitch < 11) continue;
          const x = Lay.x[s] * sx + tx;
          if (x < -10 || x > w + 10) continue;
          const name = labelFor(s);
          if (pitch >= 110) { g.textAlign = 'center'; g.fillText(name, x, yB + 6); }
          else { g.save(); g.translate(x, yB); g.rotate(Math.PI / 2); g.textAlign = 'left'; g.fillText(name, 0, 0); g.restore(); }
        }
      }
    }
    return { frameId, nPipes, nWedges, nSeg, nT };
  }

  function drawRuler(g, w, h, cam) {
    const { S } = st.data;
    const { sy, ty } = cam;
    if (sy < 14) return;
    const d0 = Math.max(-1, Math.ceil((0 - ty) / sy)), d1 = Math.min(S.maxDepth, Math.floor((h - ty) / sy));
    const inset = typeof o.rulerInset === 'function' ? o.rulerInset() : o.rulerInset;
    g.strokeStyle = theme.grid; g.lineWidth = 1;
    g.fillStyle = theme.ink3; g.font = o.rulerFont; g.textAlign = 'left'; g.textBaseline = 'bottom';
    for (let d = d0; d <= d1; d++) {
      const y = Math.round(d * sy + ty) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      if (sy >= 22) g.fillText(d === S.maxDepth ? 'present' : d === -1 ? 'origin' : 't = ' + d, inset, y - 2);
    }
  }

  function drawHover(g, cam) {
    const hv = st.hover;
    if (!hv) return;
    const { S, G, Lay } = st.data;
    if (hv.kind === 'gene' || hv.kind === 'transfer') {
      const f = G.family[hv.id] % fam.length;
      const P = new Path2D();
      let v = hv.id, guard = 0;
      while (v >= 0 && guard++ < 100000) { nodeSegment(P, v, G.pipe[v], cam, st.slanted, S, G, Lay); v = G.parent[v]; }
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = 7; g.strokeStyle = withAlpha(fam[f], 0.25); g.stroke(P);
      g.lineWidth = 2.5; g.strokeStyle = fam[f]; g.stroke(P);
    } else {
      const s = hv.id, { sx, sy, tx, ty } = cam;
      g.strokeStyle = withAlpha(theme.ink, 0.55); g.lineWidth = 1.5; g.setLineDash([3, 3]);
      const yB = (hv.kind === 'clade' || S.firstChild[s] >= 0 ? S.maxDepth : S.y[s]) * sy + ty;
      g.strokeRect(Lay.xLeft[s] * sx + tx - 2, S.yTop[s] * sy + ty - 2, Lay.ext[s] * sx + 4, yB - (S.yTop[s] * sy + ty) + 4);
      g.setLineDash([]);
    }
  }

  function render() {
    if (!st.data || st.destroyed) return;
    const { w, h, dpr, cam } = st;
    const t0 = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, w, h);
    drawRuler(ctx, w, h, cam);
    const r = drawScene(ctx, w, h, cam, false);
    st.mainFrame = r.frameId;
    drawHover(ctx, cam);
    if (mm) drawMinimap();
    st.stats = { pipes: r.nPipes, wedges: r.nWedges, segs: r.nSeg, transfers: r.nT, ms: performance.now() - t0 };
    if (o.onFrame) o.onFrame(st.stats);
  }

  // ------------------------------------------------------------ minimap
  function drawMinimap() {
    const { S, Lay } = st.data;
    const mw = mm.width / st.dpr, mh = mm.height / st.dpr;
    if (mw < 10 || mh < 10) return;
    if (st.mmDirty || !st.mmCache) {
      st.mmCam = fitBox(0, Lay.worldWidth, -1, S.maxDepth, mw, mh, 6, 0);
      const cache = document.createElement('canvas');
      cache.width = mm.width; cache.height = mm.height;
      const cg = cache.getContext('2d');
      cg.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      cg.fillStyle = theme.panel; cg.fillRect(0, 0, mw, mh);
      drawScene(cg, mw, mh, st.mmCam, true);
      st.frame++; // minimap stamps must never masquerade as the main frame
      st.mmCache = cache; st.mmDirty = false;
    }
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(st.mmCache, 0, 0);
    mctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    const c = st.cam, m = st.mmCam;
    const x0 = clampNum(((0 - c.tx) / c.sx) * m.sx + m.tx, 0, mw), x1 = clampNum(((st.w - c.tx) / c.sx) * m.sx + m.tx, 0, mw);
    const y0 = clampNum(((0 - c.ty) / c.sy) * m.sy + m.ty, 0, mh), y1 = clampNum(((st.h - c.ty) / c.sy) * m.sy + m.ty, 0, mh);
    mctx.fillStyle = withAlpha(theme.heat, 0.12); mctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    mctx.strokeStyle = theme.heat; mctx.lineWidth = 1.5; mctx.strokeRect(x0 + 0.75, y0 + 0.75, Math.max(2, x1 - x0 - 1.5), Math.max(2, y1 - y0 - 1.5));
  }
  let mmDrag = false;
  function mmCenter(e) {
    const r = mm.getBoundingClientRect(), m = st.mmCam; if (!m) return;
    const wx = (e.clientX - r.left - m.tx) / m.sx, wy = (e.clientY - r.top - m.ty) / m.sy;
    st.cam.tx = st.w / 2 - wx * st.cam.sx; st.cam.ty = st.h / 2 - wy * st.cam.sy;
    invalidate();
  }
  const mmHandlers = mm ? {
    pointerdown: (e) => { mmDrag = true; mm.setPointerCapture(e.pointerId); mmCenter(e); },
    pointermove: (e) => { if (mmDrag) mmCenter(e); },
    pointerup: () => { mmDrag = false; },
  } : null;
  if (mm) for (const k in mmHandlers) mm.addEventListener(k, mmHandlers[k]);

  // ------------------------------------------------------------ picking
  const edgeBuf = [0, 0];
  function pick(mx, my) {
    const d = st.data; if (!d) return null;
    const { S, G, Lay } = d, { sx, sy, tx, ty } = st.cam, slanted = st.slanted;
    const wx = (mx - tx) / sx, wy = (my - ty) / sy;
    let s = 0, hitPipe = -1, clade = -1;
    const inPipe = (c) => {
      if (wy < S.yTop[c] || wy > S.y[c]) return false;
      pipeEdges(S, Lay, c, wy, slanted, edgeBuf);
      return wx >= edgeBuf[0] - 0.3 && wx <= edgeBuf[1] + 0.3;
    };
    if (inPipe(0)) hitPipe = 0;
    else for (;;) {
      if (wx < Lay.xLeft[s] || wx > Lay.xLeft[s] + Lay.ext[s]) break;
      if (Lay.ext[s] * sx < 3 && S.firstChild[s] >= 0) { clade = s; break; }
      // a slanted tube can hang outside its own clade's extent near the top, so test children's tubes first
      for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) if (inPipe(c)) { hitPipe = c; break; }
      if (hitPipe >= 0) break;
      let next = -1;
      for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) if (wx >= Lay.xLeft[c] && wx <= Lay.xLeft[c] + Lay.ext[c]) { next = c; break; }
      if (next < 0) break;
      s = next;
    }
    let best = null, bestD = 6;
    if (hitPipe >= 0 && Lay.W[hitPipe] * sx >= 2.5 && sx * LANE >= 0.7) {
      const a = Lay.pipeStart[hitPipe], b = Lay.pipeStart[hitPipe + 1];
      for (let j = a; j < b; j++) {
        const v = Lay.pipeNodes[j], tv = G.type[v];
        if (tv === STUB && !st.showLosses) continue;
        const t0 = Lay.tStart[v], t1 = Lay.gT[v];
        const x0 = laneX(S, Lay, hitPipe, Lay.lane[v], t0, slanted) * sx + tx, y0 = t0 * sy + ty;
        const x1 = laneX(S, Lay, hitPipe, Lay.lane[v], t1, slanted) * sx + tx, y1 = t1 * sy + ty;
        const dd = distSeg(mx, my, x0, y0, x1, y1);
        const glyph = (tv === DUP || tv === STUB) ? Math.hypot(mx - x1, my - y1) - 4 : Infinity;
        const dist = Math.min(dd, glyph);
        if (dist < bestD) { bestD = dist; best = { kind: 'gene', id: v }; }
      }
    }
    if (st.showTransfers && !best && sx * LANE >= 0.7) {
      const tr = Lay.transfers, pf = st.pipeFrame, fr = st.mainFrame, bul = clampNum(0.3 * sy, 6, 40);
      for (let i = 0; i < tr.length; i++) {
        const v = tr[i], s0 = G.pipe[v], rc = Lay.recipient[v], r = G.pipe[rc];
        if (pf[s0] !== fr && pf[r] !== fr) continue;
        const t = Lay.gT[v], y = t * sy + ty;
        if (Math.abs(my - y) > bul + 8) continue;
        const x0 = laneX(S, Lay, s0, Lay.lane[v], t, slanted) * sx + tx, x1 = laneX(S, Lay, r, Lay.lane[rc], t, slanted) * sx + tx;
        if (mx < Math.min(x0, x1) - 8 || mx > Math.max(x0, x1) + 8) continue;
        const cx = (x0 + x1) / 2, cy = y - bul;
        let px = x0, py = y;
        for (let k = 1; k <= 12; k++) {
          const u = k / 12, qx = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1, qy = (1 - u) * (1 - u) * y + 2 * (1 - u) * u * cy + u * u * y;
          const dd = distSeg(mx, my, px, py, qx, qy);
          if (dd < bestD) { bestD = dd; best = { kind: 'transfer', id: v }; }
          px = qx; py = qy;
        }
      }
    }
    if (best) return best;
    if (hitPipe >= 0) return { kind: 'pipe', id: hitPipe };
    if (clade >= 0) return { kind: 'clade', id: clade };
    return null;
  }

  /** Plain-data description of a hit, for tooltips. */
  function describe(hit) {
    if (!hit || !st.data) return null;
    const { S, G, Lay } = st.data;
    if (hit.kind === 'gene' || hit.kind === 'transfer') {
      const v = hit.id, ty = G.type[v];
      return { kind: hit.kind, node: v, type: ty, typeName: TYPE_NAME[ty], family: G.family[v], pipe: G.pipe[v], t: Lay.gT[v], extant: Lay.gExt[v],
        recipientPipe: ty === TRANS ? G.pipe[Lay.recipient[v]] : -1 };
    }
    const s = hit.id, leaf = S.firstChild[s] < 0;
    let perFamily = null;
    if (leaf) {
      perFamily = new Map();
      for (let j = Lay.pipeStart[s]; j < Lay.pipeStart[s + 1]; j++) {
        const v = Lay.pipeNodes[j];
        if (G.type[v] === LEAF) perFamily.set(G.family[v], (perFamily.get(G.family[v]) || 0) + 1);
      }
    }
    return { kind: hit.kind, pipe: s, leaf, depth: S.depth[s], below: S.below[s], lanes: Lay.L[s], genes: Lay.pipeGenes[s], events: Lay.pipeEvents[s],
      subGenes: Lay.subGenes[s], subEvents: Lay.subEvents[s], perFamily };
  }
  function setHover(hv) {
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
    if (!same(hv, st.hover)) { st.hover = hv; invalidate(); }
  }

  // ------------------------------------------------------------ input
  const pointers = new Map();
  let drag = null, pinch = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const handlers = {
    wheel: (e) => {
      e.preventDefault();
      let d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 200;
      const f = Math.exp(-clampNum(d, -240, 240) * 0.0022);
      const pinchGesture = e.ctrlKey || e.metaKey;
      const mode = pinchGesture ? 'both' : (st.axisLock || (e.shiftKey ? 'x' : e.altKey ? 'y' : st.zoomMode));
      const [mx, my] = pos(e);
      zoomAt(mode === 'y' ? 1 : f, mode === 'x' ? 1 : f, mx, my);
    },
    pointerdown: (e) => {
      canvas.setPointerCapture(e.pointerId);
      const [mx, my] = pos(e);
      pointers.set(e.pointerId, [mx, my]);
      if (pointers.size === 1) { drag = { x: mx, y: my }; canvas.classList.add('grabbing'); }
      else if (pointers.size === 2) { drag = null; const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; }
      if (o.onHover) o.onHover(null, mx, my);
    },
    pointermove: (e) => {
      const [mx, my] = pos(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [mx, my]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        const f = d / Math.max(1, pinch.d);
        zoomAt(f, f, cx, cy);
        st.cam.tx += cx - pinch.cx; st.cam.ty += cy - pinch.cy;
        pinch = { d, cx, cy };
        invalidate();
        return;
      }
      if (drag) { pan(mx - drag.x, my - drag.y); drag.x = mx; drag.y = my; return; }
      if (e.pointerType === 'mouse') {
        const hv = pick(mx, my);
        setHover(hv);
        if (o.onHover) o.onHover(hv, mx, my);
      }
    },
    pointerup: endPointer, pointercancel: endPointer,
    pointerleave: () => { if (!drag) { setHover(null); if (o.onHover) o.onHover(null, -1, -1); } },
    dblclick: (e) => {
      const [mx, my] = pos(e);
      const hv = pick(mx, my);
      if (o.onDoubleClick) { o.onDoubleClick(hv, mx, my); return; }
      if (!hv) return;
      fitClade((hv.kind === 'gene' || hv.kind === 'transfer') ? st.data.G.pipe[hv.id] : hv.id, true);
    },
  };
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; canvas.classList.remove('grabbing'); }
  }
  for (const k in handlers) canvas.addEventListener(k, handlers[k], k === 'wheel' ? { passive: false } : undefined);

  // ------------------------------------------------------------ public API
  const api = {
    /** data = {S, G, Lay?}; Lay is computed when missing. Fits the whole scene. */
    setData(data) {
      const Lay = data.Lay || layout(data.S, data.G);
      st.data = { S: data.S, G: data.G, Lay };
      st.pipeFrame = new Int32Array(data.S.n);
      st.hover = null; st.mmDirty = true; st.mmCache = null;
      fitAll(false);
      return api;
    },
    setOptions(partial) {
      for (const k of ['slanted', 'showTransfers', 'showLosses', 'labels', 'heat', 'zoomMode', 'axisLock']) if (k in partial) st[k] = partial[k];
      st.mmDirty = true; invalidate();
      return api;
    },
    setTheme(t) { theme = { ...theme, ...t }; st.mmDirty = true; invalidate(); return api; },
    setFamilyColors(colors) { fam = colors.slice(); st.mmDirty = true; invalidate(); return api; },
    setLabelFor(fn) { labelFor = fn; invalidate(); return api; },
    getOptions() { return { slanted: st.slanted, showTransfers: st.showTransfers, showLosses: st.showLosses, labels: st.labels, heat: st.heat, zoomMode: st.zoomMode, axisLock: st.axisLock }; },
    getCamera() { return { ...st.cam }; },
    setCamera(cam, animate) { setCamera({ ...st.cam, ...cam }, animate); return api; },
    getStats() { return { ...st.stats }; },
    getData() { return st.data; },
    getSize() { return { width: st.w, height: st.h }; },
    fitAll, fitClade, zoomAt, pan, pick, describe,
    setHover(hit) { setHover(hit); return api; },
    invalidate, resize, render,
    destroy() {
      st.destroyed = true;
      for (const k in handlers) canvas.removeEventListener(k, handlers[k]);
      if (mm) for (const k in mmHandlers) mm.removeEventListener(k, mmHandlers[k]);
      if (ro) ro.disconnect();
    },
  };
  resize();
  return api;
}
