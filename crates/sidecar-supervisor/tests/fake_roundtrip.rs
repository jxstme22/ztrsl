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
