import { describe, expect, it } from 'vitest';
import { mapConcurrent } from './concurrency.js';

describe('mapConcurrent', () => {
  it('preserves result order and respects the concurrency cap', async () => {
    let active = 0;
    let peak = 0;

    const result = await mapConcurrent([5, 4, 3, 2, 1], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active--;
      return value * 10;
    });

    expect(result).toEqual([50, 40, 30, 20, 10]);
    expect(peak).toBe(2);
  });

  it('rejects an invalid limit', async () => {
    await expect(mapConcurrent([1], 0, async (value) => value)).rejects.toThrow(
      'concurrency must be a positive integer'
    );
  });

  it('propagates even an undefined thrown value', async () => {
    await expect(
      mapConcurrent([1], 1, async () => {
        throw undefined;
      })
    ).rejects.toBeUndefined();
  });
});
