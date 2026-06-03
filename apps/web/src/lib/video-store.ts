import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Video, PlaybackEvent } from "@streaming/types";

/**
 * Simple JSON-based video metadata store.
 * In production this would be a database (PostgreSQL, etc.).
 * For this prototype, each video's metadata is stored as a JSON file
 * alongside its segments.
 */

const STORAGE_DIR = join(process.cwd(), "storage", "videos");

export function getAllVideos(): Video[] {
  if (!existsSync(STORAGE_DIR)) return [];

  const dirs = readdirSync(STORAGE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const videos: Video[] = [];
  for (const dir of dirs) {
    const metaPath = join(STORAGE_DIR, dir.name, "metadata.json");
    if (existsSync(metaPath)) {
      const data = JSON.parse(readFileSync(metaPath, "utf-8"));
      videos.push(data);
    }
  }

  return videos.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getVideo(videoId: string): Video | null {
  const metaPath = join(STORAGE_DIR, videoId, "metadata.json");
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, "utf-8"));
}

export function getMasterManifest(videoId: string): string | null {
  const path = join(STORAGE_DIR, videoId, "manifest.m3u8");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function getQualityPlaylist(videoId: string, quality: string): string | null {
  const path = join(STORAGE_DIR, videoId, quality, "playlist.m3u8");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function getSegmentData(
  videoId: string,
  quality: string,
  segmentFile: string
): Buffer | null {
  const path = join(STORAGE_DIR, videoId, quality, segmentFile);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

// ─── Analytics Store ───

const analyticsEvents: PlaybackEvent[] = [];

export function addAnalyticsEvent(event: PlaybackEvent): void {
  analyticsEvents.push(event);
}

export function getAnalyticsEvents(videoId?: string): PlaybackEvent[] {
  if (videoId) {
    return analyticsEvents.filter((e) => e.videoId === videoId);
  }
  return [...analyticsEvents];
}
