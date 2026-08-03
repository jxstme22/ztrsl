import { describe, expect, it } from "vitest";

import { captionEnvelopeSchema, captionPayloadSchema } from "./model";

describe("caption IPC schema", () => {
  it("rejects unsupported protocol versions", () => {
    const result = captionEnvelopeSchema.safeParse({
      protocol_version: 3,
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

  it("accepts a valid caption envelope (v1)", () => {
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

  it("accepts a valid caption envelope (v2)", () => {
    const result = captionEnvelopeSchema.safeParse({
      protocol_version: 2,
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

describe("caption v2 fields", () => {
  const v2Fields = {
    source_id: "0123456789abcdef0123456789abcdef",
    source_snapshot: {
      display_name: "Valorant Team",
      caption_tag: "TEAM",
      label_style: "brackets",
      color: "#7dd3fc",
    },
    strictness: "balanced",
    filter_applied: "passed",
    filter_reason: undefined,
  };

  it("accepts a v2 caption with all v2 fields", () => {
    const result = captionPayloadSchema.safeParse({
      caption_id: "c",
      utterance_id: "u",
      revision: 1,
      status: "final",
      source_mode: "mixed",
      source_text: "ilipat sa B",
      english_text: "rotate to B",
      started_monotonic_ns: 1,
      ended_monotonic_ns: 2,
      capture_to_caption_ms: 1,
      asr_ms: 1,
      translation_ms: 1,
      confidence: null,
      warnings: [],
      ...v2Fields,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a v1 caption without v2 fields", () => {
    const result = captionPayloadSchema.safeParse({
      caption_id: "c",
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
    });

    expect(result.success).toBe(true);
  });

  it("rejects malformed source_id", () => {
    const result = captionPayloadSchema.safeParse({
      caption_id: "c",
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
      source_id: "NOT-HEX",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown label style", () => {
    const result = captionPayloadSchema.safeParse({
      caption_id: "c",
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
      source_snapshot: {
        display_name: "x",
        caption_tag: "X",
        label_style: "matrix",
        color: null,
      },
    });

    expect(result.success).toBe(false);
  });
});
