# plotung

Zoomable visualization of **tree reconciliation**: an upper tree (species, hosts, geography) drawn as fat tubes, with one or more lower trees (genes, symbionts) threaded inside. Where a lower tree stops following its tube, the events that explain it are drawn: **duplication**, **loss** and **horizontal transfer**. Time runs down the page.

It is built like an infinite-canvas app rather than a chart: layout is pure and linear, rendering is culled against the viewport with level of detail, and the whole thing stays interactive at 100k+ species leaves and millions of gene nodes. No dependencies.

```
npm test        # layout invariants, node:test
npm run dev     # demo at http://localhost:5173/demo/
npm run build   # dist/plotung-demo.html, a single self-contained file
```

## What you see

| Mark | Meaning |
|---|---|
| grey tube | a branch of the upper tree; its width is the number of lower-tree lineages passing through |
| coloured line inside a tube | a lower-tree lineage; one colour per gene family |
| line fanning into child tubes at a split | speciation: the gene follows the species split |
| filled square, line forks inside one tube | duplication |
| short stub ending in a cross | loss |
| dashed arc with an arrowhead | horizontal transfer to a contemporaneous branch |
| tinted wedge | a clade too narrow to draw, tinted by gene copies per species |

Two tube styles: **orthogonal pipes** (vertical tubes joined by horizontal bands, the scalable default) and **slanted tubes** (the textbook look, internal nodes at the mean of their children so tubes never cross sibling clades).

## Usage

```js
import { generate, createViewer, DARK_THEME, DARK_FAMILY_COLORS } from 'plotung';

const viewer = createViewer(document.querySelector('canvas'), {
  minimap: document.querySelector('#minimap'),     // optional second canvas
  labelFor: (species) => names[species],           // leaf labels
  theme: DARK_THEME,
  familyColors: DARK_FAMILY_COLORS,
  onHover: (hit, x, y) => showTooltip(viewer.describe(hit), x, y),
});

// synthetic data: a species tree plus gene families grown along it and pruned to what a reconciliation observes
viewer.setData(generate({ leaves: 4096, families: 3, rD: 0.03, rT: 0.015, rL: 0.03, seed: 7 }));

viewer.setOptions({ slanted: true, showTransfers: true, zoomMode: 'x' });
viewer.fitClade(1234, true);
```

`setData` accepts `{ S, G }` from your own source as well; `Lay` is computed when missing. `S` is the species tree (`parent`, `firstChild`, `nextSibling`, `depth`, `below`, run through `finishSpecies`) and `G` is a `GeneStore` whose nodes carry a type, the pipe they live in, a time, and a parent. Everything the renderer needs comes out of `layout(S, G)` as typed arrays, so a worker can compute it and post it back.

The mapping onto recPhyloXML is direct and is the next thing to build: `speciation`, `duplication`, `branchingOut` + `transferBack`, `loss` and `leaf` events become `SPEC`, `DUP`, `TRANS`, `STUB` and `LEAF` nodes with `speciesLocation` as the pipe.

## How the layout works

Four passes, all in `src/layout.js`:

1. **Pipe widths from occupancy.** A pipe's lane count is the number of lower-tree lineages that terminate in it (speciations at its bottom, extant genes, losses). Width follows from lane count.
2. **Upper tree as a weighted tidy layout.** A subtree's extent is the larger of its own pipe width and its children's extents plus gaps; positions are assigned top-down. No two pipes overlap.
3. **Lanes and crossing reduction.** Pipes are processed parent before child. Lineages entering from the parent keep the parent's order, so nothing crosses at a speciation. Inside a pipe, a duplication's children are ordered by the mean x of the leaves they eventually reach. Crossings remain only where the topology forces them.
4. **Event times inside a level.** Duplications and transfers have an order but no dates. Per level, a small DAG (parent before child, plus a chain per pipe) is layered by longest path from sources and sinks, which spreads events evenly, keeps a pipe's events at distinct heights, and makes transfers horizontal because both ends are one node.

## How it stays fast

- **Hierarchical culling.** Every frame walks the species tree from the root and skips subtrees outside the viewport as a unit.
- **Semantic zoom.** A subtree narrower than about 3 px collapses into a wedge tinted by copy number. Below roughly 0.7 px per lane, gene segments become one translucent block per pipe and transfer arcs are hidden, fading in as you zoom.
- **Anisotropic camera.** Independent x and y scales, because a wide tree is only tens of levels deep. Scroll zooms both axes, `X` or `Y` held zooms one.
- **Typed arrays throughout.** The layout for 131k leaves and 1.9M gene nodes takes under a second single-threaded; frames stay around 10 ms because the drawn primitive count is pixel-bound.

Measured in Chrome on a laptop, three gene families:

| species leaves | gene nodes | layout | frame at full-tree view |
|---|---|---|---|
| 256 | 1k | 4 ms | 2 ms |
| 4,096 | 37k | 36 ms | a few ms |
| 131,072 | 1.9M | 790 ms | 9 to 11 ms |

## Layout of the repository

```
src/model.js      node types, geometry constants, GeneStore
src/simulate.js   random species tree, DTL simulation, pruning, generate()
src/layout.js     the four layout passes, laneX / pipeEdges geometry helpers
src/viewer.js     Canvas2D viewer: camera, culled drawing, LOD, picking, minimap
demo/             control panel, legend, tooltips, keyboard shortcuts
test/             invariant checks over generated and hand-built reconciliations
scripts/          zero-dependency static server and single-file bundler
```

## Roadmap

- recPhyloXML reader and a Newick reader for the species tree
- dated species trees (a true time axis instead of levels)
- route transfer arcs around intervening pipes instead of arcing over them
- a second, bottom-up crossing-reduction sweep
- WebGL renderer for many simultaneous families at mid zoom
- React and Vue wrappers around `createViewer`

## License

MIT
