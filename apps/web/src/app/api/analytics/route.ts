import { NextRequest, NextResponse } from "next/server";
import { addAnalyticsEvent, getAnalyticsEvents } from "@/lib/video-store";
import { cdnCache } from "@/lib/cdn-cache";
import type { PlaybackEvent } from "@streaming/types";

export async function POST(req: NextRequest) {
  const event: PlaybackEvent = await req.json();
  addAnalyticsEvent(event);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId") || undefined;
  const events = getAnalyticsEvents(videoId);
  const cacheStats = cdnCache.getStats();

  return NextResponse.json({ events, cacheStats });
}
