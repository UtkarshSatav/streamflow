"use client";

import { useState } from "react";

/**
 * Network condition simulator.
 *
 * Lets you artificially throttle bandwidth to see how the ABR algorithm
 * reacts to different network conditions. The throttle factor reduces
 * effective download speed:
 *
 *   1.0  = no throttle (WiFi)
 *   0.5  = 50% speed (4G)
 *   0.2  = 20% speed (3G)
 *   0.05 = 5% speed (2G/Edge)
 */

interface Props {
  onThrottleChange: (factor: number) => void;
}

const PRESETS = [
  { label: "WiFi (No throttle)", factor: 1 },
  { label: "4G (50%)", factor: 0.5 },
  { label: "3G (20%)", factor: 0.2 },
  { label: "2G (5%)", factor: 0.05 },
];

export default function NetworkSimulator({ onThrottleChange }: Props) {
  const [active, setActive] = useState(0);

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
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
        Network Simulation
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PRESETS.map((preset, i) => (
          <button
            key={preset.label}
            onClick={() => {
              setActive(i);
              onThrottleChange(preset.factor);
            }}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid",
              borderColor: i === active ? "var(--accent)" : "var(--border)",
              background: i === active ? "var(--accent)" : "var(--bg-tertiary)",
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: i === active ? 600 : 400,
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
