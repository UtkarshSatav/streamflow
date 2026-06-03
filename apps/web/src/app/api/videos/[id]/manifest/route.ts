import { NextRequest, NextResponse } from "next/server";
import { getMasterManifest } from "@/lib/video-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const manifest = getMasterManifest(id);

  if (!manifest) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return new NextResponse(manifest, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "public, max-age=31536000",
    },
  });
}
