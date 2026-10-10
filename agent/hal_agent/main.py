"""hal-agent: FastAPI-app. Enkel 127.0.0.1, bearer-token + Cloudflare Access, alles in de audit log."""

from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, Path, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from hal_common import VERSION
from hal_common.auth import AuthConfig, Authenticator
from hal_common.i18n import L
from hal_common.ratelimit import RateLimiter
from hal_common.web import api_error, install_common

from .config import HOST_RE, ID_RE, UNIT_RE, Settings
from .history import RANGES
from .maintenance import CONTAINER_NAME_RE

BACKUP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,199}$")

log = logging.getLogger("hal.agent")

METRIC_RE = re.compile(r"^[a-z0-9_.:/@-]{1,120}$")
CONTAINER_REF_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")

RangeKey = Literal["1h", "6h", "24h", "7d", "30d"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RestartBody(Strict):
    name: str = Field(min_length=1, max_length=200)


class GpioBody(Strict):
    action: Literal["on", "off", "pulse", "read", "release"]
    duration_ms: int = Field(default=500, ge=20, le=10000)


class LabelBody(Strict):
    """Bewust uit en categorie van één dienst, container of site. Wat je weglaat, blijft zoals het was.

    parked: true = bewust uit, false = altijd bewaken, null = automatisch.
    group: naam van de categorie, null of "" = automatisch.
    """

    kind: Literal["service", "container", "site", "backup"]
    name: str = Field(min_length=1, max_length=253)
    parked: bool | None = None
    group: str | None = Field(default=None, max_length=40)


class PowerBody(Strict):
    action: Literal["reboot", "poweroff"]
    confirm: str = Field(min_length=1, max_length=40)


def build_backend(settings: Settings):
    if settings.mock:
        from .mock import MockBackend

        return MockBackend(settings)
    from .backend import RealBackend

    return RealBackend(settings)


def create_app(settings: Settings | None = None, backend=None, authenticator: Authenticator | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    backend = backend or build_backend(settings)
    auth = authenticator or Authenticator(AuthConfig(settings.token, settings.team_domain, settings.aud))
    limiter = RateLimiter({"read": (120, 60.0), "action": (5, 60.0), "gpio": (30, 60.0), "label": (30, 60.0)})

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await backend.start()
        log.info("hal-agent %s gestart (mock=%s, access=%s)", VERSION, settings.mock, auth.verifier is not None)
        yield
        await backend.stop()
        log.info("hal-agent gestopt")

    docs = settings.mock
    app = FastAPI(
        title="hal-agent",
        version=VERSION,
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    install_common(app)
    app.state.backend = backend
    app.state.limiter = limiter
    app.state.auth = auth

    read = [Depends(auth.http_dependency), Depends(limiter.dependency("read"))]
    act = [Depends(auth.http_dependency), Depends(limiter.dependency("action"))]
    gpio_lim = [Depends(auth.http_dependency), Depends(limiter.dependency("gpio"))]
    label_lim = [Depends(auth.http_dependency), Depends(limiter.dependency("label"))]

    def audit(identity: dict, action: str, target: str | None, ok: bool, detail: str = "") -> None:
        backend.audit_log.record(identity, action, target, "ok" if ok else "fout", detail)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "version": VERSION}

    @app.get("/v1/info", dependencies=read)
    async def info() -> dict[str, Any]:
        return {"version": VERSION, **backend.info()}

    @app.get("/v1/overview", dependencies=read)
    async def overview() -> dict[str, Any]:
        return await backend.overview()

    @app.get("/v1/device", dependencies=read)
    async def device() -> dict[str, Any]:
        return backend.device()

    @app.get("/v1/disks", dependencies=read)
    async def disks() -> dict[str, Any]:
        return await backend.disks()

    @app.post("/v1/disks/acknowledge-crc", dependencies=act)
    async def ack_crc(identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        await backend.acknowledge_crc()
        audit(identity, "acknowledge-crc", None, True)
        return {"ok": True}

    # Statistieken ------------------------------------------------------------

    @app.get("/v1/stats/metrics", dependencies=read)
    async def stats_metrics() -> list[dict[str, str]]:
        return backend.stats_metrics()

    @app.get("/v1/stats/history", dependencies=read)
    async def stats_history(
        metric: Annotated[str, Query(min_length=1, max_length=2000)],
        range: RangeKey = "1h",  # noqa: A002 - naam uit de API
    ) -> dict[str, Any]:
        metrics = [m.strip() for m in metric.split(",") if m.strip()]
        if not metrics or len(metrics) > 24 or not all(METRIC_RE.match(m) for m in metrics):
            raise api_error(422, "invalid_input", "Ongeldige metric (max 24, komma-gescheiden)")
        if len(metrics) == 1:
            return backend.stats_history(metrics[0], range)
        return {"range": range, "series": [backend.stats_history(m, range) for m in metrics]}

    @app.get("/v1/stats/export", dependencies=read, response_class=PlainTextResponse)
    async def stats_export(metric: Annotated[str, Query(pattern=METRIC_RE.pattern)], range: RangeKey = "24h") -> PlainTextResponse:  # noqa: A002
        body = backend.stats_csv(metric, range)
        safe = re.sub(r"[^a-z0-9_.-]", "_", metric)
        return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{safe}-{range}.csv"'})

    # Diensten, containers, sites --------------------------------------------

    @app.get("/v1/services", dependencies=read)
    async def services(
        filter: Literal["all", "custom", "failed", "active", "parked"] = "all",  # noqa: A002
        q: Annotated[str | None, Query(max_length=60)] = None,
    ) -> list[dict[str, Any]]:
        return await backend.services(filter, q)

    @app.get("/v1/services/{name}/logs", dependencies=read)
    async def service_logs(name: Annotated[str, Path(max_length=200)], lines: Annotated[int, Query(ge=1, le=500)] = 50) -> list[dict[str, Any]]:
        if not UNIT_RE.match(name):
            raise api_error(422, "invalid_input", "Ongeldige dienstnaam")
        return await backend.service_logs(name, lines)

    @app.get("/v1/containers", dependencies=read)
    async def containers() -> dict[str, Any]:
        return backend.containers()

    @app.get("/v1/containers/{ref}/logs", dependencies=read)
    async def container_logs(ref: Annotated[str, Path(max_length=128)], lines: Annotated[int, Query(ge=1, le=500)] = 100) -> dict[str, Any]:
        if not CONTAINER_REF_RE.match(ref):
            raise api_error(422, "invalid_input", "Ongeldige container")
        return {"lines": await backend.container_logs(ref, lines)}

    @app.post("/v1/containers/{ref}/restart", dependencies=act)
    async def container_restart(ref: Annotated[str, Path(max_length=128)], identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        if not CONTAINER_REF_RE.match(ref) or not CONTAINER_NAME_RE.match(ref):
            raise api_error(422, "invalid_input", "Ongeldige container")
        try:
            res = await backend.container_restart(ref)
        except Exception as exc:
            audit(identity, "container:restart", ref, False, str(getattr(exc, "detail", exc))[:200])
            raise
        audit(identity, "container:restart", res.get("name", ref), res["ok"], "" if res["ok"] else res.get("message", ""))
        return res

    # Bewust uit en categorieën ----------------------------------------------

    @app.get("/v1/labels", dependencies=read)
    async def labels() -> dict[str, Any]:
        return backend.labels_info()

    @app.post("/v1/labels", dependencies=label_lim)
    async def labels_set(body: LabelBody, identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        ok_name = {"service": lambda n: bool(UNIT_RE.match(n)), "container": lambda n: bool(CONTAINER_REF_RE.match(n)),
                   "site": lambda n: bool(HOST_RE.match(n)), "backup": lambda n: bool(BACKUP_NAME_RE.match(n))}[body.kind]
        if not ok_name(body.name):
            raise api_error(422, "invalid_input", "Ongeldige invoer")
        changes = {k: getattr(body, k) for k in ("parked", "group") if k in body.model_fields_set}
        if not changes:
            raise api_error(422, "invalid_input", "Ongeldige invoer")
        target = f"{body.kind}:{body.name}"
        detail = ", ".join(f"{k}={'auto' if v in (None, '') else v}" for k, v in changes.items())
        try:
            res = await backend.labels_set(body.kind, body.name, changes)
        except Exception as exc:
            audit(identity, "label", target, False, str(getattr(exc, "detail", exc))[:200])
            raise
        audit(identity, "label", target, True, detail[:200])
        return res

    # Gebeurtenissen en updates ----------------------------------------------

    @app.get("/v1/events", dependencies=read)
    async def events(since: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> dict[str, Any]:
        return backend.events(since, limit)

    @app.get("/v1/updates", dependencies=read)
    async def updates() -> dict[str, Any]:
        return await backend.updates()

    @app.post("/v1/updates/check", dependencies=act)
    async def updates_check(identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        res = await backend.updates_check()
        audit(identity, "updates:check", None, res["ok"])
        return res

    @app.post("/v1/updates/install", dependencies=act)
    async def updates_install(identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        try:
            res = await backend.updates_install()
        except Exception as exc:
            audit(identity, "updates:install", None, False, str(getattr(exc, "detail", exc))[:200])
            raise
        audit(identity, "updates:install", None, res["ok"], res.get("message", ""))
        return res

    @app.get("/v1/agent/update", dependencies=read)
    async def agent_update(refresh: bool = False) -> dict[str, Any]:
        return await backend.agent_update(force=refresh)

    @app.post("/v1/agent/update", dependencies=act)
    async def agent_update_start(identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        try:
            res = await backend.agent_update_start()
        except Exception as exc:
            audit(identity, "agent:update", None, False, str(getattr(exc, "detail", exc))[:200])
            raise
        audit(identity, "agent:update", None, res["ok"], res.get("message", ""))
        return res

    @app.get("/v1/sites", dependencies=read)
    async def sites() -> dict[str, Any]:
        return backend.sites()

    @app.get("/v1/processes", dependencies=read)
    async def processes(
        sort: Literal["cpu", "mem", "pid", "name"] = "cpu",
        limit: Annotated[int, Query(ge=1, le=300)] = 30,
        q: Annotated[str | None, Query(max_length=60)] = None,
    ) -> list[dict[str, Any]]:
        return backend.processes(sort, limit, q)

    @app.get("/v1/backups", dependencies=read)
    async def backups() -> list[dict[str, Any]]:
        return await backend.backups()

    @app.get("/v1/ports", dependencies=read)
    async def ports() -> dict[str, Any]:
        return backend.ports()

    # GPIO en sensoren -------------------------------------------------------

    @app.get("/v1/gpio", dependencies=read)
    async def gpio() -> dict[str, Any]:
        return backend.gpio_state()

    @app.post("/v1/gpio/{pin}", dependencies=gpio_lim)
    async def gpio_action(pin: Annotated[int, Path(ge=0, le=27)], body: GpioBody, identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        try:
            res = await backend.gpio_action(pin, body.action, body.duration_ms)
        except Exception as exc:
            if body.action != "read":
                audit(identity, f"gpio:{body.action}", f"GPIO{pin}", False, getattr(exc, "detail", {}).get("message", "") if hasattr(exc, "detail") else "")
            raise
        if body.action != "read":
            audit(identity, f"gpio:{body.action}", f"GPIO{pin}", True, f"{body.duration_ms} ms" if body.action == "pulse" else "")
        return res

    @app.get("/v1/sensors", dependencies=read)
    async def sensors() -> dict[str, Any]:
        return backend.sensors()

    # Commando's, WoL --------------------------------------------------------

    @app.get("/v1/commands", dependencies=read)
    async def commands() -> list[dict[str, Any]]:
        return backend.commands()

    @app.post("/v1/commands/{cmd_id}/run", dependencies=act)
    async def run_command(cmd_id: Annotated[str, Path(max_length=41)], identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        if not ID_RE.match(cmd_id):
            raise api_error(422, "invalid_input", "Ongeldig commando")
        res = await backend.run_command(cmd_id)
        audit(identity, f"command:{cmd_id}", cmd_id, res["ok"], res.get("reason", ""))
        return res

    @app.get("/v1/wol", dependencies=read)
    async def wol() -> list[dict[str, Any]]:
        return backend.wol_devices()

    @app.post("/v1/wol/{dev_id}", dependencies=act)
    async def wol_send(dev_id: Annotated[str, Path(max_length=41)], identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        if not ID_RE.match(dev_id):
            raise api_error(422, "invalid_input", "Ongeldig apparaat")
        res = await backend.wol_send(dev_id)
        audit(identity, f"wol:{dev_id}", dev_id, True)
        return res

    # Audit en acties --------------------------------------------------------

    @app.get("/v1/audit", dependencies=read)
    async def audit_log(limit: Annotated[int, Query(ge=1, le=500)] = 100) -> list[dict[str, Any]]:
        return await backend.audit(limit)

    @app.get("/v1/actions/allowed", dependencies=read)
    async def allowed() -> dict[str, Any]:
        cfg = backend.config
        return {"restart": backend.restart_allowed(), "containers": cfg.allow("containers"), "updates": cfg.allow("updates"),
                "agent_update": cfg.allow("agent_update"), "power": cfg.allow("power"), "labels": cfg.allow("labels")}

    @app.post("/v1/actions/restart-service", dependencies=act)
    async def restart_service(body: RestartBody, identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        name = body.name if body.name.endswith(".service") else f"{body.name}.service"
        if not UNIT_RE.match(name):
            raise api_error(422, "invalid_input", "Ongeldige dienstnaam")
        try:
            res = await backend.restart_service(name)
        except Exception as exc:
            audit(identity, "restart-service", name, False, str(getattr(exc, "detail", exc)))
            raise
        audit(identity, "restart-service", name, res["ok"], res.get("message", ""))
        return res

    @app.post("/v1/actions/power", dependencies=act)
    async def power(body: PowerBody, identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        expected = backend.info().get("confirm_name") or "server"
        if body.confirm.strip().lower() != str(expected).lower():
            audit(identity, f"power:{body.action}", None, False, "bevestiging klopt niet")
            raise api_error(400, "bad_request", L(f"Bevestig met de servernaam {expected}", f"Confirm with the server name {expected}"))
        audit(identity, f"power:{body.action}", None, True)
        return await backend.power(body.action)

    @app.get("/v1/shell", dependencies=read)
    async def shell_state() -> dict[str, Any]:
        return await backend.shell_state()

    @app.post("/v1/shell/start", dependencies=act)
    async def shell_start(identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        res = await backend.shell_start()
        audit(identity, "shell:start", "hal-shell", res["ok"], res.get("message", ""))
        return res

    @app.post("/v1/shell/stop", dependencies=act)
    async def shell_stop(identity: dict = Depends(auth.http_dependency)) -> dict[str, Any]:
        res = await backend.shell_stop()
        audit(identity, "shell:stop", "hal-shell", res["ok"], res.get("message", ""))
        return res

    assert set(RANGES) == {"1h", "6h", "24h", "7d", "30d"}
    return app
