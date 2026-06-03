import { type BandwidthSample, EWMA_ALPHA } from "@streaming/types";

/**
 * Exponentially Weighted Moving Average (EWMA) bandwidth estimator.
 *
 * Instead of using raw latest measurement (noisy) or simple average (slow to react),
 * EWMA gives more weight to recent samples while smoothing out spikes.
 *
 * Formula: estimate = α × latest + (1 - α) × previous_estimate
 * where α = 0.3 means 30% weight to new sample, 70% to history.
 */
export class BandwidthEstimator {
  private estimate: number = 0;
  private samples: BandwidthSample[] = [];
  private alpha: number;

  constructor(alpha: number = EWMA_ALPHA) {
    this.alpha = alpha;
  }

  /**
   * Record a new bandwidth measurement from a segment download.
   */
  addSample(segmentSizeBytes: number, downloadTimeMs: number): BandwidthSample {
    const bitsPerSecond = (segmentSizeBytes * 8) / (downloadTimeMs / 1000);

    const sample: BandwidthSample = {
      timestamp: Date.now(),
      bitsPerSecond,
      segmentSize: segmentSizeBytes,
      downloadTime: downloadTimeMs,
    };

    this.samples.push(sample);

    // EWMA update
    if (this.estimate === 0) {
      // First sample — use it directly
      this.estimate = bitsPerSecond;
    } else {
      this.estimate = this.alpha * bitsPerSecond + (1 - this.alpha) * this.estimate;
    }

    return sample;
  }

  /**
   * Get the current estimated bandwidth in bits per second.
   */
  getEstimate(): number {
    return this.estimate;
  }

  /**
   * Get all collected samples (for analytics/graphing).
   */
  getSamples(): BandwidthSample[] {
    return [...this.samples];
  }

  /**
   * Reset the estimator (e.g., after a seek).
   */
  reset(): void {
    this.estimate = 0;
    this.samples = [];
  }
}
