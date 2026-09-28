"""Docker-containers via docker-socket-proxy (alleen GET).

Belangrijk: /containers/{id}/json bevat Config.Env met wachtwoorden en API-keys.
We gebruiken een allowlist van velden. Env, Mounts-bronnen en labels (buiten compose) verlaten de Pi nooit.
"""

from __future__ import annotations

import asyncio
import re
import struct
import time
from typing import Any

import httpx

ID_RE = re.compile(r"^[a-f0-9]{12,64}$")
NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")
SAFE_LABELS = ("com.docker.compose.project", "com.docker.compose.service")


def sanitize_summary(c: dict[str, Any]) -> dict[str, Any]:
    labels = c.get("Labels") or {}
    names = [n.lstrip("/") for n in c.get("Names") or []]
    ports = []
    for p in c.get("Ports") or []:
        ports.append({
            "private": p.get("PrivatePort"),
            "public": p.get("PublicPort"),
            "ip": p.get("IP"),
            "type": p.get("Type"),
        })
    return {
        "id": str(c.get("Id", ""))[:12],
        "name": names[0] if names else str(c.get("Id", ""))[:12],
        "image": str(c.get("Image", "")),
        "state": str(c.get("State", "")),
        "status": str(c.get("Status", "")),
        "created": c.get("Created"),
        "project": labels.get(SAFE_LABELS[0]) or "los",
        "service": labels.get(SAFE_LABELS[1]),
        "ports": ports,
    }


def sanitize_inspect(d: dict[str, Any]) -> dict[str, Any]:
    state = d.get("State") or {}
    health = (state.get("Health") or {}).get("Status")
    cfg = d.get("Config") or {}
    return {
        "restart_count": int(d.get("RestartCount") or 0),
        "health": health or "geen",
        "started_at": state.get("StartedAt"),
        "exit_code": state.get("ExitCode"),
        "oom_killed": bool(state.get("OOMKilled")),
        "image_ref": cfg.get("Image"),
        "restart_policy": ((d.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name"),
    }


def stats_to_usage(s: dict[str, Any]) -> dict[str, Any]:
    try:
        cpu = s["cpu_stats"]
        pre = s["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        sys_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
        ncpu = cpu.get("online_cpus") or len(cpu["cpu_usage"].get("percpu_usage") or [1])
        cpu_pct = (cpu_delta / sys_delta) * ncpu * 100 if sys_delta > 0 and cpu_delta >= 0 else 0.0
    except (KeyError, TypeError, ZeroDivisionError):
        cpu_pct = 0.0
    mem = s.get("memory_stats") or {}
    usage = mem.get("usage") or 0
    cache = (mem.get("stats") or {}).get("inactive_file", 0)
    return {"cpu_percent": round(cpu_pct, 1), "memory_bytes": max(0, usage - cache), "memory_limit": mem.get("limit")}


def demux_logs(raw: bytes) -> list[str]:
    """Docker multiplexed stream: 8-byte header (stream, 0,0,0, size uint32 BE) + payload."""
    lines: list[str] = []
    i = 0
    if len(raw) >= 8 and raw[0] in (0, 1, 2) and raw[1:4] == b"\x00\x00\x00":
        chunks = []
        while i + 8 <= len(raw):
            size = struct.unpack(">I", raw[i + 4:i + 8])[0]
            chunks.append(raw[i + 8:i + 8 + size])
            i += 8 + size
        raw = b"".join(chunks)
    for line in raw.decode("utf-8", "replace").splitlines():
        lines.append(line[:2000])
    return lines


class ContainerCollector:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._cache: list[dict[str, Any]] = []
        self._cache_at = 0.0
        self.error: str | None = None

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=10.0)

    async def refresh(self) -> list[dict[str, Any]]:
        try:
            async with self._client() as client:
                r = await client.get("/containers/json", params={"all": "1"})
                r.raise_for_status()
                items = [sanitize_summary(c) for c in r.json()]
                sem = asyncio.Semaphore(6)

                async def enrich(item: dict[str, Any]) -> None:
                    async with sem:
                        try:
                            ir = await client.get(f"/containers/{item['id']}/json")
                            if ir.status_code == 200:
                                item.update(sanitize_inspect(ir.json()))
                            if item["state"] == "running":
                                sr = await client.get(f"/containers/{item['id']}/stats", params={"stream": "false"})
                                if sr.status_code == 200:
                                    item.update(stats_to_usage(sr.json()))
                        except httpx.HTTPError:
                            pass

                await asyncio.gather(*(enrich(i) for i in items))
            items.sort(key=lambda x: (x["project"], x["name"]))
            self._cache, self._cache_at, self.error = items, time.time(), None
        except (httpx.HTTPError, ValueError) as exc:
            self.error = f"Docker proxy ({exc.__class__.__name__})"
        return self._cache

    def cached(self) -> dict[str, Any]:
        return {"containers": self._cache, "updated_at": int(self._cache_at) or None, "error": self.error}

    def resolve(self, ref: str) -> str | None:
        for c in self._cache:
            if ref == c["id"] or ref == c["name"] or (ID_RE.match(ref) and c["id"].startswith(ref[:12])):
                return c["id"]
        return None

    async def logs(self, cid: str, lines: int) -> list[str]:
        async with self._client() as client:
            r = await client.get(
                f"/containers/{cid}/logs",
                params={"stdout": "1", "stderr": "1", "tail": str(lines), "timestamps": "1"},
            )
            r.raise_for_status()
            return demux_logs(r.content)
