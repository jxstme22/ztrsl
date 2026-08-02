//! On-disk model store: scan installed artifacts, delete them, refuse
//! destructive operations while a model is in use.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::Error;

/// `manifest.json` shape written into each installed artifact directory.
#[derive(Debug, Deserialize)]
pub struct InstalledManifest {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub revision: String,
    pub artifacts: Vec<InstalledArtifact>,
}

#[derive(Debug, Deserialize)]
pub struct InstalledArtifact {
    pub path: String,
    pub size_bytes: u64,
    #[allow(dead_code)]
    pub sha256: String,
}

/// A model directory on disk, as discovered by `ModelStore::installed()`.
#[derive(Debug, Clone)]
pub struct InstalledModel {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub revision: String,
    pub dir: PathBuf,
    pub total_size_bytes: u64,
}

pub struct ModelStore {
    root: PathBuf,
}

impl ModelStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Absolute path to a model's artifact directory.
    pub fn model_dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// List installed, verified models. A directory only counts when its
    /// `manifest.json` parses and every declared artifact exists with the
    /// expected size (full re-hashing is done by the inference sidecar on
    /// load; here we only bound disk usage honestly).
    pub fn installed(&self) -> Result<Vec<InstalledModel>, Error> {
        let mut models = Vec::new();
        if !self.root.is_dir() {
            return Ok(models);
        }
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let manifest_path = dir.join("manifest.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest: InstalledManifest = match std::fs::read(&manifest_path) {
                Ok(raw) => match serde_json::from_slice(&raw) {
                    Ok(parsed) => parsed,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };
            if manifest.id.is_empty() || manifest.artifacts.is_empty() {
                continue;
            }
            let total = manifest.artifacts.iter().try_fold(0u64, |acc, artifact| {
                let path = dir.join(&artifact.path);
                if path.is_file()
                    && path.metadata().map(|meta| meta.len()).unwrap_or(0) == artifact.size_bytes
                {
                    Ok(acc + artifact.size_bytes)
                } else {
                    Err(())
                }
            });
            if total.is_err() {
                continue;
            }
            models.push(InstalledModel {
                id: manifest.id.clone(),
                kind: manifest.kind.clone(),
                source: manifest.source.clone(),
                revision: manifest.revision.clone(),
                dir,
                total_size_bytes: total.unwrap_or_default(),
            });
        }
        Ok(models)
    }

    /// True when `id` is present in `installed()`.
    pub fn is_installed(&self, id: &str) -> bool {
        self.installed()
            .map(|models| models.iter().any(|model| model.id == id))
            .unwrap_or(false)
    }

    /// Delete an installed model. Refuses when the id is in `in_use` or the
    /// directory does not contain a valid manifest (defensive: never delete
    /// an unknown directory).
    pub fn delete(&self, id: &str, in_use: &HashSet<String>) -> Result<(), Error> {
        if in_use.contains(id) {
            return Err(Error::ModelInUse {
                id: id.to_owned(),
                detail: "stop the live session before deleting this model".to_owned(),
            });
        }
        let dir = self.model_dir(id);
        if !dir.is_dir() {
            return Err(Error::NotFound { id: id.to_owned() });
        }
        if !dir.join("manifest.json").is_file() {
            return Err(Error::UnknownDirectory {
                path: dir.display().to_string(),
            });
        }
        std::fs::remove_dir_all(&dir)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn write_manifest(dir: &Path, id: &str, size: u64) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("payload.bin"), vec![0u8; size as usize]).unwrap();
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": id,
            "kind": "asr",
            "source": "https://example.test/repo",
            "revision": "abc",
            "artifacts": [
                { "path": "payload.bin", "size_bytes": size, "sha256": "x" }
            ]
        });
        std::fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn installed_detects_valid_dirs_and_skips_junk() {
        let root =
            std::env::temp_dir().join(format!("lst-model-store-detect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("good")).unwrap();
        write_manifest(&root.join("good"), "good", 4);
        std::fs::create_dir_all(root.join("junk")).unwrap();
        std::fs::write(root.join("junk").join("random.bin"), b"no manifest").unwrap();

        let store = ModelStore::new(root.clone());
        let installed = store.installed().unwrap();
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].id, "good");
        assert_eq!(installed[0].total_size_bytes, 4);
        assert!(store.is_installed("good"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_rejects_corrupted_artifact_sizes() {
        let root =
            std::env::temp_dir().join(format!("lst-model-store-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        write_manifest(&root.join("bad"), "bad", 16);
        std::fs::write(root.join("bad").join("payload.bin"), b"short").unwrap();

        let store = ModelStore::new(root.clone());
        assert!(store.installed().unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_refuses_when_in_use_and_for_unknown_dirs() {
        let root =
            std::env::temp_dir().join(format!("lst-model-store-delete-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        write_manifest(&root.join("used"), "used", 4);
        std::fs::create_dir_all(root.join("mystery")).unwrap();

        let store = ModelStore::new(root.clone());
        let in_use = HashSet::from(["used".to_owned()]);
        assert!(matches!(
            store.delete("used", &in_use),
            Err(Error::ModelInUse { .. })
        ));
        assert!(matches!(
            store.delete("mystery", &HashSet::new()),
            Err(Error::UnknownDirectory { .. })
        ));
        assert!(matches!(
            store.delete("ghost", &HashSet::new()),
            Err(Error::NotFound { .. })
        ));

        store.delete("used", &HashSet::new()).unwrap();
        assert!(!store.model_dir("used").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
