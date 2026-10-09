"""Exporteert de mock-data (scenario 'demo') naar JSON voor de ingebouwde demo-modus van de app.

Gebruik: python scripts/export_demo.py ../app/src/demo
"""

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.update(HAL_AGENT_MOCK="1", HAL_AGENT_MOCK_SCENARIO=os.environ.get("SCENARIO", "demo"), HAL_AGENT_STATE_DIR=tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

from hal_agent.main import create_app  # noqa: E402

PATHS = [
    "/v1/info", "/v1/overview", "/v1/device", "/v1/disks", "/v1/stats/metrics", "/v1/services?filter=all",
    "/v1/containers", "/v1/sites", "/v1/processes?sort=cpu&limit=60", "/v1/processes?sort=mem&limit=60",
    "/v1/processes?sort=pid&limit=60", "/v1/processes?sort=name&limit=60", "/v1/backups", "/v1/ports", "/v1/gpio",
    "/v1/sensors", "/v1/commands", "/v1/wol", "/v1/audit?limit=200", "/v1/shell",
    "/v1/events?limit=50", "/v1/updates", "/v1/agent/update", "/v1/actions/allowed", "/v1/labels",
]


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    token = "mock-token-for-local-development-only-000000"
    with TestClient(create_app()) as c:
        for lang in ("en", "nl"):
            h = {"Authorization": f"Bearer {token}", "Accept-Language": lang}
            data = {p.split("?")[0] + ("?" + p.split("?")[1].split("&")[0] if "sort=" in p else ""): c.get(p, headers=h).json() for p in PATHS}
            svc = data["/v1/services"]
            data["logs:service"] = c.get(f"/v1/services/{svc[0]['name']}/logs?lines=50", headers=h).json()
            failed = next((s["name"] for s in svc if s["active"] == "failed"), svc[0]["name"])
            data["logs:service-failed"] = c.get(f"/v1/services/{failed}/logs?lines=50", headers=h).json()
            cid = data["/v1/containers"]["containers"][0]["id"]
            data["logs:container"] = c.get(f"/v1/containers/{cid}/logs?lines=60", headers=h).json()
            (out / f"demo-{lang}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            print(lang, sum(len(json.dumps(v)) for v in data.values()) // 1024, "KB")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "."))
