import { describe, expect, it } from "vitest";

import { captionEnvelopeSchema } from "./model";

describe("caption IPC schema", () => {
  it("rejects unversioned messages (wrong protocol version)", () => {
    const result = captionEnvelopeSchema.safeParse({
      protocol_version: 2,
      message_id: "message",
      session_id: "session",
      type: "caption.final",
      sent_monotonic_ns: 1,
      payload: {
        caption_id: "caption",
        utterance_id: "utterance",
        revision: 1,
        status: "final",
        source_mode: "mixed",
        source_text: "",
        english_text: "",
        started_monotonic_ns: 1,
        ended_monotonic_ns: 2,
        capture_to_caption_ms: 1,
        asr_ms: 1,
        translation_ms: 1,
        confidence: null,
        warnings: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid caption envelope", () => {
    const result = captionEnvelopeSchema.safeParse({
      protocol_version: 1,
      message_id: "m",
      session_id: "s",
      type: "caption.final",
      sent_monotonic_ns: 1,
      payload: {
        caption_id: "c",
        utterance_id: "u",
        revision: 1,
        status: "final",
        source_mode: "mixed",
        source_text: "A long but legitimately sized caption",
        english_text: "Translated text",
        started_monotonic_ns: 1,
        ended_monotonic_ns: 2,
        capture_to_caption_ms: 1,
        asr_ms: 1,
        translation_ms: 1,
        confidence: null,
        warnings: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing required caption_id", () => {
    const result = captionEnvelopeSchema.safeParse({
      protocol_version: 1,
      message_id: "m",
      session_id: "s",
      type: "caption.final",
      sent_monotonic_ns: 1,
      payload: {
        utterance_id: "u",
        revision: 1,
        status: "final",
        source_mode: "mixed",
        source_text: "",
        english_text: "",
        started_monotonic_ns: 1,
        ended_monotonic_ns: 2,
        capture_to_caption_ms: 1,
        asr_ms: 1,
        translation_ms: 1,
        confidence: null,
        warnings: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects source_text exceeding 8000 chars", () => {
    const result = captionEnvelopeSchema.safeParse({
      protocol_version: 1,
      message_id: "m",
      session_id: "s",
      type: "caption.final",
      sent_monotonic_ns: 1,
      payload: {
        caption_id: "c",
        utterance_id: "u",
        revision: 1,
        status: "final",
        source_mode: "mixed",
        source_text: "x".repeat(8001),
        english_text: "",
        started_monotonic_ns: 1,
        ended_monotonic_ns: 2,
        capture_to_caption_ms: 1,
        asr_ms: 1,
        translation_ms: 1,
        confidence: null,
        warnings: [],
      },
    });

    expect(result.success).toBe(false);
  });
});
