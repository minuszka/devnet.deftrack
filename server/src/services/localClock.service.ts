import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const run = promisify(execFile);
const REFRESH_MS = 5 * 60_000;

/**
 * This host's own NTP offset, so the seed can take part in the propagation
 * comparison on the same terms as the fleet agents.
 *
 * Null when it cannot be read. Null is not zero: an unknown clock widens the
 * error bar of every comparison it joins rather than quietly asserting that
 * this machine is the accurate one.
 */
class LocalClockService {
  private offsetMs: number | null = null;
  private checkedAt = 0;

  async current(): Promise<number | null> {
    if (Date.now() - this.checkedAt < REFRESH_MS) return this.offsetMs;
    this.checkedAt = Date.now();
    this.offsetMs = await this.read();
    return this.offsetMs;
  }

  private async read(): Promise<number | null> {
    try {
      const { stdout } = await run('timedatectl', ['timesync-status'], { timeout: 5_000 });
      const match = stdout.match(/Offset:\s*([+-]?[\d.]+)(us|ms|s)\b/);
      if (match) {
        const value = Number.parseFloat(match[1]!);
        const scale = match[2] === 'us' ? 0.001 : match[2] === 's' ? 1000 : 1;
        return value * scale;
      }
    } catch (error) {
      logger.debug?.(`clock offset unavailable: ${error instanceof Error ? error.message : error}`);
    }
    return null;
  }
}

export const localClockService = new LocalClockService();
