"""hal-shell: terminal en bestandsbeheer. Draait als gewone gebruiker (niet root), staat standaard uit,
stopt zichzelf na HAL_SHELL_IDLE_SECONDS zonder activiteit."""

from __future__ import annotations

import asyncio
import json
import logging
import logging.handlers
import os
import signal
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

import psutil
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from hal_common import VERSION
from hal_common.auth import AuthConfig, Authenticator, normalize_team_domain
from hal_common.ratelimit import RateLimiter
from hal_common.web import api_error, install_common

from .files import FileError, FileService, Root, load_roots
from .terminal import PtySession

log = logging.getLogger("hal.shell")

MAX_SESSIONS = 4
MAX_UPLOAD = 100 * 1024 * 1024


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WriteBody(Strict):
    path: str = Field(min_length=1, max_length=4096)
    content: str = Field(max_length=6 * 1024 * 1024)
    expected_mtime: int | None = None


class PathBody(Strict):
    path: str = Field(min_length=1, max_length=4096)


class RenameBody(Strict):
    path: str = Field(min_length=1, max_length=4096)
    new_name: str = Field(min_length=1, max_length=255)


class SignalBody(Strict):
    signal: Literal["TERM", "KILL"] = "TERM"


class ShellSettings:
    def __init__(self) -> None:
        self.mock = os.environ.get("HAL_SHELL_MOCK", "").lower() in ("1", "true", "yes")
        token = os.environ.get("HAL_SHELL_TOKEN", "")
        if self.mock and not token:
            token = "mock-shell-token-for-local-development-00000"
        self.token = token
        self.team_domain = normalize_team_domain(os.environ.get("CF_ACCESS_TEAM_DOMAIN"))
        self.aud = (os.environ.get("CF_ACCESS_AUD") or "").strip() or None
        self.host = os.environ.get("HAL_SHELL_HOST", "127.0.0.1")
        self.port = int(os.environ.get("HAL_SHELL_PORT", "8121"))
        self.idle = int(os.environ.get("HAL_SHELL_IDLE_SECONDS", "900"))
        self.roots_file = Path(os.environ.get("HAL_SHELL_ROOTS", "/etc/hal-agent/shell-roots.yml"))
        self.shell = os.environ.get("HAL_SHELL_BIN", "/bin/bash")


class Auditor:
    """Schrijft JSON naar de journal met identifier hal-shell-audit, zodat hal-agent ze kan tonen."""

    def __init__(self) -> None:
        self.logger = logging.getLogger("hal-shell-audit")
        self.logger.propagate = False
        if os.path.exists("/dev/log"):
            h = logging.handlers.SysLogHandler(address="/dev/log")
            h.ident = "hal-shell-audit: "
            h.setFormatter(logging.Formatter("%(message)s"))
            self.logger.addHandler(h)
        else:
            self.logger.addHandler(logging.StreamHandler())
        self.logger.setLevel(logging.INFO)
        self.recent: list[dict[str, Any]] = []

    def __call__(self, identity: dict, action: str, target: str | None, detail: str = "", result: str = "ok") -> None:
        entry = {"ts": int(time.time()), "actor": identity.get("actor", "?"), "ip": identity.get("ip", "?"),
                 "action": action, "target": target, "result": result, "detail": detail[:1000]}
        self.recent = (self.recent + [entry])[-200:]
        self.logger.info(json.dumps(entry, ensure_ascii=False))


def create_app(settings: ShellSettings | None = None, authenticator: Authenticator | None = None, roots: list[Root] | None = None) -> FastAPI:
    s = settings or ShellSettings()
    auth = authenticator or Authenticator(AuthConfig(s.token, s.team_domain, s.aud))
    limiter = RateLimiter({"files": (120, 60.0), "connect": (20, 60.0), "signal": (10, 60.0)})
    auditor = Auditor()
    state = {"last": time.monotonic(), "sessions": 0}

    def file_service() -> FileService:
        if roots is not None:
            return FileService(roots)
        fallback = [Root(Path(os.path.expanduser("~")), True, "Home")] if s.mock else []
        return FileService(load_roots(s.roots_file, fallback))

    def touch() -> None:
        state["last"] = time.monotonic()

    async def idle_watch() -> None:
        while True:
            await asyncio.sleep(15)
            if state["sessions"] == 0 and time.monotonic() - state["last"] > s.idle:
                log.info("Geen activiteit gedurende %s s, hal-shell stopt", s.idle)
                auditor({"actor": "hal-shell", "ip": "-"}, "shell:idle-stop", None)
                os.kill(os.getpid(), signal.SIGTERM)
                return

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        task = asyncio.create_task(idle_watch())
        log.info("hal-shell %s gestart als %s", VERSION, os.environ.get("USER") or os.getuid())
        yield
        task.cancel()

    app = FastAPI(title="hal-shell", version=VERSION, lifespan=lifespan, docs_url="/docs" if s.mock else None,
                  redoc_url=None, openapi_url="/openapi.json" if s.mock else None)
    install_common(app)

    async def ident(request: Request) -> dict:
        identity = await auth.http_dependency(request)
        touch()
        return identity

    files_dep = [Depends(limiter.dependency("files"))]

    def ferr(exc: FileError) -> HTTPException:
        return api_error(exc.status, exc.code, exc.message)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "version": VERSION}

    @app.get("/v1/status", dependencies=files_dep)
    async def status(identity: dict = Depends(ident)) -> dict[str, Any]:
        remaining = max(0, int(s.idle - (time.monotonic() - state["last"])))
        return {"ok": True, "user": os.environ.get("USER", str(os.getuid())), "sessions": state["sessions"],
                "idle_timeout_seconds": s.idle, "idle_remaining_seconds": remaining, "audit": auditor.recent[-20:]}

    @app.post("/v1/keepalive", dependencies=files_dep)
    async def keepalive(identity: dict = Depends(ident)) -> dict[str, Any]:
        return {"ok": True, "idle_remaining_seconds": s.idle}

    # Bestanden --------------------------------------------------------------

    @app.get("/v1/files/roots", dependencies=files_dep)
    async def roots_(identity: dict = Depends(ident)) -> list[dict[str, Any]]:
        return file_service().list_roots()

    @app.get("/v1/files/list", dependencies=files_dep)
    async def list_(path: Annotated[str, Query(max_length=4096)], identity: dict = Depends(ident)) -> dict[str, Any]:
        try:
            return file_service().list(path)
        except FileError as e:
            raise ferr(e)

    @app.get("/v1/files/read", dependencies=files_dep)
    async def read(path: Annotated[str, Query(max_length=4096)], identity: dict = Depends(ident)) -> dict[str, Any]:
        try:
            return file_service().read_text(path)
        except FileError as e:
            raise ferr(e)

    @app.get("/v1/files/download", dependencies=files_dep)
    async def download(path: Annotated[str, Query(max_length=4096)], identity: dict = Depends(ident)):
        try:
            p = file_service().download_path(path)
        except FileError as e:
            raise ferr(e)
        auditor(identity, "files:download", str(p))
        return FileResponse(p, filename=p.name, media_type="application/octet-stream")

    @app.put("/v1/files/write", dependencies=files_dep)
    async def write(body: WriteBody, identity: dict = Depends(ident)) -> dict[str, Any]:
        try:
            res = file_service().write_text(body.path, body.content, body.expected_mtime)
        except FileError as e:
            auditor(identity, "files:write", body.path, e.message, "fout")
            raise ferr(e)
        auditor(identity, "files:write", res["path"], f"{res['size']} bytes")
        return res

    @app.post("/v1/files/upload", dependencies=files_dep)
    async def upload(dir: Annotated[str, Query(max_length=4096)], file: UploadFile = File(...), identity: dict = Depends(ident)) -> dict[str, Any]:  # noqa: A002
        svc = file_service()
        try:
            target = svc.upload_target(dir, file.filename or "")
        except FileError as e:
            raise ferr(e)
        tmp = target.with_name(f".{target.name}.hal-upload")
        size = 0
        try:
            with open(tmp, "wb") as out:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        raise api_error(413, "too_large", "Bestand te groot (max 100 MB)")
                    out.write(chunk)
                    touch()
            os.replace(tmp, target)
        finally:
            if tmp.exists():
                tmp.unlink()
        auditor(identity, "files:upload", str(target), f"{size} bytes")
        return {"path": str(target), "size": size}

    @app.post("/v1/files/mkdir", dependencies=files_dep)
    async def mkdir(body: PathBody, identity: dict = Depends(ident)) -> dict[str, Any]:
        try:
            res = file_service().mkdir(body.path)
        except FileError as e:
            raise ferr(e)
        auditor(identity, "files:mkdir", res["path"])
        return res

    @app.post("/v1/files/rename", dependencies=files_dep)
    async def rename(body: RenameBody, identity: dict = Depends(ident)) -> dict[str, Any]:
        try:
            res = file_service().rename(body.path, body.new_name)
        except FileError as e:
            raise ferr(e)
        auditor(identity, "files:rename", body.path, f"naar {body.new_name}")
        return res

    @app.delete("/v1/files", dependencies=files_dep)
    async def delete(path: Annotated[str, Query(max_length=4096)], recursive: bool = False, identity: dict = Depends(ident)) -> dict[str, Any]:
        try:
            res = file_service().delete(path, recursive)
        except FileError as e:
            auditor(identity, "files:delete", path, e.message, "fout")
            raise ferr(e)
        auditor(identity, "files:delete", path, "recursief" if recursive else "")
        return res

    # Processen van deze gebruiker -------------------------------------------

    @app.post("/v1/processes/{pid}/signal", dependencies=[Depends(limiter.dependency("signal"))])
    async def signal_process(pid: int, body: SignalBody, identity: dict = Depends(ident)) -> dict[str, Any]:
        if pid <= 1 or pid == os.getpid():
            raise api_error(403, "forbidden", "Dit proces kan je niet beëindigen")
        try:
            proc = psutil.Process(pid)
            if proc.uids().real != os.getuid():
                raise api_error(403, "forbidden", "Enkel processen van je eigen gebruiker")
            name = proc.name()
            proc.send_signal(signal.SIGKILL if body.signal == "KILL" else signal.SIGTERM)
        except psutil.NoSuchProcess:
            raise api_error(404, "not_found", "Proces bestaat niet meer")
        except psutil.AccessDenied:
            raise api_error(403, "forbidden", "Geen rechten op dit proces")
        auditor(identity, f"process:{body.signal.lower()}", f"{pid} {name}")
        return {"ok": True, "pid": pid, "signal": body.signal}

    # Terminal ------------------------------------------------------------------

    @app.websocket("/v1/terminal")
    async def terminal(ws: WebSocket, cols: int = 80, rows: int = 24):
        try:
            identity = auth.websocket_identity(ws)
        except HTTPException as exc:
            await ws.close(code=4401 if exc.status_code == 401 else 4403)
            return
        peer = ws.client.host if ws.client else None
        from hal_common.auth import client_ip

        if limiter.hit("connect", client_ip(ws.headers, peer)) is not None:
            await ws.close(code=4429)
            return
        if state["sessions"] >= MAX_SESSIONS:
            await ws.close(code=4409)
            return
        await ws.accept()
        touch()
        state["sessions"] += 1

        def audit_line(action: str, detail: str) -> None:
            auditor(identity, action, "terminal", detail)

        session = PtySession(cols, rows, audit_line, s.shell)
        auditor(identity, "terminal:open", "terminal", f"{cols}x{rows}")

        async def send(text: str) -> None:
            await ws.send_text(json.dumps({"t": "o", "d": text}))

        pump = asyncio.create_task(session.pump(send))
        try:
            while True:
                recv = asyncio.create_task(ws.receive_text())
                done, _ = await asyncio.wait({recv, pump}, return_when=asyncio.FIRST_COMPLETED)
                if pump in done:
                    recv.cancel()
                    await ws.send_text(json.dumps({"t": "x", "d": "Sessie beëindigd"}))
                    break
                raw = recv.result()
                touch()
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                kind = msg.get("t")
                if kind == "i" and isinstance(msg.get("d"), str):
                    session.write(msg["d"][:65536])
                elif kind == "r":
                    try:
                        session.resize(int(msg.get("c", 80)), int(msg.get("r", 24)))
                    except (TypeError, ValueError, OSError):
                        pass
                elif kind == "p":
                    await ws.send_text(json.dumps({"t": "p"}))
        except WebSocketDisconnect:
            pass
        finally:
            pump.cancel()
            session.close()
            state["sessions"] -= 1
            touch()
            auditor(identity, "terminal:close", "terminal")
            try:
                await ws.close()
            except Exception:
                pass

    return app
