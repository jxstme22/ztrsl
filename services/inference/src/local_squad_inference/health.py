from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthStatus(BaseModel):
    """Content-free sidecar health payload."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    service: Literal["local-squad-inference"]
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    protocol_version: int = Field(ge=1)
    state: Literal["foundation", "ready", "degraded", "stopping"]
    models_loaded: bool
