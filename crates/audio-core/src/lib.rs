#![deny(unsafe_op_in_unsafe_fn)]

use std::collections::VecDeque;
use std::f32::consts::TAU;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
mod macos;

mod source;

#[cfg(target_os = "windows")]
pub use windows::{
    EndpointEvent, WindowsAudioCapture, WindowsAudioPlayback, WindowsDeviceWatcher,
    WindowsEndpointCatalog, windows_endpoint_peak,
};

#[cfg(target_os = "macos")]
pub use macos::{
    MacosAudioCapture, MacosAudioPlayback, MacosDeviceWatcher, MacosEndpointCatalog,
    MacosEndpointEvent, macos_endpoint_peak,
};

pub use source::{
    CaptureTarget, SOURCE_SAMPLE_RATE, SourceCapture, SourceFrame, SourceId, SourceIdError,
    SourceManager, SourceMetrics, SourceRuntime,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndpointKind {
    Capture,
    Render,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndpointState {
    Active,
    Disabled,
    NotPresent,
    Unplugged,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultRoles {
    pub console: bool,
    pub multimedia: bool,
    pub communications: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEndpoint {
    pub id: String,
    pub friendly_name: String,
    pub kind: EndpointKind,
    pub state: EndpointState,
    pub default_roles: DefaultRoles,
    pub native_format: Option<AudioFormat>,
    pub is_synthetic: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioFrame {
    pub sequence: u64,
    pub capture_monotonic_ns: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelSnapshot {
    pub sequence: u64,
    pub peak: f32,
    pub rms: f32,
    pub clipped: bool,
    pub dropped_frames: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AudioError {
    #[error("bounded audio queue capacity must be non-zero")]
    InvalidQueueCapacity,
    #[error("audio endpoint was not found")]
    EndpointNotFound,
    #[error("audio endpoint was invalidated")]
    EndpointInvalidated,
    #[error("audio source is already running")]
    AlreadyRunning,
    #[error("audio source is not running")]
    NotRunning,
    #[error("capture and playback endpoints must be different")]
    FeedbackConfiguration,
    #[error("monitor volume must be between 0 and 1")]
    InvalidVolume,
    #[error("audio format is invalid")]
    InvalidFormat,
    #[error("capture target is invalid: {0}")]
    InvalidCaptureTarget(String),
    #[error("audio source was not found")]
    SourceNotFound,
    #[error("source identity error: {0}")]
    SourceId(#[from] SourceIdError),
    #[error("audio platform error: {0}")]
    Platform(String),
}

pub trait AudioMonitor {
    fn start(&mut self, endpoint_id: &str, format: AudioFormat) -> Result<(), AudioError>;
    fn write(&mut self, frame: AudioFrame) -> Result<(), AudioError>;
    fn set_volume(&mut self, volume: f32) -> Result<(), AudioError>;
    fn stop(&mut self) -> Result<(), AudioError>;
}

pub trait AudioSource {
    fn enumerate(&self) -> Result<Vec<AudioEndpoint>, AudioError>;
    fn start(&mut self, endpoint_id: &str) -> Result<(), AudioError>;
    fn next_frame(&mut self) -> Result<AudioFrame, AudioError>;
    fn stop(&mut self) -> Result<(), AudioError>;
}

#[derive(Debug)]
pub struct BoundedFrameQueue {
    capacity: usize,
    frames: VecDeque<AudioFrame>,
    dropped_frames: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingMetrics {
    pub captured_frames: u64,
    pub monitor_overflows: u64,
    pub monitor_underruns: u64,
    pub inference_overflows: u64,
    pub clipped_monitor_frames: u64,
}

#[derive(Debug)]
pub struct StreamingLinearResampler {
    input_rate: u32,
    output_rate: u32,
    position: f64,
    buffered: Vec<f32>,
}

impl StreamingLinearResampler {
    pub fn new(input_rate: u32, output_rate: u32) -> Result<Self, AudioError> {
        if input_rate == 0 || output_rate == 0 {
            return Err(AudioError::InvalidFormat);
        }
        Ok(Self {
            input_rate,
            output_rate,
            position: 0.0,
            buffered: Vec::new(),
        })
    }

    pub fn process(&mut self, mono_samples: &[f32]) -> Vec<f32> {
        self.buffered.extend_from_slice(mono_samples);
        let step = f64::from(self.input_rate) / f64::from(self.output_rate);
        let mut output = Vec::with_capacity((mono_samples.len() as f64 / step).ceil() as usize);

        while self.position + 1.0 < self.buffered.len() as f64 {
            let left_index = self.position.floor() as usize;
            let fraction = (self.position - left_index as f64) as f32;
            let left = self.buffered[left_index];
            let right = self.buffered[left_index + 1];
            output.push(left + (right - left) * fraction);
            self.position += step;
        }

        let consumed = (self.position.floor() as usize).min(self.buffered.len().saturating_sub(1));
        if consumed > 0 {
            self.buffered.drain(..consumed);
            self.position -= consumed as f64;
        }
        output
    }

    #[must_use]
    pub fn buffered_samples(&self) -> usize {
        self.buffered.len()
    }
}

pub fn downmix_to_mono(samples: &[f32], channels: u16) -> Result<Vec<f32>, AudioError> {
    if channels == 0 || samples.len() % usize::from(channels) != 0 {
        return Err(AudioError::InvalidFormat);
    }
    let channel_count = usize::from(channels);
    Ok(samples
        .chunks_exact(channel_count)
        .map(|frame| frame.iter().copied().sum::<f32>() / channel_count as f32)
        .collect())
}

pub fn validate_route(
    capture_endpoint_id: &str,
    playback_endpoint_id: &str,
) -> Result<(), AudioError> {
    if capture_endpoint_id == playback_endpoint_id {
        Err(AudioError::FeedbackConfiguration)
    } else {
        Ok(())
    }
}

#[derive(Debug)]
pub struct AudioRouter {
    monitor_queue: BoundedFrameQueue,
    inference_queue: BoundedFrameQueue,
    resampler: StreamingLinearResampler,
    monitor_volume: f32,
    metrics: RoutingMetrics,
}

impl AudioRouter {
    pub fn new(
        input_rate: u32,
        monitor_capacity: usize,
        inference_capacity: usize,
    ) -> Result<Self, AudioError> {
        Ok(Self {
            monitor_queue: BoundedFrameQueue::new(monitor_capacity)?,
            inference_queue: BoundedFrameQueue::new(inference_capacity)?,
            resampler: StreamingLinearResampler::new(input_rate, 16_000)?,
            monitor_volume: 1.0,
            metrics: RoutingMetrics::default(),
        })
    }

    pub fn set_monitor_volume(&mut self, volume: f32) -> Result<(), AudioError> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(AudioError::InvalidVolume);
        }
        self.monitor_volume = volume;
        Ok(())
    }

    /// Runs on the routing worker after the capture callback has handed off a
    /// frame. Allocation and resampling are intentionally kept out of callbacks.
    pub fn route(&mut self, frame: AudioFrame) -> Result<(), AudioError> {
        let before_monitor_drops = self.monitor_queue.dropped_frames();
        self.monitor_queue.push_latest(frame.clone());
        self.metrics.monitor_overflows = self.metrics.monitor_overflows.saturating_add(
            self.monitor_queue
                .dropped_frames()
                .saturating_sub(before_monitor_drops),
        );

        let mono = downmix_to_mono(&frame.samples, frame.channels)?;
        let inference_samples = self.resampler.process(&mono);
        if !inference_samples.is_empty() {
            let before_inference_drops = self.inference_queue.dropped_frames();
            self.inference_queue.push_latest(AudioFrame {
                sequence: frame.sequence,
                capture_monotonic_ns: frame.capture_monotonic_ns,
                sample_rate: 16_000,
                channels: 1,
                samples: inference_samples,
            });
            self.metrics.inference_overflows = self.metrics.inference_overflows.saturating_add(
                self.inference_queue
                    .dropped_frames()
                    .saturating_sub(before_inference_drops),
            );
        }
        self.metrics.captured_frames = self.metrics.captured_frames.saturating_add(1);
        Ok(())
    }

    pub fn pop_monitor(&mut self) -> Option<AudioFrame> {
        let mut frame = match self.monitor_queue.pop_oldest() {
            Some(frame) => frame,
            None => {
                self.metrics.monitor_underruns = self.metrics.monitor_underruns.saturating_add(1);
                return None;
            }
        };
        let mut clipped = false;
        for sample in &mut frame.samples {
            *sample *= self.monitor_volume;
            clipped |= sample.abs() > 1.0;
            *sample = sample.clamp(-1.0, 1.0);
        }
        if clipped {
            self.metrics.clipped_monitor_frames =
                self.metrics.clipped_monitor_frames.saturating_add(1);
        }
        Some(frame)
    }

    pub fn pop_inference(&mut self) -> Option<AudioFrame> {
        self.inference_queue.pop_oldest()
    }

    #[must_use]
    pub fn metrics(&self) -> RoutingMetrics {
        self.metrics
    }

    #[must_use]
    pub fn queue_depths(&self) -> (usize, usize) {
        (self.monitor_queue.len(), self.inference_queue.len())
    }
}

#[derive(Debug)]
pub struct SyntheticAudioMonitor {
    endpoint_id: String,
    running: bool,
    volume: f32,
    played: BoundedFrameQueue,
}

impl SyntheticAudioMonitor {
    pub fn new(capacity: usize) -> Result<Self, AudioError> {
        Ok(Self {
            endpoint_id: String::new(),
            running: false,
            volume: 1.0,
            played: BoundedFrameQueue::new(capacity)?,
        })
    }

    #[must_use]
    pub fn played_frames(&self) -> usize {
        self.played.len()
    }
}

impl AudioMonitor for SyntheticAudioMonitor {
    fn start(&mut self, endpoint_id: &str, format: AudioFormat) -> Result<(), AudioError> {
        if self.running {
            return Err(AudioError::AlreadyRunning);
        }
        if endpoint_id.is_empty() || format.sample_rate == 0 || format.channels == 0 {
            return Err(AudioError::InvalidFormat);
        }
        self.endpoint_id = endpoint_id.to_owned();
        self.running = true;
        Ok(())
    }

    fn write(&mut self, mut frame: AudioFrame) -> Result<(), AudioError> {
        if !self.running {
            return Err(AudioError::NotRunning);
        }
        for sample in &mut frame.samples {
            *sample = (*sample * self.volume).clamp(-1.0, 1.0);
        }
        self.played.push_latest(frame);
        Ok(())
    }

    fn set_volume(&mut self, volume: f32) -> Result<(), AudioError> {
        if !(0.0..=1.0).contains(&volume) {
            return Err(AudioError::InvalidVolume);
        }
        self.volume = volume;
        Ok(())
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        self.running = false;
        Ok(())
    }
}

impl BoundedFrameQueue {
    pub fn new(capacity: usize) -> Result<Self, AudioError> {
        if capacity == 0 {
            return Err(AudioError::InvalidQueueCapacity);
        }

        Ok(Self {
            capacity,
            frames: VecDeque::with_capacity(capacity),
            dropped_frames: 0,
        })
    }

    pub fn push_latest(&mut self, frame: AudioFrame) {
        if self.frames.len() == self.capacity {
            let _ = self.frames.pop_front();
            self.dropped_frames = self.dropped_frames.saturating_add(1);
        }
        self.frames.push_back(frame);
    }

    pub fn pop_oldest(&mut self) -> Option<AudioFrame> {
        self.frames.pop_front()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.frames.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    #[must_use]
    pub fn dropped_frames(&self) -> u64 {
        self.dropped_frames
    }
}

/// Lock-free handoff for UI metering. The audio producer only performs atomic
/// stores and never logs, allocates, locks, or blocks.
#[derive(Debug, Default)]
pub struct AtomicLevelMeter {
    sequence: AtomicU64,
    peak_bits: AtomicU32,
    rms_bits: AtomicU32,
    clipped: AtomicU32,
    dropped_frames: AtomicU64,
}

impl AtomicLevelMeter {
    pub fn publish(&self, frame: &AudioFrame, dropped_frames: u64) {
        let mut peak = 0.0_f32;
        let mut sum_squares = 0.0_f64;
        for sample in &frame.samples {
            peak = peak.max(sample.abs());
            sum_squares += f64::from(*sample) * f64::from(*sample);
        }
        let rms = if frame.samples.is_empty() {
            0.0
        } else {
            (sum_squares / frame.samples.len() as f64).sqrt() as f32
        };

        self.peak_bits.store(peak.to_bits(), Ordering::Relaxed);
        self.rms_bits.store(rms.to_bits(), Ordering::Relaxed);
        self.clipped
            .store(u32::from(peak >= 1.0), Ordering::Relaxed);
        self.dropped_frames.store(dropped_frames, Ordering::Relaxed);
        self.sequence.store(frame.sequence, Ordering::Release);
    }

    #[must_use]
    pub fn snapshot(&self) -> LevelSnapshot {
        LevelSnapshot {
            sequence: self.sequence.load(Ordering::Acquire),
            peak: f32::from_bits(self.peak_bits.load(Ordering::Relaxed)),
            rms: f32::from_bits(self.rms_bits.load(Ordering::Relaxed)),
            clipped: self.clipped.load(Ordering::Relaxed) != 0,
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
        }
    }
}

pub const SYNTHETIC_ENDPOINT_ID: &str = "synthetic://phase-2-meter";
pub const SYNTHETIC_MONITOR_ENDPOINT_ID: &str = "synthetic://phase-3-headphones";

#[must_use]
pub fn synthetic_monitor_endpoint() -> AudioEndpoint {
    AudioEndpoint {
        id: SYNTHETIC_MONITOR_ENDPOINT_ID.to_owned(),
        friendly_name: "Silent test sink (macOS simulator)".to_owned(),
        kind: EndpointKind::Render,
        state: EndpointState::Active,
        default_roles: DefaultRoles::default(),
        native_format: Some(AudioFormat {
            sample_rate: 48_000,
            channels: 1,
        }),
        is_synthetic: true,
    }
}

#[derive(Debug)]
pub struct SyntheticAudioSource {
    running: bool,
    sequence: u64,
    sample_rate: u32,
    channels: u16,
    frame_samples: usize,
}

impl Default for SyntheticAudioSource {
    fn default() -> Self {
        Self {
            running: false,
            sequence: 0,
            sample_rate: 48_000,
            channels: 1,
            frame_samples: 960,
        }
    }
}

impl AudioSource for SyntheticAudioSource {
    fn enumerate(&self) -> Result<Vec<AudioEndpoint>, AudioError> {
        Ok(vec![AudioEndpoint {
            id: SYNTHETIC_ENDPOINT_ID.to_owned(),
            friendly_name: "Generated voice signal (macOS simulator)".to_owned(),
            kind: EndpointKind::Capture,
            state: EndpointState::Active,
            default_roles: DefaultRoles::default(),
            native_format: Some(AudioFormat {
                sample_rate: self.sample_rate,
                channels: self.channels,
            }),
            is_synthetic: true,
        }])
    }

    fn start(&mut self, endpoint_id: &str) -> Result<(), AudioError> {
        if self.running {
            return Err(AudioError::AlreadyRunning);
        }
        if endpoint_id != SYNTHETIC_ENDPOINT_ID {
            return Err(AudioError::EndpointNotFound);
        }
        self.running = true;
        self.sequence = 0;
        Ok(())
    }

    fn next_frame(&mut self) -> Result<AudioFrame, AudioError> {
        if !self.running {
            return Err(AudioError::NotRunning);
        }

        let sequence = self.sequence;
        let frame_start = sequence as usize * self.frame_samples;
        let envelope = 0.12 + 0.46 * ((sequence as f32 * 0.19).sin() * 0.5 + 0.5);
        let samples = (0..self.frame_samples)
            .map(|offset| {
                let phase = (frame_start + offset) as f32 * 220.0 * TAU / self.sample_rate as f32;
                phase.sin() * envelope
            })
            .collect();
        self.sequence = self.sequence.saturating_add(1);

        Ok(AudioFrame {
            sequence,
            capture_monotonic_ns: sequence.saturating_mul(20_000_000),
            sample_rate: self.sample_rate,
            channels: self.channels,
            samples,
        })
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        self.running = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AtomicLevelMeter, AudioError, AudioFormat, AudioFrame, AudioMonitor, AudioRouter,
        AudioSource, BoundedFrameQueue, SYNTHETIC_ENDPOINT_ID, StreamingLinearResampler,
        SyntheticAudioMonitor, SyntheticAudioSource, downmix_to_mono, validate_route,
    };

    fn frame(sequence: u64) -> AudioFrame {
        AudioFrame {
            sequence,
            capture_monotonic_ns: sequence * 1_000,
            sample_rate: 16_000,
            channels: 1,
            samples: vec![0.0; 480],
        }
    }

    #[test]
    fn drops_oldest_frame_when_capacity_is_reached() {
        let mut queue = BoundedFrameQueue::new(2).expect("test capacity is valid");
        queue.push_latest(frame(1));
        queue.push_latest(frame(2));
        queue.push_latest(frame(3));

        assert_eq!(queue.len(), 2);
        assert_eq!(queue.dropped_frames(), 1);
        assert_eq!(queue.pop_oldest().map(|item| item.sequence), Some(2));
        assert_eq!(queue.pop_oldest().map(|item| item.sequence), Some(3));
    }

    #[test]
    fn empty_queue_returns_none() {
        let mut queue = BoundedFrameQueue::new(1).expect("test capacity is valid");

        assert!(queue.is_empty());
        assert_eq!(queue.pop_oldest(), None);
    }

    #[test]
    fn rejects_zero_capacity() {
        assert_eq!(
            BoundedFrameQueue::new(0).expect_err("zero capacity must be rejected"),
            AudioError::InvalidQueueCapacity
        );
    }

    #[test]
    fn synthetic_source_requires_an_explicit_valid_endpoint() {
        let mut source = SyntheticAudioSource::default();
        assert_eq!(source.start("missing"), Err(AudioError::EndpointNotFound));
        source
            .start(SYNTHETIC_ENDPOINT_ID)
            .expect("synthetic endpoint should start");
        assert_eq!(
            source.start(SYNTHETIC_ENDPOINT_ID),
            Err(AudioError::AlreadyRunning)
        );
    }

    #[test]
    fn synthetic_frames_are_deterministic_and_bounded() {
        let mut source = SyntheticAudioSource::default();
        source
            .start(SYNTHETIC_ENDPOINT_ID)
            .expect("synthetic endpoint should start");
        let first = source.next_frame().expect("frame should be available");
        let second = source.next_frame().expect("frame should be available");

        assert_eq!(first.sequence, 0);
        assert_eq!(second.sequence, 1);
        assert_eq!(first.samples.len(), 960);
        assert!(first.samples.iter().all(|sample| sample.abs() <= 1.0));
    }

    #[test]
    fn level_meter_reports_peak_rms_and_clipping_without_a_lock() {
        let meter = AtomicLevelMeter::default();
        let mut input = frame(7);
        input.samples = vec![-1.1, 0.5, 0.0, 0.5];
        meter.publish(&input, 3);
        let snapshot = meter.snapshot();

        assert_eq!(snapshot.sequence, 7);
        assert!((snapshot.peak - 1.1).abs() < f32::EPSILON);
        assert!(snapshot.rms > 0.6);
        assert!(snapshot.clipped);
        assert_eq!(snapshot.dropped_frames, 3);
    }

    #[test]
    fn downmixes_stereo_without_changing_duration() {
        let mono =
            downmix_to_mono(&[1.0, -1.0, 0.5, 0.25], 2).expect("stereo frame should downmix");
        assert_eq!(mono, vec![0.0, 0.375]);
        assert_eq!(
            downmix_to_mono(&[1.0, 0.0, 1.0], 2),
            Err(AudioError::InvalidFormat)
        );
    }

    #[test]
    fn streaming_resampler_preserves_duration_across_chunks() {
        for input_rate in [44_100, 48_000, 96_000] {
            let mut resampler =
                StreamingLinearResampler::new(input_rate, 16_000).expect("rates are valid");
            let chunk_samples = input_rate as usize / 10;
            let mut output_samples = 0;
            for _ in 0..10 {
                output_samples += resampler.process(&vec![0.25; chunk_samples]).len();
            }
            assert!(
                output_samples.abs_diff(16_000) <= 2,
                "{input_rate} Hz produced {output_samples} samples"
            );
            assert!(resampler.buffered_samples() <= 8);
        }
    }

    #[test]
    fn router_prioritizes_bounded_monitor_and_tracks_both_overflows() {
        let mut router = AudioRouter::new(48_000, 1, 1).expect("capacities are valid");
        router.route(frame(1)).expect("routing should succeed");
        router.route(frame(2)).expect("routing should succeed");

        assert_eq!(router.metrics().captured_frames, 2);
        assert_eq!(router.metrics().monitor_overflows, 1);
        assert_eq!(router.metrics().inference_overflows, 1);
        assert_eq!(router.pop_monitor().map(|item| item.sequence), Some(2));
        let inference = router
            .pop_inference()
            .expect("latest inference frame exists");
        assert_eq!(inference.sample_rate, 16_000);
        assert_eq!(inference.channels, 1);
    }

    #[test]
    fn monitor_underrun_and_invalid_volume_are_measured() {
        let mut router = AudioRouter::new(48_000, 2, 2).expect("capacities are valid");
        assert_eq!(
            router.set_monitor_volume(1.1),
            Err(AudioError::InvalidVolume)
        );
        assert!(router.pop_monitor().is_none());
        assert_eq!(router.metrics().monitor_underruns, 1);
    }

    #[test]
    fn blocks_same_endpoint_feedback_configuration() {
        assert_eq!(
            validate_route("endpoint-a", "endpoint-a"),
            Err(AudioError::FeedbackConfiguration)
        );
        assert_eq!(validate_route("capture", "headphones"), Ok(()));
    }

    #[test]
    fn synthetic_monitor_has_bounded_storage_and_deterministic_stop() {
        let mut monitor = SyntheticAudioMonitor::new(1).expect("capacity is valid");
        monitor
            .start(
                "synthetic://headphones",
                AudioFormat {
                    sample_rate: 48_000,
                    channels: 1,
                },
            )
            .expect("monitor should start");
        monitor
            .write(frame(1))
            .expect("monitor should accept audio");
        monitor
            .write(frame(2))
            .expect("monitor should accept audio");
        assert_eq!(monitor.played_frames(), 1);
        monitor.stop().expect("monitor should stop");
        assert_eq!(monitor.write(frame(3)), Err(AudioError::NotRunning));
    }

    #[test]
    fn long_synthetic_route_keeps_memory_queues_bounded() {
        let mut router = AudioRouter::new(48_000, 8, 100).expect("capacities are valid");
        for sequence in 0..5_000 {
            router
                .route(frame(sequence))
                .expect("synthetic frame should route");
        }
        assert_eq!(router.queue_depths(), (8, 100));
        assert_eq!(router.metrics().captured_frames, 5_000);
        assert_eq!(router.metrics().monitor_overflows, 4_992);
        assert_eq!(router.metrics().inference_overflows, 4_900);
    }
}
