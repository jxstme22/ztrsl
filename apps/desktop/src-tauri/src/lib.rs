#![deny(unsafe_op_in_unsafe_fn)]

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use audio_core::StreamingLinearResampler;
#[cfg(target_os = "macos")]
use audio_core::StreamingLinearResampler;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use audio_core::synthetic_monitor_endpoint;
use audio_core::{
    AtomicLevelMeter, AudioEndpoint, AudioError, AudioFormat, AudioMonitor, AudioRouter,
    AudioSource, EndpointKind, EndpointState, LevelSnapshot, RoutingMetrics, SYNTHETIC_ENDPOINT_ID,
    SYNTHETIC_MONITOR_ENDPOINT_ID, SyntheticAudioMonitor, SyntheticAudioSource, validate_route,
};
use ipc_protocol::{
    CaptionLabelStyle, CaptionPayload, CaptionStrictness, ClipResultPayload, Envelope,
    SourceRegistryEntry,
};
use serde::{Deserialize, Serialize};
use sidecar_supervisor::{
    SidecarConfig, SidecarProcess, SidecarSupervisor, SupervisorError, workspace_root_from_manifest,
};
use tauri::{Emitter, Manager};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    phase: u8,
    capture_active: bool,
    inference_active: bool,
    /// v0.3 feature flag: multi-source audio, IPC v2, per-source language
    /// strictness. When disabled the app behaves exactly like v0.2.
    multi_source: bool,
    /// v0.4 feature flag: caption accuracy / overlap awareness / trust
    /// (certainty states, phrase filters, glossary, Accuracy Lab). When
    /// disabled the app behaves exactly like v0.3.
    caption_trust: bool,
}

/// `LST_MULTI_SOURCE=0` disables the multi-source feature; anything else
/// (including unset) enables it in v0.3 development builds.
fn multi_source_enabled() -> bool {
    std::env::var("LST_MULTI_SOURCE").as_deref() != Ok("0")
}

/// `LST_CAPTION_TRUST=0` disables the v0.4 caption-accuracy feature set;
/// anything else (including unset) enables it in v0.4 development builds.
fn caption_trust_enabled() -> bool {
    std::env::var("LST_CAPTION_TRUST").as_deref() != Ok("0")
}

#[cfg(test)]
mod feature_flag_tests {
    use std::sync::{Mutex, MutexGuard};

    use super::*;

    /// Tests mutate the process env var; serialize them against each other.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn lock_env() -> MutexGuard<'static, ()> {
        ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn multi_source_enabled_by_default() {
        let _guard = lock_env();
        // SAFETY: test-only env mutation; serialized by ENV_LOCK.
        unsafe { std::env::remove_var("LST_MULTI_SOURCE") };
        assert!(multi_source_enabled());
    }

    #[test]
    fn multi_source_disabled_by_zero() {
        let _guard = lock_env();
        // SAFETY: see above.
        unsafe { std::env::set_var("LST_MULTI_SOURCE", "0") };
        assert!(!multi_source_enabled());
    }

    #[test]
    fn multi_source_enabled_by_other_values() {
        let _guard = lock_env();
        // SAFETY: see above.
        unsafe { std::env::set_var("LST_MULTI_SOURCE", "1") };
        assert!(multi_source_enabled());
        unsafe { std::env::set_var("LST_MULTI_SOURCE", "on") };
        assert!(multi_source_enabled());
    }

    #[test]
    fn caption_trust_enabled_by_default() {
        let _guard = lock_env();
        // SAFETY: test-only env mutation; serialized by ENV_LOCK.
        unsafe { std::env::remove_var("LST_CAPTION_TRUST") };
        assert!(caption_trust_enabled());
    }

    #[test]
    fn caption_trust_disabled_by_zero() {
        let _guard = lock_env();
        // SAFETY: see above.
        unsafe { std::env::set_var("LST_CAPTION_TRUST", "0") };
        assert!(!caption_trust_enabled());
    }
}

#[derive(Debug, Default)]
struct AudioRuntimeState {
    selected_endpoint_id: Option<String>,
    sequence: u64,
    synthetic: SyntheticAudioSource,
    synthetic_meter: AtomicLevelMeter,
}

#[derive(Default)]
struct TranslationApiRuntime {
    env: Arc<Mutex<Vec<(String, String)>>>,
}

/// Model catalog + install state shared by the model management commands.
struct ModelRuntime {
    state: Arc<Mutex<ModelRuntimeState>>,
}

struct ModelRuntimeState {
    store: model_manager::ModelStore,
    catalog: model_manager::ModelCatalog,
    installs: HashMap<String, model_manager::CancelHandle>,
    /// Model ids loaded by the running live session; deletion is refused.
    in_use: HashSet<String>,
    /// User-selected Hugging Face endpoint override (mirror support). `None`
    /// means resolve from `LST_HF_ENDPOINT`/`HF_ENDPOINT`/default.
    hf_endpoint: Option<String>,
    /// Optional CUDA runtime pack (opt-in GPU acceleration, ADR-019).
    gpu_runtime: model_manager::GpuRuntimeStore,
    /// In-flight CUDA runtime install (downloads ~1.3 GB; cancel supported).
    gpu_runtime_install: Option<model_manager::CancelHandle>,
}

impl ModelRuntimeState {
    /// Endpoint used for model downloads: explicit user choice first, then
    /// environment, then the upstream default.
    fn effective_hf_endpoint(&self) -> String {
        self.hf_endpoint
            .clone()
            .unwrap_or_else(model_manager::huggingface_endpoint)
    }
}

impl ModelRuntime {
    fn new(models_dir: std::path::PathBuf) -> Self {
        Self {
            state: Arc::new(Mutex::new(ModelRuntimeState {
                store: model_manager::ModelStore::new(models_dir.clone()),
                catalog: model_manager::ModelCatalog::embedded(),
                installs: HashMap::new(),
                in_use: HashSet::new(),
                hf_endpoint: None,
                gpu_runtime: model_manager::GpuRuntimeStore::new(models_dir),
                gpu_runtime_install: None,
            })),
        }
    }
}

/// Bundle identifier mirrored from tauri.conf.json. Needed to resolve the App
/// Sandbox container directory on macOS (`~/Library/Containers/<id>/Data`).
const APP_IDENTIFIER: &str = "app.localsquadtranslator.desktop";

/// macOS App Sandbox container root (`~/Library/Containers/<id>/Data`), the
/// ONLY directory outside the bundle the sandbox lets us write. `None` when
/// not sandboxed (dev/workspace runs, non-macOS). All user-visible writes —
/// the model store, sidecar logs, inference caches — must land under this
/// container; writing to the real home directory fails with EPERM
/// ("Operation not permitted") under the sandbox.
fn sandbox_container_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if !is_macos_sandboxed() {
            return None;
        }
        let home = std::env::var_os("HOME")?;
        let data = PathBuf::from(home)
            .join("Library")
            .join("Containers")
            .join(APP_IDENTIFIER)
            .join("Data");
        // The container is materialized by the sandbox on first launch; make
        // sure it exists so the model store and sidecar can write into it.
        let _ = std::fs::create_dir_all(&data);
        Some(data)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// True when this process runs under the macOS App Sandbox. `sandbox_check`
/// is deprecated but still functional and requires no extra linkage beyond
/// libSystem.
#[cfg(target_os = "macos")]
fn is_macos_sandboxed() -> bool {
    unsafe extern "C" {
        fn sandbox_check(pid: i32, operation: *const std::ffi::c_char, style: i32, ...) -> i32;
    }
    let operation = std::ffi::CString::new("sandbox").expect("static operation string");
    // SANDBOX_FILTER_NONE = 0; returns 1 when the operation is permitted
    // (i.e. the process IS sandboxed and the "sandbox" operation applies).
    unsafe { sandbox_check(0, operation.as_ptr(), 0) == 1 }
}

/// Dev builds resolve the model store next to the workspace so existing
/// checked-out artifacts keep working; packaged builds use the per-user app
/// data directory (never `Program Files`, which is read-only for standard
/// users). On macOS the packaged build runs under App Sandbox, so the store
/// is redirected into the sandbox container; `app_data_dir()` resolves to the
/// real `~/Library/Application Support`, which the sandbox denies with EPERM.
fn resolve_models_dir(app: &tauri::AppHandle) -> PathBuf {
    let workspace = workspace_root_from_manifest();
    if workspace
        .join("services")
        .join("inference")
        .join("src")
        .is_dir()
    {
        workspace.join("models")
    } else if let Some(container) = sandbox_container_dir() {
        container
            .join("Library")
            .join("Application Support")
            .join(APP_IDENTIFIER)
            .join("models")
    } else {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("yTRSL"))
            .join("models")
    }
}

/// Resolved paths for the packaged (PyInstaller) sidecar build. `None` means
/// the app is running from the source workspace and uses the `.venv`
/// interpreter instead.
#[derive(Debug, Clone)]
struct BundledPaths {
    sidecar_exe: PathBuf,
    translation_runner: PathBuf,
    model_root: PathBuf,
}

/// Managed state resolving the sidecar config once at startup.
#[derive(Default)]
struct SidecarPaths {
    bundled: Option<BundledPaths>,
}

/// Build a sidecar config for the current runtime mode: the frozen exe when a
/// bundled build is present, otherwise the workspace `.venv` interpreter.
fn sidecar_config(bundled: Option<&BundledPaths>, extra_env: &[(String, String)]) -> SidecarConfig {
    let model_root = bundled
        .map(|paths| paths.model_root.clone())
        .unwrap_or_else(|| workspace_root_from_manifest().join("models"));
    let mut config = match bundled {
        Some(paths) => SidecarConfig::for_bundled(
            paths.sidecar_exe.clone(),
            paths.translation_runner.clone(),
            paths.model_root.clone(),
        ),
        None => SidecarConfig::for_workspace(&workspace_root_from_manifest()),
    };
    // Always forward the optional CUDA runtime pack directory so EVERY sidecar
    // (live worker, clip analysis, accuracy lab) can call os.add_dll_directory
    // before importing ctranslate2 — not just the live worker.
    let mut env = extra_env.to_vec();
    // Under the macOS App Sandbox the sidecar's HOME must point into the
    // sandbox container: it derives its log directory from `Path.home()`
    // (services/inference sidecar.py `_configure_file_logging`), and Python
    // inference runtimes cache into `$HOME/.cache`. Writes to the real home
    // are denied by the sandbox with EPERM. Cache env vars are forwarded so
    // torch/transformers/matplotlib never touch the real home either.
    if let Some(container) = sandbox_container_dir() {
        let home = container.display().to_string();
        env.push(("HOME".to_owned(), home.clone()));
        env.push(("LOCALAPPDATA".to_owned(), home.clone()));
        for (key, sub) in [
            ("HF_HOME", "hf-cache"),
            ("XDG_CACHE_HOME", "cache"),
            ("TORCH_HOME", "cache/torch"),
            ("MPLCONFIGDIR", "cache/mpl"),
            ("PYTHONPYCACHEPREFIX", "tmp/pycache"),
        ] {
            env.push((key.to_owned(), container.join(sub).display().to_string()));
        }
    }
    env.push((
        "LST_CUDA_LIBS_DIR".to_owned(),
        model_root
            .join(model_manager::CUDA_DLL_DIR)
            .display()
            .to_string(),
    ));
    config.extra_env = env;
    config
}

/// Detect a packaged installation (the frozen sidecar exe sits under the
/// Tauri resource directory). Returns `None` in dev/workspace mode.
fn resolve_bundled_paths(app: &tauri::AppHandle) -> Option<BundledPaths> {
    let resource_dir = app.path().resource_dir().ok()?;
    let sidecars = resource_dir.join("sidecars");
    let sidecar_exe = sidecars
        .join("local-squad-sidecar")
        .join("local-squad-sidecar.exe");
    if !sidecar_exe.is_file() {
        return None;
    }
    Some(BundledPaths {
        sidecar_exe,
        translation_runner: sidecars.join("translation-runner.exe"),
        model_root: resolve_models_dir(app),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelsList {
    models: Vec<ModelInfo>,
    in_use: Vec<String>,
    /// v0.4: known-but-not-cataloged models (e.g. NCSpeech CTC exports that
    /// are generated locally via scripts/export_ncspeech_onnx.py rather than
    /// downloaded). `available` means "exported on disk", not "downloadable".
    known: Vec<ModelInfo>,
    /// v0.6.1: installed models that are neither in the catalog nor known —
    /// imported by URL (zip/onnx/manifest pack) under a custom id.
    custom: Vec<ModelInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    #[serde(flatten)]
    view: model_manager::CatalogEntryView,
    /// "installed" | "installing" | "available".
    status: String,
    installed_size_bytes: u64,
    /// Absolute path of the model directory on disk; empty when not installed.
    model_dir: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProgressPayload {
    model_id: String,
    done: bool,
    canceled: bool,
    error: Option<String>,
    phase: String,
    file_index: usize,
    file_count: usize,
    file_bytes_done: u64,
    file_bytes_total: u64,
    total_bytes_done: u64,
    total_bytes_total: u64,
}

fn provider_model_ids(asr_provider: &str, translation_provider: &str) -> Vec<&'static str> {
    let mut ids = Vec::new();
    match asr_provider {
        "whisper-turbo" => ids.push("whisper-large-v3-turbo"),
        "whisper-full" => ids.push("whisper-large-v3"),
        // "local" resolves to whichever Whisper artifact is installed.
        "local" => {
            ids.push("whisper-large-v3-turbo");
            ids.push("whisper-large-v3");
        }
        "mlx" | "mlx-whisper" => ids.push("mlx-whisper-large-v3-turbo-q4"),
        "ncspeech" => ids.push("ncspeech-tl-fastconformer-hybrid-large"),
        "ncspeech-zh" => ids.push("ncspeech-zh-citrinet-1024-gamma"),
        "ncspeech-zh-parakeet" => ids.push("ncspeech-zh-parakeet-ctc-0.6b"),
        "paraformer-zh-streaming" => ids.push("paraformer-zh-streaming"),
        "sensevoice-small" | "sense-voice" => ids.push("sensevoice-small"),
        // Cloud ASR (Groq / NVIDIA NIM): no local model to check.
        "groq-whisper" | "nvidia-whisper-large-v3" | "nvidia-nemotron-asr-streaming"
        | "nvidia-parakeet-1.1b" | "nvidia-canary-1b" => {}
        _ => {}
    }
    match translation_provider {
        "nllb" => ids.push("nllb-200-distilled-600M-ct2-int8"),
        "madlad" => ids.push("madlad400-3b-mt"),
        "opus-mt-en-zh" => ids.push("opus-mt-en-zh-ct2-int8"),
        "opus-mt-zh-en" => ids.push("opus-mt-zh-en-ct2-int8"),
        // Cloud translation (NVIDIA Riva / Baidu): no local model to check.
        "nvidia-riva-4b" | "nvidia-riva-1.6b" | "baidu-translate" => {}
        _ => {}
    }
    ids
}

/// v0.4 known-but-not-cataloged models: locally exported CTC ASR models
/// (NCSpeech family) generated via `scripts/export_ncspeech_onnx.py`. They
/// are NOT downloadable through the catalog — the UI must show them without
/// a download action.
const KNOWN_MODELS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "ncspeech-tl-fastconformer-hybrid-large",
        "NCSpeech Tagalog (CTC)",
        "asr",
        "sherpa-onnx",
        "Fixed-language Tagalog speech recognition (local NeMo export, CC-BY-4.0)",
    ),
    (
        "ncspeech-zh-citrinet-1024-gamma",
        "Citrinet Mandarin (CTC)",
        "asr",
        "sherpa-onnx",
        "Fixed-language Mandarin speech recognition (local NeMo export, CC-BY-4.0)",
    ),
    (
        "ncspeech-zh-parakeet-ctc-0.6b",
        "Parakeet Mandarin (CTC)",
        "asr",
        "sherpa-onnx",
        "Fixed-language Mandarin speech recognition (local NeMo export, CC-BY-4.0)",
    ),
];

/// True when a model directory exists for `id` in either layout (catalog
/// `model_root/<id>` or the local-export `model_root/artifacts/<id>`).
#[cfg(test)]
fn model_dir_exists(root: &std::path::Path, id: &str) -> bool {
    root.join(id).join("manifest.json").is_file()
        || root
            .join("artifacts")
            .join(id)
            .join("manifest.json")
            .is_file()
}

/// Resolve the on-disk directory for a model in either layout, preferring
/// the catalog layout; empty when nothing is installed.
fn model_dir(root: &std::path::Path, id: &str) -> std::path::PathBuf {
    let catalog_dir = root.join(id);
    if catalog_dir.join("manifest.json").is_file() {
        return catalog_dir;
    }
    let export_dir = root.join("artifacts").join(id);
    if export_dir.join("manifest.json").is_file() {
        return export_dir;
    }
    std::path::PathBuf::new()
}

/// Total verified size of an installed model in either layout (catalog
/// `root/<id>` or the local-export `root/artifacts/<id>`); 0 when nothing
/// is installed. Lets catalog entries that predate the download pipeline
/// (e.g. opus-mt exported with `scripts/export_opus_mt_ct2.py`) still show
/// as installed instead of dangling as downloadable.
fn installed_model_size(root: &std::path::Path, id: &str) -> u64 {
    let dir = model_dir(root, id);
    if !dir.is_dir() {
        return 0;
    }
    let Ok(raw) = std::fs::read(dir.join("manifest.json")) else {
        return 0;
    };
    let Ok(manifest) = serde_json::from_slice::<model_manager::InstalledManifest>(&raw) else {
        return 0;
    };
    manifest
        .artifacts
        .iter()
        .try_fold(0u64, |acc, artifact| {
            let path = dir.join(&artifact.path);
            if path.is_file()
                && path.metadata().map(|meta| meta.len()).unwrap_or(0) == artifact.size_bytes
            {
                Ok(acc + artifact.size_bytes)
            } else {
                Err(())
            }
        })
        .unwrap_or(0)
}

#[tauri::command]
async fn models_list(models: tauri::State<'_, ModelRuntime>) -> Result<ModelsList, String> {
    let state = models.state.lock().map_err(lock_error)?;
    let installed = state.store.installed().map_err(|error| error.to_string())?;
    let installed_sizes: HashMap<&str, u64> = installed
        .iter()
        .map(|model| (model.id.as_str(), model.total_size_bytes))
        .collect();
    let mut models_info = Vec::new();
    for view in state.catalog.view() {
        let installed_size = match installed_sizes.get(view.id.as_str()).copied() {
            Some(size) => size,
            None => installed_model_size(state.store.root(), &view.id),
        };
        let installed_dir = installed
            .iter()
            .find(|model| model.id == view.id)
            .map(|model| model.dir.display().to_string())
            .unwrap_or_default();
        let status = if state.installs.contains_key(&view.id) {
            "installing".to_owned()
        } else if installed_size > 0 {
            "installed".to_owned()
        } else {
            "available".to_owned()
        };
        models_info.push(ModelInfo {
            view,
            status,
            installed_size_bytes: installed_size,
            model_dir: installed_dir,
        });
    }
    // v0.4 known models (NCSpeech local exports): surfaced from disk so the
    // user can see them, but never offered as a download.
    let known = KNOWN_MODELS
        .iter()
        .map(|(id, name, kind, runtime, description)| {
            let dir = model_dir(state.store.root(), id);
            let installed = dir.is_dir();
            let size = installed_sizes.get(*id).copied().unwrap_or(0);
            ModelInfo {
                view: model_manager::CatalogEntryView {
                    id: (*id).to_owned(),
                    name: (*name).to_owned(),
                    kind: (*kind).to_owned(),
                    runtime: (*runtime).to_owned(),
                    recommended: false,
                    description: (*description).to_owned(),
                    license_spdx: "CC-BY-4.0".to_owned(),
                    license_notice: "local export; see NOTICE".to_owned(),
                    download_size_bytes: size,
                    source: "local-export".to_owned(),
                    revision: "export".to_owned(),
                    file_count: 0,
                    capabilities: model_manager::CapabilitiesView {
                        language_capability: "forced".to_owned(),
                        recommended_profiles: Vec::new(),
                        vram_class: "low".to_owned(),
                    },
                },
                status: if installed { "installed" } else { "available" }.to_owned(),
                installed_size_bytes: size,
                model_dir: dir.display().to_string(),
            }
        })
        .collect();
    // v0.6.1 custom URL imports: installed manifests that are neither in the
    // catalog nor KNOWN_MODELS. Surfaced by their manifest metadata so the
    // user can see and delete them even though no provider selection exists
    // yet for an arbitrary id.
    let catalog_ids: HashSet<String> = state
        .catalog
        .view()
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    let known_ids: HashSet<&str> = KNOWN_MODELS.iter().map(|(id, ..)| *id).collect();
    let custom = installed
        .iter()
        .filter(|model| {
            !catalog_ids.contains(&model.id)
                && !known_ids.contains(model.id.as_str())
                && model_dir(state.store.root(), &model.id).is_dir()
        })
        .map(|model| {
            let dir = model_dir(state.store.root(), &model.id);
            let size = model.total_size_bytes;
            ModelInfo {
                view: model_manager::CatalogEntryView {
                    id: model.id.clone(),
                    name: model.id.clone(),
                    kind: model.kind.clone(),
                    runtime: "custom".to_owned(),
                    recommended: false,
                    description: "installed from URL".to_owned(),
                    license_spdx: "unknown".to_owned(),
                    license_notice: String::new(),
                    download_size_bytes: size,
                    source: model.source.clone(),
                    revision: model.revision.clone(),
                    file_count: 0,
                    capabilities: custom_import_capabilities(),
                },
                status: "installed".to_owned(),
                installed_size_bytes: size,
                model_dir: dir.display().to_string(),
            }
        })
        .collect();
    Ok(ModelsList {
        models: models_info,
        in_use: state.in_use.iter().cloned().collect(),
        known,
        custom,
    })
}

/// Capabilities for a URL-imported (custom) model: the capability contract
/// is unknown, so report the conservative "post-filter" default — the
/// frontend schema accepts (forced/preferred/post-filter) — "unknown"
/// would break the whole models list at parse time.
fn custom_import_capabilities() -> model_manager::CapabilitiesView {
    model_manager::CapabilitiesView {
        language_capability: "post-filter".to_owned(),
        recommended_profiles: Vec::new(),
        vram_class: "low".to_owned(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEndpointInfo {
    /// Effective endpoint used for model downloads right now.
    endpoint: String,
    /// `true` when the endpoint is a mirror rather than the upstream host.
    mirror: bool,
    /// `true` when the user explicitly chose this endpoint in the app.
    user_override: bool,
}

#[tauri::command]
fn models_download_endpoint(
    models: tauri::State<'_, ModelRuntime>,
) -> Result<DownloadEndpointInfo, String> {
    let state = models.state.lock().map_err(lock_error)?;
    let endpoint = state.effective_hf_endpoint();
    let upstream = model_manager::DEFAULT_HF_ENDPOINT;
    Ok(DownloadEndpointInfo {
        mirror: endpoint != upstream,
        user_override: state.hf_endpoint.is_some(),
        endpoint,
    })
}

/// Provider + region status for honest UI (Phase 9, ADR-018). The desktop
/// learns which download hosts are candidates, in failover order, and whether
/// a custom mirror or a mainland-CN region changes that order.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStatus {
    region: String,
    /// Candidate hosts in failover order (first = tried first).
    providers: Vec<ProviderView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderView {
    name: String,
    host: String,
    custom: bool,
}

#[tauri::command]
fn models_providers(models: tauri::State<'_, ModelRuntime>) -> Result<ProviderStatus, String> {
    let state = models.state.lock().map_err(lock_error)?;
    let region = model_manager::region_from_env();
    let region_name = match region {
        model_manager::Region::Global => "global".to_owned(),
        model_manager::Region::MainlandChina => "mainland-cn".to_owned(),
    };
    let custom = state.hf_endpoint.as_deref();
    let providers = model_manager::provider_order(region, custom)
        .iter()
        .map(|provider| ProviderView {
            name: match provider {
                model_manager::Provider::HuggingFace => "huggingface".to_owned(),
                model_manager::Provider::HfMirror => "hf-mirror".to_owned(),
                model_manager::Provider::ModelScope => "modelscope".to_owned(),
                model_manager::Provider::Custom(_) => "custom".to_owned(),
            },
            host: provider.default_host().to_owned(),
            custom: matches!(provider, model_manager::Provider::Custom(_)),
        })
        .collect();
    Ok(ProviderStatus {
        region: region_name,
        providers,
    })
}

#[tauri::command]
fn models_import_offline_pack(
    models: tauri::State<'_, ModelRuntime>,
    pack_dir: String,
) -> Result<Vec<String>, String> {
    let state = models.state.lock().map_err(lock_error)?;
    let root = state.store.root().to_path_buf();
    let imported = model_manager::import_offline_pack(
        std::path::Path::new(&pack_dir),
        &model_manager::ModelStore::new(root),
        None,
    )
    .map_err(|error| error.to_string())?;
    Ok(imported)
}

#[tauri::command]
fn models_set_download_endpoint(
    models: tauri::State<'_, ModelRuntime>,
    endpoint: String,
) -> Result<DownloadEndpointInfo, String> {
    let trimmed = endpoint.trim().trim_end_matches('/').to_owned();
    if !trimmed.is_empty() {
        let host = trimmed
            .strip_prefix("https://")
            .and_then(|rest| rest.split('/').next())
            .unwrap_or_default();
        if host.is_empty() || host.contains(' ') || host.contains('@') {
            return Err(
                "download endpoint must be a plain https:// URL (no userinfo or path)".to_owned(),
            );
        }
    }
    let mut state = models.state.lock().map_err(lock_error)?;
    state.hf_endpoint = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.clone())
    };
    let endpoint = state.effective_hf_endpoint();
    Ok(DownloadEndpointInfo {
        mirror: endpoint != model_manager::DEFAULT_HF_ENDPOINT,
        user_override: !trimmed.is_empty(),
        endpoint,
    })
}

#[tauri::command]
async fn models_install(
    app: tauri::AppHandle,
    models: tauri::State<'_, ModelRuntime>,
    id: String,
) -> Result<(), String> {
    let (entry, cancel) = {
        let mut state = models.state.lock().map_err(lock_error)?;
        let entry = state
            .catalog
            .entry(&id)
            .cloned()
            .ok_or_else(|| format!("unknown model: {id}"))?;
        if state.installs.contains_key(&id) {
            return Err("this model is already being installed".to_owned());
        }
        let handle = model_manager::CancelHandle::default();
        state.installs.insert(id.clone(), handle.clone());
        (entry, handle)
    };
    let models_dir = {
        let state = models.state.lock().map_err(lock_error)?;
        state.store.root().to_owned()
    };
    let hf_endpoint = {
        let state = models.state.lock().map_err(lock_error)?;
        state.effective_hf_endpoint()
    };
    let state_arc = Arc::clone(&models.state);
    tauri::async_runtime::spawn(async move {
        let emit = |app: &tauri::AppHandle, payload: &ModelProgressPayload| {
            let _ = app.emit("models://progress", payload);
        };
        let fetcher = match model_manager::ReqwestFetcher::new() {
            Ok(fetcher) => {
                std::sync::Arc::new(fetcher) as std::sync::Arc<dyn model_manager::Fetcher>
            }
            Err(error) => {
                let _ = app.emit(
                    "models://progress",
                    &ModelProgressPayload {
                        model_id: id.clone(),
                        done: true,
                        canceled: false,
                        error: Some(error.to_string()),
                        phase: "download".to_owned(),
                        file_index: 0,
                        file_count: 0,
                        file_bytes_done: 0,
                        file_bytes_total: 0,
                        total_bytes_done: 0,
                        total_bytes_total: 0,
                    },
                );
                return;
            }
        };
        let installer =
            model_manager::ModelInstaller::new(model_manager::ModelStore::new(models_dir), fetcher)
                .with_hf_endpoint(hf_endpoint);
        let app_for_progress = app.clone();
        let id_for_progress = id.clone();
        let progress = std::sync::Arc::new(move |event: model_manager::InstallProgress| {
            emit(
                &app_for_progress,
                &ModelProgressPayload {
                    model_id: id_for_progress.clone(),
                    done: false,
                    canceled: false,
                    error: None,
                    phase: match event.phase {
                        model_manager::InstallPhase::Downloading => "download".to_owned(),
                        model_manager::InstallPhase::Extracting => "extract".to_owned(),
                        model_manager::InstallPhase::Installing => "install".to_owned(),
                    },
                    file_index: event.file_index,
                    file_count: event.file_count,
                    file_bytes_done: event.file_bytes_done,
                    file_bytes_total: event.file_bytes_total,
                    total_bytes_done: event.total_bytes_done,
                    total_bytes_total: event.total_bytes_total,
                },
            );
        });
        let result = installer.install(&entry, &cancel, progress).await;
        if let Ok(mut state) = state_arc.lock() {
            state.installs.remove(&id);
        }
        let payload = match result {
            Ok(()) => ModelProgressPayload {
                model_id: id.clone(),
                done: true,
                canceled: false,
                error: None,
                phase: "done".to_owned(),
                file_index: 0,
                file_count: 0,
                file_bytes_done: 0,
                file_bytes_total: 0,
                total_bytes_done: 0,
                total_bytes_total: 0,
            },
            Err(model_manager::Error::Canceled) => ModelProgressPayload {
                model_id: id.clone(),
                done: true,
                canceled: true,
                error: None,
                phase: "done".to_owned(),
                file_index: 0,
                file_count: 0,
                file_bytes_done: 0,
                file_bytes_total: 0,
                total_bytes_done: 0,
                total_bytes_total: 0,
            },
            Err(error) => ModelProgressPayload {
                model_id: id.clone(),
                done: true,
                canceled: false,
                error: Some(error.to_string()),
                phase: "done".to_owned(),
                file_index: 0,
                file_count: 0,
                file_bytes_done: 0,
                file_bytes_total: 0,
                total_bytes_done: 0,
                total_bytes_total: 0,
            },
        };
        emit(&app, &payload);
    });
    Ok(())
}

/// Install a model from an arbitrary http(s) URL. When the download is a zip
/// (or tar.bz2) containing an offline-pack `manifest.json`, the manifest
/// supplies the id/kind/runtime and every artifact is verified against it;
/// `id`, `kind` and `runtime` may then be left empty. Otherwise the caller
/// must supply them, and a manifest is synthesized from the downloaded files.
/// Known NCSpeech ids install into `artifacts/<id>` (sidecar layout);
/// anything else lands in `root/<id>`.
#[tauri::command]
async fn models_install_from_url(
    models: tauri::State<'_, ModelRuntime>,
    url: String,
    id: String,
    kind: String,
    runtime: String,
) -> Result<String, String> {
    let id = id.trim().to_owned();
    if !id.is_empty()
        && !id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err("model id may only contain lowercase letters, digits and dashes".to_owned());
    }
    if id.len() > 64 {
        return Err("model id is too long (max 64 characters)".to_owned());
    }
    if !kind.is_empty() && !matches!(kind.as_str(), "asr" | "translation") {
        return Err("kind must be asr or translation".to_owned());
    }
    if !runtime.is_empty()
        && !matches!(
            runtime.as_str(),
            "faster-whisper" | "ctranslate2" | "sherpa-onnx" | "candle" | "mlx"
        )
    {
        return Err(format!("unsupported runtime: {runtime}"));
    }
    let root = {
        let state = models.state.lock().map_err(lock_error)?;
        state.store.root().to_owned()
    };
    let fetcher = model_manager::ReqwestFetcher::new().map_err(|error| error.to_string())?;
    let installer = model_manager::ModelInstaller::new(
        model_manager::ModelStore::new(root),
        std::sync::Arc::new(fetcher),
    );
    installer
        .install_from_url(url.trim(), &id, &kind, &runtime)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn models_cancel_install(
    models: tauri::State<'_, ModelRuntime>,
    id: String,
) -> Result<(), String> {
    let state = models.state.lock().map_err(lock_error)?;
    let handle = state
        .installs
        .get(&id)
        .ok_or_else(|| format!("no install in progress for {id}"))?;
    handle.cancel();
    Ok(())
}

#[tauri::command]
async fn models_delete(models: tauri::State<'_, ModelRuntime>, id: String) -> Result<(), String> {
    let state = models.state.lock().map_err(lock_error)?;
    if state.installs.contains_key(&id) {
        return Err("cannot delete a model while it is being installed".to_owned());
    }
    state
        .store
        .delete(&id, &state.in_use)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GpuRuntimeStatus {
    installed: bool,
    installing: bool,
    installed_size_bytes: u64,
    /// Total bytes that must be downloaded for the pack.
    download_size_bytes: u64,
    /// `true` when a CUDA runtime is already usable on this system (the app's
    /// own pack, or a system CUDA Toolkit) — no download needed.
    system_available: bool,
    /// `true` when anything exists on disk under the pack dir (complete,
    /// partial, or leftover) — a "remove" action should be offered.
    has_artifacts: bool,
    /// Absolute path of the pack directory on disk; empty when nothing exists.
    path: String,
    /// Package names + per-wheel sizes shown in the UI.
    wheels: Vec<GpuRuntimeWheelStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GpuRuntimeWheelStatus {
    package: String,
    size_bytes: u64,
}

#[tauri::command]
fn gpu_runtime_status(models: tauri::State<'_, ModelRuntime>) -> Result<GpuRuntimeStatus, String> {
    let state = models.state.lock().map_err(lock_error)?;
    let installed = state.gpu_runtime.is_installed();
    let has_artifacts = state.gpu_runtime.has_artifacts();
    Ok(GpuRuntimeStatus {
        installed,
        installing: state.gpu_runtime_install.is_some(),
        installed_size_bytes: state.gpu_runtime.installed_size_bytes(),
        download_size_bytes: model_manager::cuda_pack_download_bytes(),
        system_available: installed || model_manager::system_cuda_available(),
        has_artifacts,
        path: if has_artifacts {
            state.gpu_runtime.dll_dir().display().to_string()
        } else {
            String::new()
        },
        wheels: model_manager::CUDA_12_RUNTIME_PACK
            .iter()
            .map(|wheel| GpuRuntimeWheelStatus {
                package: wheel.package.to_owned(),
                size_bytes: wheel.size_bytes,
            })
            .collect(),
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GpuRuntimeProgressPayload {
    done: bool,
    canceled: bool,
    error: Option<String>,
    phase: String,
    file_index: usize,
    file_count: usize,
    file_bytes_done: u64,
    file_bytes_total: u64,
    total_bytes_done: u64,
    total_bytes_total: u64,
}

#[tauri::command]
async fn gpu_runtime_install(
    app: tauri::AppHandle,
    models: tauri::State<'_, ModelRuntime>,
) -> Result<(), String> {
    let (store, cancel) = {
        let mut state = models.state.lock().map_err(lock_error)?;
        if state.gpu_runtime.is_installed() {
            return Err("the CUDA runtime pack is already installed".to_owned());
        }
        if state.gpu_runtime_install.is_some() {
            return Err("the CUDA runtime pack is already being installed".to_owned());
        }
        let handle = model_manager::CancelHandle::default();
        state.gpu_runtime_install = Some(handle.clone());
        (state.gpu_runtime.clone(), handle)
    };
    let state_arc = Arc::clone(&models.state);
    tauri::async_runtime::spawn(async move {
        let emit = |app: &tauri::AppHandle, payload: &GpuRuntimeProgressPayload| {
            let _ = app.emit("gpu://progress", payload);
        };
        let fetcher = match model_manager::ReqwestFetcher::new() {
            Ok(fetcher) => Arc::new(fetcher) as Arc<dyn model_manager::Fetcher>,
            Err(error) => {
                emit(
                    &app,
                    &GpuRuntimeProgressPayload {
                        done: true,
                        canceled: false,
                        error: Some(error.to_string()),
                        phase: "download".to_owned(),
                        file_index: 0,
                        file_count: 0,
                        file_bytes_done: 0,
                        file_bytes_total: 0,
                        total_bytes_done: 0,
                        total_bytes_total: 0,
                    },
                );
                return;
            }
        };
        let installer = model_manager::GpuRuntimeInstaller::new(store.clone(), fetcher);
        let app_for_progress = app.clone();
        let progress = std::sync::Arc::new(move |event: model_manager::DownloadProgress| {
            emit(
                &app_for_progress,
                &GpuRuntimeProgressPayload {
                    done: false,
                    canceled: false,
                    error: None,
                    phase: "download".to_owned(),
                    file_index: event.file_index,
                    file_count: event.file_count,
                    file_bytes_done: event.file_bytes_done,
                    file_bytes_total: event.file_bytes_total,
                    total_bytes_done: event.total_bytes_done,
                    total_bytes_total: event.total_bytes_total,
                },
            );
        });
        let result = installer.install(&cancel, progress).await;
        if let Ok(mut state) = state_arc.lock() {
            state.gpu_runtime_install = None;
        }
        let payload = match result {
            Ok(()) => GpuRuntimeProgressPayload {
                done: true,
                canceled: false,
                error: None,
                phase: "done".to_owned(),
                file_index: 0,
                file_count: 0,
                file_bytes_done: 0,
                file_bytes_total: 0,
                total_bytes_done: 0,
                total_bytes_total: 0,
            },
            Err(model_manager::Error::Canceled) => GpuRuntimeProgressPayload {
                done: true,
                canceled: true,
                error: None,
                phase: "done".to_owned(),
                file_index: 0,
                file_count: 0,
                file_bytes_done: 0,
                file_bytes_total: 0,
                total_bytes_done: 0,
                total_bytes_total: 0,
            },
            Err(error) => GpuRuntimeProgressPayload {
                done: true,
                canceled: false,
                error: Some(error.to_string()),
                phase: "done".to_owned(),
                file_index: 0,
                file_count: 0,
                file_bytes_done: 0,
                file_bytes_total: 0,
                total_bytes_done: 0,
                total_bytes_total: 0,
            },
        };
        emit(&app, &payload);
    });
    Ok(())
}

#[tauri::command]
fn gpu_runtime_cancel(models: tauri::State<'_, ModelRuntime>) -> Result<(), String> {
    let state = models.state.lock().map_err(lock_error)?;
    if let Some(handle) = &state.gpu_runtime_install {
        handle.cancel();
    }
    Ok(())
}

#[tauri::command]
fn gpu_runtime_delete(models: tauri::State<'_, ModelRuntime>) -> Result<(), String> {
    let state = models.state.lock().map_err(lock_error)?;
    if state.gpu_runtime_install.is_some() {
        return Err("cannot delete the CUDA runtime while it is being installed".to_owned());
    }
    state
        .gpu_runtime
        .delete()
        .map_err(|error| error.to_string())
}

/// Open a folder in the system file manager ("Show in Explorer/Finder").
/// Only paths under the resolved model root are accepted — the webview never
/// gets to reveal arbitrary locations.
#[tauri::command]
fn reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = resolve_models_dir(&app);
    let requested = std::path::PathBuf::from(&path);
    let canonical_root = root.canonicalize().unwrap_or(root);
    let canonical = requested
        .canonicalize()
        .map_err(|_| "path not found".to_owned())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("refusing to reveal a path outside the model directory".to_owned());
    }
    if !canonical.is_dir() {
        return Err("not a directory".to_owned());
    }
    reveal_in_file_manager(&canonical)
}

/// Windowed overlay mode: the control window morphs into a compact,
/// always-on-top caption strip (and back). Exiting restores the normal app
/// window. The webview renders only the caption stack while active.
const OVERLAY_MODE_SIZE: (f64, f64) = (900.0, 150.0);
const APP_MODE_SIZE: (f64, f64) = (995.0, 904.0);
const APP_MODE_MIN_SIZE: (f64, f64) = (994.0, 904.0);

/// Open the macOS Screen Recording privacy pane. ScreenCaptureKit's
/// system-audio capture is silent (no frames, no error) until the user
/// enables this permission for the app, so the UI offers this as a
/// one-click path to the right System Settings page.
#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!(
                "could not open Screen Recording settings: {status}"
            ));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = ();
    }
    Ok(())
}

/// Report the current microphone authorization state without prompting.
/// Lets the UI (and support diagnostics) distinguish a hidden TCC denial
/// ("denied"/"restricted") from a clean slate ("notDetermined") or a working
/// grant ("authorized").
#[tauri::command]
async fn microphone_auth_status() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};
        let media_type = unsafe { AVMediaTypeAudio.as_ref() }
            .ok_or_else(|| "AVMediaTypeAudio is unavailable".to_owned())?;
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
        Ok(auth_status_label(status))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported".to_owned())
    }
}

/// Open the macOS Microphone privacy pane. Denied mic access makes cpal
/// capture silent with no error, so the app surfaces this as a one-click
/// fix path.
#[tauri::command]
fn open_microphone_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!("could not open Microphone settings: {status}"));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = ();
    }
    Ok(())
}

/// macOS: request microphone access through AVFoundation — the same TCC gate
/// the cpal capture hits. Returns the resulting status: "authorized",
/// "denied", "restricted", "notDetermined", or "unsupported" off-macOS.
/// When the status is "notDetermined" this shows the system prompt; the
/// completion handler is called on an arbitrary queue, so a tokio oneshot
/// bridges it back to the command's future.
#[tauri::command]
async fn request_microphone_permission(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use block2::{Block, RcBlock};
        use objc2::runtime::Bool;
        use objc2_av_foundation::{AVCaptureDevice, AVAuthorizationStatus, AVMediaTypeAudio};
        // The media-type constant is an extern static backed by AVFoundation,
        // which the app links; dereferencing the static is unsafe.
        let media_type_ptr = {
            let media_type = unsafe { AVMediaTypeAudio.as_ref() }
                .ok_or_else(|| "AVMediaTypeAudio is unavailable".to_owned())?;
            let status =
                unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
            if status != AVAuthorizationStatus::NotDetermined {
                return Ok(auth_status_label(status));
            }
            *media_type as *const objc2_foundation::NSString as usize
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
        // Leak the block: AVFoundation copies it when the request runs, and
        // the main-thread closure needs it alive beyond this function's
        // frame. A few dozen bytes per permission request.
        let block: &'static RcBlock<dyn Fn(Bool)> =
            Box::leak(Box::new(RcBlock::new(move |granted: Bool| {
                // The block is `Fn` and may be invoked once; take the channel
                // sender so a second invocation (never expected) no-ops.
                if let Ok(mut slot) = sender.lock() {
                    if let Some(sender) = slot.take() {
                        let _ = sender.send(granted.as_bool());
                    }
                }
            })));
        let block_ptr = &**block as *const Block<dyn Fn(Bool)> as usize;
        // The TCC permission prompt only presents when the request
        // originates on the main thread — background-thread requests
        // silently no-op on modern macOS (status stays "notDetermined",
        // no prompt, completion never fires). Dispatch the request onto the
        // main thread and await the completion. objc2 objects are !Send, so
        // the closure carries raw pointers only.
        // Bring the control window to the front first: TCC suppresses
        // the prompt for background apps, so a request fired before the
        // window is focused silently no-ops (status stays
        // "notDetermined" forever).
        let app_for_focus = app.clone();
        app.run_on_main_thread(move || {
            if let Some(window) = app_for_focus.get_webview_window("control") {
                let _ = window.set_focus();
            }
            unsafe {
                let media_type = &*(media_type_ptr as *const objc2_foundation::NSString);
                let block = &*(block_ptr as *const Block<dyn Fn(Bool)>);
                AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, block);
            }
        })
        .map_err(|error| error.to_string())?;
        match tokio::time::timeout(Duration::from_secs(30), receiver).await {
            Ok(Ok(true)) => Ok("authorized".to_owned()),
            Ok(Ok(false)) => Ok("denied".to_owned()),
            Ok(Err(_)) => Err("microphone permission request failed".to_owned()),
            Err(_) => Err("timed out waiting for microphone permission".to_owned()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported".to_owned())
    }
}

/// Map an `AVAuthorizationStatus` to the wire label.
#[cfg(target_os = "macos")]
fn auth_status_label(status: objc2_av_foundation::AVAuthorizationStatus) -> String {
    use objc2_av_foundation::AVAuthorizationStatus;
    match status {
        AVAuthorizationStatus::Authorized => "authorized".to_owned(),
        AVAuthorizationStatus::Denied => "denied".to_owned(),
        AVAuthorizationStatus::Restricted => "restricted".to_owned(),
        _ => "notDetermined".to_owned(),
    }
}

/// Force the WKWebView to stop painting its opaque white layer.
///
/// wry disables the webview background at config time via the private
/// `drawsBackground` KVC key on the WKWebViewConfiguration — on current
/// WebKit builds that key is no longer honored, so the corners of a rounded
/// window stay white even though the window itself is transparent. This
/// applies the same key on the webview *instance* plus the public
/// `pageBackgroundColor` (macOS 12+) after the window exists.
#[cfg(target_os = "macos")]
fn clear_webview_background(window: &tauri::Window) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::sel;
    use objc2_app_kit::NSColor;
    use objc2_foundation::NSNumber;
    let Ok(raw) = window.ns_window() else {
        return;
    };
    unsafe {
        let Some(wk_class) = AnyClass::get(c"WKWebView") else {
            return;
        };
        let ns_window = raw as *mut AnyObject;
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let mut target: *mut AnyObject = std::ptr::null_mut();
        let is_webview: bool = msg_send![content_view, isKindOfClass: wk_class];
        if is_webview {
            target = content_view;
        } else {
            let subviews: *mut AnyObject = msg_send![content_view, subviews];
            let count: usize = msg_send![subviews, count];
            for index in 0..count {
                let view: *mut AnyObject = msg_send![subviews, objectAtIndex: index];
                let is_webview: bool = msg_send![view, isKindOfClass: wk_class];
                if is_webview {
                    target = view;
                    break;
                }
            }
        }
        if target.is_null() {
            return;
        }
        let no = NSNumber::numberWithBool(false);
        let key = objc2_foundation::NSString::from_str("drawsBackground");
        // KVC setValue:forKey: is NSObject API — always present.
        let _: () = msg_send![target, setValue: &*no, forKey: &*key];
        // pageBackgroundColor lives on WKWebView (macOS 12+); wry's wrapper
        // view may not forward it, so probe before messaging (an
        // unrecognized selector would crash the app).
        let responds: bool = msg_send![target, respondsToSelector: sel!(setPageBackgroundColor:)];
        if responds {
            let clear = NSColor::clearColor();
            let _: () = msg_send![target, setPageBackgroundColor: &*clear];
        }
    }
}

/// Remembers the normal-mode window geometry while the mini (windowed)
/// overlay is active, so leaving mini mode returns the app window to exactly
/// where it was instead of leaving a tiny strip at the bottom of the screen.
static APP_MODE_GEOMETRY: std::sync::Mutex<Option<(f64, f64, f64, f64)>> =
    std::sync::Mutex::new(None);

#[tauri::command]
fn set_overlay_mode(active: bool, window: tauri::Window) -> Result<(), String> {
    use tauri::LogicalSize;
    #[cfg(target_os = "macos")]
    {
        // The normal app window sits on an NSVisualEffectView (vibrancy)
        // layer. That material fills the whole square window, so while the
        // mini caption strip is active its CSS-rounded corners would show
        // the material instead of the desktop — remove it for true
        // transparency and restore it when leaving mini mode.
        if active {
            let _ = window_vibrancy::clear_vibrancy(&window);
        } else {
            let _ = window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::HudWindow,
                None,
                None,
            );
        }
        // The webview paints a white layer unless it is told to be
        // transparent at runtime: the config-level KVC flag is unreliable on
        // modern WebKit. wry's set_background_color applies the private
        // drawsBackground=false + underPageBackgroundColor on the webview
        // instance, which makes the mini window's corners truly see-through.
        let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
        clear_webview_background(&window);
        // Round the OS window itself (NSWindow.cornerRadius, macOS 15+):
        // 18px in mini mode (matching the CSS radius) and 10px for the
        // normal app frame. Falls back to a no-op on older macOS.
        unsafe {
            use objc2::msg_send;
            use objc2::runtime::AnyObject;
            use objc2::sel;
            if let Ok(raw) = window.ns_window() {
                let ns_window = raw as *mut AnyObject;
                let responds: bool =
                    msg_send![ns_window, respondsToSelector: sel!(setCornerRadius:)];
                if responds {
                    let radius: f64 = if active { 18.0 } else { 10.0 };
                    let _: () = msg_send![ns_window, setCornerRadius: radius];
                }
            }
        }
    }
    if active {
        // Remember where the normal app window is before shrinking into the
        // caption strip (overwrite every entry: after a restore the saved
        // geometry is the app geometry again).
        if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
            let mut saved = APP_MODE_GEOMETRY
                .lock()
                .map_err(|error| format!("geometry lock poisoned: {error}"))?;
            *saved = Some((
                position.x as f64,
                position.y as f64,
                size.width as f64,
                size.height as f64,
            ));
        }
        // The configured min size (994x904) would clamp the caption strip,
        // so drop it first and restore it when leaving overlay mode.
        window
            .set_min_size(Some(LogicalSize::new(300.0, 80.0)))
            .map_err(|error| error.to_string())?;
        window
            .set_size(LogicalSize::new(OVERLAY_MODE_SIZE.0, OVERLAY_MODE_SIZE.1))
            .map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
    } else {
        window
            .set_min_size(Some(LogicalSize::new(
                APP_MODE_MIN_SIZE.0,
                APP_MODE_MIN_SIZE.1,
            )))
            .map_err(|error| error.to_string())?;
        let saved = APP_MODE_GEOMETRY
            .lock()
            .map_err(|error| format!("geometry lock poisoned: {error}"))?;
        if let Some((x, y, width, height)) = *saved {
            window
                .set_size(tauri::PhysicalSize::new(width as u32, height as u32))
                .map_err(|error| error.to_string())?;
            window
                .set_position(tauri::PhysicalPosition::new(x as i32, y as i32))
                .map_err(|error| error.to_string())?;
        } else {
            window
                .set_size(LogicalSize::new(APP_MODE_SIZE.0, APP_MODE_SIZE.1))
                .map_err(|error| error.to_string())?;
        }
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Platform-specific "open this folder in the file manager" without blocking.
fn reveal_in_file_manager(dir: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer.exe")
            .arg(dir)
            .spawn()
            .map_err(|error| format!("failed to open Explorer: {error}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|error| format!("failed to open Finder: {error}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = dir;
        Err("opening folders is only supported on Windows and macOS".to_owned())
    }
}

#[derive(Default)]
struct AudioRuntime {
    state: Mutex<AudioRuntimeState>,
    #[cfg(target_os = "windows")]
    watcher: Mutex<Option<audio_core::WindowsDeviceWatcher>>,
    #[cfg(target_os = "macos")]
    watcher: Mutex<Option<audio_core::MacosDeviceWatcher>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EndpointCatalog {
    platform: &'static str,
    endpoints: Vec<AudioEndpoint>,
    device_change_detected: bool,
    /// True only when the Windows process-loopback capture exists. It is
    /// deliberately false until the `windows-hw` acceptance chunk lands, so
    /// the UI never advertises a capture method that cannot run.
    process_capture_supported: bool,
}

struct RoutingRuntimeState {
    capture_endpoint_id: Option<String>,
    playback_endpoint_id: Option<String>,
    source: SyntheticAudioSource,
    monitor: SyntheticAudioMonitor,
    router: Option<AudioRouter>,
}

impl Default for RoutingRuntimeState {
    fn default() -> Self {
        Self {
            capture_endpoint_id: None,
            playback_endpoint_id: None,
            source: SyntheticAudioSource::default(),
            monitor: SyntheticAudioMonitor::new(8)
                .expect("the fixed synthetic monitor capacity is non-zero"),
            router: None,
        }
    }
}

#[derive(Default)]
struct RoutingRuntime {
    state: Mutex<RoutingRuntimeState>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutingSnapshot {
    active: bool,
    monitor_peak: f32,
    inference_samples: usize,
    metrics: RoutingMetrics,
    backend: &'static str,
}

#[derive(Clone, Default)]
struct SidecarRuntime {
    supervisor: Arc<Mutex<Option<SidecarSupervisor>>>,
}

/// Pool of live sidecar processes, shared between the main live session and
/// the separated live session. A process is kept alive while any connection
/// holds it; the separated session attaches to the running process so loaded
/// models (whisper / NLLB) are reused instead of duplicated.
struct SidecarPool {
    inner: Arc<Mutex<Option<Weak<SidecarProcess>>>>,
}

impl Default for SidecarPool {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatus {
    state: &'static str,
    provider: &'static str,
    restartable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveStarted {
    provider: String,
    asr_model: String,
    asr_runtime: String,
    translation_runtime: String,
    source_mode: String,
    target_language: String,
    resource_profile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveStartRequest {
    endpoint_id: String,
    /// Optional when monitoring is disabled. Empty string is treated as None.
    playback_endpoint_id: Option<String>,
    source_mode: String,
    provider: String,
    /// Translation output language: "en" (English) or "zh" (simplified
    /// Chinese); applies to the local NLLB provider.
    #[serde(default = "default_target_language")]
    target_language: String,
    /// ASR backend: "local"/"whisper-turbo" (large-v3-turbo), "whisper-full"
    /// (large-v3), "ncspeech" (NVIDIA FastConformer Tagalog), "ncspeech-zh"
    /// (NVIDIA Citrinet-1024 Mandarin), "ncspeech-zh-parakeet" (NVIDIA
    /// Parakeet-CTC 0.6B Mandarin), or "groq-whisper".
    #[serde(default)]
    asr_provider: String,
    /// Translation backend: "nllb" (local, near-real-time), "madlad" (local),
    /// "libretranslate", "google-translate", "mymemory", "custom-http".
    #[serde(default)]
    translation_provider: String,
    resource_profile: String,
    /// When true, captured audio is sent to the playback endpoint for the user
    /// to hear. Defaults to false so captions are shown without audible echo.
    #[serde(default)]
    monitor_enabled: bool,
    /// 0..100 VAD sensitivity slider. 50 is the baseline; higher treats
    /// quieter speech as speech and closes utterances sooner.
    #[serde(default = "default_vad_sensitivity")]
    vad_sensitivity: u8,
    /// Caption segmentation style: "chunk" (short callouts), "balanced"
    /// (sensitivity-derived), "sentence" (complete sentences).
    #[serde(default = "default_segmentation")]
    segmentation: String,
    /// Multi-source mode: one capture per entry, each tagged with its
    /// `source_id` and captioned under its own tag. Empty means the classic
    /// single-channel session driven by `endpoint_id`.
    #[serde(default)]
    sources: Vec<LiveSourceRequest>,
    /// The user's own microphone stream: translated in a direction the user
    /// picks (default: reversed from the session pair) and captioned as
    /// "you". Captured on the same live session when the mic toggle is on.
    #[serde(default)]
    mic_source: Option<LiveSourceRequest>,
}

fn default_vad_sensitivity() -> u8 {
    50
}

fn default_segmentation() -> String {
    "balanced".to_string()
}

fn default_target_language() -> String {
    "en".to_string()
}

/// A per-source capture request (multi-source live sessions). `source_id`
/// must be 32 lowercase hex; every other field is presentation metadata the
/// sidecar stamps onto that source's captions.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveSourceRequest {
    source_id: String,
    display_name: String,
    caption_tag: String,
    language_profile: String,
    endpoint_id: String,
    #[serde(default = "default_source_strictness")]
    strictness: String,
    #[serde(default = "default_source_label_style")]
    label_style: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default = "default_source_priority")]
    priority: u32,
    #[serde(default = "default_source_origin_value")]
    source_origin: String,
    #[serde(default)]
    language_config: Option<ipc_protocol::LanguageConfig>,
    #[serde(default)]
    target_language: Option<String>,
    #[serde(default)]
    translation_provider: Option<String>,
}

fn default_source_origin_value() -> String {
    ipc_protocol::DEFAULT_SOURCE_ORIGIN.to_owned()
}

fn default_source_strictness() -> String {
    "balanced".to_owned()
}

fn default_source_label_style() -> String {
    "brackets".to_owned()
}

fn default_source_priority() -> u32 {
    100
}

/// A resolved per-source capture: `endpoint_name`/`loopback` are resolved
/// from the endpoint catalog so the worker never needs the catalog.
#[derive(Debug, Clone)]
struct LiveSource {
    source_id: String,
    endpoint_name: String,
    loopback: bool,
    display_name: String,
    caption_tag: String,
    language_profile: String,
    strictness: String,
    label_style: String,
    color: Option<String>,
    priority: u32,
    source_origin: String,
    language_config: Option<ipc_protocol::LanguageConfig>,
    target_language: Option<String>,
    translation_provider: Option<String>,
}

impl LiveSource {
    fn to_registry_entry(&self) -> SourceRegistryEntry {
        SourceRegistryEntry {
            source_id: self.source_id.clone(),
            display_name: self.display_name.clone(),
            caption_tag: self.caption_tag.clone(),
            capture_target: serde_json::Value::String(self.endpoint_name.clone()),
            language_profile: self.language_profile.clone(),
            strictness: match self.strictness.as_str() {
                "off" => CaptionStrictness::Off,
                "strict" => CaptionStrictness::Strict,
                _ => CaptionStrictness::Balanced,
            },
            label_style: match self.label_style.as_str() {
                "colon" => CaptionLabelStyle::Colon,
                "bullet" => CaptionLabelStyle::Bullet,
                "stacked" => CaptionLabelStyle::Stacked,
                "hidden" => CaptionLabelStyle::Hidden,
                _ => CaptionLabelStyle::Brackets,
            },
            color: self.color.clone(),
            priority: self.priority,
            source_origin: self.source_origin.clone(),
            language_config: self.language_config.clone(),
            target_language: self.target_language.clone(),
            translation_provider: self.translation_provider.clone(),
        }
    }
}

struct LiveWorkerConfig {
    endpoint_name: String,
    /// `Some(name)` when monitoring is enabled, otherwise `None`.
    playback_endpoint_name: Option<String>,
    source_mode: String,
    provider: String,
    asr_provider: String,
    translation_provider: String,
    target_language: String,
    resource_profile: String,
    /// True when the selected endpoint is a Render endpoint captured via WASAPI
    /// shared-mode loopback rather than a microphone capture stream.
    loopback: bool,
    /// macOS only: the "system-audio" pseudo-endpoint, captured through
    /// ScreenCaptureKit instead of cpal. Always false on other platforms.
    system_audio: bool,
    monitor_enabled: bool,
    vad_sensitivity: u8,
    segmentation: String,
    /// Multi-source captures; empty for classic single-channel sessions.
    sources: Vec<LiveSource>,
    /// The user's own microphone source (None = the mic feature is off for
    /// this session). When present it is included in the sidecar registry,
    /// and its capture is gated by the shared `mic_enabled` flag.
    mic_source: Option<LiveSource>,
    /// Shared flag toggled by the "you" mic button. The live loop opens and
    /// closes the mic capture around this flag.
    mic_enabled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveMetrics {
    captured_frames: u64,
    audio_packets_sent: u64,
    capture_drops: u64,
    monitor_drops: u64,
    monitor_underrun_samples: u64,
    captions_received: u64,
    /// Peak amplitude (0..1) of the most recently captured frame. Lets the
    /// UI show whether audio actually reaches the app: zero with a source
    /// that should be live means the endpoint receives silence (e.g. a
    /// virtual device with nothing routed into it).
    capture_peak: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveSnapshot {
    state: &'static str,
    provider: Option<String>,
    asr_model: Option<String>,
    asr_runtime: Option<String>,
    translation_runtime: Option<String>,
    source_mode: Option<String>,
    target_language: Option<String>,
    resource_profile: Option<String>,
    metrics: LiveMetrics,
    captions: Vec<CaptionPayload>,
    error: Option<String>,
    /// Non-fatal capture stall warning ("" when healthy).
    warning: Option<String>,
    /// The user's mic stream: whether it is configured and whether the mic
    /// toggle is currently capturing.
    mic_enabled: bool,
}

enum LiveWorkerEvent {
    Caption(Box<CaptionPayload>),
    Metrics(LiveMetrics),
    Error(String),
    /// Non-fatal: the capture endpoint stopped delivering frames but the
    /// session keeps running and recovers automatically when audio returns.
    Warning(String),
    Stopped,
}

#[derive(Default)]
struct LiveRuntimeState {
    worker: Option<JoinHandle<()>>,
    stop: Option<SyncSender<()>>,
    events: Option<Receiver<LiveWorkerEvent>>,
    started: Option<LiveStarted>,
    metrics: LiveMetrics,
    error: Option<String>,
    /// Non-fatal capture stall warning; cleared when audio flows again.
    warning: Option<String>,
    stopped: bool,
    /// The user's own mic stream: `mic_source` is set while a session with
    /// the mic feature is running; `mic_enabled` is the shared toggle the
    /// "you" mic button flips (the live loop opens/closes the capture).
    mic_source: Option<LiveSource>,
    mic_enabled: Arc<AtomicBool>,
}

#[derive(Default)]
struct LiveRuntime {
    state: Arc<Mutex<LiveRuntimeState>>,
}

/// Second, independent live session ("separated live") started from the
/// history page. Shares the sidecar process (and loaded models) with the
/// main live session, but has its own capture endpoint and configuration.
#[derive(Default)]
struct SeparateLiveRuntime {
    state: Arc<Mutex<LiveRuntimeState>>,
}

#[tauri::command]
fn app_status(
    runtime: tauri::State<'_, AudioRuntime>,
    sidecar: tauri::State<'_, SidecarRuntime>,
    live: tauri::State<'_, LiveRuntime>,
) -> AppStatus {
    let capture_active = runtime
        .state
        .lock()
        .map(|state| state.selected_endpoint_id.is_some())
        .unwrap_or(false);
    AppStatus {
        phase: 7,
        capture_active,
        inference_active: live
            .state
            .lock()
            .map(|state| state.worker.is_some() && !state.stopped)
            .unwrap_or(false)
            || sidecar
                .supervisor
                .lock()
                .map(|supervisor| supervisor.is_some())
                .unwrap_or(false),
        multi_source: multi_source_enabled(),
        caption_trust: caption_trust_enabled(),
    }
}

async fn launch_live_translation(
    request: LiveStartRequest,
    audio: &AudioRuntime,
    paths: &SidecarPaths,
    state: Arc<Mutex<LiveRuntimeState>>,
    sidecar: Arc<Mutex<Option<SidecarSupervisor>>>,
    pool: Arc<Mutex<Option<Weak<SidecarProcess>>>>,
    translation_api: Arc<Mutex<Vec<(String, String)>>>,
    live_models: Arc<Mutex<ModelRuntimeState>>,
) -> Result<LiveSnapshot, String> {
    let LiveStartRequest {
        endpoint_id,
        playback_endpoint_id,
        source_mode,
        provider,
        asr_provider,
        translation_provider,
        target_language,
        resource_profile,
        monitor_enabled,
        vad_sensitivity,
        segmentation,
        sources: request_sources,
        mic_source: request_mic_source,
    } = request;
    let mic_enabled = Arc::new(AtomicBool::new(false));
    if source_mode != "filipino"
        && source_mode != "chinese"
        && source_mode != "english"
        && source_mode != "indonesian"
        && source_mode != "vietnamese"
        && source_mode != "thai"
        && source_mode != "malay"
    {
        return Err("V1 live mode supports Filipino, Chinese, English, Indonesian, Vietnamese, Thai or Malay only".to_owned());
    }
    if !matches!(
        target_language.as_str(),
        "en" | "zh" | "fil" | "ind" | "vie" | "tha" | "zsm"
    ) {
        return Err("target language must be en, zh, fil, ind, vie, tha or zsm".to_owned());
    }
    if !matches!(provider.as_str(), "demo" | "local" | "http") {
        return Err("live provider must be demo, local, or http".to_string());
    }
    if !matches!(
        asr_provider.as_str(),
        "local"
            | "whisper-turbo"
            | "whisper-full"
            | "ncspeech"
            | "ncspeech-zh"
            | "ncspeech-zh-parakeet"
            | "mlx"
            | "mlx-whisper"
            | "paraformer-zh-streaming"
            | "sensevoice-small"
            | "sense-voice"
            | "nvidia-whisper-large-v3"
            | "nvidia-nemotron-asr-streaming"
            | "nvidia-parakeet-1.1b"
            | "nvidia-canary-1b"
            | "groq-whisper"
    ) {
        return Err(format!("unknown ASR provider: {asr_provider}"));
    }
    if !matches!(
        translation_provider.as_str(),
        "nllb"
            | "madlad"
            | "opus-mt-en-zh"
            | "opus-mt-zh-en"
            | "nvidia-riva-4b"
            | "nvidia-riva-1.6b"
            | "libretranslate"
            | "google-translate"
            | "mymemory"
            | "baidu-translate"
            | "custom-http"
    ) {
        return Err(format!(
            "unknown translation provider: {translation_provider}"
        ));
    }
    // Any remote provider (Groq ASR or an HTTP translation backend) implies the
    // "http" mode so the sidecar keeps the demo flag off and routes through the
    // configured remote provider.
    let provider = if asr_provider == "groq-whisper"
        || asr_provider.starts_with("nvidia-")
        || !matches!(translation_provider.as_str(), "madlad" | "nllb")
    {
        "http".to_string()
    } else {
        provider
    };
    if !matches!(resource_profile.as_str(), "balanced" | "quality") {
        return Err("unknown live resource profile".to_string());
    }
    if vad_sensitivity > 100 {
        return Err("vad_sensitivity must be between 0 and 100".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        // A denied (or missing) microphone grant makes every input capture
        // deliver silent zeros with no error — the classic "starts but never
        // hears anything" failure. Surface it before starting instead.
        use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};
        let media_type = unsafe { AVMediaTypeAudio.as_ref() };
        if let Some(media_type) = media_type {
            let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
            use objc2_av_foundation::AVAuthorizationStatus;
            if status == AVAuthorizationStatus::Denied
                || status == AVAuthorizationStatus::Restricted
            {
                return Err(
                    "yTSRL needs Microphone permission — without it every capture is silent. \
                     Enable it in System Settings → Privacy & Security → Microphone, then retry."
                        .to_owned(),
                );
            }
        }
    }
    if !matches!(segmentation.as_str(), "chunk" | "balanced" | "sentence") {
        return Err("unknown caption segmentation".to_string());
    }
    let endpoints = platform_endpoints(&audio)?;
    let endpoint = endpoints
        .iter()
        .find(|candidate| candidate.id == endpoint_id)
        .or_else(|| {
            // Legacy/stale persisted ids (numeric CoreAudio ids from older
            // builds) no longer match the stable name-based catalog; fall
            // back to the friendly name so a saved selection still works.
            endpoints
                .iter()
                .find(|candidate| candidate.friendly_name == endpoint_id)
        })
        .ok_or_else(|| AudioError::EndpointNotFound.to_string())?;
    if endpoint.state != EndpointState::Active {
        return Err(AudioError::EndpointInvalidated.to_string());
    }
    // A Capture endpoint captures a microphone; a Render endpoint is opened in
    // WASAPI shared-mode loopback to capture the game/teammates mix being
    // played through that render endpoint (e.g. headphones or speakers). The
    // macOS "system-audio" pseudo-endpoint is captured via ScreenCaptureKit.
    let loopback = match endpoint.kind {
        EndpointKind::Capture => false,
        EndpointKind::Render => true,
    };
    let system_audio = endpoint.id == audio_core::SYSTEM_AUDIO_ENDPOINT_ID;

    let playback_endpoint_name = if monitor_enabled {
        let raw_playback_id = playback_endpoint_id.as_deref().unwrap_or("").trim();
        if raw_playback_id.is_empty() {
            return Err(
                "monitoring output endpoint is required when monitoring is enabled".to_owned(),
            );
        }
        let playback_endpoint = endpoints
            .iter()
            .find(|candidate| candidate.id == raw_playback_id)
            .or_else(|| {
                endpoints
                    .iter()
                    .find(|candidate| candidate.friendly_name == raw_playback_id)
            })
            .ok_or_else(|| AudioError::EndpointNotFound.to_string())?;
        if playback_endpoint.kind != EndpointKind::Render
            || playback_endpoint.state != EndpointState::Active
        {
            return Err(AudioError::EndpointInvalidated.to_string());
        }
        // Even with loopback on the same physical device, feeding the captured
        // mix back into the same render endpoint doubles audio and risks echo.
        if endpoint.id == playback_endpoint.id {
            return Err("capture and monitoring endpoints must be different".to_owned());
        }
        Some(playback_endpoint.friendly_name.clone())
    } else {
        None
    };

    let bundled = paths.bundled.clone();
    let endpoint_name = endpoint.friendly_name.clone();
    // Multi-source mode: one capture per configured source, each tagged with
    // its own `source_id` and captioned under its own tag. Monitoring is not
    // available here (per-source monitoring is a Sources-page config).
    let sources = if request_sources.is_empty() {
        Vec::new()
    } else {
        if monitor_enabled {
            return Err(
                "monitoring is not available in all-sources mode; turn it off \
                 or use a single channel"
                    .to_owned(),
            );
        }
        let mut resolved = Vec::with_capacity(request_sources.len());
        for source in &request_sources {
            if !(source.source_id.len() == 32
                && source
                    .source_id
                    .chars()
                    .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()))
            {
                return Err(format!(
                    "source id must be 32 lowercase hex: {}",
                    source.source_id
                ));
            }
            let source_endpoint = endpoints
                .iter()
                .find(|candidate| candidate.id == source.endpoint_id)
                .ok_or_else(|| {
                    format!(
                        "source '{}' endpoint was not found: {}",
                        source.display_name, source.endpoint_id
                    )
                })?;
            if source_endpoint.state != EndpointState::Active {
                return Err(format!(
                    "source '{}' endpoint is not active",
                    source.display_name
                ));
            }
            resolved.push(LiveSource {
                source_id: source.source_id.clone(),
                endpoint_name: source_endpoint.friendly_name.clone(),
                loopback: source_endpoint.kind == EndpointKind::Render,
                display_name: source.display_name.clone(),
                caption_tag: source.caption_tag.clone(),
                language_profile: source.language_profile.clone(),
                strictness: source.strictness.clone(),
                label_style: source.label_style.clone(),
                color: source.color.clone(),
                priority: source.priority,
                source_origin: source.source_origin.clone(),
                language_config: source.language_config.clone(),
                target_language: source.target_language.clone(),
                translation_provider: source.translation_provider.clone(),
            });
        }
        resolved
    };
    let mic_source = match request_mic_source {
        None => None,
        Some(source) => Some(resolve_mic_source(&endpoints, &source)?),
    };
    let worker_config = LiveWorkerConfig {
        endpoint_name,
        playback_endpoint_name,
        source_mode,
        provider,
        asr_provider,
        translation_provider,
        target_language,
        resource_profile,
        loopback,
        system_audio,
        monitor_enabled,
        vad_sensitivity,
        segmentation,
        sources,
        mic_source: mic_source.clone(),
        mic_enabled: mic_enabled.clone(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        start_live_translation_blocking(
            worker_config,
            state,
            sidecar,
            translation_api,
            live_models,
            bundled,
            Some(pool),
        )
    })
    .await
    .map_err(|error| format!("live start worker failed: {error}"))?
}

#[tauri::command]
async fn start_live_translation(
    request: LiveStartRequest,
    audio: tauri::State<'_, AudioRuntime>,
    sidecar: tauri::State<'_, SidecarRuntime>,
    live: tauri::State<'_, LiveRuntime>,
    pool: tauri::State<'_, SidecarPool>,
    translation_api: tauri::State<'_, TranslationApiRuntime>,
    models: tauri::State<'_, ModelRuntime>,
    paths: tauri::State<'_, SidecarPaths>,
) -> Result<LiveSnapshot, String> {
    launch_live_translation(
        request,
        &audio,
        &paths,
        Arc::clone(&live.state),
        Arc::clone(&sidecar.supervisor),
        Arc::clone(&pool.inner),
        Arc::clone(&translation_api.env),
        Arc::clone(&models.state),
    )
    .await
}

#[tauri::command]
async fn start_separated_live_translation(
    request: LiveStartRequest,
    audio: tauri::State<'_, AudioRuntime>,
    live: tauri::State<'_, SeparateLiveRuntime>,
    pool: tauri::State<'_, SidecarPool>,
    translation_api: tauri::State<'_, TranslationApiRuntime>,
    models: tauri::State<'_, ModelRuntime>,
    paths: tauri::State<'_, SidecarPaths>,
) -> Result<LiveSnapshot, String> {
    // The separated session shares the live sidecar pool (loaded models)
    // but runs its own worker; it does not own the clip-analysis sidecar.
    launch_live_translation(
        request,
        &audio,
        &paths,
        Arc::clone(&live.state),
        Arc::new(Mutex::new(None)),
        Arc::clone(&pool.inner),
        Arc::clone(&translation_api.env),
        Arc::clone(&models.state),
    )
    .await
}

/// Resolve the user's own microphone source request. The endpoint must be
/// an active Capture (mic) endpoint — never a Render loopback, so the "you"
/// stream can never feed back into the team capture.
fn resolve_mic_source(
    endpoints: &[audio_core::AudioEndpoint],
    source: &LiveSourceRequest,
) -> Result<LiveSource, String> {
    if !(source.source_id.len() == 32
        && source
            .source_id
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()))
    {
        return Err(format!(
            "mic source id must be 32 lowercase hex: {}",
            source.source_id
        ));
    }
    let endpoint = endpoints
        .iter()
        .find(|candidate| candidate.id == source.endpoint_id)
        .ok_or_else(|| {
            format!(
                "mic source '{}' endpoint was not found: {}",
                source.display_name, source.endpoint_id
            )
        })?;
    if endpoint.kind != EndpointKind::Capture {
        return Err(format!(
            "mic source '{}' must be a microphone endpoint, not a render device",
            source.display_name
        ));
    }
    if endpoint.state != EndpointState::Active {
        return Err(format!(
            "mic source '{}' endpoint is not active",
            source.display_name
        ));
    }
    Ok(LiveSource {
        source_id: source.source_id.clone(),
        endpoint_name: endpoint.friendly_name.clone(),
        loopback: false,
        display_name: source.display_name.clone(),
        caption_tag: source.caption_tag.clone(),
        language_profile: source.language_profile.clone(),
        strictness: source.strictness.clone(),
        label_style: source.label_style.clone(),
        color: source.color.clone(),
        priority: source.priority,
        source_origin: source.source_origin.clone(),
        language_config: source.language_config.clone(),
        target_language: source.target_language.clone(),
        translation_provider: source.translation_provider.clone(),
    })
}

fn start_live_translation_blocking(
    worker_config: LiveWorkerConfig,
    live: Arc<Mutex<LiveRuntimeState>>,
    sidecar: Arc<Mutex<Option<SidecarSupervisor>>>,
    translation_api: Arc<Mutex<Vec<(String, String)>>>,
    live_models: Arc<Mutex<ModelRuntimeState>>,
    bundled: Option<BundledPaths>,
    pool: Option<Arc<Mutex<Option<Weak<SidecarProcess>>>>>,
) -> Result<LiveSnapshot, String> {
    let mut state = live.lock().map_err(lock_error)?;
    if state.worker.is_some() && !state.stopped {
        return Err("live translation is already running".to_owned());
    }
    cleanup_live_worker(&mut state);
    if let Some(mut existing) = sidecar.lock().map_err(lock_error)?.take() {
        existing.stop();
    }

    let (stop_tx, stop_rx) = mpsc::sync_channel(1);
    let (event_tx, event_rx) = mpsc::sync_channel(64);
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let in_use_ids = provider_model_ids(
        &worker_config.asr_provider,
        &worker_config.translation_provider,
    );
    let worker_pool = pool.map(|inner| Arc::clone(&inner));
    // The mic stream's registry identity lives with the session; the worker
    // takes the config, so snapshot the identity before moving it.
    let session_mic_source = worker_config.mic_source.clone();
    let session_mic_enabled = Arc::clone(&worker_config.mic_enabled);
    let worker = thread::Builder::new()
        .name("live-translation".to_owned())
        .spawn(move || {
            run_live_worker(
                worker_config,
                stop_rx,
                event_tx,
                ready_tx,
                Arc::clone(&translation_api),
                bundled,
                worker_pool,
            );
        })
        .map_err(|error| format!("live worker could not start: {error}"))?;
    let started = match ready_rx.recv_timeout(Duration::from_secs(3 * 60)) {
        Ok(Ok(started)) => started,
        Ok(Err(error)) => {
            let _ = worker.join();
            return Err(error);
        }
        Err(_) => {
            let _ = stop_tx.try_send(());
            let _ = worker.join();
            return Err("live models did not become ready in time".to_owned());
        }
    };
    state.worker = Some(worker);
    state.stop = Some(stop_tx);
    state.events = Some(event_rx);
    state.started = Some(started);
    state.metrics = LiveMetrics::default();
    state.error = None;
    state.warning = None;
    state.stopped = false;
    state.mic_source = session_mic_source;
    state.mic_enabled = session_mic_enabled;
    state.mic_enabled.store(false, Ordering::Relaxed);
    // Mark the model artifacts this session loads so deletion is refused
    // while they are on disk in use.
    if let Ok(mut models) = live_models.lock() {
        for id in in_use_ids {
            models.in_use.insert(id.to_owned());
        }
    }
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
fn live_translation_snapshot(live: tauri::State<'_, LiveRuntime>) -> Result<LiveSnapshot, String> {
    let mut state = live.state.lock().map_err(lock_error)?;
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
fn set_live_mic_enabled(
    enabled: bool,
    live: tauri::State<'_, LiveRuntime>,
) -> Result<bool, String> {
    let state = live.state.lock().map_err(lock_error)?;
    if state.worker.is_none() || state.stopped {
        return Err("a live translation session must be running to use your mic".to_owned());
    }
    if state.mic_source.is_none() {
        return Err("the mic stream is not configured for this session".to_owned());
    }
    state.mic_enabled.store(enabled, Ordering::Relaxed);
    Ok(enabled)
}

#[tauri::command]
async fn stop_live_translation(
    live: tauri::State<'_, LiveRuntime>,
    models: tauri::State<'_, ModelRuntime>,
) -> Result<LiveSnapshot, String> {
    let state = Arc::clone(&live.state);
    let live_models = Arc::clone(&models.state);
    tauri::async_runtime::spawn_blocking(move || stop_live_translation_blocking(state, live_models))
        .await
        .map_err(|error| format!("live stop worker failed: {error}"))?
}

fn stop_live_translation_blocking(
    live: Arc<Mutex<LiveRuntimeState>>,
    live_models: Arc<Mutex<ModelRuntimeState>>,
) -> Result<LiveSnapshot, String> {
    let mut state = live.lock().map_err(lock_error)?;
    if let Some(stop) = state.stop.take() {
        let _ = stop.try_send(());
    }
    if let Some(worker) = state.worker.take() {
        worker
            .join()
            .map_err(|_| "live worker terminated unexpectedly".to_owned())?;
    }
    state.stopped = true;
    state.mic_source = None;
    state.mic_enabled.store(false, Ordering::Relaxed);
    // The session is over; every model it marked in use is free to delete.
    if let Ok(mut models) = live_models.lock() {
        models.in_use.clear();
    }
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
fn separated_live_translation_snapshot(
    live: tauri::State<'_, SeparateLiveRuntime>,
) -> Result<LiveSnapshot, String> {
    let mut state = live.state.lock().map_err(lock_error)?;
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
async fn stop_separated_live_translation(
    live: tauri::State<'_, SeparateLiveRuntime>,
    models: tauri::State<'_, ModelRuntime>,
) -> Result<LiveSnapshot, String> {
    let state = Arc::clone(&live.state);
    let live_models = Arc::clone(&models.state);
    tauri::async_runtime::spawn_blocking(move || {
        stop_live_translation_blocking(state, live_models)
    })
    .await
    .map_err(|error| format!("separated live stop worker failed: {error}"))?
}

#[tauri::command]
async fn analyze_clip(
    path: String,
    source_mode: String,
    provider: String,
    runtime: tauri::State<'_, SidecarRuntime>,
    paths: tauri::State<'_, SidecarPaths>,
) -> Result<ClipResultPayload, String> {
    let supervisor = Arc::clone(&runtime.supervisor);
    let bundled = paths.bundled.clone();
    tauri::async_runtime::spawn_blocking(move || {
        analyze_clip_blocking(supervisor, path, source_mode, provider, bundled)
    })
    .await
    .map_err(|error| format!("clip worker failed: {error}"))?
}

fn analyze_clip_blocking(
    runtime: Arc<Mutex<Option<SidecarSupervisor>>>,
    path: String,
    source_mode: String,
    provider: String,
    bundled: Option<BundledPaths>,
) -> Result<ClipResultPayload, String> {
    let mut supervisor = runtime.lock().map_err(lock_error)?;
    let needs_restart = supervisor
        .as_mut()
        .is_some_and(|running| running.ensure_running().is_err());
    if needs_restart {
        let _ = supervisor.take();
    }
    if supervisor.is_none() {
        let config = sidecar_config(bundled.as_ref(), &[]);
        *supervisor = Some(SidecarSupervisor::start(&config).map_err(|error| error.to_string())?);
    }
    let first_attempt = supervisor
        .as_mut()
        .expect("sidecar was started above")
        .process_clip(std::path::Path::new(&path), &source_mode, &provider);
    match first_attempt {
        Ok(result) => Ok(result),
        Err(error) if error.is_transport_failure() => {
            let _ = supervisor.take();
            let config = sidecar_config(bundled.as_ref(), &[]);
            let mut replacement =
                SidecarSupervisor::start(&config).map_err(|start_error| start_error.to_string())?;
            let result = replacement
                .process_clip(std::path::Path::new(&path), &source_mode, &provider)
                .map_err(|retry_error| retry_error.to_string())?;
            *supervisor = Some(replacement);
            Ok(result)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// v0.4 Accuracy Lab: run a clip through multiple ASR/MT configurations.
/// Returns the raw sidecar report (validated by the frontend schema).
#[tauri::command]
async fn clip_compare(
    path: String,
    source_mode: String,
    configs: Vec<Vec<String>>,
    include_transcripts: bool,
    runtime: tauri::State<'_, SidecarRuntime>,
    paths: tauri::State<'_, SidecarPaths>,
) -> Result<serde_json::Value, String> {
    let supervisor = Arc::clone(&runtime.supervisor);
    let bundled = paths.bundled.clone();
    tauri::async_runtime::spawn_blocking(move || {
        analyze_clip_compare_blocking(
            supervisor,
            path,
            source_mode,
            configs,
            include_transcripts,
            bundled,
        )
    })
    .await
    .map_err(|error| format!("clip compare worker failed: {error}"))?
}

fn analyze_clip_compare_blocking(
    runtime: Arc<Mutex<Option<SidecarSupervisor>>>,
    path: String,
    source_mode: String,
    configs: Vec<Vec<String>>,
    include_transcripts: bool,
    bundled: Option<BundledPaths>,
) -> Result<serde_json::Value, String> {
    let mut supervisor = runtime.lock().map_err(lock_error)?;
    let needs_restart = supervisor
        .as_mut()
        .is_some_and(|running| running.ensure_running().is_err());
    if needs_restart {
        let _ = supervisor.take();
    }
    if supervisor.is_none() {
        let config = sidecar_config(bundled.as_ref(), &[]);
        *supervisor = Some(SidecarSupervisor::start(&config).map_err(|error| error.to_string())?);
    }
    supervisor
        .as_mut()
        .expect("sidecar was started above")
        .clip_compare(
            std::path::Path::new(&path),
            &source_mode,
            configs,
            include_transcripts,
        )
        .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslateTextResult {
    translated_text: String,
    provider: String,
    latency_ms: f64,
}

/// One-shot typed-chat translation. Works standalone: the on-demand
/// `SidecarRuntime` supervisor is spawned on first use and reused (the same
/// model cache as clip analysis), so no live session is required.
#[tauri::command]
async fn translate_text(
    text: String,
    source_mode: String,
    target_language: String,
    translation_provider: String,
    runtime: tauri::State<'_, SidecarRuntime>,
    paths: tauri::State<'_, SidecarPaths>,
) -> Result<TranslateTextResult, String> {
    let supervisor = Arc::clone(&runtime.supervisor);
    let bundled = paths.bundled.clone();
    tauri::async_runtime::spawn_blocking(move || {
        translate_text_blocking(
            supervisor,
            text,
            source_mode,
            target_language,
            translation_provider,
            bundled,
        )
    })
    .await
    .map_err(|error| format!("translation worker failed: {error}"))?
}

fn translate_text_blocking(
    runtime: Arc<Mutex<Option<SidecarSupervisor>>>,
    text: String,
    source_mode: String,
    target_language: String,
    translation_provider: String,
    bundled: Option<BundledPaths>,
) -> Result<TranslateTextResult, String> {
    if text.trim().is_empty() {
        return Err("nothing to translate".to_owned());
    }
    if text.len() > 2000 {
        return Err("text is too long (2000 characters max)".to_owned());
    }
    let mut supervisor = runtime.lock().map_err(lock_error)?;
    let needs_restart = supervisor
        .as_mut()
        .is_some_and(|running| running.ensure_running().is_err());
    if needs_restart {
        let _ = supervisor.take();
    }
    if supervisor.is_none() {
        let config = sidecar_config(bundled.as_ref(), &[]);
        *supervisor = Some(SidecarSupervisor::start(&config).map_err(|error| error.to_string())?);
    }
    let result = supervisor
        .as_mut()
        .expect("sidecar was started above")
        .translate_text(&text, &source_mode, &target_language, &translation_provider)
        .map_err(|error| error.to_string())?;
    Ok(TranslateTextResult {
        translated_text: result.translated_text,
        provider: result.provider,
        latency_ms: result.latency_ms,
    })
}

#[tauri::command]
fn audio_endpoints(runtime: tauri::State<'_, AudioRuntime>) -> Result<EndpointCatalog, String> {
    #[cfg(target_os = "windows")]
    {
        let device_change_detected = runtime
            .watcher
            .lock()
            .map_err(lock_error)?
            .as_ref()
            .map(drain_device_events)
            .transpose()?
            .unwrap_or(false);
        let endpoints =
            audio_core::WindowsEndpointCatalog::enumerate().map_err(audio_error_to_string)?;
        Ok(EndpointCatalog {
            platform: "windows",
            endpoints,
            device_change_detected,
            process_capture_supported: false,
        })
    }

    #[cfg(target_os = "macos")]
    {
        let device_change_detected = runtime
            .watcher
            .lock()
            .map_err(lock_error)?
            .as_ref()
            .map(drain_macos_device_events)
            .transpose()?
            .unwrap_or(false);
        let endpoints =
            audio_core::MacosEndpointCatalog::enumerate().map_err(audio_error_to_string)?;
        Ok(EndpointCatalog {
            platform: "macos",
            endpoints,
            device_change_detected,
            process_capture_supported: false,
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut endpoints = runtime
            .state
            .lock()
            .map_err(lock_error)?
            .synthetic
            .enumerate()
            .map_err(audio_error_to_string)?;
        endpoints.push(synthetic_monitor_endpoint());
        Ok(EndpointCatalog {
            platform: "development",
            endpoints,
            device_change_detected: false,
            process_capture_supported: false,
        })
    }
}

#[tauri::command]
fn start_synthetic_routing(
    capture_endpoint_id: String,
    playback_endpoint_id: String,
    volume: f32,
    runtime: tauri::State<'_, RoutingRuntime>,
) -> Result<(), String> {
    validate_route(&capture_endpoint_id, &playback_endpoint_id).map_err(audio_error_to_string)?;
    if capture_endpoint_id != SYNTHETIC_ENDPOINT_ID
        || playback_endpoint_id != SYNTHETIC_MONITOR_ENDPOINT_ID
    {
        return Err("real WASAPI capture/playback requires Windows hardware validation".to_owned());
    }

    let mut state = runtime.state.lock().map_err(lock_error)?;
    if state.router.is_some() {
        stop_routing_state(&mut state)?;
    }
    state
        .source
        .start(&capture_endpoint_id)
        .map_err(audio_error_to_string)?;
    state
        .monitor
        .start(
            &playback_endpoint_id,
            AudioFormat {
                sample_rate: 48_000,
                channels: 1,
            },
        )
        .map_err(audio_error_to_string)?;
    state
        .monitor
        .set_volume(volume)
        .map_err(audio_error_to_string)?;
    let mut router = AudioRouter::new(48_000, 8, 100).map_err(audio_error_to_string)?;
    router
        .set_monitor_volume(volume)
        .map_err(audio_error_to_string)?;
    state.capture_endpoint_id = Some(capture_endpoint_id);
    state.playback_endpoint_id = Some(playback_endpoint_id);
    state.router = Some(router);
    Ok(())
}

#[tauri::command]
fn synthetic_routing_snapshot(
    runtime: tauri::State<'_, RoutingRuntime>,
) -> Result<RoutingSnapshot, String> {
    let mut state = runtime.state.lock().map_err(lock_error)?;
    if state.router.is_none() {
        return Ok(RoutingSnapshot {
            active: false,
            monitor_peak: 0.0,
            inference_samples: 0,
            metrics: RoutingMetrics::default(),
            backend: "synthetic",
        });
    }

    let frame = state.source.next_frame().map_err(audio_error_to_string)?;
    state
        .router
        .as_mut()
        .expect("router was checked above")
        .route(frame)
        .map_err(audio_error_to_string)?;
    let monitor_frame = state
        .router
        .as_mut()
        .expect("router was checked above")
        .pop_monitor();
    let inference_samples = state
        .router
        .as_mut()
        .expect("router was checked above")
        .pop_inference()
        .map(|frame| frame.samples.len())
        .unwrap_or_default();
    let monitor_peak = monitor_frame
        .as_ref()
        .map(|frame| {
            frame
                .samples
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
        })
        .unwrap_or_default();
    if let Some(frame) = monitor_frame {
        state.monitor.write(frame).map_err(audio_error_to_string)?;
    }
    let metrics = state
        .router
        .as_ref()
        .expect("router was checked above")
        .metrics();
    Ok(RoutingSnapshot {
        active: true,
        monitor_peak,
        inference_samples,
        metrics,
        backend: "synthetic",
    })
}

#[tauri::command]
fn set_synthetic_monitor_volume(
    volume: f32,
    runtime: tauri::State<'_, RoutingRuntime>,
) -> Result<(), String> {
    let mut state = runtime.state.lock().map_err(lock_error)?;
    state
        .monitor
        .set_volume(volume)
        .map_err(audio_error_to_string)?;
    if let Some(router) = state.router.as_mut() {
        router
            .set_monitor_volume(volume)
            .map_err(audio_error_to_string)?;
    }
    Ok(())
}

#[tauri::command]
fn stop_synthetic_routing(runtime: tauri::State<'_, RoutingRuntime>) -> Result<(), String> {
    let mut state = runtime.state.lock().map_err(lock_error)?;
    stop_routing_state(&mut state)
}

#[tauri::command]
fn start_fake_sidecar(
    runtime: tauri::State<'_, SidecarRuntime>,
    paths: tauri::State<'_, SidecarPaths>,
) -> Result<SidecarStatus, String> {
    let mut supervisor = runtime.supervisor.lock().map_err(lock_error)?;
    let needs_restart = supervisor
        .as_mut()
        .is_some_and(|running| running.ensure_running().is_err());
    if needs_restart {
        let _ = supervisor.take();
    }
    if supervisor.is_none() {
        let config = sidecar_config(paths.bundled.as_ref(), &[]);
        *supervisor = Some(SidecarSupervisor::start(&config).map_err(|error| error.to_string())?);
    }
    Ok(SidecarStatus {
        state: "ready",
        provider: "fake",
        restartable: true,
    })
}

#[tauri::command]
fn fake_inference_roundtrip(
    runtime: tauri::State<'_, SidecarRuntime>,
) -> Result<Vec<Envelope<CaptionPayload>>, String> {
    runtime
        .supervisor
        .lock()
        .map_err(lock_error)?
        .as_mut()
        .ok_or_else(|| "fake sidecar is not running".to_owned())?
        .fake_roundtrip(100_000_000, vec![0.25; 320])
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn fake_multi_source_roundtrip(
    runtime: tauri::State<'_, SidecarRuntime>,
) -> Result<Vec<Envelope<CaptionPayload>>, String> {
    runtime
        .supervisor
        .lock()
        .map_err(lock_error)?
        .as_mut()
        .ok_or_else(|| "fake sidecar is not running".to_owned())?
        .fake_roundtrip_multi_source(200_000_000, vec![0.25; 320])
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_fake_sidecar(runtime: tauri::State<'_, SidecarRuntime>) -> Result<SidecarStatus, String> {
    if let Some(mut supervisor) = runtime.supervisor.lock().map_err(lock_error)?.take() {
        supervisor.stop();
    }
    Ok(SidecarStatus {
        state: "stopped",
        provider: "fake",
        restartable: true,
    })
}

#[tauri::command]
fn start_audio_meter(
    endpoint_id: String,
    runtime: tauri::State<'_, AudioRuntime>,
) -> Result<(), String> {
    let endpoints = platform_endpoints(&runtime)?;
    let endpoint = endpoints
        .iter()
        .find(|endpoint| endpoint.id == endpoint_id)
        .or_else(|| {
            endpoints
                .iter()
                .find(|endpoint| endpoint.friendly_name == endpoint_id)
        })
        .ok_or_else(|| AudioError::EndpointNotFound.to_string())?;
    if endpoint.kind != EndpointKind::Capture || endpoint.state != EndpointState::Active {
        return Err(AudioError::EndpointInvalidated.to_string());
    }

    let mut state = runtime.state.lock().map_err(lock_error)?;
    if state.selected_endpoint_id.as_deref() == Some(endpoint_id.as_str()) {
        return Ok(());
    }
    if state.selected_endpoint_id.as_deref() == Some(SYNTHETIC_ENDPOINT_ID) {
        state.synthetic.stop().map_err(audio_error_to_string)?;
    }
    if endpoint_id == SYNTHETIC_ENDPOINT_ID {
        state
            .synthetic
            .start(&endpoint_id)
            .map_err(audio_error_to_string)?;
    }
    state.sequence = 0;
    state.selected_endpoint_id = Some(endpoint_id);
    Ok(())
}

#[tauri::command]
fn audio_meter_snapshot(
    endpoint_id: String,
    runtime: tauri::State<'_, AudioRuntime>,
) -> Result<LevelSnapshot, String> {
    let mut state = runtime.state.lock().map_err(lock_error)?;
    if state.selected_endpoint_id.as_deref() != Some(endpoint_id.as_str()) {
        return Err(AudioError::NotRunning.to_string());
    }

    if endpoint_id == SYNTHETIC_ENDPOINT_ID {
        let frame = state
            .synthetic
            .next_frame()
            .map_err(audio_error_to_string)?;
        state.synthetic_meter.publish(&frame, 0);
        return Ok(state.synthetic_meter.snapshot());
    }

    #[cfg(target_os = "windows")]
    {
        let peak =
            audio_core::windows_endpoint_peak(&endpoint_id).map_err(audio_error_to_string)?;
        state.sequence = state.sequence.saturating_add(1);
        Ok(LevelSnapshot {
            sequence: state.sequence,
            peak,
            rms: peak,
            clipped: peak >= 1.0,
            dropped_frames: 0,
        })
    }

    #[cfg(target_os = "macos")]
    {
        let peak = audio_core::macos_endpoint_peak(&endpoint_id).map_err(audio_error_to_string)?;
        state.sequence = state.sequence.saturating_add(1);
        Ok(LevelSnapshot {
            sequence: state.sequence,
            peak,
            rms: peak,
            clipped: peak >= 1.0,
            dropped_frames: 0,
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err(AudioError::EndpointNotFound.to_string())
}

#[tauri::command]
fn stop_audio_meter(runtime: tauri::State<'_, AudioRuntime>) -> Result<(), String> {
    let mut state = runtime.state.lock().map_err(lock_error)?;
    if state.selected_endpoint_id.as_deref() == Some(SYNTHETIC_ENDPOINT_ID) {
        state.synthetic.stop().map_err(audio_error_to_string)?;
    }
    state.selected_endpoint_id = None;
    Ok(())
}

fn platform_endpoints(runtime: &AudioRuntime) -> Result<Vec<AudioEndpoint>, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = runtime;
        audio_core::WindowsEndpointCatalog::enumerate().map_err(audio_error_to_string)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = runtime;
        audio_core::MacosEndpointCatalog::enumerate().map_err(audio_error_to_string)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut endpoints = runtime
            .state
            .lock()
            .map_err(lock_error)?
            .synthetic
            .enumerate()
            .map_err(audio_error_to_string)?;
        endpoints.push(synthetic_monitor_endpoint());
        Ok(endpoints)
    }
}

fn stop_routing_state(state: &mut RoutingRuntimeState) -> Result<(), String> {
    state.source.stop().map_err(audio_error_to_string)?;
    state.monitor.stop().map_err(audio_error_to_string)?;
    state.router = None;
    state.capture_endpoint_id = None;
    state.playback_endpoint_id = None;
    Ok(())
}

#[cfg(target_os = "windows")]
fn drain_device_events(watcher: &audio_core::WindowsDeviceWatcher) -> Result<bool, String> {
    let mut changed = false;
    while watcher.try_next().map_err(audio_error_to_string)?.is_some() {
        changed = true;
    }
    Ok(changed)
}

#[cfg(target_os = "macos")]
fn drain_macos_device_events(watcher: &audio_core::MacosDeviceWatcher) -> Result<bool, String> {
    let mut changed = false;
    while watcher.try_next().map_err(audio_error_to_string)?.is_some() {
        changed = true;
    }
    Ok(changed)
}

fn audio_error_to_string(error: AudioError) -> String {
    error.to_string()
}

/// Applies the native window look for the control window on Windows 11:
/// 1. Enables the acrylic system backdrop (`DWMSBT_TRANSIENTWINDOW`). Unlike
///    Mica (`DWMSBT_MAINWINDOW`), which renders a static opaque light sheet,
///    acrylic actually blurs the desktop behind the window. In dark theme it
///    is dark frosted glass — the liquid-glass surface the UI tints over.
///    It ignores window regions (hence the old white-square bug when a
///    `SetWindowRgn` region was combined with it), but it respects native
///    corner rounding.
/// 2. Requests native corner rounding (`DWMWA_WINDOW_CORNER_PREFERENCE`), so
///    DWM rounds the window itself like any native app.
/// Must be re-applied after window creation (DWM may reset attributes while
/// the surface settles). Best-effort: failures degrade to a plain window.
#[cfg(target_os = "windows")]
#[tauri::command]
fn apply_window_shell(window: tauri::Window) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DWM_SYSTEMBACKDROP_TYPE, DWM_WINDOW_CORNER_PREFERENCE, DWMSBT_TRANSIENTWINDOW,
        DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DwmSetWindowAttribute,
    };

    let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);
    unsafe {
        let backdrop = DWMSBT_TRANSIENTWINDOW;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<DWM_SYSTEMBACKDROP_TYPE>() as u32,
        )
        .map_err(|error| format!("DwmSetWindowAttribute(system backdrop) failed: {error}"))?;
        let corners = DWMWCP_ROUND;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corners as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        )
        .map_err(|error| format!("DwmSetWindowAttribute(corner preference) failed: {error}"))?;
    }
    Ok(())
}

/// macOS: the control window is transparent (`macOSPrivateApi`), so CSS
/// backdrop-filter alone has nothing to blur — it would render flat black.
/// `apply_vibrancy` installs an NSVisualEffectView behind the webview; the
/// CSS's translucent surfaces + blur then read as real frosted glass over
/// the desktop. Best-effort: failures degrade to a plain window.
#[cfg(target_os = "macos")]
#[tauri::command]
fn apply_window_shell(window: tauri::Window) -> Result<(), String> {
    use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};
    apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
        .map_err(|error| format!("apply_vibrancy failed: {error}"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
fn apply_window_shell(window: tauri::Window) -> Result<(), String> {
    let _ = window;
    Ok(())
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("audio runtime state is unavailable: {error}")
}

fn worker_sidecar_config(
    translation_env: &Arc<Mutex<Vec<(String, String)>>>,
    bundled: Option<&BundledPaths>,
) -> SidecarConfig {
    let env = translation_env
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    // LST_CUDA_LIBS_DIR is added inside sidecar_config for every sidecar.
    sidecar_config(bundled, &env)
}

/// Push the session's source registry so the sidecar stamps each caption
/// with its source's tag/color/language profile. Per-session: must run
/// after every `live.start` (including after a crash-restart).
fn push_live_registry(
    supervisor: &mut SidecarSupervisor,
    sources: &[LiveSource],
) -> Result<(), SupervisorError> {
    supervisor.push_source_registry(
        sources
            .iter()
            .map(LiveSource::to_registry_entry)
            .collect(),
    )
}

fn run_live_worker(
    config: LiveWorkerConfig,
    stop: Receiver<()>,
    events: SyncSender<LiveWorkerEvent>,
    ready: SyncSender<Result<LiveStarted, String>>,
    translation_env: Arc<Mutex<Vec<(String, String)>>>,
    bundled: Option<BundledPaths>,
    pool: Option<Arc<Mutex<Option<Weak<SidecarProcess>>>>>,
) {
    let LiveWorkerConfig {
        endpoint_name,
        playback_endpoint_name,
        source_mode,
        provider,
        asr_provider,
        translation_provider,
        target_language,
        resource_profile,
        loopback,
        system_audio,
        monitor_enabled,
        vad_sensitivity,
        segmentation,
        sources: config_sources,
        mic_source: config_mic_source,
        mic_enabled: config_mic_enabled,
    } = config;
    let sidecar_config = worker_sidecar_config(&translation_env, bundled.as_ref());
    // Attach to an already-running live sidecar when one exists (separated
    // live shares models with the main session); otherwise spawn fresh.
    let shared_process = pool
        .as_ref()
        .and_then(|inner| inner.lock().ok())
        .and_then(|slot| slot.as_ref()?.upgrade());
    let mut supervisor = match shared_process {
        Some(shared) => match SidecarSupervisor::attach(&shared) {
            Ok(supervisor) => supervisor,
            Err(error) => {
                let _ = ready.send(Err(error.to_string()));
                return;
            }
        },
        None => match SidecarSupervisor::start(&sidecar_config) {
            Ok(supervisor) => {
                if let Some(inner) = pool.as_ref() {
                    if let Ok(mut slot) = inner.lock() {
                        *slot = Some(Arc::downgrade(supervisor.shared_process()));
                    }
                }
                supervisor
            }
            Err(error) => {
                let _ = ready.send(Err(error.to_string()));
                return;
            }
        },
    };
    let detail = match supervisor.start_live(
        &source_mode,
        &provider,
        &asr_provider,
        &translation_provider,
        &target_language,
        &resource_profile,
        vad_sensitivity,
        &segmentation,
    ) {
        Ok(detail) => detail,
        Err(error) => {
            let _ = ready.send(Err(error.to_string()));
            return;
        }
    };
    // Multi-source sessions: tell the sidecar which sources exist so every
    // caption gets stamped with its own tag/color/language profile. The
    // user's mic stream is registered too (its capture is gated separately).
    let mut registry_sources = config_sources.clone();
    if let Some(mic_source) = &config_mic_source {
        registry_sources.push(mic_source.clone());
    }
    if !registry_sources.is_empty() {
        if let Err(error) = push_live_registry(&mut supervisor, &registry_sources) {
            let _ = ready.send(Err(error.to_string()));
            return;
        }
    }
    let started = LiveStarted {
        provider: detail
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&provider)
            .to_owned(),
        asr_model: detail
            .get("asr_model")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .to_owned(),
        asr_runtime: detail
            .get("asr_runtime")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("cpu/int8")
            .to_owned(),
        translation_runtime: detail
            .get("translation_runtime")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("cpu/int8")
            .to_owned(),
        source_mode: source_mode.clone(),
        target_language: target_language.clone(),
        resource_profile: resource_profile.clone(),
    };
    if ready.send(Ok(started)).is_err() {
        return;
    }

    // Mid-session transport failures (the sidecar crashed — the usual cause
    // of a Windows "forcibly closed by remote host" 10054 reset — or the
    // socket was dropped) are recovered exactly once: restart the sidecar,
    // re-run `live.start`, and resume capture. The UI keeps its "listening"
    // state; a Warning explains the hiccup. A second transport failure, or
    // any other error, is fatal.
    let mut attempts = 0u32;
    let result = loop {
        let run_result: Result<(), LiveLoopError> = {
            #[cfg(target_os = "windows")]
            {
                run_windows_live_loop(
                    &config_sources,
                    endpoint_name.clone(),
                    loopback,
                    monitor_enabled,
                    playback_endpoint_name.clone(),
                    config_mic_source.as_ref(),
                    &config_mic_enabled,
                    &stop,
                    &events,
                    &mut supervisor,
                )
            }
            #[cfg(target_os = "macos")]
            {
                run_macos_live_loop(
                    &config_sources,
                    endpoint_name.clone(),
                    loopback,
                    system_audio,
                    monitor_enabled,
                    playback_endpoint_name.clone(),
                    config_mic_source.as_ref(),
                    &config_mic_enabled,
                    &stop,
                    &events,
                    &mut supervisor,
                )
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                run_development_live_loop(&stop, &events, &mut supervisor)
            }
        };
        match run_result {
            Err(LiveLoopError::Supervisor(error))
                if attempts == 0 && error.is_transport_failure() =>
            {
                attempts += 1;
                let detail = match supervisor.child_exit_status() {
                    Some(status) => format!("sidecar crashed (exit {status})"),
                    None => format!("connection dropped: {error}"),
                };
                // Native crashes (faulthandler dumps, onnxruntime aborts) leave
                // a stderr trace; include it so failures self-report.
                let tail = supervisor.stderr_tail();
                let crash_trace = if tail.is_empty() {
                    String::new()
                } else {
                    format!(
                        " Sidecar stderr:\n{}",
                        tail.iter().map(|line| format!("  {line}")).collect::<Vec<_>>().join("\n")
                    )
                };
                let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                    "live translation hiccup: {detail}.{crash_trace} Restarting the local \
                     inference session automatically…"
                )));
                match supervisor.restart().and_then(|_| {
                    // The restart spawned a fresh process; re-register it so
                    // other sessions attach to the new one.
                    if let Some(inner) = pool.as_ref() {
                        if let Ok(mut slot) = inner.lock() {
                            *slot = Some(Arc::downgrade(supervisor.shared_process()));
                        }
                    }
                    supervisor
                        .start_live(
                            &source_mode,
                            &provider,
                            &asr_provider,
                            &translation_provider,
                            &target_language,
                            &resource_profile,
                            vad_sensitivity,
                            &segmentation,
                        )
                        .and_then(|_| {
                            if config_sources.is_empty() {
                                Ok(())
                            } else {
                                push_live_registry(&mut supervisor, &config_sources)
                            }
                        })
                }) {
                    Ok(_) => continue,
                    Err(restart_error) => {
                        break Err(LiveLoopError::Supervisor(restart_error));
                    }
                }
            }
            outcome => break outcome,
        }
    };

    if let Err(error) = result {
        let _ = events.send(LiveWorkerEvent::Error(friendly_live_error(&error)));
    }
    let _ = supervisor.stop_live();
    let _ = events.try_send(LiveWorkerEvent::Stopped);
}

/// Map raw platform errors to actionable messages. The most common failure
/// on Windows is opening an endpoint that another app (VALORANT/Discord
/// voice chat, games) holds in exclusive mode — WASAPI refuses the second
/// client with AUDCLNT_E_DEVICE_IN_USE and cpal surfaces it as
/// "…already in use". The VB-CABLE route (capturing CABLE Output) avoids
/// this because the virtual device is never opened exclusively.
fn friendly_live_error(error: &LiveLoopError) -> String {
    let raw = error.to_string();
    let lower = raw.to_ascii_lowercase();
    if lower.contains("in use") || lower.contains("exclusive") {
        "The audio device is in exclusive use by another app (the game or \
         voice chat usually). Stop it, or use the VB-CABLE route for voice \
         chat captions: route the game's voice chat output to CABLE Input \
         and capture CABLE Output on the Live page."
            .to_owned()
    } else {
        raw
    }
}

/// Errors from the live capture/supervisor loop. `Supervisor` errors carry
/// the original `SupervisorError` so the worker can tell transport failures
/// (restartable) from protocol/live errors (fatal); audio and UI-channel
/// failures are plain messages.
enum LiveLoopError {
    Supervisor(SupervisorError),
    Audio(String),
    Endpoint(String),
}

impl std::fmt::Display for LiveLoopError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LiveLoopError::Supervisor(error) => write!(formatter, "{error}"),
            LiveLoopError::Audio(detail) | LiveLoopError::Endpoint(detail) => {
                formatter.write_str(detail)
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn run_windows_live_loop(
    config_sources: &[LiveSource],
    endpoint_name: String,
    loopback: bool,
    monitor_enabled: bool,
    playback_endpoint_name: Option<String>,
    mic_source: Option<&LiveSource>,
    mic_enabled: &Arc<AtomicBool>,
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), LiveLoopError> {
    // The user's mic stream lives on the same session: when configured, route
    // through the multi-source loop (with the classic endpoint synthesized as
    // a team source) so both captures share one loop and one sequence.
    let effective_sources: Vec<LiveSource> = if !config_sources.is_empty() {
        config_sources.to_vec()
    } else if mic_source.is_some() {
        vec![LiveSource {
            source_id: "00000000000000000000000000000001".to_owned(),
            endpoint_name: endpoint_name.clone(),
            loopback,
            display_name: "Team".to_owned(),
            caption_tag: "TEAM".to_owned(),
            language_profile: String::new(),
            strictness: "balanced".to_owned(),
            label_style: "brackets".to_owned(),
            color: None,
            priority: 100,
            source_origin: ipc_protocol::DEFAULT_SOURCE_ORIGIN.to_owned(),
            language_config: None,
            target_language: None,
            translation_provider: None,
        }]
    } else {
        Vec::new()
    };
    if !effective_sources.is_empty() {
        return run_windows_multi_source_loop(
            &effective_sources,
            mic_source,
            mic_enabled,
            stop,
            events,
            supervisor,
        );
    }
    let capture = if loopback {
        audio_core::WindowsAudioCapture::start_loopback(&endpoint_name, 32)
            .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
    } else {
        audio_core::WindowsAudioCapture::start(&endpoint_name, 32)
            .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
    };
    let mut playback = if monitor_enabled {
        let Some(name) = playback_endpoint_name.as_deref() else {
            return Err(LiveLoopError::Endpoint(
                "monitoring output endpoint is missing".to_owned(),
            ));
        };
        Some(audio_core::WindowsAudioPlayback::start(name, 32)
            .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?)
    } else {
        None
    };
    let mut resampler = StreamingLinearResampler::new(capture.format().sample_rate, 16_000)
        .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
    let mut monitor_resampler = playback
        .as_ref()
        .map(|playback| {
            StreamingLinearResampler::new(
                capture.format().sample_rate,
                playback.format().sample_rate,
            )
        })
        .transpose()
        .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
    let mut metrics = LiveMetrics::default();
    let mut last_metrics = Instant::now();
    // Stall detection only begins once the first frame has been delivered:
    // some endpoints take a moment to start producing buffers, so counting
    // silence before the first frame would false-positive on a slow warmup.
    let mut last_frame_at: Option<Instant> = None;
    let mut stall_warned = false;
    loop {
        if stop.try_recv().is_ok() {
            return Ok(());
        }
        match capture.try_next().map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))? {
            Some(frame) => {
                last_frame_at = Some(Instant::now());
                stall_warned = false;
                metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                metrics.capture_drops = capture.dropped_frames();
                metrics.capture_peak = frame
                    .samples
                    .iter()
                    .fold(0.0f32, |peak, sample| peak.max(sample.abs()));
                if let Some(playback) = playback.as_mut() {
                    metrics.monitor_drops = playback.dropped_frames();
                    metrics.monitor_underrun_samples = playback.underrun_samples();
                    // monitor_resampler is guaranteed to be Some when playback
                    // is Some, but the borrow checker cannot see through it, so
                    // take+refill the resampler pair locally.
                    if let Some(resampler) = monitor_resampler.as_mut() {
                        let monitor_samples = resampler.process(&frame.samples);
                        if !monitor_samples.is_empty() {
                            playback.try_write(monitor_samples);
                        }
                    }
                }
                let samples = resampler.process(&frame.samples);
                if !samples.is_empty() {
                    supervisor
                        .send_live_audio(frame.capture_monotonic_ns, samples)
                        .map_err(LiveLoopError::Supervisor)?;
                    metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                }
            }
            None => thread::sleep(Duration::from_millis(4)),
        }
        // Always drain captions/errors, even while capture is quiet: a
        // `live.error` from the sidecar must not sit unread inside the
        // stalled-capture branch, or the session would hang "listening" with
        // no visible failure.
        drain_live_captions(supervisor, events, &mut metrics)?;
        // A quiet channel is normal (silence still delivers frames), so no
        // frames for a while means the device truly stopped — e.g. the game
        // grabbed the endpoint in exclusive mode, or the device went away.
        // Warn once instead of killing the session: capture can resume on its
        // own (exclusive mode is released, device reconnects), and the loop
        // clears the warning as soon as audio flows again.
        if let Some(since) = last_frame_at {
            if since.elapsed() >= Duration::from_secs(10) && !stall_warned {
                stall_warned = true;
                let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                    "audio capture stalled: no frames for {:.1}s. The endpoint may have \
                     been disconnected, disabled, or taken over by another app in \
                     exclusive mode. The session keeps listening and recovers \
                     automatically when audio returns.",
                    since.elapsed().as_secs_f32()
                )));
            }
        }
        if last_metrics.elapsed() >= Duration::from_millis(500) {
            let _ = events.try_send(LiveWorkerEvent::Metrics(metrics.clone()));
            last_metrics = Instant::now();
        }
    }
}

/// Multi-source capture loop (Windows): one capture per configured source,
/// each frame tagged with its `source_id` so the sidecar VADs/translates it
/// independently and stamps captions with the source's tag. Monitoring is
/// not available in this mode (rejected at live start).
#[cfg(target_os = "windows")]
fn run_windows_multi_source_loop(
    config_sources: &[LiveSource],
    mic_source: Option<&LiveSource>,
    mic_enabled: &Arc<AtomicBool>,
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), LiveLoopError> {
    struct ActiveSource {
        source: LiveSource,
        capture: audio_core::WindowsAudioCapture,
        resampler: StreamingLinearResampler,
    }
    let mut sources = Vec::with_capacity(config_sources.len());
    for source in config_sources {
        let capture = if source.loopback {
            audio_core::WindowsAudioCapture::start_loopback(&source.endpoint_name, 32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
        } else {
            audio_core::WindowsAudioCapture::start(&source.endpoint_name, 32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
        };
        let resampler = StreamingLinearResampler::new(capture.format().sample_rate, 16_000)
            .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
        sources.push(ActiveSource {
            source: source.clone(),
            capture,
            resampler,
        });
    }
    // The user's mic capture is opened lazily: the mic button flips
    // `mic_enabled`, and this loop opens/closes the device around it so no
    // audio is captured while the mic is off.
    let mut mic_capture: Option<(audio_core::WindowsAudioCapture, StreamingLinearResampler)> = None;
    let mut metrics = LiveMetrics::default();
    let mut last_metrics = Instant::now();
    let mut last_frame_at: Option<Instant> = None;
    let mut stall_warned = false;
    loop {
        if stop.try_recv().is_ok() {
            return Ok(());
        }
        if mic_enabled.load(Ordering::Relaxed) && mic_capture.is_none() {
            if let Some(mic) = mic_source {
                match audio_core::WindowsAudioCapture::start(&mic.endpoint_name, 32) {
                    Ok(capture) => {
                        let resampler = StreamingLinearResampler::new(
                            capture.format().sample_rate,
                            16_000,
                        )
                        .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
                        mic_capture = Some((capture, resampler));
                    }
                    Err(error) => {
                        let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                            "could not open the microphone: {}",
                            audio_error_to_string(error)
                        )));
                    }
                }
            }
        } else if !mic_enabled.load(Ordering::Relaxed) {
            mic_capture = None; // dropping the capture stops the device
        }
        let mut any_frame = false;
        for active in sources.iter_mut() {
            match active
                .capture
                .try_next()
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
            {
                Some(frame) => {
                    any_frame = true;
                    metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                    metrics.capture_drops = active.capture.dropped_frames();
                    let samples = active.resampler.process(&frame.samples);
                    if !samples.is_empty() {
                        supervisor
                            .send_live_audio_for_source(
                                frame.capture_monotonic_ns,
                                &active.source.source_id,
                                samples,
                            )
                            .map_err(LiveLoopError::Supervisor)?;
                        metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                    }
                }
                None => {}
            }
        }
        if let Some((capture, resampler)) = mic_capture.as_mut() {
            if let Some(mic_source) = mic_source {
                if let Some(frame) = capture
                    .try_next()
                    .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
                {
                    any_frame = true;
                    metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                    let samples = resampler.process(&frame.samples);
                    if !samples.is_empty() {
                        supervisor
                            .send_live_audio_for_source(
                                frame.capture_monotonic_ns,
                                &mic_source.source_id,
                                samples,
                            )
                            .map_err(LiveLoopError::Supervisor)?;
                        metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                    }
                }
            }
        }
        if any_frame {
            last_frame_at = Some(Instant::now());
            stall_warned = false;
        } else {
            thread::sleep(Duration::from_millis(4));
        }
        drain_live_captions(supervisor, events, &mut metrics)?;
        if let Some(since) = last_frame_at {
            if since.elapsed() >= Duration::from_secs(10) && !stall_warned {
                stall_warned = true;
                let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                    "audio capture stalled: no frames for {:.1}s. The endpoint may have \
                     been disconnected, disabled, or taken over by another app in \
                     exclusive mode. The session keeps listening and recovers \
                     automatically when audio returns.",
                    since.elapsed().as_secs_f32()
                )));
            }
        }
        if last_metrics.elapsed() >= Duration::from_millis(500) {
            let _ = events.try_send(LiveWorkerEvent::Metrics(metrics.clone()));
            last_metrics = Instant::now();
        }
    }
}

/// Unified capture surface for the macOS live loop: cpal (mic / BlackHole
/// input) or ScreenCaptureKit (system audio mix). Both expose the same
/// bounded-channel read API, so the loop body is source-agnostic.
#[cfg(target_os = "macos")]
enum MacosLiveCapture {
    CoreAudio(audio_core::MacosAudioCapture),
    SystemAudio(audio_core::MacosSystemAudioCapture),
}

#[cfg(target_os = "macos")]
impl MacosLiveCapture {
    fn try_next(&self) -> Result<Option<audio_core::AudioFrame>, audio_core::AudioError> {
        match self {
            MacosLiveCapture::CoreAudio(capture) => capture.try_next(),
            MacosLiveCapture::SystemAudio(capture) => capture.try_next(),
        }
    }

    fn dropped_frames(&self) -> u64 {
        match self {
            MacosLiveCapture::CoreAudio(capture) => capture.dropped_frames(),
            MacosLiveCapture::SystemAudio(capture) => capture.dropped_frames(),
        }
    }

    fn frames_received(&self) -> u64 {
        match self {
            MacosLiveCapture::CoreAudio(_) => 0,
            MacosLiveCapture::SystemAudio(capture) => capture.frames_received(),
        }
    }

    fn format(&self) -> audio_core::AudioFormat {
        match self {
            MacosLiveCapture::CoreAudio(capture) => capture.format(),
            MacosLiveCapture::SystemAudio(capture) => capture.format(),
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(clippy::too_many_arguments)]
fn run_macos_live_loop(
    config_sources: &[LiveSource],
    endpoint_name: String,
    loopback: bool,
    system_audio: bool,
    monitor_enabled: bool,
    playback_endpoint_name: Option<String>,
    mic_source: Option<&LiveSource>,
    mic_enabled: &Arc<AtomicBool>,
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), LiveLoopError> {
    let effective_sources: Vec<LiveSource> = if !config_sources.is_empty() {
        config_sources.to_vec()
    } else if mic_source.is_some() {
        vec![LiveSource {
            source_id: "00000000000000000000000000000001".to_owned(),
            endpoint_name: endpoint_name.clone(),
            loopback,
            display_name: "Team".to_owned(),
            caption_tag: "TEAM".to_owned(),
            language_profile: String::new(),
            strictness: "balanced".to_owned(),
            label_style: "brackets".to_owned(),
            color: None,
            priority: 100,
            source_origin: ipc_protocol::DEFAULT_SOURCE_ORIGIN.to_owned(),
            language_config: None,
            target_language: None,
            translation_provider: None,
        }]
    } else {
        Vec::new()
    };
    if !effective_sources.is_empty() {
        return run_macos_multi_source_loop(
            &effective_sources,
            mic_source,
            mic_enabled,
            stop,
            events,
            supervisor,
        );
    }
    let capture = if system_audio {
        MacosLiveCapture::SystemAudio(
            audio_core::MacosSystemAudioCapture::start(32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?,
        )
    } else if loopback {
        MacosLiveCapture::CoreAudio(
            audio_core::MacosAudioCapture::start_loopback(&endpoint_name, 32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?,
        )
    } else {
        MacosLiveCapture::CoreAudio(
            audio_core::MacosAudioCapture::start(&endpoint_name, 32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?,
        )
    };
    let mut playback = if monitor_enabled {
        let Some(name) = playback_endpoint_name.as_deref() else {
            return Err(LiveLoopError::Endpoint(
                "monitoring output endpoint is missing".to_owned(),
            ));
        };
        Some(audio_core::MacosAudioPlayback::start(name, 32)
            .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?)
    } else {
        None
    };
    let mut resampler = StreamingLinearResampler::new(capture.format().sample_rate, 16_000)
        .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
    let mut monitor_resampler = playback
        .as_ref()
        .map(|playback| {
            StreamingLinearResampler::new(
                capture.format().sample_rate,
                playback.format().sample_rate,
            )
        })
        .transpose()
        .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
    let mut metrics = LiveMetrics::default();
    let mut last_metrics = Instant::now();
    // Stall detection only begins once the first frame has been delivered:
    // some endpoints take a moment to start producing buffers, so counting
    // silence before the first frame would false-positive on a slow warmup.
    let mut last_frame_at: Option<Instant> = None;
    // ScreenCaptureKit "system audio" starts up but delivers NOTHING when the
    // app lacks Screen Recording permission (silent TCC denial — the stream
    // itself does not error). cpal captures deliver buffers even in silence,
    // so zero buffers after a grace period is definitive, not a quiet room.
    let started_at = Instant::now();
    let mut stall_warned = false;
    loop {
        if stop.try_recv().is_ok() {
            return Ok(());
        }
        if system_audio
            && capture.frames_received() == 0
            && started_at.elapsed() >= Duration::from_secs(4)
        {
            return Err(LiveLoopError::Endpoint(
                "System Audio received no audio from ScreenCaptureKit. macOS is \
                 not letting this app capture the output mix — grant Screen Recording \
                 permission to yTRSLT in System Settings > Privacy & Security > \
                 Screen Recording (add/check it, then restart the app), or switch to \
                 a BlackHole loopback source instead."
                    .to_owned(),
            ));
        }
        match capture.try_next().map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))? {
            Some(frame) => {
                last_frame_at = Some(Instant::now());
                stall_warned = false;
                metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                metrics.capture_drops = capture.dropped_frames();
                if let Some(playback) = playback.as_mut() {
                    metrics.monitor_drops = playback.dropped_frames();
                    metrics.monitor_underrun_samples = playback.underrun_samples();
                    if let Some(resampler) = monitor_resampler.as_mut() {
                        let monitor_samples = resampler.process(&frame.samples);
                        if !monitor_samples.is_empty() {
                            playback.try_write(monitor_samples);
                        }
                    }
                }
                let samples = resampler.process(&frame.samples);
                if !samples.is_empty() {
                    supervisor
                        .send_live_audio(frame.capture_monotonic_ns, samples)
                        .map_err(LiveLoopError::Supervisor)?;
                    metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                }
            }
            None => thread::sleep(Duration::from_millis(4)),
        }
        // Always drain captions/errors, even while capture is quiet: a
        // `live.error` from the sidecar must not sit unread inside the
        // stalled-capture branch, or the session would hang "listening" with
        // no visible failure.
        drain_live_captions(supervisor, events, &mut metrics)?;
        // Non-fatal stall: warn once, keep listening, recover automatically.
        if let Some(since) = last_frame_at {
            if since.elapsed() >= Duration::from_secs(10) && !stall_warned {
                stall_warned = true;
                let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                    "audio capture stalled: no frames for {:.1}s. The endpoint may have \
                     been disconnected, disabled, or taken over by another app in \
                     exclusive mode. The session keeps listening and recovers \
                     automatically when audio returns.",
                    since.elapsed().as_secs_f32()
                )));
            }
        }
        if last_metrics.elapsed() >= Duration::from_millis(500) {
            let _ = events.try_send(LiveWorkerEvent::Metrics(metrics.clone()));
            last_metrics = Instant::now();
        }
    }
}

/// Multi-source capture loop (macOS): mirror of the Windows variant using
/// the CoreAudio capture type.
#[cfg(target_os = "macos")]
fn run_macos_multi_source_loop(
    config_sources: &[LiveSource],
    mic_source: Option<&LiveSource>,
    mic_enabled: &Arc<AtomicBool>,
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), LiveLoopError> {
    struct ActiveSource {
        source: LiveSource,
        capture: audio_core::MacosAudioCapture,
        resampler: StreamingLinearResampler,
    }
    let mut sources = Vec::with_capacity(config_sources.len());
    for source in config_sources {
        let capture = if source.loopback {
            audio_core::MacosAudioCapture::start_loopback(&source.endpoint_name, 32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
        } else {
            audio_core::MacosAudioCapture::start(&source.endpoint_name, 32)
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
        };
        let resampler = StreamingLinearResampler::new(capture.format().sample_rate, 16_000)
            .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
        sources.push(ActiveSource {
            source: source.clone(),
            capture,
            resampler,
        });
    }
    // The user's mic capture opens/closes around the mic button flag, same
    // as the Windows loop: no mic audio is captured while the toggle is off.
    let mut mic_capture: Option<(audio_core::MacosAudioCapture, StreamingLinearResampler)> = None;
    let mut metrics = LiveMetrics::default();
    let mut last_metrics = Instant::now();
    let mut last_frame_at: Option<Instant> = None;
    let mut stall_warned = false;
    loop {
        if stop.try_recv().is_ok() {
            return Ok(());
        }
        if mic_enabled.load(Ordering::Relaxed) && mic_capture.is_none() {
            if let Some(mic) = mic_source {
                match audio_core::MacosAudioCapture::start(&mic.endpoint_name, 32) {
                    Ok(capture) => {
                        let resampler = StreamingLinearResampler::new(
                            capture.format().sample_rate,
                            16_000,
                        )
                        .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?;
                        mic_capture = Some((capture, resampler));
                    }
                    Err(error) => {
                        let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                            "could not open the microphone: {}",
                            audio_error_to_string(error)
                        )));
                    }
                }
            }
        } else if !mic_enabled.load(Ordering::Relaxed) {
            mic_capture = None;
        }
        let mut any_frame = false;
        for active in sources.iter_mut() {
            match active
                .capture
                .try_next()
                .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
            {
                Some(frame) => {
                    any_frame = true;
                    metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                    metrics.capture_drops = active.capture.dropped_frames();
                    let samples = active.resampler.process(&frame.samples);
                    if !samples.is_empty() {
                        supervisor
                            .send_live_audio_for_source(
                                frame.capture_monotonic_ns,
                                &active.source.source_id,
                                samples,
                            )
                            .map_err(LiveLoopError::Supervisor)?;
                        metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                    }
                }
                None => {}
            }
        }
        if let Some((capture, resampler)) = mic_capture.as_mut() {
            if let Some(mic_source) = mic_source {
                if let Some(frame) = capture
                    .try_next()
                    .map_err(|error| LiveLoopError::Audio(audio_error_to_string(error)))?
                {
                    any_frame = true;
                    metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                    let samples = resampler.process(&frame.samples);
                    if !samples.is_empty() {
                        supervisor
                            .send_live_audio_for_source(
                                frame.capture_monotonic_ns,
                                &mic_source.source_id,
                                samples,
                            )
                            .map_err(LiveLoopError::Supervisor)?;
                        metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                    }
                }
            }
        }
        if any_frame {
            last_frame_at = Some(Instant::now());
            stall_warned = false;
        } else {
            thread::sleep(Duration::from_millis(4));
        }
        drain_live_captions(supervisor, events, &mut metrics)?;
        if let Some(since) = last_frame_at {
            if since.elapsed() >= Duration::from_secs(10) && !stall_warned {
                stall_warned = true;
                let _ = events.try_send(LiveWorkerEvent::Warning(format!(
                    "audio capture stalled: no frames for {:.1}s. The endpoint may have \
                     been disconnected, disabled, or taken over by another app in \
                     exclusive mode. The session keeps listening and recovers \
                     automatically when audio returns.",
                    since.elapsed().as_secs_f32()
                )));
            }
        }
        if last_metrics.elapsed() >= Duration::from_millis(500) {
            let _ = events.try_send(LiveWorkerEvent::Metrics(metrics.clone()));
            last_metrics = Instant::now();
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn run_development_live_loop(
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), LiveLoopError> {
    let started = Instant::now();
    let mut packet = 0_u64;
    let mut metrics = LiveMetrics::default();
    let mut last_metrics = Instant::now();
    loop {
        if stop.try_recv().is_ok() {
            return Ok(());
        }
        let cycle = packet % 32;
        let amplitude = if cycle < 24 { 0.08 } else { 0.0 };
        let samples = vec![amplitude; 1_600];
        let capture_ns = u64::try_from(started.elapsed().as_nanos()).unwrap_or(u64::MAX);
        supervisor
            .send_live_audio(capture_ns, samples)
            .map_err(LiveLoopError::Supervisor)?;
        metrics.captured_frames = metrics.captured_frames.saturating_add(1);
        metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
        drain_live_captions(supervisor, events, &mut metrics)?;
        packet = packet.saturating_add(1);
        if last_metrics.elapsed() >= Duration::from_millis(500) {
            let _ = events.try_send(LiveWorkerEvent::Metrics(metrics.clone()));
            last_metrics = Instant::now();
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn drain_live_captions(
    supervisor: &mut SidecarSupervisor,
    events: &SyncSender<LiveWorkerEvent>,
    metrics: &mut LiveMetrics,
) -> Result<(), LiveLoopError> {
    loop {
        match supervisor.read_live_caption(Duration::from_millis(1)) {
            Ok(Some(envelope)) => {
                metrics.captions_received = metrics.captions_received.saturating_add(1);
                events
                    .send(LiveWorkerEvent::Caption(Box::new(envelope.payload)))
                    .map_err(|_| {
                        LiveLoopError::Endpoint("live UI event receiver disconnected".to_owned())
                    })?;
            }
            Ok(None) => return Ok(()),
            // The sidecar flagged the failure as recoverable: it skipped a
            // caption but the session is alive. Surface it as a warning and
            // keep listening instead of tearing the session down.
            Err(SupervisorError::LiveInferenceRecoverable(message)) => {
                events
                    .send(LiveWorkerEvent::Warning(format!(
                        "live translation hiccup (recoverable): {message}"
                    )))
                    .map_err(|_| {
                        LiveLoopError::Endpoint("live UI event receiver disconnected".to_owned())
                    })?;
            }
            Err(error) => return Err(LiveLoopError::Supervisor(error)),
        }
    }
}

fn live_snapshot(state: &mut LiveRuntimeState) -> LiveSnapshot {
    let mut pending = Vec::new();
    if let Some(events) = &state.events {
        while let Ok(event) = events.try_recv() {
            pending.push(event);
        }
    }
    let mut captions = Vec::new();
    for event in pending {
        match event {
            LiveWorkerEvent::Caption(caption) => captions.push(*caption),
            LiveWorkerEvent::Metrics(metrics) => state.metrics = metrics,
            LiveWorkerEvent::Warning(warning) => state.warning = Some(warning),
            LiveWorkerEvent::Error(error) => {
                state.error = Some(error);
                state.stopped = true;
            }
            LiveWorkerEvent::Stopped => state.stopped = true,
        }
    }
    if state
        .worker
        .as_ref()
        .is_some_and(std::thread::JoinHandle::is_finished)
    {
        state.stopped = true;
    }
    let started = state.started.as_ref();
    LiveSnapshot {
        state: if state.error.is_some() {
            "error"
        } else if state.worker.is_some() && !state.stopped {
            "listening"
        } else {
            "stopped"
        },
        provider: started.map(|item| item.provider.clone()),
        asr_model: started.map(|item| item.asr_model.clone()),
        asr_runtime: started.map(|item| item.asr_runtime.clone()),
        translation_runtime: started.map(|item| item.translation_runtime.clone()),
        source_mode: started.map(|item| item.source_mode.clone()),
        target_language: started.map(|item| item.target_language.clone()),
        resource_profile: started.map(|item| item.resource_profile.clone()),
        metrics: state.metrics.clone(),
        captions,
        error: state.error.clone(),
        warning: state.warning.clone(),
        mic_enabled: state.mic_source.is_some() && state.mic_enabled.load(Ordering::Relaxed),
    }
}

fn cleanup_live_worker(state: &mut LiveRuntimeState) {
    if let Some(stop) = state.stop.take() {
        let _ = stop.try_send(());
    }
    if let Some(worker) = state.worker.take() {
        let _ = worker.join();
    }
    state.events = None;
    state.started = None;
    state.stopped = true;
}

impl Drop for LiveRuntime {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            cleanup_live_worker(&mut state);
        }
    }
}

fn create_runtime() -> AudioRuntime {
    #[cfg(target_os = "windows")]
    {
        AudioRuntime {
            state: Mutex::new(AudioRuntimeState::default()),
            watcher: Mutex::new(audio_core::WindowsDeviceWatcher::start(32).ok()),
        }
    }
    #[cfg(target_os = "macos")]
    {
        AudioRuntime {
            state: Mutex::new(AudioRuntimeState::default()),
            watcher: Mutex::new(audio_core::MacosDeviceWatcher::start(32).ok()),
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        AudioRuntime::default()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetTranslationEnvRequest {
    /// Pairs of (name, value). Empty value removes the variable.
    pairs: Vec<(String, String)>,
}

#[tauri::command]
fn set_translation_env(
    request: SetTranslationEnvRequest,
    runtime: tauri::State<'_, TranslationApiRuntime>,
) -> Result<(), String> {
    const ALLOWED: &[&str] = &[
        "LST_GROQ_API_KEY",
        "LST_NVIDIA_API_KEY",
        "LST_LT_ENDPOINT",
        "LST_LT_API_KEY",
        "LST_CUSTOM_TX_ENDPOINT",
        "LST_CUSTOM_TX_API_KEY",
        "LST_BAIDU_APPID",
        "LST_BAIDU_SECRET",
    ];
    let mut env = runtime.env.lock().map_err(lock_error)?;
    for (name, value) in request.pairs {
        if !ALLOWED.contains(&name.as_str()) {
            continue;
        }
        if value.is_empty() {
            env.retain(|(n, _)| n != &name);
        } else {
            if let Some(slot) = env.iter_mut().find(|(n, _)| n == &name) {
                slot.1 = value;
            } else {
                env.push((name, value));
            }
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(create_runtime())
        .manage(RoutingRuntime::default())
        .manage(SidecarRuntime::default())
        .manage(LiveRuntime::default())
        .manage(SeparateLiveRuntime::default())
        .manage(SidecarPool::default())
        .manage(TranslationApiRuntime::default())
        .setup(|app| {
            let models_dir = resolve_models_dir(app.handle());
            app.manage(ModelRuntime::new(models_dir));
            app.manage(SidecarPaths {
                bundled: resolve_bundled_paths(app.handle()),
            });
            // Closing the main window must kill the whole app — sidecar,
            // overlay window, audio threads — not just hide the window and
            // leave the process running in the background.
            if let Some(control) = app.get_webview_window("control") {
                let handle = app.handle().clone();
                control.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        handle.exit(0);
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            app_status,
            audio_endpoints,
            start_audio_meter,
            audio_meter_snapshot,
            stop_audio_meter,
            start_synthetic_routing,
            synthetic_routing_snapshot,
            set_synthetic_monitor_volume,
            stop_synthetic_routing,
            start_fake_sidecar,
            fake_inference_roundtrip,
            fake_multi_source_roundtrip,
            stop_fake_sidecar,
            start_live_translation,
            start_separated_live_translation,
            live_translation_snapshot,
            separated_live_translation_snapshot,
            set_live_mic_enabled,
            stop_live_translation,
            stop_separated_live_translation,
            set_translation_env,
            analyze_clip,
            clip_compare,
            translate_text,
            apply_window_shell,
            models_list,
            models_install,
            models_install_from_url,
            models_cancel_install,
            models_delete,
            models_download_endpoint,
            models_set_download_endpoint,
            models_providers,
            models_import_offline_pack,
            gpu_runtime_status,
            gpu_runtime_install,
            gpu_runtime_cancel,
            gpu_runtime_delete,
            reveal_path,
            set_overlay_mode,
            open_screen_recording_settings,
            open_microphone_settings,
            request_microphone_permission,
            microphone_auth_status
        ])
        .run(tauri::generate_context!());

    if result.is_err() {
        eprintln!("desktop application terminated with an error");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use audio_core::{AudioSource, SYNTHETIC_ENDPOINT_ID};

    use super::{
        AppStatus, AudioRuntimeState, KNOWN_MODELS, LiveLoopError, friendly_live_error,
        model_dir_exists,
    };

    #[test]
    fn exclusive_mode_capture_failure_gets_actionable_message() {
        let message = friendly_live_error(&LiveLoopError::Audio(
            "An audio endpoint device is already in use".to_owned(),
        ));
        assert!(message.contains("VB-CABLE"));
        assert!(message.contains("exclusive use"));
        // Non-audio errors pass through unchanged.
        let raw = friendly_live_error(&LiveLoopError::Endpoint("boom".to_owned()));
        assert_eq!(raw, "boom");
    }

    #[test]
    fn known_models_are_catalog_free_but_detected_from_disk() {
        let root = std::env::temp_dir().join(format!("lst-known-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(
            root.join("artifacts")
                .join("ncspeech-tl-fastconformer-hybrid-large"),
        )
        .unwrap();
        std::fs::write(
            root.join("artifacts")
                .join("ncspeech-tl-fastconformer-hybrid-large")
                .join("manifest.json"),
            "{}",
        )
        .unwrap();

        // The exported (artifacts/) layout is detected.
        assert!(model_dir_exists(
            &root,
            "ncspeech-tl-fastconformer-hybrid-large"
        ));
        // The catalog layout is also detected.
        assert!(!model_dir_exists(&root, "ncspeech-zh-citrinet-1024-gamma"));
        std::fs::create_dir_all(root.join("ncspeech-zh-citrinet-1024-gamma")).unwrap();
        std::fs::write(
            root.join("ncspeech-zh-citrinet-1024-gamma")
                .join("manifest.json"),
            "{}",
        )
        .unwrap();
        assert!(model_dir_exists(&root, "ncspeech-zh-citrinet-1024-gamma"));

        // The known set carries the three NCSpeech variants.
        assert_eq!(KNOWN_MODELS.len(), 3);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn phase_five_status_defaults_to_capture_off() {
        let state = AudioRuntimeState::default();
        assert_eq!(
            AppStatus {
                phase: 5,
                capture_active: state.selected_endpoint_id.is_some(),
                inference_active: false,
                multi_source: true,
                caption_trust: true,
            },
            AppStatus {
                phase: 5,
                capture_active: false,
                inference_active: false,
                multi_source: true,
                caption_trust: true,
            }
        );
    }

    #[test]
    fn synthetic_runtime_stops_deterministically() {
        let mut state = AudioRuntimeState::default();
        state
            .synthetic
            .start(SYNTHETIC_ENDPOINT_ID)
            .expect("source should start");
        state
            .synthetic
            .stop()
            .expect("source should stop without waiting");
        assert!(state.synthetic.next_frame().is_err());
    }
}
