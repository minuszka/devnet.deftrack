import { describe, expect, it } from 'vitest';
import {
  LLMQ_ALL,
  LLMQ_PATTERN,
  llmqApiName,
  maxPageFor,
  offsetToPage,
  pageToOffset,
  readQuery,
  writeQuery,
  type ParamSpec,
} from './queryState.js';

const SPEC: Record<string, ParamSpec> = {
  status: { kind: 'enum', values: ['', 'formed', 'failed'], fallback: '' },
  rounds: { kind: 'choice', values: [20, 50, 100], fallback: 50 },
  llmq: { kind: 'optional', pattern: LLMQ_PATTERN },
  page: { kind: 'page', limit: 50 },
};

describe('readQuery', () => {
  it('reads what is there', () => {
    const r = readQuery('?status=failed&rounds=100&llmq=llmq_defcon&page=3', SPEC);
    expect(r.values).toEqual({
      status: 'failed',
      rounds: 100,
      llmq: 'llmq_defcon',
      page: 3,
    });
    expect(r.needsNormalising).toBe(false);
  });

  it('gives defaults for an empty query, and writes nothing back', () => {
    const r = readQuery('', SPEC);
    expect(r.values).toEqual({ status: '', rounds: 50, llmq: null, page: 1 });
    expect(r.canonical).toBe('');
    expect(r.needsNormalising).toBe(false);
  });

  /*
   * A default written out is a longer link that means the same thing, and two
   * readers who arrived differently would hand each other different URLs for
   * the same screen.
   */
  it('drops a parameter that equals its default', () => {
    const r = readQuery('?status=&rounds=50&page=1', SPEC);
    expect(r.canonical).toBe('');
    expect(r.needsNormalising).toBe(true);
  });

  it('normalises a value nobody defines', () => {
    const r = readQuery('?status=banana', SPEC);
    expect(r.values['status']).toBe('');
    expect(r.needsNormalising).toBe(true);
  });

  it('normalises a page that is negative, zero, fractional or not a number', () => {
    for (const bad of ['-4', '0', 'abc', '', '1.9']) {
      expect(readQuery(`?page=${bad}`, SPEC).values['page']).toBe(1);
    }
    expect(readQuery('?page=7', SPEC).values['page']).toBe(7);
  });

  /*
   * The server refuses an offset past MAX_OFFSET, so a page beyond it cannot be
   * served at all. Clamping here is what turns a pasted `page=999999` into a
   * page that exists rather than an error the reader has to interpret.
   */
  it('clamps a page past the server offset cap', () => {
    const r = readQuery('?page=999999', SPEC);
    expect(r.values['page']).toBe(maxPageFor(50));
    expect(r.needsNormalising).toBe(true);
  });

  it('treats an unreadable optional value as absent, which is its own state', () => {
    expect(readQuery('?llmq=NOT VALID', SPEC).values['llmq']).toBeNull();
    expect(readQuery('', SPEC).values['llmq']).toBeNull();
    expect(readQuery(`?llmq=${LLMQ_ALL}`, SPEC).values['llmq']).toBe(LLMQ_ALL);
  });

  /*
   * This module owns the parameters it is given and nothing else. Stripping the
   * rest would make it the arbiter of the whole query string.
   */
  it('leaves parameters it does not own alone', () => {
    const r = readQuery('?status=failed&ref=ticket-19', SPEC);
    expect(r.canonical).toContain('ref=ticket-19');
    expect(r.needsNormalising).toBe(false);
  });
});

describe('writeQuery', () => {
  it('builds the shortest search that means the state', () => {
    expect(writeQuery('', SPEC, { status: 'failed', page: 2 })).toBe('?status=failed&page=2');
    expect(writeQuery('?status=failed', SPEC, { status: '' })).toBe('');
  });

  it('keeps parameters it was not asked to change', () => {
    expect(writeQuery('?ref=ticket-19', SPEC, { page: 3 })).toBe('?ref=ticket-19&page=3');
  });

  it('removes a parameter set back to absent', () => {
    expect(writeQuery('?llmq=llmq_defcon', SPEC, { llmq: null })).toBe('');
  });
});

describe('page and offset', () => {
  /*
   * One conversion, in one place. Three components doing it themselves is
   * three chances to be off by one, and an off-by-one here silently shows the
   * reader somebody else's page.
   */
  it('maps a 1-based page to the offset the API takes', () => {
    expect(pageToOffset(1, 50)).toBe(0);
    expect(pageToOffset(2, 50)).toBe(50);
    expect(pageToOffset(0, 50)).toBe(0);
    expect(pageToOffset(-3, 50)).toBe(0);
  });

  it('maps back', () => {
    expect(offsetToPage(0, 50)).toBe(1);
    expect(offsetToPage(50, 50)).toBe(2);
    expect(offsetToPage(49, 50)).toBe(1);
  });

  it('knows the last page the server can serve', () => {
    expect(maxPageFor(50)).toBe(2001);
    expect(maxPageFor(25)).toBe(4001);
    expect(maxPageFor(0)).toBe(1);
  });
});

describe('llmqApiName', () => {
  /*
   * "nothing chosen" and "every profile" both mean "do not filter" to the
   * server, and only one of them is a decision somebody made. Collapsing them
   * is what let the page aggregate silently.
   */
  it('sends no filter for the aggregate and for an unchosen profile', () => {
    expect(llmqApiName(LLMQ_ALL)).toBeUndefined();
    expect(llmqApiName(null)).toBeUndefined();
  });

  it('sends the profile that was chosen', () => {
    expect(llmqApiName('llmq_defcon')).toBe('llmq_defcon');
  });
});
