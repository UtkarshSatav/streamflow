import { NextRequest, NextResponse } from "next/server";
import { getSegmentData } from "@/lib/video-store";
import { cdnCache } from "@/lib/cdn-cache";

function getContentType(filename: string): string {
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".m4s")) return "video/iso.segment";
  return "video/mp2t";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; quality: string; segment: string }> }
) {
  const { id, quality, segment } = await params;
  const cacheKey = `${id}/${quality}/${segment}`;
  const contentType = getContentType(segment);

  // 1. Check CDN cache first
  const cached = cdnCache.get(cacheKey);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(cached.length),
        "X-Cache": "HIT",
        "Cache-Control": "public, max-age=31536000",
      },
    });
  }

  // 2. Cache miss — fetch from origin storage
  const data = getSegmentData(id, quality, segment);
  if (!data) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  // 3. Store in CDN cache for future requests
  cdnCache.put(cacheKey, data);

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "X-Cache": "MISS",
      "Cache-Control": "public, max-age=31536000",
    },
  });
}
