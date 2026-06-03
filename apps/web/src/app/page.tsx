"use client";

import { useState, useEffect, useRef } from "react";
import type { Video } from "@streaming/types";
import Link from "next/link";

export default function HomePage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/videos")
      .then((r) => r.json())
      .then((d) => setVideos(d.videos));
  }, []);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress("Uploading & transcoding... This may take a few minutes.");

    const form = new FormData();
    form.append("video", file);
    form.append("title", titleRef.current?.value || file.name);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setUploadProgress(data.error || "Upload failed.");
        return;
      }
      setVideos((prev) => [data.video, ...prev]);
      setUploadProgress("Done!");
      if (fileRef.current) fileRef.current.value = "";
      if (titleRef.current) titleRef.current.value = "";
    } catch {
      setUploadProgress("Upload failed. Make sure FFmpeg is installed and you are running locally.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>StreamFlow</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 40 }}>
        Adaptive Bitrate Streaming Platform (HLS)
      </p>

      {/* Upload Section */}
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          marginBottom: 40,
        }}
      >
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Upload Video</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            ref={titleRef}
            type="text"
            placeholder="Video title"
            style={{
              flex: 1,
              minWidth: 200,
              padding: "10px 14px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              fontSize: 14,
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            style={{
              padding: "10px 14px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              fontSize: 14,
            }}
          />
          <button
            onClick={handleUpload}
            disabled={uploading}
            style={{
              padding: "10px 24px",
              background: uploading ? "var(--bg-tertiary)" : "var(--accent)",
              border: "none",
              borderRadius: 8,
              color: "white",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {uploading ? "Processing..." : "Upload & Transcode"}
          </button>
        </div>
        {uploadProgress && (
          <p style={{ marginTop: 12, color: "var(--text-secondary)", fontSize: 14 }}>
            {uploadProgress}
          </p>
        )}
      </div>

      {/* Video List */}
      <h2 style={{ fontSize: 20, marginBottom: 16 }}>Videos</h2>
      {videos.length === 0 ? (
        <p style={{ color: "var(--text-secondary)" }}>
          No videos yet. Upload one to get started.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280, 1fr))",
            gap: 16,
          }}
        >
          {videos.map((video) => (
            <Link key={video.id} href={`/watch/${video.id}`}>
              <div
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 20,
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "var(--accent)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border)")
                }
              >
                <div
                  style={{
                    background: "var(--bg-tertiary)",
                    borderRadius: 8,
                    height: 140,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                    fontSize: 40,
                  }}
                >
                  ▶
                </div>
                <h3 style={{ fontSize: 16, marginBottom: 6 }}>{video.title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {formatDuration(video.duration)} &middot;{" "}
                  {video.renditions.map((r) => r.quality).join(", ")}
                </p>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 8,
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      video.status === "ready"
                        ? "rgba(70,211,105,0.15)"
                        : "rgba(232,182,0,0.15)",
                    color:
                      video.status === "ready"
                        ? "var(--success)"
                        : "var(--warning)",
                  }}
                >
                  {video.status.toUpperCase()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
