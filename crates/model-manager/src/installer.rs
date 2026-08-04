//! Staged, verified installs: download everything into a sibling staging
//! directory, verify every SHA-256, then atomically rename into place. A
//! partial or failed install never leaves a half-written model directory.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::Error;
use crate::catalog::{CatalogArchive, CatalogEntry, CatalogFile};
use crate::downloader::{CancelHandle, DownloadProgress, Fetcher, ProgressFn};
use crate::provider::{candidate_urls, region_from_env};
use crate::store::ModelStore;

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
    /// Hugging Face host used for downloads (mirror-aware).
    hf_endpoint: String,
}

impl ModelInstaller {
    pub fn new(store: ModelStore, fetcher: Arc<dyn Fetcher>) -> Self {
        Self {
            store,
            fetcher,
            hf_endpoint: crate::catalog::huggingface_endpoint(),
        }
    }

    /// Override the Hugging Face endpoint used for downloads (mirror support).
    pub fn with_hf_endpoint(mut self, endpoint: String) -> Self {
        self.hf_endpoint = endpoint;
        self
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
            return Err(Error::AlreadyInstalled {
                id: entry.id.clone(),
            });
        }
        assert_safe_artifact_paths(entry)?;
        let root = self.store.root();
        std::fs::create_dir_all(root)?;
        let staging = root.join(format!(".staging-{}-{}", entry.id, std::process::id()));
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
            let url =
                crate::catalog::ModelCatalog::embedded().file_url(entry, file, &self.hf_endpoint);
            let expected_size = file.size_bytes;
            let progress = self.plain_progress(
                index,
                file_count,
                total_bytes,
                downloaded,
                file,
                on_progress.clone(),
            );
            self.fetch_with_failover(&url, &destination, cancel, progress, &file.sha256)
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

    /// Download one pinned artifact across the provider chain (Phase 9,
    /// ADR-018). Providers are tried in region order; only *transport*
    /// failures fail over. A downloaded artifact that fails SHA-256
    /// verification aborts the install — failover never substitutes a
    /// different artifact.
    async fn fetch_with_failover(
        &self,
        url: &str,
        destination: &Path,
        cancel: &CancelHandle,
        on_progress: ProgressFn,
        expected_sha256: &str,
    ) -> Result<(), Error> {
        let region = region_from_env();
        let candidates = candidate_urls(url, region, Some(&self.hf_endpoint));
        let mut last_error: Option<Error> = None;
        for candidate in &candidates {
            if cancel.is_cancelled() {
                return Err(Error::Canceled);
            }
            let _ = std::fs::remove_file(destination);
            match self
                .fetcher
                .fetch(candidate, destination, cancel, on_progress.clone())
                .await
            {
                Ok(_) => {
                    // The artifact must still verify against the pinned
                    // checksum before we accept any provider's bytes.
                    match crate::downloader::verify_file_sha256(destination, expected_sha256) {
                        Ok(()) => return Ok(()),
                        Err(error) => return Err(error),
                    }
                }
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }
        Err(last_error.unwrap_or(Error::Transport(
            "no download provider was reachable".to_owned(),
        )))
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

    /// Download the single archive artifact and extract the requested files.
    /// Mirrors `download_plain_files`' parameter list for progress reporting.
    #[allow(clippy::too_many_arguments)]
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
        let url = crate::catalog::rewrite_hf_url(&archive.url, &self.hf_endpoint);
        self.fetch_with_failover(&url, &archive_path, cancel, progress, &archive.sha256)
            .await?;
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

    /// Download a model from an arbitrary http(s) URL and install it into
    /// the store. Three shapes are supported:
    ///
    /// - a **zip archive with an embedded `manifest.json`** (offline-pack
    ///   layout): the manifest supplies the id/kind/runtime/license and every
    ///   artifact is verified (size + SHA-256) against it;
    /// - a **zip archive without a manifest**: `requested_id`/
    ///   `requested_kind`/`requested_runtime` are used and every file becomes
    ///   an artifact;
    /// - a **single file** (e.g. `model.onnx`): installed under
    ///   `requested_id` with the caller-supplied kind/runtime.
    ///
    /// Artifact roles are inferred from well-known filenames so the runtime
    /// providers (sherpa-onnx Nemo CTC) can find what they need:
    /// `model.onnx` → "model", `tokens.txt` → "tokens".
    ///
    /// `requested_id` may be empty only when the archive carries a manifest
    /// (the manifest's id wins). Known NCSpeech ids are installed under the
    /// local-export layout (`artifacts/<id>`, which the inference sidecar
    /// resolves); anything else lands in `root/<id>` so the store scan finds
    /// it.
    pub async fn install_from_url(
        &self,
        url: &str,
        requested_id: &str,
        requested_kind: &str,
        requested_runtime: &str,
    ) -> Result<String, Error> {
        let parsed = url::Url::parse(url).map_err(|error| Error::Layout {
            detail: format!("invalid model URL: {error}"),
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(Error::Layout {
                detail: "model URL must be http(s)".to_owned(),
            });
        }
        let root = self.store.root();
        std::fs::create_dir_all(root)?;
        let staging = root.join(format!(".url-staging-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging)?;

        let result = async {
            let download = staging.join("download.bin");
            let cancel = CancelHandle::default();
            self.fetcher
                .fetch(url, &download, &cancel, Arc::new(|_| {}))
                .await?;
            let model_dir = staging.join("model");
            std::fs::create_dir_all(&model_dir)?;
            if is_zip_archive(&download) {
                extract_zip(&download, &model_dir)?;
            } else if is_tarbz2_archive(&download) {
                extract_tarbz2(&download, &model_dir, 0, &[], &cancel)?;
            } else {
                let file_name = parsed
                    .path_segments()
                    .and_then(|mut segments| segments.next_back())
                    .filter(|name| !name.is_empty())
                    .unwrap_or("model.onnx");
                std::fs::rename(
                    &download,
                    model_dir.join(sanitize_single_file_name(file_name)),
                )?;
            }
            // Optional nested folder from zip layouts like
            // "ncspeech-tl-fastconformer-hybrid-large/model.onnx": flatten a
            // single top-level directory into the model root.
            flatten_single_subdir(&model_dir)?;

            let (id, kind, runtime, license_spdx) = match read_url_manifest(&model_dir)? {
                Some(manifest) => {
                    if !requested_id.is_empty() && requested_id != manifest.id {
                        return Err(Error::Layout {
                            detail: format!(
                                "the URL provides model id '{}' (the requested id '{}' does \
                                 not match); leave the model id empty to accept it",
                                manifest.id, requested_id
                            ),
                        });
                    }
                    (
                        manifest.id.clone(),
                        manifest.kind.clone(),
                        manifest.runtime.clone(),
                        manifest.license.spdx.clone(),
                    )
                }
                None => {
                    if requested_id.is_empty() {
                        return Err(Error::Layout {
                            detail: "a model id is required when the URL has no manifest"
                                .to_owned(),
                        });
                    }
                    (
                        requested_id.to_owned(),
                        requested_kind.to_owned(),
                        requested_runtime.to_owned(),
                        "CC-BY-4.0".to_owned(),
                    )
                }
            };

            if self.store.is_installed(&id) {
                return Err(Error::AlreadyInstalled { id: id.clone() });
            }

            if read_url_manifest(&model_dir)?.is_none() {
                // NCSpeech CTC exports need both halves of the recognizer.
                if (kind == "asr" && runtime == "sherpa-onnx")
                    && (!model_dir.join("model.onnx").is_file()
                        || !model_dir.join("tokens.txt").is_file())
                {
                    return Err(Error::Layout {
                        detail: "downloaded model is missing model.onnx and/or tokens.txt (the \
                             URL must provide both for sherpa-onnx CTC models)"
                            .to_owned(),
                    });
                }
            }
            write_url_manifest(&model_dir, &id, &kind, &runtime, &license_spdx, url)?;
            let destination = if is_known_ncspeech_id(&id) {
                // Local-export layout: the inference sidecar resolves NCSpeech
                // from LST_MODEL_DIR/artifacts/<id>.
                root.join("artifacts").join(&id)
            } else {
                root.join(&id)
            };
            if destination.exists() {
                return Err(Error::AlreadyInstalled { id: id.clone() });
            }
            std::fs::create_dir_all(destination.parent().expect("destination has a parent"))?;
            std::fs::rename(&model_dir, &destination)?;
            Ok(id)
        }
        .await;

        let _ = std::fs::remove_dir_all(&staging);
        result
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
            return Err(Error::AlreadyInstalled {
                id: entry.id.clone(),
            });
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

/// True when the file starts with the zip local-file-header magic bytes.
fn is_zip_archive(path: &Path) -> bool {
    use std::io::Read;
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic).is_ok() && magic == [0x50, 0x4b, 0x03, 0x04]
}

/// True when the file starts with the bzip2 magic bytes ("BZh").
fn is_tarbz2_archive(path: &Path) -> bool {
    use std::io::Read;
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut magic = [0_u8; 3];
    file.read_exact(&mut magic).is_ok() && magic == *b"BZh"
}

/// The known NCSpeech local-export ids, which the inference sidecar resolves
/// from `LST_MODEL_DIR/artifacts/<id>`.
pub fn is_known_ncspeech_id(id: &str) -> bool {
    matches!(
        id,
        "ncspeech-tl-fastconformer-hybrid-large"
            | "ncspeech-zh-citrinet-1024-gamma"
            | "ncspeech-zh-parakeet-ctc-0.6b"
    )
}

/// Read an embedded offline-pack manifest from a staged model directory, when
/// present. Artifacts are validated (schema, non-empty, safe paths) and each
/// declared file is verified against its size and SHA-256.
fn read_url_manifest(
    model_dir: &Path,
) -> Result<Option<crate::offline_pack::OfflinePackManifest>, Error> {
    let manifest_path = model_dir.join("manifest.json");
    if !manifest_path.is_file() {
        return Ok(None);
    }
    let manifest_bytes = std::fs::read(&manifest_path).map_err(Error::Io)?;
    let manifest: crate::offline_pack::OfflinePackManifest =
        serde_json::from_slice(&manifest_bytes).map_err(Error::Serialize)?;
    if manifest.schema_version != 1 {
        return Err(Error::Layout {
            detail: format!(
                "unsupported model manifest schema {}",
                manifest.schema_version
            ),
        });
    }
    if manifest.artifacts.is_empty() {
        return Err(Error::Layout {
            detail: format!("model manifest {} declares no artifacts", manifest.id),
        });
    }
    for artifact in &manifest.artifacts {
        let Some(_) = sanitize_archive_path(&artifact.path, 0) else {
            return Err(Error::Layout {
                detail: format!(
                    "model manifest {} declares an unsafe artifact path '{}'",
                    manifest.id, artifact.path
                ),
            });
        };
        let file = model_dir.join(&artifact.path);
        if !file.is_file() {
            return Err(Error::Layout {
                detail: format!(
                    "model manifest {} is missing artifact {}",
                    manifest.id, artifact.path
                ),
            });
        }
        if std::fs::metadata(&file)?.len() != artifact.size_bytes {
            return Err(Error::Size {
                path: file.display().to_string(),
                expected: artifact.size_bytes,
                actual: std::fs::metadata(&file)?.len(),
            });
        }
        crate::downloader::verify_file_sha256(&file, &artifact.sha256)?;
    }
    Ok(Some(manifest))
}

/// Extract a zip archive into `destination_root`, rejecting path traversal
/// at every entry and skipping unsafe entries. Directory entries are created;
/// file entries are written with a bounded name length.
fn extract_zip(archive_path: &Path, destination_root: &Path) -> Result<(), Error> {
    let file = std::fs::File::open(archive_path).map_err(Error::Io)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| Error::Archive(error.to_string()))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| Error::Archive(error.to_string()))?;
        let Some(relative) = sanitize_archive_path(entry.name(), 0) else {
            continue;
        };
        if relative.len() > 512 {
            return Err(Error::Layout {
                detail: format!("archive entry path too long: {relative}"),
            });
        }
        let destination = destination_root.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&destination)?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = std::fs::File::create(&destination)?;
        std::io::copy(&mut entry, &mut output)?;
    }
    Ok(())
}

/// Keep only a safe basename for a single-file URL download.
fn sanitize_single_file_name(name: &str) -> String {
    let basename = name.split(['/', '\\']).next_back().unwrap_or("model.onnx");
    if basename
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        basename.to_owned()
    } else {
        "model.onnx".to_owned()
    }
}

/// Flatten a single top-level directory produced by zip layouts like
/// `ncspeech-tl-fastconformer-hybrid-large/model.onnx` into the model root.
fn flatten_single_subdir(model_dir: &Path) -> Result<(), Error> {
    let entries = std::fs::read_dir(model_dir)?;
    let mut subdirs = Vec::new();
    let mut files = 0_usize;
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            subdirs.push(entry.path());
        } else {
            files += 1;
        }
    }
    if files == 0 && subdirs.len() == 1 {
        let nested = &subdirs[0];
        for entry in std::fs::read_dir(nested)? {
            let entry = entry?;
            let target = model_dir.join(entry.file_name());
            let _ = std::fs::remove_file(&target);
            std::fs::rename(entry.path(), target)?;
        }
        std::fs::remove_dir(nested)?;
    }
    Ok(())
}

/// Write the synthesized manifest for a URL-installed model. Artifact roles
/// are inferred from well-known filenames so the sherpa-onnx Nemo CTC
/// provider can resolve `model` and `tokens`.
fn write_url_manifest(
    model_dir: &Path,
    id: &str,
    kind: &str,
    runtime: &str,
    license_spdx: &str,
    source_url: &str,
) -> Result<(), Error> {
    let artifacts = std::fs::read_dir(model_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let size_bytes = std::fs::metadata(&path).map_err(Error::Io)?.len();
            let sha256 = crate::downloader::sha256_of(&path)?;
            let role = match file_name.as_str() {
                "model.onnx" => Some("model"),
                "tokens.txt" => Some("tokens"),
                _ => None,
            };
            let mut artifact = serde_json::Map::new();
            artifact.insert("path".to_owned(), serde_json::json!(file_name));
            artifact.insert("size_bytes".to_owned(), serde_json::json!(size_bytes));
            artifact.insert("sha256".to_owned(), serde_json::json!(sha256));
            if let Some(role) = role {
                artifact.insert("role".to_owned(), serde_json::json!(role));
            }
            Ok(serde_json::Value::Object(artifact))
        })
        .collect::<Result<Vec<_>, Error>>()?;
    let manifest = serde_json::json!({
        "schema_version": 1,
        "id": id,
        "kind": kind,
        "runtime": runtime,
        "source": format!("url:{source_url}"),
        "revision": "url-import",
        "license": { "spdx": license_spdx },
        "artifacts": artifacts,
    });
    let serialized = serde_json::to_vec_pretty(&manifest).map_err(Error::Serialize)?;
    std::fs::write(model_dir.join("manifest.json"), serialized).map_err(Error::Io)?;
    Ok(())
}

/// Extract a `.tar.bz2` archive, stripping leading components and keeping only/// the requested relative paths (or everything when `extract_only` is empty).
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
    use crate::Fetcher;
    use crate::downloader::CancelHandle;

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
        let root =
            std::env::temp_dir().join(format!("lst-install-checksum-{}", std::process::id()));
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
    async fn install_fails_over_to_next_provider_on_transport_error() {
        // The upstream URL is unreachable; only the hf-mirror candidate has
        // the pinned artifact. The installer must fall through providers in
        // region order and still verify the checksum before committing.
        let root =
            std::env::temp_dir().join(format!("lst-install-failover-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://hf-mirror.com/test/repo/resolve/rev1/model.bin",
            b"fake-data".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher)
            .with_hf_endpoint(crate::catalog::DEFAULT_HF_ENDPOINT.to_owned());
        let entry = test_entry();
        installer
            .install(&entry, &CancelHandle::default(), Arc::new(|_| {}))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(root.join("test-model").join("model.bin")).unwrap(),
            b"fake-data"
        );
        assert!(installer.store().is_installed("test-model"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_aborts_when_every_provider_is_unreachable() {
        let root =
            std::env::temp_dir().join(format!("lst-install-no-provider-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://huggingface.co/test/repo/resolve/rev1/model.bin",
            b"fake-data".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher)
            .with_hf_endpoint("https://example.test".to_owned());
        let entry = test_entry();
        let error = installer
            .install(&entry, &CancelHandle::default(), Arc::new(|_| {}))
            .await
            .unwrap_err();
        assert!(matches!(error, Error::Transport(_)));
        assert!(!installer.store().is_installed("test-model"));
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
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".staging")
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
        assert_eq!(
            sanitize_archive_path("/etc/passwd", 0),
            Some("etc/passwd".to_owned())
        );
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
            let mut encoder = bzip2::write::BzEncoder::new(&mut out, bzip2::Compression::best());
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
        assert_eq!(
            std::fs::read(destination.join("model.onnx")).unwrap(),
            payload
        );
        assert!(!destination.join("tokens.txt").exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    fn zip_pack(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[tokio::test]
    async fn install_from_url_accepts_zip_and_writes_roles() {
        let root = std::env::temp_dir().join(format!("lst-url-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let zip = zip_pack(&[
            (
                "ncspeech-tl-fastconformer-hybrid-large/model.onnx",
                b"onnx-bytes",
            ),
            (
                "ncspeech-tl-fastconformer-hybrid-large/tokens.txt",
                b"tokens-bytes",
            ),
        ]);
        let fetcher: Arc<dyn Fetcher> =
            Arc::new(FakeFetcher::with("https://example.test/pack.zip", zip));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        installer
            .install_from_url(
                "https://example.test/pack.zip",
                "ncspeech-tl-fastconformer-hybrid-large",
                "asr",
                "sherpa-onnx",
            )
            .await
            .unwrap();
        let dir = root
            .join("artifacts")
            .join("ncspeech-tl-fastconformer-hybrid-large");
        assert_eq!(
            std::fs::read(dir.join("model.onnx")).unwrap(),
            b"onnx-bytes"
        );
        assert_eq!(
            std::fs::read(dir.join("tokens.txt")).unwrap(),
            b"tokens-bytes"
        );
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["id"], "ncspeech-tl-fastconformer-hybrid-large");
        let roles: Vec<&str> = manifest["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|artifact| artifact["role"].as_str().unwrap_or_default())
            .collect();
        assert!(roles.contains(&"model"));
        assert!(roles.contains(&"tokens"));
        // The nested folder from the zip was flattened away.
        assert!(!dir.join("ncspeech-tl-fastconformer-hybrid-large").exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_from_url_rejects_missing_required_files() {
        let root = std::env::temp_dir().join(format!("lst-url-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let zip = zip_pack(&[("model.onnx", b"onnx-bytes")]);
        let fetcher: Arc<dyn Fetcher> =
            Arc::new(FakeFetcher::with("https://example.test/pack.zip", zip));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let error = installer
            .install_from_url(
                "https://example.test/pack.zip",
                "ncspeech-tl-fastconformer-hybrid-large",
                "asr",
                "sherpa-onnx",
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("tokens.txt"));
        assert!(!root.join("artifacts").exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_from_url_accepts_single_onnx_file() {
        let root = std::env::temp_dir().join(format!("lst-url-single-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let fetcher: Arc<dyn Fetcher> = Arc::new(FakeFetcher::with(
            "https://example.test/model.bin",
            b"fake-data".to_vec(),
        ));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let installed_id = installer
            .install_from_url(
                "https://example.test/model.bin",
                "custom-whisper-model",
                "asr",
                "faster-whisper",
            )
            .await
            .unwrap();
        assert_eq!(installed_id, "custom-whisper-model");
        // Custom ids land in the catalog layout (`root/<id>`) so the store
        // scan finds them.
        let dir = root.join("custom-whisper-model");
        assert_eq!(std::fs::read(dir.join("model.bin")).unwrap(), b"fake-data");
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["id"], "custom-whisper-model");
        assert_eq!(manifest["runtime"], "faster-whisper");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_from_url_uses_embedded_manifest() {
        let root = std::env::temp_dir().join(format!("lst-url-manifest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": "my-whisper-pack",
            "kind": "asr",
            "runtime": "faster-whisper",
            "source": "https://example.test/pack",
            "revision": "v1",
            "license": { "spdx": "MIT" },
            "artifacts": [
                { "path": "model.bin", "size_bytes": 9, "sha256": sha256(b"fake-data") }
            ]
        });
        let zip = zip_pack(&[
            (
                "my-whisper-pack/manifest.json",
                serde_json::to_vec(&manifest).unwrap().as_slice(),
            ),
            ("my-whisper-pack/model.bin", b"fake-data"),
        ]);
        let fetcher: Arc<dyn Fetcher> =
            Arc::new(FakeFetcher::with("https://example.test/pack.zip", zip));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let installed_id = installer
            .install_from_url("https://example.test/pack.zip", "", "", "")
            .await
            .unwrap();
        assert_eq!(installed_id, "my-whisper-pack");
        let dir = root.join("my-whisper-pack");
        assert_eq!(std::fs::read(dir.join("model.bin")).unwrap(), b"fake-data");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn install_from_url_rejects_id_mismatch_with_manifest() {
        let root = std::env::temp_dir().join(format!("lst-url-mismatch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": "my-whisper-pack",
            "kind": "asr",
            "runtime": "faster-whisper",
            "source": "https://example.test/pack",
            "revision": "v1",
            "license": { "spdx": "MIT" },
            "artifacts": [
                { "path": "model.bin", "size_bytes": 9, "sha256": sha256(b"fake-data") }
            ]
        });
        let zip = zip_pack(&[
            (
                "my-whisper-pack/manifest.json",
                serde_json::to_vec(&manifest).unwrap().as_slice(),
            ),
            ("my-whisper-pack/model.bin", b"fake-data"),
        ]);
        let fetcher: Arc<dyn Fetcher> =
            Arc::new(FakeFetcher::with("https://example.test/pack.zip", zip));
        let installer = ModelInstaller::new(ModelStore::new(root.clone()), fetcher);
        let error = installer
            .install_from_url(
                "https://example.test/pack.zip",
                "some-other-id",
                "asr",
                "faster-whisper",
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("my-whisper-pack"));

        std::fs::remove_dir_all(root).unwrap();
    }
}
