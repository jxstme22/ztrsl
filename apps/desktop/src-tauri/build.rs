fn main() {
    tauri_build::build();
    // The ScreenCaptureKit Swift bridge (via audio-core's screencapturekit
    // dependency) references the Swift 5.5 compatibility runtime
    // (`libswift_Concurrency.dylib`), which lives in the Xcode toolchain, not
    // in /usr/lib/swift on recent macOS. That crate's own build script can
    // only pass link args to its own test targets — library crates cannot add
    // rpaths to downstream binaries — so the rpath for the final app binary
    // is baked here. Without it the app fails to load at launch with
    // `dyld: Library not loaded: @rpath/libswift_Concurrency.dylib`.
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("xcode-select")
            .arg("-p")
            .output()
        {
            if output.status.success() {
                let xcode = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                let toolchain = format!("{xcode}/Toolchains/XcodeDefault.xctoolchain");
                for dir in ["usr/lib/swift-5.5/macosx", "usr/lib/swift/macosx"] {
                    println!("cargo:rustc-link-arg=-Wl,-rpath,{}/{}", toolchain, dir);
                }
            }
        }
    }
}
