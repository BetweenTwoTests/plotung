/* Nested layout: pipe widths from lane occupancy, a weighted tidy layout for the upper tree,
 * lane assignment with crossing reduction inside every pipe, and per-level time layering for events. */
import { LEAF, DUP, TRANS, SPEC, SPECLOSS, STUB, LANE, PAD, GAP, STUBLEN, scratch } from './model.js';

/**
 * Lay out gene store G inside species tree S. Pure and deterministic; O(n log n) worst case.
 * Returns typed arrays indexed by species node (pipe) or gene node:
 *   pipeStart/pipeNodes  CSR of gene nodes per pipe (ids ascend, so parents precede children)
 *   L, W                 lanes and world width per pipe
 *   ext, xLeft, x        subtree extent, subtree left edge, pipe centre (orthogonal style)
 *   xs, topL, topW       pipe centre and top-edge slice for the slanted style
 *   subGenes, subEvents, pipeGenes, pipeEvents   aggregates for collapsed clades and tooltips
 *   target, gExt         mean leaf x and extant-leaf count under each gene node
 *   gT, tStart, lane     drawn time, segment start and (fractional) lane of each gene node
 *   transfers, recipient  transfer node ids and each transfer's recipient child
 */
export function layout(S, G) {
  const n = G.n, ns = S.n;
  const type = G.type, pipe = G.pipe, parent = G.parent, firstChild = G.firstChild, nextSibling = G.nextSibling, tSim = G.tSim;

  // per-pipe CSR of gene nodes
  const pipeStart = new Int32Array(ns + 1);
  for (let v = 0; v < n; v++) pipeStart[pipe[v] + 1]++;
  for (let s = 0; s < ns; s++) pipeStart[s + 1] += pipeStart[s];
  const pipeNodes = new Int32Array(n);
  const fillp = new Int32Array(ns);
  for (let v = 0; v < n; v++) { const s = pipe[v]; pipeNodes[pipeStart[s] + fillp[s]++] = v; }

  // lanes needed per pipe = local leaves of the pipe-local forest
  const L = new Int32Array(ns);
  const pipeGenes = new Int32Array(ns), pipeEvents = new Int32Array(ns);
  for (let v = 0; v < n; v++) {
    const ty = type[v];
    if (ty === LEAF || ty === SPEC || ty === SPECLOSS || ty === STUB) L[pipe[v]]++;
    if (ty === LEAF) pipeGenes[pipe[v]]++;
    if (ty === DUP || ty === TRANS || ty === STUB) pipeEvents[pipe[v]]++;
  }

  // upper-tree layout: width from lane count, extents bottom-up, positions top-down
  const W = new Float64Array(ns), ext = new Float64Array(ns), xLeft = new Float64Array(ns), x = new Float64Array(ns);
  const subGenes = new Int32Array(ns), subEvents = new Int32Array(ns);
  for (let s = 0; s < ns; s++) W[s] = Math.max(L[s], 1) * LANE + 2 * PAD;
  for (let i = ns - 1; i >= 0; i--) {
    const s = S.pre[i];
    let sum = 0, k = 0, g = pipeGenes[s], e = pipeEvents[s];
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) { sum += ext[c]; k++; g += subGenes[c]; e += subEvents[c]; }
    if (k > 0) sum += GAP * (k - 1);
    ext[s] = Math.max(W[s], sum);
    subGenes[s] = g; subEvents[s] = e;
  }
  xLeft[0] = 0;
  for (let i = 0; i < ns; i++) {
    const s = S.pre[i];
    x[s] = xLeft[s] + ext[s] / 2;
    let sum = 0, k = 0;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) { sum += ext[c]; k++; }
    if (k === 0) continue;
    sum += GAP * (k - 1);
    let cx = xLeft[s] + (ext[s] - sum) / 2;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) { xLeft[c] = cx; cx += ext[c] + GAP; }
  }

  // slanted style: a node sits at the mean of its children (classic slanted cladogram, keeps tubes from
  // crossing sibling clades); each child's tube starts on a proportional slice of the parent's bottom edge
  const xs = new Float64Array(ns), topL = new Float64Array(ns), topW = new Float64Array(ns);
  for (let i = ns - 1; i >= 0; i--) {
    const s = S.pre[i];
    let sum = 0, k = 0;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) { sum += xs[c]; k++; }
    xs[s] = k > 0 ? sum / k : x[s];
  }
  for (let i = 0; i < ns; i++) {
    const s = S.pre[i];
    let sw = 0;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) sw += W[c];
    let tl = xs[s] - W[s] / 2;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) { topW[c] = W[s] * W[c] / sw; topL[c] = tl; tl += topW[c]; }
  }
  topL[0] = xs[0] - W[0] / 2; topW[0] = W[0];

  // targets: mean x of the extant leaves below a gene node (children precede parents in reverse id order)
  const target = new Float64Array(n), gExt = new Int32Array(n);
  for (let v = n - 1; v >= 0; v--) {
    const ty = type[v];
    if (ty === LEAF) { gExt[v] = 1; target[v] = x[pipe[v]]; }
    else if (ty === STUB) { gExt[v] = 0; target[v] = x[pipe[v]]; }
    else {
      let e = 0, acc = 0;
      for (let c = firstChild[v]; c >= 0; c = nextSibling[c]) { e += gExt[c]; acc += target[c] * gExt[c]; }
      gExt[v] = e; target[v] = e > 0 ? acc / e : x[pipe[v]];
    }
  }

  // time layering: duplications & transfers get a rank inside their level so that parent < child,
  // events in one pipe never share a y, and a transfer is horizontal (one node, two pipes)
  const gT = new Float64Array(n);
  const isEv = new Uint8Array(n);
  const nLev = S.maxDepth + 1; // levels -1 .. maxDepth-1  -> index d+1
  const levCount = new Int32Array(nLev + 1);
  let nEv = 0;
  for (let v = 0; v < n; v++) {
    gT[v] = tSim[v];
    if (type[v] === DUP || type[v] === TRANS) { isEv[v] = 1; nEv++; levCount[Math.floor(tSim[v]) + 2]++; }
  }
  for (let d = 0; d < nLev; d++) levCount[d + 1] += levCount[d];
  const evNodes = new Int32Array(nEv);
  const lf = new Int32Array(nLev);
  for (let v = 0; v < n; v++) if (isEv[v]) { const li = Math.floor(tSim[v]) + 1; evNodes[levCount[li] + lf[li]++] = v; }
  const pos = new Int32Array(n).fill(-1);
  const lastInPipe = new Int32Array(ns).fill(-1);
  let maxLev = 0;
  for (let d = 0; d < nLev; d++) maxLev = Math.max(maxLev, levCount[d + 1] - levCount[d]);
  const lin = new Int32Array(maxLev), lout = new Int32Array(maxLev), pred1 = new Int32Array(maxLev), pred2 = new Int32Array(maxLev);
  for (let li = 0; li < nLev; li++) {
    const a = levCount[li], b = levCount[li + 1], m = b - a;
    if (m === 0) continue;
    const seg = evNodes.subarray(a, b);
    seg.sort((p, q) => tSim[p] - tSim[q]);
    const d = li - 1;
    for (let i = 0; i < m; i++) {
      const v = seg[i]; pos[v] = i;
      const p = parent[v], s = pipe[v];
      pred1[i] = (p >= 0 && isEv[p] && pos[p] >= 0 && Math.floor(tSim[p]) === d) ? pos[p] : -1;
      pred2[i] = lastInPipe[s]; lastInPipe[s] = i;
      let l = 0;
      if (pred1[i] >= 0) l = lin[pred1[i]] + 1;
      if (pred2[i] >= 0 && lin[pred2[i]] + 1 > l) l = lin[pred2[i]] + 1;
      lin[i] = l; lout[i] = 0;
    }
    for (let i = m - 1; i >= 0; i--) {
      const o = lout[i] + 1;
      if (pred1[i] >= 0 && lout[pred1[i]] < o) lout[pred1[i]] = o;
      if (pred2[i] >= 0 && lout[pred2[i]] < o) lout[pred2[i]] = o;
    }
    for (let i = 0; i < m; i++) {
      const v = seg[i];
      gT[v] = d + 0.22 + 0.7 * (lin[i] + 1) / (lin[i] + lout[i] + 2);
      lastInPipe[pipe[v]] = -1; pos[v] = -1;
    }
  }

  // segment starts and loss stubs (parents precede children in id order)
  const tStart = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const p = parent[v];
    tStart[v] = p < 0 ? -1 : gT[p];
    if (type[v] === STUB) gT[v] = Math.min(tStart[v] + STUBLEN, S.y[pipe[v]] - 0.05);
  }

  // lane assignment, pipe by pipe in upper-tree pre-order (a parent pipe is laid out before its children)
  const lane = new Float32Array(n);
  const rootKey = new Float64Array(n);
  const stackV = [], stackPh = [];
  for (let i = 0; i < ns; i++) {
    const s = S.pre[i];
    const a = pipeStart[s], b = pipeStart[s + 1];
    if (a === b) continue;
    const roots = [];
    for (let j = a; j < b; j++) {
      const v = pipeNodes[j], p = parent[v];
      if (p < 0 || pipe[p] !== s) {
        roots.push(v);
        // entering from the parent pipe: keep the parent's order; transfer-in or family root: aim at the target
        rootKey[v] = (p >= 0 && (type[p] === SPEC || type[p] === SPECLOSS))
          ? x[pipe[p]] - (L[pipe[p]] - 1) / 2 * LANE + lane[p] * LANE
          : target[v];
      }
    }
    roots.sort((u, v) => rootKey[u] - rootKey[v] || u - v);
    let next = 0;
    for (let r = 0; r < roots.length; r++) {
      stackV.push(roots[r]); stackPh.push(0);
      while (stackV.length) {
        const v = stackV.pop(), ph = stackPh.pop();
        let k = 0;
        for (let c = firstChild[v]; c >= 0; c = nextSibling[c]) if (pipe[c] === s) scratch[k++] = c;
        if (ph === 0) {
          if (k === 0) { lane[v] = next++; continue; }
          // order local children by where their descendants end up (tiny k: insertion sort)
          for (let p2 = 1; p2 < k; p2++) { const c = scratch[p2]; let q = p2 - 1; while (q >= 0 && target[scratch[q]] > target[c]) { scratch[q + 1] = scratch[q]; q--; } scratch[q + 1] = c; }
          stackV.push(v); stackPh.push(1);
          for (let q = k - 1; q >= 0; q--) { stackV.push(scratch[q]); stackPh.push(0); }
        } else {
          let lo = Infinity, hi = -Infinity;
          for (let q = 0; q < k; q++) { const l = lane[scratch[q]]; if (l < lo) lo = l; if (l > hi) hi = l; }
          lane[v] = (lo + hi) / 2;
        }
      }
    }
  }

  // transfers list + recipient child
  let nT = 0;
  for (let v = 0; v < n; v++) if (type[v] === TRANS) nT++;
  const transfers = new Int32Array(nT), recipient = new Int32Array(n).fill(-1);
  nT = 0;
  for (let v = 0; v < n; v++) if (type[v] === TRANS) {
    transfers[nT++] = v;
    for (let c = firstChild[v]; c >= 0; c = nextSibling[c]) if (pipe[c] !== pipe[v]) recipient[v] = c;
  }

  return { pipeStart, pipeNodes, L, W, ext, xLeft, x, xs, topL, topW, subGenes, subEvents, pipeGenes, pipeEvents, target, gExt, gT, tStart, lane, transfers, recipient,
    worldWidth: ext[0], worldTop: -1, worldBottom: S.maxDepth };
}

/** World x of a lane inside pipe s at time t (slanted tubes interpolate between the pipe's top and bottom edges). */
export function laneX(S, Lay, s, lane, t, slanted) {
  const L = Lay.L[s];
  if (!slanted) return Lay.x[s] - (L - 1) / 2 * LANE + lane * LANE;
  const bot = Lay.xs[s] - (L - 1) / 2 * LANE + lane * LANE;
  const top = Lay.topL[s] + (lane + 0.5) * Lay.topW[s] / Math.max(L, 1);
  const y0 = S.yTop[s], y1 = S.y[s];
  return top + (bot - top) * ((t - y0) / (y1 - y0));
}

/** Left and right wall of pipe s at time t, written into out[0], out[1]. */
export function pipeEdges(S, Lay, s, t, slanted, out) {
  const w = Lay.W[s];
  if (!slanted) { out[0] = Lay.x[s] - w / 2; out[1] = Lay.x[s] + w / 2; return out; }
  const bl = Lay.xs[s] - w / 2, br = Lay.xs[s] + w / 2;
  const y0 = S.yTop[s], y1 = S.y[s], f = (t - y0) / (y1 - y0);
  out[0] = Lay.topL[s] + (bl - Lay.topL[s]) * f;
  out[1] = (Lay.topL[s] + Lay.topW[s]) + (br - (Lay.topL[s] + Lay.topW[s])) * f;
  return out;
}
