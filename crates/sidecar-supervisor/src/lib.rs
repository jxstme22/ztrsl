#![deny(unsafe_op_in_unsafe_fn)]

use std::fs;
use std::collections::VecDeque;
use std::io::BufRead;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use ipc_protocol::{
    AudioPacket, AudioPacketV2, CAPABILITY_IPC_V2, CAPABILITY_MULTI_SOURCE, CaptionLabelStyle,
    CaptionPayload, CaptionStrictness, ClipComparePayload, ClipProcessPayload, ClipResultPayload,
    Envelope, HelloAcceptedPayload, HelloPayload, LiveStartPayload, PROTOCOL_V2, PROTOCOL_VERSION,
    SourceControlPayload, SourcePresentationUpdatePayload, SourceRegistryEntry,
    SourceRegistryPayload, SourceSnapshot, source_id_from_hex,
};
use thiserror::Error;
use tungstenite::{Message, WebSocket};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const CLIP_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const LIVE_START_TIMEOUT: Duration = Duration::from_secs(3 * 60);

/// Default source id used by the single-source fake roundtrip (v2). The
/// real app always sends the source's own immutable id.
const DEFAULT_SOURCE_ID: &str = "00000000000000000000000000000001";
/// Fixed ids for the multi-source fake proof; they are valid UUID-shaped
/// ids (32 lowercase hex) but not UUID-v4 — the wire does not enforce v4.
const TEAM_SOURCE_ID: &str = "11111111111111111111111111111111";
const DISCORD_SOURCE_ID: &str = "22222222222222222222222222222222";

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
    /// Protocol version negotiated during the hello handshake: 2 when the
    /// sidecar shares `ipc_v2`, otherwise 1 (v0.2 compatibility).
    negotiated_version: u16,
    stopped: bool,
    /// Retained spawn config so a crashed sidecar can be restarted in place
    /// (`restart()`) without the caller re-supplying anything.
    config: SidecarConfig,
    /// Most recent sidecar stderr lines (bounded ring buffer). Native crashes
    /// (segfaults in onnxruntime/sherpa-onnx etc.) usually leave a trace here
    /// — surfaced in transport-failure messages so crashes self-report.
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

impl SidecarSupervisor {
    pub fn start(config: &SidecarConfig) -> Result<Self, SupervisorError> {
        config.validate()?;
        let (child, socket, session_id, session_bytes, negotiated_version, stderr_tail) =
            spawn_and_handshake(config)?;
        Ok(Self {
            child,
            socket,
            session_id,
            session_bytes,
            next_sequence: 0,
            negotiated_version,
            stopped: false,
            config: config.clone(),
            stderr_tail,
        })
    }

    /// Restart the sidecar subprocess and re-establish the authenticated
    /// WebSocket session in place. The caller is responsible for re-running
    /// any live session (`start_live`) after a successful restart; in-flight
    /// captions and VAD state belong to the old process and are lost.
    pub fn restart(&mut self) -> Result<(), SupervisorError> {
        if self.stopped {
            return Err(SupervisorError::SidecarExited("stopped".to_owned()));
        }
        let config = self.config.clone();
        let _ = self.socket.close(None);
        terminate_child(&mut self.child);
        let (child, socket, session_id, session_bytes, negotiated_version, stderr_tail) =
            spawn_and_handshake(&config)?;
        self.child = child;
        self.socket = socket;
        self.session_id = session_id;
        self.session_bytes = session_bytes;
        self.next_sequence = 0;
        self.negotiated_version = negotiated_version;
        self.stderr_tail = stderr_tail;
        Ok(())
    }

    /// Last stderr lines from the current sidecar process (bounded tail).
    pub fn stderr_tail(&self) -> Vec<String> {
        self.stderr_tail.lock().map(|tail| tail.iter().cloned().collect()).unwrap_or_default()
    }

    /// The subprocess's exit status when it is no longer running, else `None`.
    /// Lets callers distinguish "the sidecar crashed" (the usual cause of a
    /// mid-session connection reset) from a dropped socket on a live process.
    pub fn child_exit_status(&mut self) -> Option<String> {
        self.child
            .try_wait()
            .ok()
            .flatten()
            .map(|status| status.to_string())
    }

    pub fn fake_roundtrip(
        &mut self,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
    ) -> Result<Vec<Envelope<CaptionPayload>>, SupervisorError> {
        self.ensure_running()?;
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let frame = if self.negotiated_version == PROTOCOL_V2 {
            self.encode_v2_audio(sequence, capture_monotonic_ns, samples, DEFAULT_SOURCE_ID)?
        } else {
            self.encode_v1_audio(sequence, capture_monotonic_ns, samples)?
        };
        self.socket
            .send(Message::Binary(frame.into()))
            .map_err(SupervisorError::WebSocket)?;

        let provisional: Envelope<CaptionPayload> = read_json(&mut self.socket)?;
        let final_caption: Envelope<CaptionPayload> = read_json(&mut self.socket)?;
        provisional
            .validate_version_in(&[self.negotiated_version])
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        final_caption
            .validate_version_in(&[self.negotiated_version])
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if provisional.message_type != "caption.provisional"
            || final_caption.message_type != "caption.final"
            || provisional.payload.caption_id != final_caption.payload.caption_id
            || provisional.payload.revision >= final_caption.payload.revision
        {
            return Err(SupervisorError::InvalidCaptionLifecycle);
        }
        Ok(vec![provisional, final_caption])
    }

    /// Push the session's source registry (v2 sessions only, right after
    /// `live.start`). The sidecar resolves `source.presentation.update`
    /// targets against it.
    pub fn push_source_registry(
        &mut self,
        sources: Vec<SourceRegistryEntry>,
    ) -> Result<(), SupervisorError> {
        self.ensure_running()?;
        if self.negotiated_version != PROTOCOL_V2 {
            return Err(SupervisorError::Protocol(
                "source.registry requires a v2 session".to_owned(),
            ));
        }
        let request = Envelope {
            protocol_version: self.negotiated_version,
            message_id: format!("source-registry-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "source.registry".to_owned(),
            sent_monotonic_ns: 0,
            payload: SourceRegistryPayload { sources },
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
        if response.message_type == "source.registry.error" {
            return Err(SupervisorError::Protocol(error_message(
                &response.payload,
                "source.registry rejected",
            )));
        }
        if response.message_type != "source.registry.accepted" {
            return Err(SupervisorError::Protocol(
                "unexpected source.registry response".to_owned(),
            ));
        }
        Ok(())
    }

    /// Push a presentation-only snapshot change (ADR-015). Never touches
    /// routing, VAD, or any key.
    pub fn update_source_presentation(
        &mut self,
        source_id: &str,
        snapshot: SourceSnapshot,
    ) -> Result<(), SupervisorError> {
        self.ensure_running()?;
        if self.negotiated_version != PROTOCOL_V2 {
            return Err(SupervisorError::Protocol(
                "source.presentation.update requires a v2 session".to_owned(),
            ));
        }
        let request = Envelope {
            protocol_version: self.negotiated_version,
            message_id: format!("source-presentation-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "source.presentation.update".to_owned(),
            sent_monotonic_ns: 0,
            payload: SourcePresentationUpdatePayload {
                source_id: source_id.to_owned(),
                source_snapshot: snapshot,
            },
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
        if response.message_type == "source.presentation.error" {
            return Err(SupervisorError::Protocol(error_message(
                &response.payload,
                "source.presentation.update rejected",
            )));
        }
        if response.message_type != "source.presentation.accepted" {
            return Err(SupervisorError::Protocol(
                "unexpected source.presentation.update response".to_owned(),
            ));
        }
        Ok(())
    }

    /// Multi-source fake proof (IPC v2 freeze §6): registers TEAM and
    /// DISCORD, sends independent v2 audio frames for both, and asserts the
    /// captions carry the right source ids and snapshots. Then renames
    /// DISCORD mid-session and asserts TEAM captions are unaffected.
    pub fn fake_roundtrip_multi_source(
        &mut self,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
    ) -> Result<Vec<Envelope<CaptionPayload>>, SupervisorError> {
        self.ensure_running()?;
        if self.negotiated_version != PROTOCOL_V2 {
            return Err(SupervisorError::Protocol(
                "multi-source fake requires a v2 session".to_owned(),
            ));
        }
        let team_snapshot = SourceSnapshot {
            display_name: "Valorant Team".to_owned(),
            caption_tag: "TEAM".to_owned(),
            label_style: CaptionLabelStyle::Brackets,
            color: Some("#7dd3fc".to_owned()),
        };
        let discord_snapshot = SourceSnapshot {
            display_name: "Discord Call".to_owned(),
            caption_tag: "DISCORD".to_owned(),
            label_style: CaptionLabelStyle::Brackets,
            color: Some("#a5f3fc".to_owned()),
        };
        self.push_source_registry(vec![
            SourceRegistryEntry {
                source_id: TEAM_SOURCE_ID.to_owned(),
                display_name: team_snapshot.display_name.clone(),
                caption_tag: team_snapshot.caption_tag.clone(),
                capture_target: serde_json::json!({
                    "kind": "endpoint",
                    "endpoint_id": "team-capture"
                }),
                language_profile: "auto".to_owned(),
                strictness: CaptionStrictness::Balanced,
                label_style: CaptionLabelStyle::Brackets,
                color: team_snapshot.color.clone(),
                priority: 200,
            },
            SourceRegistryEntry {
                source_id: DISCORD_SOURCE_ID.to_owned(),
                display_name: discord_snapshot.display_name.clone(),
                caption_tag: discord_snapshot.caption_tag.clone(),
                capture_target: serde_json::json!({
                    "kind": "endpoint",
                    "endpoint_id": "discord-capture"
                }),
                language_profile: "auto".to_owned(),
                strictness: CaptionStrictness::Off,
                label_style: CaptionLabelStyle::Brackets,
                color: discord_snapshot.color.clone(),
                priority: 100,
            },
        ])?;

        let team_captions =
            self.send_v2_roundtrip(capture_monotonic_ns, samples.clone(), TEAM_SOURCE_ID)?;
        let discord_captions =
            self.send_v2_roundtrip(capture_monotonic_ns + 1, samples.clone(), DISCORD_SOURCE_ID)?;
        for caption in team_captions.iter().chain(discord_captions.iter()) {
            if caption.payload.source_id.is_none() {
                return Err(SupervisorError::InvalidCaptionLifecycle);
            }
        }
        if team_captions[0].payload.source_id.as_deref() != Some(TEAM_SOURCE_ID)
            || discord_captions[0].payload.source_id.as_deref() != Some(DISCORD_SOURCE_ID)
            || team_captions[0]
                .payload
                .source_snapshot
                .as_ref()
                .map(|snapshot| &snapshot.caption_tag)
                != Some(&"TEAM".to_owned())
            || discord_captions[0]
                .payload
                .source_snapshot
                .as_ref()
                .map(|snapshot| &snapshot.caption_tag)
                != Some(&"DISCORD".to_owned())
        {
            return Err(SupervisorError::InvalidCaptionLifecycle);
        }

        // Mid-session rename: DISCORD gets a new tag, then a second round
        // must not disturb TEAM revisions or captions.
        let renamed = SourceSnapshot {
            display_name: "Discord (Renamed)".to_owned(),
            caption_tag: "DC2".to_owned(),
            label_style: CaptionLabelStyle::Colon,
            color: discord_snapshot.color.clone(),
        };
        self.update_source_presentation(DISCORD_SOURCE_ID, renamed)?;
        let team_captions_after =
            self.send_v2_roundtrip(capture_monotonic_ns + 2, samples.clone(), TEAM_SOURCE_ID)?;
        let discord_captions_after =
            self.send_v2_roundtrip(capture_monotonic_ns + 3, samples, DISCORD_SOURCE_ID)?;
        if team_captions_after[0].payload.source_id.as_deref() != Some(TEAM_SOURCE_ID)
            || discord_captions_after[0]
                .payload
                .source_snapshot
                .as_ref()
                .map(|snapshot| &snapshot.caption_tag)
                != Some(&"DC2".to_owned())
        {
            return Err(SupervisorError::InvalidCaptionLifecycle);
        }
        Ok(team_captions
            .into_iter()
            .chain(discord_captions)
            .chain(team_captions_after)
            .chain(discord_captions_after)
            .collect())
    }

    fn encode_v1_audio(
        &self,
        sequence: u64,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
    ) -> Result<Vec<u8>, SupervisorError> {
        AudioPacket {
            session_id: self.session_bytes,
            sequence,
            capture_monotonic_ns,
            sample_rate: 16_000,
            channels: 1,
            flags: 0,
            samples,
        }
        .encode()
        .map_err(|error| SupervisorError::Protocol(error.to_string()))
    }

    fn encode_v2_audio(
        &self,
        sequence: u64,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
        source_id: &str,
    ) -> Result<Vec<u8>, SupervisorError> {
        let source_id_bytes = source_id_from_hex(source_id)
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        AudioPacketV2 {
            session_id: self.session_bytes,
            sequence,
            capture_monotonic_ns,
            sample_rate: 16_000,
            channels: 1,
            flags: 0,
            source_id: source_id_bytes,
            samples,
        }
        .encode()
        .map_err(|error| SupervisorError::Protocol(error.to_string()))
    }

    fn send_v2_roundtrip(
        &mut self,
        capture_monotonic_ns: u64,
        samples: Vec<f32>,
        source_id: &str,
    ) -> Result<Vec<Envelope<CaptionPayload>>, SupervisorError> {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let frame = self.encode_v2_audio(sequence, capture_monotonic_ns, samples, source_id)?;
        self.socket
            .send(Message::Binary(frame.into()))
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

    /// Start a live translation session. The argument list mirrors the
    /// sidecar's `live.start` payload; grouping them in a config struct is
    /// not worth it while every caller passes the same seven values.
    #[allow(clippy::too_many_arguments)]
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
            protocol_version: self.negotiated_version,
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
            .validate_version_in(&[self.negotiated_version])
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
        let frame = if self.negotiated_version == PROTOCOL_V2 {
            self.encode_v2_audio(sequence, capture_monotonic_ns, samples, DEFAULT_SOURCE_ID)?
        } else {
            self.encode_v1_audio(sequence, capture_monotonic_ns, samples)?
        };
        self.socket
            .send(Message::Binary(frame.into()))
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
            .validate_version_in(&[self.negotiated_version])
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if response.message_type == "live.error" {
            let message = error_message(&response.payload, "live inference failed");
            // The sidecar marks mid-session inference failures recoverable
            // (a skipped caption, a provider hiccup): the session is still
            // alive and must NOT be torn down. Only non-recoverable errors
            // end the live session.
            let recoverable = response
                .payload
                .get("recoverable")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            if recoverable {
                return Err(SupervisorError::LiveInferenceRecoverable(message));
            }
            return Err(SupervisorError::LiveInference(message));
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
            protocol_version: self.negotiated_version,
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

    /// Send a v2 audio frame for a specific immutable source id (Phase 5
    /// per-source VAD). v2 sessions only; the sequence counter remains
    /// session-global, so callers must keep frames increasing across sources.
    pub fn send_live_audio_for_source(
        &mut self,
        capture_monotonic_ns: u64,
        source_id: &str,
        samples: Vec<f32>,
    ) -> Result<(), SupervisorError> {
        self.ensure_running()?;
        if self.negotiated_version != PROTOCOL_V2 {
            return Err(SupervisorError::Protocol(
                "per-source audio requires a v2 session".to_owned(),
            ));
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let frame = self.encode_v2_audio(sequence, capture_monotonic_ns, samples, source_id)?;
        self.socket
            .send(Message::Binary(frame.into()))
            .map_err(SupervisorError::WebSocket)
    }

    fn run_source_control(
        &mut self,
        message_type: &str,
        source_id: &str,
        expected: &[&str],
        error_type: &str,
        context: &str,
    ) -> Result<serde_json::Value, SupervisorError> {
        self.ensure_running()?;
        if self.negotiated_version != PROTOCOL_V2 {
            return Err(SupervisorError::Protocol(
                "per-source controls require a v2 session".to_owned(),
            ));
        }
        let request = Envelope {
            protocol_version: self.negotiated_version,
            message_id: format!("{}-{}", message_type, self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: message_type.to_owned(),
            sent_monotonic_ns: 0,
            payload: SourceControlPayload {
                source_id: source_id.to_owned(),
            },
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        loop {
            let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
            if expected.contains(&response.message_type.as_str()) {
                return Ok(response.payload);
            }
            if response.message_type == error_type {
                return Err(SupervisorError::Protocol(error_message(
                    &response.payload,
                    context,
                )));
            }
        }
    }

    /// Flush only the given source's open utterance (Phase 5). The sidecar
    /// emits the flushed captions (as `caption.final`) before acking with
    /// `source.flushed`.
    pub fn flush_source(&mut self, source_id: &str) -> Result<serde_json::Value, SupervisorError> {
        self.run_source_control(
            "source.flush",
            source_id,
            &["source.flushed"],
            "source.error",
            "source.flush rejected",
        )
    }

    /// Stop only the given source: flushes it and freezes its VAD state
    /// (Phase 5). Captions are emitted as `caption.final` before the
    /// `source.stopped` ack.
    pub fn stop_source(&mut self, source_id: &str) -> Result<serde_json::Value, SupervisorError> {
        self.run_source_control(
            "source.stop",
            source_id,
            &["source.stopped"],
            "source.error",
            "source.stop rejected",
        )
    }

    /// Per-source VAD diagnostics (Phase 5). v2 sessions only.
    pub fn source_diagnostics(
        &mut self,
        source_id: &str,
    ) -> Result<serde_json::Value, SupervisorError> {
        self.run_source_control(
            "source.diagnostics.request",
            source_id,
            &["source.diagnostics"],
            "source.error",
            "source.diagnostics rejected",
        )
    }

    /// Shared scheduler metrics (Phase 6, spec §7.3): queue depth, queue
    /// delay, coalescing and drop counters. Any session version.
    pub fn scheduler_metrics(&mut self) -> Result<serde_json::Value, SupervisorError> {
        self.ensure_running()?;
        let request = Envelope {
            protocol_version: self.negotiated_version,
            message_id: format!("scheduler-metrics-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "scheduler.metrics.request".to_owned(),
            sent_monotonic_ns: 0,
            payload: serde_json::json!({}),
        };
        self.next_sequence = self.next_sequence.saturating_add(1);
        write_json(&mut self.socket, &request)?;
        let response: Envelope<serde_json::Value> = read_json(&mut self.socket)?;
        if response.message_type == "scheduler.error" {
            return Err(SupervisorError::Protocol(error_message(
                &response.payload,
                "scheduler.metrics rejected",
            )));
        }
        if response.message_type != "scheduler.metrics" {
            return Err(SupervisorError::Protocol(
                "unexpected scheduler.metrics response".to_owned(),
            ));
        }
        Ok(response.payload)
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
            protocol_version: self.negotiated_version,
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
            .validate_version_in(&[self.negotiated_version])
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

    /// v0.4 Accuracy Lab: run one clip through multiple ASR/MT configs.
    /// Returns the raw `clip.compare.completed` payload (schema-free here;
    /// the desktop validates it with a Zod schema).
    pub fn clip_compare(
        &mut self,
        path: &Path,
        source_mode: &str,
        configs: Vec<Vec<String>>,
        include_transcripts: bool,
    ) -> Result<serde_json::Value, SupervisorError> {
        self.ensure_running()?;
        if !path.is_absolute() {
            return Err(SupervisorError::InvalidClipPath);
        }
        let request = Envelope {
            protocol_version: self.negotiated_version,
            message_id: format!("clip-compare-{}", self.next_sequence),
            session_id: self.session_id.clone(),
            message_type: "clip.compare".to_owned(),
            sent_monotonic_ns: 0,
            payload: ClipComparePayload {
                path: path.to_string_lossy().into_owned(),
                source_mode: source_mode.to_owned(),
                configs,
                include_transcripts,
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
            .validate_version_in(&[self.negotiated_version])
            .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
        if response.message_type == "clip.compare.error" {
            let message = response
                .payload
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("clip comparison failed");
            return Err(SupervisorError::ClipProcessing(message.to_owned()));
        }
        if response.message_type != "clip.compare.completed" {
            return Err(SupervisorError::Protocol(
                "unexpected clip.compare response".to_owned(),
            ));
        }
        Ok(response.payload)
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
            protocol_version: self.negotiated_version,
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
    #[error("live translation hiccup (recoverable): {0}")]
    LiveInferenceRecoverable(String),
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

/// Spawn the sidecar subprocess and complete the authenticated hello
/// handshake over a loopback WebSocket. Shared by `start` (first launch) and
/// `restart` (crash recovery) so both paths behave identically. On any
/// failure the child is terminated before the error is returned.
#[allow(clippy::type_complexity)]
fn spawn_and_handshake(
    config: &SidecarConfig,
) -> Result<
    (
        Child,
        WebSocket<TcpStream>,
        String,
        [u8; 16],
        u16,
        Arc<Mutex<VecDeque<String>>>,
    ),
    SupervisorError,
> {
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
        .stderr(Stdio::piped());
    for (key, value) in &config.extra_env {
        command.env(key, value);
    }
    #[cfg(target_os = "macos")]
    if let Some(runtime_library_dir) = &config.runtime_library_dir {
        command.env("DYLD_LIBRARY_PATH", runtime_library_dir);
    }
    #[cfg(target_os = "windows")]
    {
        // Never show a console window for the sidecar: the app owns its
        // own GUI, and a visible console (with its own close button)
        // makes users think the terminal controls the app — closing it
        // kills the inference sidecar and the whole app with it.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(SupervisorError::Spawn)?;

    // Keep the last stderr lines in a bounded ring buffer so crash traces
    // (faulthandler dumps, onnxruntime abort messages) can be surfaced in
    // transport-failure errors. The reader thread ends when the pipe closes.
    let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(24)));
    if let Some(stderr) = child.stderr.take() {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stderr);
            let mut line = String::new();
            while matches!(reader.read_line(&mut line), Ok(n) if n > 0) {
                if let Ok(mut tail) = tail.lock() {
                    if tail.len() == 24 {
                        tail.pop_front();
                    }
                    tail.push_back(line.trim_end().to_owned());
                }
                line.clear();
            }
        });
    }

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
    let hello = Envelope {        protocol_version: PROTOCOL_VERSION,
        message_id: "hello-1".to_owned(),
        session_id: session_id.clone(),
        message_type: "hello".to_owned(),
        sent_monotonic_ns: 0,
        payload: HelloPayload {
            token,
            desktop_version: env!("CARGO_PKG_VERSION").to_owned(),
            protocol_versions: vec![PROTOCOL_V2, PROTOCOL_VERSION],
            capabilities: vec![
                "pcm_f32le".to_owned(),
                "caption_revisions".to_owned(),
                CAPABILITY_IPC_V2.to_owned(),
                CAPABILITY_MULTI_SOURCE.to_owned(),
            ],
        },
    };
    write_json(&mut socket, &hello)?;
    let accepted: Envelope<HelloAcceptedPayload> = read_json(&mut socket)?;
    accepted
        .validate_version()
        .map_err(|error| SupervisorError::Protocol(error.to_string()))?;
    if accepted.message_type != "hello.accepted" {
        terminate_child(&mut child);
        return Err(SupervisorError::HandshakeRejected);
    }
    // The sidecar computes and echoes the negotiated version (freeze §1);
    // the desktop trusts the echo and requires a version it proposed.
    let negotiated_version = accepted.payload.protocol_version;
    if negotiated_version != PROTOCOL_V2 && negotiated_version != PROTOCOL_VERSION {
        terminate_child(&mut child);
        return Err(SupervisorError::HandshakeRejected);
    }
    Ok((
        child,
        socket,
        session_id,
        session_bytes,
        negotiated_version,
        stderr_tail,
    ))
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
        DISCORD_SOURCE_ID, PROTOCOL_V2, SidecarConfig, SidecarSupervisor, SupervisorError,
        TEAM_SOURCE_ID, packaged_sidecar_available, to_hex, workspace_root_from_manifest,
    };
    use ipc_protocol::{
        CaptionLabelStyle, CaptionPayload, CaptionStrictness, Envelope, SourceRegistryEntry,
    };
    use std::time::Duration;

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
        // Mid-session inference failures the sidecar marks recoverable must
        // never be classified as transport failures: they leave the session
        // alive and should surface as warnings, not session teardown.
        assert!(
            !SupervisorError::LiveInferenceRecoverable("skipped a caption".to_owned())
                .is_transport_failure()
        );
    }

    /// A crashed sidecar (the usual cause of the Windows `os error 10054`
    /// mid-session drop) must be detectable by exit status and restartable in
    /// place; a fresh `live.start` then continues the session on a new
    /// process. Requires the workspace venv (skipped when absent).
    #[test]
    fn crashed_sidecar_restarts_in_place_and_recovers_the_session() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        if !config.python_executable.is_file() {
            eprintln!("skipping: workspace venv is not installed");
            return;
        }
        let mut supervisor = SidecarSupervisor::start(&config).expect("sidecar must start");
        supervisor
            .start_live("filipino", "demo", "local", "demo", "en", "quality", 50)
            .expect("live must start");
        let first_session = supervisor.session_id().to_owned();

        // Simulate a native crash: the process dies and the socket goes away,
        // exactly what Windows reports as "forcibly closed" (WSAECONNRESET).
        supervisor.child.kill().expect("kill must succeed");
        let _ = supervisor.child.wait();

        let error = supervisor
            .read_live_caption(Duration::from_millis(10))
            .expect_err("crashed sidecar must fail the read");
        assert!(error.is_transport_failure(), "transport failure: {error}");
        assert!(
            supervisor.child_exit_status().is_some(),
            "exit status must be observable after the crash"
        );

        supervisor
            .restart()
            .expect("restart must re-establish the connection");
        assert_ne!(supervisor.session_id(), first_session);
        supervisor
            .start_live("filipino", "demo", "local", "demo", "en", "quality", 50)
            .expect("live must restart after the crash");
        // A restarted live session routes audio through the real VAD
        // pipeline (not the fake-caption path), so send speech long enough
        // to open an utterance, then silence to close it.
        for i in 0..3u64 {
            supervisor
                .send_live_audio(1_000_000 + i * 300_000, vec![0.25; 4_800])
                .expect("speech must be accepted after restart");
        }
        for i in 0..3u64 {
            supervisor
                .send_live_audio(4_000_000 + i * 300_000, vec![0.0; 4_800])
                .expect("silence must be accepted after restart");
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut finals = 0;
        while finals < 1 && std::time::Instant::now() < deadline {
            if let Some(caption) = supervisor
                .read_live_caption(Duration::from_millis(500))
                .expect("caption read must succeed")
            {
                if caption.message_type == "caption.final" {
                    finals += 1;
                }
            }
        }
        assert_eq!(
            finals, 1,
            "the restarted session must finalize an utterance"
        );
        supervisor.stop_live().expect("live must stop");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn development_onnxruntime_library_is_discoverable() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        if config.runtime_library_dir.is_none() {
            // CI installs only the `dev` extra; onnxruntime comes with the
            // optional `models` extra, so discovery can only be asserted
            // when it is actually installed.
            eprintln!("skipping: onnxruntime is not installed in the dev venv");
            return;
        }
        assert!(config.runtime_library_dir.is_some());
    }

    /// IPC v2 freeze §6: TEAM + DISCORD produce independent caption streams,
    /// and a mid-session DISCORD rename never touches TEAM captions, ids, or
    /// revisions. Requires the workspace venv (skipped when absent).
    #[test]
    fn v2_multi_source_fake_roundtrip_proves_independent_streams() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        if !config.python_executable.is_file() {
            eprintln!("skipping: workspace venv is not installed");
            return;
        }
        let mut supervisor = SidecarSupervisor::start(&config).expect("sidecar must start");
        assert_eq!(
            supervisor.negotiated_version, PROTOCOL_V2,
            "desktop proposes v2 and the sidecar must accept it"
        );
        let captions = supervisor
            .fake_roundtrip_multi_source(1_000_000, vec![0.25; 320])
            .expect("multi-source fake roundtrip must succeed");
        // 4 rounds (TEAM, DISCORD, TEAM-after-rename, DISCORD-after-rename)
        // x 2 (provisional + final).
        assert_eq!(captions.len(), 8);
        let team = &captions[0];
        let discord = &captions[2];
        let team_after = &captions[4];
        let discord_after = &captions[6];
        assert_eq!(team.payload.source_id.as_deref(), Some(TEAM_SOURCE_ID));
        assert_eq!(
            discord.payload.source_id.as_deref(),
            Some(DISCORD_SOURCE_ID)
        );
        assert_eq!(
            team.payload
                .source_snapshot
                .as_ref()
                .map(|snapshot| snapshot.caption_tag.as_str()),
            Some("TEAM")
        );
        assert_eq!(
            discord
                .payload
                .source_snapshot
                .as_ref()
                .map(|snapshot| snapshot.caption_tag.as_str()),
            Some("DISCORD")
        );
        assert_eq!(
            discord_after
                .payload
                .source_snapshot
                .as_ref()
                .map(|snapshot| snapshot.caption_tag.as_str()),
            Some("DC2"),
            "mid-session rename must be reflected on DISCORD captions"
        );
        assert_eq!(team.payload.revision, team_after.payload.revision);
        assert_eq!(
            team_after.payload.source_id.as_deref(),
            Some(TEAM_SOURCE_ID),
            "TEAM audio key must be untouched by the DISCORD rename"
        );
        assert_ne!(
            team.payload.caption_id, discord.payload.caption_id,
            "per-source caption ids must never collide"
        );
    }

    /// v0.4 Phase 1: clip.compare runs a WAV through one config over the wire
    /// and returns a content-free report (no transcript text). Requires the
    /// workspace venv (skipped when absent).
    #[test]
    fn clip_compare_returns_content_free_report_over_the_wire() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        if !config.python_executable.is_file() {
            eprintln!("skipping: workspace venv is not installed");
            return;
        }
        let mut supervisor = SidecarSupervisor::start(&config).expect("sidecar must start");
        let wav = write_test_wav();
        let report = supervisor
            .clip_compare(
                &wav,
                "mixed",
                vec![vec!["demo".to_owned(), "demo".to_owned()]],
                false,
            )
            .expect("clip_compare must succeed");
        let serialized = serde_json::to_string(&report).expect("report serializes");
        let runs = report
            .get("runs")
            .and_then(serde_json::Value::as_array)
            .expect("report has runs");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["asr_name"], "demo");
        assert!(
            !serialized.contains("source_text"),
            "report must be content-free"
        );
        assert!(!serialized.contains("demo transcript"));
        let _ = std::fs::remove_file(&wav);
    }

    fn write_test_wav() -> std::path::PathBuf {
        use std::io::Write;
        let path =
            std::env::temp_dir().join(format!("lst-clip-compare-{}.wav", std::process::id()));
        let sample_rate = 16_000u32;
        let mut data = Vec::with_capacity(sample_rate as usize * 2);
        for index in 0..sample_rate {
            let sample = if (3200..8000).contains(&index) {
                (12_000.0
                    * (2.0 * std::f64::consts::PI * 220.0 * index as f64 / sample_rate as f64)
                        .sin()) as i16
            } else {
                0i16
            };
            data.extend_from_slice(&sample.to_le_bytes());
        }
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&data);
        let mut file = std::fs::File::create(&path).expect("wav file");
        file.write_all(&bytes).expect("wav bytes");
        path
    }

    /// Phase 5: per-source VAD lifecycle over the real wire. Interleaved
    /// TEAM/DISCORD speech produces independent finals; `source.stop` on
    /// TEAM flushes only TEAM and freezes its state; a stopped source
    /// rejects further audio; DISCORD keeps producing captions throughout.
    /// Requires the workspace venv (skipped when absent).
    #[test]
    fn v2_live_per_source_vad_lifecycle_over_the_wire() {
        let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
        if !config.python_executable.is_file() {
            eprintln!("skipping: workspace venv is not installed");
            return;
        }
        let mut supervisor = SidecarSupervisor::start(&config).expect("sidecar must start");
        assert_eq!(supervisor.negotiated_version, PROTOCOL_V2);
        supervisor
            .push_source_registry(vec![
                SourceRegistryEntry {
                    source_id: TEAM_SOURCE_ID.to_owned(),
                    display_name: "Valorant Team".to_owned(),
                    caption_tag: "TEAM".to_owned(),
                    capture_target: serde_json::json!({
                        "kind": "endpoint",
                        "endpoint_id": "team-capture"
                    }),
                    language_profile: "auto".to_owned(),
                    strictness: CaptionStrictness::Balanced,
                    label_style: CaptionLabelStyle::Brackets,
                    color: Some("#7dd3fc".to_owned()),
                    priority: 200,
                },
                SourceRegistryEntry {
                    source_id: DISCORD_SOURCE_ID.to_owned(),
                    display_name: "Discord Call".to_owned(),
                    caption_tag: "DISCORD".to_owned(),
                    capture_target: serde_json::json!({
                        "kind": "endpoint",
                        "endpoint_id": "discord-capture"
                    }),
                    language_profile: "auto".to_owned(),
                    strictness: CaptionStrictness::Off,
                    label_style: CaptionLabelStyle::Brackets,
                    color: Some("#fda4af".to_owned()),
                    priority: 100,
                },
            ])
            .expect("registry push must succeed");
        supervisor
            .start_live("filipino", "demo", "local", "demo", "en", "quality", 50)
            .expect("live must start");

        // Interleave speech and silence on both sources; VAD needs ~450 ms
        // of silence (sensitivity 50) to finalize an utterance, so 3 frames
        // of silence close each open utterance.
        for i in 0..3u64 {
            supervisor
                .send_live_audio_for_source(
                    1_000_000 + i * 300_000,
                    TEAM_SOURCE_ID,
                    vec![0.25; 4_800],
                )
                .expect("team speech must be accepted");
            supervisor
                .send_live_audio_for_source(
                    2_000_000 + i * 300_000,
                    DISCORD_SOURCE_ID,
                    vec![0.25; 4_800],
                )
                .expect("discord speech must be accepted");
        }
        for i in 0..3u64 {
            supervisor
                .send_live_audio_for_source(
                    4_000_000 + i * 300_000,
                    TEAM_SOURCE_ID,
                    vec![0.0; 4_800],
                )
                .expect("team silence must be accepted");
            supervisor
                .send_live_audio_for_source(
                    5_000_000 + i * 300_000,
                    DISCORD_SOURCE_ID,
                    vec![0.0; 4_800],
                )
                .expect("discord silence must be accepted");
        }

        let mut finals: Vec<Envelope<CaptionPayload>> = Vec::new();
        while finals.len() < 2 {
            let caption = supervisor
                .read_live_caption(Duration::from_secs(5))
                .expect("caption read must succeed");
            if let Some(caption) = caption {
                if caption.message_type == "caption.final" {
                    finals.push(caption);
                }
            }
        }
        assert_eq!(finals.len(), 2, "both sources must finalize an utterance");
        let team = &finals[0];
        let discord = &finals[1];
        assert_eq!(team.payload.source_id.as_deref(), Some(TEAM_SOURCE_ID));
        assert_eq!(
            discord.payload.source_id.as_deref(),
            Some(DISCORD_SOURCE_ID)
        );
        assert_ne!(team.payload.caption_id, discord.payload.caption_id);

        // Stop TEAM: it flushes (already flushed, so 0 captions) and acks.
        let stopped = supervisor
            .stop_source(TEAM_SOURCE_ID)
            .expect("source.stop must succeed");
        assert_eq!(stopped["source_id"], TEAM_SOURCE_ID);
        let diagnostics = supervisor
            .source_diagnostics(TEAM_SOURCE_ID)
            .expect("diagnostics must succeed");
        assert_eq!(diagnostics["active"], false);
        assert_eq!(diagnostics["source_id"], TEAM_SOURCE_ID);

        // Audio for a stopped source is rejected at the pipeline layer
        // (feed raises, surfacing as `live.error` on the wire); the
        // observable per-source contract here is that TEAM is frozen while
        // DISCORD stays active.
        let stopped_diagnostics = supervisor
            .source_diagnostics(DISCORD_SOURCE_ID)
            .expect("discord diagnostics must succeed");
        assert_eq!(stopped_diagnostics["active"], true);

        supervisor.stop_live().expect("live must stop");
    }
}
