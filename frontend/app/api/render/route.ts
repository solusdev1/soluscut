import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
const run = promisify(execFile);

export async function POST(request: Request) {
  const data = await request.formData();
  const video = data.get("video");
  const start = Math.max(0, Number(data.get("start") ?? 0));
  const duration = Math.max(1, Number(data.get("duration") ?? 30));
  const cropText = data.get("crop");
  const captions = String(data.get("captions") ?? "");
  if (!(video instanceof File)) return Response.json({ error: "Vídeo ausente." }, { status: 400 });
  const dir = await mkdtemp(join(tmpdir(), "soluscut-render-"));
  const input = join(dir, "input.mp4");
  const output = join(dir, "soluscut-final.mp4");
  const subtitle = join(dir, "captions.srt");
  try {
    await writeFile(input, Buffer.from(await video.arrayBuffer()));
    await writeFile(subtitle, captions);
    let filter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    if (typeof cropText === "string") {
      const crop = JSON.parse(cropText) as { x: number; y: number; w: number; h: number };
      filter = `crop=${Math.round(crop.w)}:${Math.round(crop.h)}:${Math.round(crop.x)}:${Math.round(crop.y)},scale=1080:1920`;
    }
    await run("ffmpeg", ["-y", "-ss", String(start), "-i", input, "-i", subtitle, "-t", String(duration), "-vf", filter, "-map", "0:v:0", "-map", "0:a?", "-map", "1:0", "-c:v", "libx264", "-c:a", "aac", "-c:s", "mov_text", "-movflags", "+faststart", output], { windowsHide: true });
    const mp4 = await readFile(output);
    return new Response(mp4, { headers: { "Content-Type": "video/mp4", "Content-Disposition": "attachment; filename=soluscut-final.mp4" } });
  } catch {
    return Response.json({ error: "Não foi possível renderizar este vídeo." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
