"""Audit log in SQLite. Elke actie, geslaagd of niet, komt hierin."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


class AuditLog:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS audit (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 ts INTEGER NOT NULL, actor TEXT, ip TEXT, action TEXT NOT NULL,
                 target TEXT, result TEXT NOT NULL, detail TEXT)"""
        )
        self._lock = threading.Lock()

    def record(self, identity: dict[str, Any] | None, action: str, target: str | None, result: str, detail: str = "") -> None:
        identity = identity or {}
        with self._lock:
            self._db.execute(
                "INSERT INTO audit(ts, actor, ip, action, target, result, detail) VALUES (?,?,?,?,?,?,?)",
                (int(time.time()), identity.get("actor", "?"), identity.get("ip", "?"), action, target, result, detail[:2000]),
            )
            self._db.execute("DELETE FROM audit WHERE id < (SELECT MAX(id) - 5000 FROM audit)")

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT ts, actor, ip, action, target, result, detail FROM audit ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [
            {"ts": r[0], "actor": r[1], "ip": r[2], "action": r[3], "target": r[4], "result": r[5], "detail": r[6], "source": "agent"}
            for r in rows
        ]

    def last(self, action: str) -> dict[str, Any] | None:
        with self._lock:
            r = self._db.execute(
                "SELECT ts, actor, result, detail FROM audit WHERE action=? ORDER BY id DESC LIMIT 1", (action,)
            ).fetchone()
        return {"ts": r[0], "actor": r[1], "result": r[2], "detail": r[3]} if r else None


def parse_shell_audit(journal_json: str) -> list[dict[str, Any]]:
    out = []
    for line in journal_json.splitlines():
        try:
            e = json.loads(line)
            msg = json.loads(e.get("MESSAGE", "{}"))
        except ValueError:
            continue
        if not isinstance(msg, dict):
            continue
        out.append({
            "ts": int(msg.get("ts") or int(e.get("__REALTIME_TIMESTAMP", 0)) // 1_000_000),
            "actor": msg.get("actor", "?"),
            "ip": msg.get("ip", "?"),
            "action": str(msg.get("action", "shell")),
            "target": msg.get("target"),
            "result": msg.get("result", "ok"),
            "detail": str(msg.get("detail", ""))[:2000],
            "source": "shell",
        })
    return out
