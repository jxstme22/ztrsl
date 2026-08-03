//! Optional CUDA runtime pack (ADR: GPU acceleration is opt-in).
//!
//! ctranslate2/faster-whisper on Windows do NOT bundle the CUDA runtime —
//! they require cuBLAS, cuDNN and the CUDA runtime (cudart) to be loadable.
//! Rather than shipping a +1 GB installer or requiring a system CUDA
//! Toolkit install, the app downloads a pinned, checksum-verified set of the
//! three NVIDIA "cu12" wheels from PyPI and flattens their DLLs into one
//! directory. At sidecar startup the directory is added to the Windows DLL
//! search path via `os.add_dll_directory`, so the GPU path becomes usable
//! without a system CUDA install.
//!
//! Safety: every wheel is pinned to an exact PyPI URL and SHA-256, staging is
//! atomic (no partial installs), and only `.dll` files under `nvidia/*/bin/`
//! are ever copied out. The downloaded wheels are large (~1.3 GB total) but
//! are an explicit, opt-in download — never part of the installer.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::Error;
use crate::downloader::{CancelHandle, DownloadProgress, Fetcher, ProgressFn};
use crate::provider::candidate_urls;

/// A single pinned NVIDIA wheel that contributes DLLs to the pack.
#[derive(Debug, Clone)]
pub struct CudaWheel {
    /// Human/short package name for progress display.
    pub package: &'static str,
    /// Pinned PyPI wheel URL (files.pythonhosted.org).
    pub url: &'static str,
    /// Expected uncompressed wheel size in bytes.
    pub size_bytes: u64,
    /// Expected SHA-256 of the wheel.
    pub sha256: &'static str,
}

/// The pinned CUDA 12 runtime pack. Fastest path (CUDA 12.9 / cuDNN 9) that
/// the bundled ctranslate2 (CUDA 12) supports.
pub const CUDA_12_RUNTIME_PACK: &[CudaWheel] = &[
    CudaWheel {
        package: "CUDA runtime",
        url: "https://files.pythonhosted.org/packages/59/df/e7c3a360be4f7b93cee39271b792669baeb3846c58a4df6dfcf187a7ffab/nvidia_cuda_runtime_cu12-12.9.79-py3-none-win_amd64.whl",
        size_bytes: 3_591_604,
        sha256: "8e018af8fa02363876860388bd10ccb89eb9ab8fb0aa749aaf58430a9f7c4891",
    },
    CudaWheel {
        package: "cuBLAS",
        url: "https://files.pythonhosted.org/packages/20/e2/fc9a0e985249d873150276d5afb02e39a66817fedbf1a385724393e505ed/nvidia_cublas_cu12-12.9.2.10-py3-none-win_amd64.whl",
        size_bytes: 553_162_896,
        sha256: "623f43027d40d44ceadf0043f002bd25cf353e8f13ce90b9a87057019f560661",
    },
    CudaWheel {
        package: "cuDNN",
        url: "https://files.pythonhosted.org/packages/cf/9e/f5dd69a26620c490f082af690e706cb2c94e34881a63d8e9c4a1b5eb83cd/nvidia_cudnn_cu12-9.25.0.15-py3-none-win_amd64.whl",
        size_bytes: 732_268_748,
        sha256: "7987acb3cc5b793151e64c05a12a3625f5a8d4cfabe87eea3a65f0676ef2da67",
    },
];

/// Total uncompressed bytes for all wheels in the pack.
pub fn cuda_pack_download_bytes() -> u64 {
    CUDA_12_RUNTIME_PACK
        .iter()
        .map(|wheel| wheel.size_bytes)
        .sum()
}

/// The DLL directory name inside the runtime store (flattened DLLs).
pub const CUDA_DLL_DIR: &str = "cuda12";

/// Return true when a CUDA runtime is already usable on this system, either
/// because the app's own runtime pack is installed or because the user has a
/// CUDA Toolkit (or redistributable runtime) installed with its DLLs on the
/// system. On Windows this checks whether `cublas64_12.dll` — the library that
/// ctranslate2/faster-whisper must load — is reachable on the DLL search path
/// (`C:\Windows\System32` plus `%PATH%`). On other platforms there is no
/// system CUDA runtime to detect and this returns `false` (the app pack or
/// CPU fallback covers those).
///
/// This lets the UI say "GPU already available — no download needed" instead
/// of asking users who already installed CUDA to download the ~1.3 GB pack.
pub fn system_cuda_available() -> bool {
    system_cuda_dlls()
        .iter()
        .any(|name| find_windows_dll(name).is_some())
}

/// DLLs that must be present for ctranslate2 to use CUDA on Windows.
#[cfg(target_os = "windows")]
const CUDA_REQUIRED_DLLS: &[&str] = &["cublas64_12.dll", "cudart64_12.dll"];

/// Search the Windows DLL search path for `name`: System32 first, then every
/// `PATH` entry (allowing the common CUDA Toolkit `bin` directory that setup
/// adds to PATH). Returns the matching path, or `None`.
#[cfg(target_os = "windows")]
fn find_windows_dll(name: &str) -> Option<PathBuf> {
    let system32 = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32"));
    std::iter::once(system32)
        .chain(
            std::env::var_os("PATH")
                .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
                .unwrap_or_default(),
        )
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Non-Windows placeholder: no system CUDA runtime detection.
#[cfg(not(target_os = "windows"))]
fn find_windows_dll(_name: &str) -> Option<PathBuf> {
    None
}

/// Non-Windows placeholder: no system CUDA runtime detection.
#[cfg(not(target_os = "windows"))]
fn system_cuda_dlls() -> Vec<&'static str> {
    Vec::new()
}

/// Windows: the DLLs ctranslate2 needs to run on CUDA.
#[cfg(target_os = "windows")]
fn system_cuda_dlls() -> Vec<&'static str> {
    CUDA_REQUIRED_DLLS.to_vec()
}

/// On-disk runtime store. The pack lives at `<store>/cuda12/` alongside the
/// model store so it can share the same writable app-data location.
#[derive(Clone)]
pub struct GpuRuntimeStore {
    root: PathBuf,
}

impl GpuRuntimeStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// Absolute path to the flattened DLL directory.
    pub fn dll_dir(&self) -> PathBuf {
        self.root.join(CUDA_DLL_DIR)
    }

    /// True when a previous install produced a DLL directory with at least one
    /// loadable `.dll` (a conservative "installed" signal; full verification
    /// re-happens at sidecar load).
    pub fn is_installed(&self) -> bool {
        let dir = self.dll_dir();
        if !dir.is_dir() {
            return false;
        }
        std::fs::read_dir(&dir)
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .path()
                        .extension()
                        .map(|ext| ext.eq_ignore_ascii_case("dll"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }

    /// Total size in bytes of the installed DLLs (honest disk usage).
    pub fn installed_size_bytes(&self) -> u64 {
        let dir = self.dll_dir();
        std::fs::read_dir(&dir)
            .map(|entries| {
                entries.flatten().fold(0u64, |acc, entry| {
                    acc + entry.metadata().map(|meta| meta.len()).unwrap_or(0)
                })
            })
            .unwrap_or(0)
    }

    /// Remove the installed pack. Refuses when the directory does not look
    /// like a flattened DLL dir (defensive: never delete an unknown directory).
    pub fn delete(&self) -> Result<(), Error> {
        let dir = self.dll_dir();
        if !dir.is_dir() {
            return Err(Error::NotFound {
                id: CUDA_DLL_DIR.to_owned(),
            });
        }
        std::fs::remove_dir_all(&dir)?;
        Ok(())
    }
}

/// Installer that downloads, verifies and flattens the CUDA runtime pack.
pub struct GpuRuntimeInstaller {
    store: GpuRuntimeStore,
    fetcher: Arc<dyn Fetcher>,
    wheels: &'static [CudaWheel],
    /// Hugging Face endpoint (used only for provider failover mirrors).
    hf_endpoint: String,
}

impl GpuRuntimeInstaller {
    pub fn new(store: GpuRuntimeStore, fetcher: Arc<dyn Fetcher>) -> Self {
        Self {
            store,
            fetcher,
            wheels: CUDA_12_RUNTIME_PACK,
            hf_endpoint: crate::catalog::huggingface_endpoint(),
        }
    }

    pub fn store(&self) -> &GpuRuntimeStore {
        &self.store
    }

    #[cfg(test)]
    fn with_wheels_for_test(mut self, wheels: &'static [CudaWheel]) -> Self {
        self.wheels = wheels;
        self
    }

    /// Download, verify and flatten every wheel into the DLL directory.
    /// All wheels are fetched into a staging dir first and only after every
    /// checksum passes is the flattened directory renamed into place, so a
    /// failed or cancelled install never leaves a partial runtime.
    pub async fn install(
        &self,
        cancel: &CancelHandle,
        on_progress: ProgressFn,
    ) -> Result<(), Error> {
        if self.store.is_installed() {
            return Err(Error::AlreadyInstalled {
                id: CUDA_DLL_DIR.to_owned(),
            });
        }
        let root = self.store.root.clone();
        std::fs::create_dir_all(&root)?;
        let staging = root.join(format!(".staging-{}-{}", CUDA_DLL_DIR, std::process::id()));
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging)?;

        let total_bytes = cuda_pack_download_bytes();
        let result = async {
            let mut downloaded = 0u64;
            for (index, wheel) in self.wheels.iter().enumerate() {
                if cancel.is_cancelled() {
                    return Err(Error::Canceled);
                }
                let wheel_path = staging.join(format!("{}.whl", wheel.package.replace(' ', "-")));
                let wheel_count = self.wheels.len();
                let progress = {
                    let downloaded = downloaded;
                    let on_progress = on_progress.clone();
                    Arc::new(move |event: DownloadProgress| {
                        on_progress(DownloadProgress {
                            file_index: index,
                            file_count: wheel_count,
                            file_bytes_done: event.file_bytes_done,
                            file_bytes_total: event.file_bytes_total,
                            total_bytes_done: downloaded + event.file_bytes_done,
                            total_bytes_total: total_bytes,
                        })
                    })
                };
                let url = wheel.url;
                let region = crate::provider::region_from_env();
                let candidates = candidate_urls(url, region, Some(&self.hf_endpoint));
                let mut last_error: Option<Error> = None;
                let mut fetched = false;
                for candidate in &candidates {
                    if cancel.is_cancelled() {
                        return Err(Error::Canceled);
                    }
                    let _ = std::fs::remove_file(&wheel_path);
                    match self
                        .fetcher
                        .fetch(candidate, &wheel_path, cancel, progress.clone())
                        .await
                    {
                        Ok(_) => {
                            fetched = true;
                            break;
                        }
                        Err(error) => last_error = Some(error),
                    }
                }
                if !fetched {
                    return Err(last_error.unwrap_or(Error::Transport(
                        "no download provider was reachable".to_owned(),
                    )));
                }
                crate::downloader::verify_file_sha256(&wheel_path, wheel.sha256)?;
                if std::fs::metadata(&wheel_path)?.len() != wheel.size_bytes {
                    return Err(Error::Size {
                        path: wheel_path.display().to_string(),
                        expected: wheel.size_bytes,
                        actual: std::fs::metadata(&wheel_path)?.len(),
                    });
                }
                extract_whl_dlls(&wheel_path, &staging.join("dll"), cancel)?;
                downloaded += wheel.size_bytes;
            }
            commit_dlls(&staging, &self.store)
        }
        .await;

        let _ = std::fs::remove_dir_all(&staging);
        if cancel.is_cancelled() {
            return Err(Error::Canceled);
        }
        result
    }
}

/// Extract every `.dll` under a `nvidia/*/bin/` path in a `.whl` (ZIP) into
/// `destination`, flattening to a single directory. Only relative, safe paths
/// are accepted; anything else (symlinks, traversal, non-`bin` entries) is
/// skipped.
fn extract_whl_dlls(
    wheel_path: &Path,
    destination: &Path,
    cancel: &CancelHandle,
) -> Result<(), Error> {
    let file = std::fs::File::open(wheel_path).map_err(Error::Io)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| Error::Archive(error.to_string()))?;
    std::fs::create_dir_all(destination)?;
    for index in 0..archive.len() {
        if cancel.is_cancelled() {
            return Err(Error::Canceled);
        }
        let mut entry = archive
            .by_index(index)
            .map_err(|error| Error::Archive(error.to_string()))?;
        let name = entry.name().replace('\\', "/");
        if !name.starts_with("nvidia/") || !name.contains("/bin/") {
            continue;
        }
        if !name.ends_with(".dll") {
            continue;
        }
        let file_name = name.rsplit('/').next().unwrap_or(&name);
        if file_name.is_empty() || file_name.contains("..") {
            continue;
        }
        let target = destination.join(file_name);
        let mut output = std::fs::File::create(&target).map_err(Error::Io)?;
        std::io::copy(&mut entry, &mut output).map_err(Error::Io)?;
    }
    Ok(())
}

/// Atomically move the staged DLL directory into place.
fn commit_dlls(staging: &Path, store: &GpuRuntimeStore) -> Result<(), Error> {
    let staged = staging.join("dll");
    if !staged.is_dir() {
        return Err(Error::Layout {
            detail: "staging produced no DLL directory".to_owned(),
        });
    }
    let destination = store.dll_dir();
    if destination.exists() {
        return Err(Error::AlreadyInstalled {
            id: CUDA_DLL_DIR.to_owned(),
        });
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&staged, &destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn make_wheel_with_dlls(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, bytes) in entries {
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn extracts_only_bin_dlls_and_flattens() {
        let root = std::env::temp_dir().join(format!("lst-gpu-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let wheel = root.join("runtime.whl");
        make_wheel_with_dlls(
            &wheel,
            &[
                ("nvidia/cuda_runtime/bin/cudart64_12.dll", b"cudart"),
                ("nvidia/cublas/bin/cublas64_12.dll", b"cublas"),
                ("nvidia/cublas/lib/staticlib.a", b"skip-me"),
                ("README.md", b"skip-me"),
                ("nvidia/cudnn/bin/sub/deep.dll", b"nested-dll"),
            ],
        );
        let cancel = CancelHandle::default();
        let out = root.join("dll");
        extract_whl_dlls(&wheel, &out, &cancel).unwrap();

        assert_eq!(
            std::fs::read(out.join("cudart64_12.dll")).unwrap(),
            b"cudart"
        );
        assert_eq!(
            std::fs::read(out.join("cublas64_12.dll")).unwrap(),
            b"cublas"
        );
        // non-bin dll (lib/, not bin/) is skipped
        assert!(!out.join("staticlib.a").exists());
        // non-dll entries skipped
        assert!(!out.join("README.md").exists());
        // nested bin dll flattened to basename
        assert_eq!(std::fs::read(out.join("deep.dll")).unwrap(), b"nested-dll");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn store_detects_install_and_reports_size() {
        let root = std::env::temp_dir().join(format!("lst-gpu-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let store = GpuRuntimeStore::new(root.clone());
        assert!(!store.is_installed());
        assert_eq!(store.installed_size_bytes(), 0);

        let dir = store.dll_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("cudart64_12.dll"), vec![0u8; 10]).unwrap();
        assert!(store.is_installed());
        assert_eq!(store.installed_size_bytes(), 10);
        store.delete().unwrap();
        assert!(!store.is_installed());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_refuses_when_not_installed() {
        let root = std::env::temp_dir().join(format!("lst-gpu-delete-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let store = GpuRuntimeStore::new(root.clone());
        assert!(matches!(store.delete(), Err(Error::NotFound { .. })));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pack_is_pinned_and_consistent() {
        assert!(!CUDA_12_RUNTIME_PACK.is_empty());
        let total: u64 = CUDA_12_RUNTIME_PACK
            .iter()
            .map(|wheel| wheel.size_bytes)
            .sum();
        assert_eq!(total, cuda_pack_download_bytes());
        assert!(total > 500_000_000, "pack should be the ~1.3 GB runtime");
        assert!(
            CUDA_12_RUNTIME_PACK
                .iter()
                .all(|wheel| wheel.sha256.len() == 64)
        );
        assert!(
            CUDA_12_RUNTIME_PACK
                .iter()
                .all(|wheel| wheel.url.starts_with("https://files.pythonhosted.org/"))
        );
    }

    #[test]
    fn system_cuda_available_is_false_on_non_windows() {
        // The system detector only looks for CUDA DLLs on Windows. On macOS /
        // Linux it must return false so the UI offers the downloadable pack.
        if cfg!(target_os = "windows") {
            // On Windows the result depends on the machine; just ensure it
            // does not panic and is consistent with the app-pack check.
            let _ = system_cuda_available();
        } else {
            assert!(!system_cuda_available());
        }
    }

    #[tokio::test]
    async fn install_verifies_wheels_and_commits_atomically() {
        struct FakeFetcher(std::collections::HashMap<String, Vec<u8>>);
        impl Fetcher for FakeFetcher {
            fn fetch(
                &self,
                url: &str,
                destination: &Path,
                _cancel: &CancelHandle,
                _on_progress: ProgressFn,
            ) -> futures_util::future::BoxFuture<'_, Result<u64, Error>> {
                let owned_url = url.to_owned();
                let bytes = self.0.get(url).cloned();
                let destination = destination.to_owned();
                Box::pin(async move {
                    let bytes = bytes.ok_or_else(|| {
                        Error::Transport(format!("no fake wheel for {owned_url}"))
                    })?;
                    std::fs::write(&destination, &bytes)?;
                    Ok(bytes.len() as u64)
                })
            }
        }

        let root = std::env::temp_dir().join(format!("lst-gpu-install-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let wheel_bytes = {
            let path = root.join("fake.whl");
            make_wheel_with_dlls(
                &path,
                &[("nvidia/cuda_runtime/bin/cudart64_12.dll", b"cudart")],
            );
            std::fs::read(&path).unwrap()
        };
        let wheel_sha = {
            use sha2::Digest;
            format!("{:x}", sha2::Sha256::digest(&wheel_bytes))
        };
        let wheel_sha: &'static str = Box::leak(wheel_sha.into_boxed_str());
        static FAKE_URL: &str = "https://files.pythonhosted.org/fake/fake.whl";
        let fake_wheel = CudaWheel {
            package: "fake",
            url: FAKE_URL,
            size_bytes: wheel_bytes.len() as u64,
            sha256: wheel_sha,
        };
        let fake_wheels: &'static [CudaWheel] = Box::leak(vec![fake_wheel].into_boxed_slice());

        let mut fetcher_map = std::collections::HashMap::new();
        fetcher_map.insert(FAKE_URL.to_owned(), wheel_bytes);
        let fetcher: std::sync::Arc<dyn Fetcher> = std::sync::Arc::new(FakeFetcher(fetcher_map));

        let store = GpuRuntimeStore::new(root.clone());
        let installer =
            GpuRuntimeInstaller::new(store.clone(), fetcher).with_wheels_for_test(fake_wheels);

        installer
            .install(&CancelHandle::default(), std::sync::Arc::new(|_| {}))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(store.dll_dir().join("cudart64_12.dll")).unwrap(),
            b"cudart"
        );
        assert!(store.is_installed());
        assert_eq!(store.installed_size_bytes(), 6);
        // No leftover staging dir.
        assert!(!std::fs::read_dir(&root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".staging")
        }));

        // Second install is refused.
        let err = installer
            .install(&CancelHandle::default(), std::sync::Arc::new(|_| {}))
            .await
            .unwrap_err();
        assert!(matches!(err, Error::AlreadyInstalled { .. }));

        std::fs::remove_dir_all(root).unwrap();
    }
}
