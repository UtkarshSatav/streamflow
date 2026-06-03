import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { Video, PlaybackEvent } from "@streaming/types";

/**
 * Video metadata store with two sources:
 * 1. storage/videos/ — locally uploaded & transcoded videos (local dev)
 * 2. public/videos/  — pre-transcoded demo videos (works on Vercel)
 */

const STORAGE_DIR = join(process.cwd(), "storage", "videos");
const PUBLIC_DIR = join(process.cwd(), "public", "videos");

/** Try to find a file in storage first, then public (demo) */
function resolveFile(videoId: string, ...parts: string[]): string | null {
  const storagePath = join(STORAGE_DIR, videoId, ...parts);
  if (existsSync(storagePath)) return storagePath;

  const publicPath = join(PUBLIC_DIR, videoId, ...parts);
  if (existsSync(publicPath)) return publicPath;

  return null;
}

export function getAllVideos(): Video[] {
  const videos: Video[] = [];
  const seen = new Set<string>();

  // Scan both directories
  for (const dir of [STORAGE_DIR, PUBLIC_DIR]) {
    if (!existsSync(dir)) continue;

    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const entry of entries) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);

      const metaPath = join(dir, entry.name, "metadata.json");
      if (existsSync(metaPath)) {
        const data = JSON.parse(readFileSync(metaPath, "utf-8"));
        videos.push(data);
      }
    }
  }

  return videos.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getVideo(videoId: string): Video | null {
  const path = resolveFile(videoId, "metadata.json");
  if (!path) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function getMasterManifest(videoId: string): string | null {
  const path = resolveFile(videoId, "manifest.m3u8");
  if (!path) return null;
  return readFileSync(path, "utf-8");
}

export function getQualityPlaylist(videoId: string, quality: string): string | null {
  const path = resolveFile(videoId, quality, "playlist.m3u8");
  if (!path) return null;
  return readFileSync(path, "utf-8");
}

export function getSegmentData(
  videoId: string,
  quality: string,
  segmentFile: string
): Buffer | null {
  const path = resolveFile(videoId, quality, segmentFile);
  if (!path) return null;
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
