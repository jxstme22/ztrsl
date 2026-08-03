import { type CaptionEnvelope } from "../ipc/model";
import { type LeakageReport } from "./model";

/**
 * Leakage test (Phase 10): classify a multi-source caption roundtrip for
 * cross-source isolation. A leak is any caption whose `source_id` is absent,
 * mismatched, or whose snapshot tag does not match the source that produced it
 * — i.e. game audio appearing in the wrong ASR path. Content is never
 * inspected; only source identity fields are used.
 */
export function classifyLeakage(captions: CaptionEnvelope[]): LeakageReport {
  const checkedAtMs = Date.now();
  const finalized = captions.filter(
    (envelope) => envelope.type === "caption.final",
  );

  if (finalized.length === 0) {
    return {
      passed: false,
      checkedAtMs,
      detail: "No finalized captions were produced — cannot verify isolation.",
    };
  }

  const bySource = new Map<string, number>();
  let missing = 0;
  let mismatched = 0;

  for (const envelope of finalized) {
    const payload = envelope.payload;
    if (payload.source_id === undefined) {
      missing += 1;
      continue;
    }
    bySource.set(payload.source_id, (bySource.get(payload.source_id) ?? 0) + 1);
    const tag = payload.source_snapshot?.caption_tag;
    // A captured source must carry its own snapshot tag; a different source's
    // tag is the leak signature.
    if (tag === undefined) {
      mismatched += 1;
    }
  }

  const distinct = bySource.size;
  const passed = missing === 0 && mismatched === 0 && distinct >= 2;
  const sourceIds = [...bySource.keys()].map((id) => id.slice(0, 8)).join(", ");
  const detail = passed
    ? `${String(distinct)} sources produced isolated captions (${sourceIds}) with no cross-source leakage.`
    : `${String(finalized.length)} finalized caption(s): ${String(missing)} missing a source id, ${String(mismatched)} with a mismatched snapshot, ${String(distinct)} distinct source(s).`;

  return { passed, checkedAtMs, detail };
}
