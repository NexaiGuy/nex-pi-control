"""Overzicht van alle fysieke schijven: SD-kaart, NVMe, SATA en USB-SSD's, met partities, mountpunten en SMART.

De lijst komt live uit lsblk (geen root nodig), zodat een net ingeplugde USB-schijf meteen verschijnt.
De SMART-beoordeling komt uit SmartStore (geschreven door hal-smart-collect als root). Een schijf zonder
SMART-meting staat er ook in, met status "unknown" en een duidelijke reden.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

from hal_common.i18n import L

SANDBOX_BINDS = {"/tmp", "/var/tmp"}
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}
COLS = "NAME,TYPE,SIZE,TRAN,MODEL,SERIAL,FSTYPE,LABEL,MOUNTPOINTS,RM"


def _parts(dev: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for c in dev.get("children") or []:
        out.append({"device": f"/dev/{c.get('name')}", "size_bytes": int(c.get("size") or 0), "fstype": c.get("fstype") or "",
                    "label": c.get("label") or "", "mountpoints": [m for m in (c.get("mountpoints") or []) if m]})
        out.extend(_parts(c))
    return out


def parse_lsblk(text: str) -> list[dict[str, Any]]:
    try:
        devices = json.loads(text or "{}").get("blockdevices", [])
    except ValueError:
        return []
    out = []
    for d in devices:
        name = d.get("name", "")
        if d.get("type") != "disk" or name.startswith(("zram", "loop", "ram")):
            continue
        out.append({
            "device": f"/dev/{name}", "model": (d.get("model") or "").strip(), "serial": (d.get("serial") or "").strip(),
            "transport": d.get("tran") or ("sd" if name.startswith("mmcblk") else ""), "size_bytes": int(d.get("size") or 0),
            "removable": bool(d.get("rm")), "partitions": _parts(d),
        })
    return out


def inventory() -> list[dict[str, Any]]:
    try:
        r = subprocess.run(["lsblk", "-J", "-b", "-o", COLS], capture_output=True, text=True, env=ENV, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return parse_lsblk(r.stdout)


def merge(smart: list[dict[str, Any]], inv: list[dict[str, Any]], mounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Eén regel per fysieke schijf, slechtste status eerst."""
    by_dev = {s.get("device"): s for s in smart}
    usage = {m["mountpoint"]: m for m in mounts}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for d in inv:
        s = by_dev.get(d["device"])
        seen.add(d["device"])
        if s is None:
            s = {"status": "unknown", "smart_supported": None, "attributes": {}, "reasons": [L("Nog niet gemeten, de SMART-controle loopt elke 5 minuten",
                                                                                             "Not measured yet, the SMART check runs every 5 minutes")]}
        row = {**s, **{k: v for k, v in d.items() if v not in ("", None, [])}}
        row["model"] = s.get("model") or d["model"]
        row["capacity_bytes"] = s.get("capacity_bytes") or d["size_bytes"]
        out.append(row)
    for s in smart:  # lsblk faalde of de schijf is net verdwenen: toch tonen
        if s.get("device") not in seen:
            out.append(dict(s))
    for row in out:
        parts = []
        for p in row.get("partitions") or []:
            mps = list(p.get("mountpoints") or [])
            # De agent draait met PrivateTmp: lsblk ziet dan ook /tmp en /var/tmp als bind van de systeempartitie.
            real = [m for m in mps if m not in SANDBOX_BINDS] or mps
            mp = next((m for m in real if m in usage), None) or (sorted(real, key=len)[0] if real else None)
            u = usage.get(mp) if mp else None
            parts.append({**p, "mountpoints": real, "mountpoint": mp,
                          "used": u["used"] if u else None, "total": u["total"] if u else None, "free": u["free"] if u else None,
                          "percent": u["percent"] if u else None})
        row["partitions"] = parts
    rank = {"failing": 0, "warning": 1, "unknown": 2, "ok": 3}
    out.sort(key=lambda r: (rank.get(r.get("status", "unknown"), 2), r.get("device", "")))
    return out
