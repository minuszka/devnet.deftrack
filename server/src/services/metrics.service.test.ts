import { describe, expect, it } from 'vitest';
import { RollingMetric } from './metrics.service.js';

describe('RollingMetric', () => {
  it('reports duration percentiles and lifetime error rate', () => {
    const metric = new RollingMetric();
    for (const duration of [10, 20, 30, 40, 50]) metric.observe(duration, duration === 50);

    expect(metric.snapshot()).toEqual({
      count: 5,
      errors: 1,
      errorRate: 0.2,
      p50Ms: 30,
      p95Ms: 50,
      maxMs: 50,
    });
  });

  it('ignores invalid durations', () => {
    const metric = new RollingMetric();
    metric.observe(Number.NaN, true);
    metric.observe(-1, true);
    expect(metric.snapshot().count).toBe(0);
  });
});
