"""Controle van publieke hostnames: HTTP-status, latency, TLS-vervaldatum en de lokale origin."""

from __future__ import annotations

import asyncio
import datetime as dt
import ssl
import time
from typing import Any

import httpx

# Paden die een API vaak heeft als "/" niets teruggeeft (404 bij een kale API-host).
PROBE_PATHS = ("/health", "/healthz", "/api/health", "/status")


def classify(status: int | None) -> str:
    if status is None:
        return "down"
    if status in (401, 403):
        return "protected"
    if 200 <= status < 400:
        return "up"
    if 400 <= status < 500:
        return "warning"
    return "down"


async def tls_expiry(host: str, timeout: float = 8.0) -> int | None:
    ctx = ssl.create_default_context()
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, 443, ssl=ctx, server_hostname=host), timeout)
    except (TimeoutError, OSError, ssl.SSLError):
        return None
    try:
        cert = writer.get_extra_info("peercert") or {}
        not_after = cert.get("notAfter")
        if not not_after:
            return None
        exp = dt.datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.UTC)
        return int(exp.timestamp())
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


class SiteChecker:
    def __init__(self) -> None:
        self.results: dict[str, dict[str, Any]] = {}
        self.updated_at: int | None = None
        # Per host het healthpad dat de vorige keer werkte, zodat we niet elke ronde alles proberen.
        self._probe_hint: dict[str, str] = {}

    async def _probe(self, client: httpx.AsyncClient, host: str) -> tuple[str, int, int] | None:
        """Een host die op / een 4xx geeft: is er een healthpad dat wel antwoordt? (pad, status, ms)"""
        hint = self._probe_hint.get(host)
        order = ([hint] if hint else []) + [p for p in PROBE_PATHS if p != hint]
        for path in order:
            t0 = time.perf_counter()
            try:
                r = await client.get(f"https://{host}{path}", follow_redirects=False)
            except httpx.HTTPError:
                continue
            if classify(r.status_code) == "up":
                self._probe_hint[host] = path
                return path, r.status_code, round((time.perf_counter() - t0) * 1000)
        self._probe_hint.pop(host, None)
        return None

    async def check_one(self, client: httpx.AsyncClient, site: dict[str, Any]) -> dict[str, Any]:
        host, path = site["hostname"], site.get("path") or "/"
        res: dict[str, Any] = {"hostname": host, "url": f"https://{host}{path}", "local": site.get("local"), "source": site.get("source")}
        t0 = time.perf_counter()
        try:
            r = await client.get(f"https://{host}{path}", follow_redirects=False)
            res["status_code"] = r.status_code
            res["latency_ms"] = round((time.perf_counter() - t0) * 1000)
        except httpx.HTTPError as exc:
            res["status_code"] = None
            res["latency_ms"] = None
            res["error"] = exc.__class__.__name__
        res["state"] = classify(res.get("status_code"))
        # Kale API-host: / geeft 404 maar /health antwoordt. Dan is de dienst online, niet "half kapot".
        # Enkel als er op / gecontroleerd werd: een zelf ingesteld pad (bv. /app) proberen we nooit te omzeilen.
        # Gevonden sites krijgen altijd path "/" mee uit site_discovery.merge_sites.
        if res["state"] == "warning" and (site.get("path") or "/") == "/":
            found = await self._probe(client, host)
            if found:
                res["root_status"] = res["status_code"]
                path_found, code, ms = found
                res.update({"url": f"https://{host}{path_found}", "status_code": code, "latency_ms": ms,
                            "state": "up", "probe_path": path_found})
        res["tls_expires_at"] = await tls_expiry(host)
        if res["tls_expires_at"]:
            res["tls_days_left"] = int((res["tls_expires_at"] - time.time()) // 86400)
        local = site.get("local")
        if local and local.startswith("http://127.0.0.1"):
            t1 = time.perf_counter()
            try:
                lr = await client.get(local, headers={"Host": host}, follow_redirects=False)
                res["local_status"] = lr.status_code
                res["local_latency_ms"] = round((time.perf_counter() - t1) * 1000)
                res["local_state"] = classify(lr.status_code)
            except httpx.HTTPError as exc:
                res["local_status"] = None
                res["local_state"] = "down"
                res["local_error"] = exc.__class__.__name__
        res["checked_at"] = int(time.time())
        return res

    async def refresh(self, sites: list[dict[str, Any]]) -> None:
        if not sites:
            self.results = {}
            self.updated_at = int(time.time())
            return
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "hal-agent/1.0 (+uptime)"}) as client:
            sem = asyncio.Semaphore(8)

            async def one(s):
                async with sem:
                    return await self.check_one(client, s)

            done = await asyncio.gather(*(one(s) for s in sites), return_exceptions=True)
        fresh = {}
        for s, r in zip(sites, done, strict=True):
            if isinstance(r, Exception):
                fresh[s["hostname"]] = {"hostname": s["hostname"], "state": "down", "error": r.__class__.__name__, "source": s.get("source")}
            else:
                fresh[s["hostname"]] = r
        self.results = fresh
        self.updated_at = int(time.time())

    def history_values(self) -> dict[str, float]:
        return {f"site.{h}.latency": r["latency_ms"] for h, r in self.results.items() if r.get("latency_ms") is not None}
