#![deny(unsafe_op_in_unsafe_fn)]

use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use audio_core::StreamingLinearResampler;
use audio_core::{
    AtomicLevelMeter, AudioEndpoint, AudioError, AudioFormat, AudioMonitor, AudioRouter,
    AudioSource, EndpointKind, EndpointState, LevelSnapshot, RoutingMetrics, SYNTHETIC_ENDPOINT_ID,
    SYNTHETIC_MONITOR_ENDPOINT_ID, SyntheticAudioMonitor, SyntheticAudioSource, validate_route,
};
use ipc_protocol::{CaptionPayload, ClipResultPayload, Envelope};
use serde::{Deserialize, Serialize};
use sidecar_supervisor::{SidecarConfig, SidecarSupervisor, workspace_root_from_manifest};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    phase: u8,
    capture_active: bool,
    inference_active: bool,
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

#[derive(Default)]
struct AudioRuntime {
    state: Mutex<AudioRuntimeState>,
    #[cfg(target_os = "windows")]
    watcher: Mutex<Option<audio_core::WindowsDeviceWatcher>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EndpointCatalog {
    platform: &'static str,
    endpoints: Vec<AudioEndpoint>,
    device_change_detected: bool,
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
    source_mode: String,
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
    /// ASR backend: "local"/"whisper-turbo" (large-v3-turbo), "whisper-full"
    /// (large-v3), "ncspeech" (NVIDIA FastConformer Tagalog), or "groq-whisper".
    #[serde(default)]
    asr_provider: String,
    /// Translation backend: "madlad" (local), "libretranslate",
    /// "google-translate", "mymemory", "custom-http".
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
}

fn default_vad_sensitivity() -> u8 {
    50
}

struct LiveWorkerConfig {
    endpoint_name: String,
    /// `Some(name)` when monitoring is enabled, otherwise `None`.
    playback_endpoint_name: Option<String>,
    source_mode: String,
    provider: String,
    asr_provider: String,
    translation_provider: String,
    resource_profile: String,
    /// True when the selected endpoint is a Render endpoint captured via WASAPI
    /// shared-mode loopback rather than a microphone capture stream.
    loopback: bool,
    monitor_enabled: bool,
    vad_sensitivity: u8,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveSnapshot {
    state: &'static str,
    provider: Option<String>,
    asr_model: Option<String>,
    source_mode: Option<String>,
    resource_profile: Option<String>,
    metrics: LiveMetrics,
    captions: Vec<CaptionPayload>,
    error: Option<String>,
}

enum LiveWorkerEvent {
    Caption(CaptionPayload),
    Metrics(LiveMetrics),
    Error(String),
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
    stopped: bool,
}

#[derive(Default)]
struct LiveRuntime {
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
        phase: 5,
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
    }
}

#[tauri::command]
async fn start_live_translation(
    request: LiveStartRequest,
    audio: tauri::State<'_, AudioRuntime>,
    sidecar: tauri::State<'_, SidecarRuntime>,
    live: tauri::State<'_, LiveRuntime>,
    translation_api: tauri::State<'_, TranslationApiRuntime>,
) -> Result<LiveSnapshot, String> {
let LiveStartRequest {
        endpoint_id,
        playback_endpoint_id,
        source_mode,
        provider,
        asr_provider,
        translation_provider,
        resource_profile,
        monitor_enabled,
        vad_sensitivity,
    } = request;
    if source_mode != "filipino" && source_mode != "chinese" {
        return Err("V1 live mode supports Filipino or Chinese only".to_owned());
    }
    if !matches!(provider.as_str(), "demo" | "local" | "http") {
        return Err("live provider must be demo, local, or http".to_string());
    }
    if !matches!(
        asr_provider.as_str(),
        "local" | "whisper-turbo" | "whisper-full" | "ncspeech" | "groq-whisper"
    ) {
        return Err(format!("unknown ASR provider: {asr_provider}"));
    }
    if !matches!(
        translation_provider.as_str(),
        "madlad" | "libretranslate" | "google-translate" | "mymemory" | "custom-http"
    ) {
        return Err(format!("unknown translation provider: {translation_provider}"));
    }
    // Any remote provider (Groq ASR or an HTTP translation backend) implies the
    // "http" mode so the sidecar keeps the demo flag off and routes through the
    // configured remote provider.
    let provider = if asr_provider == "groq-whisper"
        || translation_provider != "madlad"
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
    let endpoints = platform_endpoints(&audio)?;
    let endpoint = endpoints
        .iter()
        .find(|candidate| candidate.id == endpoint_id)
        .ok_or_else(|| AudioError::EndpointNotFound.to_string())?;
    if endpoint.state != EndpointState::Active {
        return Err(AudioError::EndpointInvalidated.to_string());
    }
    // A Capture endpoint captures a microphone; a Render endpoint is opened in
    // WASAPI shared-mode loopback to capture the game/teammates mix being
    // played through that render endpoint (e.g. headphones or speakers).
    let loopback = match endpoint.kind {
        EndpointKind::Capture => false,
        EndpointKind::Render => true,
    };

    let playback_endpoint_name = if monitor_enabled {
        let raw_playback_id = playback_endpoint_id.as_deref().unwrap_or("").trim();
        if raw_playback_id.is_empty() {
            return Err("monitoring output endpoint is required when monitoring is enabled"
                .to_owned());
        }
        let playback_endpoint = endpoints
            .iter()
            .find(|candidate| candidate.id == raw_playback_id)
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

    let state = Arc::clone(&live.state);
    let sidecar = Arc::clone(&sidecar.supervisor);
    let translation_api = Arc::clone(&translation_api.env);
    let endpoint_name = endpoint.friendly_name.clone();
    let worker_config = LiveWorkerConfig {
        endpoint_name,
        playback_endpoint_name,
        source_mode,
        provider,
        asr_provider,
        translation_provider,
        resource_profile,
        loopback,
        monitor_enabled,
        vad_sensitivity,
    };
    tauri::async_runtime::spawn_blocking(move || {
        start_live_translation_blocking(
            worker_config,
            state,
            sidecar,
            translation_api,
        )
    })
    .await
    .map_err(|error| format!("live start worker failed: {error}"))?
}

fn start_live_translation_blocking(
    worker_config: LiveWorkerConfig,
    live: Arc<Mutex<LiveRuntimeState>>,
    sidecar: Arc<Mutex<Option<SidecarSupervisor>>>,
    translation_api: Arc<Mutex<Vec<(String, String)>>>,
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
    let worker = thread::Builder::new()
        .name("live-translation".to_owned())
        .spawn(move || {
            run_live_worker(
                worker_config,
                stop_rx,
                event_tx,
                ready_tx,
                Arc::clone(&translation_api),
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
    state.stopped = false;
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
fn live_translation_snapshot(live: tauri::State<'_, LiveRuntime>) -> Result<LiveSnapshot, String> {
    let mut state = live.state.lock().map_err(lock_error)?;
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
async fn stop_live_translation(
    live: tauri::State<'_, LiveRuntime>,
) -> Result<LiveSnapshot, String> {
    let state = Arc::clone(&live.state);
    tauri::async_runtime::spawn_blocking(move || stop_live_translation_blocking(state))
        .await
        .map_err(|error| format!("live stop worker failed: {error}"))?
}

fn stop_live_translation_blocking(
    live: Arc<Mutex<LiveRuntimeState>>,
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
    Ok(live_snapshot(&mut state))
}

#[tauri::command]
async fn analyze_clip(
    path: String,
    source_mode: String,
    provider: String,
    runtime: tauri::State<'_, SidecarRuntime>,
) -> Result<ClipResultPayload, String> {
    let supervisor = Arc::clone(&runtime.supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        analyze_clip_blocking(supervisor, path, source_mode, provider)
    })
    .await
    .map_err(|error| format!("clip worker failed: {error}"))?
}

fn analyze_clip_blocking(
    runtime: Arc<Mutex<Option<SidecarSupervisor>>>,
    path: String,
    source_mode: String,
    provider: String,
) -> Result<ClipResultPayload, String> {
    let mut supervisor = runtime.lock().map_err(lock_error)?;
    let needs_restart = supervisor
        .as_mut()
        .is_some_and(|running| running.ensure_running().is_err());
    if needs_restart {
        let _ = supervisor.take();
    }
    if supervisor.is_none() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
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
            let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
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
        })
    }

    #[cfg(not(target_os = "windows"))]
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
fn start_fake_sidecar(runtime: tauri::State<'_, SidecarRuntime>) -> Result<SidecarStatus, String> {
    let mut supervisor = runtime.supervisor.lock().map_err(lock_error)?;
    let needs_restart = supervisor
        .as_mut()
        .is_some_and(|running| running.ensure_running().is_err());
    if needs_restart {
        let _ = supervisor.take();
    }
    if supervisor.is_none() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
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

    #[cfg(not(target_os = "windows"))]
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
    #[cfg(not(target_os = "windows"))]
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

fn audio_error_to_string(error: AudioError) -> String {
    error.to_string()
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("audio runtime state is unavailable: {error}")
}

fn worker_sidecar_config(
    translation_env: &Arc<Mutex<Vec<(String, String)>>>,
) -> SidecarConfig {
    let mut config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
    if let Ok(env) = translation_env.lock() {
        config.extra_env = env.clone();
    }
    config
}

fn run_live_worker(
    config: LiveWorkerConfig,
    stop: Receiver<()>,
    events: SyncSender<LiveWorkerEvent>,
    ready: SyncSender<Result<LiveStarted, String>>,
    translation_env: Arc<Mutex<Vec<(String, String)>>>,
) {
    let LiveWorkerConfig {
        endpoint_name,
        playback_endpoint_name,
        source_mode,
        provider,
        asr_provider,
        translation_provider,
        resource_profile,
        loopback,
        monitor_enabled,
        vad_sensitivity,
    } = config;
    let sidecar_config = worker_sidecar_config(&translation_env);
    let mut supervisor = match SidecarSupervisor::start(&sidecar_config) {
        Ok(supervisor) => supervisor,
        Err(error) => {
            let _ = ready.send(Err(error.to_string()));
            return;
        }
    };
    let detail = match supervisor.start_live(
        &source_mode,
        &provider,
        &asr_provider,
        &translation_provider,
        &resource_profile,
        vad_sensitivity,
    ) {
        Ok(detail) => detail,
        Err(error) => {
            let _ = ready.send(Err(error.to_string()));
            return;
        }
    };
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
        source_mode,
        resource_profile,
    };
    if ready.send(Ok(started)).is_err() {
        return;
    }

    #[cfg(target_os = "windows")]
    let result = run_windows_live_loop(
        endpoint_name,
        loopback,
        monitor_enabled,
        playback_endpoint_name,
        &stop,
        &events,
        &mut supervisor,
    );
    #[cfg(not(target_os = "windows"))]
    let result = run_development_live_loop(&stop, &events, &mut supervisor);
    #[cfg(not(target_os = "windows"))]
    let _ = endpoint_name;
    #[cfg(not(target_os = "windows"))]
    let _ = playback_endpoint_name;
    #[cfg(not(target_os = "windows"))]
    let _ = loopback;
    #[cfg(not(target_os = "windows"))]
    let _ = monitor_enabled;

    if let Err(error) = result {
        let _ = events.send(LiveWorkerEvent::Error(error));
    }
    let _ = supervisor.stop_live();
    let _ = events.try_send(LiveWorkerEvent::Stopped);
}

#[cfg(target_os = "windows")]
fn run_windows_live_loop(
    endpoint_name: String,
    loopback: bool,
    monitor_enabled: bool,
    playback_endpoint_name: Option<String>,
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), String> {
    let capture = if loopback {
        audio_core::WindowsAudioCapture::start_loopback(&endpoint_name, 32)
            .map_err(audio_error_to_string)?
    } else {
        audio_core::WindowsAudioCapture::start(&endpoint_name, 32)
            .map_err(audio_error_to_string)?
    };
    let mut playback = if monitor_enabled {
        let Some(name) = playback_endpoint_name.as_deref() else {
            return Err("monitoring output endpoint is missing".to_owned());
        };
        Some(
            audio_core::WindowsAudioPlayback::start(name, 32)
                .map_err(audio_error_to_string)?,
        )
    } else {
        None
    };
    let mut resampler = StreamingLinearResampler::new(capture.format().sample_rate, 16_000)
        .map_err(audio_error_to_string)?;
    let mut monitor_resampler = playback
        .as_ref()
        .map(|playback| {
            StreamingLinearResampler::new(
                capture.format().sample_rate,
                playback.format().sample_rate,
            )
        })
        .transpose()
        .map_err(audio_error_to_string)?;
    let mut metrics = LiveMetrics::default();
    let mut last_metrics = Instant::now();
    loop {
        if stop.try_recv().is_ok() {
            return Ok(());
        }
        match capture.try_next().map_err(audio_error_to_string)? {
            Some(frame) => {
                metrics.captured_frames = metrics.captured_frames.saturating_add(1);
                metrics.capture_drops = capture.dropped_frames();
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
                        .map_err(|error| error.to_string())?;
                    metrics.audio_packets_sent = metrics.audio_packets_sent.saturating_add(1);
                    drain_live_captions(supervisor, events, &mut metrics)?;
                }
            }
            None => thread::sleep(Duration::from_millis(4)),
        }
        if last_metrics.elapsed() >= Duration::from_millis(500) {
            let _ = events.try_send(LiveWorkerEvent::Metrics(metrics.clone()));
            last_metrics = Instant::now();
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn run_development_live_loop(
    stop: &Receiver<()>,
    events: &SyncSender<LiveWorkerEvent>,
    supervisor: &mut SidecarSupervisor,
) -> Result<(), String> {
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
            .map_err(|error| error.to_string())?;
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
) -> Result<(), String> {
    while let Some(envelope) = supervisor
        .read_live_caption(Duration::from_millis(1))
        .map_err(|error| error.to_string())?
    {
        metrics.captions_received = metrics.captions_received.saturating_add(1);
        events
            .send(LiveWorkerEvent::Caption(envelope.payload))
            .map_err(|_| "live UI event receiver disconnected".to_owned())?;
    }
    Ok(())
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
            LiveWorkerEvent::Caption(caption) => captions.push(caption),
            LiveWorkerEvent::Metrics(metrics) => state.metrics = metrics,
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
        source_mode: started.map(|item| item.source_mode.clone()),
        resource_profile: started.map(|item| item.resource_profile.clone()),
        metrics: state.metrics.clone(),
        captions,
        error: state.error.clone(),
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
    #[cfg(not(target_os = "windows"))]
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
        "LST_LT_ENDPOINT",
        "LST_LT_API_KEY",
        "LST_CUSTOM_TX_ENDPOINT",
        "LST_CUSTOM_TX_API_KEY",
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
        .manage(TranslationApiRuntime::default())
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
            stop_fake_sidecar,
            start_live_translation,
            live_translation_snapshot,
            stop_live_translation,
            set_translation_env,
            analyze_clip
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

    use super::{AppStatus, AudioRuntimeState};

    #[test]
    fn phase_five_status_defaults_to_capture_off() {
        let state = AudioRuntimeState::default();
        assert_eq!(
            AppStatus {
                phase: 5,
                capture_active: state.selected_endpoint_id.is_some(),
                inference_active: false,
            },
            AppStatus {
                phase: 5,
                capture_active: false,
                inference_active: false,
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
