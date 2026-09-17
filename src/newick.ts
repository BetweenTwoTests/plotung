/* Newick reader for the upper tree. */
import type { UpperNodeInput } from './types.ts';

/**
 * Parse one Newick tree, e.g. `((A:0.1,B:0.2)AB:0.3,C:0.4)root;`.
 * Labels may be single-quoted, `[comments]` are skipped, branch lengths are kept as `length`.
 * Every node gets an `id`: its label when present and unique, otherwise `#<pre-order index>`, so a
 * downstream algorithm can refer to unnamed internal nodes through the parsed object.
 */
export function parseNewick(text: string): UpperNodeInput {
  let i = 0;
  const s = text;
  const isWs = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
  const skip = () => {
    for (;;) {
      if (i >= s.length) return;
      const c = s[i];
      if (c === '[') { const j = s.indexOf(']', i); i = j < 0 ? s.length : j + 1; }
      else if (isWs(c)) i++;
      else return;
    }
  };
  const readLabel = (): string => {
    skip();
    if (s[i] === "'") {
      let j = i + 1, out = '';
      while (j < s.length) {
        if (s[j] === "'") { if (s[j + 1] === "'") { out += "'"; j += 2; continue; } break; }
        out += s[j++];
      }
      i = j + 1;
      return out;
    }
    let j = i;
    while (j < s.length && !isWs(s[j]) && !',:;()[]'.includes(s[j])) j++;
    const out = s.slice(i, j);
    i = j;
    return out;
  };
  const readNode = (): UpperNodeInput => {
    skip();
    const node: UpperNodeInput = {};
    if (s[i] === '(') {
      i++;
      node.children = [];
      for (;;) {
        node.children.push(readNode());
        skip();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ')') { i++; break; }
        throw new SyntaxError(`Newick: expected ',' or ')' at offset ${i}`);
      }
    }
    const label = readLabel();
    if (label) node.name = label;
    skip();
    if (s[i] === ':') {
      i++; skip();
      let j = i;
      while (j < s.length && '0123456789eE.+-'.includes(s[j])) j++;
      const len = parseFloat(s.slice(i, j));
      if (!Number.isNaN(len)) node.length = len;
      i = j;
    }
    return node;
  };
  const root = readNode();
  skip();
  if (s[i] === ';') i++;
  skip();
  if (i < s.length) throw new SyntaxError(`Newick: unexpected text at offset ${i}`);

  // ids: label when unique, else #pre-order-index
  const order: UpperNodeInput[] = [];
  const stack = [root];
  while (stack.length) {
    const v = stack.pop()!;
    order.push(v);
    if (v.children) for (let c = v.children.length - 1; c >= 0; c--) stack.push(v.children[c]);
  }
  const seen = new Set<string>();
  order.forEach((v, k) => {
    let id = v.id ?? v.name;
    if (!id || seen.has(id)) id = `#${k}`;
    v.id = id;
    seen.add(id);
  });
  return root;
}

/** Serialize an upper tree back to Newick (labels quoted when needed, lengths kept). */
export function toNewick(node: UpperNodeInput): string {
  const quote = (label: string) => /[\s,:;()\[\]']/.test(label) ? `'${label.replace(/'/g, "''")}'` : label;
  const walk = (v: UpperNodeInput): string => {
    const kids = v.children && v.children.length ? `(${v.children.map(walk).join(',')})` : '';
    const label = v.name ?? '';
    const len = v.length !== undefined ? `:${v.length}` : '';
    return `${kids}${label ? quote(label) : ''}${len}`;
  };
  return walk(node) + ';';
}
