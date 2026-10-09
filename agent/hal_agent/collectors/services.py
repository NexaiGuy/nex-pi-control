"""systemd-diensten via systemctl en journalctl, altijd met vaste argumentenlijsten."""

from __future__ import annotations

import json
import time
from typing import Any

from hal_common.web import run

SHOW_PROPS = [
    "Id", "ActiveState", "SubState", "LoadState", "Description", "MemoryCurrent",
    "ActiveEnterTimestampMonotonic", "MainPID", "NRestarts", "UnitFileState", "FragmentPath",
]

PRIORITY_LEVEL = {0: "emerg", 1: "alert", 2: "crit", 3: "err", 4: "warning", 5: "notice", 6: "info", 7: "debug"}


def parse_show(text: str) -> list[dict[str, str]]:
    blocks, cur = [], {}
    for line in text.splitlines():
        if not line.strip():
            if cur:
                blocks.append(cur)
                cur = {}
            continue
        k, _, v = line.partition("=")
        cur[k] = v
    if cur:
        blocks.append(cur)
    return blocks


def _uptime_monotonic_us() -> int:
    return int(time.monotonic() * 1_000_000)


def _mem(v: str | None) -> int | None:
    try:
        n = int(v or "")
    except ValueError:
        return None
    return None if n >= 2**63 - 1 or n < 0 else n


class ServiceCollector:
    def __init__(self, cache_seconds: float = 10.0) -> None:
        self.cache_seconds = cache_seconds
        self._cache: tuple[float, list[dict[str, Any]]] | None = None
        # Unitbestand per dienst (intern, gaat niet naar de app): om een site aan een uitgezette dienst te koppelen.
        self.unit_paths: dict[str, str] = {}

    async def list(self, force: bool = False) -> list[dict[str, Any]]:
        if not force and self._cache and time.monotonic() - self._cache[0] < self.cache_seconds:
            return self._cache[1]
        res = await run(["systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--output=json"], timeout=15)
        units = []
        if res.code == 0 and res.stdout.strip():
            try:
                units = [u["unit"] for u in json.loads(res.stdout) if u.get("unit", "").endswith(".service")]
            except (ValueError, KeyError, TypeError):
                units = []
        details: list[dict[str, Any]] = []
        paths: dict[str, str] = {}
        now_us = _uptime_monotonic_us()
        for i in range(0, len(units), 60):
            batch = units[i:i + 60]
            r = await run(["systemctl", "show", "--no-pager", f"--property={','.join(SHOW_PROPS)}", "--", *batch], timeout=15)
            for b in parse_show(r.stdout):
                if b.get("LoadState") == "not-found":
                    continue
                enter = int(b.get("ActiveEnterTimestampMonotonic") or 0)
                active = b.get("ActiveState", "unknown")
                if b.get("FragmentPath"):
                    paths[b.get("Id", "")] = b["FragmentPath"]
                details.append({
                    "name": b.get("Id", ""),
                    "description": b.get("Description", ""),
                    "active": active,
                    "sub": b.get("SubState", ""),
                    "enabled": b.get("UnitFileState", ""),
                    "uptime_seconds": int((now_us - enter) / 1_000_000) if enter and active == "active" else None,
                    "memory_bytes": _mem(b.get("MemoryCurrent")),
                    "main_pid": int(b.get("MainPID") or 0) or None,
                    "restarts": int(b.get("NRestarts") or 0),
                    # Eigen dienst: unitbestand staat in /etc/systemd/system (niet door een pakket geïnstalleerd)
                    "custom": (b.get("FragmentPath") or "").startswith("/etc/systemd/system/"),
                })
        details.sort(key=lambda d: d["name"])
        self.unit_paths = paths
        self._cache = (time.monotonic(), details)
        return details

    async def names(self) -> set[str]:
        return {s["name"] for s in await self.list()}

    async def logs(self, unit: str, lines: int) -> list[dict[str, Any]]:
        r = await run(
            ["journalctl", "--no-pager", "-u", unit, "-n", str(lines), "-o", "json",
             "--output-fields=MESSAGE,PRIORITY,__REALTIME_TIMESTAMP"],
            timeout=15,
        )
        return parse_journal_json(r.stdout)

    def invalidate(self) -> None:
        self._cache = None


def parse_journal_json(text: str) -> list[dict[str, Any]]:
    out = []
    for line in text.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        msg = e.get("MESSAGE", "")
        if isinstance(msg, list):  # binaire berichten komen als bytelijst
            msg = bytes(x for x in msg if isinstance(x, int) and 0 <= x < 256).decode("utf-8", "replace")
        try:
            prio = int(e.get("PRIORITY", 6))
        except (TypeError, ValueError):
            prio = 6
        try:
            ts = int(e.get("__REALTIME_TIMESTAMP", 0)) // 1_000_000
        except (TypeError, ValueError):
            ts = 0
        out.append({"ts": ts, "level": PRIORITY_LEVEL.get(prio, "info"), "message": str(msg)[:2000]})
    return out
