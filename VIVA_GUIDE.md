# Streaming System Design — Complete Viva Guide

## 1. What is Adaptive Bitrate Streaming (ABR)?

ABR is a technique where the video player **dynamically switches between different quality levels** during playback based on the viewer's current network conditions.

**Without ABR:** You pick 720p, and if your network drops, the video stalls and buffers endlessly.

**With ABR:** The player detects the drop, seamlessly switches to 480p or 240p, and playback continues without interruption. When bandwidth recovers, it switches back up.

**Key insight for viva:** ABR is a **client-side decision**. The server doesn't decide quality — it just serves whatever the player asks for. The intelligence is in the player.

---

## 2. HLS vs MPEG-DASH

| Aspect | HLS (HTTP Live Streaming) | MPEG-DASH |
|--------|--------------------------|-----------|
| Created by | Apple | MPEG consortium (open standard) |
| Manifest file | `.m3u8` (playlist) | `.mpd` (Media Presentation Description) |
| Segment format | `.ts` or `.m4s` (fMP4) | `.m4s` (fMP4) |
| Browser support | Safari native, others via hls.js | All browsers via dash.js |
| DRM | FairPlay | Widevine, PlayReady |
| Used by | Apple, Twitch, most platforms | YouTube, Netflix |

**What to say in viva:** "We chose HLS because it's the most widely deployed protocol. Modern HLS uses fMP4 segments (fragmented MP4) which are compatible with the browser's MediaSource Extensions API, enabling client-side playback control."

**Why not regular MP4?** A regular MP4 requires downloading the entire file (or at least the `moov` atom) before playback. HLS/DASH split the video into small independent segments that can be fetched individually.

---

## 3. Chunking — How and Why

### What is chunking?
The video is divided into small **segments** (typically 2-10 seconds each). Each segment is an independent, playable file.

### How it works in our system:
```
Original Video (8 minutes)
    |  FFmpeg transcoding
    |-- 240p/
    |   |-- init.mp4         <- codec initialization data
    |   |-- segment_000.m4s  <- seconds 0-4
    |   |-- segment_001.m4s  <- seconds 4-8
    |   |-- ...
    |-- 480p/
    |   |-- init.mp4
    |   |-- segment_000.m4s
    |   |-- ...
    |-- 720p/
        |-- init.mp4
        |-- segment_000.m4s
        |-- ...
```

### Why 4-second segments?

| Segment Duration | Pros | Cons |
|-----------------|------|------|
| 2 seconds | Fast quality switching, low latency | More HTTP requests, higher overhead |
| 4 seconds | Good balance of adaptability and efficiency | — |
| 10 seconds | Fewer requests, better compression | Slow to adapt, high latency |

**Viva answer:** "We use 4-second segments as a trade-off. Shorter segments allow faster ABR adaptation but increase HTTP request overhead. Longer segments are more efficient but make the player slow to react to network changes. 4 seconds is the industry standard used by most streaming platforms."

### Why fMP4 over .ts?
- `.ts` (MPEG Transport Stream): Legacy format, not supported in browser MSE API
- `.m4s` (Fragmented MP4): Modern format, works with MediaSource Extensions in all browsers
- fMP4 also has better compression efficiency (~15% smaller files)

---

## 4. Manifest Files — The Playlist System

### Master Manifest (manifest.m3u8)
Lists all available quality levels:
```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240
240p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/playlist.m3u8
```

The player reads this and knows: "I have 3 quality options. Let me pick one based on my bandwidth."

### Quality Playlist (240p/playlist.m3u8)
Lists individual segments for that quality:
```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4"      <- initialization segment
#EXTINF:4.000000,
segment_000.m4s
#EXTINF:4.000000,
segment_001.m4s
...
#EXT-X-ENDLIST
```

**Viva question: "What is the init segment?"**
Answer: "The `init.mp4` contains codec initialization data (SPS/PPS for H.264, audio config for AAC). It must be loaded into the browser's SourceBuffer before any media segments. When switching quality, we load the new quality's init segment first, then continue with media segments."

---

## 5. The Transcoding Pipeline

### Multi-Bitrate Encoding (Bitrate Ladder)

| Quality | Resolution | Video Bitrate | Audio | Total ~Size/min |
|---------|-----------|---------------|-------|----------------|
| 240p | 426x240 | 400 kbps | 128 kbps | ~4 MB |
| 480p | 854x480 | 1000 kbps | 128 kbps | ~8.5 MB |
| 720p | 1280x720 | 2500 kbps | 128 kbps | ~20 MB |
| 1080p | 1920x1080 | 5000 kbps | 128 kbps | ~38 MB |

### FFmpeg command explained:
```bash
ffmpeg -i input.mp4 \
  -vf scale=1280:720 \        # resize to 720p
  -c:v libx264 \              # H.264 video codec
  -b:v 2500k \                # target video bitrate
  -preset fast \              # encoding speed vs compression tradeoff
  -c:a aac \                  # AAC audio codec
  -b:a 128k \                 # audio bitrate
  -f hls \                    # output format: HLS
  -hls_time 4 \               # segment duration: 4 seconds
  -hls_segment_type fmp4 \    # fragmented MP4 segments
  -hls_fmp4_init_filename init.mp4 \
  -hls_playlist_type vod \    # Video On Demand (not live)
  playlist.m3u8
```

**Viva question: "Why store multiple copies? Isn't that wasteful?"**
Answer: "Yes, storage cost increases ~3-4x, but this is a deliberate trade-off. Pre-computing all quality levels means zero transcoding at playback time, which is critical for low startup latency. Storage is cheap (~$0.023/GB on S3), but user experience from buffering is expensive (users leave after 2 seconds of buffering)."

---

## 6. Adaptive Bitrate Algorithm (The Brain)

### Our Hybrid Buffer + Throughput Algorithm:

```
+--------------------------------------------------+
|              ABR Decision Engine                  |
|                                                   |
|  Inputs:                                          |
|    1. Estimated Bandwidth (EWMA)                  |
|    2. Current Buffer Level (seconds)              |
|                                                   |
|  Buffer Zones:                                    |
|    < 5s  -> PANIC      (use 0% of bandwidth)     |
|    < 10s -> CONSERVATIVE (use 50% of bandwidth)  |
|    < 20s -> NORMAL     (use 70% of bandwidth)    |
|    > 20s -> AGGRESSIVE (use 90% of bandwidth)    |
|                                                   |
|  Output: Selected quality level                   |
+--------------------------------------------------+
```

### Why the safety margin (70% rule)?
If your estimated bandwidth is 2.5 Mbps and you pick a 2.5 Mbps bitrate stream, **any small fluctuation causes a stall**. The 70% factor means we pick a bitrate that uses only 70% of available bandwidth, leaving headroom for variation.

### Three ABR approaches (know all three for viva):

**1. Throughput-based (rate-based):**
- Pick highest bitrate <= measured throughput
- Pro: Simple, reacts quickly
- Con: Throughput measurements are noisy, causes oscillation

**2. Buffer-based (BBA - Buffer Based Algorithm):**
- Decisions based purely on buffer level
- Low buffer -> low quality, high buffer -> high quality
- Pro: Stable, fewer switches
- Con: Slow to react to bandwidth changes

**3. Hybrid (what we use):**
- Combines both signals
- Buffer level determines how aggressively to use throughput estimate
- Pro: Best of both worlds — stable AND reactive
- Con: More complex to tune

**Viva question: "Why not just always pick the highest quality?"**
Answer: "Because if the user's bandwidth can't sustain that bitrate, the download takes longer than the segment duration. The buffer drains faster than it fills, eventually causing a rebuffering stall. ABR prevents this by matching quality to available bandwidth."

---

## 7. Bandwidth Estimation — EWMA

### Problem:
Raw bandwidth measurements are **noisy**. One segment might download fast (cache hit), the next slow (network congestion). Using raw values causes quality oscillation.

### Solution: Exponentially Weighted Moving Average

```
estimate = alpha x latest_sample + (1 - alpha) x previous_estimate
```

Where **alpha = 0.3** means:
- 30% weight to the newest measurement
- 70% weight to historical average

### Example:
```
Sample 1: 5.0 Mbps -> estimate = 5.0 (first sample, use directly)
Sample 2: 2.0 Mbps -> estimate = 0.3 x 2.0 + 0.7 x 5.0 = 4.1 Mbps
Sample 3: 8.0 Mbps -> estimate = 0.3 x 8.0 + 0.7 x 4.1 = 5.27 Mbps
Sample 4: 1.0 Mbps -> estimate = 0.3 x 1.0 + 0.7 x 5.27 = 3.99 Mbps
```

Notice how a single bad sample (1.0 Mbps) doesn't crash the estimate — it drops gradually. This **smoothing** prevents quality oscillation.

**Viva question: "Why alpha = 0.3 and not 0.5 or 0.9?"**
Answer: "alpha controls reactivity vs stability. Higher alpha (0.9) reacts fast but oscillates. Lower alpha (0.1) is stable but slow to adapt. 0.3 is a balance — reactive enough to handle real network changes but smooth enough to ignore transient spikes."

---

## 8. Buffer Management

### Buffer as a FIFO Queue:
```
                    +------------------------------+
Download side ->    | seg7 | seg6 | seg5 | seg4 |   -> Playback side
                    +------------------------------+
                              Buffer (queue)

Current playback: seg3 (already consumed & removed)
Buffer level: 4 segments x 4s = 16 seconds ahead
```

### Key thresholds:
| Threshold | Value | Purpose |
|-----------|-------|---------|
| MIN_BUFFER_BEFORE_PLAY | 4s | Don't start playback until we have at least 1 segment buffered |
| MAX_BUFFER | 30s | Stop downloading when buffer is full (save bandwidth) |
| Rebuffer trigger | < 1s | Show buffering spinner, count as rebuffer event |

### Buffer lifecycle:
```
1. Page loads -> buffer empty -> isBuffering = true
2. Download segments -> buffer fills
3. Buffer reaches 4s -> START PLAYBACK -> isBuffering = false
4. Playback consumes segments, downloads add new ones
5. If consumption > download speed -> buffer drains -> quality drops
6. If buffer hits 0 -> REBUFFER EVENT -> show spinner
7. Buffer refills -> resume playback
```

**Viva question: "Why not buffer the entire video?"**
Answer: "Three reasons: (1) Memory — a 2-hour 1080p movie is ~28GB, can't store that in RAM. (2) Waste — if user seeks or stops watching, buffered data is thrown away. (3) Bandwidth — downloading content the user may never watch wastes server resources. 30 seconds is enough to survive most network fluctuations."

---

## 9. CDN (Content Delivery Network)

### What is a CDN?
A network of **edge servers** distributed globally that cache content close to users.

### How it works:
```
User in Mumbai                    User in New York
     |                                  |
Mumbai Edge Server              New York Edge Server
     | (cache miss)                    | (cache hit!)
     |                           Serve from cache (5ms)
Origin Server (US-East)
     |
Object Storage (S3)
```

### Our CDN simulation — LRU Cache:
```
Request for segment -> Check cache
  |-- HIT  -> Return cached data (fast, ~5ms)
  |         -> Set X-Cache: HIT header
  +-- MISS -> Fetch from origin storage (slow, ~200ms)
           -> Store in cache for next time
           -> Set X-Cache: MISS header
           -> If cache full -> Evict Least Recently Used entry
```

### Why LRU (Least Recently Used)?
Popular content (trending videos) stays cached because it's frequently accessed. Old/unpopular content gets evicted naturally. This matches real viewing patterns — a small percentage of videos get the majority of views (Zipf distribution).

**Viva question: "How do real CDNs like CloudFront work?"**
Answer: "CloudFront has 400+ edge locations worldwide. When a user requests a segment, DNS routes them to the nearest edge. If the edge has it cached, it's served in <10ms. If not, the edge fetches from the origin, caches it, and serves it. Popular content gets cached across most edges quickly. CDNs also handle TLS termination, DDoS protection, and HTTP/2 multiplexing."

---

## 10. MediaSource Extensions (MSE)

### What is MSE?
A browser API that lets JavaScript **feed video data directly** to the `<video>` element, instead of giving it a URL.

### Why do we need it?
Without MSE, you'd set `video.src = "video.mp4"` and the browser handles everything. You'd have **zero control** over buffering, quality switching, or ABR.

With MSE:
```javascript
// 1. Create a MediaSource
const ms = new MediaSource();
video.src = URL.createObjectURL(ms);

// 2. When it's ready, create a SourceBuffer with the codec
const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');

// 3. Feed it data manually
const response = await fetch("/segment_000.m4s");
const data = await response.arrayBuffer();
sb.appendBuffer(data);  // <- video starts playing!
```

**Viva question: "Why fMP4 and not .ts for MSE?"**
Answer: "Browser MSE implementations only support ISO BMFF (MP4) container format. MPEG-TS (.ts) is not supported in Chrome/Firefox MSE — only Safari supports it natively via its built-in HLS player. That's why modern HLS uses fMP4 segments."

---

## 11. Architecture Diagram (Draw This in Viva)

```
+--------------------------------------------------------------+
|                        CLIENT SIDE                            |
|  +--------------------------------------------------------+  |
|  |                   Video Player                          |  |
|  |  +-------------+  +-----------+  +----------------+    |  |
|  |  |  Manifest   |  |    ABR    |  |   Bandwidth    |    |  |
|  |  |   Parser    |->| Algorithm |<-|   Estimator    |    |  |
|  |  +-------------+  +-----+-----+  +----------------+    |  |
|  |                         |                               |  |
|  |                   +-----v-----+                         |  |
|  |                   |  Buffer   |                         |  |
|  |                   |  Manager  |                         |  |
|  |                   +-----+-----+                         |  |
|  |                         |                               |  |
|  |                   +-----v-----+                         |  |
|  |                   |  <video>  | (via MSE)               |  |
|  |                   |  element  |                         |  |
|  |                   +-----------+                         |  |
|  +--------------------------------------------------------+  |
+----------------------------+----------------------------------+
                             | HTTP requests
                             v
+--------------------------------------------------------------+
|                      CDN EDGE CACHE                           |
|              (LRU Cache - serves cached segments)             |
+----------------------------+----------------------------------+
                             | cache miss
                             v
+--------------------------------------------------------------+
|                      ORIGIN SERVER                            |
|  +----------+  +--------------+  +--------------------+      |
|  | API      |  |  Transcoding |  |  Manifest          |      |
|  | Routes   |  |  Service     |  |  Generator         |      |
|  +----+-----+  +------+-------+  +--------------------+      |
|       |               |                                       |
|       v               v                                       |
|  +-----------------------------+                              |
|  |    Segment Storage          |                              |
|  |    (Object Storage / Disk)  |                              |
|  +-----------------------------+                              |
+--------------------------------------------------------------+
```

---

## 12. Sequence Flow (Draw This in Viva)

```
Client                CDN              Origin           Storage
  |                    |                 |                 |
  |-- GET manifest --> |                 |                 |
  |                    |-- cache miss -->|                 |
  |                    |                 |-- read -------->|
  |                    |                 |<-- manifest ----|
  |                    |<-- manifest ----|                 |
  |<-- manifest -------|                 |                 |
  |                    |                 |                 |
  | [Parse manifest,   |                 |                 |
  |  select 240p]      |                 |                 |
  |                    |                 |                 |
  |-- GET init.mp4 --> |-- miss -------->|-- read -------->|
  |<-- init.mp4 -------|<----------------|<----------------|
  |                    |                 |                 |
  |-- GET seg_000 ---> |-- miss -------->|-- read -------->|
  |<-- seg_000 --------|<----------------|<----------------|
  |                    |                 |                 |
  | [Measure: 400KB    |                 |                 |
  |  in 50ms = 64Mbps] |                 |                 |
  | [Buffer: 4s ]      |                 |                 |
  | [START PLAYBACK]   |                 |                 |
  |                    |                 |                 |
  |-- GET seg_001 ---> |-- HIT! -------->|                 |
  |<-- seg_001 --------|  (from cache)   |                 |
  |                    |                 |                 |
  | [ABR: bandwidth    |                 |                 |
  |  high, buffer OK   |                 |                 |
  |  -> switch to 720p]|                 |                 |
  |                    |                 |                 |
  |-- GET 720p/init -->|                 |                 |
  |-- GET 720p/seg2 -->|                 |                 |
```

---

## 13. API Design

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/api/upload` | POST | Upload raw video, triggers transcoding | `{ video: Video }` |
| `/api/videos` | GET | List all available videos | `{ videos: Video[] }` |
| `/api/videos/{id}/manifest` | GET | Master M3U8 playlist | `application/vnd.apple.mpegurl` |
| `/api/videos/{id}/{quality}/playlist` | GET | Quality-specific playlist | `application/vnd.apple.mpegurl` |
| `/api/videos/{id}/{quality}/{segment}` | GET | Single video segment | `video/mp4` binary |
| `/api/analytics` | POST | Log playback events | `{ ok: true }` |

**Viva question: "Why separate master and quality playlists?"**
Answer: "Separation of concerns. The master manifest is fetched once at startup to discover available qualities. Quality playlists are fetched per-quality and contain the actual segment URLs. This two-level hierarchy lets the player switch qualities without re-fetching the master manifest."

---

## 14. Database Design

```
+-------------------------------------+
|          videos                      |
+-------------------------------------+
| video_id     UUID (PK)              |
| title        VARCHAR(255)           |
| duration     FLOAT (seconds)        |
| status       ENUM (uploading,       |
|              transcoding, ready)    |
| created_at   TIMESTAMP              |
+----------------+--------------------+
                 | 1:N
                 v
+-------------------------------------+
|          renditions                  |
+-------------------------------------+
| rendition_id  UUID (PK)             |
| video_id      UUID (FK)             |
| quality       ENUM (240p,480p,...)  |
| resolution    VARCHAR (1280x720)    |
| bitrate       INT (bps)             |
| segment_count INT                   |
| segment_dur   FLOAT (seconds)       |
+-------------------------------------+

+-------------------------------------+
|       playback_events               |
+-------------------------------------+
| event_id     UUID (PK)              |
| video_id     UUID (FK)              |
| session_id   UUID                   |
| event_type   ENUM (start, rebuffer, |
|              bitrate_switch, seek)  |
| timestamp    TIMESTAMP              |
| buffer_level FLOAT                  |
| bitrate      INT                    |
| bandwidth    FLOAT                  |
+-------------------------------------+
```

---

## 15. Scalability Considerations

| Challenge | Solution | How it helps |
|-----------|----------|-------------|
| Millions of viewers | CDN edge caching | Content served from 400+ locations, not one origin |
| Popular video spike | Cache warming | Pre-push popular content to edges before launch |
| Storage cost | Bitrate ladder optimization | Only encode qualities that users actually watch |
| Transcode time | Parallel encoding | Each quality level transcoded on a separate worker |
| Global latency | Geo-routing | DNS routes users to nearest edge server |
| Origin overload | Cache-Control headers | `max-age=31536000` — segments never change, cache forever |

**Viva question: "How does Netflix handle 200 million users?"**
Answer: "Netflix uses Open Connect — their own CDN with servers placed inside ISP networks. During off-peak hours, they pre-populate these servers with content. During peak hours, 95% of traffic is served from within the user's ISP network, never touching the internet backbone."

---

## 16. Key Trade-offs (Expect These in Viva)

### Trade-off 1: Buffer Size vs Startup Latency
```
Large buffer (60s) -> Need to download 60s before playing -> Slow start
Small buffer (2s)  -> Start fast but vulnerable to network dips
Our choice: 4s minimum -> Start in <2s, then build up to 30s
```

### Trade-off 2: Segment Duration vs Adaptability
```
Short (2s) -> Can switch quality every 2s, but more HTTP overhead
Long (10s) -> Fewer requests, but stuck at wrong quality for 10s
Our choice: 4s -> Switch quality every 4 seconds
```

### Trade-off 3: Quality vs Bandwidth
```
Always highest quality -> Stalls on slow networks, wastes data
Always lowest quality  -> Bad user experience
Our choice: ABR dynamically optimizes this
```

### Trade-off 4: Storage Cost vs User Experience
```
More quality levels -> More storage (~4x for 4 qualities)
Fewer quality levels -> Bigger jumps between qualities (jarring)
Our choice: 3-4 levels (240p, 480p, 720p, 1080p)
```

### Trade-off 5: CDN Cache Size vs Hit Rate
```
Large cache -> Higher hit rate, more memory cost
Small cache -> More cache misses, more origin load
Our choice: LRU eviction — popular content stays, rare content evicts
```

---

## 17. Likely Viva Questions & Answers

**Q: "What happens when a user seeks to a different position?"**
A: The buffer is flushed (old segments are useless), the player calculates which segment index corresponds to the target time (`index = floor(seekTime / segmentDuration)`), loads the init segment if needed, and starts downloading from that segment. Playback resumes once minimum buffer is reached.

**Q: "How is this different from just downloading an MP4?"**
A: Progressive download (MP4) sends one file at one quality. You can't adapt quality mid-stream. You must download sequentially — can't efficiently seek. ABR streaming splits into independent segments at multiple qualities, enabling dynamic quality switching, efficient seeking, and CDN caching of individual segments.

**Q: "What codec do you use and why?"**
A: H.264 (AVC) for video — it has universal browser support. AAC for audio — efficient and widely supported. In production, newer codecs like H.265 (HEVC) or AV1 offer 30-50% better compression but have limited browser support.

**Q: "What if the bandwidth estimate is wrong?"**
A: That's why we use EWMA (smoothing) and the safety margin (70% rule). Even if the estimate is slightly off, we have buffer to absorb the error. The hybrid ABR also uses buffer level as a secondary signal — if the estimate was wrong and buffer is draining, the buffer-based component will force a quality drop regardless.

**Q: "How would you handle live streaming vs VOD?"**
A: For live: segments are generated in real-time, the playlist is **sliding window** (not `#EXT-X-ENDLIST`), latency targets are much lower (3-5s), and the player always plays near the live edge. For VOD: all segments are pre-generated, playlist is complete, and the player has more buffering freedom.

**Q: "How do you measure Quality of Experience (QoE)?"**
A: Four key metrics: (1) Startup latency — time to first frame, target <2s. (2) Rebuffer ratio — total rebuffering time / total watch time, target <1%. (3) Average bitrate — higher is better. (4) Bitrate switch frequency — fewer switches = smoother experience. Our analytics service tracks all four.

---

## 18. Quick Glossary (For Last-Minute Revision)

| Term | One-Line Definition |
|------|-------------------|
| **HLS** | Apple's HTTP Live Streaming protocol using .m3u8 playlists |
| **DASH** | Open standard for adaptive streaming using .mpd manifests |
| **ABR** | Algorithm that picks video quality based on network conditions |
| **fMP4** | Fragmented MP4 — segments that can be independently decoded |
| **MSE** | Browser API to manually feed video data to `<video>` element |
| **EWMA** | Smoothing algorithm for bandwidth estimation |
| **CDN** | Network of edge servers caching content near users |
| **Bitrate ladder** | Set of quality levels a video is encoded at |
| **Init segment** | Contains codec setup data, must load before media segments |
| **Manifest** | Playlist file listing available qualities and segment URLs |
| **Rebuffer** | Playback stall when buffer empties — worst UX metric |
| **VOD** | Video On Demand — pre-recorded, fully available |
| **Transcoding** | Converting video to different quality/format/codec |
| **LRU** | Cache eviction strategy — remove least recently used items |

---

## 19. Our Solution — What We Built (StreamFlow)

### Project: StreamFlow — Adaptive Bitrate Streaming Platform

A fully working **Turborepo monorepo** with Next.js that demonstrates every concept from the problem statement with real, runnable code.

### Tech Stack
| Component | Technology | Why |
|-----------|-----------|-----|
| Monorepo | Turborepo + npm workspaces | Shared code between packages |
| Frontend + API | Next.js 15 (App Router) | Full-stack in one framework |
| Transcoding | FFmpeg (subprocess) | Industry standard encoder |
| Player | Custom MSE-based player | Full control over ABR and buffering |
| Language | TypeScript | Type safety across all packages |
| Deployment | Vercel | Serverless, auto-deploy from GitHub |

### Monorepo Structure
```
streamflow/
|-- apps/
|   |-- web/                           # Next.js application
|       |-- src/app/                   # Pages (home + watch)
|       |-- src/app/api/              # REST API routes
|       |-- src/components/           # Player UI components
|       |-- src/lib/                  # CDN cache + video store
|       |-- public/videos/demo/       # Pre-transcoded demo video
|-- packages/
|   |-- types/                        # Shared TypeScript types & constants
|   |-- transcoder/                   # FFmpeg transcoding pipeline
|   |-- streaming-core/               # ABR, buffer manager, bandwidth estimator
```

### Package Breakdown

**@streaming/types** — Shared types and constants used across all packages:
- `Video`, `Rendition`, `Segment` — data models
- `ABRDecision`, `BandwidthSample` — algorithm types
- `BufferState`, `PlaybackEvent` — player state types
- `CacheStats` — CDN monitoring types
- Constants: `SEGMENT_DURATION=4`, `MAX_BUFFER=30s`, `EWMA_ALPHA=0.3`

**@streaming/transcoder** — FFmpeg transcoding pipeline:
- Takes a raw video file as input
- Encodes into 3 quality levels (240p, 480p, 720p) using H.264
- Splits each quality into 4-second fMP4 segments
- Generates HLS manifests (master + per-quality playlists)
- Outputs structured directory with init.mp4 + segment_XXX.m4s files

**@streaming/core** — Client-side streaming algorithms:
- `BandwidthEstimator` — EWMA smoothing of download speed measurements
- `ABRController` — Hybrid buffer+throughput quality selection algorithm
- `BufferManager` — FIFO segment queue with buffer level tracking
- `ManifestParser` — HLS M3U8 playlist parser

### API Routes Implemented

| Route | What It Does |
|-------|-------------|
| `POST /api/upload` | Accepts video file, runs FFmpeg transcoding pipeline, returns video metadata |
| `GET /api/videos` | Returns list of all available videos (from storage + demo) |
| `GET /api/videos/[id]/manifest` | Serves the master M3U8 manifest listing all qualities |
| `GET /api/videos/[id]/[quality]/playlist` | Serves the quality-specific playlist with segment list |
| `GET /api/videos/[id]/[quality]/[segment]` | Serves a single video segment with CDN cache layer |
| `POST /api/analytics` | Receives playback events (rebuffer, bitrate switch, etc.) |
| `GET /api/analytics` | Returns collected events + CDN cache hit/miss stats |

### CDN Cache Simulation
The segment route has an **LRU cache layer** sitting in front of storage:
- First request for a segment: cache MISS, fetch from disk, store in cache
- Subsequent requests: cache HIT, serve from memory instantly
- Each response includes `X-Cache: HIT` or `X-Cache: MISS` header
- Cache has 500MB max size with LRU eviction
- Cache stats (hit rate, size) available via analytics endpoint

### Video Player Components

**VideoPlayer.tsx** — The main player component:
- Initializes MediaSource Extensions (MSE) with fMP4 codec
- Fetches and parses master manifest to discover available qualities
- Parses each quality playlist to get segment URLs and init segments
- Runs the download loop: fetches segments, measures bandwidth, runs ABR, appends to SourceBuffer
- Handles init segment loading when quality switches
- Tracks startup latency, rebuffer events, bitrate switches

**BufferIndicator.tsx** — Visual buffer health display:
- Color-coded bar: red (<5s), yellow (<10s), green (>10s)
- Shows current buffer level in seconds
- Shows playback progress bar
- Displays BUFFERING warning when buffer is critically low

**BitrateGraph.tsx** — SVG-based real-time chart:
- Shows bandwidth measurements (white line) over time
- Color-coded background bands showing which quality was selected
- Legend for quality colors (240p=red, 480p=yellow, 720p=green, 1080p=blue)

**NetworkSimulator.tsx** — Network throttle buttons:
- WiFi (no throttle), 4G (50%), 3G (20%), 2G (5%)
- Adds artificial delay to segment downloads to simulate slow networks
- Lets you watch the ABR algorithm adapt in real-time

**Stats Panel** — Six real-time metrics:
- Startup Latency (target: <2s)
- Rebuffer Events (target: 0)
- Bitrate Switches (count)
- Buffer Level (seconds ahead)
- Bandwidth (estimated Mbps)
- Current Quality (240p/480p/720p)

### How the Player Works End-to-End
```
1. Player loads -> creates MediaSource -> adds SourceBuffer (fMP4 codec)
2. Fetches master manifest -> discovers 240p, 480p, 720p qualities
3. Fetches each quality playlist -> extracts init segment URI + segment list
4. Downloads init.mp4 for starting quality (240p) -> appends to SourceBuffer
5. Enters download loop:
   a. Check buffer level
   b. If buffer full (>30s) -> wait 500ms
   c. Run ABR algorithm (bandwidth estimate + buffer level) -> pick quality
   d. If quality changed -> load new init segment first
   e. Fetch next segment at chosen quality
   f. Measure download time -> update EWMA bandwidth estimate
   g. Append segment data to SourceBuffer
   h. If buffer >= 4s and first time -> call video.play() -> record startup latency
   i. Update all stats (buffer level, bandwidth, quality, decisions)
   j. Repeat until all segments downloaded
6. All segments done -> call mediaSource.endOfStream()
```

### What Problem Statement Requirements We Met

| Requirement | How We Solved It |
|-------------|-----------------|
| Adaptive Bitrate Streaming | Hybrid buffer+throughput ABR algorithm in VideoPlayer |
| Chunk-Based Streaming | FFmpeg splits video into 4s fMP4 segments |
| Buffer Management | FIFO buffer queue, 4s minimum, 30s maximum, with health tracking |
| Multi-Bitrate Encoding | 3 quality levels (240p/480p/720p) via FFmpeg bitrate ladder |
| CDN Delivery | LRU cache simulation with hit/miss tracking and X-Cache headers |
| Dynamic quality adaptation | ABR switches quality every segment based on bandwidth+buffer |
| Seek, pause, resume | HTML5 video controls + buffer flush on seek |
| Low startup latency | Start at lowest quality, play after just 4s buffered |
| Network simulation | Throttle buttons to demonstrate ABR under different conditions |
| Analytics | Real-time stats panel + event logging API |

This covers everything from the problem statement. Every design choice exists to solve a specific problem, and the code demonstrates each concept with a working implementation.
