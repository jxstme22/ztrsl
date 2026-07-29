# Model Artifacts

Model binaries are not committed and are not downloaded by normal application startup.

Every future artifact must have:

- a pinned official or vetted source;
- an exact license record;
- expected size and SHA-256 checksum;
- a safe local format such as ONNX or safetensors;
- atomic installation and corrupt-file rejection;
- no `trust_remote_code` or executable model-provided code.

Downloaded artifacts belong under `models/artifacts/`, which is ignored by Git. Placeholder
checksums are never considered installable manifests.

