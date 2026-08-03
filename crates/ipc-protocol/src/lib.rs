#![deny(unsafe_op_in_unsafe_fn)]

use std::net::IpAddr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PROTOCOL_VERSION: u16 = 1;
pub const PROTOCOL_V2: u16 = 2;
pub const MAX_CONTROL_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_AUDIO_MESSAGE_BYTES: usize = 256 * 1024;
pub const AUDIO_HEADER_BYTES: usize = 50;
pub const AUDIO_HEADER_V2_BYTES: usize = 66;
const AUDIO_MAGIC: [u8; 4] = *b"LSTA";

/// Negotiated-capability names (v2). The desktop advertises these in the
/// `HelloPayload.capabilities` list; the sidecar's `hello.accepted` echoes
/// the negotiated protocol version.
pub const CAPABILITY_IPC_V2: &str = "ipc_v2";
pub const CAPABILITY_MULTI_SOURCE: &str = "multi_source";

/// Highest protocol version both peers propose, or `None` when they share
/// none. Proposals are ordered most-preferred first.
pub fn negotiate_protocol_version(proposed: &[u16], supported: &[u16]) -> Option<u16> {
    proposed
        .iter()
        .copied()
        .find(|version| supported.contains(version))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Envelope<T> {
    pub protocol_version: u16,
    pub message_id: String,
    pub session_id: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub sent_monotonic_ns: u64,
    pub payload: T,
}

impl<T> Envelope<T> {
    pub fn validate_version(&self) -> Result<(), ProtocolError> {
        self.validate_version_in(&[PROTOCOL_VERSION])
    }

    /// Validate against an explicit set of supported versions (used after
    /// v1/v2 negotiation).
    pub fn validate_version_in(&self, supported: &[u16]) -> Result<(), ProtocolError> {
        if supported.contains(&self.protocol_version) {
            Ok(())
        } else {
            Err(ProtocolError::VersionMismatch {
                expected: supported.first().copied().unwrap_or_default(),
                received: self.protocol_version,
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HelloPayload {
    pub token: String,
    pub desktop_version: String,
    pub protocol_versions: Vec<u16>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HelloAcceptedPayload {
    pub protocol_version: u16,
    pub sidecar_version: String,
    pub models: ModelStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelStatus {
    pub vad: String,
    pub asr: String,
    pub translation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CaptionPayload {
    pub caption_id: String,
    pub utterance_id: String,
    pub revision: u32,
    pub status: CaptionStatus,
    pub source_mode: SourceMode,
    pub source_text: String,
    pub english_text: String,
    pub started_monotonic_ns: u64,
    pub ended_monotonic_ns: Option<u64>,
    pub capture_to_caption_ms: f64,
    pub asr_ms: f64,
    pub translation_ms: f64,
    pub confidence: Option<f32>,
    pub warnings: Vec<CaptionWarning>,
    // ---- v2 fields (IPC v2 sessions only) ----
    /// Immutable source identity (32-char lowercase hex). Absent in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// Presentation state stamped at send time (ADR-015). Absent in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_snapshot: Option<SourceSnapshot>,
    /// Per-source language strictness (ADR-016). Absent in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strictness: Option<CaptionStrictness>,
    /// Language-gate outcome. Absent in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_applied: Option<FilterApplied>,
    /// Machine-readable reason when `filter_applied` is not `off`/`passed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_reason: Option<String>,
}

/// Presentation metadata stamped onto v2 captions (IPC v2 freeze §3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceSnapshot {
    pub display_name: String,
    pub caption_tag: String,
    #[serde(rename = "label_style")]
    pub label_style: CaptionLabelStyle,
    /// `#RRGGBB` / `#RRGGBBAA`, or `None` for the app default.
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptionLabelStyle {
    Brackets,
    Colon,
    Bullet,
    Stacked,
    Hidden,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptionStrictness {
    Off,
    Balanced,
    Strict,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilterApplied {
    Off,
    Suppressed,
    Flagged,
    Passed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptionStatus {
    Provisional,
    Final,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    Filipino,
    Cebuano,
    English,
    Chinese,
    Mixed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptionWarning {
    LowConfidence,
    ForcedSplit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipProcessPayload {
    pub path: String,
    pub source_mode: String,
    pub provider: String,
}

/// v0.4 Accuracy Lab: run one clip through multiple ASR/MT configurations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipComparePayload {
    pub path: String,
    pub source_mode: String,
    /// Each entry is `[asr_name, translation_name]`; empty = known configs.
    #[serde(default)]
    pub configs: Vec<Vec<String>>,
    /// When true the report includes transcripts (offline review only).
    #[serde(default)]
    pub include_transcripts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LiveStartPayload {
    pub source_mode: String,
    pub provider: String,
    pub asr_provider: String,
    pub translation_provider: String,
    /// Translation output language: "en" (English) or "zh" (simplified
    /// Chinese); applies to the local NLLB provider.
    #[serde(default = "default_target_language")]
    pub target_language: String,
    pub resource_profile: String,
    /// 0..100 VAD sensitivity slider. 50 is the baseline. Higher means
    /// quieter speech is treated as speech and utterances close sooner.
    #[serde(default = "default_vad_sensitivity")]
    pub vad_sensitivity: u8,
}

pub fn default_vad_sensitivity() -> u8 {
    50
}

pub fn default_target_language() -> String {
    "en".to_string()
}

/// One entry of the `source.registry` control (IPC v2 freeze §4.2). The
/// desktop pushes the full registry right after `live.start` so the sidecar
/// can resolve `source.presentation.update` targets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceRegistryEntry {
    pub source_id: String,
    pub display_name: String,
    pub caption_tag: String,
    pub capture_target: serde_json::Value,
    pub language_profile: String,
    pub strictness: CaptionStrictness,
    pub label_style: CaptionLabelStyle,
    pub color: Option<String>,
    /// Scheduling priority (spec §7.2): higher numbers decode first within
    /// the final/provisional tiers. Never derived from names or tags.
    #[serde(default = "default_source_priority")]
    pub priority: u32,
}

fn default_source_priority() -> u32 {
    100
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceRegistryPayload {
    pub sources: Vec<SourceRegistryEntry>,
}

/// Control used by the desktop to push a presentation-only snapshot change
/// for one source (ADR-015). The sidecar errors `unknown_source` when the
/// `source_id` is not in the pushed registry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourcePresentationUpdatePayload {
    pub source_id: String,
    pub source_snapshot: SourceSnapshot,
}

/// Payload for per-source controls (Phase 5): `source.flush`,
/// `source.stop`, and `source.diagnostics.request` all carry only the
/// immutable `source_id`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceControlPayload {
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipResultPayload {
    pub metadata: ClipMetadata,
    pub captions: Vec<ClipCaption>,
    pub truncated: bool,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipMetadata {
    pub display_name: String,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipCaption {
    pub utterance_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub source_mode: String,
    pub source_text: String,
    pub english_text: String,
    pub forced_split: bool,
    pub provider: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioPacket {
    pub session_id: [u8; 16],
    pub sequence: u64,
    pub capture_monotonic_ns: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub flags: u16,
    pub samples: Vec<f32>,
}

impl AudioPacket {
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        if self.sample_rate == 0 || self.channels == 0 {
            return Err(ProtocolError::InvalidAudioHeader);
        }
        let sample_count =
            u32::try_from(self.samples.len()).map_err(|_| ProtocolError::MessageTooLarge)?;
        let expected_size = AUDIO_HEADER_BYTES
            .checked_add(
                self.samples
                    .len()
                    .checked_mul(size_of::<f32>())
                    .ok_or(ProtocolError::MessageTooLarge)?,
            )
            .ok_or(ProtocolError::MessageTooLarge)?;
        if expected_size > MAX_AUDIO_MESSAGE_BYTES {
            return Err(ProtocolError::MessageTooLarge);
        }

        let mut bytes = Vec::with_capacity(expected_size);
        bytes.extend_from_slice(&AUDIO_MAGIC);
        bytes.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
        bytes.extend_from_slice(&self.flags.to_le_bytes());
        bytes.extend_from_slice(&self.session_id);
        bytes.extend_from_slice(&self.sequence.to_le_bytes());
        bytes.extend_from_slice(&self.capture_monotonic_ns.to_le_bytes());
        bytes.extend_from_slice(&self.sample_rate.to_le_bytes());
        bytes.extend_from_slice(&self.channels.to_le_bytes());
        bytes.extend_from_slice(&sample_count.to_le_bytes());
        for sample in &self.samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        validate_audio_message_size(bytes)?;
        if bytes.len() < AUDIO_HEADER_BYTES || bytes[..4] != AUDIO_MAGIC {
            return Err(ProtocolError::InvalidAudioHeader);
        }
        let version = u16::from_le_bytes([bytes[4], bytes[5]]);
        if version != PROTOCOL_VERSION {
            return Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                received: version,
            });
        }
        let flags = read_u16(bytes, 6)?;
        let mut session_id = [0_u8; 16];
        session_id.copy_from_slice(&bytes[8..24]);
        let sequence = read_u64(bytes, 24)?;
        let capture_monotonic_ns = read_u64(bytes, 32)?;
        let sample_rate = read_u32(bytes, 40)?;
        let channels = read_u16(bytes, 44)?;
        let sample_count = read_u32(bytes, 46)? as usize;
        if sample_rate == 0 || channels == 0 {
            return Err(ProtocolError::InvalidAudioHeader);
        }
        let payload_bytes = sample_count
            .checked_mul(size_of::<f32>())
            .ok_or(ProtocolError::MessageTooLarge)?;
        if AUDIO_HEADER_BYTES + payload_bytes != bytes.len() {
            return Err(ProtocolError::InvalidAudioPayload);
        }
        let samples = bytes[AUDIO_HEADER_BYTES..]
            .chunks_exact(size_of::<f32>())
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        Ok(Self {
            session_id,
            sequence,
            capture_monotonic_ns,
            sample_rate,
            channels,
            flags,
            samples,
        })
    }
}

/// v2 audio frame: v1 header plus a 16-byte immutable `source_id` at offset
/// 50 (IPC v2 freeze §2). Total header 66 bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioPacketV2 {
    pub session_id: [u8; 16],
    pub sequence: u64,
    pub capture_monotonic_ns: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub flags: u16,
    /// Raw bytes of the immutable source UUID. Must be 16 bytes.
    pub source_id: [u8; 16],
    pub samples: Vec<f32>,
}

impl AudioPacketV2 {
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        if self.sample_rate == 0 || self.channels == 0 {
            return Err(ProtocolError::InvalidAudioHeader);
        }
        let sample_count =
            u32::try_from(self.samples.len()).map_err(|_| ProtocolError::MessageTooLarge)?;
        let expected_size = AUDIO_HEADER_V2_BYTES
            .checked_add(
                self.samples
                    .len()
                    .checked_mul(size_of::<f32>())
                    .ok_or(ProtocolError::MessageTooLarge)?,
            )
            .ok_or(ProtocolError::MessageTooLarge)?;
        if expected_size > MAX_AUDIO_MESSAGE_BYTES {
            return Err(ProtocolError::MessageTooLarge);
        }

        let mut bytes = Vec::with_capacity(expected_size);
        bytes.extend_from_slice(&AUDIO_MAGIC);
        bytes.extend_from_slice(&PROTOCOL_V2.to_le_bytes());
        bytes.extend_from_slice(&self.flags.to_le_bytes());
        bytes.extend_from_slice(&self.session_id);
        bytes.extend_from_slice(&self.sequence.to_le_bytes());
        bytes.extend_from_slice(&self.capture_monotonic_ns.to_le_bytes());
        bytes.extend_from_slice(&self.sample_rate.to_le_bytes());
        bytes.extend_from_slice(&self.channels.to_le_bytes());
        bytes.extend_from_slice(&sample_count.to_le_bytes());
        bytes.extend_from_slice(&self.source_id);
        for sample in &self.samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        validate_audio_message_size(bytes)?;
        if bytes.len() < AUDIO_HEADER_V2_BYTES || bytes[..4] != AUDIO_MAGIC {
            return Err(ProtocolError::InvalidAudioHeader);
        }
        let version = u16::from_le_bytes([bytes[4], bytes[5]]);
        if version != PROTOCOL_V2 {
            return Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_V2,
                received: version,
            });
        }
        let flags = read_u16(bytes, 6)?;
        let mut session_id = [0_u8; 16];
        session_id.copy_from_slice(&bytes[8..24]);
        let sequence = read_u64(bytes, 24)?;
        let capture_monotonic_ns = read_u64(bytes, 32)?;
        let sample_rate = read_u32(bytes, 40)?;
        let channels = read_u16(bytes, 44)?;
        let sample_count = read_u32(bytes, 46)? as usize;
        if sample_rate == 0 || channels == 0 {
            return Err(ProtocolError::InvalidAudioHeader);
        }
        let mut source_id = [0_u8; 16];
        source_id.copy_from_slice(&bytes[50..66]);
        let payload_bytes = sample_count
            .checked_mul(size_of::<f32>())
            .ok_or(ProtocolError::MessageTooLarge)?;
        if AUDIO_HEADER_V2_BYTES + payload_bytes != bytes.len() {
            return Err(ProtocolError::InvalidAudioPayload);
        }
        let samples = bytes[AUDIO_HEADER_V2_BYTES..]
            .chunks_exact(size_of::<f32>())
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        Ok(Self {
            session_id,
            sequence,
            capture_monotonic_ns,
            sample_rate,
            channels,
            flags,
            source_id,
            samples,
        })
    }
}

/// Validate a JSON-form source id (32 lowercase hex chars). Returns the raw
/// 16 bytes for the binary header slot.
pub fn source_id_from_hex(hex: &str) -> Result<[u8; 16], ProtocolError> {
    let bytes = hex.as_bytes();
    if bytes.len() != 32 {
        return Err(ProtocolError::InvalidSourceId);
    }
    let mut raw = [0_u8; 16];
    for chunk in bytes.chunks_exact(2).enumerate() {
        let hi = (chunk.1[0] as char).to_digit(16);
        let lo = (chunk.1[1] as char).to_digit(16);
        match (hi, lo) {
            (Some(hi), Some(lo)) => raw[chunk.0] = ((hi << 4) | lo) as u8,
            _ => return Err(ProtocolError::InvalidSourceId),
        }
    }
    Ok(raw)
}

pub fn source_id_to_hex(raw: &[u8; 16]) -> String {
    raw.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug)]
pub struct Authenticator {
    expected_token: String,
    authenticated: bool,
    failed_attempts: u8,
    last_audio_sequence: Option<u64>,
}

impl Authenticator {
    #[must_use]
    pub fn new(expected_token: String) -> Self {
        Self {
            expected_token,
            authenticated: false,
            failed_attempts: 0,
            last_audio_sequence: None,
        }
    }

    pub fn authenticate(
        &mut self,
        peer_ip: IpAddr,
        hello: &HelloPayload,
    ) -> Result<(), ProtocolError> {
        if !peer_ip.is_loopback() {
            return Err(ProtocolError::NonLoopbackPeer);
        }
        if self.authenticated {
            return Err(ProtocolError::AlreadyAuthenticated);
        }
        if self.failed_attempts >= 3 {
            return Err(ProtocolError::TooManyAuthFailures);
        }
        if !constant_time_equal(self.expected_token.as_bytes(), hello.token.as_bytes()) {
            self.failed_attempts = self.failed_attempts.saturating_add(1);
            return Err(ProtocolError::AuthenticationFailed);
        }
        if !hello.protocol_versions.contains(&PROTOCOL_VERSION) {
            return Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                received: hello.protocol_versions.first().copied().unwrap_or_default(),
            });
        }
        self.authenticated = true;
        Ok(())
    }

    pub fn accept_audio_sequence(&mut self, sequence: u64) -> Result<(), ProtocolError> {
        if !self.authenticated {
            return Err(ProtocolError::AuthenticationRequired);
        }
        if self
            .last_audio_sequence
            .is_some_and(|previous| sequence <= previous)
        {
            return Err(ProtocolError::StaleSequence);
        }
        self.last_audio_sequence = Some(sequence);
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("protocol version mismatch: expected {expected}, received {received}")]
    VersionMismatch { expected: u16, received: u16 },
    #[error("message exceeds the configured size limit")]
    MessageTooLarge,
    #[error("invalid binary audio header")]
    InvalidAudioHeader,
    #[error("binary audio payload length does not match its header")]
    InvalidAudioPayload,
    #[error("IPC peer must be a loopback address")]
    NonLoopbackPeer,
    #[error("IPC authentication failed")]
    AuthenticationFailed,
    #[error("IPC authentication is required")]
    AuthenticationRequired,
    #[error("IPC client has already authenticated")]
    AlreadyAuthenticated,
    #[error("too many IPC authentication failures")]
    TooManyAuthFailures,
    #[error("stale or repeated audio sequence")]
    StaleSequence,
    #[error("invalid immutable source id")]
    InvalidSourceId,
}

pub fn validate_control_message_size(bytes: &[u8]) -> Result<(), ProtocolError> {
    if bytes.len() <= MAX_CONTROL_MESSAGE_BYTES {
        Ok(())
    } else {
        Err(ProtocolError::MessageTooLarge)
    }
}

pub fn validate_audio_message_size(bytes: &[u8]) -> Result<(), ProtocolError> {
    if bytes.len() <= MAX_AUDIO_MESSAGE_BYTES {
        Ok(())
    } else {
        Err(ProtocolError::MessageTooLarge)
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    let longest = left.len().max(right.len());
    for index in 0..longest {
        let left_byte = left.get(index).copied().unwrap_or_default();
        let right_byte = right.get(index).copied().unwrap_or_default();
        difference |= usize::from(left_byte ^ right_byte);
    }
    difference == 0
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProtocolError> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or(ProtocolError::InvalidAudioHeader)?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProtocolError> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or(ProtocolError::InvalidAudioHeader)?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProtocolError> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or(ProtocolError::InvalidAudioHeader)?;
    Ok(u64::from_le_bytes([
        value[0], value[1], value[2], value[3], value[4], value[5], value[6], value[7],
    ]))
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::{
        AUDIO_HEADER_V2_BYTES, AudioPacket, AudioPacketV2, Authenticator, CaptionLabelStyle,
        CaptionPayload, CaptionStatus, CaptionStrictness, Envelope, FilterApplied, HelloPayload,
        MAX_AUDIO_MESSAGE_BYTES, MAX_CONTROL_MESSAGE_BYTES, PROTOCOL_V2, PROTOCOL_VERSION,
        ProtocolError, SourceMode, SourceSnapshot, negotiate_protocol_version, source_id_from_hex,
        source_id_to_hex, validate_control_message_size,
    };

    fn hello(token: &str) -> HelloPayload {
        HelloPayload {
            token: token.to_owned(),
            desktop_version: "0.1.0".to_owned(),
            protocol_versions: vec![PROTOCOL_VERSION],
            capabilities: vec!["pcm_f32le".to_owned()],
        }
    }

    fn packet(sequence: u64) -> AudioPacket {
        AudioPacket {
            session_id: [7; 16],
            sequence,
            capture_monotonic_ns: 42,
            sample_rate: 16_000,
            channels: 1,
            flags: 0,
            samples: vec![0.25, -0.5, 0.75],
        }
    }

    #[test]
    fn rejects_incompatible_protocol_versions() {
        let envelope = Envelope {
            protocol_version: PROTOCOL_VERSION + 1,
            message_id: "message-1".to_owned(),
            session_id: "session-1".to_owned(),
            message_type: "health".to_owned(),
            sent_monotonic_ns: 42,
            payload: (),
        };

        assert_eq!(
            envelope.validate_version(),
            Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                received: PROTOCOL_VERSION + 1,
            })
        );
    }

    #[test]
    fn rejects_oversized_control_messages() {
        let oversized = vec![0_u8; MAX_CONTROL_MESSAGE_BYTES + 1];
        assert_eq!(
            validate_control_message_size(&oversized),
            Err(ProtocolError::MessageTooLarge)
        );
    }

    #[test]
    fn serializes_message_type_using_external_schema_name() {
        let envelope = Envelope {
            protocol_version: PROTOCOL_VERSION,
            message_id: "message-1".to_owned(),
            session_id: "session-1".to_owned(),
            message_type: "health".to_owned(),
            sent_monotonic_ns: 42,
            payload: (),
        };

        let serialized = serde_json::to_value(envelope).expect("envelope should serialize");
        assert_eq!(serialized["type"], "health");
        assert!(serialized.get("message_type").is_none());
    }

    #[test]
    fn audio_packet_round_trips_and_rejects_wrong_lengths() {
        let original = packet(1);
        let encoded = original.encode().expect("packet should encode");
        assert_eq!(
            AudioPacket::decode(&encoded).expect("packet should decode"),
            original
        );
        let truncated = &encoded[..encoded.len() - 1];
        assert_eq!(
            AudioPacket::decode(truncated),
            Err(ProtocolError::InvalidAudioPayload)
        );
        assert_eq!(
            AudioPacket::decode(&vec![0; MAX_AUDIO_MESSAGE_BYTES + 1]),
            Err(ProtocolError::MessageTooLarge)
        );
    }

    #[test]
    fn authentication_requires_loopback_and_the_launch_token() {
        let mut auth = Authenticator::new("correct-token".to_owned());
        assert_eq!(
            auth.authenticate(
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
                &hello("correct-token")
            ),
            Err(ProtocolError::NonLoopbackPeer)
        );
        assert_eq!(
            auth.authenticate(IpAddr::V4(Ipv4Addr::LOCALHOST), &hello("wrong")),
            Err(ProtocolError::AuthenticationFailed)
        );
        assert_eq!(
            auth.authenticate(IpAddr::V4(Ipv4Addr::LOCALHOST), &hello("correct-token")),
            Ok(())
        );
        assert_eq!(
            auth.authenticate(IpAddr::V4(Ipv4Addr::LOCALHOST), &hello("correct-token")),
            Err(ProtocolError::AlreadyAuthenticated)
        );
    }

    #[test]
    fn stale_audio_sequence_is_rejected_after_authentication() {
        let mut auth = Authenticator::new("token".to_owned());
        auth.authenticate(IpAddr::V4(Ipv4Addr::LOCALHOST), &hello("token"))
            .expect("authentication should pass");
        assert_eq!(auth.accept_audio_sequence(4), Ok(()));
        assert_eq!(
            auth.accept_audio_sequence(4),
            Err(ProtocolError::StaleSequence)
        );
        assert_eq!(
            auth.accept_audio_sequence(3),
            Err(ProtocolError::StaleSequence)
        );
    }

    fn packet_v2(sequence: u64, source_id: [u8; 16]) -> AudioPacketV2 {
        AudioPacketV2 {
            session_id: [7; 16],
            sequence,
            capture_monotonic_ns: 42,
            sample_rate: 16_000,
            channels: 1,
            flags: 0,
            source_id,
            samples: vec![0.25, -0.5, 0.75],
        }
    }

    #[test]
    fn v2_audio_packet_round_trips() {
        let source_id = *b"0123456789abcdef";
        let original = packet_v2(1, source_id);
        let encoded = original.encode().expect("v2 packet should encode");
        assert_eq!(encoded.len(), AUDIO_HEADER_V2_BYTES + 12);
        assert_eq!(
            AudioPacketV2::decode(&encoded).expect("v2 packet should decode"),
            original
        );
    }

    #[test]
    fn v1_and_v2_audio_packets_carry_distinct_version_numbers() {
        let v1 = packet(1).encode().expect("v1 encode");
        let v2 = packet_v2(1, *b"0123456789abcdef")
            .encode()
            .expect("v2 encode");
        assert_eq!(u16::from_le_bytes([v1[4], v1[5]]), PROTOCOL_VERSION);
        assert_eq!(u16::from_le_bytes([v2[4], v2[5]]), PROTOCOL_V2);
        assert_eq!(v1.len() + 16, v2.len());
    }

    #[test]
    fn v1_decoder_rejects_v2_frames_and_vice_versa() {
        let v2 = packet_v2(1, *b"0123456789abcdef")
            .encode()
            .expect("v2 encode");
        assert_eq!(
            AudioPacket::decode(&v2),
            Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                received: PROTOCOL_V2,
            })
        );
        // A v1 frame is shorter than the 66-byte v2 header, so the v2
        // decoder rejects it as an invalid header before checking version.
        let v1 = packet(1).encode().expect("v1 encode");
        assert_eq!(
            AudioPacketV2::decode(&v1),
            Err(ProtocolError::InvalidAudioHeader)
        );
        // A version-1 frame padded to v2 header length surfaces the mismatch.
        let mut padded = v1.clone();
        padded.extend_from_slice(&[0_u8; 16]);
        assert_eq!(
            AudioPacketV2::decode(&padded),
            Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_V2,
                received: PROTOCOL_VERSION,
            })
        );
        let truncated = &v2[..AUDIO_HEADER_V2_BYTES - 1];
        assert_eq!(
            AudioPacketV2::decode(truncated),
            Err(ProtocolError::InvalidAudioHeader)
        );
    }

    #[test]
    fn source_id_hex_conversion_round_trips_and_validates() {
        let raw = *b"0123456789abcdef";
        let hex = source_id_to_hex(&raw);
        assert_eq!(hex, "30313233343536373839616263646566");
        assert_eq!(source_id_from_hex(&hex).expect("valid hex"), raw);
        assert_eq!(
            source_id_from_hex("3031323334353637383961626364656G"),
            Err(ProtocolError::InvalidSourceId)
        );
        assert_eq!(
            source_id_from_hex("abcd"),
            Err(ProtocolError::InvalidSourceId)
        );
    }

    fn caption_v2() -> CaptionPayload {
        CaptionPayload {
            caption_id: "c-1".to_owned(),
            utterance_id: "u-1".to_owned(),
            revision: 3,
            status: CaptionStatus::Provisional,
            source_mode: SourceMode::Filipino,
            source_text: "ilipat sa B".to_owned(),
            english_text: "rotate to B".to_owned(),
            started_monotonic_ns: 1,
            ended_monotonic_ns: None,
            capture_to_caption_ms: 2.0,
            asr_ms: 1.0,
            translation_ms: 1.0,
            confidence: Some(0.9),
            warnings: Vec::new(),
            source_id: Some("30313233343536373839616263646566".to_owned()),
            source_snapshot: Some(SourceSnapshot {
                display_name: "Valorant Team".to_owned(),
                caption_tag: "TEAM".to_owned(),
                label_style: CaptionLabelStyle::Brackets,
                color: Some("#7dd3fc".to_owned()),
            }),
            strictness: Some(CaptionStrictness::Balanced),
            filter_applied: Some(FilterApplied::Passed),
            filter_reason: None,
        }
    }

    #[test]
    fn caption_v2_payload_round_trips_with_all_v2_fields() {
        let original = caption_v2();
        let serialized = serde_json::to_string(&original).expect("caption should serialize");
        let decoded: CaptionPayload =
            serde_json::from_str(&serialized).expect("caption should deserialize");
        assert_eq!(decoded, original);
        let value: serde_json::Value = serde_json::from_str(&serialized).expect("json value");
        assert_eq!(value["source_id"], "30313233343536373839616263646566");
        assert_eq!(value["source_snapshot"]["label_style"], "brackets");
        assert_eq!(value["strictness"], "balanced");
        assert_eq!(value["filter_applied"], "passed");
    }

    #[test]
    fn caption_v1_payload_serializes_identically_without_v2_fields() {
        let v1 = CaptionPayload {
            caption_id: "c-1".to_owned(),
            utterance_id: "u-1".to_owned(),
            revision: 1,
            status: CaptionStatus::Final,
            source_mode: SourceMode::Cebuano,
            source_text: "gikan sa B".to_owned(),
            english_text: "coming from B".to_owned(),
            started_monotonic_ns: 1,
            ended_monotonic_ns: Some(2),
            capture_to_caption_ms: 2.0,
            asr_ms: 1.0,
            translation_ms: 1.0,
            confidence: Some(0.8),
            warnings: Vec::new(),
            source_id: None,
            source_snapshot: None,
            strictness: None,
            filter_applied: None,
            filter_reason: None,
        };
        let value: serde_json::Value = serde_json::to_value(&v1).expect("caption should serialize");
        assert!(value.get("source_id").is_none());
        assert!(value.get("source_snapshot").is_none());
        assert!(value.get("strictness").is_none());
        assert!(value.get("filter_applied").is_none());
        assert!(value.get("filter_reason").is_none());
    }

    #[test]
    fn v1_caption_json_without_v2_fields_deserializes() {
        let json = r#"{
            "caption_id": "c-1", "utterance_id": "u-1", "revision": 1,
            "status": "final", "source_mode": "filipino",
            "source_text": "a", "english_text": "b",
            "started_monotonic_ns": 1, "ended_monotonic_ns": 2,
            "capture_to_caption_ms": 1.0, "asr_ms": 1.0, "translation_ms": 1.0,
            "confidence": 0.5, "warnings": []
        }"#;
        let decoded: CaptionPayload = serde_json::from_str(json).expect("v1 caption decodes");
        assert!(decoded.source_id.is_none());
    }

    #[test]
    fn unknown_label_style_is_rejected() {
        let json = r#"{
            "caption_id": "c-1", "utterance_id": "u-1", "revision": 1,
            "status": "final", "source_mode": "filipino",
            "source_text": "a", "english_text": "b",
            "started_monotonic_ns": 1, "ended_monotonic_ns": null,
            "capture_to_caption_ms": 1.0, "asr_ms": 1.0, "translation_ms": 1.0,
            "confidence": null, "warnings": [],
            "source_id": "30313233343536373839616263646566",
            "source_snapshot": { "display_name": "x", "caption_tag": "X",
                "label_style": "matrix", "color": null },
            "strictness": "balanced", "filter_applied": "passed", "filter_reason": null
        }"#;
        assert!(serde_json::from_str::<CaptionPayload>(json).is_err());
    }

    #[test]
    fn negotiates_highest_common_version() {
        assert_eq!(negotiate_protocol_version(&[2, 1], &[1, 2]), Some(2));
        assert_eq!(negotiate_protocol_version(&[2, 1], &[1]), Some(1));
        assert_eq!(negotiate_protocol_version(&[1], &[2]), None);
        assert_eq!(negotiate_protocol_version(&[], &[1]), None);
    }

    #[test]
    fn envelope_validate_version_in_accepts_negotiated_set() {
        let envelope = Envelope {
            protocol_version: PROTOCOL_V2,
            message_id: "m".to_owned(),
            session_id: "s".to_owned(),
            message_type: "health".to_owned(),
            sent_monotonic_ns: 0,
            payload: (),
        };
        assert!(envelope.validate_version_in(&[1, 2]).is_ok());
        assert!(envelope.validate_version().is_err());
    }
}
