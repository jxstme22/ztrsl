import json

import pytest

from local_squad_inference.app import build_startup_status, main


def test_startup_status_does_not_claim_models_are_loaded() -> None:
    status = build_startup_status()

    assert status.state == "foundation"
    assert status.models_loaded is False
    assert "audio" not in status.model_dump()
    assert "transcript" not in status.model_dump()


def test_main_prints_machine_readable_content_free_health(
    capsys: pytest.CaptureFixture[str],
) -> None:
    main()
    output = json.loads(capsys.readouterr().out)

    assert output["service"] == "local-squad-inference"
    assert output["models_loaded"] is False
