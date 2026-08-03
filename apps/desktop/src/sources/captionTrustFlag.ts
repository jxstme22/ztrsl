/**
 * v0.4 caption-accuracy feature flag (TS mirror).
 *
 * Mirrors the Rust-side flag in `apps/desktop/src-tauri/src/lib.rs`
 * (`AppStatus.caption_trust`, env `LST_CAPTION_TRUST`, default enabled for
 * v0.4 development). When disabled, the app behaves exactly like v0.3 —
 * certainty states, phrase filters, glossary, and Accuracy Lab are hidden.
 */
export const CAPTION_TRUST_ENABLED = true;

export function captionTrustEnabled(): boolean {
  return CAPTION_TRUST_ENABLED;
}
