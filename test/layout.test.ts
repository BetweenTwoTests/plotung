import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../src/index.ts';
import { generate } from '../src/simulate.ts';
import { checkInvariants } from './invariants.ts';

for (const leaves of [16, 256, 4096]) {
  test(`layout invariants hold for ${leaves} simulated leaves`, () => {
    const res = generate({ leaves, families: 3, rD: 0.03, rT: 0.015, rL: 0.03, locality: 0.7, polyProb: 0.08, seed: 7 });
    assert.equal(res.upper.nLeaves, leaves);
    assert.ok(res.lower.n > 0);
    assert.deepEqual(checkInvariants(res.upper, res.lower, res.layout), []);
  });
}

test('heavy event rates and polytomies keep the invariants', () => {
  const res = generate({ leaves: 1024, families: 8, rD: 0.12, rT: 0.06, rL: 0.08, locality: 0.3, polyProb: 0.3, seed: 3 });
  assert.deepEqual(checkInvariants(res.upper, res.lower, res.layout), []);
  assert.ok(res.counts.T > 0 && res.counts.D > 0 && res.counts.L > 0);
});

test('simulation is deterministic for a seed', () => {
  const a = generate({ leaves: 512, families: 2, seed: 42 }), b = generate({ leaves: 512, families: 2, seed: 42 });
  assert.equal(a.lower.n, b.lower.n);
  assert.deepEqual(Array.from(a.layout.lane.subarray(0, 200)), Array.from(b.layout.lane.subarray(0, 200)));
  assert.deepEqual(a.counts, b.counts);
});

test('layout re-times an untimed forest from the simulator identically in structure', () => {
  const res = generate({ leaves: 128, families: 2, rD: 0.08, rT: 0.05, rL: 0.05, seed: 5 });
  res.lower.timed = false;               // forget the simulated times; the layout must invent consistent ones
  const Lay = layout(res.upper, res.lower);
  assert.deepEqual(checkInvariants(res.upper, res.lower, Lay), []);
  assert.deepEqual(Lay.warnings, []);
});
