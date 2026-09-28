def test_restart_not_whitelisted(client, auth_headers):
    r = client.post("/v1/actions/restart-service", json={"name": "ssh"}, headers=auth_headers)
    assert r.status_code == 403
    audit = client.get("/v1/audit", headers=auth_headers).json()
    assert audit[0]["action"] == "restart-service" and audit[0]["result"] == "fout"


def test_restart_whitelisted(client, auth_headers):
    r = client.post("/v1/actions/restart-service", json={"name": "nginx"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    audit = client.get("/v1/audit", headers=auth_headers).json()
    assert audit[0]["target"] == "nginx.service" and audit[0]["result"] == "ok"


def test_services_mark_restart_allowed(client, auth_headers):
    svcs = {s["name"]: s for s in client.get("/v1/services", headers=auth_headers).json()}
    assert svcs["nginx.service"]["restart_allowed"] is True
    assert svcs["ssh.service"]["restart_allowed"] is False


def test_config_whitelist_parsing(tmp_path):
    from hal_agent.config import ConfigFiles

    (tmp_path / "allowed-actions.yml").write_text("restart:\n  - nginx\n  - 'bad unit; rm'\n  - ok.service\n")
    (tmp_path / "commands.yml").write_text("commands:\n  - id: good\n  - id: 'Bad ID'\n  - id: ../x\n")
    (tmp_path / "wol.yml").write_text("devices:\n  - id: a\n    mac: '00:11:22:33:44:55'\n  - id: b\n    mac: 'nope'\n")
    cf = ConfigFiles(tmp_path)
    assert cf.restart_units() == ["nginx.service", "ok.service"]
    assert [c["id"] for c in cf.command_list()] == ["good"]
    assert [d["id"] for d in cf.wol_devices()] == ["a"]


def test_container_env_never_leaks():
    from hal_agent.collectors.containers import sanitize_inspect, sanitize_summary

    inspect = {"RestartCount": 2, "State": {"Health": {"Status": "healthy"}, "ExitCode": 0},
               "Config": {"Env": ["POSTGRES_PASSWORD=supergeheim", "API_KEY=sk-123"], "Image": "postgres:16"},
               "HostConfig": {"RestartPolicy": {"Name": "always"}, "Binds": ["/secret:/x"]},
               "Mounts": [{"Source": "/home/pi/.ssh"}]}
    summary = {"Id": "abcdef1234567890", "Names": ["/db"], "Image": "postgres:16", "State": "running", "Status": "Up",
               "Labels": {"com.docker.compose.project": "nex", "traefik.http.middlewares.auth.basicauth.users": "admin:$apr1$hash"},
               "Mounts": [{"Source": "/etc/secret"}], "Ports": []}
    out = repr(sanitize_inspect(inspect)) + repr(sanitize_summary(summary))
    for leak in ("supergeheim", "sk-123", "/secret", ".ssh", "basicauth", "apr1", "/etc/secret"):
        assert leak not in out


def test_container_logs_demux():
    import struct

    from hal_agent.collectors.containers import demux_logs

    payload = b"hallo\n"
    raw = bytes([1, 0, 0, 0]) + struct.pack(">I", len(payload)) + payload + bytes([2, 0, 0, 0]) + struct.pack(">I", 5) + b"fout\n"
    assert demux_logs(raw) == ["hallo", "fout"]


def test_process_redaction():
    from hal_agent.collectors.misc import redact

    assert "geheim" not in redact("app --password=geheim --port 80")
    assert "geheim" not in redact("psql postgres://user:geheim@localhost/db")
    assert "geheim" not in redact("env PGPASSWORD=geheim psql")
    assert "--port 80" in redact("app --password=geheim --port 80")


def test_ports_parser():
    from hal_agent.collectors.misc import parse_ports_md

    md = "| Poort | Adres | Dienst |\n|---|---|---|\n| 8120 | 127.0.0.1 | hal-agent |\n| 5432 | 127.0.0.1 | postgres |\n| abc | x | y |\n"
    rows = parse_ports_md(md)
    assert [r["port"] for r in rows] == [8120, 5432]


def test_wol_packet():
    from hal_agent.collectors.misc import magic_packet

    p = magic_packet("00:11:22:33:44:55")
    assert len(p) == 102 and p[:6] == b"\xff" * 6 and p[6:12] == bytes.fromhex("001122334455")


def test_polkit_rule_generation(tmp_path, monkeypatch):
    import importlib.machinery
    import importlib.util
    from pathlib import Path

    conf = tmp_path / "etc"
    conf.mkdir()
    (conf / "allowed-actions.yml").write_text("restart: [nginx, 'x; rm', ssh, hal-agent]\npower: false\n")
    (conf / "commands.yml").write_text("commands:\n  - id: apt-update\n  - id: 'Bad'\n")
    src = Path(__file__).resolve().parent.parent / "bin" / "hal-apply-config"
    loader = importlib.machinery.SourceFileLoader("hal_apply_config", str(src))
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("hal_apply_config", loader))
    loader.exec_module(mod)
    monkeypatch.setattr(mod, "CONF", str(conf))
    monkeypatch.setattr(mod, "RULES", str(tmp_path / "50-hal-agent.rules"))
    mod.main()
    rule = (tmp_path / "50-hal-agent.rules").read_text()
    assert '["nginx.service"]' in rule
    assert "hal-cmd@apt-update.service" in rule and "Bad" not in rule
    assert "if (false &&" in rule
    assert 'subject.user !== "halagent"' in rule


def test_bmp280_compensation_datasheet_example():
    from hal_agent.collectors.gpio import bmp280_compensate

    # Voorbeeld uit de Bosch BMP280-datasheet (sectie 3.12): 25.08 °C en 1006.53 hPa
    t1, t2, t3 = 27504, 26435, -1000
    p = [36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000]
    cal = []
    for v in [t1, t2, t3] + p:
        v &= 0xFFFF
        cal += [v & 0xFF, v >> 8]
    adc_t, adc_p = 519888, 415148
    d = [adc_p >> 12, (adc_p >> 4) & 0xFF, (adc_p & 0xF) << 4, adc_t >> 12, (adc_t >> 4) & 0xFF, (adc_t & 0xF) << 4]
    r = bmp280_compensate(cal, d)
    assert abs(r["temp"] - 25.08) < 0.01
    assert abs(r["pressure"] - 1006.53) < 0.05


def test_english_is_default_for_app_errors(client, auth_headers):
    r = client.post("/v1/actions/restart-service", json={"name": "ssh"}, headers={**auth_headers, "Accept-Language": "en-US,en;q=0.9"})
    assert r.json()["message"] == "This service is not listed in allowed-actions.yml"
    r = client.post("/v1/actions/restart-service", json={"name": "ssh"}, headers={**auth_headers, "Accept-Language": "nl-BE"})
    assert r.json()["message"] == "Deze dienst staat niet in allowed-actions.yml"


def test_overview_translated(client, auth_headers):
    from hal_agent.mock import HOSTNAME

    en = client.get("/v1/overview", headers={**auth_headers, "Accept-Language": "en"}).json()
    nl = client.get("/v1/overview", headers={**auth_headers, "Accept-Language": "nl"}).json()
    assert en["health"]["title"] in ("All good", "Critical") or "issue" in en["health"]["title"]
    assert nl["health"]["title"] in ("Alles in orde", "Kritiek") or "aandachtspunt" in nl["health"]["title"]
    assert client.get("/v1/info", headers=auth_headers).json()["hostname"] == HOSTNAME


def test_no_personal_data_in_public_code():
    """The public code must not mention private hosts or project names. Only hashes are stored here."""
    import hashlib
    import pathlib
    import re

    blocked = {"73d359372a4be9c8", "5a84085b5ca67cc5", "740f9022358b425a", "7815b2c4e72fad86", "f7ec7563db4deb08", "16c86833403ee05b"}
    root = pathlib.Path(__file__).resolve().parent.parent
    for f in list(root.rglob("*.py")) + list(root.rglob("*.yml")) + list(root.rglob("*.sh")) + list(root.rglob("*.service")) + list(root.rglob("*.md")):
        if "tests" in f.parts or ".venv" in f.parts:
            continue
        text = f.read_text(errors="ignore").lower()
        for word in set(re.findall(r"[a-z0-9][a-z0-9-]{3,}", text)):
            assert hashlib.sha256(word.encode()).hexdigest()[:16] not in blocked, f"private term in {f}"
        assert not re.search(r"192\.168\.0\.(?:[1-9]\d?|1\d\d|2[0-4]\d)\b", text), f"private address in {f}"
        assert "nex-ai.be" not in text or f.name == "README.md", f"own hostname in {f}"
