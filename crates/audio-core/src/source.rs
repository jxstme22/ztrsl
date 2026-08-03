//! Multi-source audio pipelines (v0.3, Phase 3).
//!
//! Each source has an immutable [`SourceId`] (ADR-013), a [`CaptureTarget`]
//! describing what audio it listens to, and its own [`SourceRuntime`]: a
//! private buffer, resampler, sequence counter, metrics, meter, and
//! monitoring settings. Audio that does not match a source's target is never
//! mixed into that source's ASR path — routing happens at capture time, keyed
//! by `source_id`. Monitoring is configuration for a headphone blend only;
//! it never feeds the ASR path.

use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    AtomicLevelMeter, AudioError, AudioFormat, AudioFrame, LevelSnapshot, StreamingLinearResampler,
};

/// Output sample rate of every source pipeline (matches the sidecar).
pub const SOURCE_SAMPLE_RATE: u32 = 16_000;

/// Immutable source identity: 16 raw bytes, 32 lowercase hex characters on
/// the wire (ADR-013). Created once per source and never changes; every
/// presentation field is separate state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SourceId([u8; 16]);

impl SourceId {
    /// Generate a UUIDv4-shaped id (version nibble 4, variant 10xx).
    pub fn random() -> Result<Self, SourceIdError> {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes).map_err(|error| SourceIdError::Random(error.to_string()))?;
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        Ok(Self(bytes))
    }

    #[must_use]
    pub const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// Parse the wire form: exactly 32 lowercase hex characters.
    pub fn parse_str(value: &str) -> Result<Self, SourceIdError> {
        if value.len() != 32 {
            return Err(SourceIdError::Invalid);
        }
        let mut bytes = [0_u8; 16];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            let high = hex_nibble(chunk[0]).ok_or(SourceIdError::Invalid)?;
            let low = hex_nibble(chunk[1]).ok_or(SourceIdError::Invalid)?;
            bytes[index] = (high << 4) | low;
        }
        Ok(Self(bytes))
    }
}

const fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

impl fmt::Display for SourceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(formatter, "{byte:02x}")?;
        }
        Ok(())
    }
}

impl FromStr for SourceId {
    type Err = SourceIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse_str(value)
    }
}

impl Serialize for SourceId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for SourceId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse_str(&value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SourceIdError {
    #[error("source id must be 32 lowercase hex characters")]
    Invalid,
    #[error("secure random generation failed: {0}")]
    Random(String),
}

/// What a source listens to (IPC v2 freeze §4.2: `kind` ∈ endpoint | process).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureTarget {
    /// An ordinary Windows audio endpoint, captured directly or loopback.
    Endpoint { endpoint_id: String },
    /// Loopback of a named process's default render device (no hooks, no
    /// memory access — ordinary WASAPI session enumeration).
    Process { process_name: String },
}

impl CaptureTarget {
    pub fn validate(&self) -> Result<(), AudioError> {
        match self {
            Self::Endpoint { endpoint_id } if endpoint_id.is_empty() => Err(
                AudioError::InvalidCaptureTarget("endpoint id must not be empty".to_owned()),
            ),
            Self::Process { process_name } if process_name.is_empty() => Err(
                AudioError::InvalidCaptureTarget("process name must not be empty".to_owned()),
            ),
            Self::Endpoint { .. } | Self::Process { .. } => Ok(()),
        }
    }
}

/// Mockable capture boundary (AGENTS.md: trait-based capture so devices can
/// be faked). Concrete implementations: `WindowsAudioCapture` (endpoints,
/// Windows) and the synthetic source; process-loopback lands with the
/// `windows-hw` acceptance chunk.
pub trait SourceCapture: Send {
    fn try_next(&mut self) -> Result<Option<AudioFrame>, AudioError>;
    fn dropped_frames(&self) -> u64;
    fn format(&self) -> AudioFormat;
}

/// A frame ready for the sidecar: source-stamped, resampled to 16 kHz mono.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceFrame {
    pub source_id: SourceId,
    pub sequence: u64,
    pub capture_monotonic_ns: u64,
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetrics {
    pub captured_frames: u64,
    pub capture_drops: u64,
    pub audio_packets_sent: u64,
}

/// Per-source monitoring settings (Phase 3 acceptance #3/#4): an optional
/// headphone blend, never fed to ASR. Volume must stay in `0.0..=1.0`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorConfig {
    pub enabled: bool,
    pub volume: f32,
}

impl MonitorConfig {
    #[must_use]
    pub const fn default() -> Self {
        Self {
            enabled: false,
            volume: 0.5,
        }
    }

    pub fn set_volume(&mut self, volume: f32) -> Result<(), AudioError> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(AudioError::InvalidVolume);
        }
        self.volume = volume;
        Ok(())
    }
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self::default()
    }
}

/// Per-source pipeline state: private buffer + resampler + sequence, so no
/// source ever observes another source's frames or numbering. The meter and
/// monitor config are likewise per-source; monitoring is pure configuration
/// and never enters the ASR path.
pub struct SourceRuntime {
    source_id: SourceId,
    target: CaptureTarget,
    capture: Box<dyn SourceCapture>,
    resampler: StreamingLinearResampler,
    next_sequence: u64,
    last_capture_drops: u64,
    metrics: SourceMetrics,
    meter: AtomicLevelMeter,
    monitor: MonitorConfig,
}

impl SourceRuntime {
    pub fn new(
        source_id: SourceId,
        target: CaptureTarget,
        capture: Box<dyn SourceCapture>,
    ) -> Result<Self, AudioError> {
        target.validate()?;
        let format = capture.format();
        if format.sample_rate == 0 || format.channels == 0 {
            return Err(AudioError::InvalidFormat);
        }
        Ok(Self {
            source_id,
            target,
            resampler: StreamingLinearResampler::new(format.sample_rate, SOURCE_SAMPLE_RATE)?,
            capture,
            next_sequence: 0,
            last_capture_drops: 0,
            metrics: SourceMetrics::default(),
            meter: AtomicLevelMeter::default(),
            monitor: MonitorConfig::default(),
        })
    }

    pub fn next_frame(&mut self) -> Result<Option<SourceFrame>, AudioError> {
        let Some(frame) = self.capture.try_next()? else {
            let drops = self.capture.dropped_frames();
            self.metrics.capture_drops += drops.saturating_sub(self.last_capture_drops);
            self.last_capture_drops = drops;
            return Ok(None);
        };
        self.metrics.captured_frames = self.metrics.captured_frames.saturating_add(1);
        let samples = self.resampler.process(&frame.samples);
        if samples.is_empty() {
            return Ok(None);
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.metrics.audio_packets_sent = self.metrics.audio_packets_sent.saturating_add(1);
        self.meter.publish(
            &AudioFrame {
                sequence,
                capture_monotonic_ns: frame.capture_monotonic_ns,
                sample_rate: SOURCE_SAMPLE_RATE,
                channels: 1,
                samples: samples.clone(),
            },
            self.capture.dropped_frames(),
        );
        Ok(Some(SourceFrame {
            source_id: self.source_id,
            sequence,
            capture_monotonic_ns: frame.capture_monotonic_ns,
            sample_rate: SOURCE_SAMPLE_RATE,
            samples,
        }))
    }

    #[must_use]
    pub fn source_id(&self) -> SourceId {
        self.source_id
    }

    #[must_use]
    pub fn target(&self) -> &CaptureTarget {
        &self.target
    }

    #[must_use]
    pub fn metrics(&self) -> &SourceMetrics {
        &self.metrics
    }

    #[must_use]
    pub fn level(&self) -> LevelSnapshot {
        self.meter.snapshot()
    }

    #[must_use]
    pub fn monitor(&self) -> &MonitorConfig {
        &self.monitor
    }

    pub fn set_monitor(&mut self, config: MonitorConfig) -> Result<(), AudioError> {
        if !(0.0..=1.0).contains(&config.volume) {
            return Err(AudioError::InvalidVolume);
        }
        self.monitor = config;
        Ok(())
    }
}

/// Registry keyed by immutable `source_id`. Failures are isolated per
/// source: one broken capture never stops the others.
#[derive(Default)]
pub struct SourceManager {
    sources: HashMap<SourceId, SourceRuntime>,
}

impl SourceManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a source. The runtime resamples to 16 kHz and sequences
    /// frames independently.
    pub fn register(
        &mut self,
        target: CaptureTarget,
        capture: Box<dyn SourceCapture>,
    ) -> Result<SourceId, AudioError> {
        let source_id = SourceId::random()?;
        let runtime = SourceRuntime::new(source_id, target, capture)?;
        self.sources.insert(source_id, runtime);
        Ok(source_id)
    }

    pub fn unregister(&mut self, source_id: SourceId) -> Option<SourceRuntime> {
        self.sources.remove(&source_id)
    }

    #[must_use]
    pub fn get(&self, source_id: SourceId) -> Option<&SourceRuntime> {
        self.sources.get(&source_id)
    }

    pub fn get_mut(&mut self, source_id: SourceId) -> Option<&mut SourceRuntime> {
        self.sources.get_mut(&source_id)
    }

    /// Pull the next frame for one source. Errors are scoped to that source.
    pub fn next_frame(&mut self, source_id: SourceId) -> Result<Option<SourceFrame>, AudioError> {
        match self.sources.get_mut(&source_id) {
            Some(runtime) => runtime.next_frame(),
            None => Err(AudioError::SourceNotFound),
        }
    }

    /// Set one source's monitoring blend. Monitoring is a headphone-only
    /// path; it never feeds ASR.
    pub fn set_monitor(
        &mut self,
        source_id: SourceId,
        config: MonitorConfig,
    ) -> Result<(), AudioError> {
        match self.sources.get_mut(&source_id) {
            Some(runtime) => runtime.set_monitor(config),
            None => Err(AudioError::SourceNotFound),
        }
    }

    pub fn level(&self, source_id: SourceId) -> Result<LevelSnapshot, AudioError> {
        self.sources
            .get(&source_id)
            .map(SourceRuntime::level)
            .ok_or(AudioError::SourceNotFound)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.sources.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }

    #[must_use]
    pub fn ids(&self) -> Vec<SourceId> {
        self.sources.keys().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AudioError, AudioFormat, AudioFrame, CaptureTarget, SourceCapture, SourceId};

    struct FakeCapture {
        frames: Vec<AudioFrame>,
        drops: u64,
        format: AudioFormat,
    }

    impl FakeCapture {
        fn new(format: AudioFormat, frames: Vec<AudioFrame>) -> Self {
            Self {
                frames,
                drops: 0,
                format,
            }
        }
    }

    impl SourceCapture for FakeCapture {
        fn try_next(&mut self) -> Result<Option<AudioFrame>, AudioError> {
            Ok(self.frames.pop())
        }

        fn dropped_frames(&self) -> u64 {
            self.drops
        }

        fn format(&self) -> AudioFormat {
            self.format
        }
    }

    struct FailingCapture;

    impl SourceCapture for FailingCapture {
        fn try_next(&mut self) -> Result<Option<AudioFrame>, AudioError> {
            Err(AudioError::EndpointInvalidated)
        }

        fn dropped_frames(&self) -> u64 {
            0
        }

        fn format(&self) -> AudioFormat {
            AudioFormat {
                sample_rate: 16_000,
                channels: 1,
            }
        }
    }

    fn frame(ns: u64, samples: Vec<f32>) -> AudioFrame {
        AudioFrame {
            sequence: 0,
            capture_monotonic_ns: ns,
            sample_rate: 16_000,
            channels: 1,
            samples,
        }
    }

    fn endpoint_target(endpoint_id: &str) -> CaptureTarget {
        CaptureTarget::Endpoint {
            endpoint_id: endpoint_id.to_owned(),
        }
    }

    #[test]
    fn source_id_round_trips_through_hex() {
        let id = SourceId::parse_str("0123456789abcdef0123456789abcdef").expect("valid id");
        assert_eq!(id.to_string(), "0123456789abcdef0123456789abcdef");
        assert_eq!(SourceId::from_str(&id.to_string()).expect("parse"), id);
        assert_eq!(
            serde_json::to_string(&id).expect("serialize"),
            "\"0123456789abcdef0123456789abcdef\""
        );
        assert_eq!(
            serde_json::from_str::<SourceId>("\"0123456789abcdef0123456789abcdef\"")
                .expect("deserialize"),
            id
        );
    }

    #[test]
    fn source_id_rejects_malformed_wire_forms() {
        for bad in [
            "G123456789abcdef0123456789abcdef",
            "0123456789ABCDEF0123456789abcdef",
            "0123456789abcdef0123456789abcde",
            "",
        ] {
            assert!(SourceId::parse_str(bad).is_err(), "{bad} must be rejected");
        }
        assert!(serde_json::from_str::<SourceId>("\"NOT-HEX\"").is_err());
    }

    #[test]
    fn random_source_id_is_v4_shaped() {
        let id = SourceId::random().expect("random");
        let bytes = *id.as_bytes();
        assert_eq!(bytes[6] >> 4, 4, "version nibble must be 4");
        assert_eq!(bytes[8] & 0xc0, 0x80, "variant bits must be 10xx");
        assert_ne!(SourceId::random().expect("random"), id);
    }

    #[test]
    fn capture_target_serde_and_validation() {
        let endpoint = endpoint_target("dev-1");
        assert_eq!(
            serde_json::to_string(&endpoint).expect("serialize"),
            r#"{"kind":"endpoint","endpoint_id":"dev-1"}"#
        );
        let process: CaptureTarget =
            serde_json::from_str(r#"{"kind":"process","process_name":"VALORANT.exe"}"#)
                .expect("deserialize");
        assert_eq!(
            process,
            CaptureTarget::Process {
                process_name: "VALORANT.exe".to_owned()
            }
        );
        assert!(endpoint.validate().is_ok());
        assert!(process.validate().is_ok());
        assert!(
            CaptureTarget::Endpoint {
                endpoint_id: String::new()
            }
            .validate()
            .is_err()
        );
        assert!(
            CaptureTarget::Process {
                process_name: String::new()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn runtime_sequences_frames_per_source_and_resamples() {
        let mut runtime = SourceRuntime::new(
            SourceId::parse_str("0123456789abcdef0123456789abcdef").expect("id"),
            endpoint_target("dev-1"),
            Box::new(FakeCapture::new(
                AudioFormat {
                    sample_rate: 8_000,
                    channels: 1,
                },
                vec![
                    frame(100, vec![0.5; 800]),
                    frame(200, vec![-0.5; 800]),
                    frame(300, vec![0.25; 800]),
                ],
            )),
        )
        .expect("runtime");

        let first = runtime.next_frame().expect("frame").expect("some");
        assert_eq!(first.sequence, 0);
        assert_eq!(first.sample_rate, SOURCE_SAMPLE_RATE);
        assert!(
            (1000..=1600).contains(&first.samples.len()),
            "8k -> 16k upsampling keeps roughly double the samples"
        );
        let second = runtime.next_frame().expect("frame").expect("some");
        assert_eq!(second.sequence, 1);
        assert_eq!(second.capture_monotonic_ns, 200);
        let third = runtime.next_frame().expect("frame").expect("some");
        assert_eq!(third.sequence, 2);
        assert!(runtime.next_frame().expect("empty").is_none());
        assert_eq!(runtime.metrics().captured_frames, 3);
        assert_eq!(runtime.metrics().audio_packets_sent, 3);
    }

    #[test]
    fn manager_isolates_a_failing_source() {
        let mut manager = SourceManager::new();
        let failing = manager
            .register(endpoint_target("dev-fail"), Box::new(FailingCapture))
            .expect("register failing");
        let healthy = manager
            .register(
                endpoint_target("dev-ok"),
                Box::new(FakeCapture::new(
                    AudioFormat {
                        sample_rate: 16_000,
                        channels: 1,
                    },
                    vec![frame(1, vec![0.1; 320]), frame(2, vec![0.2; 320])],
                )),
            )
            .expect("register healthy");
        assert_eq!(manager.len(), 2);

        assert!(matches!(
            manager.next_frame(failing),
            Err(AudioError::EndpointInvalidated)
        ));
        let healthy_frame = manager
            .next_frame(healthy)
            .expect("healthy still works")
            .expect("some");
        assert_eq!(healthy_frame.source_id, healthy);
        assert_ne!(healthy_frame.source_id, failing);
        assert!(
            manager
                .next_frame(healthy)
                .expect("healthy still works")
                .is_some()
        );
        assert!(manager.next_frame(healthy).expect("drained").is_none());
    }

    #[test]
    fn manager_frames_never_cross_sources() {
        let mut manager = SourceManager::new();
        let team = manager
            .register(
                endpoint_target("team-dev"),
                Box::new(FakeCapture::new(
                    AudioFormat {
                        sample_rate: 16_000,
                        channels: 1,
                    },
                    vec![frame(1, vec![1.0; 320])],
                )),
            )
            .expect("team");
        let discord = manager
            .register(
                endpoint_target("discord-dev"),
                Box::new(FakeCapture::new(
                    AudioFormat {
                        sample_rate: 16_000,
                        channels: 1,
                    },
                    vec![frame(2, vec![-1.0; 320])],
                )),
            )
            .expect("discord");

        let team_frame = manager.next_frame(team).expect("frame").expect("some");
        let discord_frame = manager.next_frame(discord).expect("frame").expect("some");
        assert_eq!(team_frame.source_id, team);
        assert_eq!(discord_frame.source_id, discord);
        assert_eq!(team_frame.sequence, 0);
        assert_eq!(
            discord_frame.sequence, 0,
            "each source numbers independently"
        );
        assert!(team_frame.samples.iter().all(|s| *s >= 0.0));
        assert!(discord_frame.samples.iter().all(|s| *s <= 0.0));
    }

    #[test]
    fn manager_unregister_removes_the_source() {
        let mut manager = SourceManager::new();
        let id = manager
            .register(
                endpoint_target("dev-1"),
                Box::new(FakeCapture::new(
                    AudioFormat {
                        sample_rate: 16_000,
                        channels: 1,
                    },
                    vec![],
                )),
            )
            .expect("register");
        assert_eq!(manager.len(), 1);
        assert!(manager.unregister(id).is_some());
        assert!(manager.is_empty());
        assert!(matches!(
            manager.next_frame(id),
            Err(AudioError::SourceNotFound)
        ));
    }

    #[test]
    fn monitor_config_validates_volume() {
        let mut config = MonitorConfig::default();
        assert!(!config.enabled, "monitoring is opt-in");
        assert_eq!(config.volume, 0.5);
        assert!(config.set_volume(0.0).is_ok());
        assert!(config.set_volume(1.0).is_ok());
        assert!(matches!(
            config.set_volume(1.1),
            Err(AudioError::InvalidVolume)
        ));
        assert!(matches!(
            config.set_volume(-0.01),
            Err(AudioError::InvalidVolume)
        ));
        let wire = serde_json::to_string(&MonitorConfig {
            enabled: true,
            volume: 0.25,
        })
        .expect("serialize");
        assert_eq!(wire, r#"{"enabled":true,"volume":0.25}"#);
        let decoded: MonitorConfig =
            serde_json::from_str(r#"{"enabled":false,"volume":0.75}"#).expect("deserialize");
        assert!(!decoded.enabled);
        assert_eq!(decoded.volume, 0.75);
    }

    #[test]
    fn runtime_meter_tracks_only_its_own_frames_and_monitor_never_affects_asr() {
        let mut manager = SourceManager::new();
        let team = manager
            .register(
                endpoint_target("team-dev"),
                Box::new(FakeCapture::new(
                    AudioFormat {
                        sample_rate: 16_000,
                        channels: 1,
                    },
                    vec![frame(1, vec![0.0; 320]), frame(2, vec![0.5; 320])],
                )),
            )
            .expect("team");
        let discord = manager
            .register(
                endpoint_target("discord-dev"),
                Box::new(FakeCapture::new(
                    AudioFormat {
                        sample_rate: 16_000,
                        channels: 1,
                    },
                    vec![frame(1, vec![-0.25; 320])],
                )),
            )
            .expect("discord");

        let team_frame = manager.next_frame(team).expect("frame").expect("some");
        let team_level = manager.level(team).expect("level");
        assert_eq!(team_level.sequence, 0);
        assert_eq!(team_level.peak, 0.5);

        assert_eq!(
            manager.level(discord).expect("level").sequence,
            0,
            "discord meter starts idle until its own frames flow"
        );
        manager.next_frame(discord).expect("frame").expect("some");
        let discord_level = manager.level(discord).expect("level");
        assert_eq!(discord_level.peak, 0.25);
        assert_eq!(
            manager.level(team).expect("level").peak,
            0.5,
            "discord frames never touch the team meter"
        );

        let monitor = MonitorConfig {
            enabled: true,
            volume: 0.9,
        };
        manager.set_monitor(team, monitor).expect("set monitor");
        assert_eq!(manager.get(team).expect("runtime").monitor(), &monitor);

        let mut without_monitor = SourceRuntime::new(
            team_frame.source_id,
            endpoint_target("team-dev"),
            Box::new(FakeCapture::new(
                AudioFormat {
                    sample_rate: 16_000,
                    channels: 1,
                },
                vec![frame(1, vec![0.0; 320]), frame(2, vec![0.5; 320])],
            )),
        )
        .expect("reference runtime");
        let mut with_monitor = SourceRuntime::new(
            team_frame.source_id,
            endpoint_target("team-dev"),
            Box::new(FakeCapture::new(
                AudioFormat {
                    sample_rate: 16_000,
                    channels: 1,
                },
                vec![frame(1, vec![0.0; 320]), frame(2, vec![0.5; 320])],
            )),
        )
        .expect("monitored runtime");
        with_monitor.set_monitor(monitor).expect("set monitor");

        while let (Some(reference), Some(monitored)) = (
            without_monitor.next_frame().expect("reference frame"),
            with_monitor.next_frame().expect("monitored frame"),
        ) {
            assert_eq!(
                reference.samples, monitored.samples,
                "monitor configuration must not alter ASR-bound samples"
            );
        }
    }

    #[test]
    fn manager_level_and_set_monitor_reject_unknown_sources() {
        let mut manager = SourceManager::new();
        let unknown = SourceId::parse_str("0123456789abcdef0123456789abcdef").expect("id");
        assert!(matches!(
            manager.level(unknown),
            Err(AudioError::SourceNotFound)
        ));
        assert!(matches!(
            manager.set_monitor(unknown, MonitorConfig::default()),
            Err(AudioError::SourceNotFound)
        ));
    }
}
