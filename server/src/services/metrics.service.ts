import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const SAMPLE_CAPACITY = 512;

export interface MetricSnapshot {
  count: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

/** A bounded rolling duration sample plus lifetime counters. */
export class RollingMetric {
  private readonly samples: number[] = [];
  private cursor = 0;
  private total = 0;
  private failed = 0;

  observe(durationMs: number, error = false): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    if (this.samples.length < SAMPLE_CAPACITY) this.samples.push(durationMs);
    else {
      this.samples[this.cursor] = durationMs;
      this.cursor = (this.cursor + 1) % SAMPLE_CAPACITY;
    }
    this.total++;
    if (error) this.failed++;
  }

  snapshot(): MetricSnapshot {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (p: number): number | null =>
      sorted.length === 0
        ? null
        : Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]! * 100) /
          100;

    return {
      count: this.total,
      errors: this.failed,
      errorRate: this.total > 0 ? this.failed / this.total : 0,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: sorted.length > 0 ? Math.round(sorted.at(-1)! * 100) / 100 : null,
    };
  }
}

export class MetricsService {
  private readonly rpcAll = new RollingMetric();
  private readonly rpcMethods = new Map<string, RollingMetric>();
  private readonly mongoAll = new RollingMetric();
  private readonly mongoCommands = new Map<string, RollingMetric>();
  private readonly syncThroughput = new RollingMetric();
  private readonly eventLoop: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  private eventLoopStarted = false;

  private syncPasses = 0;
  private indexedBlocks = 0;
  private lastSyncDurationMs: number | null = null;
  private lastSyncBlocks = 0;
  private chainTip = -1;
  private indexedHeight = -1;

  private chainLocksFromZmq = 0;
  private chainLocksReconciled = 0;
  private chainLocksFromFallbackPoll = 0;

  start(): void {
    if (this.eventLoopStarted) return;
    this.eventLoop.enable();
    this.eventLoopStarted = true;
  }

  stop(): void {
    if (!this.eventLoopStarted) return;
    this.eventLoop.disable();
    this.eventLoopStarted = false;
  }

  observeRpc(method: string, durationMs: number, error: boolean): void {
    this.rpcAll.observe(durationMs, error);
    this.metricFor(this.rpcMethods, method).observe(durationMs, error);
  }

  observeMongo(command: string, durationMs: number, error: boolean): void {
    this.mongoAll.observe(durationMs, error);
    this.metricFor(this.mongoCommands, command).observe(durationMs, error);
  }

  observeSync(blocks: number, durationMs: number, tip: number, indexedHeight: number): void {
    this.syncPasses++;
    this.indexedBlocks += blocks;
    this.lastSyncBlocks = blocks;
    this.lastSyncDurationMs = durationMs;
    this.setSyncPosition(tip, indexedHeight);
    if (blocks > 0 && durationMs > 0) this.syncThroughput.observe((blocks * 1000) / durationMs);
  }

  setSyncPosition(tip: number, indexedHeight: number): void {
    this.chainTip = tip;
    this.indexedHeight = indexedHeight;
  }

  observeChainLocks(source: 'zmq' | 'poll', count: number, zmqEnabled: boolean): void {
    if (count <= 0) return;
    if (source === 'zmq') this.chainLocksFromZmq += count;
    else if (zmqEnabled) this.chainLocksReconciled += count;
    else this.chainLocksFromFallbackPoll += count;
  }

  snapshot(zmq: { enabled: boolean; connected: boolean; received: number; missed: number }) {
    const memory = process.memoryUsage();
    const throughput = this.syncThroughput.snapshot();
    const nsToMs = (value: number): number | null =>
      Number.isFinite(value) ? Math.round((value / 1_000_000) * 100) / 100 : null;
    const byName = (metrics: Map<string, RollingMetric>): Record<string, MetricSnapshot> =>
      Object.fromEntries([...metrics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.snapshot()]));

    return {
      sampledDurations: SAMPLE_CAPACITY,
      rpc: { all: this.rpcAll.snapshot(), byMethod: byName(this.rpcMethods) },
      mongo: { all: this.mongoAll.snapshot(), byCommand: byName(this.mongoCommands) },
      sync: {
        passes: this.syncPasses,
        blocksIndexed: this.indexedBlocks,
        lastPassBlocks: this.lastSyncBlocks,
        lastPassDurationMs: this.lastSyncDurationMs,
        blocksPerSecond: {
          samples: throughput.count,
          p50: throughput.p50Ms,
          p95: throughput.p95Ms,
          max: throughput.maxMs,
        },
        chainTip: this.chainTip,
        indexedHeight: this.indexedHeight,
        behind: this.chainTip >= 0 ? Math.max(0, this.chainTip - this.indexedHeight) : -1,
      },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryBytes: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
        },
        eventLoopLagMs: {
          p50: this.eventLoopStarted ? nsToMs(this.eventLoop.percentile(50)) : null,
          p95: this.eventLoopStarted ? nsToMs(this.eventLoop.percentile(95)) : null,
          max: this.eventLoopStarted ? nsToMs(this.eventLoop.max) : null,
        },
      },
      observation: {
        zmq,
        chainLocks: {
          appliedFromZmq: this.chainLocksFromZmq,
          reconciledByPoll: this.chainLocksReconciled,
          foundByFallbackPoll: this.chainLocksFromFallbackPoll,
        },
      },
    };
  }

  private metricFor(map: Map<string, RollingMetric>, name: string): RollingMetric {
    let metric = map.get(name);
    if (!metric) {
      metric = new RollingMetric();
      map.set(name, metric);
    }
    return metric;
  }
}

export const metricsService = new MetricsService();
