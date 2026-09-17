/* Optional synthetic data for demos and stress tests (import from 'plotung/simulate', not part of the
 * main entry). A random upper tree and gene families grown along it with a duplication–transfer–loss
 * process, then pruned to what a reconciliation could observe. Produces the compact form directly. */
import { LEAF, DUP, TRANS, SPEC, SPECLOSS, LOSS, LowerForest, finishUpper, scratch, type UpperTree } from './model.ts';
import { layout } from './layout.ts';
import type { Scene } from './types.ts';

/** Deterministic mulberry32 RNG in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random upper tree by recursive uniform splitting (Yule-like shape), with polytomies at probability polyProb. */
export function buildUpper(nLeaves: number, polyProb: number, rng: () => number): UpperTree {
  const cap = Math.max(2, 2 * nLeaves);
  const parent = new Int32Array(cap).fill(-1), firstChild = new Int32Array(cap).fill(-1), nextSibling = new Int32Array(cap).fill(-1);
  const depth = new Int32Array(cap), below = new Int32Array(cap);
  let n = 1;
  below[0] = nLeaves;
  const st = [0];
  while (st.length) {
    const v = st.pop()!;
    const m = below[v];
    if (m === 1) continue;
    let k = 2;
    if (m >= 3 && rng() < polyProb) k = (m >= 4 && rng() < 0.4) ? 4 : 3;
    const cuts: number[] = [];
    while (cuts.length < k - 1) {
      const c = 1 + Math.floor(rng() * (m - 1));
      if (cuts.indexOf(c) < 0) cuts.push(c);
    }
    cuts.sort((a, b) => a - b);
    let prev = 0, last = -1;
    for (let i = 0; i < k; i++) {
      const end = i < k - 1 ? cuts[i] : m;
      const c = n++;
      parent[c] = v; depth[c] = depth[v] + 1; below[c] = end - prev; prev = end;
      if (last < 0) firstChild[v] = c; else nextSibling[last] = c;
      last = c;
      st.push(c);
    }
  }
  return finishUpper({ n, nLeaves, parent: parent.subarray(0, n), firstChild: firstChild.subarray(0, n), nextSibling: nextSibling.subarray(0, n), depth: depth.subarray(0, n), below: below.subarray(0, n) });
}

export type Rates = { rD: number; rT: number; rL: number; locality: number };

/** A pipe alive at time t, other than s; with probability `locality` a near neighbour in x order. */
export function pickRecipient(S: UpperTree, s: number, t: number, locality: number, rng: () => number): number {
  const d = Math.floor(t);
  if (d < 0 || d >= S.maxDepth) return -1;
  const a = S.levelStart[d], b = S.levelStart[d + 1], cnt = b - a;
  if (cnt < 2) return -1;
  const ps = S.preIndex[s];
  let lo = a, hi = b - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (S.preIndex[S.levelPipes[mid]] < ps) lo = mid + 1; else hi = mid; }
  const idx = lo;
  let j: number;
  if (rng() < locality) {
    let off = 1;
    while (rng() < 0.6 && off < cnt) off++;
    j = rng() < 0.5 ? idx - off : idx + off;
    if (j < a) j = idx + off;
    if (j >= b) j = idx - off;
    if (j < a || j >= b) return -1;
  } else {
    j = a + Math.floor(rng() * (cnt - 1));
    if (j >= idx) j++;
  }
  return S.levelPipes[j];
}

/**
 * Birth (duplication), transfer and death (loss) along every pipe; speciation copies the lineage into every
 * child pipe. Writes raw nodes into `raw` and returns the family's raw root id.
 */
export function simulateFamily(S: UpperTree, raw: LowerForest, fam: number, rates: Rates, rng: () => number, softCap = 3_000_000): number {
  const rootId = raw.n;
  const tp = [-1], ts = [0], tt = [-1];
  let rD = rates.rD, rT = rates.rT;
  const rL = rates.rL;
  while (tp.length) {
    let cur = tp.pop()!; const s = ts.pop()!; let t = tt.pop()!;
    const yBot = S.y[s], leaf = S.firstChild[s] < 0;
    for (;;) {
      if (raw.n > softCap) { rD = 0; rT = 0; }  // runaway family: only losses from here on
      const total = rD + rT + rL;
      t += total > 0 ? -Math.log(1 - rng()) / total : Infinity;
      if (t >= yBot) {
        if (leaf) raw.add(LEAF, s, yBot, cur, fam);
        else {
          const v = raw.add(SPEC, s, yBot, cur, fam);
          let k = 0;
          for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) scratch[k++] = c;
          for (let i = k - 1; i >= 0; i--) { tp.push(v); ts.push(scratch[i]); tt.push(yBot); }
        }
        break;
      }
      const u = rng() * total;
      if (u < rD) {
        const v = raw.add(DUP, s, t, cur, fam);
        tp.push(v); ts.push(s); tt.push(t);      // second copy, same pipe
        cur = v;                                 // first copy continues here
      } else if (u < rD + rT) {
        const r = pickRecipient(S, s, t, rates.locality, rng);
        if (r < 0) continue;
        const v = raw.add(TRANS, s, t, cur, fam);
        tp.push(v); ts.push(r); tt.push(t);      // recipient copy in pipe r
        cur = v;                                 // donor continues here
      } else {
        raw.add(LOSS, s, t, cur, fam);
        break;
      }
    }
  }
  return rootId;
}

/**
 * Keep only what a parsimonious reconciliation could observe: subtrees without extant descendants collapse
 * into a single loss, duplications/transfers with one surviving side are spliced out.
 * Returns the new root id in `out`, or -1 if the family went extinct.
 */
export function pruneFamily(raw: LowerForest, rootOld: number, out: LowerForest, fam: number): number {
  const extant = new Int32Array(raw.n), order = new Int32Array(raw.n);
  let len = 0;
  const st = [rootOld];
  while (st.length) {
    const v = st.pop()!; order[len++] = v;
    for (let c = raw.firstChild[v]; c >= 0; c = raw.nextSibling[c]) st.push(c);
  }
  for (let i = len - 1; i >= 0; i--) {
    const v = order[i];
    if (raw.type[v] === LEAF) extant[v] = 1;
    else { let e = 0; for (let c = raw.firstChild[v]; c >= 0; c = raw.nextSibling[c]) e += extant[c]; extant[v] = e; }
  }
  if (extant[rootOld] === 0) return -1;
  const resolve = (v: number): number => {
    for (;;) {
      const ty = raw.type[v];
      if (ty === DUP) {
        const c1 = raw.firstChild[v], c2 = raw.nextSibling[c1];
        if (extant[c1] > 0 && extant[c2] > 0) return v;
        v = extant[c1] > 0 ? c1 : c2;
      } else if (ty === TRANS) {
        const c1 = raw.firstChild[v], c2 = raw.nextSibling[c1];
        if (extant[c2] > 0) return v;   // recipient survives: the transfer is observable
        v = c1;                          // recipient died out: nothing to see
      } else return v;
    }
  };
  const newRoot = out.n;
  const sv = [resolve(rootOld)], sp = [-1];
  while (sv.length) {
    const v = sv.pop()!, np = sp.pop()!;
    const ty = raw.type[v], s = raw.pipe[v], t = raw.tSim[v];
    if (ty === LEAF) out.add(LEAF, s, t, np, fam);
    else if (ty === DUP) {
      const nv = out.add(DUP, s, t, np, fam);
      const c1 = raw.firstChild[v], c2 = raw.nextSibling[c1];
      sv.push(resolve(c2)); sp.push(nv);
      sv.push(resolve(c1)); sp.push(nv);
    } else if (ty === TRANS) {
      const nv = out.add(TRANS, s, t, np, fam);
      const c1 = raw.firstChild[v], c2 = raw.nextSibling[c1];
      sv.push(resolve(c2)); sp.push(nv);                        // recipient, emitted second
      if (extant[c1] > 0) { sv.push(resolve(c1)); sp.push(nv); } // donor continues
      else out.add(LOSS, s, t, nv, fam);                          // donor copy lost right after
    } else if (ty === SPEC) {
      let m = 0, k = 0;
      for (let c = raw.firstChild[v]; c >= 0; c = raw.nextSibling[c]) { scratch[k++] = c; if (extant[c] > 0) m++; }
      const nv = out.add(m >= 2 ? SPEC : SPECLOSS, s, t, np, fam);
      for (let i = k - 1; i >= 0; i--) {
        const c = scratch[i];
        if (extant[c] > 0) { sv.push(resolve(c)); sp.push(nv); }
        else out.add(LOSS, raw.pipe[c], t, nv, fam);            // lost in that child pipe
      }
    }
  }
  return newRoot;
}

export type SimulateOptions = {
  leaves: number; families: number; rD: number; rT: number; rL: number; locality: number; polyProb: number; seed: number; softCap: number;
};
export type Simulated = Scene & {
  famRoots: number[];
  counts: { S: number; D: number; T: number; L: number; leaves: number };
  timing: { species: number; simulate: number; layout: number; total: number };
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** From parameters to a laid-out scene in one call. */
export function generate(opts: Partial<SimulateOptions> = {}): Simulated {
  const o: SimulateOptions = { leaves: 256, families: 2, rD: 0.03, rT: 0.015, rL: 0.03, locality: 0.7, polyProb: 0.08, seed: 7, softCap: 3_000_000, ...opts };
  const t0 = now();
  const rng = makeRng(o.seed);
  const S = buildUpper(o.leaves, o.polyProb, rng);
  const t1 = now();
  const raw = new LowerForest(Math.max(1024, S.n * 4));
  const G = new LowerForest(Math.max(1024, S.n * 2));
  G.timed = true;
  G.familyNames = Array.from({ length: o.families }, (_, f) => `family ${String.fromCharCode(65 + (f % 26))}`);
  const rates: Rates = { rD: o.rD, rT: o.rT, rL: o.rL, locality: o.locality };
  const famRoots: number[] = [];
  for (let f = 0; f < o.families; f++) {
    let rootNew = -1;
    for (let attempt = 0; attempt < 12 && rootNew < 0; attempt++) {
      raw.n = 0;
      const rootOld = simulateFamily(S, raw, f, rates, rng, o.softCap);
      rootNew = pruneFamily(raw, rootOld, G, f);
    }
    famRoots.push(rootNew);
  }
  const t2 = now();
  const Lay = layout(S, G);
  const t3 = now();
  const counts = { S: 0, D: 0, T: 0, L: 0, leaves: 0 };
  for (let v = 0; v < G.n; v++) {
    const ty = G.type[v];
    if (ty === SPEC || ty === SPECLOSS) counts.S++; else if (ty === DUP) counts.D++; else if (ty === TRANS) counts.T++; else if (ty === LOSS) counts.L++; else if (ty === LEAF) counts.leaves++;
  }
  return { upper: S, lower: G, layout: Lay, warnings: Lay.warnings, famRoots, counts, timing: { species: t1 - t0, simulate: t2 - t1, layout: t3 - t2, total: t3 - t0 } };
}
