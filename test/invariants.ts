import { laneX, pipeEdges, LEAF, DUP, TRANS, SPEC, SPECLOSS, LOSS, type UpperTree, type LowerForest, type Layout } from '../src/index.ts';

/** Every structural promise the viewer relies on; returns a list of violations (empty when fine). */
export function checkInvariants(S: UpperTree, G: LowerForest, Lay: Layout): string[] {
  const n = G.n, ns = S.n;
  const problems: string[] = [];
  const check = (cond: boolean, msg: string, ctx?: unknown) => { if (!cond && problems.length < 20) problems.push(msg + (ctx === undefined ? '' : ' ' + JSON.stringify(ctx))); };

  for (let s = 0; s < ns; s++) {
    check(Lay.x[s] - Lay.W[s] / 2 >= Lay.xLeft[s] - 1e-9 && Lay.x[s] + Lay.W[s] / 2 <= Lay.xLeft[s] + Lay.ext[s] + 1e-9, 'pipe outside its extent', s);
    let prevR = -Infinity;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) {
      check(Lay.xLeft[c] >= prevR - 1e-9, 'sibling extents overlap', { s, c });
      check(Lay.xLeft[c] >= Lay.xLeft[s] - 1e-9 && Lay.xLeft[c] + Lay.ext[c] <= Lay.xLeft[s] + Lay.ext[s] + 1e-9, 'child outside parent extent', { s, c });
      prevR = Lay.xLeft[c] + Lay.ext[c];
    }
    if (S.parent[s] >= 0) check(S.yTop[s] < S.y[s], 'pipe has no length', s);
    if (Lay.L[s] > 0) {
      const e = [0, 0];
      for (const t of [S.yTop[s], S.y[s]]) {
        pipeEdges(S, Lay, s, t, true, e);
        const l0 = laneX(S, Lay, s, 0, t, true), l1 = laneX(S, Lay, s, Lay.L[s] - 1, t, true);
        check(l0 >= e[0] - 1e-9 && l1 <= e[1] + 1e-9, 'slanted lane outside walls', { s, t });
      }
    }
  }
  for (let v = 0; v < n; v++) {
    const ty = G.type[v], s = G.pipe[v], p = G.parent[v];
    check(Number.isFinite(Lay.gT[v]) && Number.isFinite(Lay.tStart[v]), 'non-finite time', { v, ty });
    check(Lay.tStart[v] <= Lay.gT[v] + 1e-9, 'segment reversed in time', { v, ty });
    check(Lay.gT[v] >= S.yTop[s] - 1e-9 && Lay.gT[v] <= S.y[s] + 1e-9, 'node time outside its pipe', { v, ty });
    check(Lay.lane[v] >= 0 && Lay.lane[v] <= Math.max(0, Lay.L[s] - 1), 'lane out of range', { v, ty });
    if (p >= 0) {
      check(Lay.gT[p] < Lay.gT[v] || ty === LOSS, 'parent not earlier than child', { v, ty });
      const pty = G.type[p];
      if (pty === SPEC || pty === SPECLOSS) check(S.parent[s] === G.pipe[p], 'speciation child not in a child pipe', { v });
      else if (pty === DUP) check(s === G.pipe[p], 'duplication child left its pipe', v);
      else if (pty !== TRANS) check(false, 'leaf or loss has children', p);
    }
    let kids = 0, foreign = 0, alive = 0;
    for (let c = G.firstChild[v]; c >= 0; c = G.nextSibling[c]) { kids++; if (G.pipe[c] !== s) foreign++; if (G.type[c] !== LOSS) alive++; }
    if (ty === DUP) check(kids >= 2 && foreign === 0, 'duplication arity', { v, kids });
    if (ty === TRANS) {
      check(kids === 2 && foreign === 1, 'transfer arity', { v, kids, foreign });
      const r = Lay.recipient[v];
      check(r >= 0 && Math.abs(Lay.tStart[r] - Lay.gT[v]) < 1e-9, 'transfer not horizontal', v);
      check(S.yTop[G.pipe[r]] <= Lay.gT[v] && S.y[G.pipe[r]] >= Lay.gT[v], 'recipient pipe not alive at transfer time', v);
    }
    if (ty === SPEC) check(alive >= 2, 'speciation with fewer than 2 surviving children', v);
    if (ty === SPECLOSS) check(alive === 1, 'speciation-loss must keep exactly one child', v);
    if (ty === LEAF || ty === LOSS) check(kids === 0, 'terminal node has children', v);
  }
  const seenLane = new Set<number>();
  for (let s = 0; s < ns; s++) {
    seenLane.clear();
    const ys: number[] = [];
    for (let j = Lay.pipeStart[s]; j < Lay.pipeStart[s + 1]; j++) {
      const v = Lay.pipeNodes[j], ty = G.type[v];
      if (ty === LEAF || ty === SPEC || ty === SPECLOSS || ty === LOSS) { check(!seenLane.has(Lay.lane[v]), 'two terminals share a lane', { s, v }); seenLane.add(Lay.lane[v]); }
      if (ty === DUP || ty === TRANS) ys.push(Lay.gT[v]);
    }
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) check(ys[i] - ys[i - 1] > 1e-9, 'two events in one pipe share a y', { s });
  }
  return problems;
}
