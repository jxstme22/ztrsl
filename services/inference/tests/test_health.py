import pytest
from pydantic import ValidationError

from local_squad_inference.health import HealthStatus


def test_health_payload_rejects_unknown_content_fields() -> None:
    with pytest.raises(ValidationError):
        HealthStatus.model_validate(
            {
                "service": "local-squad-inference",
                "version": "0.1.0",
                "protocol_version": 1,
                "state": "foundation",
                "models_loaded": False,
                "transcript": "must not be accepted",
            }
        )
