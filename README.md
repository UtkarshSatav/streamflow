# StreamFlow — Adaptive Bitrate Video Streaming Platform

A working video streaming system demonstrating how Netflix/YouTube-style streaming works under the hood. Built as a **Turborepo monorepo** with Next.js, featuring adaptive bitrate streaming (HLS), chunk-based delivery, buffer management, CDN simulation, and real-time analytics.

**Live Demo:** [streamflow-web-dusky.vercel.app](https://streamflow-web-dusky.vercel.app)

---

## What It Does

Upload a video → system transcodes it into multiple quality levels (240p, 480p, 720p) → splits each into 4-second fMP4 segments → generates HLS manifests → custom video player fetches segments, dynamically switches quality based on network conditions, and plays with zero stalls.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Monorepo | Turborepo + npm workspaces |
| Frontend + API | Next.js 15 (App Router) |
| Transcoding | FFmpeg |
| Player | Custom MSE-based (MediaSource Extensions) |
| Language | TypeScript |
| Deployment | Vercel |

---

## Project Structure

```
streamflow/
├── apps/
│   └── web/                          # Next.js application
│       ├── src/app/                  # Pages (home + watch)
│       ├── src/app/api/              # REST API routes
│       ├── src/components/           # Player UI components
│       ├── src/lib/                  # CDN cache + video store
│       └── public/videos/demo/       # Pre-transcoded demo video
├── packages/
│   ├── types/                        # Shared TypeScript types & constants
│   ├── transcoder/                   # FFmpeg transcoding pipeline
│   └── streaming-core/              # ABR, buffer manager, bandwidth estimator
├── VIVA_GUIDE.md                     # Complete system design explanation
├── turbo.json
└── package.json
```

---

## Packages

### `@streaming/types`
Shared TypeScript types and constants used across all packages:
- Data models: `Video`, `Rendition`, `Segment`
- Algorithm types: `ABRDecision`, `BandwidthSample`
- Player state: `BufferState`, `PlaybackEvent`, `CacheStats`
- Constants: `SEGMENT_DURATION=4s`, `MAX_BUFFER=30s`, `EWMA_ALPHA=0.3`

### `@streaming/transcoder`
FFmpeg transcoding pipeline:
- Encodes video into 3 quality levels (240p / 480p / 720p)
- Splits each into 4-second **fragmented MP4** segments
- Generates HLS manifests (master + per-quality playlists)
- Outputs `init.mp4` + `segment_XXX.m4s` files per quality

### `@streaming/core`
Client-side streaming algorithms:
- **BandwidthEstimator** — EWMA smoothing of download speed measurements
- **ABRController** — Hybrid buffer+throughput quality selection
- **BufferManager** — FIFO segment queue with buffer level tracking
- **ManifestParser** — HLS M3U8 playlist parser

### `@streaming/web`
Next.js app with API routes and player UI.

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/upload` | POST | Upload video, run FFmpeg transcode |
| `/api/videos` | GET | List all available videos |
| `/api/videos/[id]/manifest` | GET | Master M3U8 manifest |
| `/api/videos/[id]/[quality]/playlist` | GET | Quality-specific segment playlist |
| `/api/videos/[id]/[quality]/[segment]` | GET | Serve segment through CDN cache |
| `/api/analytics` | POST/GET | Playback event logging + cache stats |

---

## Player Components

| Component | What It Does |
|-----------|-------------|
| **VideoPlayer** | MSE-based player with ABR, download loop, init segment handling |
| **BufferIndicator** | Color-coded bar (red/yellow/green) showing buffer health |
| **BitrateGraph** | SVG chart of bandwidth + quality selections over time |
| **NetworkSimulator** | Throttle buttons (WiFi/4G/3G/2G) to test ABR adaptation |
| **Stats Panel** | Real-time metrics: startup latency, rebuffers, bandwidth, quality |

---

## Key Features

### Adaptive Bitrate (ABR) Algorithm
Hybrid buffer + throughput strategy with 4 zones:
- **< 5s buffer (PANIC)** — drop to lowest quality immediately
- **< 10s buffer (CONSERVATIVE)** — use 50% of estimated bandwidth
- **< 20s buffer (NORMAL)** — use 70% of bandwidth (safety margin)
- **> 20s buffer (AGGRESSIVE)** — use 90% of bandwidth

### Bandwidth Estimation (EWMA)
```
estimate = 0.3 × latest_sample + 0.7 × previous_estimate
```
Smooths out noisy measurements to prevent quality oscillation.

### CDN Cache Simulation
LRU cache sits in front of segment storage:
- Cache HIT → serve from memory (fast)
- Cache MISS → fetch from disk, store in cache
- `X-Cache: HIT/MISS` header on every response
- 500MB max with LRU eviction

### Buffer Management
- FIFO segment queue
- 4s minimum before playback starts (low startup latency)
- 30s maximum buffer (prevents waste)
- Rebuffer detection and counting

---

## How Playback Works

```
1. Create MediaSource + SourceBuffer (fMP4 codec)
2. Fetch master manifest → discover 240p/480p/720p
3. Fetch quality playlists → extract init segments + segment URLs
4. Download init.mp4 for starting quality → append to SourceBuffer
5. Download loop:
   a. Check buffer level
   b. Run ABR algorithm → pick quality
   c. If quality changed → load new init segment
   d. Fetch segment → measure download time → update EWMA
   e. Append to SourceBuffer
   f. Buffer reaches 4s → video.play()
   g. Repeat until done
6. endOfStream()
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- FFmpeg (`brew install ffmpeg` on macOS)

### Install & Run
```bash
git clone https://github.com/UtkarshSatav/streamflow.git
cd streamflow
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Usage
1. Upload any video file through the UI
2. Wait for transcoding to complete (creates 240p/480p/720p HLS segments)
3. Click the video to open the player
4. Use network simulation buttons to watch ABR adapt in real-time

> On Vercel deployment, a pre-transcoded demo video is available. Upload requires FFmpeg and only works when running locally.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    CLIENT SIDE                        │
│  ┌────────────────────────────────────────────────┐  │
│  │              Video Player                       │  │
│  │  Manifest Parser → ABR Algorithm ← Bandwidth   │  │
│  │                      ↓            Estimator     │  │
│  │               Buffer Manager                    │  │
│  │                      ↓                          │  │
│  │               <video> (MSE)                     │  │
│  └────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────┘
                         │ HTTP
                         ▼
┌────────────────────────────────────────────────────────┐
│                   CDN EDGE CACHE                       │
│            (LRU Cache - cached segments)               │
└────────────────────────┬───────────────────────────────┘
                         │ cache miss
                         ▼
┌────────────────────────────────────────────────────────┐
│                   ORIGIN SERVER                        │
│  API Routes → Transcoding Service → Segment Storage   │
└────────────────────────────────────────────────────────┘
```

---

## Problem Statement Mapping

| Requirement | Solution |
|---|---|
| Adaptive Bitrate Streaming | Hybrid ABR with 4 buffer zones + 70% safety margin |
| Chunk-Based Streaming | FFmpeg splits into 4s fMP4 segments |
| Buffer Management | FIFO queue, 4s min, 30s max, rebuffer detection |
| Multi-Bitrate Encoding | 3 quality levels (400kbps / 1Mbps / 2.5Mbps) |
| CDN Delivery | LRU cache with hit/miss tracking + X-Cache headers |
| Seek/Pause/Resume | HTML5 controls with buffer flush on seek |
| Low Startup Latency | Start at lowest quality, play after 1 segment |
| Analytics | Real-time stats + event logging + cache metrics |
| Network Handling | Throttle simulator for WiFi/4G/3G/2G |

---

## Trade-offs

| Trade-off | Our Choice | Why |
|-----------|-----------|-----|
| Buffer size vs startup latency | 4s min, 30s max | Start fast, build resilience |
| Segment duration vs adaptability | 4 seconds | Industry standard balance |
| Storage cost vs user experience | 3 quality levels | Covers most network conditions |
| CDN cache size vs hit rate | 500MB LRU | Popular content stays cached |
| Quality vs bandwidth | 70% safety margin | Prevents stalls from estimate errors |
