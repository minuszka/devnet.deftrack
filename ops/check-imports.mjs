#!/usr/bin/env node
/**
 * Do the ops scripts still import things that exist?
 *
 * The lab scripts import from `server/dist`, which is build output: a rename in
 * `server/src` leaves them syntactically perfect and broken at run time, and
 * nothing in the repository noticed. `node --check` does not help -- it parses
 * and never resolves -- so a rename would be found by whoever next tried to
 * bring the lab up, in the middle of doing something else.
 *
 * This resolves every relative specifier in `ops/*.mjs` and `ops/*.cjs`, and
 * for ES modules also loads the target and checks that each named binding is
 * actually exported. Loading is safe by construction here: the only module
 * imported this way is `labCompose`, which is pure by design and tested as
 * such. A future import of something with side effects should be given a
 * static check instead of being loaded.
 *
 * Requires `npm run build` first, because it checks the built output on
 * purpose -- that is what the scripts import.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OPS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OPS, '..');

/** `import { a, b } from './x.js'` and `export { a } from './x.js'`. */
const ESM_FROM = /(?:^|\n)\s*(?:import|export)\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]/g;
/** `import './x.js'` -- a side-effect import with no bindings. */
const ESM_BARE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const CJS_REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
/** The `{ a, b as c }` part of an import clause. */
const NAMED = /\{([^}]*)\}/;

function namedBindings(clause) {
  const braces = NAMED.exec(clause);
  if (!braces) return [];
  return braces[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+as\s+/)[0].trim())
    .filter((name) => name !== 'type' && !name.startsWith('type '));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const failures = [];
const checked = { files: 0, specifiers: 0, bindings: 0 };

const entries = (await readdir(OPS, { withFileTypes: true }))
  .filter((e) => e.isFile() && /\.(mjs|cjs)$/.test(e.name))
  .map((e) => join(OPS, e.name))
  .sort();

for (const file of entries) {
  const source = await readFile(file, 'utf8');
  const here = dirname(file);
  const shown = relative(ROOT, file).replace(/\\/g, '/');
  checked.files += 1;

  /** [specifier, namedBindings][] */
  const targets = [];
  for (const m of source.matchAll(ESM_FROM)) targets.push([m[2], namedBindings(m[1])]);
  for (const m of source.matchAll(ESM_BARE)) targets.push([m[1], []]);
  for (const m of source.matchAll(CJS_REQUIRE)) targets.push([m[1], []]);

  for (const [specifier, bindings] of targets) {
    if (!specifier.startsWith('.')) continue; // node builtins and packages
    checked.specifiers += 1;

    const target = resolve(here, specifier);
    if (!(await exists(target))) {
      failures.push(`${shown}: imports ${specifier}, which does not exist (${relative(ROOT, target)})`);
      continue;
    }
    if (bindings.length === 0 || !target.endsWith('.js')) continue;

    let module;
    try {
      module = await import(pathToFileURL(target).href);
    } catch (error) {
      failures.push(`${shown}: importing ${specifier} threw: ${error.message}`);
      continue;
    }
    for (const binding of bindings) {
      checked.bindings += 1;
      if (!(binding in module)) {
        failures.push(`${shown}: ${specifier} exports no ${binding}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('ops import check FAILED:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `ops imports: ${checked.files} scripts, ${checked.specifiers} relative imports, ` +
    `${checked.bindings} named bindings -- all resolve`
);
