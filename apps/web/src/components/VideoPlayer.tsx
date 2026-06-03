"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Video,
  QualityLevel,
  ABRDecision,
  BandwidthSample,
} from "@streaming/types";
import {
  MIN_BUFFER_BEFORE_PLAY,
  MAX_BUFFER_SECONDS,
  EWMA_ALPHA,
} from "@streaming/types";
import BufferIndicator from "./BufferIndicator";
import BitrateGraph from "./BitrateGraph";
import NetworkSimulator from "./NetworkSimulator";

interface Props {
  video: Video;
}

interface StreamVariant {
  quality: QualityLevel;
  bandwidth: number;
  resolution: string;
  segments: string[];
  initSegment: string | null; // fMP4 init segment filename
}

interface PlayerState {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  bufferLevel: number;
  currentQuality: QualityLevel;
  estimatedBandwidth: number;
  abrDecisions: ABRDecision[];
  bandwidthSamples: BandwidthSample[];
  startupLatency: number | null;
  rebufferCount: number;
  bitrateSwitchCount: number;
}

// ─── Helper to append data to SourceBuffer and wait ───
function appendToSourceBuffer(sb: SourceBuffer, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onUpdate = () => {
      sb.removeEventListener("updateend", onUpdate);
      sb.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      sb.removeEventListener("updateend", onUpdate);
      sb.removeEventListener("error", onError);
      reject(new Error("SourceBuffer append error"));
    };
    sb.addEventListener("updateend", onUpdate);
    sb.addEventListener("error", onError);
    sb.appendBuffer(data);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({ video }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const abortRef = useRef(false);
  const downloadingRef = useRef(false);

  // Mutable refs for download loop (avoids stale closures)
  const nextSegmentRef = useRef(0);
  const variantsRef = useRef<StreamVariant[]>([]);
  const bandwidthEstimateRef = useRef(0);
  const throttleRef = useRef(1);
  const manualQualityRef = useRef<QualityLevel | "auto">("auto");
  const playStartTime = useRef(0);
  const startupDoneRef = useRef(false);
  const prevQualityRef = useRef<QualityLevel>("240p");
  const initLoadedForRef = useRef<Set<QualityLevel>>(new Set());

  // State for UI
  const [state, setState] = useState<PlayerState>({
    isPlaying: false,
    isBuffering: true,
    currentTime: 0,
    duration: video.duration,
    bufferLevel: 0,
    currentQuality: "240p",
    estimatedBandwidth: 0,
    abrDecisions: [],
    bandwidthSamples: [],
    startupLatency: null,
    rebufferCount: 0,
    bitrateSwitchCount: 0,
  });

  const [manualQuality, setManualQuality] = useState<QualityLevel | "auto">("auto");
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);

  // Keep ref in sync
  useEffect(() => {
    manualQualityRef.current = manualQuality;
  }, [manualQuality]);

  // ─── Initialize and run ───
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    abortRef.current = false;
    downloadingRef.current = false;
    nextSegmentRef.current = 0;
    bandwidthEstimateRef.current = 0;
    startupDoneRef.current = false;
    prevQualityRef.current = "240p";
    initLoadedForRef.current = new Set();
    playStartTime.current = performance.now();

    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    vid.src = URL.createObjectURL(ms);

    ms.addEventListener("sourceopen", async () => {
      try {
        // Use fMP4 mime type — browsers support this in MSE (not .ts)
        const mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        if (!MediaSource.isTypeSupported(mimeType)) {
          console.error("Browser does not support:", mimeType);
          return;
        }

        const sb = ms.addSourceBuffer(mimeType);
        sourceBufferRef.current = sb;

        // Parse manifests
        const variants = await loadManifests(video.id);
        variantsRef.current = variants;
        setAvailableQualities(variants.map((v) => v.quality));

        // Start download loop
        runDownloadLoop(vid, ms, sb, variants);
      } catch (err) {
        console.error("Setup error:", err);
      }
    });

    return () => {
      abortRef.current = true;
      downloadingRef.current = false;
      if (ms.readyState === "open") {
        try { ms.endOfStream(); } catch {}
      }
      URL.revokeObjectURL(vid.src);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  // ─── Track playback events ───
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onTimeUpdate = () => {
      const sb = sourceBufferRef.current;
      let bufferLevel = 0;
      if (sb && sb.buffered.length > 0) {
        bufferLevel = sb.buffered.end(sb.buffered.length - 1) - vid.currentTime;
      }
      setState((s) => ({
        ...s,
        currentTime: vid.currentTime,
        bufferLevel,
        isPlaying: !vid.paused,
      }));
    };

    const onWaiting = () => {
      setState((s) => ({
        ...s,
        isBuffering: true,
        rebufferCount: s.rebufferCount + (startupDoneRef.current ? 1 : 0),
      }));
    };

    const onPlaying = () => {
      setState((s) => ({ ...s, isBuffering: false, isPlaying: true }));
    };

    vid.addEventListener("timeupdate", onTimeUpdate);
    vid.addEventListener("waiting", onWaiting);
    vid.addEventListener("playing", onPlaying);

    return () => {
      vid.removeEventListener("timeupdate", onTimeUpdate);
      vid.removeEventListener("waiting", onWaiting);
      vid.removeEventListener("playing", onPlaying);
    };
  }, []);

  // ─── Parse manifests ───
  async function loadManifests(videoId: string): Promise<StreamVariant[]> {
    const masterRes = await fetch(`/api/videos/${videoId}/manifest`);
    const masterText = await masterRes.text();

    const lines = masterText.trim().split("\n");
    const streams: { quality: QualityLevel; bandwidth: number; resolution: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const resMatch = line.match(/RESOLUTION=(\S+)/);
        const playlistLine = lines[i + 1]?.trim() || "";
        const quality = playlistLine.split("/")[0] as QualityLevel;
        streams.push({
          quality,
          bandwidth: bwMatch ? parseInt(bwMatch[1]) : 0,
          resolution: resMatch ? resMatch[1] : "",
        });
        i++;
      }
    }

    const variants: StreamVariant[] = [];
    for (const stream of streams) {
      const plRes = await fetch(`/api/videos/${videoId}/${stream.quality}/playlist`);
      const plText = await plRes.text();

      const segments: string[] = [];
      let initSegment: string | null = null;
      const plLines = plText.trim().split("\n");

      for (let i = 0; i < plLines.length; i++) {
        const l = plLines[i].trim();

        // Parse init segment: #EXT-X-MAP:URI="init.mp4"
        if (l.startsWith("#EXT-X-MAP:")) {
          const uriMatch = l.match(/URI="([^"]+)"/);
          if (uriMatch) initSegment = uriMatch[1];
        }

        if (l.startsWith("#EXTINF:")) {
          const segFile = plLines[i + 1]?.trim();
          if (segFile && !segFile.startsWith("#")) {
            segments.push(segFile);
            i++;
          }
        }
      }

      variants.push({
        quality: stream.quality,
        bandwidth: stream.bandwidth,
        resolution: stream.resolution,
        segments,
        initSegment,
      });
    }

    variants.sort((a, b) => a.bandwidth - b.bandwidth);
    return variants;
  }

  // ─── ABR selection ───
  function selectQuality(bandwidth: number, bufferLevel: number, variants: StreamVariant[]): QualityLevel {
    if (manualQualityRef.current !== "auto") return manualQualityRef.current;
    if (variants.length === 0) return "240p";

    let factor: number;
    if (bufferLevel < 5) {
      factor = 0;
    } else if (bufferLevel < 10) {
      factor = 0.5;
    } else if (bufferLevel > 20) {
      factor = 0.9;
    } else {
      factor = 0.7;
    }

    const usable = bandwidth * factor;
    let selected = variants[0];
    for (const v of variants) {
      if (v.bandwidth <= usable) selected = v;
      else break;
    }
    return selected.quality;
  }

  // ─── Download loop ───
  async function runDownloadLoop(
    vid: HTMLVideoElement,
    ms: MediaSource,
    sb: SourceBuffer,
    variants: StreamVariant[]
  ) {
    if (downloadingRef.current) return;
    downloadingRef.current = true;

    const totalSegments = variants[0].segments.length;

    // Load init segment for the starting quality
    const startVariant = variants[0];
    if (startVariant.initSegment) {
      const initUrl = `/api/videos/${video.id}/${startVariant.quality}/${startVariant.initSegment}`;
      const initRes = await fetch(initUrl);
      const initData = await initRes.arrayBuffer();
      await appendToSourceBuffer(sb, initData);
      initLoadedForRef.current.add(startVariant.quality);
    }

    while (nextSegmentRef.current < totalSegments && !abortRef.current) {
      // Get current buffer level
      let bufferLevel = 0;
      if (sb.buffered.length > 0) {
        bufferLevel = sb.buffered.end(sb.buffered.length - 1) - vid.currentTime;
      }

      // Wait if buffer is full
      if (bufferLevel > MAX_BUFFER_SECONDS) {
        await sleep(500);
        continue;
      }

      // ABR decision
      const quality = selectQuality(bandwidthEstimateRef.current, bufferLevel, variants);
      const variant = variants.find((v) => v.quality === quality) || variants[0];
      const segIndex = nextSegmentRef.current;
      const segFile = variant.segments[segIndex];
      if (!segFile) break;

      // If quality changed, we need to load the new init segment
      if (variant.initSegment && !initLoadedForRef.current.has(variant.quality)) {
        const initUrl = `/api/videos/${video.id}/${variant.quality}/${variant.initSegment}`;
        const initRes = await fetch(initUrl);
        const initData = await initRes.arrayBuffer();
        while (sb.updating) await sleep(20);
        await appendToSourceBuffer(sb, initData);
        initLoadedForRef.current.add(variant.quality);
      }

      // Download segment
      const url = `/api/videos/${video.id}/${variant.quality}/${segFile}`;
      const startTime = performance.now();

      try {
        const res = await fetch(url);
        const data = await res.arrayBuffer();

        // Simulate throttle
        const throttle = throttleRef.current;
        if (throttle < 1) {
          const naturalTime = performance.now() - startTime;
          const extraDelay = (naturalTime / throttle) - naturalTime;
          if (extraDelay > 0) await sleep(extraDelay);
        }

        const downloadTime = performance.now() - startTime;
        const bps = (data.byteLength * 8) / (downloadTime / 1000);

        // EWMA bandwidth update
        if (bandwidthEstimateRef.current === 0) {
          bandwidthEstimateRef.current = bps;
        } else {
          bandwidthEstimateRef.current =
            EWMA_ALPHA * bps + (1 - EWMA_ALPHA) * bandwidthEstimateRef.current;
        }

        // Append to source buffer
        while (sb.updating) await sleep(20);
        await appendToSourceBuffer(sb, data);

        nextSegmentRef.current++;

        // Calculate new buffer level
        let newBufLevel = 0;
        if (sb.buffered.length > 0) {
          newBufLevel = sb.buffered.end(sb.buffered.length - 1) - vid.currentTime;
        }

        // Start playback once we have enough buffer
        if (!startupDoneRef.current && newBufLevel >= MIN_BUFFER_BEFORE_PLAY) {
          startupDoneRef.current = true;
          const latency = performance.now() - playStartTime.current;
          vid.play().catch(() => {});
          setState((s) => ({ ...s, startupLatency: latency, isBuffering: false }));
        }

        const sample: BandwidthSample = {
          timestamp: Date.now(),
          bitsPerSecond: bps,
          segmentSize: data.byteLength,
          downloadTime,
        };

        const didSwitch = prevQualityRef.current !== quality;
        prevQualityRef.current = quality;

        setState((s) => ({
          ...s,
          currentQuality: quality,
          estimatedBandwidth: bandwidthEstimateRef.current,
          bufferLevel: newBufLevel,
          isBuffering: newBufLevel < 1 && startupDoneRef.current,
          bandwidthSamples: [...s.bandwidthSamples, sample],
          abrDecisions: [
            ...s.abrDecisions,
            {
              selectedQuality: quality,
              selectedBitrate: variant.bandwidth,
              estimatedBandwidth: bandwidthEstimateRef.current,
              bufferLevel: newBufLevel,
              reason: "",
            },
          ],
          bitrateSwitchCount: s.bitrateSwitchCount + (didSwitch ? 1 : 0),
        }));
      } catch (err) {
        console.error("Segment download failed:", err);
        await sleep(1000);
      }
    }

    // End of stream
    if (nextSegmentRef.current >= totalSegments && ms.readyState === "open") {
      try {
        while (sb.updating) await sleep(20);
        ms.endOfStream();
      } catch {}
    }

    downloadingRef.current = false;
  }

  // ─── Seek ───
  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = parseFloat(e.target.value);
  }

  // ─── Play/Pause ───
  function togglePlay() {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) vid.play();
    else vid.pause();
  }

  return (
    <div>
      {/* Video Element */}
      <div style={{ position: "relative", background: "#000", borderRadius: 12, overflow: "hidden" }}>
        <video
          ref={videoRef}
          style={{ width: "100%", display: "block" }}
          playsInline
        />

        {state.isBuffering && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>Buffering...</div>
          </div>
        )}

        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "rgba(0,0,0,0.7)",
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {state.currentQuality} &middot;{" "}
          {(state.estimatedBandwidth / 1_000_000).toFixed(1)} Mbps
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, padding: "8px 0" }}>
        <button
          onClick={togglePlay}
          style={{
            background: "var(--accent)",
            border: "none",
            borderRadius: 8,
            padding: "8px 20px",
            color: "white",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {state.isPlaying ? "Pause" : "Play"}
        </button>

        <span style={{ fontSize: 13, color: "var(--text-secondary)", minWidth: 80 }}>
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </span>

        <input
          type="range"
          min={0}
          max={state.duration}
          step={0.1}
          value={state.currentTime}
          onChange={handleSeek}
          style={{ flex: 1 }}
        />

        <select
          value={manualQuality}
          onChange={(e) => setManualQuality(e.target.value as QualityLevel | "auto")}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        >
          <option value="auto">Auto</option>
          {availableQualities.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </div>

      <BufferIndicator
        bufferLevel={state.bufferLevel}
        maxBuffer={MAX_BUFFER_SECONDS}
        currentTime={state.currentTime}
        duration={state.duration}
        isBuffering={state.isBuffering}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 16,
        }}
      >
        <StatCard
          label="Startup Latency"
          value={state.startupLatency !== null ? `${(state.startupLatency / 1000).toFixed(2)}s` : "..."}
          good={state.startupLatency !== null && state.startupLatency < 2000}
        />
        <StatCard label="Rebuffer Events" value={String(state.rebufferCount)} good={state.rebufferCount === 0} />
        <StatCard label="Bitrate Switches" value={String(state.bitrateSwitchCount)} good={true} />
        <StatCard label="Buffer Level" value={`${state.bufferLevel.toFixed(1)}s`} good={state.bufferLevel > 5} />
        <StatCard label="Bandwidth" value={`${(state.estimatedBandwidth / 1_000_000).toFixed(2)} Mbps`} good={true} />
        <StatCard label="Quality" value={state.currentQuality} good={true} />
      </div>

      <NetworkSimulator onThrottleChange={(factor) => { throttleRef.current = factor; }} />
      <BitrateGraph decisions={state.abrDecisions} samples={state.bandwidthSamples} />
    </div>
  );
}

function StatCard({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: good ? "var(--success)" : "var(--warning)" }}>{value}</div>
    </div>
  );
}
