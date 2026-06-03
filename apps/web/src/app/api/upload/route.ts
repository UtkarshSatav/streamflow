import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { transcodeVideo } from "@streaming/transcoder";

const UPLOAD_DIR = join(process.cwd(), "storage", "uploads");

export async function POST(req: NextRequest) {
  // Vercel has no FFmpeg and read-only filesystem — upload only works locally
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: "Upload requires FFmpeg and is only available when running locally. Use the pre-loaded demo video instead." },
      { status: 400 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("video") as File | null;
    const title = (formData.get("title") as string) || "Untitled";

    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    // Save uploaded file to disk
    if (!existsSync(UPLOAD_DIR)) {
      mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadPath = join(UPLOAD_DIR, `${Date.now()}_${file.name}`);
    writeFileSync(uploadPath, buffer);

    // Start transcoding pipeline
    const video = await transcodeVideo(uploadPath, title, ["240p", "480p", "720p"]);

    return NextResponse.json({ video }, { status: 201 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload/transcode failed" },
      { status: 500 }
    );
  }
}
