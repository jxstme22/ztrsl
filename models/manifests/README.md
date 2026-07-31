# Installable Model Manifests

Committed manifests contain exact SHA-256 hashes for every runtime artifact. A local model is
enabled only when every listed file verifies.

Generated manifests under `models/artifacts/` describe the installed copy and remain ignored.
Normal application startup never downloads or updates models.

