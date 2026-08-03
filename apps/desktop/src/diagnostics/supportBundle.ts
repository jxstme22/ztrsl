/**
 * Content-free support bundle export (Phase 10).
 *
 * A support bundle is a JSON document of METRICS + CONFIG ONLY. It must
 * never contain transcripts, source audio content, or any speech-derived
 * text. Every field is whitelisted by the schemas it is built from; the
 * export test asserts no transcript keys ever appear in the archive.
 */

import type { DiagnosticsSnapshot } from "./model";
import type { SourceConfigs } from "../sources/model";
import type { OverlaySettings } from "../overlay/model";

export type SupportBundleV1 = {
  schemaVersion: 1;
  appVersion: string;
  exportedAtMs: number;
  platform: string;
  diagnostics: DiagnosticsSnapshot;
  sourceConfigs: {
    sourceId: string;
    displayName: string;
    captionTag: string;
    languageProfile: string;
    strictness: string;
  }[];
  overlaySettings: Pick<
    OverlaySettings,
    | "monitorId"
    | "xNormalized"
    | "yNormalized"
    | "widthNormalized"
    | "fontScale"
    | "backgroundOpacity"
    | "showSource"
    | "simultaneousPolicy"
  >;
};

/** The keys that would indicate speech content leaked into a bundle. Any of
 * these appearing in the serialized export means the bundle is corrupted. */
const LEAKED_KEYS = [
  "english_text",
  "englishText",
  "source_text",
  "sourceText",
  "transcript",
  "text:",
  "samples",
  "audio",
];

/** Build a content-free support bundle from diagnostics + configs. The only
 * speech-adjacent data is a count of captions emitted, never their text. */
export function buildSupportBundle(input: {
  appVersion: string;
  platform: string;
  diagnostics: DiagnosticsSnapshot;
  sourceConfigs: SourceConfigs | null;
  overlaySettings: OverlaySettings;
}): SupportBundleV1 {
  const { diagnostics, sourceConfigs, overlaySettings } = input;
  return {
    schemaVersion: 1,
    appVersion: input.appVersion,
    exportedAtMs: Date.now(),
    platform: input.platform,
    diagnostics,
    sourceConfigs:
      sourceConfigs === null
        ? []
        : sourceConfigs.sources.map((source) => ({
            sourceId: source.sourceId,
            displayName: source.displayName,
            captionTag: source.captionTag,
            languageProfile: source.languageProfile,
            strictness: source.strictness,
          })),
    overlaySettings: {
      monitorId: overlaySettings.monitorId,
      xNormalized: overlaySettings.xNormalized,
      yNormalized: overlaySettings.yNormalized,
      widthNormalized: overlaySettings.widthNormalized,
      fontScale: overlaySettings.fontScale,
      backgroundOpacity: overlaySettings.backgroundOpacity,
      showSource: overlaySettings.showSource,
      simultaneousPolicy: overlaySettings.simultaneousPolicy,
    },
  };
}

/** Serialize a support bundle and assert it is content-free. Throws when any
 * transcript key is present, so a leak can never be exported silently. */
export function serializeContentFree(bundle: SupportBundleV1): string {
  const serialized = JSON.stringify(bundle, null, 2);
  for (const leaked of LEAKED_KEYS) {
    if (serialized.includes(leaked)) {
      throw new Error(
        `refusing to export support bundle: suspected transcript leak ("${leaked}")`,
      );
    }
  }
  return serialized;
}
