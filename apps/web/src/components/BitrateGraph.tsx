"use client";

import type { ABRDecision, BandwidthSample } from "@streaming/types";

/**
 * Visual graph showing bitrate decisions and bandwidth samples over time.
 * Uses pure SVG — no charting library needed.
 */

interface Props {
  decisions: ABRDecision[];
  samples: BandwidthSample[];
}

const QUALITY_TO_Y: Record<string, number> = {
  "240p": 0,
  "480p": 1,
  "720p": 2,
  "1080p": 3,
};

const QUALITY_COLORS: Record<string, string> = {
  "240p": "#e50914",
  "480p": "#e8b600",
  "720p": "#46d369",
  "1080p": "#2196f3",
};

export default function BitrateGraph({ decisions, samples }: Props) {
  if (decisions.length < 2) {
    return (
      <div
        style={{
          marginTop: 16,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Bitrate Graph — waiting for data...
        </div>
      </div>
    );
  }

  const width = 700;
  const height = 200;
  const padX = 50;
  const padY = 20;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  // Bandwidth line
  const maxBw = Math.max(...samples.map((s) => s.bitsPerSecond), 1);

  function bwToY(bw: number): number {
    return padY + chartH - (bw / maxBw) * chartH;
  }

  const bwPoints = samples
    .map((s, i) => {
      const x = padX + (i / Math.max(samples.length - 1, 1)) * chartW;
      const y = bwToY(s.bitsPerSecond);
      return `${x},${y}`;
    })
    .join(" ");

  // Quality steps
  const qualityRects: { x: number; w: number; quality: string }[] = [];
  for (let i = 0; i < decisions.length; i++) {
    const x = padX + (i / Math.max(decisions.length - 1, 1)) * chartW;
    const nextX =
      i < decisions.length - 1
        ? padX + ((i + 1) / Math.max(decisions.length - 1, 1)) * chartW
        : padX + chartW;
    qualityRects.push({
      x,
      w: nextX - x,
      quality: decisions[i].selectedQuality,
    });
  }

  return (
    <div
      style={{
        marginTop: 16,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Bitrate &amp; Bandwidth Over Time</span>
        <span style={{ display: "flex", gap: 12 }}>
          {Object.entries(QUALITY_COLORS).map(([q, c]) => (
            <span key={q} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: c,
                  display: "inline-block",
                }}
              />
              {q}
            </span>
          ))}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto" }}
      >
        {/* Quality background bands */}
        {qualityRects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={padY}
            width={Math.max(r.w, 1)}
            height={chartH}
            fill={QUALITY_COLORS[r.quality] || "#666"}
            opacity={0.15}
          />
        ))}

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
          <g key={frac}>
            <line
              x1={padX}
              y1={padY + chartH * (1 - frac)}
              x2={padX + chartW}
              y2={padY + chartH * (1 - frac)}
              stroke="var(--border)"
              strokeDasharray="4"
            />
            <text
              x={padX - 6}
              y={padY + chartH * (1 - frac) + 4}
              textAnchor="end"
              fill="var(--text-secondary)"
              fontSize={10}
            >
              {((maxBw * frac) / 1_000_000).toFixed(1)}
            </text>
          </g>
        ))}

        {/* Bandwidth polyline */}
        {samples.length > 1 && (
          <polyline
            points={bwPoints}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2}
            opacity={0.8}
          />
        )}

        {/* Axis labels */}
        <text
          x={padX - 6}
          y={padY - 6}
          textAnchor="end"
          fill="var(--text-secondary)"
          fontSize={10}
        >
          Mbps
        </text>
        <text
          x={padX + chartW}
          y={padY + chartH + 16}
          textAnchor="end"
          fill="var(--text-secondary)"
          fontSize={10}
        >
          Segments
        </text>
      </svg>
    </div>
  );
}
