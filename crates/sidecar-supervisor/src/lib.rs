#![deny(unsafe_op_in_unsafe_fn)]

use std::fs;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use ipc_protocol::{
    AudioPacket, CaptionPayload, ClipProcessPayload, ClipResultPayload, Envelope,
    HelloAcceptedPayload, HelloPayload, PROTOCOL_VERSION,
};
use thiserror::Error;
use tungstenite::{Message, WebSocket};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const CLIP_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone)]
pub struct SidecarConfig {
    pub python_executable: PathBuf,
    pub python_source_root: PathBuf,
    pub model_root: PathBuf,
}

impl SidecarConfig {
    pub fn for_workspace(workspace_root: &Path) -> Self {
        let virtualenv_python = if cfg!(windows) {
            workspace_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            workspace_root.join(".venv").join("bin").join("python")
        };
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
        }
    }

    fn validate(&self) -> Result<(), SupervisorError> {
        if !self.python_source_root.is_dir() {
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

        let mut child = Command::new(&config.python_executable)
            .arg("-m")
            .arg("local_squad_inference.sidecar")
            .env("PYTHONPATH", &config.python_source_root)
            .env("LST_IPC_PORT", port.to_string())
            .env("LST_IPC_TOKEN", &token)
            .env("LST_PROTOCOL_VERSION", PROTOCOL_VERSION.to_string())
            .env("LST_MODEL_DIR", &config.model_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(SupervisorError::Spawn)?;

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
    let message = socket.read().map_err(SupervisorError::WebSocket)?;
    let text = message.into_text().map_err(SupervisorError::WebSocket)?;
    serde_json::from_str(&text).map_err(|error| SupervisorError::Protocol(error.to_string()))
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

#[cfg(test)]
mod tests {
    use super::{SidecarConfig, packaged_sidecar_available, to_hex, workspace_root_from_manifest};

    #[test]
    fn token_hex_encoding_never_exposes_binary_data() {
        assert_eq!(to_hex(&[0, 15, 16, 255]), "000f10ff");
    }

    #[test]
    fn workspace_sidecar_source_is_discoverable_for_development() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        assert!(packaged_sidecar_available(&config));
    }
}
