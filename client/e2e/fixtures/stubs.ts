import type { ExperimentRow } from '@devnet-deftrack/shared';
import { ok, type ApiStubs } from '../harness.js';
import {
  chainLockReport,
  healthSnapshot,
  healthTimeline,
  masternodeTimelinePoint,
  pageOf,
  roundRun,
} from './api.js';

/**
 * Every endpoint the public overview asks for, answered healthily.
 *
 * A test that wants one of them to fail replaces that single entry; the rest
 * stay honest, so the assertion is about the endpoint under test rather than
 * about a page with nothing in it.
 */
export function overviewStubs(): ApiStubs {
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/quorum-rounds/health-timeline': { body: ok(healthTimeline()) },
    '/api/v1/quorum-rounds': { body: ok(pageOf(roundRun(5))) },
    '/api/v1/masternodes/timeline': {
      body: ok({ hours: 1, points: [masternodeTimelinePoint()] }),
    },
    '/api/v1/experiments': { body: ok(pageOf<ExperimentRow>([])) },
  };
}
