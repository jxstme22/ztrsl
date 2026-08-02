//! Model manager: pinned catalog, verified staged installs, safe deletion.
//!
//! All downloads are plain GETs to public, revision-pinned URLs (HuggingFace,
//! sherpa-onnx GitHub releases) with committed SHA-256 checksums. No API keys
//! are ever part of the catalog or the download path. Installs stage every
//! artifact, verify all checksums, then atomically rename into the model
//! store; a failed or cancelled install never leaves a partial model.

mod catalog;
mod downloader;
mod installer;
mod store;

pub use catalog::{CatalogArchive, CatalogEntry, CatalogEntryView, CatalogFile, ModelCatalog, ModelKind};
pub use downloader::{CancelHandle, DownloadProgress, Fetcher, ProgressFn, ReqwestFetcher, verify_file_sha256};
pub use installer::{InstallPhase, InstallProgress, InstallProgressFn, ModelInstaller};
pub use store::{InstalledModel, ModelStore};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("checksum mismatch for {path}: expected {expected}, got {actual}")]
    Checksum {
        path: String,
        expected: String,
        actual: String,
    },
    #[error("size mismatch for {path}: expected {expected} bytes, got {actual}")]
    Size {
        path: String,
        expected: u64,
        actual: u64,
    },
    #[error("archive error: {0}")]
    Archive(String),
    #[error("invalid archive layout: {detail}")]
    Layout { detail: String },
    #[error("model already installed: {id}")]
    AlreadyInstalled { id: String },
    #[error("model not installed: {id}")]
    NotFound { id: String },
    #[error("model {id} is in use: {detail}")]
    ModelInUse { id: String, detail: String },
    #[error("refusing to delete unknown directory: {path}")]
    UnknownDirectory { path: String },
    #[error("install cancelled")]
    Canceled,
}
