import type { BufferSegment, BufferState, QualityLevel } from "@streaming/types";
import { MAX_BUFFER_SECONDS, MIN_BUFFER_BEFORE_PLAY } from "@streaming/types";

/**
 * Buffer Manager — manages the download queue and playback buffer.
 *
 * The buffer is a FIFO queue of downloaded video segments.
 * The manager tracks:
 *   - Which segments are buffered
 *   - Current playback position
 *   - Buffer level (seconds of content ahead of playback)
 *   - Whether the player should wait for buffering
 *
 * Key thresholds:
 *   - MIN_BUFFER_BEFORE_PLAY (4s): minimum buffer before starting playback
 *   - MAX_BUFFER_SECONDS (30s): stop downloading when buffer is full
 */
export class BufferManager {
  private segments: BufferSegment[] = [];
  private currentTime: number = 0;
  private nextSegmentIndex: number = 0;
  private isBuffering: boolean = true;
  private totalDuration: number = 0;

  constructor(totalDuration: number = 0) {
    this.totalDuration = totalDuration;
  }

  /**
   * Add a downloaded segment to the buffer.
   */
  addSegment(segment: BufferSegment): void {
    this.segments.push(segment);
    this.segments.sort((a, b) => a.index - b.index);

    // Check if we have enough buffer to start/resume playback
    if (this.isBuffering && this.getBufferLevel() >= MIN_BUFFER_BEFORE_PLAY) {
      this.isBuffering = false;
    }
  }

  /**
   * Get how many seconds of content are buffered ahead of current playback.
   */
  getBufferLevel(): number {
    let buffered = 0;
    for (const seg of this.segments) {
      const segStart = seg.index * seg.duration;
      const segEnd = segStart + seg.duration;

      if (segEnd > this.currentTime) {
        // This segment is (partially) ahead of playback
        const start = Math.max(segStart, this.currentTime);
        buffered += segEnd - start;
      }
    }
    return buffered;
  }

  /**
   * Update current playback time and evict consumed segments.
   */
  updatePlaybackTime(time: number): void {
    this.currentTime = time;

    // Remove segments that are fully behind playback (already consumed)
    this.segments = this.segments.filter((seg) => {
      const segEnd = seg.index * seg.duration + seg.duration;
      return segEnd > this.currentTime;
    });

    // If buffer drops too low, enter buffering state
    if (this.getBufferLevel() < 1 && this.currentTime < this.totalDuration) {
      this.isBuffering = true;
    }
  }

  /**
   * Should the player download more segments?
   */
  shouldDownloadMore(): boolean {
    return this.getBufferLevel() < MAX_BUFFER_SECONDS;
  }

  /**
   * Get the index of the next segment to download.
   */
  getNextSegmentIndex(): number {
    return this.nextSegmentIndex;
  }

  /**
   * Advance to the next segment index after a download.
   */
  advanceSegmentIndex(): void {
    this.nextSegmentIndex++;
  }

  /**
   * Handle seek: flush buffer and restart from the target position.
   */
  seek(targetTime: number, segmentDuration: number): void {
    this.currentTime = targetTime;
    this.segments = [];
    this.nextSegmentIndex = Math.floor(targetTime / segmentDuration);
    this.isBuffering = true;
  }

  /**
   * Get current buffer state (for UI display).
   */
  getState(): BufferState {
    return {
      segments: [...this.segments],
      currentTime: this.currentTime,
      bufferLevel: this.getBufferLevel(),
      isBuffering: this.isBuffering,
    };
  }

  /**
   * Check if player is in buffering state (should show spinner).
   */
  getIsBuffering(): boolean {
    return this.isBuffering;
  }

  /**
   * Check if we've reached the end of the video.
   */
  isComplete(totalSegments: number): boolean {
    return this.nextSegmentIndex >= totalSegments && this.segments.length === 0;
  }

  /**
   * Reset the buffer (e.g., when switching videos).
   */
  reset(): void {
    this.segments = [];
    this.currentTime = 0;
    this.nextSegmentIndex = 0;
    this.isBuffering = true;
  }
}
