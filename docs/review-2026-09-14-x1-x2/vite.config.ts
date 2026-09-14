import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import base from '../../../deftrack-review-458b6d0/client/vite.config.js';
const root = fileURLToPath(new URL('../../../deftrack-review-458b6d0/', import.meta.url));
export default { ...base, plugins: [{ name: 'independent-baseline-read', enforce: 'pre' as const,
  load(id: string) {
    const path = relative(root, id.split('?')[0]!).replaceAll('\\','/');
    if (process.env.REVIEW_MODE === 'baseline' && path === 'client/src/components/dd-admin-shell.ts') {
      return execFileSync('git',['show',`eb76773:${path}`],{cwd:root,encoding:'utf8'});
    }
    return null;
  },
}] };
