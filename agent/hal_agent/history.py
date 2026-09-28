"""Statistieken-opslag in SQLite met drie niveaus.

raw   : 10 s resolutie, 25 uur bewaard
agg1  : 1 minuut (gem/min/max), 8 dagen bewaard
agg5  : 5 minuten (gem/min/max), 31 dagen bewaard
"""

from __future__ import annotations

import csv
import io
import sqlite3
import threading
import time
from collections.abc import Iterable
from pathlib import Path

from hal_common.i18n import L

RANGES: dict[str, tuple[int, str, int]] = {
    # range -> (seconden, tabel, bucketgrootte in s)
    "1h": (3600, "raw", 10),
    "6h": (6 * 3600, "raw", 60),
    "24h": (24 * 3600, "raw", 240),
    "7d": (7 * 86400, "agg1", 1800),
    "30d": (30 * 86400, "agg5", 7200),
}

RETENTION = {"raw": 25 * 3600, "agg1": 8 * 86400, "agg5": 31 * 86400}


class HistoryStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS raw (ts INTEGER NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS raw_mt ON raw(metric, ts);
            CREATE TABLE IF NOT EXISTS agg1 (ts INTEGER NOT NULL, metric TEXT NOT NULL, avg REAL, min REAL, max REAL, PRIMARY KEY(metric, ts));
            CREATE TABLE IF NOT EXISTS agg5 (ts INTEGER NOT NULL, metric TEXT NOT NULL, avg REAL, min REAL, max REAL, PRIMARY KEY(metric, ts));
            CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);
            """
        )

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def write(self, ts: int, values: dict[str, float]) -> None:
        rows = [(ts, k, float(v)) for k, v in values.items() if v is not None]
        if not rows:
            return
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany("INSERT INTO raw(ts, metric, value) VALUES (?,?,?)", rows)
            self._db.execute("COMMIT")

    def _meta(self, key: str) -> int | None:
        row = self._db.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
        return row[0] if row else None

    def _set_meta(self, key: str, v: int) -> None:
        self._db.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?,?)", (key, v))

    def maintain(self, now: int | None = None) -> None:
        """Aggregeert afgeronde minuten en blokken van 5 minuten, en ruimt oude data op."""
        now = int(time.time()) if now is None else now
        with self._lock:
            self._db.execute("BEGIN")
            end1 = now - now % 60
            start1 = self._meta("agg1_done") or (end1 - RETENTION["raw"])
            if end1 > start1:
                self._db.execute(
                    """INSERT OR REPLACE INTO agg1(ts, metric, avg, min, max)
                       SELECT (ts/60)*60, metric, AVG(value), MIN(value), MAX(value)
                       FROM raw WHERE ts >= ? AND ts < ? GROUP BY metric, ts/60""",
                    (start1, end1),
                )
                self._set_meta("agg1_done", end1)
            end5 = now - now % 300
            start5 = self._meta("agg5_done") or (end5 - RETENTION["agg1"])
            if end5 > start5:
                self._db.execute(
                    """INSERT OR REPLACE INTO agg5(ts, metric, avg, min, max)
                       SELECT (ts/300)*300, metric, AVG(avg), MIN(min), MAX(max)
                       FROM agg1 WHERE ts >= ? AND ts < ? GROUP BY metric, ts/300""",
                    (start5, end5),
                )
                self._set_meta("agg5_done", end5)
            for table, keep in RETENTION.items():
                self._db.execute(f"DELETE FROM {table} WHERE ts < ?", (now - keep,))  # noqa: S608 - vaste tabelnamen
            self._db.execute("COMMIT")

    def metrics(self) -> list[str]:
        with self._lock:
            rows = self._db.execute(
                "SELECT DISTINCT metric FROM agg1 UNION SELECT DISTINCT metric FROM raw WHERE ts > ?",
                (int(time.time()) - 3600,),
            ).fetchall()
        return sorted(r[0] for r in rows)

    def query(self, metric: str, range_key: str, now: int | None = None) -> dict:
        if range_key not in RANGES:
            raise ValueError("onbekend bereik")
        seconds, table, bucket = RANGES[range_key]
        now = int(time.time()) if now is None else now
        since = now - seconds
        with self._lock:
            if table == "raw":
                rows = self._db.execute(
                    """SELECT (ts/?)*?, AVG(value), MIN(value), MAX(value) FROM raw
                       WHERE metric=? AND ts >= ? GROUP BY ts/? ORDER BY 1""",
                    (bucket, bucket, metric, since, bucket),
                ).fetchall()
                last = self._db.execute(
                    "SELECT value FROM raw WHERE metric=? ORDER BY ts DESC LIMIT 1", (metric,)
                ).fetchone()
            else:
                rows = self._db.execute(
                    f"""SELECT (ts/?)*?, AVG(avg), MIN(min), MAX(max) FROM {table}
                        WHERE metric=? AND ts >= ? GROUP BY ts/? ORDER BY 1""",  # noqa: S608
                    (bucket, bucket, metric, since, bucket),
                ).fetchall()
                last = self._db.execute(
                    "SELECT value FROM raw WHERE metric=? ORDER BY ts DESC LIMIT 1", (metric,)
                ).fetchone()
        points = [[int(r[0]), _r(r[1]), _r(r[2]), _r(r[3])] for r in rows]
        return {
            "metric": metric,
            "range": range_key,
            "bucket_seconds": bucket,
            "points": points,
            "summary": summarize(points, last[0] if last else None),
        }

    def export_csv(self, metric: str, range_key: str) -> str:
        data = self.query(metric, range_key)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["timestamp_utc", "gemiddelde", "minimum", "maximum"])
        for ts, avg, mn, mx in data["points"]:
            w.writerow([time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)), avg, mn, mx])
        return buf.getvalue()


def _r(v):
    return None if v is None else round(float(v), 3)


def summarize(points: Iterable[list], current) -> dict:
    pts = list(points)
    if not pts:
        return {"min": None, "avg": None, "max": None, "current": _r(current)}
    avgs = [p[1] for p in pts if p[1] is not None]
    return {
        "min": _r(min(p[2] for p in pts if p[2] is not None)),
        "avg": _r(sum(avgs) / len(avgs)) if avgs else None,
        "max": _r(max(p[3] for p in pts if p[3] is not None)),
        "current": _r(current),
    }


GROUP_LABELS = {
    "cpu": ("CPU", "CPU"), "memory": ("Geheugen", "Memory"), "thermal": ("Thermisch", "Thermal"),
    "network": ("Netwerk", "Network"), "disks": ("Schijven", "Disks"), "docker": ("Docker", "Docker"),
    "services": ("Diensten", "Services"), "sites": ("Sites", "Sites"), "sensors": ("Sensoren", "Sensors"),
    "other": ("Overig", "Other"),
}

# metric -> (label nl, label en, unit, group)
METRIC_CATALOG: dict[str, tuple[str, str, str, str]] = {
    "cpu": ("CPU totaal", "CPU total", "%", "cpu"),
    "load1": ("Load 1 min", "Load 1 min", "", "cpu"),
    "load5": ("Load 5 min", "Load 5 min", "", "cpu"),
    "load15": ("Load 15 min", "Load 15 min", "", "cpu"),
    "ram": ("RAM", "RAM", "%", "memory"),
    "swap": ("Swap", "Swap", "%", "memory"),
    "temp": ("CPU-temperatuur", "CPU temperature", "°C", "thermal"),
    "fan": ("Ventilator", "Fan", "rpm", "thermal"),
    "throttled": ("Throttling", "Throttling", "", "thermal"),
    "net.rx": ("Netwerk in", "Network in", "B/s", "network"),
    "net.tx": ("Netwerk uit", "Network out", "B/s", "network"),
    "disk.read": ("Schijf lezen", "Disk read", "B/s", "disks"),
    "disk.write": ("Schijf schrijven", "Disk write", "B/s", "disks"),
    "containers.running": ("Containers actief", "Containers running", "", "docker"),
    "services.failed": ("Diensten gefaald", "Services failed", "", "services"),
}


def _meta(metric: str, label: str, unit: str, group: str) -> dict[str, str]:
    nl, en = GROUP_LABELS.get(group, GROUP_LABELS["other"])
    return {"metric": metric, "label": label, "unit": unit, "group": group, "group_label": L(nl, en)}


def describe_metric(metric: str) -> dict[str, str]:
    if metric in METRIC_CATALOG:
        nl, en, unit, group = METRIC_CATALOG[metric]
        return _meta(metric, L(nl, en), unit, group)
    if metric.startswith("cpu.core"):
        n = metric[8:]
        return _meta(metric, L(f"CPU kern {n}", f"CPU core {n}"), "%", "cpu")
    if metric.startswith("disk.usage:"):
        mp = metric[11:]
        return _meta(metric, L(f"Schijfgebruik {mp}", f"Disk usage {mp}"), "%", "disks")
    if metric.startswith("site.") and metric.endswith(".latency"):
        return _meta(metric, f"Latency {metric[5:-8]}", "ms", "sites")
    if metric.startswith("sensor."):
        parts = metric.split(".")
        kind = parts[-1]
        unit = {"temp": "°C", "humidity": "%", "pressure": "hPa"}.get(kind, "")
        label = {"temp": L("temperatuur", "temperature"), "humidity": L("luchtvochtigheid", "humidity"), "pressure": L("luchtdruk", "pressure")}.get(kind, kind)
        return _meta(metric, f"{'.'.join(parts[1:-1])} {label}", unit, "sensors")
    return _meta(metric, metric, "", "other")
