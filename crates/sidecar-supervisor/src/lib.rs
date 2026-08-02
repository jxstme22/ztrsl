#![deny(unsafe_op_in_unsafe_fn)]

use std::fs;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use ipc_protocol::{
    AudioPacket, CaptionPayload, ClipProcessPayload, ClipResultPayload, Envelope,
    HelloAcceptedPayload, HelloPayload, LiveStartPayload, PROTOCOL_VERSION,
};
use thiserror::Error;
use tungstenite::{Message, WebSocket};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const CLIP_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const LIVE_START_TIMEOUT: Duration = Duration::from_secs(3 * 60);

#[derive(Debug, Clone, Default)]
pub struct SidecarConfig {
    pub python_executable: PathBuf,
    pub python_source_root: PathBuf,
    pub model_root: PathBuf,
    pub runtime_library_dir: Option<PathBuf>,
    pub translation_runner: PathBuf,
    /// Extra environment variables applied to the sidecar subprocess at
    /// spawn time. Used to forward opt-in HTTP translation API configuration
    /// (e.g. `LST_LT_ENDPOINT`, `LST_CUSTOM_TX_API_KEY`) from the UI without
    /// requiring the user to set system-level environment variables.
    pub extra_env: Vec<(String, String)>,
}

impl SidecarConfig {
    /// Construct a config for a packaged (bundled-sidecar) build.
    ///
    /// `python_executable` points to the frozen sidecar exe (PyInstaller
    /// onedir), `translation_runner` to the MADLAD candle runner, and
    /// `model_root` to a writable per-user models directory
    /// (e.g. `%LOCALAPPDATA%/xTRSNLTR/models`).
    pub fn for_bundled(
        python_executable: PathBuf,
        translation_runner: PathBuf,
        model_root: PathBuf,
    ) -> Self {
        Self {
            python_executable,
            python_source_root: PathBuf::new(), // not used by a frozen exe
            model_root,
            runtime_library_dir: None,
            translation_runner,
            extra_env: Vec::new(),
        }
    }

    pub fn for_workspace(workspace_root: &Path) -> Self {
        let virtualenv_python = if cfg!(windows) {
            workspace_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            workspace_root.join(".venv").join("bin").join("python")
        };
        let runtime_library_dir = find_onnxruntime_library_dir(&virtualenv_python);
        Self {
            python_executable: if virtualenv_python.is_file() {
                virtualenv_python
            } else {
                PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
            },
            python_source_root: workspace_root
                .join("services")
                .join("inference")
                .join("src"),
            model_root: workspace_root.join("models"),
            runtime_library_dir,
            translation_runner: workspace_root.join("target").join("release").join(
                if cfg!(windows) {
                    "translation-runner.exe"
                } else {
                    "translation-runner"
                },
            ),
            extra_env: Vec::new(),
        }
    }

    fn validate(&self) -> Result<(), SupervisorError> {
        if self.python_source_root.as_os_str().is_empty() {
            // Bundled (PyInstaller) mode: the frozen exe must exist.
            if !self.python_executable.is_file() {
                return Err(SupervisorError::InvalidSidecarPath);
            }
        } else if !self.python_source_root.is_dir() {
            return Err(SupervisorError::InvalidSidecarPath);
        }
        Ok(())
    }
}

pub struct SidecarSupervisor {
    child: Child,
    socket: WebSocket<TcpStream>,
    session_id: String,
    session_bytes: [u8; 16],
    next_sequence: u64,
    stopped: bool,
}

impl SidecarSupervisor {
    pub fn start(config: &SidecarConfig) -> Result<Self, SupervisorError> {
        config.validate()?;
        let port = reserve_loopback_port()?;
        let token = random_hex::<32>()?;
        let session_bytes = random_bytes::<16>()?;
        let session_id = to_hex(&session_bytes);

        let mut command = Command::new(&config.python_executable);
        command
            .arg("-m")
            .arg("local_squad_inference.sidecar")
            .env("PYTHONPATH", &config.python_source_root)
            .env("LST_IPC_PORT", port.to_string())
            .env("LST_IPC_TOKEN", &token)
            .env("LST_PROTOCOL_VERSION", PROTOCOL_VERSION.to_string())
            .env("LST_MODEL_DIR", &config.model_root)
            .env("LST_TRANSLATION_RUNNER", &config.translation_runner)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for (key, value) in &config.extra_env {
            command.env(key, value);
        }
        #[cfg(target_os = "macos")]
        if let Some(runtime_library_dir) = &config.runtime_library_dir {
            command.env("DYLD_LIBRARY_PATH", runtime_library_dir);
        }
        let mut child = command.spawn().map_err(SupervisorError::Spawn)?;

        let stream = match connect_with_retry(port, &mut child) {
            Ok(stream) => stream,
            Err(error) => {
                terminate_child(&mut child);
                return Err(error);
            }
        };
        stream
            .set_read_timeout(Some(IO_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        stream
            .set_write_timeout(Some(IO_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        let request = format!("ws://127.0.0.1:{port}");
        let (mut socket, _) = tungstenite::client(request, stream)
            .map_err(|error| SupervisorError::Handshake(error.to_string()))?;
        let hello = Envelope {
            protocol_version: PROTOCOL_VERSION,
            message_id: "hello-1".to_owned(),
            session_id: session_id.clone(),
            message_type: "hello".to_owned(),
            sent_monotonic_ns: 0,
            payload: HelloPayload {
                token,
                desktop_version: env!("CARGO_PKG_VERSION").to_owned(),
                protocol_versions: vec![PROTOCOL_VERSION],
                capabilities: vec!["pcm_f32le".to_owned(), "caption_revisions".to_owned()],
            },
        };
        write_json(&mut socket, &hello)?;
        let accepted: Envelope<HelloAcceptedPayload> = read_json(&mut socket)?;
        accepted
            .validate_version()
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if accepted.message_type != "hello.accepted"
            || accepted.payload.protocol_version != PROTOCOL_VERSION
        {
            terminate_child(&mut child);
            return Err(SupervisorError::HandshakeRejected);
        }

        Ok(Self {
            child,
            socket,
            session_id,
            session_bytes,
            next_sequence: 0,
            stopped: false,
        })
    }

    pub fn fake_roundtrip(
        &mut self,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
    ) -> Result<Vec<Envelope<CaptionPayload>>, SupervisorError> {
        self.ensure_running()?;
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let packet = AudioPacket {
            session_id: self.session_bytes,
            sequence,
            capture_monotonic_ns,
            sample_rate: 16_000,
            channels: 1,
            flags: 0,
            samples,
        };
        self.socket
            .send(Message::Binary(
                packet
                    .encode()
                    .map_err(|error| SupervisorError::Protocol(error.to_string()))?
                    .into(),
            ))
            .map_err(SupervisorError::WebSocket)?;

        let provisional: Envelope<CaptionPayload> = read_json(&mut self.socket)?;
        let final_caption: Envelope<CaptionPayload> = read_json(&mut self.socket)?;
        if provisional.message_type != "caption.provisional"
            || final_caption.message_type != "caption.final"
            || provisional.payload.caption_id != final_caption.payload.caption_id
            || provisional.payload.revision >= final_caption.payload.revision
        {
            return Err(SupervisorError::InvalidCaptionLifecycle);
        }
        Ok(vec![provisional, final_caption])
    }

    pub fn start_live(
        &mut self,
        source_mode: &str,
        provider: &str,
        asr_provider: &str,
        translation_provider: &str,
        target_language: &str,
        resource_profile: &str,
        vad_sensitivity: u8,
    ) -> Result<serde_json::Value, SupervisorError> {
        self.ensure_running()?;
        let request = Envelope {
            protocol_version: PROTOCOL_VERSION,
            message_id: format!("live-start-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "live.start".to_owned(),
            sent_monotonic_ns: 0,
            payload: LiveStartPayload {
                source_mode: source_mode.to_owned(),
                provider: provider.to_owned(),
                asr_provider: asr_provider.to_owned(),
                translation_provider: translation_provider.to_owned(),
                target_language: target_language.to_owned(),
                resource_profile: resource_profile.to_owned(),
                vad_sensitivity,
            },
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        self.socket
            .get_ref()
            .set_read_timeout(Some(LIVE_START_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
        self.socket
            .get_ref()
            .set_read_timeout(Some(IO_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        response
            .validate_version()
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if response.message_type == "live.error" {
            return Err(SupervisorError::LiveInference(error_message(
                &response.payload,
                "live inference could not start",
            )));
        }
        if response.message_type != "live.started" {
            return Err(SupervisorError::Protocol(
                "unexpected live start response".to_owned(),
            ));
        }
        Ok(response.payload)
    }

    pub fn send_live_audio(
        &mut self,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
    ) -> Result<(), SupervisorError> {
        self.ensure_running()?;
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let packet = AudioPacket {
            session_id: self.session_bytes,
            sequence,
            capture_monotonic_ns,
            sample_rate: 16_000,
            channels: 1,
            flags: 0,
            samples,
        };
        self.socket
            .send(Message::Binary(
                packet
                    .encode()
                    .map_err(|error| SupervisorError::Protocol(error.to_string()))?
                    .into(),
            ))
            .map_err(SupervisorError::WebSocket)
    }

    pub fn read_live_caption(
        &mut self,
        timeout: Duration,
    ) -> Result<Option<Envelope<CaptionPayload>>, SupervisorError> {
        self.ensure_running()?;
        self.socket
            .get_ref()
            .set_read_timeout(Some(timeout))
            .map_err(SupervisorError::Io)?;
        let response = read_json::<Envelope<serde_json::Value>>(&mut self.socket);
        self.socket
            .get_ref()
            .set_read_timeout(Some(IO_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        let response = match response {
            Ok(response) => response,
            Err(error) if is_timeout_error(&error) => return Ok(None),
            Err(error) => return Err(error),
        };
        response
            .validate_version()
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if response.message_type == "live.error" {
            return Err(SupervisorError::LiveInference(error_message(
                &response.payload,
                "live inference failed",
            )));
        }
        if !matches!(
            response.message_type.as_str(),
            "caption.provisional" | "caption.final"
        ) {
            return Ok(None);
        }
        let payload = serde_json::from_value(response.payload)
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        Ok(Some(Envelope {
            protocol_version: response.protocol_version,
            message_id: response.message_id,
            session_id: response.session_id,
            message_type: response.message_type,
            sent_monotonic_ns: response.sent_monotonic_ns,
            payload,
        }))
    }

    pub fn stop_live(&mut self) -> Result<serde_json::Value, SupervisorError> {
        self.ensure_running()?;
        let request = Envelope {
            protocol_version: PROTOCOL_VERSION,
            message_id: format!("live-stop-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "live.stop".to_owned(),
            sent_monotonic_ns: 0,
            payload: serde_json::json!({}),
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        loop {
            let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
            if response.message_type == "live.stopped" {
                return Ok(response.payload);
            }
            if response.message_type == "live.error" {
                return Err(SupervisorError::LiveInference(error_message(
                    &response.payload,
                    "live inference failed while stopping",
                )));
            }
        }
    }

    pub fn process_clip(
        &mut self,
        path: &Path,
        source_mode: &str,
        provider: &str,
    ) -> Result<ClipResultPayload, SupervisorError> {
        self.ensure_running()?;
        if !path.is_absolute() {
            return Err(SupervisorError::InvalidClipPath);
        }
        let request = Envelope {
            protocol_version: PROTOCOL_VERSION,
            message_id: format!("clip-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "clip.process".to_owned(),
            sent_monotonic_ns: 0,
            payload: ClipProcessPayload {
                path: path.to_string_lossy().into_owned(),
                source_mode: source_mode.to_owned(),
                provider: provider.to_owned(),
            },
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        self.socket
            .get_ref()
            .set_read_timeout(Some(CLIP_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
        self.socket
            .get_ref()
            .set_read_timeout(Some(IO_TIMEOUT))
            .map_err(SupervisorError::Io)?;
        response
            .validate_version()
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if response.message_type == "clip.error" {
            let message = response
                .payload
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("clip analysis failed");
            return Err(SupervisorError::ClipProcessing(message.to_owned()));
        }
        if response.message_type != "clip.completed" {
            return Err(SupervisorError::Protocol(
                "unexpected clip response".to_owned(),
            ));
        }
        serde_json::from_value(response.payload)
            .map_err(|error| SupervisorError::Protocol(error.to_string()))
    }

    pub fn ensure_running(&mut self) -> Result<(), SupervisorError> {
        if self.stopped {
            return Err(SupervisorError::SidecarExited("stopped".to_owned()));
        }
        match self.child.try_wait().map_err(SupervisorError::Io)? {
            None => Ok(()),
            Some(status) => Err(SupervisorError::SidecarExited(status.to_string())),
        }
    }

    pub fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        let shutdown = Envelope {
            protocol_version: PROTOCOL_VERSION,
            message_id: "shutdown-1".to_owned(),
            session_id: self.session_id.clone(),
            message_type: "shutdown".to_owned(),
            sent_monotonic_ns: 0,
            payload: serde_json::json!({}),
        };
        let _ = write_json(&mut self.socket, &shutdown);
        let _ = self.socket.read();
        let _ = self.socket.close(None);
        wait_or_kill(&mut self.child, SHUTDOWN_TIMEOUT);
    }

    /// Test hook for exercising crash detection and restart behavior without
    /// relying on platform-specific process-control tools.
    pub fn terminate_for_diagnostics(&mut self) {
        terminate_child(&mut self.child);
        self.stopped = true;
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl SupervisorError {
    #[must_use]
    pub fn is_transport_failure(&self) -> bool {
        matches!(
            self,
            Self::Io(_)
                | Self::WebSocket(_)
                | Self::ConnectionClosed(_)
                | Self::SidecarExited(_)
                | Self::StartupTimeout
        )
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Error)]
pub enum SupervisorError {
    #[error("sidecar source directory is unavailable")]
    InvalidSidecarPath,
    #[error("failed to start sidecar: {0}")]
    Spawn(std::io::Error),
    #[error("sidecar I/O failed: {0}")]
    Io(std::io::Error),
    #[error("sidecar WebSocket failed: {0}")]
    WebSocket(tungstenite::Error),
    #[error("sidecar connection closed{0}")]
    ConnectionClosed(String),
    #[error("sidecar WebSocket handshake failed: {0}")]
    Handshake(String),
    #[error("sidecar protocol failed: {0}")]
    Protocol(String),
    #[error("sidecar rejected the authenticated handshake")]
    HandshakeRejected,
    #[error("sidecar returned an invalid caption lifecycle")]
    InvalidCaptionLifecycle,
    #[error("sidecar exited unexpectedly: {0}")]
    SidecarExited(String),
    #[error("secure random generation failed: {0}")]
    Random(getrandom::Error),
    #[error("sidecar did not become ready before timeout")]
    StartupTimeout,
    #[error("clip path must be absolute")]
    InvalidClipPath,
    #[error("clip analysis failed: {0}")]
    ClipProcessing(String),
    #[error("live translation failed: {0}")]
    LiveInference(String),
}

fn error_message(payload: &serde_json::Value, fallback: &str) -> String {
    payload
        .get("message")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(fallback)
        .to_owned()
}

fn is_timeout_error(error: &SupervisorError) -> bool {
    matches!(
        error,
        SupervisorError::WebSocket(tungstenite::Error::Io(io_error))
            if matches!(
                io_error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            )
    )
}

fn reserve_loopback_port() -> Result<u16, SupervisorError> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(SupervisorError::Io)?;
    let port = listener.local_addr().map_err(SupervisorError::Io)?.port();
    drop(listener);
    Ok(port)
}

fn connect_with_retry(port: u16, child: &mut Child) -> Result<TcpStream, SupervisorError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    loop {
        if let Some(status) = child.try_wait().map_err(SupervisorError::Io)? {
            return Err(SupervisorError::SidecarExited(status.to_string()));
        }
        match TcpStream::connect_timeout(&address, Duration::from_millis(100)) {
            Ok(stream) => return Ok(stream),
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Err(_) => return Err(SupervisorError::StartupTimeout),
        }
    }
}

fn write_json<T: serde::Serialize>(
    socket: &mut WebSocket<TcpStream>,
    value: &T,
) -> Result<(), SupervisorError> {
    let serialized = serde_json::to_string(value)
        .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
    socket
        .send(Message::Text(serialized.into()))
        .map_err(SupervisorError::WebSocket)
}

fn read_json<T: serde::de::DeserializeOwned>(
    socket: &mut WebSocket<TcpStream>,
) -> Result<T, SupervisorError> {
    loop {
        match socket.read().map_err(SupervisorError::WebSocket)? {
            Message::Text(text) => {
                return serde_json::from_str(&text)
                    .map_err(|error| SupervisorError::Protocol(error.to_string()));
            }
            Message::Binary(bytes) => {
                return serde_json::from_slice(&bytes)
                    .map_err(|error| SupervisorError::Protocol(error.to_string()));
            }
            Message::Ping(payload) => socket
                .send(Message::Pong(payload))
                .map_err(SupervisorError::WebSocket)?,
            Message::Pong(_) | Message::Frame(_) => {}
            Message::Close(frame) => {
                let detail = frame.map_or_else(String::new, |frame| {
                    format!(": {} {}", u16::from(frame.code), frame.reason)
                });
                return Err(SupervisorError::ConnectionClosed(detail));
            }
        }
    }
}

fn random_bytes<const N: usize>() -> Result<[u8; N], SupervisorError> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(SupervisorError::Random)?;
    Ok(bytes)
}

fn random_hex<const N: usize>() -> Result<String, SupervisorError> {
    random_bytes::<N>().map(|bytes| to_hex(&bytes))
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(char::from(HEX[usize::from(byte >> 4)]));
        result.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    result
}

fn wait_or_kill(child: &mut Child, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => break,
        }
    }
    terminate_child(child);
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub fn workspace_root_from_manifest() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map_or_else(PathBuf::new, Path::to_path_buf)
}

pub fn packaged_sidecar_available(config: &SidecarConfig) -> bool {
    fs::metadata(&config.python_source_root)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
}

fn find_onnxruntime_library_dir(python_executable: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let virtualenv = python_executable.parent()?.parent()?;
        let python_libraries = fs::read_dir(virtualenv.join("lib")).ok()?;
        for entry in python_libraries.flatten() {
            let candidate = entry
                .path()
                .join("site-packages")
                .join("onnxruntime")
                .join("capi");
            if candidate.join("libonnxruntime.1.27.0.dylib").is_file() {
                return Some(candidate);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = python_executable;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        SidecarConfig, SupervisorError, packaged_sidecar_available, to_hex,
        workspace_root_from_manifest,
    };

    #[test]
    fn token_hex_encoding_never_exposes_binary_data() {
        assert_eq!(to_hex(&[0, 15, 16, 255]), "000f10ff");
    }

    #[test]
    fn workspace_sidecar_source_is_discoverable_for_development() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        assert!(packaged_sidecar_available(&config));
    }

    #[test]
    fn closed_and_broken_connections_are_restartable_transport_failures() {
        assert!(
            SupervisorError::ConnectionClosed(": 1008 invalid message".to_owned())
                .is_transport_failure()
        );
        assert!(
            SupervisorError::Io(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "closed sidecar socket",
            ))
            .is_transport_failure()
        );
        assert!(
            !SupervisorError::ClipProcessing("unsupported media".to_owned()).is_transport_failure()
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn development_onnxruntime_library_is_discoverable() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        assert!(config.runtime_library_dir.is_some());
    }
}
