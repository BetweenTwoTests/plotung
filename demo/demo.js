// Demo app: wires the control panel to the simulator (plotung/simulate) and the viewer.
import { createViewer, Event } from '../dist/index.js';
import { generate } from '../dist/simulate.js';
import { makeSpeciesNamer } from './names.js';

const el = (id) => document.getElementById(id);
const LEAF_CHOICES = [4, 5, 6, 8, 16, 64, 256, 1024, 4096, 16384, 65536, 131072];
const demoState = { scene: null, seed: 7, speciesName: (s) => 'species ' + s, familyColors: [] };

// ------------------------------------------------------------ theme from CSS tokens
function readCssTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    theme: { bg: g('--bg'), tube: g('--tube'), tubeEdge: g('--tube-edge'), band: g('--band'), grid: g('--grid'), ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), heat: g('--heat'), panel: g('--panel-solid') },
    families: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g('--f' + i)),
  };
}
function applyTheme() {
  const { theme, families } = readCssTheme();
  demoState.familyColors = families;
  viewer.setTheme(theme).setFamilyColors(families);
  document.querySelectorAll('#legend .sw').forEach((sw, i) => { sw.style.background = families[i]; });
}

// ------------------------------------------------------------ viewer
const tip = el('tooltip');
const viewer = createViewer(el('c'), {
  minimap: el('minimap'),
  labelFor: (s) => demoState.speciesName(s),
  labelFont: '11px "IBM Plex Sans", system-ui, sans-serif',
  rulerFont: '10px "IBM Plex Mono", ui-monospace, monospace',
  rulerInset: () => { const p = el('controls'); return (p.open && innerWidth > 760) ? p.getBoundingClientRect().width + 26 : 8; },
  onHover: (hit, x, y) => {
    if (!hit) { tip.hidden = true; return; }
    tip.innerHTML = tooltipHtml(viewer.describe(hit));
    tip.hidden = false;
    const { width: w, height: h } = viewer.getSize();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (x + 14 + tw > w ? x - tw - 12 : x + 14) + 'px';
    tip.style.top = (y + 14 + th > h ? y - th - 10 : y + 14) + 'px';
  },
  onFrame: updateLiveStats,
});
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ------------------------------------------------------------ tooltips
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function pipeLabel(s) {
  const { upper } = demoState.scene;
  if (upper.firstChild[s] < 0) return esc(demoState.speciesName(s));
  if (s === 0) return 'the root clade';
  return `clade #${s} (${upper.below[s].toLocaleString()} species)`;
}
function tooltipHtml(d) {
  const colors = demoState.familyColors;
  if (d.kind === 'gene' || d.kind === 'transfer') {
    const fam = `<span class="tf" style="color:${colors[d.family % colors.length]}">${esc(d.familyName)}</span>`;
    let body;
    if (d.event === Event.LEAF) body = `gene copy in <i>${esc(demoState.speciesName(d.pipe))}</i>`;
    else if (d.event === Event.LOSS) body = `lineage lost in the branch above ${pipeLabel(d.pipe)}`;
    else if (d.event === Event.TRANS) body = `from the branch above ${pipeLabel(d.pipe)}<br>to the branch above ${pipeLabel(d.recipientPipe)}`;
    else if (d.event === Event.SPEC || d.event === Event.SPECLOSS) body = `at the split of ${pipeLabel(d.pipe)}`;
    else body = `in the branch above ${pipeLabel(d.pipe)}`;
    return `<b>${esc(d.eventName)}</b> · ${fam}<br>${body}<br><span class="tm">t = ${d.t.toFixed(2)} · ${d.extant.toLocaleString()} extant descendant${d.extant === 1 ? '' : 's'}</span>`;
  }
  if (d.leaf) {
    const parts = [...d.perFamily.entries()].sort((a, b) => a[0] - b[0]).map(([f, k]) => `<span style="color:${colors[f % colors.length]}">${String.fromCharCode(65 + f)}×${k}</span>`).join(' ');
    return `<b><i>${esc(demoState.speciesName(d.pipe))}</i></b><br>${d.genes} gene cop${d.genes === 1 ? 'y' : 'ies'}${parts ? ' · ' + parts : ''}<br><span class="tm">${d.events} event${d.events === 1 ? '' : 's'} on its branch · depth ${d.depth}</span>`;
  }
  const copies = (d.subGenes / d.below).toFixed(2);
  return `<b>${pipeLabel(d.pipe)}</b>${d.kind === 'clade' ? ' <span class="tm">collapsed</span>' : ''}<br>${d.subGenes.toLocaleString()} genes below · ${copies} per species<br><span class="tm">${d.subEvents.toLocaleString()} events below · ${d.lanes} lane${d.lanes === 1 ? '' : 's'} in the branch above · depth ${d.depth}</span>`;
}

// ------------------------------------------------------------ keyboard
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  if (!demoState.scene) return;
  const { width, height } = viewer.getSize();
  switch (e.key) {
    case 'f': case 'F': viewer.fitAll(true); break;
    case '+': case '=': viewer.zoomAt(1.3, 1.3, width / 2, height / 2); break;
    case '-': case '_': viewer.zoomAt(1 / 1.3, 1 / 1.3, width / 2, height / 2); break;
    case 'x': case 'X': viewer.setOptions({ axisLock: 'x' }); break;
    case 'y': case 'Y': viewer.setOptions({ axisLock: 'y' }); break;
    case 'ArrowLeft': viewer.pan(80, 0); break;
    case 'ArrowRight': viewer.pan(-80, 0); break;
    case 'ArrowUp': viewer.pan(0, 80); break;
    case 'ArrowDown': viewer.pan(0, -80); break;
    case 's': case 'S': el('style').value = el('style').value === 'slant' ? 'orth' : 'slant'; el('style').dispatchEvent(new Event('change')); break;
    default: return;
  }
  e.preventDefault();
});
window.addEventListener('keyup', (e) => { if (/^[xy]$/i.test(e.key)) viewer.setOptions({ axisLock: null }); });

// ------------------------------------------------------------ controls
const leavesSel = el('leaves');
LEAF_CHOICES.forEach((n) => { const opt = document.createElement('option'); opt.value = n; opt.textContent = n.toLocaleString(); leavesSel.appendChild(opt); });
leavesSel.value = '256';
function bindRange(id, fmt) {
  const input = el(id), out = el(id + '-out');
  const upd = () => { out.textContent = fmt(+input.value); };
  input.addEventListener('input', upd); upd();
}
bindRange('families', (v) => String(v));
bindRange('rd', (v) => v.toFixed(3));
bindRange('rt', (v) => v.toFixed(3));
bindRange('rl', (v) => v.toFixed(3));
bindRange('locality', (v) => Math.round(v * 100) + '%');
bindRange('poly', (v) => Math.round(v * 100) + '%');
el('seed').value = String(demoState.seed);
el('shuffle').addEventListener('click', () => { el('seed').value = String(1 + Math.floor(Math.random() * 99999)); runGenerate(); });
el('generate').addEventListener('click', runGenerate);
el('fit').addEventListener('click', () => viewer.fitAll(true));
el('style').addEventListener('change', (e) => viewer.setOptions({ slanted: e.target.value === 'slant' }));
el('showT').addEventListener('change', (e) => viewer.setOptions({ showTransfers: e.target.checked }));
el('showL').addEventListener('change', (e) => viewer.setOptions({ showLosses: e.target.checked }));
el('showLabels').addEventListener('change', (e) => viewer.setOptions({ labels: e.target.checked }));
el('heat').addEventListener('change', (e) => viewer.setOptions({ heat: e.target.checked }));
document.querySelectorAll('input[name=zoommode]').forEach((r) => r.addEventListener('change', (e) => viewer.setOptions({ zoomMode: e.target.value })));

function readControls() {
  return {
    leaves: +leavesSel.value, families: +el('families').value, rD: +el('rd').value, rT: +el('rt').value, rL: +el('rl').value,
    locality: +el('locality').value, polyProb: +el('poly').value, seed: (+el('seed').value | 0) || 7,
  };
}
function runGenerate() {
  const opts = readControls();
  el('overlay').hidden = false;
  el('overlay-text').textContent = `Simulating ${opts.families} gene famil${opts.families === 1 ? 'y' : 'ies'} across ${opts.leaves.toLocaleString()} species…`;
  tip.hidden = true;
  setTimeout(() => {
    const scene = generate(opts);
    demoState.scene = scene; demoState.seed = opts.seed;
    demoState.speciesName = makeSpeciesNamer(opts.seed);
    viewer.setScene(scene);
    updateLegend(opts.families);
    updateStaticStats();
    el('overlay').hidden = true;
  }, 40);
}
function updateLegend(nFam) {
  document.querySelectorAll('#legend .fam').forEach((row, i) => { row.hidden = i >= nFam; });
}
function updateStaticStats() {
  const { upper, lower, counts, timing } = demoState.scene;
  el('stat-static').innerHTML = `<b>${upper.nLeaves.toLocaleString()}</b> species (${upper.n.toLocaleString()} nodes, depth ${upper.maxDepth}) · <b>${lower.n.toLocaleString()}</b> gene nodes · ` +
    `S ${counts.S.toLocaleString()} · D ${counts.D.toLocaleString()} · T ${counts.T.toLocaleString()} · L ${counts.L.toLocaleString()} · layout ${timing.total.toFixed(0)} ms`;
}
let lastStatsAt = 0;
function updateLiveStats(stats) {
  const at = performance.now();
  if (at - lastStatsAt < 200) return;
  lastStatsAt = at;
  el('stat-live').textContent = `drawn: ${stats.pipes.toLocaleString()} pipes · ${stats.wedges.toLocaleString()} collapsed clades · ${stats.segs.toLocaleString()} gene segments · ${stats.transfers.toLocaleString()} transfers · ${stats.ms.toFixed(1)} ms/frame`;
}

// ------------------------------------------------------------ boot
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => viewer.setOptions({}));
runGenerate();
