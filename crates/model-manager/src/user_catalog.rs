//! User-defined model catalog (user models, Phase 10).
//!
//! Users can register their own pinned model definitions (Hugging Face-style
//! `source/resolve/revision/path` file lists) through the UI. These entries
//! are persisted next to the model store in `user-catalog.json` and merged
//! with the embedded catalog for install/list/delete purposes.
//!
//! Trust model: unlike the embedded (signed) catalog, user entries are
//! *unsigned*. Every download is still pinned to an exact revision, and when
//! the user supplies SHA-256 checksums those are verified before install.
//! Entries without checksums (the common case for hand-typed repos) have
//! their real checksums computed during install and recorded in the installed
//! manifest, so the store scan always validates the actual bytes on disk.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Error;
use crate::capabilities::{CapabilitiesView, derived_capabilities};
use crate::catalog::{
    CatalogEntry, CatalogEntryView, CatalogFile, CatalogLicense, ModelCatalog, ModelKind,
};

/// Runtime strings the app's inference sidecar can actually load. A user
/// entry must pick one of these; anything else would install bytes the
/// sidecar cannot run.
pub const SUPPORTED_RUNTIMES: &[&str] = &[
    "faster-whisper",
    "ctranslate2",
    "sherpa-onnx",
    "candle",
    "mlx",
];

/// File name of the user catalog inside the model store root.
pub const USER_CATALOG_FILE: &str = "user-catalog.json";

const MAX_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 128;
const MAX_DESCRIPTION_LEN: usize = 512;
const MAX_LICENSE_LEN: usize = 64;
const MAX_REVISION_LEN: usize = 128;
const MAX_FILES: usize = 32;
const MAX_FILE_PATH_LEN: usize = 512;

/// One user-registered model definition (snake_case on disk, matching the
/// embedded `catalog.json` conventions).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserModelEntry {
    pub id: String,
    pub name: String,
    pub kind: ModelKind,
    pub runtime: String,
    pub description: String,
    pub license_spdx: String,
    /// Base repository URL (`https://huggingface.co/<org>/<repo>`).
    pub source: String,
    /// Pinned git revision (commit sha, tag or branch).
    pub revision: String,
    /// Relative artifact paths inside the repo. `sha256` may be empty (the
    /// checksum is recorded after download); `size_bytes` may be 0 (unknown;
    /// the real size is recorded after download).
    pub files: Vec<CatalogFile>,
}

/// Wire type for the `files` argument of the add-model command (camelCase
/// from the webview).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFileInput {
    pub path: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub sha256: String,
}

/// Validates and stores user-registered model definitions in
/// `<store root>/user-catalog.json`.
#[derive(Debug, Clone)]
pub struct UserCatalog {
    path: PathBuf,
    entries: Vec<UserModelEntry>,
}

impl UserCatalog {
    /// Load the user catalog from the model store root. A missing file is an
    /// empty catalog; an unparseable file is moved aside (so a corrupt write
    /// never wedges the app) and the catalog starts empty.
    pub fn load(root: &Path) -> Self {
        let path = root.join(USER_CATALOG_FILE);
        let entries = match std::fs::read(&path) {
            Ok(raw) => match serde_json::from_slice::<Vec<UserModelEntry>>(&raw) {
                Ok(parsed) => parsed,
                Err(_) => {
                    let mut corrupt = path.clone().into_os_string();
                    corrupt.push(format!(".corrupt-{}", std::process::id()));
                    let _ = std::fs::rename(&path, PathBuf::from(corrupt));
                    Vec::new()
                }
            },
            Err(_) => Vec::new(),
        };
        Self { path, entries }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn entries(&self) -> &[UserModelEntry] {
        &self.entries
    }

    pub fn entry(&self, id: &str) -> Option<&UserModelEntry> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Register a new user model. Rejects ids that collide with the embedded
    /// catalog or an existing user entry, and validates every field so the
    /// persisted file can only ever contain safe, installable definitions.
    pub fn add(
        &mut self,
        entry: UserModelEntry,
        embedded: &ModelCatalog,
    ) -> Result<(), Error> {
        validate_user_entry(&entry, embedded)?;
        if self.entry(&entry.id).is_some() {
            return Err(Error::Layout {
                detail: format!("a user model with id '{}' already exists", entry.id),
            });
        }
        if embedded.entry(&entry.id).is_some() {
            return Err(Error::Layout {
                detail: format!("model id '{}' is a built-in model; pick another id", entry.id),
            });
        }
        self.entries.push(entry);
        self.persist()?;
        Ok(())
    }

    /// Remove a user model definition. The installed files (if any) are left
    /// untouched; the user can delete them separately through the UI.
    pub fn remove(&mut self, id: &str) -> Result<(), Error> {
        let before = self.entries.len();
        self.entries.retain(|entry| entry.id != id);
        if self.entries.len() == before {
            return Err(Error::NotFound { id: id.to_owned() });
        }
        self.persist()?;
        Ok(())
    }

    /// Persist atomically: write a sibling temp file, then rename over the
    /// catalog (atomic on the same filesystem, so a crash never leaves a
    /// half-written catalog).
    fn persist(&self) -> Result<(), Error> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension(format!(
            "json.tmp-{}",
            std::process::id()
        ));
        let serialized = serde_json::to_vec_pretty(&self.entries).map_err(Error::Serialize)?;
        std::fs::write(&tmp, serialized)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

impl UserModelEntry {
    /// Convert to a full `CatalogEntry` so the installer, the store and the
    /// capabilities machinery all work unchanged. Unverified fields (empty
    /// checksum / zero size) are recorded at install time.
    pub fn to_catalog_entry(&self) -> CatalogEntry {
        CatalogEntry {
            id: self.id.clone(),
            name: self.name.clone(),
            kind: self.kind,
            runtime: self.runtime.clone(),
            recommended: false,
            description: self.description.clone(),
            license: CatalogLicense {
                spdx: self.license_spdx.clone(),
                notice: String::new(),
            },
            download_size_bytes: self.files.iter().map(|file| file.size_bytes).sum(),
            source: self.source.clone(),
            revision: self.revision.clone(),
            platforms: Vec::new(),
            files: self.files.clone(),
            archive: None,
            capabilities: None,
        }
    }

    /// Serializable view for the frontend (camelCase, `userDefined: true`).
    pub fn to_view(&self) -> CatalogEntryView {
        let entry = self.to_catalog_entry();
        CatalogEntryView {
            id: self.id.clone(),
            name: self.name.clone(),
            kind: format!("{:?}", self.kind).to_lowercase(),
            runtime: self.runtime.clone(),
            recommended: false,
            description: self.description.clone(),
            license_spdx: self.license_spdx.clone(),
            license_notice: String::new(),
            download_size_bytes: self.files.iter().map(|file| file.size_bytes).sum(),
            source: self.source.clone(),
            revision: self.revision.clone(),
            file_count: self.files.len(),
            capabilities: CapabilitiesView::from(&derived_capabilities(&entry)),
            user_defined: true,
        }
    }
}

/// Validate every field of a user model definition. Checks are deliberately
/// conservative: the persisted catalog is only ever written by this function.
pub fn validate_user_entry(
    entry: &UserModelEntry,
    embedded: &ModelCatalog,
) -> Result<(), Error> {
    let id = entry.id.trim();
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(Error::Layout {
            detail: format!("model id must be 1-{MAX_ID_LEN} characters"),
        });
    }
    if !id
        .chars()
        .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
    {
        return Err(Error::Layout {
            detail: "model id may only contain lowercase letters, digits and dashes".to_owned(),
        });
    }
    let name = entry.name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(Error::Layout {
            detail: format!("model name must be 1-{MAX_NAME_LEN} characters"),
        });
    }
    if entry.description.len() > MAX_DESCRIPTION_LEN {
        return Err(Error::Layout {
            detail: format!("model description must be at most {MAX_DESCRIPTION_LEN} characters"),
        });
    }
    if entry.kind == ModelKind::Vad {
        return Err(Error::Layout {
            detail: "user models must be 'asr' or 'translation'".to_owned(),
        });
    }
    if !SUPPORTED_RUNTIMES.contains(&entry.runtime.as_str()) {
        return Err(Error::Layout {
            detail: format!(
                "unsupported runtime '{}'; supported: {}",
                entry.runtime,
                SUPPORTED_RUNTIMES.join(", ")
            ),
        });
    }
    let license = entry.license_spdx.trim();
    if license.is_empty() || license.len() > MAX_LICENSE_LEN {
        return Err(Error::Layout {
            detail: format!("license SPDX id must be 1-{MAX_LICENSE_LEN} characters"),
        });
    }
    let source = entry.source.trim().trim_end_matches('/');
    let parsed = url::Url::parse(source).map_err(|_| Error::Layout {
        detail: "model source must be a valid https:// URL".to_owned(),
    })?;
    if parsed.scheme() != "https"
        || parsed.host_str().unwrap_or_default().is_empty()
        || parsed.username() != ""
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(Error::Layout {
            detail: "model source must be a plain https:// repo URL (no userinfo, query or fragment)"
                .to_owned(),
        });
    }
    let revision = entry.revision.trim();
    if revision.is_empty()
        || revision.len() > MAX_REVISION_LEN
        || revision.chars().any(char::is_whitespace)
        || revision.contains("..")
    {
        return Err(Error::Layout {
            detail: "revision must be 1-128 characters without whitespace or '..'".to_owned(),
        });
    }
    if entry.files.is_empty() {
        return Err(Error::Layout {
            detail: "a user model needs at least one artifact file".to_owned(),
        });
    }
    if entry.files.len() > MAX_FILES {
        return Err(Error::Layout {
            detail: format!("a user model may declare at most {MAX_FILES} files"),
        });
    }
    let mut seen_paths = std::collections::HashSet::new();
    for file in &entry.files {
        let path = file.path.trim();
        let path_buf = PathBuf::from(path);
        if path.is_empty()
            || path.len() > MAX_FILE_PATH_LEN
            || path_buf.is_absolute()
            || path
                .split('/')
                .any(|part| part == ".." || part.is_empty())
        {
            return Err(Error::Layout {
                detail: format!("unsafe artifact path '{}'", file.path),
            });
        }
        if !seen_paths.insert(path.to_owned()) {
            return Err(Error::Layout {
                detail: format!("duplicate artifact path '{}'", file.path),
            });
        }
        let sha256 = file.sha256.trim();
        if !sha256.is_empty()
            && (sha256.len() != 64 || !sha256.chars().all(|character| character.is_ascii_hexdigit()))
        {
            return Err(Error::Layout {
                detail: format!(
                    "artifact '{}' has an invalid sha256 (must be 64 hex digits or empty)",
                    file.path
                ),
            });
        }
    }
    if embedded.entry(id).is_some() {
        return Err(Error::Layout {
            detail: format!("model id '{id}' is a built-in model; pick another id"),
        });
    }
    Ok(())
}

/// Build a validated `UserModelEntry` from wire inputs (the add-model command
/// payload). `license_spdx` defaults to "unknown" when empty.
pub fn build_user_entry(
    id: &str,
    name: &str,
    kind: &str,
    runtime: &str,
    description: &str,
    license_spdx: &str,
    source: &str,
    revision: &str,
    files: &[UserFileInput],
) -> Result<UserModelEntry, Error> {
    let kind = match kind {
        "asr" => ModelKind::Asr,
        "translation" => ModelKind::Translation,
        other => {
            return Err(Error::Layout {
                detail: format!("kind must be asr or translation, got '{other}'"),
            });
        }
    };
    let license = if license_spdx.trim().is_empty() {
        "unknown".to_owned()
    } else {
        license_spdx.trim().to_owned()
    };
    let files = files
        .iter()
        .map(|file| CatalogFile {
            path: file.path.trim().to_owned(),
            size_bytes: file.size_bytes,
            sha256: file.sha256.trim().to_owned(),
        })
        .collect();
    Ok(UserModelEntry {
        id: id.trim().to_owned(),
        name: name.trim().to_owned(),
        kind,
        runtime: runtime.trim().to_owned(),
        description: description.trim().to_owned(),
        license_spdx: license,
        source: source.trim().trim_end_matches('/').to_owned(),
        revision: revision.trim().to_owned(),
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> UserModelEntry {
        serde_json::from_value(serde_json::json!({
            "id": "my-whisper",
            "name": "My Whisper",
            "kind": "asr",
            "runtime": "faster-whisper",
            "description": "a custom whisper build",
            "license_spdx": "MIT",
            "source": "https://huggingface.co/my-org/my-whisper",
            "revision": "main",
            "files": [
                { "path": "model.bin", "size_bytes": 0, "sha256": "" },
                { "path": "config.json", "size_bytes": 0, "sha256": "" }
            ]
        }))
        .unwrap()
    }

    fn empty_embedded() -> ModelCatalog {
        ModelCatalog {
            schema_version: 1,
            models: Vec::new(),
        }
    }

    #[test]
    fn add_persists_and_load_round_trips() {
        let root = std::env::temp_dir().join(format!("lst-user-cat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let mut catalog = UserCatalog::load(&root);
        assert!(catalog.is_empty());
        catalog.add(sample(), &empty_embedded()).unwrap();
        assert!(root.join(USER_CATALOG_FILE).is_file());
        assert_eq!(catalog.entries().len(), 1);

        let reloaded = UserCatalog::load(&root);
        assert_eq!(reloaded.entries()[0].id, "my-whisper");
        assert_eq!(reloaded.entries()[0].files.len(), 2);
        assert_eq!(reloaded.entries()[0].runtime, "faster-whisper");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remove_deletes_and_persists() {
        let root = std::env::temp_dir().join(format!("lst-user-remove-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut catalog = UserCatalog::load(&root);
        catalog.add(sample(), &empty_embedded()).unwrap();
        assert!(matches!(
            catalog.remove("ghost"),
            Err(Error::NotFound { .. })
        ));
        catalog.remove("my-whisper").unwrap();
        assert!(catalog.is_empty());
        assert!(UserCatalog::load(&root).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_id_colliding_with_embedded_catalog() {
        let root = std::env::temp_dir().join(format!("lst-user-collide-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let mut catalog = UserCatalog::load(&root);
        let mut embedded = empty_embedded();
        embedded.models.push(
            serde_json::from_value(serde_json::json!({
                "id": "whisper-large-v3-turbo",
                "name": "Built-in",
                "kind": "asr",
                "runtime": "faster-whisper",
                "description": "d",
                "license": { "spdx": "MIT" },
                "download_size_bytes": 1,
                "source": "https://huggingface.co/x/y",
                "revision": "r",
                "files": [{ "path": "m.bin", "size_bytes": 1, "sha256": "0".repeat(64) }]
            }))
            .unwrap(),
        );
        let mut entry = sample();
        entry.id = "whisper-large-v3-turbo".to_owned();
        let error = catalog.add(entry, &embedded).unwrap_err();
        assert!(error.to_string().contains("built-in"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsafe_fields() {
        let embedded = empty_embedded();

        let mut bad_id = sample();
        bad_id.id = "UPPER-CASE".to_owned();
        assert!(validate_user_entry(&bad_id, &embedded).is_err());

        let mut bad_path = sample();
        bad_path.files[0].path = "../escape.bin".to_owned();
        assert!(validate_user_entry(&bad_path, &embedded).is_err());

        let mut bad_sha = sample();
        bad_sha.files[0].sha256 = "not-hex".to_owned();
        assert!(validate_user_entry(&bad_sha, &embedded).is_err());

        let mut bad_source = sample();
        bad_source.source = "https://user:pass@huggingface.co/x/y".to_owned();
        assert!(validate_user_entry(&bad_source, &embedded).is_err());

        let mut bad_runtime = sample();
        bad_runtime.runtime = "sherpa".to_owned();
        assert!(validate_user_entry(&bad_runtime, &embedded).is_err());

        let mut bad_revision = sample();
        bad_revision.revision = "../main".to_owned();
        assert!(validate_user_entry(&bad_revision, &embedded).is_err());
    }

    #[test]
    fn corrupt_catalog_file_is_moved_aside() {
        let root = std::env::temp_dir().join(format!("lst-user-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(USER_CATALOG_FILE), b"not json").unwrap();
        let catalog = UserCatalog::load(&root);
        assert!(catalog.is_empty());
        let renamed = std::fs::read_dir(&root)
            .unwrap()
            .any(|entry| entry.unwrap().file_name().to_string_lossy().contains("corrupt"));
        assert!(renamed, "corrupt file must be moved aside, not silently deleted");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn view_and_catalog_entry_carry_user_flag_and_capabilities() {
        let entry = sample();
        let view = entry.to_view();
        assert!(view.user_defined);
        assert_eq!(view.id, "my-whisper");
        assert_eq!(view.file_count, 2);
        // Conservative derived capability: multilingual runtimes never claim
        // a forced language.
        assert_eq!(view.capabilities.language_capability, "post-filter");
        let catalog_entry = entry.to_catalog_entry();
        assert_eq!(catalog_entry.kind, ModelKind::Asr);
        assert_eq!(catalog_entry.download_size_bytes, 0);
    }
}
