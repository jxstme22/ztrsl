import { describe, expect, it } from "vitest";

import { captionEnvelopeSchema } from "./model";

describe("caption IPC schema", () => {
  it("rejects unversioned or content-unbounded messages", () => {
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
        english_text: "x".repeat(501),
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
