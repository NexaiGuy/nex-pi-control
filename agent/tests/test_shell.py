import os

import pytest
from fastapi.testclient import TestClient

from hal_common.auth import AuthConfig, Authenticator
from hal_shell.files import FileError, FileService, Root
from hal_shell.main import ShellSettings, create_app

TOKEN = "s" * 48
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture()
def sandbox(tmp_path):
    rw = tmp_path / "rw"
    ro = tmp_path / "ro"
    outside = tmp_path / "outside"
    for d in (rw, ro, outside):
        d.mkdir()
    (rw / "a.txt").write_text("hallo")
    (ro / "b.txt").write_text("alleen lezen")
    (outside / "secret.txt").write_text("geheim")
    os.symlink(outside / "secret.txt", rw / "link-naar-buiten")
    os.symlink(outside, rw / "dir-link")
    return tmp_path, [Root(rw, True, "RW"), Root(ro, False, "RO")]


@pytest.fixture()
def shell_client(sandbox, monkeypatch):
    monkeypatch.setenv("HAL_SHELL_TOKEN", TOKEN)
    monkeypatch.setenv("HAL_SHELL_IDLE_SECONDS", "900")
    s = ShellSettings()
    app = create_app(s, Authenticator(AuthConfig(TOKEN)), roots=sandbox[1])
    with TestClient(app) as c:
        yield c, sandbox[0]


def test_symlink_escape_blocked(sandbox):
    base, roots = sandbox
    fs = FileService(roots)
    with pytest.raises(FileError) as e:
        fs.read_text(str(base / "rw" / "link-naar-buiten"))
    assert e.value.status == 403
    with pytest.raises(FileError):
        fs.list(str(base / "rw" / "dir-link"))
    with pytest.raises(FileError):
        fs.read_text(str(base / "rw" / ".." / "outside" / "secret.txt"))


def test_relative_and_nul_paths_rejected(sandbox):
    fs = FileService(sandbox[1])
    for bad in ["rw/a.txt", "", "/tmp/\x00x"]:
        with pytest.raises(FileError):
            fs.read_text(bad)


def test_read_only_root(sandbox):
    base, roots = sandbox
    fs = FileService(roots)
    with pytest.raises(FileError) as e:
        fs.write_text(str(base / "ro" / "b.txt"), "x", None)
    assert e.value.code == "read_only"
    with pytest.raises(FileError):
        fs.delete(str(base / "ro" / "b.txt"), False)


def test_cannot_touch_root_itself(sandbox):
    base, roots = sandbox
    fs = FileService(roots)
    with pytest.raises(FileError):
        fs.delete(str(base / "rw"), True)
    with pytest.raises(FileError):
        fs.rename(str(base / "rw"), "anders")


def test_delete_symlink_removes_link_not_target(sandbox):
    base, roots = sandbox
    fs = FileService(roots)
    fs.delete(str(base / "rw" / "link-naar-buiten"), False)
    assert (base / "outside" / "secret.txt").exists()


def test_write_conflict_detection(sandbox):
    base, roots = sandbox
    fs = FileService(roots)
    info = fs.read_text(str(base / "rw" / "a.txt"))
    fs.write_text(str(base / "rw" / "a.txt"), "nieuw", info["modified"])
    with pytest.raises(FileError) as e:
        fs.write_text(str(base / "rw" / "a.txt"), "oud", info["modified"])
    assert e.value.status == 409


def test_rename_validation(sandbox):
    base, roots = sandbox
    fs = FileService(roots)
    for bad in ["../x", "a/b", "..", ""]:
        with pytest.raises(FileError):
            fs.rename(str(base / "rw" / "a.txt"), bad)


def test_http_auth_and_files(shell_client):
    c, base = shell_client
    assert c.get("/v1/files/roots").status_code == 401
    roots = c.get("/v1/files/roots", headers=H).json()
    assert {r["label"] for r in roots} == {"RW", "RO"}
    lst = c.get("/v1/files/list", params={"path": str(base / "rw")}, headers=H).json()
    assert "a.txt" in [e["name"] for e in lst["entries"]]
    r = c.put("/v1/files/write", json={"path": str(base / "rw" / "nieuw.txt"), "content": "hoi"}, headers=H)
    assert r.status_code == 200
    up = c.post("/v1/files/upload", params={"dir": str(base / "rw")}, files={"file": ("up.bin", b"\x00\x01", "application/octet-stream")}, headers=H)
    assert up.status_code == 200 and (base / "rw" / "up.bin").read_bytes() == b"\x00\x01"
    up2 = c.post("/v1/files/upload", params={"dir": str(base / "rw")}, files={"file": ("../evil.sh", b"x")}, headers=H)
    assert up2.status_code == 200 and (base / "rw" / "evil.sh").exists() and not (base / "evil.sh").exists()
    assert c.delete("/v1/files", params={"path": str(base / "outside" / "secret.txt")}, headers=H).status_code == 403
    st = c.get("/v1/status", headers=H).json()
    assert any(a["action"] == "files:write" for a in st["audit"])


def test_signal_foreign_process_refused(shell_client):
    c, _ = shell_client
    assert c.post("/v1/processes/1/signal", json={"signal": "KILL"}, headers=H).status_code == 403


def test_terminal_requires_token(shell_client):
    c, _ = shell_client
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as e:
        with c.websocket_connect("/v1/terminal") as ws:
            ws.receive_text()
    assert e.value.code == 4401


def test_terminal_roundtrip_and_audit(shell_client):
    import json
    import time

    c, _ = shell_client
    with c.websocket_connect("/v1/terminal?cols=100&rows=30", headers=H) as ws:
        ws.send_text(json.dumps({"t": "i", "d": "echo HAL_$((40+2))\r"}))
        buf = ""
        deadline = time.time() + 10
        while "HAL_42" not in buf and time.time() < deadline:
            msg = json.loads(ws.receive_text())
            if msg["t"] == "o":
                buf += msg["d"]
        assert "HAL_42" in buf
        ws.send_text(json.dumps({"t": "i", "d": "exit\r"}))
    st = c.get("/v1/status", headers=H).json()
    lines = [a["detail"] for a in st["audit"] if a["action"] == "terminal:input"]
    assert "echo HAL_$((40+2))" in lines


def test_clean_line():
    from hal_shell.terminal import clean_line

    assert clean_line("lss\x7f -la") == "ls -la"
    assert clean_line("\x1b[Aabc") == "abc"
    assert clean_line("weg\x15ok") == "ok"
