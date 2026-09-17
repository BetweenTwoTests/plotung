/* Compact internal representation shared by compile, layout and viewer.
 *
 *   upper tree  = species / host tree. Every node s owns the PIPE (branch) above it, spanning world-y
 *                 from yTop[s] = y[parent] down to y[s]. The root owns a stem pipe (-1 .. 0).
 *   lower tree  = gene / symbiont tree(s). Every lower node lives inside exactly one pipe and owns the
 *                 SEGMENT from tStart (its parent's time) down to its own time t, drawn in a LANE of that pipe.
 *   time        = world y, increasing downward. Upper nodes sit on integer levels (cladogram with aligned
 *                 tips); duplication / transfer events get fractional y inside a level.
 */

/** Event codes stored per lower node (also grouped as `Event`). */
export const LEAF = 0, DUP = 1, TRANS = 2, SPEC = 3, SPECLOSS = 4, LOSS = 5;
export const Event = { LEAF, DUP, TRANS, SPEC, SPECLOSS, LOSS } as const;
export type EventCode = (typeof Event)[keyof typeof Event];
export const EVENT_NAME: readonly string[] = ['extant leaf', 'duplication', 'horizontal transfer', 'speciation', 'speciation with loss', 'loss'];

// world geometry: x in lane units, y in levels
export const LANE = 1.0;     // lane pitch inside a pipe
export const PAD = 0.6;      // pipe padding either side of the outermost lane
export const GAP = 1.0;      // gap between sibling pipes
export const HB = 0.1;       // half-height of a speciation band; lineages cross it diagonally
export const STUBLEN = 0.3;  // how far a loss stub hangs below its origin

/** Shared scratch buffer for child lists (nodes never have more than a handful of children). */
export const scratch = new Int32Array(64);

/** Upper tree before derived fields are computed. Children are linked first-child / next-sibling. */
export type UpperTreeBare = {
  n: number;
  nLeaves: number;
  parent: Int32Array;
  firstChild: Int32Array;
  nextSibling: Int32Array;
  depth: Int32Array;
  /** Leaves under each node. */
  below: Int32Array;
  ids?: string[];
  names?: (string | undefined)[];
};

/** Upper tree with pre-order, levels and per-level pipe lists. */
export type UpperTree = Required<UpperTreeBare> & {
  pre: Int32Array;
  preIndex: Int32Array;
  maxDepth: number;
  /** Level of each node; leaves are aligned at maxDepth. */
  y: Float64Array;
  /** Level of the parent (-1 for the root's stem). */
  yTop: Float64Array;
  /** Pipes alive during level d are levelPipes[levelStart[d] .. levelStart[d+1]), in x order. */
  levelStart: Int32Array;
  levelPipes: Int32Array;
};

/** Derive pre-order, levels and per-level pipe lists from a bare upper tree. */
export function finishUpper(S: UpperTreeBare): UpperTree {
  const { n, firstChild, nextSibling, parent, depth } = S;
  const pre = new Int32Array(n), preIndex = new Int32Array(n);
  let pi = 0;
  const st = [0];
  while (st.length) {
    const v = st.pop()!;
    pre[pi++] = v;
    let k = 0;
    for (let c = firstChild[v]; c >= 0; c = nextSibling[c]) scratch[k++] = c;
    for (let i = k - 1; i >= 0; i--) st.push(scratch[i]);
  }
  for (let i = 0; i < n; i++) preIndex[pre[i]] = i;
  let maxDepth = 1;
  for (let v = 0; v < n; v++) if (firstChild[v] < 0 && depth[v] > maxDepth) maxDepth = depth[v];
  const y = new Float64Array(n), yTop = new Float64Array(n);
  for (let v = 0; v < n; v++) y[v] = firstChild[v] < 0 ? maxDepth : depth[v];
  for (let v = 0; v < n; v++) yTop[v] = parent[v] < 0 ? -1 : y[parent[v]];
  const levelStart = new Int32Array(maxDepth + 2);
  for (let v = 0; v < n; v++) for (let d = Math.max(0, yTop[v]); d < y[v]; d++) levelStart[d + 1]++;
  for (let d = 0; d <= maxDepth; d++) levelStart[d + 1] += levelStart[d];
  const levelPipes = new Int32Array(levelStart[maxDepth + 1]);
  const fill = new Int32Array(maxDepth + 1);
  for (let i = 0; i < n; i++) {
    const v = pre[i];
    for (let d = Math.max(0, yTop[v]); d < y[v]; d++) levelPipes[levelStart[d] + fill[d]++] = v;
  }
  const ids = S.ids ?? Array.from({ length: n }, (_, i) => `#${i}`);
  const names = S.names ?? new Array<string | undefined>(n).fill(undefined);
  return { ...S, ids, names, pre, preIndex, maxDepth, y, yTop, levelStart, levelPipes };
}

/**
 * Growable struct-of-arrays store for lower-tree nodes. Children are linked first-child / next-sibling,
 * and a node's index is always greater than its parent's, which the layout relies on.
 */
export class LowerForest {
  cap: number;
  n = 0;
  type!: Uint8Array;
  pipe!: Int32Array;
  /** Event time, when the producer knows it (simulation). The layout assigns times when `timed` is false. */
  tSim!: Float64Array;
  parent!: Int32Array;
  firstChild!: Int32Array;
  lastChild!: Int32Array;
  nextSibling!: Int32Array;
  family!: Uint8Array;
  ids: (string | undefined)[] = [];
  names: (string | undefined)[] = [];
  familyNames: string[] = [];
  timed = false;

  constructor(cap = 1024) {
    this.cap = Math.max(16, cap | 0);
    this.alloc(this.cap);
  }
  private alloc(cap: number): void {
    this.type = new Uint8Array(cap); this.pipe = new Int32Array(cap); this.tSim = new Float64Array(cap);
    this.parent = new Int32Array(cap); this.firstChild = new Int32Array(cap); this.lastChild = new Int32Array(cap);
    this.nextSibling = new Int32Array(cap); this.family = new Uint8Array(cap);
  }
  private grow(): void {
    const o = { type: this.type, pipe: this.pipe, tSim: this.tSim, parent: this.parent, firstChild: this.firstChild, lastChild: this.lastChild, nextSibling: this.nextSibling, family: this.family };
    this.cap *= 2;
    this.alloc(this.cap);
    for (const k of Object.keys(o) as (keyof typeof o)[]) (this[k] as Uint8Array | Int32Array | Float64Array).set(o[k] as never);
  }
  add(type: EventCode, pipe: number, t: number, parent: number, family: number, id?: string, name?: string): number {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.type[i] = type; this.pipe[i] = pipe; this.tSim[i] = t; this.parent[i] = parent; this.family[i] = family;
    this.firstChild[i] = -1; this.lastChild[i] = -1; this.nextSibling[i] = -1;
    if (parent >= 0) {
      const l = this.lastChild[parent];
      if (l < 0) this.firstChild[parent] = i; else this.nextSibling[l] = i;
      this.lastChild[parent] = i;
    }
    if (id !== undefined) this.ids[i] = id;
    if (name !== undefined) this.names[i] = name;
    return i;
  }
  /** Number of children of node v. */
  childCount(v: number): number {
    let k = 0;
    for (let c = this.firstChild[v]; c >= 0; c = this.nextSibling[c]) k++;
    return k;
  }
}
