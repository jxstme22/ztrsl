import { z } from "zod";

export const sourceModeSchema = z.enum(["filipino", "cebuano", "mixed"]);

export const clipCaptionSchema = z.object({
  utterance_id: z.string().min(1),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  source_mode: sourceModeSchema,
  source_text: z.string().max(500),
  english_text: z.string().max(500),
  forced_split: z.boolean(),
  provider: z.string().min(1),
  warnings: z.array(z.enum(["LOW_CONFIDENCE", "FORCED_SPLIT"])).max(2),
});

export const clipResultSchema = z.object({
  metadata: z.object({
    display_name: z.string().min(1),
    duration_seconds: z.number().positive(),
    size_bytes: z.number().int().nonnegative(),
    has_audio: z.literal(true),
  }),
  captions: z.array(clipCaptionSchema).max(128),
  truncated: z.boolean(),
  mode: z.enum(["demo", "local"]),
});

export type ClipResult = z.infer<typeof clipResultSchema>;
export type SourceMode = z.infer<typeof sourceModeSchema>;

export function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
