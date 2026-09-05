import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Read from disk rather than imported with `?raw`: vitest stubs CSS imports and
 * hands back an empty string, which would make every assertion below pass while
 * measuring nothing -- the exact failure mode this project keeps meeting.
 */
const CSS = readFileSync(fileURLToPath(new URL('./global.css', import.meta.url)), 'utf8');

/**
 * The palette, held to a contrast floor.
 *
 * Colour on this site is never the only carrier of a state -- the pills say
 * their state in words -- but it does carry the *reading* of a figure, and a
 * figure nobody can read is not a measurement. `--ink-3` was 3.19:1 on the
 * surface it sits on most, and it holds the units, the timestamps and every
 * em-dash that stands for "this value does not exist".
 *
 * WCAG 2.2: 4.5:1 for body text, 3:1 for graphics and large text. Chart series
 * are marks, so they are held to the lower bar; anything used as text is not.
 *
 * This test reads the stylesheet rather than a copy of the values, so it fails
 * on the change that regresses a token instead of on a copy nobody updated.
 */
/** Surfaces text is actually painted on. */
const SURFACES = ['bg', 'bg-raised', 'surface', 'surface-2', 'surface-3'];
/** Tokens used as a text colour somewhere in the components. */
const TEXT_TOKENS = ['ink', 'ink-2', 'ink-3', 'good', 'warn', 'crit', 'accent'];
/** Marks, not text: the 3:1 floor for non-text contrast. */
const MARK_TOKENS = ['s1', 's2', 's3', 's4', 's5', 's6', 'serious', 'info'];

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  expect(start, `selector ${selector} not found`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('\n}', open);
  const body = CSS.slice(open, close);
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]!] = m[2]!.toLowerCase();
  return tokens;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: Array<[string, string]> = [
  ['dark', ":root,\n:root[data-theme='dark']"],
  ['light', ":root[data-theme='light']"],
];

describe('palette contrast', () => {
  it('reads both themes out of the stylesheet', () => {
    for (const [, selector] of THEMES) {
      const tokens = block(selector);
      for (const name of [...SURFACES, ...TEXT_TOKENS, ...MARK_TOKENS]) {
        expect(tokens[name], `${selector} is missing --${name}`).toBeDefined();
      }
    }
  });

  for (const [theme, selector] of THEMES) {
    it(`keeps every text colour at 4.5:1 in the ${theme} theme`, () => {
      const tokens = block(selector);
      const failures: string[] = [];
      for (const token of TEXT_TOKENS) {
        for (const surface of SURFACES) {
          const value = contrast(tokens[token]!, tokens[surface]!);
          if (value < 4.5) failures.push(`--${token} on --${surface}: ${value.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`keeps every chart mark at 3:1 in the ${theme} theme`, () => {
      const tokens = block(selector);
      const failures: string[] = [];
      for (const token of MARK_TOKENS) {
        for (const surface of SURFACES) {
          const value = contrast(tokens[token]!, tokens[surface]!);
          if (value < 3) failures.push(`--${token} on --${surface}: ${value.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  // The measurement itself, checked against a value computed by hand: white on
  // black is 21:1, and a colour against itself is 1:1. A contrast function that
  // is quietly wrong would pass every test above.
  it('computes a contrast ratio the way WCAG defines it', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});
