"""Live systeemmetingen via psutil en sysfs (geen vcgencmd nodig, werkt in de sandbox)."""

from __future__ import annotations

import glob
import os
import platform
import socket
import time
from pathlib import Path
from typing import Any

import psutil

THERMAL_GLOB = "/sys/class/thermal/thermal_zone*/temp"
THROTTLE_GLOBS = (
    "/sys/devices/platform/soc/soc:firmware/get_throttled",
    "/sys/devices/platform/soc@*/*firmware*/get_throttled",
    "/sys/devices/platform/*firmware*/get_throttled",
    "/sys/devices/platform/*/*firmware*/get_throttled",
)
FAN_GLOB = "/sys/class/hwmon/hwmon*/fan1_input"

THROTTLE_BITS = {
    0: "under_voltage",
    1: "freq_capped",
    2: "throttled",
    3: "soft_temp_limit",
}


def throttle_label(code: str) -> str:
    from hal_common.i18n import L

    return {
        "under_voltage": L("Onderspanning", "Under-voltage"),
        "freq_capped": L("Frequentie begrensd", "Frequency capped"),
        "throttled": L("Gethrottled", "Throttled"),
        "soft_temp_limit": L("Zachte temperatuurgrens", "Soft temperature limit"),
    }.get(code, code)

SKIP_IFACES = ("lo", "docker", "veth", "br-", "virbr", "tailscale", "wg")


def _first(globs) -> str | None:
    for g in globs if isinstance(globs, (list, tuple)) else (globs,):
        hits = sorted(glob.glob(g))
        if hits:
            return hits[0]
    return None


def _read_int(path: str | None) -> int | None:
    if not path:
        return None
    try:
        return int(Path(path).read_text().strip(), 0)
    except (OSError, ValueError):
        return None


def parse_throttled(value: int | None) -> dict[str, Any]:
    if value is None:
        return {"available": False, "now": [], "past": [], "raw": None, "active": False}
    now = [label for bit, label in THROTTLE_BITS.items() if value & (1 << bit)]
    past = [label for bit, label in THROTTLE_BITS.items() if value & (1 << (bit + 16))]
    return {"available": True, "now": now, "past": past, "raw": hex(value), "active": bool(now)}


class SystemSampler:
    """Houdt de laatste meting bij. `sample()` wordt elke 2 s aangeroepen vanuit de achtergrondlus."""

    def __init__(self) -> None:
        self.thermal_path = _first(THERMAL_GLOB)
        self.throttle_path = _first(THROTTLE_GLOBS)
        self.fan_path = _first(FAN_GLOB)
        self._last_net = None
        self._last_disk = None
        self._last_t = None
        self.snapshot: dict[str, Any] = {}
        psutil.cpu_percent(percpu=True)
        self.sample()

    def sample(self) -> dict[str, Any]:
        now = time.monotonic()
        per_core = psutil.cpu_percent(percpu=True)
        total = round(sum(per_core) / len(per_core), 1) if per_core else 0.0
        vm = psutil.virtual_memory()
        sw = psutil.swap_memory()
        net = psutil.net_io_counters(pernic=True)
        rx = sum(v.bytes_recv for k, v in net.items() if not k.startswith(SKIP_IFACES))
        tx = sum(v.bytes_sent for k, v in net.items() if not k.startswith(SKIP_IFACES))
        try:
            dio = psutil.disk_io_counters()
            dr, dw = (dio.read_bytes, dio.write_bytes) if dio else (0, 0)
        except Exception:
            dr, dw = 0, 0
        rates = {"rx": 0.0, "tx": 0.0, "read": 0.0, "write": 0.0}
        if self._last_t is not None:
            dt = max(now - self._last_t, 0.001)
            rates = {
                "rx": max(0.0, (rx - self._last_net[0]) / dt),
                "tx": max(0.0, (tx - self._last_net[1]) / dt),
                "read": max(0.0, (dr - self._last_disk[0]) / dt),
                "write": max(0.0, (dw - self._last_disk[1]) / dt),
            }
        self._last_net, self._last_disk, self._last_t = (rx, tx), (dr, dw), now

        temp_milli = _read_int(self.thermal_path)
        temp = round(temp_milli / 1000, 1) if temp_milli is not None else None
        throttled = parse_throttled(_read_int(self.throttle_path))
        fan = _read_int(self.fan_path)
        load = os.getloadavg()

        self.snapshot = {
            "ts": int(time.time()),
            "cpu": {"percent": total, "per_core": [round(c, 1) for c in per_core], "cores": len(per_core),
                    "freq_mhz": _cpu_freq()},
            "load": [round(x, 2) for x in load],
            "memory": {"total": vm.total, "used": vm.total - vm.available, "available": vm.available,
                       "percent": round(vm.percent, 1)},
            "swap": {"total": sw.total, "used": sw.used, "percent": round(sw.percent, 1)},
            "temperature_c": temp,
            "throttling": throttled,
            "fan_rpm": fan,
            "network": {"rx_bps": round(rates["rx"]), "tx_bps": round(rates["tx"])},
            "disk_io": {"read_bps": round(rates["read"]), "write_bps": round(rates["write"])},
            "uptime_seconds": int(time.time() - psutil.boot_time()),
        }
        return self.snapshot

    def history_values(self) -> dict[str, float]:
        s = self.snapshot
        values: dict[str, float] = {
            "cpu": s["cpu"]["percent"],
            "ram": s["memory"]["percent"],
            "swap": s["swap"]["percent"],
            "load1": s["load"][0],
            "load5": s["load"][1],
            "load15": s["load"][2],
            "net.rx": s["network"]["rx_bps"],
            "net.tx": s["network"]["tx_bps"],
            "disk.read": s["disk_io"]["read_bps"],
            "disk.write": s["disk_io"]["write_bps"],
            "throttled": 1.0 if s["throttling"]["active"] else 0.0,
        }
        for i, c in enumerate(s["cpu"]["per_core"]):
            values[f"cpu.core{i}"] = c
        if s["temperature_c"] is not None:
            values["temp"] = s["temperature_c"]
        if s["fan_rpm"] is not None:
            values["fan"] = s["fan_rpm"]
        return values


def _cpu_freq() -> int | None:
    try:
        f = psutil.cpu_freq()
        return int(f.current) if f else None
    except Exception:
        return None


def device_info() -> dict[str, Any]:
    def read(p: str) -> str:
        try:
            return Path(p).read_text().replace("\x00", "").strip()
        except OSError:
            return ""

    os_name = ""
    for line in read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[1].strip('"')
    addrs = []
    for iface, items in psutil.net_if_addrs().items():
        if iface.startswith(SKIP_IFACES):
            continue
        for a in items:
            if a.family == socket.AF_INET:
                addrs.append({"interface": iface, "address": a.address})
    return {
        "hostname": socket.gethostname(),
        "model": read("/proc/device-tree/model") or platform.machine(),
        "serial": read("/proc/device-tree/serial-number")[-8:],
        "os": os_name,
        "kernel": platform.release(),
        "arch": platform.machine(),
        "python": platform.python_version(),
        "cpu_cores": psutil.cpu_count(),
        "memory_total": psutil.virtual_memory().total,
        "addresses": addrs,
        "boot_time": int(psutil.boot_time()),
    }


PSEUDO_FS = {"tmpfs", "devtmpfs", "squashfs", "overlay", "proc", "sysfs", "efivarfs", "ramfs", "nsfs", "autofs"}


def mounts() -> list[dict[str, Any]]:
    out, seen = [], set()
    for p in psutil.disk_partitions(all=False):
        if p.fstype in PSEUDO_FS or p.mountpoint.startswith(("/var/lib/docker", "/snap", "/run", "/proc", "/sys")):
            continue
        if p.device in seen:
            continue
        seen.add(p.device)
        try:
            u = psutil.disk_usage(p.mountpoint)
        except OSError:
            continue
        out.append({
            "device": p.device,
            "mountpoint": p.mountpoint,
            "fstype": p.fstype,
            "total": u.total,
            "used": u.used,
            "free": u.free,
            "percent": round(u.percent, 1),
        })
    return out
