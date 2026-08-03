/**
 * v0.3 multi-source feature flag (TS mirror).
 *
 * Mirrors the Rust-side flag in `apps/desktop/src-tauri/src/lib.rs`
 * (`AppStatus.multi_source`, env `LST_MULTI_SOURCE`, default enabled for
 * v0.3 development). When disabled, the app must behave exactly like v0.2.
 *
 * The runtime value should be reconciled with the Rust `app_status` command
 * when the command is surfaced to the frontend (Phase 2/4); until then the
 * constant is the source of truth for the UI.
 */
export const MULTI_SOURCE_ENABLED = true;

export function multiSourceEnabled(): boolean {
  return MULTI_SOURCE_ENABLED;
}
