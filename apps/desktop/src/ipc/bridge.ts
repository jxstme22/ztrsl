import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  captionEnvelopeSchema,
  sidecarStatusSchema,
  type CaptionEnvelope,
  type SidecarStatus,
} from "./model";

export async function startSidecar(): Promise<SidecarStatus> {
  if (!isTauri()) {
    return { state: "ready", provider: "fake", restartable: true };
  }
  return sidecarStatusSchema.parse(await invoke("start_fake_sidecar"));
}

export async function stopSidecar(): Promise<SidecarStatus> {
  if (!isTauri()) {
    return { state: "stopped", provider: "fake", restartable: true };
  }
  return sidecarStatusSchema.parse(await invoke("stop_fake_sidecar"));
}

export async function runFakeInference(): Promise<CaptionEnvelope[]> {
  if (!isTauri()) {
    const started = 100_000_000;
    const payload = {
      caption_id: "browser-fake-1",
      utterance_id: "browser-utterance-1",
      source_mode: "cebuano" as const,
      source_text: "Adto ta sa B, naa na sila sa A.",
      started_monotonic_ns: started,
      capture_to_caption_ms: 18,
      asr_ms: 4,
      translation_ms: 2,
      confidence: null,
      warnings: [],
    };
    return captionEnvelopeSchema.array().parse([
      {
        protocol_version: 1,
        message_id: "caption-1",
        session_id: "browser-session",
        type: "caption.provisional",
        sent_monotonic_ns: started + 1,
        payload: {
          ...payload,
          revision: 1,
          status: "provisional",
          english_text: "Let's rotate to B…",
          ended_monotonic_ns: null,
        },
      },
      {
        protocol_version: 1,
        message_id: "caption-2",
        session_id: "browser-session",
        type: "caption.final",
        sent_monotonic_ns: started + 2,
        payload: {
          ...payload,
          revision: 2,
          status: "final",
          english_text: "Let's rotate to B—they're already on A.",
          ended_monotonic_ns: started + 20_000_000,
        },
      },
    ]);
  }
  return captionEnvelopeSchema
    .array()
    .parse(await invoke("fake_inference_roundtrip"));
}

export async function runFakeMultiSourceInference(): Promise<
  CaptionEnvelope[]
> {
  if (!isTauri()) {
    throw new Error("multi-source fake inference requires the Tauri runtime");
  }
  return captionEnvelopeSchema
    .array()
    .parse(await invoke("fake_multi_source_roundtrip"));
}
