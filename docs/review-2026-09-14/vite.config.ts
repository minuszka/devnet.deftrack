import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import baseline from '../../client/vite.config.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mutation = process.env.REVIEW_MUTATION ?? 'none';
const paths = new Set(['client/src/components/dd-admin-shell.ts', 'client/src/components/dd-page-fairness.ts', 'client/src/components/dd-page-simulations.ts']);
export default { ...baseline, plugins: [{ name: 'read-only-review-overlay', enforce: 'pre' as const,
  load(id: string) {
    const path = relative(root, id.split('?')[0]!).replaceAll('\\','/');
    if (mutation === 'baseline' && paths.has(path)) return execFileSync('git', ['show', `72fec82:${path}`], { cwd: root, encoding: 'utf8' });
    if (mutation === 'revision' && path === 'client/src/lib/simulationRunState.ts') {
      const source = readFileSync(id.split('?')[0]!, 'utf8');
      const guard = 'return incoming.state.revision >= held.state.revision;';
      if (!source.includes(guard)) throw new Error('Revision mutation guard did not match');
      return source.replace(guard, 'return true; // Independent negative control: revision guard removed');
    }
    return null;
  },
}] };
