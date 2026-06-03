import type {
  MasterManifest,
  StreamInfo,
  QualityPlaylist,
  Segment,
  QualityLevel,
} from "@streaming/types";

/**
 * HLS M3U8 Manifest Parser
 *
 * Parses two types of manifests:
 * 1. Master manifest: lists available quality streams with bandwidth/resolution
 * 2. Quality playlist: lists individual segment files with durations
 *
 * HLS format is line-based:
 *   #EXTM3U                         → header
 *   #EXT-X-STREAM-INF:BANDWIDTH=... → stream info tag (master)
 *   url.m3u8                         → stream URL
 *   #EXTINF:4.0,                    → segment duration (quality playlist)
 *   segment_000.ts                   → segment URL
 */

/**
 * Parse a master manifest (the top-level .m3u8) into structured data.
 */
export function parseMasterManifest(content: string, baseUrl: string): MasterManifest {
  const lines = content.trim().split("\n");
  const streams: StreamInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      // Parse attributes from the tag
      const attrs = parseAttributes(line.substring("#EXT-X-STREAM-INF:".length));
      const playlistUrl = lines[i + 1]?.trim();

      if (playlistUrl) {
        // Extract quality from the URL path (e.g., "720p/playlist.m3u8" → "720p")
        const quality = playlistUrl.split("/")[0] as QualityLevel;

        streams.push({
          bandwidth: parseInt(attrs["BANDWIDTH"] || "0"),
          resolution: attrs["RESOLUTION"] || "",
          quality,
          playlistUrl: `${baseUrl}/${playlistUrl}`,
        });
        i++; // skip the URL line
      }
    }
  }

  return { streams };
}

/**
 * Parse a quality-specific playlist into segment list.
 */
export function parseQualityPlaylist(
  content: string,
  baseUrl: string,
  quality: QualityLevel
): QualityPlaylist {
  const lines = content.trim().split("\n");
  const segments: Segment[] = [];
  let targetDuration = 4;
  let segmentIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = parseFloat(line.split(":")[1]);
    } else if (line.startsWith("#EXTINF:")) {
      // Duration is between "#EXTINF:" and ","
      const duration = parseFloat(line.substring("#EXTINF:".length).split(",")[0]);
      const segmentFile = lines[i + 1]?.trim();

      if (segmentFile && !segmentFile.startsWith("#")) {
        segments.push({
          index: segmentIndex,
          quality,
          url: `${baseUrl}/${segmentFile}`,
          duration,
        });
        segmentIndex++;
        i++; // skip the filename line
      }
    }
  }

  return { targetDuration, segments };
}

/**
 * Parse HLS attribute string like "BANDWIDTH=400000,RESOLUTION=426x240"
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Simple parser: split by comma, then by "="
  const parts = attrString.split(",");
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex > 0) {
      const key = part.substring(0, eqIndex).trim();
      const value = part.substring(eqIndex + 1).trim().replace(/"/g, "");
      attrs[key] = value;
    }
  }
  return attrs;
}
