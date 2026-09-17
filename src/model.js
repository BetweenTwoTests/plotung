/* Shared vocabulary for plotung.
 *
 *   upper tree  = species / host tree. Every node s owns the PIPE (branch) above it, spanning world-y
 *                 from yTop[s] = y[parent] down to y[s]. The root owns a stem pipe (-1 .. 0).
 *   lower tree  = gene / symbiont tree(s). Every gene node lives inside exactly one pipe and owns the
 *                 SEGMENT from tStart (its parent's time) down to its own time t, drawn in a LANE of that pipe.
 *   time        = world y, increasing downward. Species nodes sit on integer levels (cladogram with aligned
 *                 tips); duplication / transfer events get fractional y inside a level.
 */

// gene node types
export const LEAF = 0;      // extant gene, in a leaf pipe
export const DUP = 1;       // duplication: two copies continue in the same pipe
export const TRANS = 2;     // horizontal transfer: donor continues, a copy starts in another pipe
export const SPEC = 3;      // speciation: one copy into each child pipe (>= 2 survive)
export const SPECLOSS = 4;  // speciation where only one child pipe keeps the gene
export const LOSS = 5;      // raw simulated loss (never survives pruning)
export const STUB = 6;      // observable loss: a short stub ending in a cross

export const TYPE_NAME = ['extant gene', 'duplication', 'horizontal transfer', 'speciation', 'speciation with loss', 'loss', 'loss'];

// world geometry: x in lane units, y in levels
export const LANE = 1.0;     // lane pitch inside a pipe
export const PAD = 0.6;      // pipe padding either side of the outermost lane
export const GAP = 1.0;      // gap between sibling pipes
export const HB = 0.1;       // half-height of a speciation band; gene fans cross it diagonally
export const STUBLEN = 0.3;  // how far a loss stub hangs below its origin

// shared scratch buffer for child lists (nodes never have more than a handful of children)
export const scratch = new Int32Array(64);

/** Growable struct-of-arrays store for gene nodes. Children are linked first-child / next-sibling. */
export class GeneStore {
  constructor(cap) { this.cap = Math.max(16, cap | 0); this.n = 0; this._alloc(this.cap); }
  _alloc(cap) {
    this.type = new Uint8Array(cap); this.pipe = new Int32Array(cap); this.tSim = new Float64Array(cap);
    this.parent = new Int32Array(cap); this.firstChild = new Int32Array(cap); this.lastChild = new Int32Array(cap);
    this.nextSibling = new Int32Array(cap); this.family = new Uint8Array(cap);
  }
  _grow() {
    const o = { type: this.type, pipe: this.pipe, tSim: this.tSim, parent: this.parent, firstChild: this.firstChild, lastChild: this.lastChild, nextSibling: this.nextSibling, family: this.family };
    this.cap *= 2; this._alloc(this.cap);
    for (const k in o) this[k].set(o[k]);
  }
  add(type, pipe, t, parent, fam) {
    if (this.n === this.cap) this._grow();
    const i = this.n++;
    this.type[i] = type; this.pipe[i] = pipe; this.tSim[i] = t; this.parent[i] = parent; this.family[i] = fam;
    this.firstChild[i] = -1; this.lastChild[i] = -1; this.nextSibling[i] = -1;
    if (parent >= 0) {
      const l = this.lastChild[parent];
      if (l < 0) this.firstChild[parent] = i; else this.nextSibling[l] = i;
      this.lastChild[parent] = i;
    }
    return i;
  }
}
