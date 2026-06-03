"use client";

/**
 * Visual buffer level indicator.
 *
 * Shows a bar representing how much content is buffered ahead of playback.
 * Color changes based on buffer health:
 *   Red    (<5s)  : danger, likely to stall
 *   Yellow (<10s) : warning, quality may drop
 *   Green  (>10s) : healthy buffer
 */

interface Props {
  bufferLevel: number;
  maxBuffer: number;
  currentTime: number;
  duration: number;
  isBuffering: boolean;
}

export default function BufferIndicator({
  bufferLevel,
  maxBuffer,
  currentTime,
  duration,
  isBuffering,
}: Props) {
  const fillPercent = Math.min((bufferLevel / maxBuffer) * 100, 100);
  const playbackPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  let color = "var(--success)";
  let label = "Healthy";
  if (bufferLevel < 5) {
    color = "var(--danger)";
    label = "Critical";
  } else if (bufferLevel < 10) {
    color = "var(--warning)";
    label = "Low";
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
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
          fontSize: 13,
        }}
      >
        <span style={{ color: "var(--text-secondary)" }}>
          Buffer: <strong style={{ color }}>{bufferLevel.toFixed(1)}s</strong>{" "}
          ({label})
          {isBuffering && (
            <span style={{ color: "var(--danger)", marginLeft: 8 }}>
              BUFFERING
            </span>
          )}
        </span>
        <span style={{ color: "var(--text-secondary)" }}>
          Max: {maxBuffer}s
        </span>
      </div>

      {/* Playback progress bar */}
      <div
        style={{
          height: 6,
          background: "var(--bg-tertiary)",
          borderRadius: 3,
          marginBottom: 6,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${playbackPercent}%`,
            background: "var(--accent)",
            borderRadius: 3,
            transition: "width 0.3s",
          }}
        />
      </div>

      {/* Buffer level bar */}
      <div
        style={{
          height: 10,
          background: "var(--bg-tertiary)",
          borderRadius: 5,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${fillPercent}%`,
            background: color,
            borderRadius: 5,
            transition: "width 0.3s, background 0.3s",
          }}
        />
      </div>
    </div>
  );
}
