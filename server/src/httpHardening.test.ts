import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hardenHttpApp } from './httpHardening.js';

/**
 * The guards behind the F13 accepted risk, and the single HSTS owner.
 *
 * F13 was accepted with two `qs` advisories left in the lockfile because the
 * vulnerable path was said to be unreachable: the simple query parser, and no
 * urlencoded body parser. Nothing checked either, and one of the two servers
 * did not in fact use the simple parser. These tests are what the acceptance
 * now rests on -- the behaviour through a real HTTP request, and a sweep of the
 * source for the two ways the premise could quietly stop being true.
 */
describe('a hardened app', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    hardenHttpApp(app);
    app.get('/echo', (req, res) => {
      res.json(req.query);
    });
    app.post('/echo', (req, res) => {
      res.json({ body: req.body ?? null });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no test port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
  });

  it('parses a query string flat: brackets are part of a key, never structure', async () => {
    const response = await fetch(`${base}/echo?a[b]=1&a[b]=2&c[]=x&d[0][e]=y`);
    const query = (await response.json()) as Record<string, unknown>;
    // qs would have built { a: { b: ['1','2'] }, c: ['x'], d: [{ e: 'y' }] }.
    expect(query).toEqual({ 'a[b]': ['1', '2'], 'c[]': 'x', 'd[0][e]': 'y' });
    expect(query).not.toHaveProperty('a');
  });

  it('does not parse an urlencoded body', async () => {
    const response = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a[b]=1&c=2',
    });
    expect(((await response.json()) as { body: unknown }).body).toBeNull();
  });

  it('sends the helmet headers, but no HSTS of its own', async () => {
    const response = await fetch(`${base}/echo`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});

describe('the premise holds across the server source', () => {
  const srcRoot = join(__dirname);

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...sources(path));
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
    }
    return out;
  }

  const files = sources(srcRoot).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('every Express app a server builds is hardened', () => {
    const apps = files.filter((f) => /=\s*express\(\)/.test(f.text));
    // Both servers were found, or this proves nothing.
    expect(apps.map((f) => f.path.replace(/\\/g, '/').split('/src/')[1]).sort()).toEqual(['index.ts', 'labServer.ts']);
    for (const f of apps) expect(f.text, f.path).toMatch(/hardenHttpApp\(app\)/);
  });

  it('no server parses an urlencoded body', () => {
    const offenders = files.filter((f) => /\burlencoded\s*\(/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('nothing re-enables the extended query parser after hardening', () => {
    const offenders = files
      .filter((f) => !f.path.endsWith('httpHardening.ts'))
      .filter((f) => /set\(\s*['"]query parser['"]/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
