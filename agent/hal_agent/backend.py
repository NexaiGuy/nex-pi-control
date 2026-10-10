"""De echte backend op de Pi: verbindt collectors, achtergrondlussen, statistieken en acties."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from hal_common import VERSION
from hal_common.i18n import L, tr
from hal_common.web import api_error, run

from . import actions
from .audit import AuditLog, parse_shell_audit
from .collectors import disks as disk_inv
from .collectors import misc
from .collectors.backup_timers import timer_backups
from .collectors.containers import ContainerCollector
from .collectors.gpio import GpioManager, GpioUnavailable, discover_sensors, read_sensor
from .collectors.services import ServiceCollector
from .collectors.sites import SiteChecker
from .collectors.smart import SmartStore
from .collectors.system import SystemSampler, device_info, mounts
from .config import ConfigFiles, Settings
from .health import compute_health, counts, disk_alarms
from .history import METRIC_CATALOG, HistoryStore, describe_metric
from .labels import KINDS, Labels, LabelStore, parked_keys
from .maintenance import (
    AGENT_UPDATE_UNIT,
    APT_CHECK_UNIT,
    APT_UPGRADE_UNIT,
    EventStore,
    ReleaseChecker,
    conditions,
    container_unit,
    read_apt_status,
    update_available,
)

log = logging.getLogger("hal.backend")


class RealBackend:
    mock = False

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.config = ConfigFiles(settings.config_dir, settings.state_dir / "sites" / "discovered.json")
        settings.state_dir.mkdir(parents=True, exist_ok=True)
        self.audit_log = AuditLog(settings.state_dir / "audit.db")
        self.history = HistoryStore(settings.state_dir / "history.db")
        self.events_store = EventStore(settings.state_dir / "events.db")
        self.apt_path = settings.state_dir / "apt" / "status.json"
        self.releases = ReleaseChecker(settings.update_repo, settings.update_check)
        self.sampler = SystemSampler()
        self.smart = SmartStore(settings.state_dir / "smart", settings.state_dir / "smart-crc.json")
        self.services_c = ServiceCollector()
        self.containers_c = ContainerCollector(settings.docker_proxy)
        self.sites_c = SiteChecker()
        self.processes_c = ProcessHolder()
        self.gpio = GpioManager()
        self.sensor_values: dict[str, dict[str, Any]] = {}
        self._backups_cache: tuple[float, list] | None = None
        self._services_snapshot: list[dict[str, Any]] = []
        self.labels = Labels(self.config.groups, LabelStore(settings.state_dir / "labels.json"))
        self._parked_keys: set[str] = set()
        self._ports_cache: tuple[float | None, list[dict[str, Any]]] = (None, [])
        self._tasks: list[asyncio.Task] = []
        self._pending: set[asyncio.Task] = set()

    # Levenscyclus -----------------------------------------------------------

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._loop_fast(), name="fast"),
            asyncio.create_task(self._loop_every(30, self._refresh_containers), name="containers"),
            asyncio.create_task(self._loop_every(60, self._refresh_sites), name="sites"),
            asyncio.create_task(self._loop_every(30, self._refresh_services), name="services"),
            asyncio.create_task(self._loop_every(60, self._refresh_sensors), name="sensors"),
            asyncio.create_task(self._loop_every(60, self._maintain), name="maintain"),
            asyncio.create_task(self._loop_events(), name="events"),
        ]

    async def stop(self) -> None:
        for t in self._tasks + list(self._pending):
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self.gpio.close()
        self.history.close()
        self.events_store.close()

    async def _loop_every(self, seconds: float, fn) -> None:
        while True:
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Achtergrondtaak %s faalde", getattr(fn, "__name__", fn))
            await asyncio.sleep(seconds)

    async def _loop_fast(self) -> None:
        tick = 0
        while True:
            try:
                self.sampler.sample()
                if tick % 5 == 0:  # elke 10 s
                    values = self.sampler.history_values()
                    if tick % 30 == 0:  # elke 60 s
                        for m in mounts():
                            values[f"disk.usage:{m['mountpoint']}"] = m["percent"]
                        values.update(self.sites_c.history_values())
                        for sid, sv in self.sensor_values.items():
                            for k, v in (sv.get("values") or {}).items():
                                values[f"sensor.{sid}.{k}"] = v
                    cached = self.containers_c.cached()["containers"]
                    if cached:
                        values["containers.running"] = sum(1 for c in cached if c["state"] == "running")
                    if self._services_snapshot:
                        values["services.failed"] = sum(1 for s in self._services_snapshot
                                                        if s["active"] == "failed" and f"service:{s['name']}" not in self._parked_keys)
                    await asyncio.to_thread(self.history.write, int(time.time()), values)
                    await asyncio.to_thread(self.processes_c.prime)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Meting faalde")
            tick += 1
            await asyncio.sleep(2)

    async def _refresh_containers(self) -> None:
        await self.containers_c.refresh()

    async def _refresh_sites(self) -> None:
        # hal-shell staat standaard uit: zijn tunnel-hostname is geen site en zou anders altijd offline lijken.
        shell = f"http://127.0.0.1:{os.environ.get('HAL_SHELL_PORT', '8121')}"
        await self.sites_c.refresh(self.config.site_list({shell}))

    async def _refresh_services(self) -> None:
        self._services_snapshot = await self.services_c.list(force=True)

    async def _refresh_sensors(self) -> None:
        for s in self.config.sensor_list():
            try:
                vals = await asyncio.to_thread(read_sensor, s)
                self.sensor_values[s["id"]] = {"values": vals, "error": None, "ts": int(time.time())}
            except Exception as exc:  # hardwarefouten mogen de lus niet stoppen
                prev = self.sensor_values.get(s["id"], {})
                self.sensor_values[s["id"]] = {"values": prev.get("values"), "error": str(exc)[:200], "ts": prev.get("ts")}

    async def _loop_events(self) -> None:
        # Eerst de collectors een ronde laten draaien, anders lijkt alles "opgelost" bij de start.
        await asyncio.sleep(45)
        await self._loop_every(30, self._refresh_events)

    async def _refresh_events(self) -> None:
        ctr = self.containers_c.cached()
        svc, cts, sts = self._labeled(self._services_snapshot, ctr["containers"], list(self.sites_c.results.values()), with_groups=False)
        self._parked_keys = parked_keys(svc, cts, sts)
        conds = conditions(self.smart.read_all(), svc, cts, sts, read_apt_status(self.apt_path))
        # Nog geen (geldige) meting: open problemen van die soort niet als "opgelost" melden.
        unknown = set()
        if self.sites_c.updated_at is None:
            unknown.add("site")
        if not self._services_snapshot:
            unknown.add("service")
        if ctr.get("updated_at") is None or ctr.get("error"):
            unknown.add("container")
        await asyncio.to_thread(self.events_store.sync, conds, None, unknown, self._parked_keys)

    async def _maintain(self) -> None:
        await asyncio.to_thread(self.history.maintain)

    def _spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._pending.add(t)
        t.add_done_callback(self._pending.discard)

    # Bewust uit en categorieën ---------------------------------------------

    def _port_registry(self) -> list[dict[str, Any]]:
        """Het poortregister (PORTS.md), opnieuw ingelezen als het wijzigt. Koppelt een poort aan een dienstnaam."""
        path = self.settings.ports_file
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return []
        if self._ports_cache[0] != mtime:
            try:
                rows = misc.parse_ports_md(path.read_text(encoding="utf-8"))
            except OSError:
                rows = []
            self._ports_cache = (mtime, rows)
        return self._ports_cache[1]

    def _labeled(self, services, containers, sites, with_groups: bool = True):
        return self.labels.annotate(services, containers, sites, self.services_c.unit_paths, self._port_registry(), with_groups)

    def _labeled_backups(self, backups, services, containers):
        """Back-ups van wat bewust uit staat (labels.annotate_backups). Na de cache: een wijziging in de app telt meteen."""
        return self.labels.annotate_backups(backups, services, containers, self.config.backup_policy()["max_age_seconds"])

    def labels_info(self) -> dict[str, Any]:
        cfg = self.labels.settings()
        return {"groups": self.labels.group_names(), "auto_parked": cfg["auto_parked"], "editable": self.config.allow("labels")}

    async def labels_set(self, kind: str, name: str, changes: dict[str, Any]) -> dict[str, Any]:
        if kind not in KINDS and kind != "backup":
            raise api_error(422, "invalid_input", "Ongeldige invoer")
        if kind == "backup" and "group" in changes:
            raise api_error(422, "invalid_input", "Ongeldige invoer")
        if not self.config.allow("labels"):
            raise api_error(403, "forbidden", L("Categorieën en bewust uit staan uit in allowed-actions.yml", "Categories and switched off are disabled in allowed-actions.yml"))
        if kind == "service":
            known = {s["name"] for s in self._services_snapshot or await self.services_c.list()}
        elif kind == "container":
            known = {c["name"] for c in self.containers_c.cached()["containers"]}
        elif kind == "backup":
            known = {b["name"] for b in await self._backups() if b.get("kind", "job") == "job"}
        else:
            known = set(self.sites_c.results)
        if name not in known:
            raise api_error(404, "not_found", L("Onbekend item", "Unknown item"))
        if "group" in changes:
            try:
                changes["group"] = self.labels.validate_group(changes["group"])
            except ValueError:
                raise api_error(422, "invalid_input", "Ongeldige invoer")
        try:
            entry = await asyncio.to_thread(self.labels.store.set, kind, name, changes)
        except (OSError, ValueError) as exc:
            raise api_error(409, "conflict", L(f"Opslaan mislukt: {exc}", f"Saving failed: {exc}"))
        # Meteen opnieuw rekenen, zodat open meldingen van wat nu bewust uit staat niet 30 s blijven hangen.
        self._spawn(self._refresh_events())
        return {"ok": True, "kind": kind, "name": name, "parked_setting": entry.get("parked"), "group_setting": entry.get("group")}

    # Lezen -----------------------------------------------------------------

    def info(self) -> dict[str, Any]:
        return {
            "hostname": device_info()["hostname"],
            "confirm_name": self.settings.hostname_confirm or device_info()["hostname"],
            "mock": False,
            "gpio_available": self.gpio.available,
            "shell_url": self.settings.shell_url,
            "access_configured": bool(self.settings.team_domain and self.settings.aud),
            "features": ["events", "updates", "agent_update", "container_restart", "labels", "backup_labels"],
        }

    async def _backups(self) -> list[dict[str, Any]]:
        if self._backups_cache and time.monotonic() - self._backups_cache[0] < 300:
            return self._backups_cache[1]
        policy = self.config.backup_policy()
        dirs = await asyncio.to_thread(lambda: misc.classify_backups(misc.backups(self.settings.backup_roots), policy))
        try:
            timers = await timer_backups(policy["timers"], policy["max_age_seconds"])
        except Exception:  # systemctl onbereikbaar: de mappen tellen nog
            log.exception("Back-uptimers lezen faalde")
            timers = []
        data = timers + dirs
        self._backups_cache = (time.monotonic(), data)
        return data

    async def overview(self) -> dict[str, Any]:
        snap = self.sampler.snapshot
        m = mounts()
        smart = self.smart.read_all()
        services, containers, sites = self._labeled(self._services_snapshot or await self.services_c.list(),
                                                    self.containers_c.cached()["containers"], list(self.sites_c.results.values()), with_groups=False)
        backups = self._labeled_backups(await self._backups(), services, containers)
        return {
            "ts": int(time.time()),
            "health": compute_health(snap, m, smart, services, containers, sites, backups),
            "disk_alarms": disk_alarms(smart),
            "system": snap,
            "mounts": m,
            "smart": [{"device": s.get("device"), "status": s.get("status"), "model": s.get("model")} for s in smart],
            "counts": counts(services, containers, sites, backups),
        }

    def device(self) -> dict[str, Any]:
        return device_info()

    async def disks(self) -> dict[str, Any]:
        smart = self.smart.read_all()
        m = mounts()
        inv = await asyncio.to_thread(disk_inv.inventory)
        return {"mounts": m, "smart": smart, "disks": disk_inv.merge(smart, inv, m), "disk_alarms": disk_alarms(smart)}

    async def acknowledge_crc(self) -> None:
        self.smart.acknowledge_crc()

    async def services(self, filt: str, q: str | None) -> list[dict[str, Any]]:
        items = await self.services_c.list()
        items, _, _ = self._labeled(items, self.containers_c.cached()["containers"], [])
        allowed = set(self.config.restart_units())
        out = []
        for s in items:
            if filt == "custom" and not s.get("custom"):
                continue
            if filt == "failed" and (s["active"] != "failed" or s["parked"]):
                continue
            if filt == "parked" and not s["parked"]:
                continue
            if filt == "active" and s["active"] != "active":
                continue
            if q and q.lower() not in s["name"].lower() and q.lower() not in s["description"].lower():
                continue
            out.append({**s, "restart_allowed": s["name"] in allowed})
        return out

    async def service_logs(self, name: str, lines: int) -> list[dict[str, Any]]:
        if name not in await self.services_c.names():
            raise api_error(404, "not_found", "Onbekende dienst")
        return await self.services_c.logs(name, lines)

    def containers(self) -> dict[str, Any]:
        data = self.containers_c.cached()
        _, items, _ = self._labeled([], data["containers"], [])
        return {**data, "containers": [{**c, "restart_allowed": self.config.container_restart_allowed(c["name"])} for c in items]}

    async def container_logs(self, ref: str, lines: int) -> list[str]:
        cid = self.containers_c.resolve(ref)
        if not cid:
            raise api_error(404, "not_found", "Onbekende container")
        try:
            return await self.containers_c.logs(cid, lines)
        except Exception:
            raise api_error(503, "unavailable", "Docker-proxy onbereikbaar")

    def sites(self) -> dict[str, Any]:
        _, _, items = self._labeled(self._services_snapshot, self.containers_c.cached()["containers"], list(self.sites_c.results.values()))
        return {"sites": sorted(items, key=lambda s: s["hostname"]), "updated_at": self.sites_c.updated_at,
                "discovery": self.config.site_discovery()}

    def processes(self, sort: str, limit: int, q: str | None) -> list[dict[str, Any]]:
        return self.processes_c.collector.list(sort=sort, limit=limit, query=q)

    async def backups(self) -> list[dict[str, Any]]:
        services, containers, _ = self._labeled(self._services_snapshot or await self.services_c.list(),
                                                self.containers_c.cached()["containers"], [], with_groups=False)
        return self._labeled_backups(await self._backups(), services, containers)

    def ports(self) -> dict[str, Any]:
        return misc.ports(self.settings.ports_file)

    def gpio_state(self) -> dict[str, Any]:
        return self.gpio.state(self.config.gpio_allowed(), self.config.gpio_labels())

    async def gpio_action(self, pin: int, action: str, duration_ms: int) -> dict[str, Any]:
        if pin not in self.config.gpio_allowed() or pin in (0, 1):
            raise api_error(403, "forbidden", L(f"GPIO{pin} staat niet in allowed_pins van gpio.yml", f"GPIO{pin} is not listed in allowed_pins in gpio.yml"))
        try:
            if action == "on":
                return self.gpio.set(pin, 1)
            if action == "off":
                return self.gpio.set(pin, 0)
            if action == "pulse":
                return await self.gpio.pulse(pin, duration_ms)
            if action == "read":
                return self.gpio.read(pin)
            if action == "release":
                self.gpio.release(pin)
                return {"pin": pin, "released": True}
        except GpioUnavailable as exc:
            raise api_error(409, "conflict", tr(str(exc)))
        except OSError as exc:
            raise api_error(409, "conflict", L(f"GPIO{pin} is bezet of niet toegankelijk: {exc.strerror or exc}", f"GPIO{pin} is busy or not accessible: {exc.strerror or exc}"))
        raise api_error(400, "bad_request", "Onbekende actie")

    def sensors(self) -> dict[str, Any]:
        out = []
        for s in self.config.sensor_list():
            v = self.sensor_values.get(s["id"], {})
            out.append({"id": s["id"], "name": s.get("name") or s["id"], "type": s["type"],
                        "values": v.get("values"), "error": v.get("error"), "ts": v.get("ts")})
        return {"sensors": out, "discovered": discover_sensors()}

    def commands(self) -> list[dict[str, Any]]:
        cmds = self.config.command_list()
        for c in cmds:
            c["last_run"] = self.audit_log.last(f"command:{c['id']}")
        return cmds

    async def run_command(self, cmd_id: str) -> dict[str, Any]:
        cmd = next((c for c in self.config.command_list() if c["id"] == cmd_id), None)
        if not cmd:
            raise api_error(404, "not_found", "Onbekend commando")
        ok, lines, reason = await actions.run_oneshot(actions.command_unit(cmd_id), cmd["timeout"])
        return {"ok": ok, "output": lines, "reason": reason}

    def wol_devices(self) -> list[dict[str, Any]]:
        devs = self.config.wol_devices()
        for d in devs:
            d["last_woken"] = self.audit_log.last(f"wol:{d['id']}")
        return devs

    async def wol_send(self, dev_id: str) -> dict[str, Any]:
        dev = next((d for d in self.config.wol_devices() if d["id"] == dev_id), None)
        if not dev:
            raise api_error(404, "not_found", "Onbekend apparaat")
        await asyncio.to_thread(misc.send_wol, dev["mac"], dev["broadcast"], dev["port"])
        return {"ok": True, "device": dev["name"]}

    async def audit(self, limit: int) -> list[dict[str, Any]]:
        rows = self.audit_log.recent(limit)
        r = await run(["journalctl", "--no-pager", "-t", "hal-shell-audit", "-o", "json", "-n", str(limit)], timeout=10)
        rows += parse_shell_audit(r.stdout)
        rows.sort(key=lambda x: x["ts"], reverse=True)
        return rows[:limit]

    def restart_allowed(self) -> list[str]:
        return self.config.restart_units()

    async def restart_service(self, name: str) -> dict[str, Any]:
        if name not in self.config.restart_units():
            raise api_error(403, "forbidden", "Deze dienst staat niet in allowed-actions.yml")
        if name not in await self.services_c.names():
            raise api_error(404, "not_found", "Onbekende dienst")
        ok, msg = await actions.restart_unit(name)
        self.services_c.invalidate()
        return {"ok": ok, "message": msg}

    async def power(self, action: str) -> dict[str, Any]:
        self._spawn(actions.power(action))
        name = device_info()["hostname"]
        return {"ok": True, "message": L(f"{name} herstart over 3 s", f"{name} restarts in 3 s") if action == "reboot" else L(f"{name} schakelt uit over 3 s", f"{name} shuts down in 3 s")}

    async def shell_state(self) -> dict[str, Any]:
        st = await actions.unit_state(actions.SHELL_UNIT)
        return {**st, "url": self.settings.shell_url, "idle_timeout_seconds": 900}

    async def shell_start(self) -> dict[str, Any]:
        ok, msg = await actions.start_unit(actions.SHELL_UNIT)
        return {"ok": ok, "message": msg or (L("Beheermodus gestart", "Admin mode started") if ok else L("Starten mislukt", "Start failed"))}

    async def shell_stop(self) -> dict[str, Any]:
        ok, msg = await actions.stop_unit(actions.SHELL_UNIT)
        return {"ok": ok, "message": msg or (L("Beheermodus gestopt", "Admin mode stopped") if ok else L("Stoppen mislukt", "Stop failed"))}

    # Onderhoud: gebeurtenissen, updates, containers --------------------------

    def events(self, since: int, limit: int) -> dict[str, Any]:
        return self.events_store.list(since, limit)

    def _disk_blocked(self) -> str | None:
        alarms = disk_alarms(self.smart.read_all())
        if alarms:
            return L(f"Schijf {alarms[0]['device']} toont tekenen van falen. Eerst een back-up maken, daarna pas updates installeren.",
                     f"Disk {alarms[0]['device']} shows signs of failure. Back up first, install updates afterwards.")
        return None

    async def updates(self) -> dict[str, Any]:
        apt = read_apt_status(self.apt_path)
        upgrade = await actions.unit_run_info(APT_UPGRADE_UNIT, max_lines=200)
        check = await actions.unit_state(APT_CHECK_UNIT)
        return {**apt, "allowed": self.config.allow("updates"), "checking": check["active"], "upgrade": upgrade,
                "blocked_reason": self._disk_blocked()}

    async def updates_check(self) -> dict[str, Any]:
        if not self.config.allow("updates"):
            raise api_error(403, "forbidden", L("Systeemupdates staan uit in allowed-actions.yml", "System updates are disabled in allowed-actions.yml"))
        ok, msg = await actions.start_unit_nowait(APT_CHECK_UNIT)
        return {"ok": ok, "message": msg or (L("Controle gestart", "Check started") if ok else L("Starten mislukt", "Start failed"))}

    async def updates_install(self) -> dict[str, Any]:
        if not self.config.allow("updates"):
            raise api_error(403, "forbidden", L("Systeemupdates staan uit in allowed-actions.yml", "System updates are disabled in allowed-actions.yml"))
        blocked = self._disk_blocked()
        if blocked:
            raise api_error(409, "conflict", blocked)
        if (await actions.unit_run_info(APT_UPGRADE_UNIT, max_lines=1))["running"]:
            raise api_error(409, "conflict", L("Er loopt al een update", "An update is already running"))
        ok, msg = await actions.start_unit_nowait(APT_UPGRADE_UNIT)
        return {"ok": ok, "message": msg or (L("Updates worden geïnstalleerd", "Installing updates") if ok else L("Starten mislukt", "Start failed"))}

    async def agent_update(self, force: bool = False) -> dict[str, Any]:
        latest = await self.releases.latest(force=force)
        run_info = await actions.unit_run_info(AGENT_UPDATE_UNIT, max_lines=200)
        return {"current": VERSION, "latest": latest["version"], "tag": latest["tag"], "url": latest["url"], "notes": latest["notes"],
                "error": latest["error"], "update_available": update_available(VERSION, latest["version"]),
                "allowed": self.config.allow("agent_update"), "run": run_info}

    async def agent_update_start(self) -> dict[str, Any]:
        if not self.config.allow("agent_update"):
            raise api_error(403, "forbidden", L("Agent-updates staan uit in allowed-actions.yml", "Agent updates are disabled in allowed-actions.yml"))
        st = await self.agent_update(force=True)
        if not st["update_available"]:
            raise api_error(409, "conflict", L("Je hebt al de nieuwste versie", "You already have the latest version"))
        if st["run"]["running"]:
            raise api_error(409, "conflict", L("De update loopt al", "The update is already running"))
        ok, msg = await actions.start_unit_nowait(AGENT_UPDATE_UNIT)
        return {"ok": ok, "message": msg or (L(f"Update naar {st['latest']} gestart. De agent herstart zo meteen.", f"Update to {st['latest']} started. The agent restarts shortly.") if ok else L("Starten mislukt", "Start failed"))}

    async def container_restart(self, ref: str) -> dict[str, Any]:
        cid = self.containers_c.resolve(ref)
        c = next((x for x in self.containers_c.cached()["containers"] if x["id"] == cid), None)
        if not c:
            raise api_error(404, "not_found", "Onbekende container")
        if not self.config.container_restart_allowed(c["name"]):
            raise api_error(403, "forbidden", L("Herstarten van deze container staat uit in allowed-actions.yml", "Restarting this container is disabled in allowed-actions.yml"))
        ok, lines, reason = await actions.run_oneshot(container_unit(c["name"]), 120)
        self._spawn(self._refresh_containers())
        return {"ok": ok, "name": c["name"], "output": lines[-20:], "message": reason or (L(f"{c['name']} herstart", f"{c['name']} restarted") if ok else L("Herstarten mislukt", "Restart failed"))}

    # Statistieken -----------------------------------------------------------

    def stats_metrics(self) -> list[dict[str, str]]:
        names = set(self.history.metrics()) | set(METRIC_CATALOG)
        return [describe_metric(m) for m in sorted(names)]

    def stats_history(self, metric: str, range_key: str) -> dict[str, Any]:
        return {**self.history.query(metric, range_key), **describe_metric(metric)}

    def stats_csv(self, metric: str, range_key: str) -> str:
        return self.history.export_csv(metric, range_key)


class ProcessHolder:
    def __init__(self) -> None:
        self.collector = misc.ProcessCollector()

    def prime(self) -> None:
        self.collector.prime()
