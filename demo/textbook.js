// The textbook figure, built through the public input API: Newick upper tree + nested lower-tree events.
import { parseNewick, createScene, createViewer, ReconciliationError } from '../dist/index.js';

const UPPER = '(((A:1,B:1)AB:1,C:2)ABC:1,(D:2,E:2)DE:2)root;';
const LOWER = [
  {
    event: 'speciation', location: 'root', children: [
      { event: 'speciation', location: 'ABC', children: [
        { event: 'duplication', location: 'AB', children: [
          { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A', name: 'a1' }, { event: 'leaf', location: 'B', name: 'b1' }] },
          { event: 'speciation', location: 'AB', children: [{ event: 'leaf', location: 'A', name: 'a2' }] },
        ] },
        { event: 'leaf', location: 'C', name: 'c1' },
      ] },
      { event: 'speciation', location: 'DE', children: [
        { event: 'transfer', location: 'D', children: [
          { event: 'leaf', location: 'D', name: 'd1' },
          { event: 'leaf', location: 'C', name: 'c2' },
        ] },
        { event: 'leaf', location: 'E', name: 'e1' },
      ] },
    ],
  },
];

const el = (id) => document.getElementById(id);
const upperBox = el('upper'), lowerBox = el('lower'), msg = el('msg'), tip = el('tooltip');
upperBox.value = UPPER;
lowerBox.value = JSON.stringify(LOWER, null, 2);

function cssTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    theme: { bg: g('--bg'), tube: g('--tube'), tubeEdge: g('--tube-edge'), band: g('--band'), grid: g('--grid'), ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), heat: g('--heat'), panel: g('--panel-solid') },
    families: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g('--f' + i)),
  };
}
const { theme, families } = cssTheme();
const viewer = createViewer(el('c'), {
  theme, familyColors: families,
  labelFont: '12px "IBM Plex Sans", system-ui, sans-serif',
  onHover: (hit, x, y) => {
    const d = viewer.describe(hit);
    if (!d) { tip.hidden = true; return; }
    tip.textContent = d.kind === 'gene' || d.kind === 'transfer'
      ? `${d.eventName} · ${d.familyName} · branch above ${d.pipeId}${d.recipientId ? ` → ${d.recipientId}` : ''}${d.name ? ` · ${d.name}` : ''}`
      : `${d.id}${d.leaf ? '' : ` · ${d.below} species below`} · ${d.leaf ? d.genes + ' gene copies' : d.subGenes + ' genes below'}`;
    tip.hidden = false;
    tip.style.left = (x + 14) + 'px'; tip.style.top = (y + 14) + 'px';
  },
});
viewer.setOptions({ slanted: true });

function render() {
  try {
    const scene = createScene({ upper: parseNewick(upperBox.value), lower: JSON.parse(lowerBox.value) });
    viewer.setScene(scene);
    msg.className = '';
    const { upper, lower } = scene;
    msg.textContent = `${upper.nLeaves} upper leaves · ${lower.n} lower nodes` + (scene.warnings.length ? `\n${scene.warnings.map((w) => 'warning: ' + w.message).join('\n')}` : '');
  } catch (e) {
    msg.className = 'err';
    msg.textContent = (e instanceof ReconciliationError ? 'reconciliation error: ' : e instanceof SyntaxError ? 'syntax error: ' : '') + e.message;
  }
}
el('render').addEventListener('click', render);
el('slanted').addEventListener('change', (e) => viewer.setOptions({ slanted: e.target.checked }));
for (const box of [upperBox, lowerBox]) box.addEventListener('input', () => { clearTimeout(box._t); box._t = setTimeout(render, 250); });
render();
