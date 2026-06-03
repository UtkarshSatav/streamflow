import { NextRequest, NextResponse } from "next/server";
import { getQualityPlaylist } from "@/lib/video-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; quality: string }> }
) {
  const { id, quality } = await params;
  const playlist = getQualityPlaylist(id, quality);

  if (!playlist) {
    return NextResponse.json(
      { error: `Playlist not found for ${quality}` },
      { status: 404 }
    );
  }

  return new NextResponse(playlist, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "public, max-age=31536000",
    },
  });
}
