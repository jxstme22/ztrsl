#![deny(unsafe_op_in_unsafe_fn)]

use std::net::IpAddr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_CONTROL_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_AUDIO_MESSAGE_BYTES: usize = 256 * 1024;
pub const AUDIO_HEADER_BYTES: usize = 50;
const AUDIO_MAGIC: [u8; 4] = *b"LSTA";

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
        if self.protocol_version == PROTOCOL_VERSION {
            Ok(())
        } else {
            Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LiveStartPayload {
    pub source_mode: String,
    pub provider: String,
    pub resource_profile: String,
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
        AudioPacket, Authenticator, Envelope, HelloPayload, MAX_AUDIO_MESSAGE_BYTES,
        MAX_CONTROL_MESSAGE_BYTES, PROTOCOL_VERSION, ProtocolError, validate_control_message_size,
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
}
