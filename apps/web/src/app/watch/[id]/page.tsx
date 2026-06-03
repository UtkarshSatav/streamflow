"use client";

import { useEffect, useState, use } from "react";
import type { Video } from "@streaming/types";
import VideoPlayer from "@/components/VideoPlayer";
import Link from "next/link";

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/videos")
      .then((r) => r.json())
      .then((d) => {
        const found = d.videos.find((v: Video) => v.id === id);
        if (found) setVideo(found);
        else setError("Video not found");
      })
      .catch(() => setError("Failed to load video"));
  }, [id]);

  if (error) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
        <Link href="/" style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          &larr; Back
        </Link>
        <p style={{ marginTop: 20, color: "var(--danger)" }}>{error}</p>
      </div>
    );
  }

  if (!video) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
        <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
      <Link href="/" style={{ color: "var(--text-secondary)", fontSize: 14 }}>
        &larr; Back to videos
      </Link>

      <h1 style={{ fontSize: 24, margin: "16px 0 8px" }}>{video.title}</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>
        {formatDuration(video.duration)} &middot; Available in:{" "}
        {video.renditions.map((r) => r.quality).join(", ")}
      </p>

      <VideoPlayer video={video} />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
