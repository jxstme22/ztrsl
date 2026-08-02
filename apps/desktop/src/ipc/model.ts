import { z } from "zod";

export const sidecarStatusSchema = z.object({
  state: z.enum(["ready", "stopped"]),
  provider: z.literal("fake"),
  restartable: z.boolean(),
});

export const captionPayloadSchema = z.object({
  caption_id: z.string().min(1).max(128),
  utterance_id: z.string().min(1).max(128),
  revision: z.number().int().positive(),
  status: z.enum(["provisional", "final"]),
  source_mode: z.enum(["filipino", "cebuano", "english", "chinese", "mixed"]),
  source_text: z.string().max(8000),
  english_text: z.string().max(8000),
  started_monotonic_ns: z.number().int().nonnegative(),
  ended_monotonic_ns: z.number().int().nonnegative().nullable(),
  capture_to_caption_ms: z.number().nonnegative(),
  asr_ms: z.number().nonnegative(),
  translation_ms: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),
  warnings: z.array(z.enum(["LOW_CONFIDENCE", "FORCED_SPLIT"])).max(8),
});

export const captionEnvelopeSchema = z.object({
  protocol_version: z.literal(1),
  message_id: z.string().min(1).max(128),
  session_id: z.string().min(1).max(128),
  type: z.enum(["caption.provisional", "caption.final"]),
  sent_monotonic_ns: z.number().int().nonnegative(),
  payload: captionPayloadSchema,
});

export type CaptionEnvelope = z.infer<typeof captionEnvelopeSchema>;
export type CaptionPayload = z.infer<typeof captionPayloadSchema>;
export type SidecarStatus = z.infer<typeof sidecarStatusSchema>;
