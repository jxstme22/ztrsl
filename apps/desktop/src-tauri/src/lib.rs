#![deny(unsafe_op_in_unsafe_fn)]

use std::sync::Mutex;

use audio_core::{
    AtomicLevelMeter, AudioEndpoint, AudioError, AudioFormat, AudioMonitor, AudioRouter,
    AudioSource, EndpointKind, EndpointState, LevelSnapshot, RoutingMetrics, SYNTHETIC_ENDPOINT_ID,
    SYNTHETIC_MONITOR_ENDPOINT_ID, SyntheticAudioMonitor, SyntheticAudioSource,
    synthetic_monitor_endpoint, validate_route,
};
use ipc_protocol::{CaptionPayload, ClipResultPayload, Envelope};
use serde::Serialize;
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

#[derive(Default)]
struct SidecarRuntime {
    supervisor: Mutex<Option<SidecarSupervisor>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatus {
    state: &'static str,
    provider: &'static str,
    restartable: bool,
}

#[tauri::command]
fn app_status(
    runtime: tauri::State<'_, AudioRuntime>,
    sidecar: tauri::State<'_, SidecarRuntime>,
) -> AppStatus {
    let capture_active = runtime
        .state
        .lock()
        .map(|state| state.selected_endpoint_id.is_some())
        .unwrap_or(false);
    AppStatus {
        phase: 5,
        capture_active,
        inference_active: sidecar
            .supervisor
            .lock()
            .map(|supervisor| supervisor.is_some())
            .unwrap_or(false),
    }
}

#[tauri::command]
fn analyze_clip(
    path: String,
    source_mode: String,
    provider: String,
    runtime: tauri::State<'_, SidecarRuntime>,
) -> Result<ClipResultPayload, String> {
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
    supervisor
        .as_mut()
        .expect("sidecar was started above")
        .process_clip(std::path::Path::new(&path), &source_mode, &provider)
        .map_err(|error| error.to_string())
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
        return Ok(EndpointCatalog {
            platform: "windows",
            endpoints,
            device_change_detected,
        });
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
        return Ok(LevelSnapshot {
            sequence: state.sequence,
            peak,
            rms: peak,
            clipped: peak >= 1.0,
            dropped_frames: 0,
        });
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(create_runtime())
        .manage(RoutingRuntime::default())
        .manage(SidecarRuntime::default())
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
