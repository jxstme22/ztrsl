use sidecar_supervisor::{SidecarConfig, SidecarSupervisor, workspace_root_from_manifest};

#[test]
#[ignore = "requires an ephemeral loopback port and the project Python environment"]
fn supervised_sidecar_produces_a_terminal_fake_caption_and_stops() {
    let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
    let mut supervisor = SidecarSupervisor::start(&config).expect("sidecar should start");
    let captions = supervisor
        .fake_roundtrip(100_000_000, vec![0.25; 320])
        .expect("fake roundtrip should succeed");

    assert_eq!(captions.len(), 2);
    assert_eq!(captions[0].message_type, "caption.provisional");
    assert_eq!(captions[1].message_type, "caption.final");
    supervisor.stop();
}

#[test]
#[ignore = "requires an ephemeral loopback port and the project Python environment"]
fn crashed_sidecar_is_detected_and_a_replacement_can_start() {
    let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
    let mut crashed = SidecarSupervisor::start(&config).expect("sidecar should start");
    crashed.terminate_for_diagnostics();
    assert!(crashed.ensure_running().is_err());
    drop(crashed);

    let mut replacement = SidecarSupervisor::start(&config).expect("replacement should start");
    assert!(replacement.ensure_running().is_ok());
    replacement.stop();
}

#[test]
#[ignore = "requires FFmpeg, verified local models, and an ephemeral loopback port"]
fn supervised_sidecar_accepts_a_user_selected_clip_with_local_models() {
    let path = std::env::temp_dir().join(format!("local-squad-clip-{}.wav", std::process::id()));
    std::fs::write(&path, synthetic_wav()).expect("temporary WAV should be written");
    let config = SidecarConfig::for_workspace(&workspace_root_from_manifest());
    let mut supervisor = SidecarSupervisor::start(&config).expect("sidecar should start");
    let result = supervisor
        .process_clip(&path, "mixed", "local")
        .expect("local clip analysis should complete");

    assert_eq!(result.mode, "local");
    assert_eq!(
        result.metadata.display_name,
        path.file_name().unwrap().to_string_lossy()
    );
    supervisor.stop();
    std::fs::remove_file(path).expect("temporary WAV should be removed");
}

fn synthetic_wav() -> Vec<u8> {
    let sample_rate = 16_000_u32;
    let sample_count = sample_rate;
    let data_bytes = sample_count * 2;
    let mut bytes = Vec::with_capacity(44 + data_bytes as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for index in 0..sample_count {
        let sample = if (3_200..8_000).contains(&index) {
            ((index as f32 * 0.086).sin() * 12_000.0) as i16
        } else {
            0
        };
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}
