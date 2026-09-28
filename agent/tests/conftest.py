import os

os.environ.setdefault("HAL_LANG", "nl")
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TOKEN = "t" * 48


@pytest.fixture()
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("HAL_AGENT_MOCK", "1")
    monkeypatch.setenv("HAL_AGENT_TOKEN", TOKEN)
    monkeypatch.setenv("HAL_AGENT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("HAL_AGENT_CONFIG_DIR", str(ROOT / "config"))
    monkeypatch.delenv("CF_ACCESS_TEAM_DOMAIN", raising=False)
    monkeypatch.delenv("CF_ACCESS_AUD", raising=False)
    from hal_agent.config import Settings

    return Settings.from_env()


@pytest.fixture()
def client(settings):
    from fastapi.testclient import TestClient

    from hal_agent.main import create_app

    app = create_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers():
    return {"Authorization": f"Bearer {TOKEN}"}
