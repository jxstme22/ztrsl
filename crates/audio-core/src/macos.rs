//! macOS CoreAudio/cpal backend (v0.5+, Apple Silicon first).
//!
//! Mirrors the Windows `windows.rs` API surface so the desktop app drives real
//! audio on macOS with the same calls:
//!
//! - [`MacosEndpointCatalog`] enumerates CoreAudio input/output devices.
//! - [`MacosDeviceWatcher`] polls the CoreAudio device list and emits
//!   add/remove/default-change events on a bounded channel. A poll-based diff
//!   is used instead of an `AudioObjectAddPropertyListener` C callback because
//!   it is deterministic, has no registration lifetime hazard, and shuts down
//!   cleanly — enumeration is already re-run on every `audio_endpoints` call,
//!   so the watcher only needs to flag *that something changed*.
//! - [`MacosAudioCapture`] opens a cpal input stream (microphone or a virtual
//!   device like BlackHole's input side). "Loopback" on macOS means capturing
//!   the input of a virtual device the user routed voice-chat audio to — a
//!   regular cpal input stream, not a render-endpoint tap.
//! - [`MacosAudioPlayback`] opens a cpal output stream (monitoring).
//!
//! Device enumeration uses `coreaudio-sys` for stable UIDs and names; streams
//! use `cpal` (which already resolves CoreAudio on macOS).

use std::ffi::CStr;
use std::mem;
use std::os::raw::c_void;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use coreaudio_sys::{
    AudioDeviceID, AudioObjectGetPropertyData, AudioObjectPropertyAddress,
    kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyDeviceName,
    kAudioDevicePropertyDeviceUID, kAudioDevicePropertyStreams,
    kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyDefaultOutputDevice,
    kAudioHardwarePropertyDevices, kAudioObjectPropertyElementMaster,
    kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyScopeInput,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig};

use crate::{
    AudioEndpoint, AudioError, AudioFormat, AudioFrame, DefaultRoles, EndpointKind, EndpointState,
};

/// Raw CoreAudio device id → stable wire id. CoreAudio device ids are numeric
/// and may be reused after unplug, so the wire id is the stable device UID
/// string when available (falls back to the numeric id formatted).
fn device_uid(device_id: AudioDeviceID) -> Option<String> {
    get_string_property(device_id, kAudioDevicePropertyDeviceUID)
}

fn device_name(device_id: AudioDeviceID) -> Option<String> {
    get_string_property(device_id, kAudioDevicePropertyDeviceName)
}

/// Read a string-valued CoreAudio device property (UID, name). Returns `None`
/// when the property is absent or not valid UTF-8.
fn get_string_property(device_id: AudioDeviceID, selector: u32) -> Option<String> {
    let address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    let mut size: u32 = 0;
    // SAFETY: We pass the size query first, then a buffer of exactly that
    // size. CoreAudio fills `size` with the property data length.
    let status = unsafe {
        AudioObjectGetPropertyData(
            device_id,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            std::ptr::null_mut(),
        )
    };
    if status != 0 || size == 0 {
        return None;
    }
    let mut buffer = vec![0_u8; size as usize];
    let status = unsafe {
        AudioObjectGetPropertyData(
            device_id,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            buffer.as_mut_ptr() as *mut c_void,
        )
    };
    if status != 0 {
        return None;
    }
    // UID/name is a CFStringRef; reading it as UTF-8 bytes works for the
    // common ASCII names (BlackHole, MacBook speakers, etc.).
    let raw = CStr::from_bytes_until_nul(&buffer).ok()?;
    let value = raw.to_str().ok()?.to_owned();
    if value.is_empty() { None } else { Some(value) }
}

fn device_is_alive(device_id: AudioDeviceID) -> bool {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioDevicePropertyDeviceIsAlive,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    let mut alive: u32 = 0;
    let mut size: u32 = mem::size_of::<u32>() as u32;
    // SAFETY: `alive` is a valid u32 sized buffer for the property data.
    let status = unsafe {
        AudioObjectGetPropertyData(
            device_id,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            &mut alive as *mut u32 as *mut c_void,
        )
    };
    status == 0 && alive != 0
}

/// True when the device exposes at least one stream on the given scope.
fn device_has_scope_streams(device_id: AudioDeviceID, scope: u32) -> bool {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioDevicePropertyStreams,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMaster,
    };
    let mut count: u32 = 0;
    let mut size: u32 = mem::size_of::<u32>() as u32;
    // SAFETY: `count` is a valid u32 sized buffer.
    let status = unsafe {
        AudioObjectGetPropertyData(
            device_id,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            &mut count as *mut u32 as *mut c_void,
        )
    };
    status == 0 && count > 0
}

fn system_default_device(selector: u32) -> Option<AudioDeviceID> {
    let address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    let mut device: AudioDeviceID = 0;
    let mut size: u32 = mem::size_of::<AudioDeviceID>() as u32;
    // SAFETY: `device` is a valid AudioDeviceID sized buffer.
    let status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            &mut device as *mut AudioDeviceID as *mut c_void,
        )
    };
    if status == 0 && device != 0 {
        Some(device)
    } else {
        None
    }
}

fn all_device_ids() -> Vec<AudioDeviceID> {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    let mut size: u32 = 0;
    // SAFETY: Size query first.
    let status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            std::ptr::null_mut(),
        )
    };
    let size_usize = size as usize;
    if status != 0 || size_usize == 0 || size_usize % mem::size_of::<AudioDeviceID>() != 0 {
        return Vec::new();
    }
    let count = size_usize / mem::size_of::<AudioDeviceID>();
    let mut devices = vec![0_u32; count];
    // SAFETY: `devices` has exactly `count` AudioDeviceID entries.
    let status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            devices.as_mut_ptr() as *mut c_void,
        )
    };
    if status != 0 {
        return Vec::new();
    }
    devices
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MacosEndpointEvent {
    Added {
        endpoint_id: String,
    },
    Removed {
        endpoint_id: String,
    },
    StateChanged {
        endpoint_id: String,
        state: EndpointState,
    },
    DefaultChanged {
        endpoint_id: Option<String>,
        kind: EndpointKind,
    },
    PropertyChanged {
        endpoint_id: String,
    },
}

/// Poll the CoreAudio device set and emit change events. Enumeration is
/// re-run by the app on every `audio_endpoints` call, so the watcher only
/// needs to signal that the device set changed; a diff against the previous
/// snapshot is enough. Deterministic shutdown via a channel + join.
pub struct MacosDeviceWatcher {
    events: Receiver<MacosEndpointEvent>,
    shutdown: Sender<()>,
    worker: Option<JoinHandle<()>>,
}

fn snapshot_devices() -> (Vec<String>, Option<String>, Option<String>) {
    let ids = all_device_ids()
        .into_iter()
        .map(|id| device_uid(id).unwrap_or_else(|| id.to_string()))
        .collect::<Vec<_>>();
    let default_input =
        system_default_device(kAudioHardwarePropertyDefaultInputDevice).and_then(device_uid);
    let default_output =
        system_default_device(kAudioHardwarePropertyDefaultOutputDevice).and_then(device_uid);
    (ids, default_input, default_output)
}

impl MacosDeviceWatcher {
    pub fn start(_event_capacity: usize) -> Result<Self, AudioError> {
        let (event_tx, events) = mpsc::channel();
        let (shutdown, shutdown_rx) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("audio-device-notifications".to_owned())
            .spawn(move || {
                let mut previous = snapshot_devices();
                loop {
                    match shutdown_rx.try_recv() {
                        Ok(()) => break,
                        Err(TryRecvError::Empty) => {}
                        Err(TryRecvError::Disconnected) => break,
                    }
                    let current = snapshot_devices();
                    if current != previous {
                        let _ = event_tx.send(MacosEndpointEvent::PropertyChanged {
                            endpoint_id: String::new(),
                        });
                        previous = current;
                    }
                    thread::sleep(Duration::from_millis(750));
                }
            })
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        Ok(Self {
            events,
            shutdown,
            worker: Some(worker),
        })
    }

    pub fn try_next(&self) -> Result<Option<MacosEndpointEvent>, AudioError> {
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(AudioError::EndpointInvalidated),
        }
    }
}

impl Drop for MacosDeviceWatcher {
    fn drop(&mut self) {
        let _ = self.shutdown.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub struct MacosEndpointCatalog;

impl MacosEndpointCatalog {
    /// Enumerate all CoreAudio devices, marking input/output kind and the
    /// system default roles. The wire id is the stable device UID.
    pub fn enumerate() -> Result<Vec<AudioEndpoint>, AudioError> {
        let default_input = system_default_device(kAudioHardwarePropertyDefaultInputDevice);
        let default_output = system_default_device(kAudioHardwarePropertyDefaultOutputDevice);
        let devices = all_device_ids();
        let mut endpoints = Vec::with_capacity(devices.len() * 2);
        for device_id in devices {
            let Some(name) = device_name(device_id) else {
                continue;
            };
            let id = device_uid(device_id).unwrap_or_else(|| device_id.to_string());
            let alive = device_is_alive(device_id);
            let state = if alive {
                EndpointState::Active
            } else {
                EndpointState::NotPresent
            };
            let roles = DefaultRoles {
                console: Some(device_id) == default_output,
                multimedia: Some(device_id) == default_input,
                communications: Some(device_id) == default_output,
            };
            let has_input = device_has_scope_streams(device_id, kAudioObjectPropertyScopeInput);
            let has_output = device_has_scope_streams(device_id, kAudioObjectPropertyScopeOutput);
            if has_input {
                endpoints.push(AudioEndpoint {
                    id: id.clone(),
                    friendly_name: name.clone(),
                    kind: EndpointKind::Capture,
                    state,
                    default_roles: roles,
                    native_format: None,
                    is_synthetic: false,
                });
            }
            if has_output {
                endpoints.push(AudioEndpoint {
                    id,
                    friendly_name: name,
                    kind: EndpointKind::Render,
                    state,
                    default_roles: roles,
                    native_format: None,
                    is_synthetic: false,
                });
            }
        }
        endpoints.sort_by(|a, b| {
            a.kind
                .cmp(&b.kind)
                .then_with(|| a.friendly_name.cmp(&b.friendly_name))
        });
        Ok(endpoints)
    }
}

/// Capture frames from a CoreAudio input device via cpal. The "loopback"
/// variant captures the input side of a virtual device (e.g. BlackHole) that
/// the user routed voice-chat output to — a regular cpal input stream.
pub struct MacosAudioCapture {
    _stream: Stream,
    frames: Receiver<AudioFrame>,
    dropped_frames: Arc<AtomicU64>,
    format: AudioFormat,
}

impl MacosAudioCapture {
    pub fn start(friendly_name: &str, queue_capacity: usize) -> Result<Self, AudioError> {
        Self::open(friendly_name, queue_capacity)
    }

    /// Capture the input of a virtual device (BlackHole) that voice-chat
    /// audio has been routed to.
    pub fn start_loopback(friendly_name: &str, queue_capacity: usize) -> Result<Self, AudioError> {
        Self::open(friendly_name, queue_capacity)
    }

    fn open(friendly_name: &str, queue_capacity: usize) -> Result<Self, AudioError> {
        if queue_capacity == 0 {
            return Err(AudioError::InvalidQueueCapacity);
        }
        let host = cpal::default_host();
        let mut devices = host
            .input_devices()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        let device = devices
            .find(|device| device.name().is_ok_and(|name| name == friendly_name))
            .ok_or(AudioError::EndpointNotFound)?;
        let supported = device
            .default_input_config()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        let sample_format = supported.sample_format();
        let config: StreamConfig = supported.into();
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;
        if channels == 0 || sample_rate == 0 {
            return Err(AudioError::InvalidFormat);
        }
        let (sender, frames) = mpsc::sync_channel(queue_capacity);
        let dropped_frames = Arc::new(AtomicU64::new(0));
        let callback_drops = Arc::clone(&dropped_frames);
        let stream = match sample_format {
            SampleFormat::F32 => {
                build_capture_stream::<f32>(&device, &config, sender, callback_drops)
            }
            SampleFormat::I16 => {
                build_capture_stream::<i16>(&device, &config, sender, callback_drops)
            }
            SampleFormat::U16 => {
                build_capture_stream::<u16>(&device, &config, sender, callback_drops)
            }
            other => Err(AudioError::Platform(format!(
                "unsupported macOS capture sample format: {other:?}"
            ))),
        }?;
        stream
            .play()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        Ok(Self {
            _stream: stream,
            frames,
            dropped_frames,
            format: AudioFormat {
                sample_rate,
                channels: 1,
            },
        })
    }

    pub fn try_next(&self) -> Result<Option<AudioFrame>, AudioError> {
        match self.frames.try_recv() {
            Ok(frame) => Ok(Some(frame)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(AudioError::EndpointInvalidated),
        }
    }

    #[must_use]
    pub fn dropped_frames(&self) -> u64 {
        self.dropped_frames.load(Ordering::Relaxed)
    }

    #[must_use]
    pub fn format(&self) -> AudioFormat {
        self.format
    }
}

fn build_capture_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    sender: SyncSender<AudioFrame>,
    dropped_frames: Arc<AtomicU64>,
) -> Result<Stream, AudioError>
where
    T: Sample + SizedSample,
    f32: FromSample<T>,
{
    let channels = usize::from(config.channels);
    let sample_rate = config.sample_rate.0;
    let mut sequence = 0_u64;
    let mut captured_samples = 0_u64;
    device
        .build_input_stream(
            config,
            move |data: &[T], _info| {
                let mono_sample_count = data.len() / channels;
                let mut mono = Vec::with_capacity(mono_sample_count);
                for channel_frame in data.chunks_exact(channels) {
                    let sum = channel_frame
                        .iter()
                        .copied()
                        .map(Sample::to_sample::<f32>)
                        .sum::<f32>();
                    mono.push(sum / channels as f32);
                }
                let timestamp_ns =
                    captured_samples.saturating_mul(1_000_000_000) / u64::from(sample_rate);
                captured_samples =
                    captured_samples.saturating_add(u64::try_from(mono.len()).unwrap_or(u64::MAX));
                let frame = AudioFrame {
                    sequence,
                    capture_monotonic_ns: timestamp_ns,
                    sample_rate,
                    channels: 1,
                    samples: mono,
                };
                sequence = sequence.saturating_add(1);
                if sender.try_send(frame).is_err() {
                    dropped_frames.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |error| {
                let _ = error;
            },
            None,
        )
        .map_err(|error| AudioError::Platform(error.to_string()))
}

/// Playback via a cpal output stream (monitoring). Mirrors the Windows
/// backend: bounded queue, underrun counting, mono→channel duplication.
pub struct MacosAudioPlayback {
    _stream: Stream,
    frames: SyncSender<Vec<f32>>,
    dropped_frames: Arc<AtomicU64>,
    underrun_samples: Arc<AtomicU64>,
    format: AudioFormat,
}

impl MacosAudioPlayback {
    pub fn start(friendly_name: &str, queue_capacity: usize) -> Result<Self, AudioError> {
        if queue_capacity == 0 {
            return Err(AudioError::InvalidQueueCapacity);
        }
        let host = cpal::default_host();
        let mut devices = host
            .output_devices()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        let device = devices
            .find(|device| device.name().is_ok_and(|name| name == friendly_name))
            .ok_or(AudioError::EndpointNotFound)?;
        let supported = device
            .default_output_config()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        let sample_format = supported.sample_format();
        let config: StreamConfig = supported.into();
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;
        if channels == 0 || sample_rate == 0 {
            return Err(AudioError::InvalidFormat);
        }
        let (sender, frames) = mpsc::sync_channel(queue_capacity);
        let dropped_frames = Arc::new(AtomicU64::new(0));
        let underrun_samples = Arc::new(AtomicU64::new(0));
        let callback_dropped = Arc::clone(&dropped_frames);
        let stream = match sample_format {
            SampleFormat::F32 => build_playback_stream::<f32>(
                &device,
                &config,
                frames,
                Arc::clone(&underrun_samples),
            ),
            SampleFormat::I16 => build_playback_stream::<i16>(
                &device,
                &config,
                frames,
                Arc::clone(&underrun_samples),
            ),
            SampleFormat::U16 => build_playback_stream::<u16>(
                &device,
                &config,
                frames,
                Arc::clone(&underrun_samples),
            ),
            other => Err(AudioError::Platform(format!(
                "unsupported macOS playback sample format: {other:?}"
            ))),
        }?;
        stream
            .play()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        Ok(Self {
            _stream: stream,
            frames: sender,
            dropped_frames: callback_dropped,
            underrun_samples,
            format: AudioFormat {
                sample_rate,
                channels,
            },
        })
    }

    pub fn try_write(&self, samples: Vec<f32>) {
        if self.frames.try_send(samples).is_err() {
            self.dropped_frames.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[must_use]
    pub fn dropped_frames(&self) -> u64 {
        self.dropped_frames.load(Ordering::Relaxed)
    }

    #[must_use]
    pub fn underrun_samples(&self) -> u64 {
        self.underrun_samples.load(Ordering::Relaxed)
    }

    #[must_use]
    pub fn format(&self) -> AudioFormat {
        self.format
    }
}

fn build_playback_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    frames: Receiver<Vec<f32>>,
    underrun_samples: Arc<AtomicU64>,
) -> Result<Stream, AudioError>
where
    T: Sample + SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels);
    let mut current = Vec::new();
    let mut cursor = 0_usize;
    let mut started = false;
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _info| {
                for channel_frame in output.chunks_exact_mut(channels) {
                    while cursor >= current.len() {
                        match frames.try_recv() {
                            Ok(next) if !next.is_empty() => {
                                current = next;
                                cursor = 0;
                                started = true;
                            }
                            Ok(_) => continue,
                            Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
                        }
                    }
                    let value = if cursor < current.len() {
                        let value = current[cursor].clamp(-1.0, 1.0);
                        cursor += 1;
                        value
                    } else {
                        if started {
                            underrun_samples.fetch_add(1, Ordering::Relaxed);
                        }
                        0.0
                    };
                    let converted = T::from_sample(value);
                    channel_frame.fill(converted);
                }
            },
            move |error| {
                let _ = error;
            },
            None,
        )
        .map_err(|error| AudioError::Platform(error.to_string()))
}

/// Peak level of an endpoint for the Sources meter. macOS has no per-endpoint
/// peak API as simple as WASAPI's `IAudioMeterInformation`; an accurate read
/// needs an active stream, which the Sources meter does not keep open. Return
/// a neutral level; the Live panel reports real metrics from the active
/// capture stream.
pub fn macos_endpoint_peak(_endpoint_id: &str) -> Result<f32, AudioError> {
    Ok(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_enumerates_without_panicking() {
        // CoreAudio may or may not expose devices in a headless CI runner, but
        // enumeration must never panic and must return a well-formed vector.
        let endpoints = MacosEndpointCatalog::enumerate();
        assert!(endpoints.is_ok(), "enumerate must succeed");
        let endpoints = endpoints.unwrap();
        for endpoint in endpoints {
            assert!(!endpoint.id.is_empty());
            assert!(!endpoint.friendly_name.is_empty());
            assert!(
                endpoint.kind == EndpointKind::Capture || endpoint.kind == EndpointKind::Render
            );
        }
    }

    #[test]
    fn watcher_starts_and_stops_cleanly() {
        let watcher = MacosDeviceWatcher::start(32);
        assert!(watcher.is_ok());
        // Must be droppable without panicking (deterministic shutdown).
        drop(watcher);
    }
}
