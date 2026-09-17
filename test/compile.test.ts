import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick, toNewick, createScene, compileUpper, ReconciliationError, LEAF, DUP, TRANS, SPEC, SPECLOSS, LOSS, type LowerNodeInput } from '../src/index.ts';
import { checkInvariants } from './invariants.ts';

// (((A,B)AB,C)ABC,(D,E)DE)root
const UPPER = '(((A:1,B:1)AB:1,C:2)ABC:1,(D:2,E:2)DE:2)root;';

/** The textbook picture: one family with a speciation, a duplication, a loss and a transfer. */
function textbook(): LowerNodeInput {
  return {
    event: 'speciation', location: 'root', id: 'g0', children: [
      { event: 'speciation', location: 'ABC', children: [
        { event: 'duplication', location: 'AB', id: 'dup', children: [
          { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A', name: 'a1' }, { event: 'leaf', location: 'B', name: 'b1' }] },
          { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A', name: 'a2' }] },   // b copy lost: implicit loss
        ] },
        { event: 'leaf', location: 'C', name: 'c1' },
      ] },
      { event: 'speciation', location: 'DE', children: [
        { event: 'transfer', location: 'D', id: 'hgt', children: [
          { event: 'leaf', location: 'D', name: 'd1' },
          { event: 'leaf', location: 'C', name: 'c2' },
        ] },
        { event: 'leaf', location: 'E', name: 'e1' },
      ] },
    ],
  };
}

test('parseNewick keeps labels, lengths and structure, and assigns ids', () => {
  const t = parseNewick(UPPER);
  assert.equal(t.name, 'root');
  assert.equal(t.id, 'root');
  assert.equal(t.children!.length, 2);
  assert.equal(t.children![0].name, 'ABC');
  assert.equal(t.children![0].children![1].length, 2);
  const unnamed = parseNewick("((A,B),'C D':0.5);");
  assert.equal(unnamed.id, '#0');
  assert.equal(unnamed.children![0].id, '#1');
  assert.equal(unnamed.children![1].name, 'C D');
  assert.equal(toNewick(parseNewick('((A:1,B:2)AB:3,C:4)root;')), '((A:1,B:2)AB:3,C:4)root;');
  assert.throws(() => parseNewick('((A,B)C'), SyntaxError);
});

test('compileUpper flattens in pre-order with leaf counts', () => {
  const S = compileUpper(parseNewick(UPPER));
  assert.equal(S.n, 9);
  assert.equal(S.nLeaves, 5);
  assert.deepEqual(S.ids, ['root', 'ABC', 'AB', 'A', 'B', 'C', 'DE', 'D', 'E']);
  assert.equal(S.below[0], 5);
  assert.equal(S.maxDepth, 3);
  assert.equal(S.y[5], 3, 'leaves align at the deepest level');
});

test('createScene compiles the textbook reconciliation with an implicit loss', () => {
  const scene = createScene({ upper: parseNewick(UPPER), lower: [textbook()], familyNames: ['demo'] });
  const { upper: S, lower: G, layout: Lay } = scene;
  assert.deepEqual(scene.warnings, []);
  const count = (code: number) => Array.from(G.type.subarray(0, G.n)).filter((t) => t === code).length;
  assert.equal(count(LEAF), 7);
  assert.equal(count(DUP), 1);
  assert.equal(count(TRANS), 1);
  assert.equal(count(LOSS), 1, 'the second AB copy lost its B branch');
  assert.equal(count(SPECLOSS), 1);
  assert.equal(count(SPEC), 4);
  assert.equal(Lay.L[S.ids.indexOf('C')], 2, 'C holds its own copy and the transferred one');
  assert.equal(Lay.L[S.ids.indexOf('AB')], 2, 'two speciations and nothing else terminate in the AB branch');
  assert.equal(G.ids[0], 'g0');
  assert.equal(G.familyNames[0], 'demo');
  assert.deepEqual(checkInvariants(S, G, Lay), []);
});

test('speciations may list losses explicitly', () => {
  const lower: LowerNodeInput = { event: 'speciation', location: 'root', children: [
    { event: 'loss', location: 'ABC' },
    { event: 'speciation', location: 'DE', children: [{ event: 'leaf', location: 'D' }, { event: 'leaf', location: 'E' }] },
  ] };
  const scene = createScene({ upper: parseNewick(UPPER), lower: [lower] });
  assert.equal(scene.lower.type[0], SPECLOSS);
  assert.deepEqual(checkInvariants(scene.upper, scene.lower, scene.layout), []);
});

test('rule violations throw ReconciliationError naming the node', () => {
  const upper = parseNewick(UPPER);
  const bad = (lower: LowerNodeInput, re: RegExp) => assert.throws(() => createScene({ upper, lower: [lower] }), (e: unknown) => e instanceof ReconciliationError && re.test(e.message));
  bad({ event: 'leaf', location: 'nowhere', id: 'x' }, /unknown upper node "nowhere".*\(lower node x\)/);
  bad({ event: 'leaf', location: 'AB' }, /internal upper node/);
  bad({ event: 'speciation', location: 'A', children: [] }, /speciation at upper leaf/);
  bad({ event: 'speciation', location: 'root', children: [{ event: 'leaf', location: 'A' }] }, /direct child branch/);
  bad({ event: 'duplication', location: 'A', children: [{ event: 'leaf', location: 'A' }] }, /at least two children/);
  bad({ event: 'duplication', location: 'AB', children: [{ event: 'leaf', location: 'A' }, { event: 'leaf', location: 'B' }] }, /must stay in branch "AB"/);
  bad({ event: 'transfer', location: 'A', children: [{ event: 'leaf', location: 'A' }, { event: 'leaf', location: 'A' }] }, /one child staying/);
  bad({ event: 'transfer', location: 'A', children: [{ event: 'leaf', location: 'A' }, { event: 'leaf', location: 'AB' }] }, /never coexists/);
});

test('a speciation whose children are all lost degrades to a loss with a warning', () => {
  const lower: LowerNodeInput = { event: 'duplication', location: 'AB', children: [
    { event: 'speciation', location: 'AB', children: [{ event: 'loss', location: 'A' }, { event: 'loss', location: 'B' }] },
    { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A' }, { event: 'leaf', location: 'B' }] },
  ] };
  const scene = createScene({ upper: parseNewick(UPPER), lower: [lower] });
  assert.equal(scene.warnings.length, 1);
  assert.equal(scene.warnings[0].code, 'all-children-lost');
  assert.equal(scene.lower.type[1], LOSS);
  assert.deepEqual(checkInvariants(scene.upper, scene.lower, scene.layout), []);
});

test('event times are invented consistently for chains and transfers', () => {
  // a long chain of duplications in the C branch (levels 1..3) and a transfer whose window is a single level
  const chain: LowerNodeInput = { event: 'duplication', location: 'C', children: [
    { event: 'duplication', location: 'C', children: [
      { event: 'duplication', location: 'C', children: [{ event: 'leaf', location: 'C' }, { event: 'leaf', location: 'C' }] },
      { event: 'leaf', location: 'C' },
    ] },
    { event: 'transfer', location: 'C', children: [{ event: 'leaf', location: 'C' }, { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A' }, { event: 'leaf', location: 'B' }] }] },
  ] };
  const scene = createScene({ upper: parseNewick(UPPER), lower: [chain] });
  const { lower: G, layout: Lay } = scene;
  assert.deepEqual(scene.warnings, []);
  assert.deepEqual(checkInvariants(scene.upper, G, Lay), []);
  // the transfer lands on AB, which only exists during level 1
  const t = Array.from(G.type.subarray(0, G.n)).indexOf(TRANS);
  assert.ok(Lay.gT[t] > 1 && Lay.gT[t] < 2, `transfer at ${Lay.gT[t]} must fall inside the AB branch`);
  // duplications spread down the pipe rather than piling up at the top
  const dups = Array.from(G.type.subarray(0, G.n)).map((ty, i) => ty === DUP ? Lay.gT[i] : -1).filter((x) => x >= 0);
  assert.equal(dups.length, 3);
  assert.ok(dups[0] < dups[1] && dups[1] < dups[2]);
  assert.ok(dups[2] - dups[0] > 0.8, 'three chained duplications use more than one level of a three-level pipe');
});
