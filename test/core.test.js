import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, layout, laneX, pipeEdges, finishSpecies, GeneStore, LEAF, DUP, TRANS, SPEC, SPECLOSS, LOSS, STUB } from '../src/index.js';

function checkInvariants(res) {
  const { S, G, Lay } = res;
  const n = G.n, ns = S.n;
  const problems = [];
  const check = (cond, msg, ctx) => { if (!cond && problems.length < 20) problems.push(msg + (ctx === undefined ? '' : ' ' + JSON.stringify(ctx))); };

  for (let s = 0; s < ns; s++) {
    check(Lay.x[s] - Lay.W[s] / 2 >= Lay.xLeft[s] - 1e-9 && Lay.x[s] + Lay.W[s] / 2 <= Lay.xLeft[s] + Lay.ext[s] + 1e-9, 'pipe outside its extent', s);
    let prevR = -Infinity;
    for (let c = S.firstChild[s]; c >= 0; c = S.nextSibling[c]) {
      check(Lay.xLeft[c] >= prevR - 1e-9, 'sibling extents overlap', { s, c });
      check(Lay.xLeft[c] >= Lay.xLeft[s] - 1e-9 && Lay.xLeft[c] + Lay.ext[c] <= Lay.xLeft[s] + Lay.ext[s] + 1e-9, 'child outside parent extent', { s, c });
      prevR = Lay.xLeft[c] + Lay.ext[c];
    }
    if (S.parent[s] >= 0) check(S.yTop[s] < S.y[s], 'pipe has no length', s);
    // slanted geometry: lanes stay between the walls at the top and the bottom of the pipe
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
    check(Lay.tStart[v] <= Lay.gT[v] + 1e-9, 'segment reversed in time', { v, ty });
    check(Lay.gT[v] >= S.yTop[s] - 1e-9 && Lay.gT[v] <= S.y[s] + 1e-9, 'node time outside its pipe', { v, ty });
    check(Lay.lane[v] >= 0 && Lay.lane[v] <= Math.max(0, Lay.L[s] - 1), 'lane out of range', { v, ty });
    if (p >= 0) {
      check(Lay.gT[p] < Lay.gT[v] || ty === STUB, 'parent not earlier than child', { v, ty });
      const pty = G.type[p];
      if (pty === SPEC || pty === SPECLOSS) check(S.parent[s] === G.pipe[p], 'speciation child not in a child pipe', { v });
      else if (pty === DUP) check(s === G.pipe[p], 'duplication child left its pipe', v);
      else if (pty !== TRANS) check(false, 'leaf or stub has children', p);
    }
    let kids = 0, foreign = 0, alive = 0;
    for (let c = G.firstChild[v]; c >= 0; c = G.nextSibling[c]) { kids++; if (G.pipe[c] !== s) foreign++; if (G.type[c] !== STUB) alive++; }
    if (ty === DUP) check(kids === 2 && foreign === 0, 'duplication arity', { v, kids });
    if (ty === TRANS) {
      check(kids === 2 && foreign === 1, 'transfer arity', { v, kids, foreign });
      const r = Lay.recipient[v];
      check(r >= 0 && Math.abs(Lay.tStart[r] - Lay.gT[v]) < 1e-9, 'transfer not horizontal', v);
      check(S.yTop[G.pipe[r]] <= Lay.gT[v] && S.y[G.pipe[r]] >= Lay.gT[v], 'recipient pipe not alive at transfer time', v);
    }
    if (ty === SPEC) check(alive >= 2, 'speciation with fewer than 2 surviving children', v);
    if (ty === SPECLOSS) check(alive === 1, 'speciation-loss must keep exactly one child', v);
    if (ty === LEAF || ty === STUB) check(kids === 0, 'terminal node has children', v);
    check(ty !== LOSS, 'raw loss survived pruning', v);
  }
  const seenLane = new Set();
  for (let s = 0; s < ns; s++) {
    seenLane.clear();
    const ys = [];
    for (let j = Lay.pipeStart[s]; j < Lay.pipeStart[s + 1]; j++) {
      const v = Lay.pipeNodes[j], ty = G.type[v];
      if (ty === LEAF || ty === SPEC || ty === SPECLOSS || ty === STUB) { check(!seenLane.has(Lay.lane[v]), 'two terminals share a lane', { s, v }); seenLane.add(Lay.lane[v]); }
      if (ty === DUP || ty === TRANS) ys.push(Lay.gT[v]);
    }
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) check(ys[i] - ys[i - 1] > 1e-9, 'two events in one pipe share a y', { s });
  }
  return problems;
}

for (const leaves of [16, 256, 4096]) {
  test(`layout invariants hold for ${leaves} leaves`, () => {
    const res = generate({ leaves, families: 3, rD: 0.03, rT: 0.015, rL: 0.03, locality: 0.7, polyProb: 0.08, seed: 7 });
    assert.equal(res.S.nLeaves, leaves);
    assert.ok(res.G.n > 0);
    assert.deepEqual(checkInvariants(res), []);
  });
}

test('heavy event rates and polytomies keep the invariants', () => {
  const res = generate({ leaves: 1024, families: 8, rD: 0.12, rT: 0.06, rL: 0.08, locality: 0.3, polyProb: 0.3, seed: 3 });
  assert.deepEqual(checkInvariants(res), []);
  assert.ok(res.counts.T > 0 && res.counts.D > 0 && res.counts.L > 0);
});

test('generation is deterministic for a seed', () => {
  const a = generate({ leaves: 512, families: 2, seed: 42 }), b = generate({ leaves: 512, families: 2, seed: 42 });
  assert.equal(a.G.n, b.G.n);
  assert.deepEqual(Array.from(a.Lay.lane.subarray(0, 200)), Array.from(b.Lay.lane.subarray(0, 200)));
  assert.deepEqual(a.counts, b.counts);
});

test('layout accepts a hand-built reconciliation', () => {
  // species tree: root 0 -> (1, 2); 1 -> (3, 4); leaves 2, 3, 4
  const S = finishSpecies({ n: 5, nLeaves: 3, parent: Int32Array.from([-1, 0, 0, 1, 1]), firstChild: Int32Array.from([1, 3, -1, -1, -1]), nextSibling: Int32Array.from([-1, 2, -1, 4, -1]), depth: Int32Array.from([0, 1, 1, 2, 2]), below: Int32Array.from([3, 2, 1, 1, 1]) });
  const G = new GeneStore(16);
  const root = G.add(SPEC, 0, 0, -1, 0);          // speciation at the root
  const a = G.add(SPEC, 1, 1, root, 0);           // speciation at node 1
  G.add(LEAF, 3, 2, a, 0); G.add(LEAF, 4, 2, a, 0);
  const d = G.add(DUP, 2, 1.5, root, 0);          // duplication on the branch above leaf 2
  G.add(LEAF, 2, 2, d, 0); G.add(LEAF, 2, 2, d, 0);
  const Lay = layout(S, G);
  assert.equal(Lay.L[2], 2, 'two lanes in the duplicated pipe');
  assert.equal(Lay.L[3], 1); assert.equal(Lay.L[4], 1);
  assert.ok(Lay.W[2] > Lay.W[3], 'the pipe with two copies is fatter');
  assert.deepEqual(checkInvariants({ S, G, Lay }), []);
});
