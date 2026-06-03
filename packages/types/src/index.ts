// ─── Video & Rendition ───

export interface Video {
  id: string;
  title: string;
  duration: number; // seconds
  status: "uploading" | "transcoding" | "ready" | "error";
  createdAt: string;
  renditions: Rendition[];
}

export interface Rendition {
  quality: QualityLevel;
  resolution: string; // e.g. "1280x720"
  bitrate: number; // bits per second
  segmentCount: number;
  segmentDuration: number; // seconds
}

export type QualityLevel = "240p" | "480p" | "720p" | "1080p";

// ─── Segment ───

export interface Segment {
  index: number;
  quality: QualityLevel;
  url: string;
  duration: number; // seconds
  byteSize?: number;
}

// ─── Manifest ───

export interface MasterManifest {
  streams: StreamInfo[];
}

export interface StreamInfo {
  bandwidth: number;
  resolution: string;
  quality: QualityLevel;
  playlistUrl: string;
}

export interface QualityPlaylist {
  targetDuration: number;
  segments: Segment[];
}

// ─── ABR ───

export interface ABRDecision {
  selectedQuality: QualityLevel;
  selectedBitrate: number;
  estimatedBandwidth: number;
  bufferLevel: number; // seconds of buffered content
  reason: string;
}

export interface BandwidthSample {
  timestamp: number;
  bitsPerSecond: number;
  segmentSize: number;
  downloadTime: number; // ms
}

// ─── Buffer ───

export interface BufferSegment {
  index: number;
  quality: QualityLevel;
  data: ArrayBuffer;
  duration: number;
  downloadedAt: number;
}

export interface BufferState {
  segments: BufferSegment[];
  currentTime: number;
  bufferLevel: number; // seconds ahead of playback
  isBuffering: boolean;
}

// ─── Analytics ───

export interface PlaybackEvent {
  type: "start" | "rebuffer" | "bitrate_switch" | "seek" | "pause" | "resume" | "end";
  timestamp: number;
  videoId: string;
  sessionId: string;
  data: {
    bufferLevel?: number;
    bitrate?: number;
    bandwidth?: number;
    fromQuality?: QualityLevel;
    toQuality?: QualityLevel;
    seekFrom?: number;
    seekTo?: number;
    startupLatency?: number;
  };
}

export interface PlaybackMetrics {
  sessionId: string;
  videoId: string;
  startupLatency: number;
  rebufferCount: number;
  totalRebufferDuration: number;
  averageBitrate: number;
  bitrateSwitchCount: number;
  events: PlaybackEvent[];
}

// ─── CDN Cache ───

export interface CacheEntry {
  data: Buffer | ArrayBuffer;
  size: number;
  lastAccessed: number;
  hits: number;
}

export interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  currentSize: number;
  maxSize: number;
}

// ─── Encoding Config ───

export const QUALITY_PRESETS: Record<
  QualityLevel,
  { resolution: string; bitrate: number; width: number; height: number }
> = {
  "240p": { resolution: "426x240", bitrate: 400_000, width: 426, height: 240 },
  "480p": { resolution: "854x480", bitrate: 1_000_000, width: 854, height: 480 },
  "720p": { resolution: "1280x720", bitrate: 2_500_000, width: 1280, height: 720 },
  "1080p": { resolution: "1920x1080", bitrate: 5_000_000, width: 1920, height: 1080 },
};

export const SEGMENT_DURATION = 4; // seconds
export const MAX_BUFFER_SECONDS = 30;
export const MIN_BUFFER_BEFORE_PLAY = 4; // seconds (1 segment)
export const EWMA_ALPHA = 0.3;
