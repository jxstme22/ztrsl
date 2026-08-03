//! Provider registry and failover order (Phase 9, ADR-018).
//!
//! Model artifacts are provider-neutral: the same pinned repo/revision/file
//! can be fetched from Hugging Face, an hf-mirror, ModelScope, or a local
//! directory. This module resolves the candidate providers for a region and
//! rewrites a pinned Hugging Face source URL onto each provider's host.
//!
//! Every candidate still resolves to the SAME pinned revision and the
//! artifact is always verified against the catalog's SHA-256, so failing over
//! between providers cannot substitute a different artifact.

use crate::catalog::DEFAULT_HF_ENDPOINT;

/// A download host that can serve a pinned catalog artifact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Provider {
    /// The upstream default (`https://huggingface.co`).
    HuggingFace,
    /// A Hugging Face mirror (default `https://hf-mirror.com`), usually the
    /// fastest mainland-CN route.
    HfMirror,
    /// ModelScope mirror (`https://modelscope.cn`). Uses the `hf-mirror.com`
    /// layout for pinned HF repos.
    ModelScope,
    /// A user-supplied custom endpoint (preserves v0.2 `LST_HF_ENDPOINT` and
    /// the in-app download-endpoint setting). This is a provider entry like
    /// any other, per ADR-018.
    Custom(String),
}

impl Provider {
    /// Default host for the provider, used when no custom endpoint overrides it.
    #[must_use]
    pub fn default_host(&self) -> &str {
        match self {
            Provider::HuggingFace => DEFAULT_HF_ENDPOINT,
            Provider::HfMirror => "https://hf-mirror.com",
            Provider::ModelScope => "https://modelscope.cn",
            Provider::Custom(host) => host,
        }
    }
}

/// Rewrite a pinned Hugging Face `https://huggingface.co/...` URL onto a
/// provider's host. Non-HF URLs (e.g. a GitHub release archive) are returned
/// unchanged except for the custom endpoint case, where a custom mirror is
/// never applied to non-HF URLs (mirrors only mirror the HF layout).
#[must_use]
pub fn rewrite_for_provider(url: &str, provider: Provider) -> String {
    let prefix = format!("{DEFAULT_HF_ENDPOINT}/");
    let host = provider.default_host();
    match provider {
        Provider::HuggingFace => url.to_owned(),
        Provider::HfMirror | Provider::ModelScope | Provider::Custom(_) => url
            .strip_prefix(&prefix)
            .map(|rest| format!("{host}/{rest}"))
            .unwrap_or_else(|| url.to_owned()),
    }
}

/// Which region the user is in. Only explicit, locally-configured signals are
/// used — never telemetry or IP geolocation (safety boundary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Region {
    Global,
    MainlandChina,
}

/// Region preference from the environment: `LST_REGION=cn` (or `china`) opts
/// into a mainland-CN-first provider order. Everything else is global.
#[must_use]
pub fn region_from_env() -> Region {
    region_from_str(&std::env::var("LST_REGION").unwrap_or_default())
}

/// Pure region classification (testable without touching the environment).
#[must_use]
pub fn region_from_str(value: &str) -> Region {
    match value.to_ascii_lowercase().as_str() {
        "cn" | "china" | "mainland-cn" => Region::MainlandChina,
        _ => Region::Global,
    }
}

/// Candidate provider order for a region. First provider is tried first; the
/// installer falls through to the next on transport failure (not on checksum
/// mismatch — an artifact that fails verification aborts the whole install).
#[must_use]
pub fn provider_order(region: Region, custom_endpoint: Option<&str>) -> Vec<Provider> {
    let mut order: Vec<Provider> = match region {
        // Mainland-CN: mirror routes first, upstream last.
        Region::MainlandChina => vec![
            Provider::HfMirror,
            Provider::ModelScope,
            Provider::HuggingFace,
        ],
        Region::Global => vec![
            Provider::HuggingFace,
            Provider::HfMirror,
            Provider::ModelScope,
        ],
    };
    // A custom endpoint is the highest-precedence provider entry (ADR-018):
    // it is tried before every built-in candidate, but never for non-HF URLs.
    if let Some(endpoint) = custom_endpoint {
        order.insert(0, Provider::Custom(endpoint.to_owned()));
    }
    order
}

/// All distinct candidate download URLs for a pinned artifact, in provider
/// failover order. Duplicate URLs (e.g. custom endpoint equal to upstream)
/// are removed.
#[must_use]
pub fn candidate_urls(url: &str, region: Region, custom_endpoint: Option<&str>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut urls = Vec::new();
    for provider in provider_order(region, custom_endpoint) {
        let rewritten = rewrite_for_provider(url, provider);
        if seen.insert(rewritten.clone()) {
            urls.push(rewritten);
        }
    }
    urls
}

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED: &str = "https://huggingface.co/org/repo/resolve/abc/model.bin";

    #[test]
    fn provider_default_hosts_are_expected() {
        assert_eq!(
            Provider::HuggingFace.default_host(),
            "https://huggingface.co"
        );
        assert_eq!(Provider::HfMirror.default_host(), "https://hf-mirror.com");
        assert_eq!(Provider::ModelScope.default_host(), "https://modelscope.cn");
        assert_eq!(
            Provider::Custom("https://example.test".to_owned()).default_host(),
            "https://example.test"
        );
    }

    #[test]
    fn mirrors_rewrite_hf_urls_but_not_others() {
        assert_eq!(
            rewrite_for_provider(PINNED, Provider::HfMirror),
            "https://hf-mirror.com/org/repo/resolve/abc/model.bin"
        );
        assert_eq!(
            rewrite_for_provider(PINNED, Provider::ModelScope),
            "https://modelscope.cn/org/repo/resolve/abc/model.bin"
        );
        let github = "https://github.com/x/y/releases/download/v1/model.tar.bz2";
        assert_eq!(rewrite_for_provider(github, Provider::HfMirror), github);
        assert_eq!(
            rewrite_for_provider(github, Provider::Custom("https://m.test".to_owned())),
            github
        );
        assert_eq!(
            rewrite_for_provider(github, Provider::Custom("https://m.test".to_owned())),
            github
        );
    }

    #[test]
    fn custom_endpoint_rewrites_hf_urls() {
        assert_eq!(
            rewrite_for_provider(PINNED, Provider::Custom("https://hf-mirror.com".to_owned())),
            "https://hf-mirror.com/org/repo/resolve/abc/model.bin"
        );
    }

    #[test]
    fn global_order_prefers_upstream_then_mirror() {
        let order = provider_order(Region::Global, None);
        assert_eq!(order[0], Provider::HuggingFace);
        assert_eq!(order[1], Provider::HfMirror);
        assert_eq!(order[2], Provider::ModelScope);
    }

    #[test]
    fn mainland_order_prefers_mirror_routes() {
        let order = provider_order(Region::MainlandChina, None);
        assert_eq!(order[0], Provider::HfMirror);
        assert_eq!(order[1], Provider::ModelScope);
        assert_eq!(order[2], Provider::HuggingFace);
    }

    #[test]
    fn custom_endpoint_sits_at_front_of_the_chain() {
        let order = provider_order(Region::Global, Some("https://example.test"));
        assert_eq!(
            order[0],
            Provider::Custom("https://example.test".to_owned())
        );
        assert_eq!(order[1], Provider::HuggingFace);
    }

    #[test]
    fn region_env_is_explicit_only() {
        assert_eq!(region_from_str(""), Region::Global);
        assert_eq!(region_from_str("cn"), Region::MainlandChina);
        assert_eq!(region_from_str("CHINA"), Region::MainlandChina);
        assert_eq!(region_from_str("mainland-cn"), Region::MainlandChina);
        assert_eq!(region_from_str("hk"), Region::Global);
        assert_eq!(region_from_str("us"), Region::Global);
    }

    #[test]
    fn candidate_urls_dedupe_and_keep_order() {
        let urls = candidate_urls(PINNED, Region::Global, Some("https://example.test"));
        assert_eq!(
            urls,
            vec![
                "https://example.test/org/repo/resolve/abc/model.bin",
                "https://huggingface.co/org/repo/resolve/abc/model.bin",
                "https://hf-mirror.com/org/repo/resolve/abc/model.bin",
                "https://modelscope.cn/org/repo/resolve/abc/model.bin",
            ]
        );
        // A custom endpoint equal to upstream dedupes against HuggingFace.
        let urls = candidate_urls(PINNED, Region::Global, Some("https://huggingface.co"));
        assert_eq!(urls[0], PINNED);
        assert_eq!(urls.len(), 3);
    }
}
