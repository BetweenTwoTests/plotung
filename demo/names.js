// Pseudo-Latin binomials for leaf labels, deterministic per (seed, species index).
import { makeRng } from '../src/simulate.js';

const SYL = ['ka', 'ra', 'to', 'mi', 'ne', 'lu', 'sa', 'vo', 'ri', 'pe', 'da', 'no', 'xi', 'thu', 'ga', 'le', 'mo', 'ur', 'ce', 'pha', 'tri', 'oli', 'ven', 'dor', 'ast', 'bel', 'cor', 'fer', 'gal', 'hel', 'ix', 'jun', 'lom', 'mar', 'nub', 'ost', 'pil', 'quar', 'rud', 'sel', 'tar', 'umb', 'vir', 'wex', 'yl', 'zan'];
const END_G = ['us', 'a', 'is', 'on', 'es', 'ium', 'ia', 'ops'];
const END_S = ['ensis', 'icus', 'alis', 'ata', 'ella', 'oides', 'ina', 'ifer', 'osa', 'ianus', 'atum', 'ulus'];

export function makeSpeciesNamer(seed) {
  const cache = new Map();
  return (s) => {
    let nm = cache.get(s);
    if (nm) return nm;
    const rng = makeRng((seed * 1000003 + s * 7919) | 0);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    let genus = pick(SYL) + pick(SYL) + (rng() < 0.35 ? pick(SYL) : '');
    genus = genus[0].toUpperCase() + genus.slice(1) + pick(END_G);
    nm = genus + ' ' + pick(SYL) + pick(SYL) + pick(END_S);
    cache.set(s, nm);
    return nm;
  };
}
