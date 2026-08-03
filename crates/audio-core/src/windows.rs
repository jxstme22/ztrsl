use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{PROPERTYKEY, RPC_E_CHANGED_MODE};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    DEVICE_STATE, DEVICE_STATE_ACTIVE, DEVICE_STATE_DISABLED, DEVICE_STATE_NOTPRESENT,
    DEVICE_STATE_UNPLUGGED, EDataFlow, ERole, IAudioCaptureClient, IAudioClient, IMMDevice,
    IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE, eCapture, eCommunications, eConsole, eMultimedia, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, STGM_READ,
};
use windows::core::PCWSTR;

use crate::{
    AudioEndpoint, AudioError, AudioFormat, AudioFrame, DefaultRoles, EndpointKind, EndpointState,
};

const ALL_DEVICE_STATES: DEVICE_STATE = DEVICE_STATE(
    DEVICE_STATE_ACTIVE.0
        | DEVICE_STATE_DISABLED.0
        | DEVICE_STATE_NOTPRESENT.0
        | DEVICE_STATE_UNPLUGGED.0,
);

struct ComApartment {
    uninitialize: bool,
}

impl ComApartment {
    fn initialize() -> Result<Self, AudioError> {
        // SAFETY: This initializes COM for the current worker/command thread and
        // the guard balances it with CoUninitialize on that same thread.
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result.is_ok() {
            return Ok(Self { uninitialize: true });
        }
        if result == RPC_E_CHANGED_MODE {
            // Tauri may have already initialized this command thread as an STA.
            // COM is usable, but this code must not balance someone else's init.
            return Ok(Self {
                uninitialize: false,
            });
        }
        Err(platform_error(result.into()))
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: Paired with the successful CoInitializeEx in `initialize`.
        if self.uninitialize {
            unsafe { CoUninitialize() };
        }
    }
}

pub struct WindowsEndpointCatalog;

impl WindowsEndpointCatalog {
    pub fn enumerate() -> Result<Vec<AudioEndpoint>, AudioError> {
        let _apartment = ComApartment::initialize()?;
        let enumerator = create_enumerator()?;
        let defaults = default_endpoint_ids(&enumerator);
        let mut endpoints = Vec::new();

        enumerate_flow(
            &enumerator,
            eCapture,
            EndpointKind::Capture,
            &defaults,
            &mut endpoints,
        )?;
        enumerate_flow(
            &enumerator,
            eRender,
            EndpointKind::Render,
            &defaults,
            &mut endpoints,
        )?;
        endpoints.sort_by(|left, right| {
            left.kind
                .cmp(&right.kind)
                .then_with(|| left.friendly_name.cmp(&right.friendly_name))
        });
        Ok(endpoints)
    }
}

pub fn windows_endpoint_peak(endpoint_id: &str) -> Result<f32, AudioError> {
    let _apartment = ComApartment::initialize()?;
    let enumerator = create_enumerator()?;
    let wide_id: Vec<u16> = endpoint_id.encode_utf16().chain(Some(0)).collect();
    // SAFETY: `wide_id` is null-terminated and lives for the duration of the call.
    let endpoint = unsafe { enumerator.GetDevice(PCWSTR(wide_id.as_ptr())) }
        .map_err(|_| AudioError::EndpointNotFound)?;
    // SAFETY: Activation uses the documented endpoint meter COM interface with
    // no activation parameters.
    let meter: IAudioMeterInformation =
        unsafe { endpoint.Activate(CLSCTX_ALL, None) }.map_err(platform_error)?;
    // SAFETY: The interface is valid for the current initialized COM apartment.
    unsafe { meter.GetPeakValue() }
        .map(|peak| peak.clamp(0.0, 1.0))
        .map_err(platform_error)
}

pub struct WindowsAudioCapture {
    // `inner` keeps the cpal stream or the loopback worker alive; it is
    // intentionally never read — the field exists for its Drop side-effects.
    #[allow(dead_code)]
    inner: CaptureHandle,
    frames: Receiver<AudioFrame>,
    dropped_frames: Arc<AtomicU64>,
    format: AudioFormat,
}

enum CaptureHandle {
    #[allow(dead_code)]
    Cpal(Stream),
    Loopback {
        stop: Sender<()>,
        worker: Option<JoinHandle<()>>,
    },
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        if let CaptureHandle::Loopback { stop, worker } = self {
            let _ = stop.send(());
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        }
        // The cpal `Stream` stops itself on drop.
    }
}

pub struct WindowsAudioPlayback {
    _stream: Stream,
    frames: SyncSender<Vec<f32>>,
    dropped_frames: Arc<AtomicU64>,
    underrun_samples: Arc<AtomicU64>,
    format: AudioFormat,
}

impl WindowsAudioPlayback {
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
        let callback_underruns = Arc::clone(&underrun_samples);
        let stream = match sample_format {
            SampleFormat::F32 => {
                build_playback_stream::<f32>(&device, &config, frames, callback_underruns)
            }
            SampleFormat::I16 => {
                build_playback_stream::<i16>(&device, &config, frames, callback_underruns)
            }
            SampleFormat::U16 => {
                build_playback_stream::<u16>(&device, &config, frames, callback_underruns)
            }
            other => Err(AudioError::Platform(format!(
                "unsupported Windows playback sample format: {other:?}"
            ))),
        }?;
        stream
            .play()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        Ok(Self {
            _stream: stream,
            frames: sender,
            dropped_frames,
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

impl WindowsAudioCapture {
    pub fn start(friendly_name: &str, queue_capacity: usize) -> Result<Self, AudioError> {
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
                "unsupported Windows capture sample format: {other:?}"
            ))),
        }?;
        stream
            .play()
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        Ok(Self {
            inner: CaptureHandle::Cpal(stream),
            frames,
            dropped_frames,
            format: AudioFormat {
                sample_rate,
                channels: 1,
            },
        })
    }

    /// Capture the mix rendered to a Render endpoint (e.g. headphones or
    /// speakers) using WASAPI shared-mode loopback. The captured signal is
    /// the *system* mix for that endpoint and is independent of the user's
    /// microphone; VALORANT voice-chat output is captured here.
    pub fn start_loopback(friendly_name: &str, queue_capacity: usize) -> Result<Self, AudioError> {
        if queue_capacity == 0 {
            return Err(AudioError::InvalidQueueCapacity);
        }
        let apartment = ComApartment::initialize()?;
        let enumerator = create_enumerator()?;
        let device = find_render_device_by_name(&enumerator, friendly_name)?;
        let (sample_rate, channels) = discover_loopback_format(&device);
        drop(enumerator);
        drop(apartment);

        if channels == 0 || sample_rate == 0 {
            return Err(AudioError::InvalidFormat);
        }

        let (sender, frames) = mpsc::sync_channel(queue_capacity);
        let dropped_frames = Arc::new(AtomicU64::new(0));
        let callback_drops = Arc::clone(&dropped_frames);
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let owned_name = friendly_name.to_owned();
        let worker = thread::Builder::new()
            .name("audio-loopback-capture".to_owned())
            .spawn(move || {
                run_loopback_capture(&owned_name, sender, callback_drops, stop_rx);
            })
            .map_err(|error| AudioError::Platform(error.to_string()))?;
        Ok(Self {
            inner: CaptureHandle::Loopback {
                stop: stop_tx,
                worker: Some(worker),
            },
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointEvent {
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

pub struct WindowsDeviceWatcher {
    events: Receiver<EndpointEvent>,
    shutdown: mpsc::Sender<()>,
    worker: Option<JoinHandle<()>>,
}

impl WindowsDeviceWatcher {
    pub fn start(event_capacity: usize) -> Result<Self, AudioError> {
        if event_capacity == 0 {
            return Err(AudioError::InvalidQueueCapacity);
        }
        let (event_tx, event_rx) = mpsc::sync_channel(event_capacity);
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);

        let worker = thread::Builder::new()
            .name("audio-device-notifications".to_owned())
            .spawn(move || {
                let apartment = match ComApartment::initialize() {
                    Ok(apartment) => apartment,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };
                let enumerator = match create_enumerator() {
                    Ok(enumerator) => enumerator,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };
                let callback: IMMNotificationClient = NotificationSink { events: event_tx }.into();
                // SAFETY: The callback remains alive until it is explicitly
                // unregistered below, and COM is initialized on this worker.
                if let Err(error) =
                    unsafe { enumerator.RegisterEndpointNotificationCallback(&callback) }
                {
                    let _ = ready_tx.send(Err(error.to_string()));
                    return;
                }
                let _ = ready_tx.send(Ok(()));

                let _ = shutdown_rx.recv();

                // SAFETY: The callback was registered on this enumerator and is
                // unregistered before the COM apartment and callback are dropped.
                let _ = unsafe { enumerator.UnregisterEndpointNotificationCallback(&callback) };
                drop(apartment);
            })
            .map_err(|error| AudioError::Platform(error.to_string()))?;

        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(Self {
                events: event_rx,
                shutdown: shutdown_tx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(AudioError::Platform(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AudioError::Platform(error.to_string()))
            }
        }
    }

    pub fn try_next(&self) -> Result<Option<EndpointEvent>, AudioError> {
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(AudioError::EndpointInvalidated),
        }
    }
}

impl Drop for WindowsDeviceWatcher {
    fn drop(&mut self) {
        let _ = self.shutdown.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[windows::core::implement(IMMNotificationClient)]
struct NotificationSink {
    events: SyncSender<EndpointEvent>,
}

impl IMMNotificationClient_Impl for NotificationSink_Impl {
    fn OnDeviceStateChanged(
        &self,
        device_id: &PCWSTR,
        new_state: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        self.emit_id(device_id, |endpoint_id| EndpointEvent::StateChanged {
            endpoint_id,
            state: map_state(new_state),
        });
        Ok(())
    }

    fn OnDeviceAdded(&self, device_id: &PCWSTR) -> windows::core::Result<()> {
        self.emit_id(device_id, |endpoint_id| EndpointEvent::Added {
            endpoint_id,
        });
        Ok(())
    }

    fn OnDeviceRemoved(&self, device_id: &PCWSTR) -> windows::core::Result<()> {
        self.emit_id(device_id, |endpoint_id| EndpointEvent::Removed {
            endpoint_id,
        });
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        _role: ERole,
        device_id: &PCWSTR,
    ) -> windows::core::Result<()> {
        let endpoint_id = pcwstr_to_string(device_id).ok();
        let _ = self.events.try_send(EndpointEvent::DefaultChanged {
            endpoint_id,
            kind: if flow == eCapture {
                EndpointKind::Capture
            } else {
                EndpointKind::Render
            },
        });
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        device_id: &PCWSTR,
        _key: &PROPERTYKEY,
    ) -> windows::core::Result<()> {
        self.emit_id(device_id, |endpoint_id| EndpointEvent::PropertyChanged {
            endpoint_id,
        });
        Ok(())
    }
}

impl NotificationSink_Impl {
    fn emit_id(&self, device_id: &PCWSTR, build: impl FnOnce(String) -> EndpointEvent) {
        if let Ok(endpoint_id) = pcwstr_to_string(device_id) {
            // A full channel deliberately drops the newest notification. The UI
            // responds to any event by re-enumerating the authoritative catalog.
            let _ = self.events.try_send(build(endpoint_id));
        }
    }
}

fn create_enumerator() -> Result<IMMDeviceEnumerator, AudioError> {
    // SAFETY: COM has been initialized by the caller and no aggregation is used.
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(platform_error)
}

fn enumerate_flow(
    enumerator: &IMMDeviceEnumerator,
    flow: EDataFlow,
    kind: EndpointKind,
    defaults: &[(EndpointKind, ERole, String)],
    endpoints: &mut Vec<AudioEndpoint>,
) -> Result<(), AudioError> {
    // SAFETY: Enumerator is valid and state mask is a documented bit combination.
    let collection = unsafe { enumerator.EnumAudioEndpoints(flow, ALL_DEVICE_STATES) }
        .map_err(platform_error)?;
    // SAFETY: Collection is valid for this COM apartment.
    let count = unsafe { collection.GetCount() }.map_err(platform_error)?;
    for index in 0..count {
        // SAFETY: `index` is strictly less than the collection count.
        let device = unsafe { collection.Item(index) }.map_err(platform_error)?;
        endpoints.push(endpoint_from_device(&device, kind, defaults)?);
    }
    Ok(())
}

fn endpoint_from_device(
    device: &IMMDevice,
    kind: EndpointKind,
    defaults: &[(EndpointKind, ERole, String)],
) -> Result<AudioEndpoint, AudioError> {
    let id = device_id(device)?;
    // SAFETY: Read-only property access on a valid device.
    let store = unsafe { device.OpenPropertyStore(STGM_READ) }.map_err(platform_error)?;
    // SAFETY: The property key is a static Windows-defined key.
    let friendly_name = unsafe { store.GetValue(&PKEY_Device_FriendlyName) }
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "Unnamed audio endpoint".to_owned());
    // SAFETY: The device is valid for the current COM apartment.
    let state = unsafe { device.GetState() }
        .map(map_state)
        .map_err(platform_error)?;

    Ok(AudioEndpoint {
        id: id.clone(),
        friendly_name,
        kind,
        state,
        default_roles: DefaultRoles {
            console: is_default(defaults, kind, eConsole, &id),
            multimedia: is_default(defaults, kind, eMultimedia, &id),
            communications: is_default(defaults, kind, eCommunications, &id),
        },
        native_format: native_format(device),
        is_synthetic: false,
    })
}

fn native_format(device: &IMMDevice) -> Option<AudioFormat> {
    // SAFETY: Activation uses the standard audio client solely for mix-format
    // discovery. The returned format is copied before freeing its allocation.
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }.ok()?;
    // SAFETY: Valid IAudioClient; Windows allocates the result with CoTaskMem.
    let format = unsafe { client.GetMixFormat() }.ok()?;
    if format.is_null() {
        return None;
    }
    // SAFETY: `format` is non-null and points to WAVEFORMATEX for this call.
    let discovered = unsafe {
        AudioFormat {
            sample_rate: (*format).nSamplesPerSec,
            channels: (*format).nChannels,
        }
    };
    // SAFETY: GetMixFormat documents CoTaskMemFree for the returned allocation.
    unsafe { CoTaskMemFree(Some(format.cast())) };
    Some(discovered)
}

fn find_render_device_by_name(
    enumerator: &IMMDeviceEnumerator,
    friendly_name: &str,
) -> Result<IMMDevice, AudioError> {
    // SAFETY: Enumerator is valid and state mask is a documented bit combination.
    let collection = unsafe { enumerator.EnumAudioEndpoints(eRender, ALL_DEVICE_STATES) }
        .map_err(platform_error)?;
    // SAFETY: Collection is valid for this COM apartment.
    let count = unsafe { collection.GetCount() }.map_err(platform_error)?;
    for index in 0..count {
        // SAFETY: `index` is strictly less than the collection count.
        let device = unsafe { collection.Item(index) }.map_err(platform_error)?;
        // SAFETY: Read-only property access on a valid device.
        let store = unsafe { device.OpenPropertyStore(STGM_READ) }.map_err(platform_error)?;
        // SAFETY: The property key is a static Windows-defined key.
        let name = unsafe { store.GetValue(&PKEY_Device_FriendlyName) }
            .map(|value| value.to_string())
            .unwrap_or_else(|_| "Unnamed audio endpoint".to_owned());
        if name == friendly_name {
            return Ok(device);
        }
    }
    Err(AudioError::EndpointNotFound)
}

/// Inspect the WASAPI shared mix format of a Render endpoint and return
/// `(sample_rate, channel_count)` for the loopback stream. The shared-mode
/// engine format on modern Windows is IEEE float 32-bit; if the format is
/// not float32, `AudioError::InvalidFormat` is returned.
fn discover_loopback_format(device: &IMMDevice) -> (u32, u16) {
    // SAFETY: Activation uses the standard audio client solely for mix-format
    // discovery. The returned format is copied before freeing its allocation.
    let client: IAudioClient = match unsafe { device.Activate(CLSCTX_ALL, None) } {
        Ok(client) => client,
        Err(_) => return (0, 0),
    };
    // SAFETY: Valid IAudioClient; Windows allocates the result with CoTaskMem.
    let format = match unsafe { client.GetMixFormat() } {
        Ok(format) if !format.is_null() => format,
        _ => return (0, 0),
    };
    let discovered = parse_loopback_format(format);
    // SAFETY: GetMixFormat documents CoTaskMemFree for the returned allocation.
    unsafe { CoTaskMemFree(Some(format.cast())) };
    discovered
}

/// Parse a WAVEFORMATEX returned by GetMixFormat for the loopback worker.
/// Returns `(sample_rate, channels)` when the format is IEEE float 32-bit
/// (possibly via a WAVEFORMATEXTENSIBLE wrapper); otherwise `(0, 0)`.
fn parse_loopback_format(format: *const WAVEFORMATEX) -> (u32, u16) {
    // SAFETY: `format` is non-null and points to a valid WAVEFORMATEX for this call.
    let header = unsafe { &*format };
    let sample_rate = header.nSamplesPerSec;
    let channels = header.nChannels;
    let bits = header.wBitsPerSample;
    // WAVEFORMATEXTENSIBLE adds Samples(2) + dwChannelMask(4) + SubFormat(16)
    // beyond the WAVEFORMATEX header, so cbSize must cover at least that tail.
    if header.wFormatTag == WAVE_FORMAT_EXTENSIBLE_TAG && header.cbSize >= 22 {
        // SAFETY: The extensible header follows the base header in memory and
        // is valid when cbSize covers the SubFormat GUID, which we checked
        // above. The packed extensible struct is read unaligned to avoid UB.
        let extensible_ptr = format as *const WAVEFORMATEXTENSIBLE;
        let sub_format =
            unsafe { std::ptr::addr_of!((*extensible_ptr).SubFormat).read_unaligned() };
        if sub_format != KSDATAFORMAT_SUBTYPE_IEEE_FLOAT || bits != 32 {
            return (0, 0);
        }
    } else if header.wFormatTag != WAVE_FORMAT_IEEE_FLOAT_TAG || bits != 32 {
        return (0, 0);
    }
    (sample_rate, channels)
}

/// `WAVE_FORMAT_EXTENSIBLE` (0xFFFE).
const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xFFFE;
/// `WAVE_FORMAT_IEEE_FLOAT` (0x0003).
const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 0x0003;
/// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: `00000003-0000-0010-8000-00aa00389b71`.
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

fn run_loopback_capture(
    friendly_name: &str,
    sender: SyncSender<AudioFrame>,
    dropped_frames: Arc<AtomicU64>,
    stop: Receiver<()>,
) {
    let apartment = match ComApartment::initialize() {
        Ok(apartment) => apartment,
        Err(_) => return,
    };
    let enumerator = match create_enumerator() {
        Ok(enumerator) => enumerator,
        Err(_) => return,
    };
    let device = match find_render_device_by_name(&enumerator, friendly_name) {
        Ok(device) => device,
        Err(_) => return,
    };
    let client: IAudioClient = match unsafe { device.Activate(CLSCTX_ALL, None) } {
        Ok(client) => client,
        Err(_) => return,
    };
    let format = match unsafe { client.GetMixFormat() } {
        Ok(format) if !format.is_null() => format,
        _ => return,
    };
    let (sample_rate, channels) = parse_loopback_format(format);
    if channels == 0 || sample_rate == 0 {
        // SAFETY: GetMixFormat documents CoTaskMemFree for the returned allocation.
        unsafe { CoTaskMemFree(Some(format.cast())) };
        return;
    }

    // SAFETY: Initialize uses a mix-format pointer returned by GetMixFormat on
    // the same audio client; LOOPBACK in shared mode is the documented way to
    // capture the render mix for this endpoint.
    let initialize = unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            LOOPBACK_BUFFER_MS * 10_000, // 100ns units
            0,
            format,
            None,
        )
    };
    if initialize.is_err() {
        // SAFETY: GetMixFormat documents CoTaskMemFree for the returned allocation.
        unsafe { CoTaskMemFree(Some(format.cast())) };
        return;
    }
    let capture_client: IAudioCaptureClient =
        match unsafe { client.GetService::<IAudioCaptureClient>() } {
            Ok(capture) => capture,
            Err(_) => {
                // SAFETY: GetMixFormat documents CoTaskMemFree for the returned allocation.
                unsafe { CoTaskMemFree(Some(format.cast())) };
                return;
            }
        };
    // SAFETY: The format pointer is no longer needed after Initialize succeeded.
    unsafe { CoTaskMemFree(Some(format.cast())) };

    if unsafe { client.Start() }.is_err() {
        return;
    }

    let channel_count = usize::from(channels);
    let mut sequence = 0_u64;
    let mut captured_samples = 0_u64;
    loop {
        if stop.try_recv().is_ok() {
            break;
        }
        // Drain every available packet before sleeping. Loopback has no event
        // handle, so we poll at a fraction of the buffer duration.
        loop {
            let mut data_ptr: *mut u8 = std::ptr::null_mut();
            let mut num_frames = 0_u32;
            let mut flags = 0_u32;
            // SAFETY: The capture client and buffers are valid in this COM
            // apartment; pointers are written by the OS and not stored beyond
            // the matching ReleaseBuffer call.
            let result = unsafe {
                capture_client.GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
            };
            if result.is_err() {
                break;
            }
            let silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
            if num_frames == 0 {
                let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
                break;
            }
            // SAFETY: GetBuffer hands `num_frames` of interleaved float32
            // samples for the lifetime until ReleaseBuffer. For a SILENT buffer
            // `data_ptr` may be null and the data is not valid; the helper
            // synthesizes zeros instead, so a quiet endpoint still delivers
            // frames (a few seconds of silence must never read as a stall).
            let samples_f32: &[f32] = if silent || data_ptr.is_null() {
                &[]
            } else {
                unsafe {
                    std::slice::from_raw_parts(
                        data_ptr as *const f32,
                        usize::try_from(num_frames).unwrap_or(0) * channel_count,
                    )
                }
            };
            let frame = build_loopback_mono_frame(
                silent,
                num_frames,
                samples_f32,
                channel_count,
                sample_rate,
                &mut captured_samples,
                &mut sequence,
            );
            if !frame.samples.is_empty() {
                if sender.try_send(frame).is_err() {
                    dropped_frames.fetch_add(1, Ordering::Relaxed);
                }
            }
            let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
            // Continue the inner loop to drain trailing packets without sleeping.
            continue;
        }
        let _ = stop.try_recv();
        thread::sleep(Duration::from_millis(LOOPBACK_POLL_MS));
    }

    let _ = unsafe { client.Stop() };
    drop(capture_client);
    drop(client);
    drop(device);
    drop(enumerator);
    drop(apartment);
}

fn downmix_to_mono_slice_f32(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels == 0 || samples.len() % channels != 0 {
        return Vec::new();
    }
    if channels == 1 {
        return samples.to_vec();
    }
    let inv = 1.0_f32 / channels as f32;
    samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() * inv)
        .collect()
}

/// Produce a mono `AudioFrame` for a loopback buffer. A `SILENT` buffer (a
/// quiet endpoint) yields a zero-filled frame rather than being dropped, so a
/// few seconds of "nobody is talking" is never mistaken for a stalled capture.
/// Non-silent buffers are downmixed to mono. Advances the sample/timestamp and
/// sequence counters.
fn build_loopback_mono_frame(
    silent: bool,
    num_frames: u32,
    samples_f32: &[f32],
    channel_count: usize,
    sample_rate: u32,
    captured_samples: &mut u64,
    sequence: &mut u64,
) -> AudioFrame {
    let mono = if silent {
        vec![0.0_f32; num_frames as usize]
    } else {
        downmix_to_mono_slice_f32(samples_f32, channel_count)
    };
    let mono_len = u64::try_from(mono.len()).unwrap_or(u64::MAX);
    let timestamp_ns = captured_samples.saturating_mul(1_000_000_000) / u64::from(sample_rate);
    *captured_samples = captured_samples.saturating_add(mono_len);
    let frame = AudioFrame {
        sequence: *sequence,
        capture_monotonic_ns: timestamp_ns,
        sample_rate,
        channels: 1,
        samples: mono,
    };
    *sequence = sequence.saturating_add(1);
    frame
}

/// Loopback buffer size (milliseconds). Larger = fewer wakeups, more latency.
const LOOPBACK_BUFFER_MS: i64 = 200;
/// Polling interval for the loopback worker (no event handle is used).
const LOOPBACK_POLL_MS: u64 = 5;

fn default_endpoint_ids(enumerator: &IMMDeviceEnumerator) -> Vec<(EndpointKind, ERole, String)> {
    let mut defaults = Vec::new();
    for (kind, flow) in [
        (EndpointKind::Capture, eCapture),
        (EndpointKind::Render, eRender),
    ] {
        for role in [eConsole, eMultimedia, eCommunications] {
            // Missing defaults are normal when a role has no assigned endpoint.
            if let Ok(device) = unsafe { enumerator.GetDefaultAudioEndpoint(flow, role) }
                && let Ok(id) = device_id(&device)
            {
                defaults.push((kind, role, id));
            }
        }
    }
    defaults
}

fn device_id(device: &IMMDevice) -> Result<String, AudioError> {
    // SAFETY: The device is valid; GetId allocates a null-terminated string.
    let raw = unsafe { device.GetId() }.map_err(platform_error)?;
    // SAFETY: GetId guarantees a valid null-terminated string on success.
    let id = unsafe { raw.to_string() }.map_err(|error| AudioError::Platform(error.to_string()))?;
    // SAFETY: GetId documents CoTaskMemFree for the returned allocation.
    unsafe { CoTaskMemFree(Some(raw.as_ptr().cast())) };
    Ok(id)
}

fn pcwstr_to_string(value: &PCWSTR) -> Result<String, std::string::FromUtf16Error> {
    // SAFETY: Windows notification methods provide a valid null-terminated ID.
    unsafe { value.to_string() }
}

fn is_default(
    defaults: &[(EndpointKind, ERole, String)],
    kind: EndpointKind,
    role: ERole,
    id: &str,
) -> bool {
    defaults
        .iter()
        .any(|entry| entry.0 == kind && entry.1 == role && entry.2 == id)
}

fn map_state(state: DEVICE_STATE) -> EndpointState {
    if state == DEVICE_STATE_ACTIVE {
        EndpointState::Active
    } else if state == DEVICE_STATE_DISABLED {
        EndpointState::Disabled
    } else if state == DEVICE_STATE_UNPLUGGED {
        EndpointState::Unplugged
    } else {
        EndpointState::NotPresent
    }
}

fn platform_error(error: windows::core::Error) -> AudioError {
    AudioError::Platform(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_buffer_produces_zero_filled_frame() {
        // A quiet endpoint: WASAPI marks the buffer SILENT. The loopback worker
        // must still emit a frame so the live loop never mistakes a few seconds
        // of silence for a stalled capture.
        let mut captured_samples = 0_u64;
        let mut sequence = 0_u64;
        let frame = build_loopback_mono_frame(
            true,
            480,
            &[],
            2,
            48_000,
            &mut captured_samples,
            &mut sequence,
        );
        assert_eq!(frame.samples.len(), 480);
        assert!(frame.samples.iter().all(|sample| *sample == 0.0));
        assert_eq!(frame.channels, 1);
        assert_eq!(frame.sample_rate, 48_000);
        assert_eq!(captured_samples, 480);
        assert_eq!(sequence, 1);
        // Monotonic timestamp advances by the frame duration (10 ms at 48 kHz).
        assert_eq!(frame.capture_monotonic_ns, 10_000_000);
    }

    #[test]
    fn non_silent_buffer_downmixes_stereo_to_mono() {
        let mut captured_samples = 0_u64;
        let mut sequence = 0_u64;
        // Left = 0.4, right = 0.6 => mono 0.5.
        let stereo = [0.4_f32, 0.6_f32, 0.0_f32, 0.0_f32];
        let frame = build_loopback_mono_frame(
            false,
            2,
            &stereo,
            2,
            48_000,
            &mut captured_samples,
            &mut sequence,
        );
        assert_eq!(frame.samples.len(), 2);
        assert!((frame.samples[0] - 0.5).abs() < 1e-6);
        assert!(frame.samples[1].abs() < 1e-6);
        assert_eq!(captured_samples, 2);
        assert_eq!(sequence, 1);
    }

    #[test]
    fn sequence_and_timestamps_advance_across_frames() {
        let mut captured_samples = 0_u64;
        let mut sequence = 0_u64;
        for _ in 0..3 {
            build_loopback_mono_frame(
                true,
                480,
                &[],
                2,
                48_000,
                &mut captured_samples,
                &mut sequence,
            );
        }
        assert_eq!(sequence, 3);
        assert_eq!(captured_samples, 1440);
        // 30 ms of audio at 48 kHz.
        assert_eq!(
            build_loopback_mono_frame(
                true,
                480,
                &[],
                2,
                48_000,
                &mut captured_samples,
                &mut sequence
            )
            .capture_monotonic_ns,
            40_000_000
        );
    }
}
