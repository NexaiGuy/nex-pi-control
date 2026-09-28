"""Processen, backups, poortregister en Wake-on-LAN."""

from __future__ import annotations

import re
import socket
import time
from pathlib import Path
from typing import Any

import psutil

from hal_common.i18n import L

SECRET_ARG = re.compile(
    r"(?i)(--?(?:password|passwd|pass|token|secret|api[-_]?key|key|auth)[=\s]+)(\S+)|"
    r"((?:PASSWORD|TOKEN|SECRET|API_KEY|PGPASSWORD)=)(\S+)|"
    r"(://[^:/\s]+:)([^@\s]+)(@)"
)


def redact(cmd: str) -> str:
    def sub(m: re.Match) -> str:
        if m.group(1):
            return m.group(1) + "•••"
        if m.group(3):
            return m.group(3) + "•••"
        return m.group(5) + "•••" + m.group(7)

    return SECRET_ARG.sub(sub, cmd)


class ProcessCollector:
    def __init__(self) -> None:
        self._procs: dict[int, psutil.Process] = {}

    def prime(self) -> None:
        self.list(sort="cpu", limit=0)

    def list(self, sort: str = "cpu", limit: int = 30, query: str | None = None) -> list[dict[str, Any]]:
        seen = set()
        rows = []
        mem_total = psutil.virtual_memory().total
        for p in psutil.process_iter(["pid", "name", "username", "status", "create_time", "num_threads"]):
            pid = p.info["pid"]
            seen.add(pid)
            proc = self._procs.get(pid)
            if proc is None or proc.create_time() != p.info["create_time"]:
                proc = p
                self._procs[pid] = proc
            try:
                cpu = proc.cpu_percent(None)
                mem = proc.memory_info().rss
                try:
                    cmd = " ".join(proc.cmdline())
                except (psutil.AccessDenied, psutil.ZombieProcess):
                    cmd = ""
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            rows.append({
                "pid": pid,
                "name": p.info["name"] or "",
                "user": p.info["username"] or "",
                "status": p.info["status"],
                "cpu_percent": round(cpu / max(psutil.cpu_count() or 1, 1), 1),
                "memory_bytes": mem,
                "memory_percent": round(mem / mem_total * 100, 2) if mem_total else 0,
                "threads": p.info["num_threads"],
                "started_at": int(p.info["create_time"] or 0),
                "command": redact(cmd)[:400],
            })
        for pid in list(self._procs):
            if pid not in seen:
                del self._procs[pid]
        if query:
            q = query.lower()
            rows = [r for r in rows if q in r["name"].lower() or q in r["command"].lower() or q == str(r["pid"])]
        key = {"cpu": "cpu_percent", "mem": "memory_bytes", "pid": "pid", "name": "name"}.get(sort, "cpu_percent")
        rows.sort(key=lambda r: r[key], reverse=key not in ("pid", "name"))
        return rows[:limit] if limit else rows


def backups(roots: list[Path], max_depth: int = 2) -> list[dict[str, Any]]:
    out = []
    now = time.time()
    for root in roots:
        try:
            entries = sorted(p for p in root.iterdir() if p.is_dir())
        except OSError:
            out.append({"name": str(root), "path": str(root), "state": "no_access"})
            continue
        for d in entries:
            newest = None
            total, count = 0, 0
            try:
                stack = [(d, 0)]
                while stack:
                    cur, depth = stack.pop()
                    for f in cur.iterdir():
                        if f.is_symlink():
                            continue
                        if f.is_dir() and depth < max_depth:
                            stack.append((f, depth + 1))
                        elif f.is_file():
                            st = f.stat()
                            total += st.st_size
                            count += 1
                            if newest is None or st.st_mtime > newest[1]:
                                newest = (f.name, st.st_mtime, st.st_size)
            except PermissionError:
                out.append({"name": d.name, "path": str(d), "state": "no_access"})
                continue
            except OSError:
                continue
            if newest:
                out.append({
                    "name": d.name, "path": str(d), "state": "ok",
                    "latest_file": newest[0], "latest_at": int(newest[1]),
                    "latest_size": newest[2], "age_seconds": int(now - newest[1]),
                    "total_size": total, "files": count,
                })
            else:
                out.append({"name": d.name, "path": str(d), "state": "empty", "files": 0})
    return out


ROW_RE = re.compile(r"^\|\s*(\d{2,5})\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|")


def parse_ports_md(text: str) -> list[dict[str, Any]]:
    rows = []
    for line in text.splitlines():
        m = ROW_RE.match(line.strip())
        if m:
            port = int(m.group(1))
            if 1 <= port <= 65535:
                rows.append({"port": port, "address": m.group(2), "service": m.group(3)})
    return rows


def listening_ports() -> set[int]:
    ports = set()
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.status == psutil.CONN_LISTEN and c.laddr:
                ports.add(c.laddr.port)
    except (psutil.AccessDenied, OSError):
        pass
    return ports


def ports(path: Path) -> dict[str, Any]:
    try:
        registry = parse_ports_md(path.read_text(encoding="utf-8"))
        error = None
    except OSError:
        registry, error = [], L(f"{path} niet leesbaar", f"{path} not readable")
    listening = listening_ports()
    known = {r["port"] for r in registry}
    for r in registry:
        r["listening"] = r["port"] in listening
    unregistered = sorted(p for p in listening if p not in known and p < 32768)
    return {"registry": registry, "unregistered_listening": unregistered, "error": error}


def magic_packet(mac: str) -> bytes:
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    if len(raw) != 6:
        raise ValueError("ongeldig MAC-adres")
    return b"\xff" * 6 + raw * 16


def send_wol(mac: str, broadcast: str = "255.255.255.255", port: int = 9) -> None:
    pkt = magic_packet(mac)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(pkt, (broadcast, port))
