from __future__ import annotations

import json

from local_squad_inference.health import HealthStatus


def build_startup_status() -> HealthStatus:
    """Return a content-free status without loading models or reserving GPU memory."""
    return HealthStatus(
        service="local-squad-inference",
        version="0.1.0",
        protocol_version=1,
        state="foundation",
        models_loaded=False,
    )


def main() -> None:
    """Emit one startup status for the Phase 0 command-line smoke test."""
    print(json.dumps(build_startup_status().model_dump(mode="json"), sort_keys=True))


if __name__ == "__main__":
    main()
