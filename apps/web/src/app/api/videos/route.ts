import { NextResponse } from "next/server";
import { getAllVideos } from "@/lib/video-store";

export async function GET() {
  const videos = getAllVideos();
  return NextResponse.json({ videos });
}
