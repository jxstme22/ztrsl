import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  clipResultSchema,
  type ClipResult,
  type SourceMode,
} from "./model";

export async function analyzeMediaClip(
  path: string,
  sourceMode: SourceMode,
  provider: "demo" | "local",
): Promise<ClipResult> {
  if (!isTauri()) {
    return clipResultSchema.parse({
      metadata: {
        display_name: path.split(/[\\/]/).at(-1) ?? "browser-demo.mp4",
        duration_seconds: 7.2,
        size_bytes: 1024,
        has_audio: true,
      },
      captions: [
        {
          utterance_id: "browser-clip-1",
          start_ms: 900,
          end_ms: 4100,
          source_mode: sourceMode,
          source_text: "[demo transcript — local ASR model not installed]",
          english_text: "[demo translation — local MT model not installed]",
          forced_split: false,
          provider: "demo-asr+demo-mt",
        },
      ],
      truncated: false,
      mode: "demo",
    });
  }
  return clipResultSchema.parse(
    await invoke("analyze_clip", { path, sourceMode, provider }),
  );
}

