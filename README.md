# plotung

Typed visualization of **tree reconciliation**. You describe an upper tree (species, hosts, areas) and one or more lower trees (genes, symbionts) whose nodes carry the events your algorithm inferred: speciation, duplication, loss, horizontal transfer. plotung lays that out as fat tubes with the lower trees threaded inside, time running down the page, and renders it on a zoomable canvas that stays interactive at 100k+ leaves.

plotung does **not** infer anything. The reconciliation is your input; the library is the interface between it and the picture.

```
npm install          # TypeScript is the only (dev) dependency
npm run build        # tsc -> dist/ (ES modules + .d.ts)
npm test             # node:test, runs the .ts sources directly
npm run dev          # builds, then serves the demos at http://localhost:5173/demo/
```

Two demo pages: `demo/index.html` drives the viewer with simulated data from the optional `plotung/simulate` entry, and `demo/textbook.html` is the input API in the raw: a Newick box, a JSON box, and the picture.

## Input

```ts
import { parseNewick, createScene, createViewer } from 'plotung';
import type { LowerNodeInput } from 'plotung';

const upper = parseNewick('(((A,B)AB,C)ABC,(D,E)DE)root;');   // every node gets an id: its label, or #<pre-order index>

const family: LowerNodeInput = {
  event: 'speciation', location: 'root', children: [
    { event: 'speciation', location: 'ABC', children: [
      { event: 'duplication', location: 'AB', children: [
        { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A', name: 'a1' }, { event: 'leaf', location: 'B', name: 'b1' }] },
        { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A', name: 'a2' }] },   // B copy lost: an implicit loss
      ] },
      { event: 'leaf', location: 'C', name: 'c1' },
    ] },
    { event: 'speciation', location: 'DE', children: [
      { event: 'transfer', location: 'D', children: [
        { event: 'leaf', location: 'D', name: 'd1' },     // stays in the donor branch
        { event: 'leaf', location: 'C', name: 'c2' },     // lands in C
      ] },
      { event: 'leaf', location: 'E', name: 'e1' },
    ] },
  ],
};

const scene = createScene({ upper, lower: [family], familyNames: ['my gene'] });
createViewer(document.querySelector('canvas')!).setScene(scene);
```

Every lower node names the upper node whose **branch** hosts it (`location`). The rules, checked by `createScene`, which throws `ReconciliationError` with the offending node's id:

| event | location | children |
|---|---|---|
| `leaf` | an upper leaf | none |
| `speciation` | an internal upper node, where the lineage splits | one per distinct direct child branch; branches left out become losses unless `implicitLosses: false` |
| `duplication` | the branch the copies stay in | two or more, all in the same branch |
| `transfer` | the donor branch | exactly two: one in the donor branch, one in any branch that coexists with it |
| `loss` | the branch where the lineage ends | none |

A speciation whose children are all lost is drawn as a loss and reported in `scene.warnings`. Upper and lower nodes may carry `id` and `name`; ids are what tooltips and `viewer.describe()` hand back to you.

The mapping from recPhyloXML is one-to-one: `speciation`, `duplication`, `branchingOut`+`transferBack`, `loss` and `leaf` with `speciesLocation` as the location. A reader for it is the next planned addition.

## Output

`createScene` returns a `Scene`:

- `upper: UpperTree` and `lower: LowerForest`: the compiled trees as typed arrays (`parent`, `firstChild`, `nextSibling`, per-node ids and names, event codes, pipe of each lower node).
- `layout: Layout`: per pipe its lane count, width and x position; per lower node its drawn time, segment start and lane; transfers and their recipients; aggregates for collapsed clades. World x is in lane units and world y in levels, so any renderer can consume it.
- `warnings`.

`compileUpper`, `compileLower` and `layout` are also exported separately, so a worker can compile and lay out while the main thread only draws.

## Viewer

```ts
const viewer = createViewer(canvas, {
  minimap: minimapCanvas,          // optional second canvas
  theme: DARK_THEME,               // or any Partial<Theme>
  familyColors: DARK_FAMILY_COLORS,
  labelFor: (s, scene) => scene.upper.names[s] ?? scene.upper.ids[s],
  onHover: (hit, x, y) => tooltip(viewer.describe(hit), x, y),
});
viewer.setScene(scene);
viewer.setOptions({ slanted: true, showTransfers: true, zoomMode: 'x' });
viewer.fitClade(scene.upper.ids.indexOf('ABC'), true);
```

Drag pans, scroll zooms at the cursor, double-click fits a clade. `zoomMode` and a held `axisLock` zoom one axis, which matters because a wide tree is only tens of levels deep. `pick(x, y)` and `describe(hit)` return plain data (event, family, upper node id, recipient, counts) for your own tooltips. The viewer is framework-free; React or Vue wrappers only need to own the canvas element.

### What you see

| mark | meaning |
|---|---|
| grey tube | an upper branch; its width is the number of lower lineages passing through |
| coloured line | a lower lineage, one colour per family |
| line fanning into child tubes | speciation |
| filled square, line forks inside one tube | duplication |
| short stub ending in a cross | loss |
| dashed arc with an arrowhead | horizontal transfer |
| tinted wedge | a clade too narrow to draw, tinted by gene copies per species |

## How the layout works

Four passes in `src/layout.ts`, all linear or near-linear:

1. **Pipe widths from occupancy.** A pipe's lane count is the number of lower lineages that terminate in it. Width follows.
2. **Upper tree as a weighted tidy layout.** A subtree's extent is the larger of its pipe width and its children's extents plus gaps; positions are assigned top-down.
3. **Lanes and crossing reduction.** Pipes are processed parent before child. Lineages entering from the parent keep the parent's order, so nothing crosses at a speciation. Inside a pipe, a duplication's children are ordered by the mean x of the leaves they reach.
4. **Event times.** Your input carries no dates, so duplications and transfers are first given a level: the window between the earliest level allowed by the pipe, the parent and a transfer's recipient, and the latest allowed by the children, filled by depth in the pipe-local chain so long branches spread their events out. Within a level, a small DAG is layered by longest path so events never share a height and transfers stay horizontal.

## How it stays fast

Hierarchical culling skips whole subtrees outside the viewport. Subtrees narrower than about 3 px collapse into tinted wedges; below roughly 0.7 px per lane, lineages become one translucent block per pipe and transfer arcs are hidden. Everything is typed arrays. Measured with simulated data, three families: 131,072 leaves and 1.9M lower nodes lay out in under a second single-threaded and draw in about 10 ms per frame at any zoom.

## Simulated data

`plotung/simulate` grows gene families along a random upper tree with a duplication–transfer–loss process and prunes them to what a reconciliation could observe. It exists for the demo and for stress tests, and it is not part of the main entry.

```ts
import { generate } from 'plotung/simulate';
viewer.setScene(generate({ leaves: 4096, families: 3, rD: 0.03, rT: 0.015, rL: 0.03, seed: 7 }));
```

## Repository

```
src/types.ts      public input types, Layout, Scene
src/model.ts      event codes, geometry constants, compiled UpperTree / LowerForest
src/newick.ts     parseNewick / toNewick
src/compile.ts    input -> compiled trees, rule checks, createScene
src/layout.ts     the four layout passes, laneX / pipeEdges
src/viewer.ts     Canvas2D viewer
src/simulate.ts   optional synthetic data (plotung/simulate)
demo/             control-panel demo and the input API example
test/             invariant checks over simulated, hand-built and rule-breaking input
scripts/          zero-dependency dev server and single-file bundler
```

## Roadmap

- recPhyloXML reader
- dated upper trees (a true time axis instead of levels)
- transfer arcs routed around intervening pipes
- a second, bottom-up crossing-reduction sweep
- WebGL renderer for many simultaneous families at mid zoom
- React and Vue wrappers around `createViewer`

## License

MIT
