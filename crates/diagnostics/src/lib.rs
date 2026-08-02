#![deny(unsafe_op_in_unsafe_fn)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct MetricsSnapshot {
    pub captured_frames: u64,
    pub dropped_inference_frames: u64,
    pub monitor_overflows: u64,
    pub monitor_underruns: u64,
    pub clipped_monitor_frames: u64,
    pub inference_queue_depth: u32,
    pub ipc_restarts: u64,
    pub ipc_auth_failures: u64,
    pub capture_to_caption_ms: Option<f64>,
}

impl MetricsSnapshot {
    #[must_use]
    pub fn contains_user_content(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::MetricsSnapshot;

    #[test]
    fn default_metrics_are_content_free() {
        let metrics = MetricsSnapshot::default();

        assert!(!metrics.contains_user_content());
        assert_eq!(metrics.captured_frames, 0);
        assert_eq!(metrics.ipc_auth_failures, 0);
        assert_eq!(metrics.capture_to_caption_ms, None);
    }
}
