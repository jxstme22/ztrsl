# Phase 9 — Model Manager v2

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 9)

1. Catalogs expose capabilities + recommended resource profiles.
2. Providers are lists with probing and failover; Hugging Face unavailability is not fatal.
3. ModelScope and mainland-CN providers work.
4. Signed catalogs and offline packs are supported.
5. Custom `LST_HF_ENDPOINT` mirror choice is preserved.

## Implementation

### `provider.rs` — provider registry + region + failover (ADR-018)

A provider-neutral registry with `HuggingFace`, `HfMirror`, `ModelScope`, and a
user `Custom` endpoint. `rewrite_for_provider` maps a pinned `huggingface.co`
URL onto each provider's host (mirrors never rewrite non-HF URLs).
`region_from_str` / `region_from_env` (`LST_REGION=cn`) select the candidate
order:

- Global: `huggingface → hf-mirror → modelscope`
- Mainland-CN: `hf-mirror → modelscope → huggingface`
- A custom endpoint (the v0.2 `LST_HF_ENDPOINT` / in-app download-server
  setting) is inserted at the front of the chain and preserved.

The installer now downloads via `candidate_urls` with `fetch_with_failover`:
transport errors fall through to the next provider, but a downloaded artifact
that fails the pinned SHA-256 **aborts** the install — failover can never
substitute a different artifact. Tests prove fall-through on transport error
and abort when every provider is unreachable.

### `capabilities.rs` — honest capability metadata

`ModelCapabilities { language_capability: Forced|Preferred|PostFilter,
recommended_profiles, vram_class }` ships in the catalog and is surfaced to the
UI through `CatalogEntryView.capabilities`. Entries without explicit data get a
conservative derived default (`PostFilter`, no recommended profiles) so the UI
never overclaims a decoder lock — only fixed-language CTC (`sherpa-onnx`)
models derive `Forced`. Tests assert multilingual runtimes never claim a forced
language and that the camelCase webview view carries the fields.

### `signed_catalog.rs` — Ed25519 catalog signatures (ADR-004 chain)

`verify_catalog_signature(payload, public_key_hex, signature_hex)` verifies an
Ed25519 signature over canonical catalog bytes; a malformed signature, unknown
key, or tampered payload fails closed. `sign_payload`/`public_key_for` exist for
the release signing tool and tests. The public key is embedded in the binary;
production signing keys are never committed.

### `offline_pack.rs` — verified offline installs

`import_offline_pack(pack_dir, store, public_key)` installs a pre-downloaded
`manifest.json` + artifact directory with **no network**: every artifact is
size-checked and SHA-256 verified against the manifest, then staged and
atomically renamed into the store (same guarantees as ADR-004). A manifest that
claims a signature must verify; unsafe paths are rejected. Tests cover clean
import, corrupted checksum, missing artifact, unsafe path, and signed-pack
rejection without a verification key.

### Desktop wiring

- `models_list` now carries `capabilities` through `CatalogEntryView`.
- New `models_providers` command returns `{ region, providers[] }` in failover
  order for honest UI status.
- New `models_import_offline_pack` command imports a verified pack directory.
- `ModelsPanel` shows capability honesty per model ("Fixed-language decoder",
  "Language-biased (no hard lock)", "Filters after recognition"), VRAM class,
  recommended profiles, the provider order line under the download server, and
  an offline-pack import row. The `DownloadServerRow` custom-endpoint behavior
  (`LST_HF_ENDPOINT` / in-app choice) is preserved unchanged.

## Files

- `crates/model-manager/src/provider.rs`, `capabilities.rs`, `signed_catalog.rs`,
  `offline_pack.rs` (new)
- `crates/model-manager/src/catalog.rs` (`CatalogEntry.capabilities`,
  `CatalogEntryView.capabilities`, `ModelKind` Copy)
- `crates/model-manager/src/installer.rs` (provider failover)
- `crates/model-manager/src/lib.rs` (exports, `Error::Signature`)
- `Cargo.toml` (workspace `ed25519-dalek`)
- `apps/desktop/src-tauri/src/lib.rs` (`models_providers`,
  `models_import_offline_pack`)
- `apps/desktop/src/models/{model,bridge,useModels}.ts`,
  `apps/desktop/src/components/ModelsPanel.tsx`, `styles.css`
- `apps/desktop/src/models/{model,useModels}.test.ts`

## Evidence

- `model-manager` crate: **40 tests** pass (16 prior + 24 new across provider
  order/dedupe/rewrite, region, capabilities honesty, signature accept/tamper/
  wrong-key/malformed, offline-pack import/corruption/missing/unsafe/signed,
  installer failover + all-providers-down). `cargo clippy --workspace
  --all-targets` clean, `cargo fmt --check` clean.
- Workspace: `94 passed, 3 ignored`.
- Desktop: `pnpm typecheck`, `pnpm lint`, `pnpm test` (156) clean.
- Offline-pack and signature rejection are exercised offline in tests; the
  ModelScope provider path is covered by the failover order unit tests
  (network to modelscope.cn is simulated by the fake fetcher keyed on the
  mirror URL, per the evidence policy).
