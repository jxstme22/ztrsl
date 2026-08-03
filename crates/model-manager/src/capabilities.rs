//! Per-model capability metadata (Phase 9, ADR-016 / ADR-018).
//!
//! What a model can actually enforce about language, and how heavy it is, is
//! honest UI data that ships in the catalog so the desktop never has to guess
//! (and never overclaims a decoder lock). A capability can be:
//!
//! - `Forced` — the decoder is a single-language model (fixed-language CTC);
//! - `Preferred` — biased toward a language token but still multilingual;
//! - `PostFilter` — not language-constrained; the language gate filters after
//!   recognition.
//!
//! Entries without explicit capability data get a conservative derived
//! default (`PostFilter`), so the UI can never overclaim.

use serde::Deserialize;

use crate::catalog::{CatalogEntry, ModelKind};

/// How strongly a model constrains the language of its output (ADR-016).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LanguageCapability {
    Forced,
    Preferred,
    PostFilter,
}

impl LanguageCapability {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            LanguageCapability::Forced => "forced",
            LanguageCapability::Preferred => "preferred",
            LanguageCapability::PostFilter => "post-filter",
        }
    }
}

/// Rough VRAM footprint for honest resource profile recommendations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VramClass {
    Low,
    Medium,
    High,
}

impl VramClass {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            VramClass::Low => "low",
            VramClass::Medium => "medium",
            VramClass::High => "high",
        }
    }
}

/// Capability + recommendation metadata attached to a catalog entry.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelCapabilities {
    pub language_capability: LanguageCapability,
    /// Language profiles this model is recommended for (Phase 7 ids).
    #[serde(default)]
    pub recommended_profiles: Vec<String>,
    pub vram_class: VramClass,
}

/// Conservative derived defaults for entries that carry no explicit
/// capabilities: post-filter, unknown class, no recommended profiles. The UI
/// must never claim more than this.
impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            language_capability: LanguageCapability::PostFilter,
            recommended_profiles: Vec::new(),
            vram_class: VramClass::High,
        }
    }
}

/// Resolve the capabilities for a catalog entry, preferring explicit catalog
/// data and falling back to honest defaults.
#[must_use]
pub fn capabilities_for(entry: &CatalogEntry) -> ModelCapabilities {
    entry
        .capabilities
        .clone()
        .unwrap_or_else(|| derived_capabilities(entry))
}

/// Conservative per-runtime defaults (only used when the catalog omits data).
/// CTC models are the only genuinely forced-language decoders in the app.
#[must_use]
pub fn derived_capabilities(entry: &CatalogEntry) -> ModelCapabilities {
    let language_capability = match entry.runtime.as_str() {
        // sherpa-onnx CTC exports are fixed-language models.
        "sherpa-onnx" => LanguageCapability::Forced,
        // faster-whisper / candle / ctranslate2 decoders are multilingual.
        _ => LanguageCapability::PostFilter,
    };
    let vram_class = match (entry.kind, entry.download_size_bytes) {
        (ModelKind::Asr, size) if size < 2 * 1024 * 1024 * 1024 => VramClass::Low,
        (ModelKind::Asr, _) => VramClass::Medium,
        (ModelKind::Translation, _) => VramClass::Medium,
        _ => VramClass::High,
    };
    ModelCapabilities {
        language_capability,
        recommended_profiles: Vec::new(),
        vram_class,
    }
}

/// Serializable view for the frontend (camelCase, no secrets).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitiesView {
    pub language_capability: String,
    pub recommended_profiles: Vec<String>,
    pub vram_class: String,
}

impl From<&ModelCapabilities> for CapabilitiesView {
    fn from(capabilities: &ModelCapabilities) -> Self {
        Self {
            language_capability: capabilities.language_capability.as_str().to_owned(),
            recommended_profiles: capabilities.recommended_profiles.clone(),
            vram_class: capabilities.vram_class.as_str().to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: ModelKind, runtime: &str, size: u64) -> CatalogEntry {
        serde_json::from_value(serde_json::json!({
            "id": "m",
            "name": "M",
            "kind": format!("{:?}", kind).to_lowercase(),
            "runtime": runtime,
            "description": "d",
            "license": { "spdx": "MIT" },
            "download_size_bytes": size,
            "source": "https://huggingface.co/org/repo",
            "revision": "rev",
            "files": [{ "path": "model.bin", "size_bytes": size, "sha256": "x".repeat(64) }]
        }))
        .unwrap()
    }

    #[test]
    fn explicit_catalog_capabilities_win() {
        let entry: CatalogEntry = serde_json::from_value(serde_json::json!({
            "id": "m",
            "name": "M",
            "kind": "asr",
            "runtime": "faster-whisper",
            "description": "d",
            "license": { "spdx": "MIT" },
            "download_size_bytes": 100,
            "source": "https://huggingface.co/org/repo",
            "revision": "rev",
            "files": [{ "path": "model.bin", "size_bytes": 100, "sha256": "x".repeat(64) }],
            "capabilities": {
                "language_capability": "forced",
                "recommended_profiles": ["tagalog"],
                "vram_class": "low"
            }
        }))
        .unwrap();
        let capabilities = capabilities_for(&entry);
        assert_eq!(capabilities.language_capability, LanguageCapability::Forced);
        assert_eq!(capabilities.recommended_profiles, vec!["tagalog"]);
        assert_eq!(capabilities.vram_class, VramClass::Low);
    }

    #[test]
    fn ct_model_derives_forced() {
        let entry = entry(ModelKind::Asr, "sherpa-onnx", 300 * 1024 * 1024);
        let capabilities = capabilities_for(&entry);
        assert_eq!(capabilities.language_capability, LanguageCapability::Forced);
    }

    #[test]
    fn multilingual_runtimes_default_to_post_filter() {
        for runtime in ["faster-whisper", "candle", "ctranslate2"] {
            let entry = entry(ModelKind::Asr, runtime, 3 * 1024 * 1024 * 1024);
            assert_eq!(
                capabilities_for(&entry).language_capability,
                LanguageCapability::PostFilter,
                "{runtime} must not claim a forced language"
            );
        }
    }

    #[test]
    fn view_serializes_camel_case() {
        let view: CapabilitiesView = (&ModelCapabilities {
            language_capability: LanguageCapability::Preferred,
            recommended_profiles: vec!["taglish".to_owned()],
            vram_class: VramClass::Medium,
        })
            .into();
        let json = serde_json::to_value(view).unwrap();
        assert_eq!(json["languageCapability"], "preferred");
        assert_eq!(json["recommendedProfiles"][0], "taglish");
        assert_eq!(json["vramClass"], "medium");
    }
}
