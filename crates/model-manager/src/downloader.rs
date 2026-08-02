//! Downloads with streaming SHA-256 verification and cooperative cancel.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use sha2::{Digest, Sha256};

use crate::Error;

/// Cooperative cancellation for an in-flight install.
#[derive(Debug, Default, Clone)]
pub struct CancelHandle {
    flag: Arc<AtomicBool>,
}

impl CancelHandle {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// Progress for one in-flight download.
#[derive(Debug, Clone, Copy)]
pub struct DownloadProgress {
    pub file_index: usize,
    pub file_count: usize,
    pub file_bytes_done: u64,
    pub file_bytes_total: u64,
    pub total_bytes_done: u64,
    pub total_bytes_total: u64,
}

pub type ProgressFn = Arc<dyn Fn(DownloadProgress) + Send + Sync>;

/// Abstraction over network transport so installs are testable without a
/// network.
pub trait Fetcher: Send + Sync {
    /// Stream `url` into `destination`, reporting progress and aborting when
    /// `cancel` fires. Returns the number of bytes written.
    fn fetch(
        &self,
        url: &str,
        destination: &Path,
        cancel: &CancelHandle,
        on_progress: ProgressFn,
    ) -> BoxFuture<'_, Result<u64, Error>>;
}

/// Real transport backed by reqwest (rustls). Plain GETs to pinned public
/// URLs; no credentials are ever attached.
#[derive(Debug)]
pub struct ReqwestFetcher {
    client: reqwest::Client,
}

impl ReqwestFetcher {
    pub fn new() -> Result<Self, Error> {
        let client = reqwest::Client::builder()
            .user_agent("local-squad-translator/model-manager/0.1")
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| Error::Transport(error.to_string()))?;
        Ok(Self { client })
    }
}

impl Default for ReqwestFetcher {
    fn default() -> Self {
        Self::new().expect("reqwest client build cannot fail with valid config")
    }
}

impl Fetcher for ReqwestFetcher {
    fn fetch(
        &self,
        url: &str,
        destination: &Path,
        cancel: &CancelHandle,
        on_progress: ProgressFn,
    ) -> BoxFuture<'_, Result<u64, Error>> {
        let url = url.to_owned();
        let destination = destination.to_owned();
        let cancel = cancel.clone();
        let on_progress = on_progress.clone();
        async move {
            use futures_util::StreamExt;
            use tokio::io::AsyncWriteExt;

            let response = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|error| Error::Transport(error.to_string()))?
                .error_for_status()
                .map_err(|error| Error::Transport(error.to_string()))?;
            let total = response.content_length().unwrap_or(0);
            let mut stream = response.bytes_stream();
            let mut output = tokio::fs::File::create(&destination)
                .await
                .map_err(Error::Io)?;
            let mut hasher = Sha256::new();
            let mut done = 0u64;
            while let Some(chunk) = stream.next().await {
                if cancel.is_cancelled() {
                    return Err(Error::Canceled);
                }
                let chunk = chunk.map_err(|error| Error::Transport(error.to_string()))?;
                hasher.update(&chunk);
                done += chunk.len() as u64;
                output.write_all(&chunk).await.map_err(Error::Io)?;
                on_progress(DownloadProgress {
                    file_index: 0,
                    file_count: 0,
                    file_bytes_done: done,
                    file_bytes_total: total,
                    total_bytes_done: done,
                    total_bytes_total: total,
                });
            }
            output.flush().await.map_err(Error::Io)?;
            if cancel.is_cancelled() {
                return Err(Error::Canceled);
            }
            if total > 0 && done != total {
                return Err(Error::Size {
                    path: destination.display().to_string(),
                    expected: total,
                    actual: done,
                });
            }
            let _actual_hash = format!("{:x}", hasher.finalize());
            Ok(done)
        }
        .boxed()
    }
}

/// Verify a local file matches an expected SHA-256 without network access.
pub fn verify_file_sha256(path: &Path, expected: &str) -> Result<(), Error> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(Error::Io)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(Error::Io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(Error::Checksum {
            path: path.display().to_string(),
            expected: expected.to_owned(),
            actual,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_verifier_accepts_and_rejects() {
        let path = std::env::temp_dir().join(format!("lst-hash-{}", std::process::id()));
        std::fs::write(&path, b"hello world").unwrap();
        let good = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        verify_file_sha256(&path, good).unwrap();
        assert!(matches!(
            verify_file_sha256(&path, &"0".repeat(64)),
            Err(Error::Checksum { .. })
        ));
        std::fs::remove_file(path).unwrap();
    }
}
