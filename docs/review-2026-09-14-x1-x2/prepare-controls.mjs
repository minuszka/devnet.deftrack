import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../deftrack-review-458b6d0/', import.meta.url));
const target = fileURLToPath(new URL('./generated/', import.meta.url));
mkdirSync(target,{recursive:true});
writeFileSync(target+'harness-old.ts',execFileSync('git',['show','72fec82:client/e2e/harness.ts'],{cwd:root,encoding:'utf8'}),'utf8');
const test = readFileSync(root+'client/e2e/harness.spec.ts','utf8')
  .replaceAll("'./harness.js'","'./harness-old.js'")
  .replaceAll("'./fixtures/","'../../../../deftrack-review-458b6d0/client/e2e/fixtures/");
writeFileSync(target+'harness-negative.spec.ts',test,'utf8');
