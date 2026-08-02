//! Staged, verified installs: download everything into a sibling staging
//! directory, verify every SHA-256, then atomically rename into place. A
//! partial or failed install never leaves a half-written model directory.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::catalog::{CatalogArchive, CatalogEntry, CatalogFile};
use crate::downloader::{CancelHandle, DownloadProgress, Fetcher, ProgressFn};
use crate::store::ModelStore;
use crate::Error;

/// Overall progress of an install, including download and extraction phases.
#[derive(Debug, Clone, Copy)]
pub struct InstallProgress {
    pub phase: InstallPhase,
    pub file_index: usize,
    pub file_count: usize,
    pub file_bytes_done: u64,
    pub file_bytes_total: u64,
    pub total_bytes_done: u64,
    pub total_bytes_total: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallPhase {
    Downloading,
    Extracting,
    Installing,
}

pub type InstallProgressFn = Arc<dyn Fn(InstallProgress) + Send + Sync>;

/// Installs models from the catalog into a `ModelStore`.
pub struct ModelInstaller {
    store: ModelStore,
    fetcher: Arc<dyn Fetcher>,
}

impl ModelInstaller {
    pub fn new(store: ModelStore, fetcher: Arc<dyn Fetcher>) -> Self {
        Self { store, fetcher }
    }

    pub fn store(&self) -> &ModelStore {
        &self.store
    }

    /// Download, verify and install `entry`. All artifacts are written to a
    /// temporary staging directory first and renamed into place only after
    /// every checksum passes.
    pub async fn install(
        &self,
        entry: &CatalogEntry,
        cancel: &CancelHandle,
        on_progress: InstallProgressFn,
    ) -> Result<(), Error> {
        if self.store.is_installed(&entry.id) {
            return Err(Error::AlreadyInstalled { id: entry.id.clone() });
        }
        assert_safe_artifact_paths(entry)?;
        let root = self.store.root();
        std::fs::create_dir_all(root)?;
        let staging = root.join(format!(
            ".staging-{}-{}",
            entry.id,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging)?;

        let total_bytes = entry.download_size_bytes;
        let file_count = entry.files.len() + usize::from(entry.archive.is_some());

        let result = async {
            self.download_plain_files(
                entry,
                &staging,
                cancel,
                on_progress.clone(),
                total_bytes,
                file_count,
            )
            .await?;
            if let Some(archive) = &entry.archive {
                self.download_and_extract_archive(
                    entry,
                    archive,
                    &staging,
                    cancel,
                    on_progress.clone(),
                    total_bytes,
                    file_count,
                )
                .await?;
            }
            self.commit(entry, &staging)
        }
        .await;

        let _ = std::fs::remove_dir_all(&staging);
        if cancel.is_cancelled() {
            return Err(Error::Canceled);
        }
        result
    }

    async fn download_plain_files(
        &self,
        entry: &CatalogEntry,
        staging: &Path,
        cancel: &CancelHandle,
        on_progress: InstallProgressFn,
        total_bytes: u64,
        file_count: usize,
    ) -> Result<(), Error> {
        let mut downloaded = 0u64;
        let model_staging = staging.join(&entry.id);
        for (index, file) in entry.files.iter().enumerate() {
            if cancel.is_cancelled() {
                return Err(Error::Canceled);
            }
            let destination = model_staging.join(&file.path);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let url = crate::catalog::ModelCatalog::embedded().file_url(entry, file);
            let expected_size = file.size_bytes;
            let progress = self.plain_progress(
                index,
                file_count,
                total_bytes,
                downloaded,
                file,
                on_progress.clone(),
            );
            self.fetcher
                .fetch(&url, &destination, cancel, progress)
                .await?;
            if std::fs::metadata(&destination)?.len() != expected_size {
                return Err(Error::Size {
                    path: destination.display().to_string(),
                    expected: expected_size,
                    actual: std::fs::metadata(&destination)?.len(),
                });
            }
            crate::downloader::verify_file_sha256(&destination, &file.sha256)?;
            downloaded += expected_size;
        }
        Ok(())
    }

    fn plain_progress(
        &self,
        index: usize,
        file_count: usize,
        total_bytes: u64,
        downloaded: u64,
        file: &CatalogFile,
        on_progress: InstallProgressFn,
    ) -> ProgressFn {
        let file_bytes_total = file.size_bytes;
        Arc::new(move |event: DownloadProgress| {
            on_progress(InstallProgress {
                phase: InstallPhase::Downloading,
                file_index: index,
                file_count,
                file_bytes_done: event.file_bytes_done,
                file_bytes_total,
                total_bytes_done: downloaded + event.file_bytes_done,
                total_bytes_total: total_bytes,
            });
        })
    }

    async fn download_and_extract_archive(
        &self,
        entry: &CatalogEntry,
        archive: &CatalogArchive,
        staging: &Path,
        cancel: &CancelHandle,
        on_progress: InstallProgressFn,
        total_bytes: u64,
        file_count: usize,
    ) -> Result<(), Error> {
        let archive_path = staging.join(&archive.path);
        if let Some(parent) = archive_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let archive_index = entry.files.len();
        let progress_on_progress = on_progress.clone();
        let progress = Arc::new(move |event: DownloadProgress| {
            progress_on_progress(InstallProgress {
                phase: InstallPhase::Downloading,
                file_index: archive_index,
                file_count,
                file_bytes_done: event.file_bytes_done,
                file_bytes_total: event.file_bytes_total,
                total_bytes_done: event.file_bytes_done,
                total_bytes_total: total_bytes,
            });
        });
        self.fetcher
            .fetch(&archive.url, &archive_path, cancel, progress)
            .await?;
        crate::downloader::verify_file_sha256(&archive_path, &archive.sha256)?;
        if cancel.is_cancelled() {
            return Err(Error::Canceled);
        }
        on_progress(InstallProgress {
            phase: InstallPhase::Extracting,
            file_index: entry.files.len(),
            file_count,
            file_bytes_done: 0,
            file_bytes_total: archive.size_bytes,
            total_bytes_done: archive.size_bytes,
            total_bytes_total: total_bytes,
        });
        let destination_root = staging.join(&entry.id);
        std::fs::create_dir_all(&destination_root)?;
        extract_tarbz2(
            &archive_path,
            &destination_root,
            archive.strip_components,
            &archive.extract_only,
            cancel,
        )?;
        Ok(())
    }

    /// Move the staged model directory into place and write its manifest.
    fn commit(&self, entry: &CatalogEntry, staging: &Path) -> Result<(), Error> {
        let staged_model = staging.join(&entry.id);
        if !staged_model.is_dir() {
            return Err(Error::Layout {
                detail: format!("staging produced no model directory for {}", entry.id),
            });
        }
        let destination = self.store.model_dir(&entry.id);
        if destination.exists() {
            return Err(Error::AlreadyInstalled { id: entry.id.clone() });
        }
        // The parent must exist for the rename; it is the store root.
        std::fs::create_dir_all(destination.parent().expect("store root has a parent"))?;
        std::fs::rename(&staged_model, &destination)?;
        write_manifest(&destination, entry)?;
        Ok(())
    }
}

/// Map an archive entry path to a safe relative destination path.
///
/// Strips `strip_components` leading components and rejects any entry that
/// could escape the destination (absolute paths, `..`, drive letters).
/// Returns `None` for entries that should be skipped.
fn sanitize_archive_path(raw_path: &str, strip_components: u32) -> Option<String> {
    let components: Vec<&str> = raw_path
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .collect();
    if components.len() <= strip_components as usize {
        return None; // the stripped root itself and empty components
    }
    let relative = components[strip_components as usize..].join("/");
    if relative
        .split('/')
        .any(|part| part == ".." || part.contains(':') || part.is_empty())
    {
        return None;
    }
    Some(relative)
}

/// Extract a `.tar.bz2` archive, stripping leading components and keeping only
/// the requested relative paths (or everything when `extract_only` is empty).
/// Path traversal is rejected at every entry.
fn extract_tarbz2(
    archive_path: &Path,
    destination_root: &Path,
    strip_components: u32,
    extract_only: &[String],
    cancel: &CancelHandle,
) -> Result<(), Error> {
    let file = std::fs::File::open(archive_path).map_err(Error::Io)?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| Error::Archive(error.to_string()))?;
    for entry in entries {
        if cancel.is_cancelled() {
            return Err(Error::Canceled);
        }
        let mut entry = entry.map_err(|error| Error::Archive(error.to_string()))?;
        let raw_path = entry
            .path()
            .map_err(|error| Error::Archive(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let relative = match sanitize_archive_path(&raw_path, strip_components) {
            Some(relative) => relative,
            None => continue,
        };
        if !extract_only.is_empty() && !extract_only.iter().any(|kept| kept == &relative) {
            continue;
        }
        let entry_type = entry.header().entry_type();
        let destination = destination_root.join(&relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if entry_type.is_dir() {
            std::fs::create_dir_all(&destination)?;
        } else if entry_type.is_file() {
            let mut output = std::fs::File::create(&destination).map_err(Error::Io)?;
            std::io::copy(&mut entry, &mut output).map_err(Error::Io)?;
        } else {
            continue; // symlinks and special entries are not materialized
        }
    }
    Ok(())
}

fn write_manifest(destination: &Path, entry: &CatalogEntry) -> Result<(), Error> {
    let artifacts: Vec<serde_json::Value> = entry
        .files
        .iter()
        .map(|file| {
            serde_json::json!({
                "path": file.path,
                "size_bytes": file.size_bytes,
                "sha256": file.sha256,
            })
        })
        .collect();
    let manifest = serde_json::json!({
        "schema_version": 1,
        "id": entry.id,
        "kind": format!("{:?}", entry.kind).to_lowercase(),
        "runtime": entry.runtime,
        "source": entry.source,
        "revision": entry.revision,
        "license": { "spdx": entry.license.spdx },
        "artifacts": artifacts,
    });
    let serialized = serde_json::to_vec_pretty(&manifest).map_err(Error::Serialize)?;
    std::fs::write(destination.join("manifest.json"), serialized).map_err(Error::Io)?;
    Ok(())
}

/// Convenience: verify the catalog entry's artifact paths cannot escape the
/// staging directory (defense in depth beyond `extract_tarbz2`).
pub fn assert_safe_artifact_paths(entry: &CatalogEntry) -> Result<(), Error> {
    for file in &entry.files {
        let path = PathBuf::from(&file.path);
        if path.is_absolute()
            || path
                .components()
                .any(|component| component == std::path::Component::ParentDir)
        {
            return Err(Error::Layout {
                detail: format!("unsafe artifact path: {}", file.path),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::downloader::CancelHandle;
    use crate::Fetcher;

    struct FakeFetcher {
        /// (url, bytes) map; unknown urls fail.
        files: std::collections::HashMap<String, Vec<u8>>,
    }

    impl FakeFetcher {
        fn with(url: &str, bytes: Vec<u8>) -> Self {
            let mut files = std::collections::HashMap::new();
            files.insert(url.to_owned(), bytes);
            Self { files }
        }
    }

    impl Fetcher for FakeFetcher {
        fn fetch(
            &self,
            url: &str,
            destination: &Path,
            _cancel: &CancelHandle,
            _on_progress: ProgressFn,
        ) -> futures_util::future::BoxFuture<'_, Result<u64, Error>> {
            let bytes = self
                .files
                .get(url)
                .cloned()
                .ok_or_else(|| Error::Transport(format!("no fake file for {url}")));
            let destination = destination.to_owned();
            Box::pin(async move {
                let bytes = bytes?;
                std::fs::write(destination, &bytes)?;
                Ok(bytes.len() as u64)
            })
        }
    }

    fn sha256(bytes: &[u8]) -> String {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(bytes))
    }

    fn test_entry() -> CatalogEntry {
        serde_json::from_value(serde_json::json!({
            "id": "test-model",
            "name": "Test",
            "kind": "asr",
            "runtime": "faster-whisper",
            "recommended": false,
            "description": "test",
            "license": { "spdx": "MIT" },
            "download_size_bytes": 9,
            "source": "https://huggingface.co/test/repo",
            "revision": "rev1",
            "files": [
                { "path": "model.bin", "size_bytes": 9, "sha256": sha256(b"fake-data") }
            ]
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn install_writes_verified_model_dir() {
        let root = std::env::temp_dir().join(format!("lst-install-writes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://huggingface.co/test/repo/resolve/rev1/model.bin",
            b"fake-data".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let entry = test_entry();
        installer
            .install(&entry, &CancelHandle::default(), Arc::new(|_| {}))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(root.join("test-model").join("model.bin")).unwrap(),
            b"fake-data"
        );
        assert!(root.join("test-model").join("manifest.json").is_file());
        assert!(installer.store().is_installed("test-model"));
        assert!(!root.join(".staging-test-model-0").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_rejects_checksum_mismatch_and_leaves_no_dir() {
        let root = std::env::temp_dir().join(format!("lst-install-checksum-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://huggingface.co/test/repo/resolve/rev1/model.bin",
            b"tampered!".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let entry = test_entry();
        let error = installer
            .install(&entry, &CancelHandle::default(), Arc::new(|_| {}))
            .await
            .unwrap_err();
        assert!(matches!(error, Error::Checksum { .. }));
        assert!(!root.join("test-model").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_rejects_second_install() {
        let root = std::env::temp_dir().join(format!("lst-install-second-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://huggingface.co/test/repo/resolve/rev1/model.bin",
            b"fake-data".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let entry = test_entry();
        installer
            .install(&entry, &CancelHandle::default(), Arc::new(|_| {}))
            .await
            .unwrap();
        let error = installer
            .install(&entry, &CancelHandle::default(), Arc::new(|_| {}))
            .await
            .unwrap_err();
        assert!(matches!(error, Error::AlreadyInstalled { .. }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancelled_install_cleans_up() {
        let root = std::env::temp_dir().join(format!("lst-install-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://huggingface.co/test/repo/resolve/rev1/model.bin",
            b"fake-data".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let entry = test_entry();
        let cancel = CancelHandle::default();
        cancel.cancel();
        let error = installer
            .install(&entry, &cancel, Arc::new(|_| {}))
            .await
            .unwrap_err();
        assert!(matches!(error, Error::Canceled));
        assert!(!root.join("test-model").exists());
        assert!(!std::fs::read_dir(&root).unwrap().any(|e| {
            e.unwrap().file_name().to_string_lossy().starts_with(".staging")
        }));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sanitizer_strips_root_and_blocks_traversal() {
        assert_eq!(
            sanitize_archive_path("bundle-v1/model.onnx", 1),
            Some("model.onnx".to_owned())
        );
        assert_eq!(
            sanitize_archive_path("bundle-v1/sub/tokens.txt", 1),
            Some("sub/tokens.txt".to_owned())
        );
        // `..` escapes are rejected, not silently rewritten.
        assert_eq!(sanitize_archive_path("bundle-v1/../../escape.bin", 1), None);
        // Drive-letter paths are rejected when not consumed by stripping.
        assert_eq!(sanitize_archive_path("C:/evil.bin", 0), None);
        // A leading slash collapses to a relative path (still contained).
        assert_eq!(sanitize_archive_path("/etc/passwd", 0), Some("etc/passwd".to_owned()));
        // The stripped root itself is skipped.
        assert_eq!(sanitize_archive_path("bundle-v1", 1), None);
        // Backslash separators are normalized.
        assert_eq!(
            sanitize_archive_path("bundle-v1\\model.onnx", 1),
            Some("model.onnx".to_owned())
        );
    }

    #[test]
    fn extractor_strips_root_and_keeps_only_requested_files() {
        // Build a tar.bz2 with a top-level dir containing two payloads.
        let root = std::env::temp_dir().join(format!("lst-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let payload = b"archive-data";
        let tar_path = root.join("bundle.tar.bz2");
        {
            let mut builder = tar::Builder::new(Vec::new());
            for (name, contents) in [
                ("bundle-v1/model.onnx", payload),
                ("bundle-v1/tokens.txt", payload),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder
                    .append_data(&mut header, name, &contents[..])
                    .unwrap();
            }
            builder.finish().unwrap();
            let bytes = builder.into_inner().unwrap();
            let mut out = std::fs::File::create(&tar_path).unwrap();
            let mut encoder =
                bzip2::write::BzEncoder::new(&mut out, bzip2::Compression::best());
            std::io::Write::write_all(&mut encoder, &bytes).unwrap();
            encoder.finish().unwrap();
        }

        let destination = root.join("out");
        std::fs::create_dir_all(&destination).unwrap();
        let cancel = CancelHandle::default();
        extract_tarbz2(
            &tar_path,
            &destination,
            1,
            &["model.onnx".to_owned()],
            &cancel,
        )
        .unwrap();
        assert_eq!(std::fs::read(destination.join("model.onnx")).unwrap(), payload);
        assert!(!destination.join("tokens.txt").exists());

        std::fs::remove_dir_all(root).unwrap();
    }
}
