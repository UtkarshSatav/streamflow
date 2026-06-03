import {
  type ABRDecision,
  type QualityLevel,
  type Rendition,
  QUALITY_PRESETS,
} from "@streaming/types";

/**
 * Adaptive Bitrate (ABR) Algorithm — Hybrid Buffer + Throughput strategy.
 *
 * Uses both the estimated bandwidth AND current buffer level to make
 * quality decisions. This is more robust than using either signal alone:
 *
 * - Throughput-only: Can overshoot if bandwidth estimate is stale
 * - Buffer-only: Reacts slowly to bandwidth changes
 * - Hybrid: Uses buffer level to modulate aggressiveness of throughput-based selection
 *
 * Buffer zones:
 *   < 5s  → PANIC: switch to lowest quality immediately
 *   < 10s → CONSERVATIVE: use only 50% of estimated bandwidth
 *   < 20s → NORMAL: use 70% of bandwidth (safety margin)
 *   > 20s → AGGRESSIVE: use 90% of bandwidth, try higher quality
 */

const PANIC_THRESHOLD = 5;       // seconds
const CONSERVATIVE_THRESHOLD = 10;
const AGGRESSIVE_THRESHOLD = 20;

const PANIC_FACTOR = 0;          // pick lowest
const CONSERVATIVE_FACTOR = 0.5;
const NORMAL_FACTOR = 0.7;
const AGGRESSIVE_FACTOR = 0.9;

export class ABRController {
  private availableRenditions: Rendition[];
  private currentQuality: QualityLevel;

  constructor(renditions: Rendition[]) {
    // Sort renditions by bitrate ascending
    this.availableRenditions = [...renditions].sort((a, b) => a.bitrate - b.bitrate);
    // Start at the lowest quality for fast startup
    this.currentQuality = this.availableRenditions[0].quality;
  }

  /**
   * Select the best quality given estimated bandwidth and buffer level.
   */
  selectQuality(estimatedBandwidth: number, bufferLevel: number): ABRDecision {
    let factor: number;
    let reason: string;

    if (bufferLevel < PANIC_THRESHOLD) {
      factor = PANIC_FACTOR;
      reason = `PANIC: buffer critically low (${bufferLevel.toFixed(1)}s < ${PANIC_THRESHOLD}s)`;
    } else if (bufferLevel < CONSERVATIVE_THRESHOLD) {
      factor = CONSERVATIVE_FACTOR;
      reason = `CONSERVATIVE: buffer low (${bufferLevel.toFixed(1)}s < ${CONSERVATIVE_THRESHOLD}s), using 50% of bandwidth`;
    } else if (bufferLevel > AGGRESSIVE_THRESHOLD) {
      factor = AGGRESSIVE_FACTOR;
      reason = `AGGRESSIVE: buffer healthy (${bufferLevel.toFixed(1)}s > ${AGGRESSIVE_THRESHOLD}s), using 90% of bandwidth`;
    } else {
      factor = NORMAL_FACTOR;
      reason = `NORMAL: buffer OK (${bufferLevel.toFixed(1)}s), using 70% of bandwidth`;
    }

    const usableBandwidth = estimatedBandwidth * factor;

    // Pick the highest quality whose bitrate fits within usable bandwidth
    let selected = this.availableRenditions[0]; // default to lowest
    for (const rendition of this.availableRenditions) {
      if (rendition.bitrate <= usableBandwidth) {
        selected = rendition;
      } else {
        break; // sorted ascending, no point checking higher
      }
    }

    this.currentQuality = selected.quality;

    return {
      selectedQuality: selected.quality,
      selectedBitrate: selected.bitrate,
      estimatedBandwidth,
      bufferLevel,
      reason,
    };
  }

  getCurrentQuality(): QualityLevel {
    return this.currentQuality;
  }

  getAvailableQualities(): QualityLevel[] {
    return this.availableRenditions.map((r) => r.quality);
  }

  /**
   * Force a specific quality (manual override by user).
   */
  forceQuality(quality: QualityLevel): void {
    this.currentQuality = quality;
  }
}
