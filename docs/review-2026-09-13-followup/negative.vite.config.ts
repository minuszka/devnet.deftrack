import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import baseline from '../../client/vite.config.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
// Read-only overlay: current tests/harness run against pre-fix client source.
// No working tree source is overwritten. Git arguments are passed separately.
const changed = new Set(execFileSync('git', ['diff', '--name-only', '39e7f80', '72fec82', '--', 'client/src'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
export default {
  ...baseline,
  plugins: [{ name: 'review-baseline-overlay', enforce: 'pre' as const,
    load(id: string) {
      const path = relative(resolve(root), id.split('?')[0]!).replaceAll('\\', '/');
      if (!changed.has(path) || path.endsWith('.test.ts')) return null;
      return execFileSync('git', ['show', `39e7f80:${path}`], { cwd: root, encoding: 'utf8' });
    },
  }],
};
