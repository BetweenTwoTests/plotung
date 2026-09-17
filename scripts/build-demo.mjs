// Bundle the demo into single files with no module loader (run `npm run build` first):
//   dist/plotung-demo.html      complete page, opens from disk
//   dist/plotung-artifact.html  body-only fragment (title + style + markup + script) for hosts that wrap pages
// The "bundler" is deliberately dumb: compiled modules are concatenated in dependency order with their
// single-line `import` statements removed and `export ` prefixes stripped, so top-level names must be
// unique across files.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFile(new URL(p, `file://${root}`), 'utf8');

await access(new URL('dist/index.js', `file://${root}`)).catch(() => { throw new Error('dist/ is missing: run `npm run build` first'); });

const modules = ['dist/model.js', 'dist/newick.js', 'dist/compile.js', 'dist/layout.js', 'dist/viewer.js', 'dist/simulate.js', 'demo/names.js', 'demo/demo.js'];
const stripModule = (src) => src
  .split('\n')
  .filter((line) => !/^\s*import\s.*from\s+['"].*['"];?\s*$/.test(line))
  .filter((line) => !/^\s*export\s*\{\s*\};?\s*$/.test(line))
  .filter((line) => !/^\/\/# sourceMappingURL=/.test(line))
  .map((line) => line.replace(/^export\s+(?=(const|let|function|class)\b)/, ''))
  .join('\n');

let bundle = '';
for (const m of modules) bundle += `// ---- ${m}\n${stripModule(await read(m))}\n`;
const script = `(function () {\n'use strict';\n${bundle}\n})();`;

const html = await read('demo/index.html');
const css = await read('demo/demo.css');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const links = [...html.matchAll(/<link[^>]+(?:fonts\.g|rel="icon")[^>]*>/g)].map((m) => m[0]).join('\n');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[^>]*type="module"[^>]*><\/script>\s*/g, '');

const fragment = `${title}\n${links}\n<style>\n${css}\n</style>\n${body}\n<script>\n${script}\n</script>\n`;
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>[hidden]{display:none!important}</style>\n</head>\n<body>\n${fragment}</body>\n</html>\n`;

await mkdir(new URL('dist/', `file://${root}`), { recursive: true });
await writeFile(new URL('dist/plotung-demo.html', `file://${root}`), full);
await writeFile(new URL('dist/plotung-artifact.html', `file://${root}`), fragment);
console.log(`wrote dist/plotung-demo.html (${(full.length / 1024).toFixed(1)} KB) and dist/plotung-artifact.html`);
