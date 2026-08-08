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
    AudioDeviceID, AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize,
    AudioObjectPropertyAddress, kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyDeviceName,
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
    SYSTEM_AUDIO_ENDPOINT_ID,
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
/// Fetch a CoreAudio object property's raw bytes.
///
/// The size query goes through `AudioObjectGetPropertyDataSize`: the older
/// "AudioObjectGetPropertyData with NULL outData" size-query pattern returns
/// `kAudioHardwareUnsupportedOperationError` ('nope') for the hardware device
/// list on recent macOS, which silently empties the endpoint catalog.
///
/// # Safety
/// Callers must hold no conflicting access to the returned buffer's memory.
unsafe fn property_data(
    device_id: AudioDeviceID,
    address: &AudioObjectPropertyAddress,
) -> Result<Vec<u8>, i32> {
    let mut size: u32 = 0;
    // SAFETY: `size` is a valid u32 buffer for the returned size.
    let status = unsafe {
        AudioObjectGetPropertyDataSize(device_id, address, 0, std::ptr::null(), &mut size)
    };
    if status != 0 || size == 0 {
        return Err(status);
    }
    let mut buffer = vec![0_u8; size as usize];
    // SAFETY: `buffer` is exactly `size` bytes of writable memory.
    let status = unsafe {
        AudioObjectGetPropertyData(
            device_id,
            address,
            0,
            std::ptr::null(),
            &mut size,
            buffer.as_mut_ptr() as *mut c_void,
        )
    };
    if status != 0 {
        return Err(status);
    }
    Ok(buffer)
}

/// Read a string-valued CoreAudio device property (UID, name). Returns `None`
/// when the property is absent or not valid UTF-8.
fn get_string_property(device_id: AudioDeviceID, selector: u32) -> Option<String> {
    let address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    // SAFETY: `property_data` only touches freshly allocated local memory.
    let buffer = unsafe { property_data(device_id, &address) }.ok()?;
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
    // SAFETY: `property_data` only touches freshly allocated local memory.
    let Ok(buffer) = (unsafe { property_data(device_id, &address) }) else {
        return false;
    };
    buffer.first().copied().unwrap_or(0) != 0
}

/// True when the device exposes at least one stream on the given scope.
fn device_has_scope_streams(device_id: AudioDeviceID, scope: u32) -> bool {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioDevicePropertyStreams,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMaster,
    };
    // SAFETY: `property_data` only touches freshly allocated local memory.
    let Ok(buffer) = (unsafe { property_data(device_id, &address) }) else {
        return false;
    };
    buffer.len() / mem::size_of::<AudioDeviceID>() > 0
}

fn system_default_device(selector: u32) -> Option<AudioDeviceID> {
    let address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    // SAFETY: `property_data` only touches freshly allocated local memory.
    let buffer = unsafe { property_data(kAudioObjectSystemObject, &address) }.ok()?;
    let bytes: [u8; 4] = buffer.get(..4)?.try_into().ok()?;
    let device = u32::from_ne_bytes(bytes);
    if device != 0 { Some(device) } else { None }
}

fn all_device_ids() -> Vec<AudioDeviceID> {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    };
    // SAFETY: `property_data` only touches freshly allocated local memory.
    let Ok(buffer) = (unsafe { property_data(kAudioObjectSystemObject, &address) }) else {
        return Vec::new();
    };
    if buffer.len() % mem::size_of::<AudioDeviceID>() != 0 {
        return Vec::new();
    }
    buffer
        .chunks_exact(mem::size_of::<AudioDeviceID>())
        .map(|chunk| u32::from_ne_bytes(chunk.try_into().expect("chunk is 4 bytes")))
        .collect()
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
            // Wire id: CoreAudio numeric device ids are NOT stable across
            // sessions (virtual devices churn the numbering), which made
            // persisted selections fail with EndpointNotFound. The friendly
            // name is stable, and cpal resolves capture by name anyway. The
            // "(output)" suffix keeps capture/render ids distinct (BlackHole
            // exposes both scopes).
            let capture_id = name.clone();
            let render_id = format!("{name} (output)");
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
                    id: capture_id,
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
                    id: render_id,
                    friendly_name: name,
                    kind: EndpointKind::Render,
                    state,
                    default_roles: roles,
                    native_format: None,
                    is_synthetic: false,
                });
            }
        }
        // ScreenCaptureKit system-audio pseudo-endpoint: taps the system
        // output mix (voice chat included) with no virtual device to install
        // and no routing to configure — the fix for "I can't find the audio
        // source" on macOS. Kind is Capture so the UI groups it with
        // loopback-style sources; the live loop special-cases it by id.
        endpoints.push(AudioEndpoint {
            id: SYSTEM_AUDIO_ENDPOINT_ID.to_owned(),
            friendly_name: "System Audio (all apps)".to_owned(),
            kind: EndpointKind::Capture,
            state: EndpointState::Active,
            default_roles: DefaultRoles::default(),
            native_format: Some(AudioFormat {
                sample_rate: SCK_AUDIO_SAMPLE_RATE,
                channels: 1,
            }),
            is_synthetic: false,
        });
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

/// Sample rate requested from ScreenCaptureKit. SCK honors the configured
/// rate for captured system audio; 48 kHz matches the app's inference path.
const SCK_AUDIO_SAMPLE_RATE: u32 = 48_000;

/// Capture the system audio output mix via ScreenCaptureKit (macOS 13+).
///
/// Unlike [`MacosAudioCapture`], no virtual device (BlackHole) and no manual
/// routing are needed: the OS taps the aggregate output mix, so voice chat
/// audio is captured regardless of which output device the game uses. The
/// system shows the screen-recording permission prompt on first start.
///
/// The SCStream delivers Float32 audio sample buffers on its own dispatch
/// queue; we downmix to mono and push into the same bounded-channel surface
/// as the cpal capture, so the desktop live loop is source-agnostic.
pub struct MacosSystemAudioCapture {
    _stream: screencapturekit::stream::SCStream,
    frames: Receiver<AudioFrame>,
    dropped_frames: Arc<AtomicU64>,
    /// Count of audio sample buffers delivered by ScreenCaptureKit. The live
    /// loop uses this to distinguish "silent but healthy" from "capture
    /// silently broken" (typically missing Screen Recording permission, which
    /// makes SCK start without ever delivering audio).
    frames_received: Arc<AtomicU64>,
    format: AudioFormat,
}

impl MacosSystemAudioCapture {
    pub fn start(queue_capacity: usize) -> Result<Self, AudioError> {
        if queue_capacity == 0 {
            return Err(AudioError::InvalidQueueCapacity);
        }
        use screencapturekit::prelude::*;

        let content = SCShareableContent::get().map_err(|error| {
            AudioError::Platform(format!("ScreenCaptureKit content query failed: {error}"))
        })?;
        let display =
            content.displays().first().cloned().ok_or_else(|| {
                AudioError::Platform("ScreenCaptureKit found no displays".to_owned())
            })?;
        // No windows are excluded: the filter exists only to anchor the
        // stream to a display; we never consume video frames.
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();
        let config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_sample_rate(SCK_AUDIO_SAMPLE_RATE as i32)
            .with_channel_count(2);
        let (sender, frames) = mpsc::sync_channel(queue_capacity);
        let dropped_frames = Arc::new(AtomicU64::new(0));
        let frames_received = Arc::new(AtomicU64::new(0));
        let callback_drops = Arc::clone(&dropped_frames);
        let callback_received = Arc::clone(&frames_received);
        let sequence = Arc::new(AtomicU64::new(0));
        let captured_samples = Arc::new(AtomicU64::new(0));
        let mut stream = SCStream::new(&filter, &config);
        let handler_id = stream.add_output_handler(
            move |sample: CMSampleBuffer, output_type| {
                if output_type != SCStreamOutputType::Audio {
                    return;
                }
                callback_received.fetch_add(1, Ordering::Relaxed);
                let Some(mono) = extract_sck_audio(&sample) else {
                    return;
                };
                if mono.is_empty() {
                    return;
                }
                // First sample index of this buffer → start-of-frame timestamp
                // in nanoseconds, matching the cpal capture convention.
                let start = captured_samples.fetch_add(
                    u64::try_from(mono.len()).unwrap_or(u64::MAX),
                    Ordering::Relaxed,
                );
                let timestamp_ns =
                    start.saturating_mul(1_000_000_000) / u64::from(SCK_AUDIO_SAMPLE_RATE);
                let frame = AudioFrame {
                    sequence: sequence.fetch_add(1, Ordering::Relaxed),
                    capture_monotonic_ns: timestamp_ns,
                    sample_rate: SCK_AUDIO_SAMPLE_RATE,
                    channels: 1,
                    samples: mono,
                };
                if sender.try_send(frame).is_err() {
                    callback_drops.fetch_add(1, Ordering::Relaxed);
                }
            },
            SCStreamOutputType::Audio,
        );
        if handler_id.is_none() {
            return Err(AudioError::Platform(
                "ScreenCaptureKit rejected the audio output handler".to_owned(),
            ));
        }
        stream.start_capture().map_err(|error| {
            AudioError::Platform(format!(
                "ScreenCaptureKit could not start system audio (grant Screen \
                 Recording permission to yTRSLT in System Settings > Privacy & \
                 Security if prompted): {error}"
            ))
        })?;
        Ok(Self {
            _stream: stream,
            frames,
            dropped_frames,
            frames_received,
            format: AudioFormat {
                sample_rate: SCK_AUDIO_SAMPLE_RATE,
                channels: 1,
            },
        })
    }

    /// Total audio buffers delivered by ScreenCaptureKit since start, whether
    /// or not they made it into the bounded channel.
    #[must_use]
    pub fn frames_received(&self) -> u64 {
        self.frames_received.load(Ordering::Relaxed)
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

/// Downmix one ScreenCaptureKit audio sample buffer to mono f32.
///
/// SCK delivers Float32 PCM. The layout is either a single interleaved
/// buffer (`AudioBuffer.number_channels > 1`) or one non-interleaved buffer
/// per channel (`AudioBufferList.num_buffers() == channels`); both shapes
/// are handled. Returns `None` when the buffer carries no audio.
fn extract_sck_audio(sample: &screencapturekit::cm::CMSampleBuffer) -> Option<Vec<f32>> {
    use screencapturekit::prelude::CMSampleBufferExt;
    let list = sample.audio_buffer_list()?;
    match list.num_buffers() {
        0 => None,
        1 => {
            let buffer = list.get(0)?;
            let channels = usize::try_from(buffer.number_channels).unwrap_or(1).max(1);
            Some(downmix_interleaved(buffer.data(), channels))
        }
        _ => {
            let channel_data = list.iter().map(|buffer| buffer.data()).collect::<Vec<_>>();
            Some(downmix_separate(&channel_data))
        }
    }
}

/// Decode little-endian f32 PCM bytes and downmix to mono. Handles both
/// mono (`channels == 1`, passthrough) and interleaved multi-channel data.
fn downmix_interleaved(data: &[u8], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return data
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("4-byte chunk")))
            .collect();
    }
    let mut mono = Vec::with_capacity(data.len() / 4 / channels);
    for frame in data.chunks_exact(4 * channels).map(|chunk| {
        chunk
            .chunks_exact(4)
            .map(|sample| f32::from_le_bytes(sample.try_into().expect("4-byte chunk")))
            .sum::<f32>()
    }) {
        mono.push(frame / channels as f32);
    }
    mono
}

/// Sum per-channel f32 PCM byte slices position-wise into mono, normalized by
/// the channel count. Ragged buffers are truncated to the shortest channel.
fn downmix_separate(channel_data: &[&[u8]]) -> Vec<f32> {
    let frame_count = channel_data
        .iter()
        .map(|data| data.len() / 4)
        .min()
        .unwrap_or(0);
    let mut mono = vec![0.0_f32; frame_count];
    let channel_count = channel_data.len().max(1) as f32;
    for data in channel_data {
        for (index, chunk) in data.chunks_exact(4).take(frame_count).enumerate() {
            mono[index] += f32::from_le_bytes(chunk.try_into().expect("4-byte chunk"));
        }
    }
    for sample in &mut mono {
        *sample /= channel_count;
    }
    mono
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

    #[test]
    fn catalog_includes_system_audio_endpoint() {
        let endpoints = MacosEndpointCatalog::enumerate().unwrap();
        let system_audio = endpoints
            .iter()
            .find(|endpoint| endpoint.id == SYSTEM_AUDIO_ENDPOINT_ID);
        assert!(
            system_audio.is_some(),
            "system-audio endpoint must be enumerated on macOS"
        );
        let endpoint = system_audio.unwrap();
        assert_eq!(endpoint.kind, EndpointKind::Capture);
        assert_eq!(endpoint.state, EndpointState::Active);
        assert_eq!(
            endpoint.native_format,
            Some(AudioFormat {
                sample_rate: SCK_AUDIO_SAMPLE_RATE,
                channels: 1,
            })
        );
    }

    #[test]
    fn downmix_mono_bytes_passes_through() {
        let data = [1.0_f32, -0.5, 0.25].map(f32::to_le_bytes).concat();
        let mono = downmix_interleaved(&data, 1);
        assert_eq!(mono, vec![1.0, -0.5, 0.25]);
    }

    #[test]
    fn downmix_interleaved_stereo_averages_channels() {
        let data = [(1.0_f32, 0.0_f32), (-0.5, -0.5), (0.0, 2.0)]
            .iter()
            .flat_map(|(left, right)| [left.to_le_bytes(), right.to_le_bytes()].concat())
            .collect::<Vec<_>>();
        let mono = downmix_interleaved(&data, 2);
        assert_eq!(mono, vec![0.5, -0.5, 1.0]);
    }

    #[test]
    fn downmix_separate_channels_sums_and_normalizes() {
        let left = [0.5_f32, -1.0, 0.25].map(f32::to_le_bytes).concat();
        let right = [0.5_f32, 1.0, 0.25].map(f32::to_le_bytes).concat();
        let mono = downmix_separate(&[&left, &right]);
        assert_eq!(mono, vec![0.5, 0.0, 0.25]);
    }

    #[test]
    fn downmix_separate_truncates_to_shortest_channel() {
        let left = [0.5_f32, -1.0, 0.25, 9.0].map(f32::to_le_bytes).concat();
        let right = [0.5_f32, 1.0].map(f32::to_le_bytes).concat();
        let mono = downmix_separate(&[&left, &right]);
        assert_eq!(mono, vec![0.5, 0.0]);
    }
}
