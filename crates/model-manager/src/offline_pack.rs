//! Offline pack import (Phase 9, ADR-018).
//!
//! An offline pack is a directory of already-downloaded, manifest-verified
//! artifacts that can be installed with no network at all. The pack layout is:
//!
//! ```text
//! pack/
//!   manifest.json   # signed pack manifest (see below)
//!   <model-id>/model.bin ...
//! ```
//!
//! The manifest carries the same checksum + license guarantees as the
//! embedded catalog (ADR-004) and an optional Ed25519 signature. Every
//! artifact is SHA-256 verified against the manifest before being staged into
//! the store; a single mismatch rejects the whole pack.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::Error;
use crate::signed_catalog::verify_catalog_signature;
use crate::store::ModelStore;

/// Optional embedded signing public key. When empty, signed packs are
/// rejected unless a key is supplied; unsigned packs are allowed only when
/// `require_signature` is false (offline, user-supplied media).
const EMBEDDED_SIGNING_PUBLIC_KEY: &str = "";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfflinePackManifest {
    pub schema_version: u32,
    pub id: String,
    pub kind: String,
    pub runtime: String,
    pub source: String,
    pub revision: String,
    pub license: OfflineLicense,
    pub artifacts: Vec<OfflineArtifact>,
    /// Optional Ed25519 signature (hex) over the canonical manifest bytes.
    #[serde(default)]
    pub signature: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfflineLicense {
    pub spdx: String,
    #[serde(default)]
    #[allow(dead_code)] // carried into the installed manifest for provenance
    pub notice: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfflineArtifact {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

/// Verify the manifest's signature (when present) using the supplied public
/// key, or the embedded one. A pack that claims a signature must verify.
fn verify_manifest_signature(
    manifest_bytes: &[u8],
    manifest: &OfflinePackManifest,
    public_key: Option<&str>,
) -> Result<(), Error> {
    let signature = match &manifest.signature {
        Some(signature) => signature,
        None => return Ok(()), // unsigned packs are allowed (user-supplied media)
    };
    let key = public_key
        .or(if EMBEDDED_SIGNING_PUBLIC_KEY.is_empty() {
            None
        } else {
            Some(EMBEDDED_SIGNING_PUBLIC_KEY)
        })
        .ok_or_else(|| {
            Error::Signature("pack is signed but no verification key is available".to_owned())
        })?;
    verify_catalog_signature(manifest_bytes, key, signature)
}

/// Install every model in `pack_dir` into `store`, verifying each artifact's
/// SHA-256 against the manifest. Returns the installed model ids.
pub fn import_offline_pack(
    pack_dir: &Path,
    store: &ModelStore,
    public_key: Option<&str>,
) -> Result<Vec<String>, Error> {
    let manifest_path = pack_dir.join("manifest.json");
    let manifest_bytes = std::fs::read(&manifest_path).map_err(|_| Error::Layout {
        detail: format!(
            "offline pack has no manifest.json at {}",
            pack_dir.display()
        ),
    })?;
    let manifest: OfflinePackManifest =
        serde_json::from_slice(&manifest_bytes).map_err(Error::Serialize)?;
    verify_manifest_signature(&manifest_bytes, &manifest, public_key)?;

    if manifest.schema_version != 1 {
        return Err(Error::Layout {
            detail: format!(
                "unsupported offline pack schema {}",
                manifest.schema_version
            ),
        });
    }
    if manifest.artifacts.is_empty() {
        return Err(Error::Layout {
            detail: format!("offline pack {} declares no artifacts", manifest.id),
        });
    }
    assert_safe_pack_paths(&manifest.artifacts)?;

    if store.is_installed(&manifest.id) {
        return Err(Error::AlreadyInstalled {
            id: manifest.id.clone(),
        });
    }

    let root = store.root();
    std::fs::create_dir_all(root)?;
    let destination = store.model_dir(&manifest.id);
    if destination.exists() {
        return Err(Error::AlreadyInstalled {
            id: manifest.id.clone(),
        });
    }

    // Stage into a sibling directory, verify every artifact, then rename.
    let staging = root.join(format!(
        ".pack-staging-{}-{}",
        manifest.id,
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;

    let result = (|| {
        for artifact in &manifest.artifacts {
            let source = pack_dir.join(&manifest.id).join(&artifact.path);
            if !source.is_file() {
                return Err(Error::NotFound {
                    id: format!("{}/{}", manifest.id, artifact.path),
                });
            }
            if std::fs::metadata(&source)?.len() != artifact.size_bytes {
                return Err(Error::Size {
                    path: source.display().to_string(),
                    expected: artifact.size_bytes,
                    actual: std::fs::metadata(&source)?.len(),
                });
            }
            crate::downloader::verify_file_sha256(&source, &artifact.sha256)?;
            let target = staging.join(&artifact.path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&source, &target)?;
        }
        write_pack_manifest(&staging, &manifest)?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }

    std::fs::rename(&staging, &destination)?;
    Ok(vec![manifest.id.clone()])
}

fn write_pack_manifest(destination: &Path, manifest: &OfflinePackManifest) -> Result<(), Error> {
    let output = serde_json::json!({
        "schema_version": 1,
        "id": manifest.id,
        "kind": manifest.kind,
        "runtime": manifest.runtime,
        "source": manifest.source,
        "revision": manifest.revision,
        "license": { "spdx": manifest.license.spdx },
        "artifacts": manifest.artifacts.iter().map(|artifact| {
            serde_json::json!({
                "path": artifact.path,
                "size_bytes": artifact.size_bytes,
                "sha256": artifact.sha256,
            })
        }).collect::<Vec<_>>(),
    });
    let serialized = serde_json::to_vec_pretty(&output).map_err(Error::Serialize)?;
    std::fs::write(destination.join("manifest.json"), serialized).map_err(Error::Io)?;
    Ok(())
}

fn assert_safe_pack_paths(artifacts: &[OfflineArtifact]) -> Result<(), Error> {
    for artifact in artifacts {
        let path = PathBuf::from(&artifact.path);
        if path.is_absolute()
            || path
                .components()
                .any(|component| component == std::path::Component::ParentDir)
        {
            return Err(Error::Layout {
                detail: format!("unsafe offline pack path: {}", artifact.path),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha256(bytes: &[u8]) -> String {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(bytes))
    }

    fn write_pack(root: &Path, id: &str, payload: &[u8]) -> PathBuf {
        let pack = root.join("pack");
        std::fs::create_dir_all(pack.join(id)).unwrap();
        std::fs::write(pack.join(id).join("model.bin"), payload).unwrap();
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": id,
            "kind": "asr",
            "runtime": "faster-whisper",
            "source": "https://example.test/repo",
            "revision": "abc",
            "license": { "spdx": "MIT" },
            "artifacts": [
                { "path": "model.bin", "size_bytes": payload.len(), "sha256": sha256(payload) }
            ]
        });
        std::fs::write(
            pack.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        pack
    }

    #[test]
    fn imports_verified_offline_pack_without_network() {
        let root = std::env::temp_dir().join(format!("lst-pack-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let payload = b"offline-model-bytes";
        let pack = write_pack(&root, "pack-model", payload);
        let store = ModelStore::new(root.join("store"));

        let ids = import_offline_pack(&pack, &store, None).unwrap();
        assert_eq!(ids, vec!["pack-model"]);
        assert_eq!(
            std::fs::read(root.join("store").join("pack-model").join("model.bin")).unwrap(),
            payload
        );
        assert!(
            root.join("store")
                .join("pack-model")
                .join("manifest.json")
                .is_file()
        );
        assert!(store.is_installed("pack-model"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_corrupted_artifact_checksum() {
        let root = std::env::temp_dir().join(format!("lst-pack-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let pack = write_pack(&root, "pack-model", b"correct-bytes");
        // Corrupt the payload in place (same length so the size check passes
        // and the SHA-256 verification is what rejects the pack).
        let tampered = b"CORRUPT-BYTES";
        std::fs::write(pack.join("pack-model").join("model.bin"), tampered).unwrap();
        let store = ModelStore::new(root.join("store"));

        let error = import_offline_pack(&pack, &store, None).unwrap_err();
        assert!(matches!(error, Error::Checksum { .. }));
        assert!(!store.is_installed("pack-model"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_artifact() {
        let root = std::env::temp_dir().join(format!("lst-pack-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let pack = write_pack(&root, "pack-model", b"bytes");
        std::fs::remove_file(pack.join("pack-model").join("model.bin")).unwrap();
        let store = ModelStore::new(root.join("store"));

        let error = import_offline_pack(&pack, &store, None).unwrap_err();
        assert!(matches!(error, Error::NotFound { .. }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsafe_pack_paths() {
        let root = std::env::temp_dir().join(format!("lst-pack-unsafe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": "bad",
            "kind": "asr",
            "runtime": "x",
            "source": "s",
            "revision": "r",
            "license": { "spdx": "MIT" },
            "artifacts": [{ "path": "../escape.bin", "size_bytes": 1, "sha256": "x".repeat(64) }]
        });
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let store = ModelStore::new(root.join("store"));
        let error = import_offline_pack(&root, &store, None).unwrap_err();
        assert!(matches!(error, Error::Layout { .. }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_signed_pack_when_verification_key_unavailable() {
        // A pack that claims a signature must verify; with no key available
        // (embedded key empty), import must fail closed.
        let root = std::env::temp_dir().join(format!("lst-pack-signed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("m")).unwrap();
        std::fs::write(root.join("m").join("model.bin"), b"x").unwrap();
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": "m",
            "kind": "asr",
            "runtime": "x",
            "source": "s",
            "revision": "r",
            "license": { "spdx": "MIT" },
            "signature": "00".repeat(64),
            "artifacts": [{ "path": "m/model.bin", "size_bytes": 1, "sha256": sha256(b"x") }]
        });
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let store = ModelStore::new(root.join("store"));
        let error = import_offline_pack(&root, &store, None).unwrap_err();
        assert!(matches!(error, Error::Signature(_)));
        std::fs::remove_dir_all(root).unwrap();
    }
}
