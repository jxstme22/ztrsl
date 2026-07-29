use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{PROPERTYKEY, RPC_E_CHANGED_MODE};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    DEVICE_STATE, DEVICE_STATE_ACTIVE, DEVICE_STATE_DISABLED, DEVICE_STATE_NOTPRESENT,
    DEVICE_STATE_UNPLUGGED, EDataFlow, ERole, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, eCapture,
    eCommunications, eConsole, eMultimedia, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, STGM_READ,
};
use windows::core::PCWSTR;

use crate::{AudioEndpoint, AudioError, AudioFormat, DefaultRoles, EndpointKind, EndpointState};

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
