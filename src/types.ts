/* Public data types. Everything here is plain, serializable data: what you hand plotung and what it hands back. */

import type { UpperTree, LowerForest } from './model.ts';

/** One node of the upper tree (species, hosts, areas), nested. */
export type UpperNodeInput = {
  /** Stable identifier that lower-tree nodes refer to in `location`. Defaults to `name`. */
  id?: string;
  /** Display label. */
  name?: string;
  /** Branch length from the parent. Carried through; the level-based layout does not use it yet. */
  length?: number;
  children?: UpperNodeInput[];
};

/** Reconciliation events a lower-tree node can carry. */
export type EventKind = 'leaf' | 'speciation' | 'duplication' | 'transfer' | 'loss';

/**
 * One node of a lower tree (genes, symbionts), nested. Rules the compiler checks:
 * - `leaf`: `location` is an upper leaf; no children.
 * - `speciation`: `location` is an internal upper node; each child sits in a distinct direct child branch of it.
 *   Branches left out become losses when `implicitLosses` is on (the default).
 * - `duplication`: two or more children, all in the same branch as the duplication.
 * - `transfer`: exactly two children; one stays in the donor branch, the other lands in any branch that
 *   exists at the same time.
 * - `loss`: no children.
 */
export type LowerNodeInput = {
  id?: string;
  /** Gene name for leaves, or any label. */
  name?: string;
  event: EventKind;
  /** id of the upper node whose branch hosts this event. For `speciation` it is the node where the lineage splits. */
  location: string;
  children?: LowerNodeInput[];
};

export type ReconciliationInput = {
  upper: UpperNodeInput;
  /** One root per lower tree (gene family). */
  lower: LowerNodeInput[];
  familyNames?: string[];
};

export type CompileOptions = {
  /** Add a loss for every child branch a speciation leaves out. Default true. */
  implicitLosses?: boolean;
};

export type CompileWarning = {
  code: 'all-children-lost' | 'time-inconsistent-transfer';
  message: string;
  /** id of the lower node concerned, when it has one. */
  node?: string;
};

/**
 * Layout output. Arrays indexed by upper node ("pipe") or lower node; see layout.ts for what each holds.
 * World x is in lane units, world y in levels (time runs downward).
 */
export type Layout = {
  pipeStart: Int32Array; pipeNodes: Int32Array;
  L: Int32Array; W: Float64Array; ext: Float64Array; xLeft: Float64Array; x: Float64Array;
  xs: Float64Array; topL: Float64Array; topW: Float64Array;
  subGenes: Int32Array; subEvents: Int32Array; pipeGenes: Int32Array; pipeEvents: Int32Array;
  target: Float64Array; gExt: Int32Array; gT: Float64Array; tStart: Float64Array; lane: Float32Array;
  transfers: Int32Array; recipient: Int32Array;
  worldWidth: number; worldTop: number; worldBottom: number;
  warnings: CompileWarning[];
};

/** A compiled reconciliation with its layout: the only thing the viewer needs. */
export type Scene = {
  upper: UpperTree;
  lower: LowerForest;
  layout: Layout;
  warnings: CompileWarning[];
};
