//! Model catalog: the pinned, verified list of downloadable model artifacts.
//!
//! The catalog is a single checked-in JSON file (`models/catalog.json`) that is
//! embedded into the binary at compile time. Every download is pinned to an
//! exact revision and per-file SHA-256; nothing is fetched from a non-pinned
//! URL, and no API keys are ever part of the catalog.

use serde::Deserialize;

use crate::capabilities::{CapabilitiesView, ModelCapabilities, capabilities_for};

/// Embedded, verified catalog source.
pub const CATALOG_JSON: &str = include_str!("../../../models/catalog.json");

/// Default Hugging Face host. `HF_ENDPOINT` (huggingface_hub convention) or
/// `LST_HF_ENDPOINT` overrides it so users behind the Great Firewall can use
/// `https://hf-mirror.com` without rebuilding the catalog.
pub const DEFAULT_HF_ENDPOINT: &str = "https://huggingface.co";

/// Resolve the Hugging Face endpoint honoring, in order: `LST_HF_ENDPOINT`,
/// `HF_ENDPOINT`, then the upstream default.
pub fn huggingface_endpoint() -> String {
    for key in ["LST_HF_ENDPOINT", "HF_ENDPOINT"] {
        if let Some(value) = std::env::var_os(key) {
            let value = value
                .to_string_lossy()
                .trim()
                .trim_end_matches('/')
                .to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }
    DEFAULT_HF_ENDPOINT.to_owned()
}

/// Rewrite a Hugging Face download URL onto `endpoint` (used for mirror
/// support). Non-HF URLs are returned untouched.
pub fn rewrite_hf_url(url: &str, endpoint: &str) -> String {
    let prefix = format!("{DEFAULT_HF_ENDPOINT}/");
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == DEFAULT_HF_ENDPOINT {
        return url.to_owned();
    }
    url.strip_prefix(&prefix)
        .map(|rest| format!("{trimmed}/{rest}"))
        .unwrap_or_else(|| url.to_owned())
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct ModelCatalog {
    pub schema_version: u32,
    pub models: Vec<CatalogEntry>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub kind: ModelKind,
    pub runtime: String,
    #[serde(default)]
    pub recommended: bool,
    pub description: String,
    pub license: CatalogLicense,
    pub download_size_bytes: u64,
    pub source: String,
    pub revision: String,
    /// Platforms the model runs on. Empty means "all platforms"; otherwise a
    /// subset of `windows` / `macos`. Used to hide platform-specific models
    /// (e.g. the MLX Whisper weights) from platforms that cannot run them.
    #[serde(default)]
    pub platforms: Vec<String>,
    /// Plain file artifacts (HuggingFace-style `source/resolve/revision/path`).
    #[serde(default)]
    pub files: Vec<CatalogFile>,
    /// Optional single archive that is downloaded, verified and extracted.
    #[serde(default)]
    pub archive: Option<CatalogArchive>,
    /// Optional capability metadata (Phase 9). When absent, a conservative
    /// default is derived so the UI never overclaims.
    #[serde(default)]
    pub capabilities: Option<ModelCapabilities>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Asr,
    Translation,
    Vad,
}

impl CatalogEntry {
    /// True when this entry can run on the current build target. An empty
    /// `platforms` list means "all platforms".
    pub fn runs_on_current_platform(&self) -> bool {
        if self.platforms.is_empty() {
            return true;
        }
        let current = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            return false;
        };
        self.platforms.iter().any(|platform| platform == current)
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct CatalogLicense {
    pub spdx: String,
    #[serde(default)]
    pub notice: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct CatalogFile {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct CatalogArchive {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub url: String,
    /// Leading path components to drop when extracting (e.g. 1 for a single
    /// top-level directory inside the archive).
    pub strip_components: u32,
    /// Only these relative paths are copied out of the archive. Empty means
    /// "extract everything under the stripped root".
    #[serde(default)]
    pub extract_only: Vec<String>,
}

/// Serializable view of a catalog entry for the frontend (no secrets, only
/// what the confirmation dialog needs). Keys are camelCase to match the
/// TypeScript Zod schemas consumed by the Tauri webview.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntryView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub runtime: String,
    pub recommended: bool,
    pub description: String,
    pub license_spdx: String,
    pub license_notice: String,
    pub download_size_bytes: u64,
    pub source: String,
    pub revision: String,
    pub file_count: usize,
    /// Honest capability metadata (Phase 9): forced/preferred/post-filter
    /// language handling, recommended profiles, VRAM class.
    pub capabilities: CapabilitiesView,
}

impl ModelCatalog {
    pub fn embedded() -> Self {
        serde_json::from_str(CATALOG_JSON)
            .expect("embedded model catalog must parse (invalid models/catalog.json)")
    }

    pub fn entry(&self, id: &str) -> Option<&CatalogEntry> {
        self.models.iter().find(|entry| entry.id == id)
    }
    pub fn view(&self) -> Vec<CatalogEntryView> {
        self.models
            .iter()
            .filter(|entry| entry.runs_on_current_platform())
            .map(|entry| CatalogEntryView {
                id: entry.id.clone(),
                name: entry.name.clone(),
                kind: format!("{:?}", entry.kind).to_lowercase(),
                runtime: entry.runtime.clone(),
                recommended: entry.recommended,
                description: entry.description.clone(),
                license_spdx: entry.license.spdx.clone(),
                license_notice: entry.license.notice.clone(),
                download_size_bytes: entry.download_size_bytes,
                source: entry.source.clone(),
                revision: entry.revision.clone(),
                file_count: entry.files.len() + usize::from(entry.archive.is_some()),
                capabilities: CapabilitiesView::from(&capabilities_for(entry)),
            })
            .collect()
    }

    /// Derive the pinned download URL for a plain file artifact. `endpoint`
    /// is the Hugging Face host to use (see `huggingface_endpoint`); mirrors
    /// like hf-mirror.com are honored without changing the pinned revision.
    pub fn file_url(&self, entry: &CatalogEntry, file: &CatalogFile, endpoint: &str) -> String {
        rewrite_hf_url(
            &format!(
                "{}/resolve/{}/{}",
                entry.source.trim_end_matches('/'),
                entry.revision,
                file.path
            ),
            endpoint,
        )
    }

    pub fn validate(&self) -> Result<(), String> {
        let mut seen = std::collections::HashSet::new();
        for entry in &self.models {
            if !seen.insert(entry.id.clone()) {
                return Err(format!("duplicate model id: {}", entry.id));
            }
            if entry.files.is_empty() && entry.archive.is_none() {
                return Err(format!("model {} has no artifacts", entry.id));
            }
            if let Some(archive) = &entry.archive {
                if archive.strip_components == 0 {
                    return Err(format!("model {} archive must strip components", entry.id));
                }
            }
            for file in &entry.files {
                if file.path.contains("..") || file.path.starts_with('/') {
                    return Err(format!("model {} has unsafe file path", entry.id));
                }
            }
            for platform in &entry.platforms {
                if platform != "windows" && platform != "macos" {
                    return Err(format!(
                        "model {} has unknown platform restriction: {platform}",
                        entry.id
                    ));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses_and_is_consistent() {
        let catalog = ModelCatalog::embedded();
        catalog.validate().expect("catalog must validate");
        assert!(catalog.models.len() >= 4);
        let turbo = catalog
            .entry("whisper-large-v3-turbo")
            .expect("turbo entry");
        assert_eq!(turbo.kind, ModelKind::Asr);
        assert!(turbo.recommended);
        let nllb = catalog
            .entry("nllb-200-distilled-600M-ct2-int8")
            .expect("nllb");
        assert_eq!(nllb.kind, ModelKind::Translation);
        assert!(nllb.files.iter().all(|f| f.sha256.len() == 64));
        assert_eq!(
            nllb.files.iter().map(|f| f.size_bytes).sum::<u64>(),
            nllb.download_size_bytes
        );
    }

    #[test]
    fn file_url_uses_pinned_revision() {
        let catalog = ModelCatalog::embedded();
        let entry = catalog.entry("whisper-large-v3-turbo").unwrap();
        let url = catalog.file_url(entry, &entry.files[0], DEFAULT_HF_ENDPOINT);
        assert!(url.starts_with("https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/resolve/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/"));
        assert!(url.ends_with("/model.bin"));
    }

    #[test]
    fn mirror_endpoint_rewrites_hf_urls_only() {
        let catalog = ModelCatalog::embedded();
        let entry = catalog.entry("whisper-large-v3-turbo").unwrap();
        let url = catalog.file_url(entry, &entry.files[0], "https://hf-mirror.com");
        assert!(url.starts_with(
            "https://hf-mirror.com/dropbox-dash/faster-whisper-large-v3-turbo/resolve/"
        ));
        let archive_url =
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/model.tar.bz2";
        assert_eq!(
            rewrite_hf_url(archive_url, "https://hf-mirror.com"),
            archive_url
        );
        // Trailing slashes on the endpoint are normalized.
        let url = catalog.file_url(entry, &entry.files[0], "https://hf-mirror.com/");
        assert!(url.starts_with("https://hf-mirror.com/dropbox-dash/"));
    }

    #[test]
    fn github_archives_are_mirrored_on_hugging_face() {
        // Both models were originally GitHub release archives, which are
        // unreachable for mainland-China users (the hf-mirror chain only
        // rewrites huggingface.co URLs). They now download file-by-file
        // from the official sherpa-onnx Hugging Face mirrors, where every
        // artifact was verified byte-identical to the GitHub archive.
        let catalog = ModelCatalog::embedded();
        for id in ["omni-ctc-300m-int8", "paraformer-zh-streaming"] {
            let entry = catalog.entry(id).expect("entry");
            assert!(entry.archive.is_none(), "{id} must not use a GitHub archive");
            assert!(!entry.files.is_empty(), "{id} must have files");
            assert!(entry.source.starts_with("https://huggingface.co/"));
            assert_eq!(
                entry.files.iter().map(|f| f.size_bytes).sum::<u64>(),
                entry.download_size_bytes,
                "{id} download size must match its files"
            );
        }
    }

    #[test]
    fn views_have_no_secret_fields() {
        let catalog = ModelCatalog::embedded();
        for view in catalog.view() {
            assert!(!view.id.contains("key") && !view.source.contains("token="));
        }
    }

    #[test]
    fn platform_restricted_entries_are_filtered() {
        let entry = serde_json::from_value::<CatalogEntry>(serde_json::json!({
            "id": "mlx-whisper",
            "name": "MLX",
            "kind": "asr",
            "runtime": "mlx-whisper",
            "recommended": false,
            "description": "d",
            "license": { "spdx": "MIT" },
            "download_size_bytes": 1,
            "source": "https://huggingface.co/mlx-community/test",
            "revision": "r",
            "platforms": ["macos"],
            "files": [
                { "path": "weights.npz", "size_bytes": 1, "sha256": "0".repeat(64) }
            ]
        }))
        .unwrap();
        // On macOS the entry is visible; on every other platform it is hidden.
        let visible_on_macos = cfg!(target_os = "macos");
        assert_eq!(entry.runs_on_current_platform(), visible_on_macos);
        // Unrestricted entries are always visible.
        let mut unrestricted = entry.clone();
        unrestricted.platforms = vec![];
        assert!(unrestricted.runs_on_current_platform());
        // Unknown platform restrictions fail validation.
        unrestricted.platforms = vec!["linux".to_owned()];
        let catalog = ModelCatalog {
            schema_version: 1,
            models: vec![unrestricted],
        };
        assert!(catalog.validate().is_err());
    }

    #[test]
    fn view_serializes_camel_case_keys_for_the_webview() {
        let catalog = ModelCatalog::embedded();
        let serialized = serde_json::to_value(catalog.view()).expect("view serializes");
        let models = serialized.as_array().expect("view is an array");
        assert!(!models.is_empty());
        for model in models {
            let object = model.as_object().expect("model is an object");
            for key in [
                "licenseSpdx",
                "licenseNotice",
                "downloadSizeBytes",
                "fileCount",
            ] {
                assert!(
                    object.contains_key(key),
                    "view must expose {key} (camelCase), got keys: {keys}",
                    keys = object.keys().cloned().collect::<Vec<_>>().join(", ")
                );
            }
        }
    }
}
