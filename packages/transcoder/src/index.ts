import { execSync, exec } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import {
  type QualityLevel,
  type Video,
  type Rendition,
  QUALITY_PRESETS,
  SEGMENT_DURATION,
} from "@streaming/types";

const STORAGE_DIR = join(process.cwd(), "storage", "videos");

export function getStoragePath(videoId: string): string {
  return join(STORAGE_DIR, videoId);
}

export function getSegmentPath(
  videoId: string,
  quality: QualityLevel,
  segmentIndex: number
): string {
  return join(STORAGE_DIR, videoId, quality, `segment_${String(segmentIndex).padStart(3, "0")}.m4s`);
}

export function ensureStorageDir(videoId: string): void {
  const dir = getStoragePath(videoId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the duration of a video file using FFprobe
 */
export function getVideoDuration(inputPath: string): number {
  const result = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${inputPath}"`,
    { encoding: "utf-8" }
  );
  return parseFloat(result.trim());
}

/**
 * Transcode a video into a specific quality level and split into HLS segments.
 */
export function transcodeToQuality(
  inputPath: string,
  videoId: string,
  quality: QualityLevel
): Promise<void> {
  const preset = QUALITY_PRESETS[quality];
  const outputDir = join(getStoragePath(videoId), quality);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const playlistPath = join(outputDir, "playlist.m3u8");
  const segmentPattern = join(outputDir, "segment_%03d.m4s");

  // FFmpeg command: scale, encode at target bitrate, split into fMP4 HLS segments
  // fMP4 is required for MSE (MediaSource Extensions) in browsers — .ts is not supported
  const cmd = [
    "ffmpeg",
    "-i", `"${inputPath}"`,
    "-vf", `scale=${preset.width}:${preset.height}`,
    "-c:v", "libx264",
    "-b:v", `${preset.bitrate}`,
    "-preset", "fast",
    "-c:a", "aac",
    "-b:a", "128k",
    "-f", "hls",
    "-hls_time", `${SEGMENT_DURATION}`,
    "-hls_list_size", "0",
    "-hls_segment_type", "fmp4",                    // fragmented MP4 for MSE compatibility
    "-hls_fmp4_init_filename", "init.mp4",          // initialization segment
    "-hls_segment_filename", `"${segmentPattern}"`,
    "-hls_playlist_type", "vod",
    `"${playlistPath}"`,
    "-y",
  ].join(" ");

  return new Promise((resolve, reject) => {
    exec(cmd, (error, _stdout, stderr) => {
      if (error) {
        console.error(`Transcode error for ${quality}:`, stderr);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Generate the HLS master manifest that references all quality playlists.
 */
export function generateMasterManifest(videoId: string, qualities: QualityLevel[]): string {
  let manifest = "#EXTM3U\n";

  for (const quality of qualities) {
    const preset = QUALITY_PRESETS[quality];
    manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${preset.bitrate},RESOLUTION=${preset.resolution}\n`;
    manifest += `${quality}/playlist.m3u8\n`;
  }

  return manifest;
}

/**
 * Count the number of segments generated for a quality.
 */
export function countSegments(videoId: string, quality: QualityLevel): number {
  const dir = join(getStoragePath(videoId), quality);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".m4s")).length;
}

/**
 * Get the file size of a segment.
 */
export function getSegmentSize(
  videoId: string,
  quality: QualityLevel,
  segmentIndex: number
): number {
  const path = getSegmentPath(videoId, quality, segmentIndex);
  if (!existsSync(path)) return 0;
  return statSync(path).size;
}

/**
 * Full transcoding pipeline: takes a raw video and produces all quality levels.
 * Returns the Video metadata object.
 */
export async function transcodeVideo(
  inputPath: string,
  title: string,
  qualities: QualityLevel[] = ["240p", "480p", "720p", "1080p"]
): Promise<Video> {
  const videoId = uuidv4();
  ensureStorageDir(videoId);

  console.log(`Starting transcode for "${title}" (${videoId})`);

  const duration = getVideoDuration(inputPath);
  console.log(`Video duration: ${duration.toFixed(1)}s`);

  // Transcode each quality level (sequentially to avoid CPU overload)
  for (const quality of qualities) {
    console.log(`  Transcoding ${quality}...`);
    await transcodeToQuality(inputPath, videoId, quality);
    console.log(`  ${quality} done.`);
  }

  // Build rendition metadata
  const renditions: Rendition[] = qualities.map((quality) => ({
    quality,
    resolution: QUALITY_PRESETS[quality].resolution,
    bitrate: QUALITY_PRESETS[quality].bitrate,
    segmentCount: countSegments(videoId, quality),
    segmentDuration: SEGMENT_DURATION,
  }));

  // Write master manifest to disk
  const masterManifest = generateMasterManifest(videoId, qualities);
  const fs = await import("fs");
  fs.writeFileSync(join(getStoragePath(videoId), "manifest.m3u8"), masterManifest);

  const video: Video = {
    id: videoId,
    title,
    duration,
    status: "ready",
    createdAt: new Date().toISOString(),
    renditions,
  };

  // Save metadata as JSON
  fs.writeFileSync(
    join(getStoragePath(videoId), "metadata.json"),
    JSON.stringify(video, null, 2)
  );

  console.log(`Transcode complete: ${videoId}`);
  return video;
}

export { QUALITY_PRESETS, SEGMENT_DURATION };
