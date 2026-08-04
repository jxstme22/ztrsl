import { z } from "zod";

import {
  captionAlignmentSchema,
  captionLabelStyleSchema,
} from "../sources/model";

export const captionStatusSchema = z.enum(["provisional", "final", "error"]);

/** Presentation snapshot of the source that produced a caption (Phase 8).
 * Rendered labels come from here — never from a mutable source table — and
 * are escaped data, never HTML. */
export const captionSourceSchema = z.object({
  sourceId: z.string().regex(/^[0-9a-f]{32}$/),
  captionTag: z.string().min(1).max(32),
  labelStyle: captionLabelStyleSchema,
  /** Per-source caption alignment override (v0.5.1). */
  captionAlignment: captionAlignmentSchema.default("center"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
    .nullable(),
});
export type CaptionSource = z.infer<typeof captionSourceSchema>;

/** v0.4 certainty: uncertain captions render with a ? marker; suppressed
 * captions are withheld from the visible lanes (never flashed briefly). */
export const captionCertaintySchema = z
  .object({
    state: z.enum(["normal", "uncertain", "suppressed"]),
    uncertaintyReasons: z.array(z.string()),
    suppressionReason: z.string().nullable(),
  })
  .optional();
export type CaptionCertainty = z.infer<typeof captionCertaintySchema>;

export const captionSchema = z.object({
  id: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  status: captionStatusSchema,
  sourceText: z.string().max(500),
  englishText: z.string().max(500),
  createdAtMs: z.number().nonnegative(),
  expiresAtMs: z.number().nonnegative(),
  /** Source presentation snapshot when this caption came from a v2 source. */
  source: captionSourceSchema.optional(),
  certainty: captionCertaintySchema,
});

export type Caption = z.infer<typeof captionSchema>;

export const overlayModeSchema = z.enum(["play", "edit"]);
export type OverlayMode = z.infer<typeof overlayModeSchema>;

/** How the overlay treats simultaneous captions from different sources. */
export const simultaneousPolicySchema = z.enum([
  "show-both",
  "newest-wins",
  "primary-wins",
]);
export type SimultaneousPolicy = z.infer<typeof simultaneousPolicySchema>;

export const hotkeyActionSchema = z.enum([
  "toggleOverlay",
  "toggleTranslation",
  "toggleEditMode",
  "clearCaptions",
  "increaseText",
  "decreaseText",
  "toggleHistory",
]);

export type HotkeyAction = z.infer<typeof hotkeyActionSchema>;

export const hotkeySettingsSchema = z.object({
  toggleOverlay: z.string().min(3).max(80),
  toggleTranslation: z.string().min(3).max(80),
  toggleEditMode: z.string().min(3).max(80),
  clearCaptions: z.string().min(3).max(80),
  increaseText: z.string().min(3).max(80),
  decreaseText: z.string().min(3).max(80),
  // Defaulted so pre-v0.6.1 persisted settings (without this key) still
  // parse during migration.
  toggleHistory: z.string().min(3).max(80).default("CommandOrControl+Shift+H"),
});

export type HotkeySettings = z.infer<typeof hotkeySettingsSchema>;

/** What the overlay window shows: the live caption bar or the history. */
export const overlayContentSchema = z.enum(["captions", "history"]);
export type OverlayContent = z.infer<typeof overlayContentSchema>;

export const overlaySettingsSchema = z.object({
  schemaVersion: z.literal(2),
  monitorId: z.string().max(256).nullable(),
  xNormalized: z.number().min(0).max(1),
  yNormalized: z.number().min(0).max(1),
  widthNormalized: z.number().min(0.3).max(0.95),
  /** Overlay window height as a fraction of the monitor (history mode). */
  heightNormalized: z.number().min(0.05).max(0.9).default(0.17),
  fontScale: z.number().min(0.8).max(1.6),
  backgroundOpacity: z.number().min(0.35).max(0.9),
  showSource: z.boolean(),
  /** Global caption paragraph alignment; per-source overrides win (v0.5.1). */
  captionAlignment: captionAlignmentSchema.default("center"),
  /** Which source owns the primary caption lane (immutable id). Null = auto. */
  primarySourceId: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  /** Source ids (immutable) whose captions are hidden in the overlay. */
  hiddenSourceIds: z.array(z.string().regex(/^[0-9a-f]{32}$/)),
  simultaneousPolicy: simultaneousPolicySchema,
  /** Overlay window content: live caption bar or the history panel. */
  overlayContent: overlayContentSchema.default("captions"),
  hotkeys: hotkeySettingsSchema,
});

export type OverlaySettings = z.infer<typeof overlaySettingsSchema>;

export const overlaySnapshotSchema = z.object({
  visible: z.boolean(),
  mode: overlayModeSchema,
  translationEnabled: z.boolean(),
  captions: z.array(captionSchema).max(2),
  settings: overlaySettingsSchema,
  /** When true the overlay window renders the captions-history list. */
  historyView: z.boolean().default(false),
});

export type OverlaySnapshot = z.infer<typeof overlaySnapshotSchema>;

export const DEFAULT_HOTKEYS: HotkeySettings = {
  toggleOverlay: "CommandOrControl+Shift+T",
  toggleTranslation: "CommandOrControl+Shift+Y",
  toggleEditMode: "CommandOrControl+Shift+E",
  clearCaptions: "CommandOrControl+Shift+Backspace",
  increaseText: "CommandOrControl+Shift+=",
  decreaseText: "CommandOrControl+Shift+-",
  toggleHistory: "CommandOrControl+Shift+H",
};

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  schemaVersion: 2,
  monitorId: null,
  xNormalized: 0.5,
  yNormalized: 0.72,
  widthNormalized: 0.8,
  heightNormalized: 0.17,
  fontScale: 1,
  backgroundOpacity: 0.45,
  showSource: true,
  captionAlignment: "center",
  primarySourceId: null,
  hiddenSourceIds: [],
  simultaneousPolicy: "show-both",
  overlayContent: "captions",
  hotkeys: DEFAULT_HOTKEYS,
};

export const DEFAULT_OVERLAY_SNAPSHOT: OverlaySnapshot = {
  visible: false,
  mode: "play",
  translationEnabled: true,
  captions: [],
  settings: DEFAULT_OVERLAY_SETTINGS,
  historyView: false,
};

export const HOTKEY_ACTIONS: readonly {
  action: HotkeyAction;
  labelKey:
    | "hotkeyToggleOverlay"
    | "hotkeyToggleTranslation"
    | "hotkeyToggleEditMode"
    | "hotkeyClearCaptions"
    | "hotkeyIncreaseText"
    | "hotkeyDecreaseText"
    | "hotkeyToggleHistory";
}[] = [
  { action: "toggleOverlay", labelKey: "hotkeyToggleOverlay" },
  { action: "toggleTranslation", labelKey: "hotkeyToggleTranslation" },
  { action: "toggleEditMode", labelKey: "hotkeyToggleEditMode" },
  { action: "clearCaptions", labelKey: "hotkeyClearCaptions" },
  { action: "increaseText", labelKey: "hotkeyIncreaseText" },
  { action: "decreaseText", labelKey: "hotkeyDecreaseText" },
  { action: "toggleHistory", labelKey: "hotkeyToggleHistory" },
];
