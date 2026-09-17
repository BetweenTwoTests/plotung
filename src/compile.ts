/* Turn the nested input description into the compact representation, checking the reconciliation rules. */
import { Event, LowerForest, finishUpper, type UpperTree, type EventCode } from './model.ts';
import type { UpperNodeInput, LowerNodeInput, ReconciliationInput, CompileOptions, CompileWarning, Scene } from './types.ts';
import { layout } from './layout.ts';

/** Thrown when the input breaks a rule listed on `LowerNodeInput`. */
export class ReconciliationError extends Error {
  node?: string;
  constructor(message: string, node?: string) {
    super(node ? `${message} (lower node ${node})` : message);
    this.name = 'ReconciliationError';
    this.node = node;
  }
}

/** Flatten a nested upper tree. Node indices follow pre-order, so index order is also left-to-right order. */
export function compileUpper(root: UpperNodeInput): UpperTree {
  const nodes: UpperNodeInput[] = [], parents: number[] = [];
  const stack: [UpperNodeInput, number][] = [[root, -1]];
  while (stack.length) {
    const [v, p] = stack.pop()!;
    nodes.push(v); parents.push(p);
    const me = nodes.length - 1;
    if (v.children) for (let c = v.children.length - 1; c >= 0; c--) stack.push([v.children[c], me]);
  }
  const n = nodes.length;
  const parent = Int32Array.from(parents), firstChild = new Int32Array(n).fill(-1), nextSibling = new Int32Array(n).fill(-1);
  const lastChild = new Int32Array(n).fill(-1), depth = new Int32Array(n), below = new Int32Array(n);
  const ids: string[] = new Array(n), names: (string | undefined)[] = new Array(n);
  const seen = new Set<string>();
  let nLeaves = 0;
  for (let v = 0; v < n; v++) {
    const p = parent[v];
    if (p >= 0) {
      depth[v] = depth[p] + 1;
      if (lastChild[p] < 0) firstChild[p] = v; else nextSibling[lastChild[p]] = v;
      lastChild[p] = v;
    }
    const id = nodes[v].id ?? nodes[v].name ?? `#${v}`;
    if (seen.has(id)) throw new ReconciliationError(`duplicate upper node id "${id}"`);
    seen.add(id);
    ids[v] = id; names[v] = nodes[v].name;
    if (!nodes[v].children || nodes[v].children!.length === 0) nLeaves++;
  }
  for (let v = n - 1; v >= 0; v--) {
    if (firstChild[v] < 0) below[v] = 1;
    if (parent[v] >= 0) below[parent[v]] += below[v];
  }
  return finishUpper({ n, nLeaves, parent, firstChild, nextSibling, depth, below, ids, names });
}

/** Compile lower trees against a compiled upper tree. Throws ReconciliationError on rule violations. */
export function compileLower(upper: UpperTree, roots: LowerNodeInput[], options: CompileOptions = {}, familyNames?: string[]): { lower: LowerForest; warnings: CompileWarning[] } {
  const implicitLosses = options.implicitLosses ?? true;
  const index = new Map<string, number>();
  upper.ids.forEach((id, i) => index.set(id, i));
  const lower = new LowerForest(256);
  lower.timed = false;
  lower.familyNames = roots.map((_, f) => familyNames?.[f] ?? `family ${f + 1}`);
  const warnings: CompileWarning[] = [];
  const label = (node: LowerNodeInput) => node.id ?? node.name;
  const resolve = (node: LowerNodeInput): number => {
    const s = index.get(node.location);
    if (s === undefined) throw new ReconciliationError(`unknown upper node "${node.location}"`, label(node));
    return s;
  };
  const isChildOf = (c: number, p: number) => upper.parent[c] === p;

  for (let f = 0; f < roots.length; f++) {
    const stack: [LowerNodeInput, number][] = [[roots[f], -1]];
    while (stack.length) {
      const [node, parentIdx] = stack.pop()!;
      const s = resolve(node);
      const kids = node.children ?? [];
      const push = (children: LowerNodeInput[], v: number) => { for (let c = children.length - 1; c >= 0; c--) stack.push([children[c], v]); };
      switch (node.event) {
        case 'leaf': {
          if (upper.firstChild[s] >= 0) throw new ReconciliationError(`leaf placed on internal upper node "${upper.ids[s]}"`, label(node));
          if (kids.length) throw new ReconciliationError('leaf with children', label(node));
          lower.add(Event.LEAF, s, upper.y[s], parentIdx, f, node.id, node.name);
          break;
        }
        case 'loss': {
          if (kids.length) throw new ReconciliationError('loss with children', label(node));
          lower.add(Event.LOSS, s, NaN, parentIdx, f, node.id, node.name);
          break;
        }
        case 'duplication': {
          if (kids.length < 2) throw new ReconciliationError('duplication needs at least two children', label(node));
          for (const c of kids) if (resolve(c) !== s) throw new ReconciliationError(`duplication child "${label(c) ?? c.location}" must stay in branch "${upper.ids[s]}"`, label(node));
          const v = lower.add(Event.DUP, s, NaN, parentIdx, f, node.id, node.name);
          push(kids, v);
          break;
        }
        case 'transfer': {
          if (kids.length !== 2) throw new ReconciliationError('transfer needs exactly two children', label(node));
          const same = kids.filter((c) => resolve(c) === s);
          if (same.length !== 1) throw new ReconciliationError(`transfer needs one child staying in branch "${upper.ids[s]}" and one landing elsewhere`, label(node));
          const donor = same[0], recipient = kids[0] === donor ? kids[1] : kids[0];
          const r = resolve(recipient);
          if (upper.y[r] <= upper.yTop[s] || upper.yTop[r] >= upper.y[s]) throw new ReconciliationError(`transfer target "${upper.ids[r]}" never coexists with branch "${upper.ids[s]}"`, label(node));
          const v = lower.add(Event.TRANS, s, NaN, parentIdx, f, node.id, node.name);
          push([donor, recipient], v);
          break;
        }
        case 'speciation': {
          if (upper.firstChild[s] < 0) throw new ReconciliationError(`speciation at upper leaf "${upper.ids[s]}"`, label(node));
          const taken = new Set<number>();
          let survivors = 0;
          for (const c of kids) {
            const cs = resolve(c);
            if (!isChildOf(cs, s)) throw new ReconciliationError(`speciation child "${label(c) ?? c.location}" must sit in a direct child branch of "${upper.ids[s]}"`, label(node));
            if (taken.has(cs)) throw new ReconciliationError(`two speciation children in branch "${upper.ids[cs]}"`, label(node));
            taken.add(cs);
            if (c.event !== 'loss') survivors++;
          }
          if (survivors === 0) {
            warnings.push({ code: 'all-children-lost', message: `speciation at "${upper.ids[s]}" has no surviving child; drawn as a loss`, node: label(node) });
            lower.add(Event.LOSS, s, NaN, parentIdx, f, node.id, node.name);
            break;
          }
          const code: EventCode = survivors >= 2 ? Event.SPEC : Event.SPECLOSS;
          const v = lower.add(code, s, upper.y[s], parentIdx, f, node.id, node.name);
          push(kids, v);
          if (implicitLosses) for (let c = upper.firstChild[s]; c >= 0; c = upper.nextSibling[c]) if (!taken.has(c)) lower.add(Event.LOSS, c, NaN, v, f);
          break;
        }
        default:
          throw new ReconciliationError(`unknown event "${(node as { event: string }).event}"`, label(node));
      }
    }
  }
  return { lower, warnings };
}

/** Compile and lay out a reconciliation in one call. */
export function createScene(input: ReconciliationInput, options: CompileOptions = {}): Scene {
  const upper = compileUpper(input.upper);
  const { lower, warnings } = compileLower(upper, input.lower, options, input.familyNames);
  const lay = layout(upper, lower);
  const all = warnings.concat(lay.warnings);
  return { upper, lower, layout: lay, warnings: all };
}
