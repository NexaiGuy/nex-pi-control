"""Back-ups die als systemd-timer draaien (nex-kluis, debacker-backup, ...): laatste run en resultaat.

Een back-up die naar een andere plek schrijft dan /var/backups is zo toch zichtbaar. Welke timers tellen,
staat in backups.yml onder `timers` (glob-patronen op de naam van de timer of de dienst).
"""

from __future__ import annotations

import fnmatch
import json
import time
from typing import Any

from hal_common.web import run

from .services import parse_show

PROPS = "Id,Description,Result,ExecMainStatus,ActiveState,ExecMainStartTimestamp"


def _matches(name: str, patterns: list[str]) -> bool:
    base = name.rsplit(".", 1)[0]
    return any(fnmatch.fnmatch(name, p) or fnmatch.fnmatch(base, p) for p in patterns)


def parse_timers(text: str, patterns: list[str]) -> list[dict[str, Any]]:
    """`systemctl list-timers --all --output=json` naar de timers die bij de patronen horen."""
    try:
        rows = json.loads(text or "[]")
    except ValueError:
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        timer, svc = str(r.get("unit") or ""), str(r.get("activates") or "")
        if not timer.endswith(".timer") or not (_matches(timer, patterns) or _matches(svc, patterns)):
            continue
        out.append({"timer": timer, "service": svc, "last_us": r.get("last") or 0, "next_us": r.get("next") or 0})
    return out


def _unix(value: str | None) -> int:
    """`--timestamp=unix` geeft '@1791032609'. Leeg of 'n/a' wordt 0."""
    v = (value or "").strip()
    if v.startswith("@"):
        try:
            return int(float(v[1:]))
        except ValueError:
            return 0
    return 0


def build(timers: list[dict[str, Any]], show: dict[str, dict[str, str]], max_age: int, now: float | None = None) -> list[dict[str, Any]]:
    now = time.time() if now is None else now
    out = []
    for t in timers:
        s = show.get(t["service"], {})
        trigger = int(t["last_us"] or 0) // 1_000_000
        nxt = int(t["next_us"] or 0) // 1_000_000
        # Een wekelijkse timer mag ouder zijn dan 36 u: de grens is minstens anderhalve periode.
        period = nxt - trigger if trigger and nxt > trigger else 0
        # De echte laatste run: ook een handmatige start telt, niet enkel de laatste keer dat de timer afging.
        last = max(trigger, _unix(s.get("ExecMainStartTimestamp")))
        allowed = max(max_age, int(period * 1.5))
        result = s.get("Result", "")
        failed = s.get("ActiveState") == "failed" or (result not in ("", "success"))
        name = t["service"].removesuffix(".service") or t["timer"].removesuffix(".timer")
        item: dict[str, Any] = {
            "name": name, "path": f"systemd:{t['timer']}", "kind": "job", "source": "timer",
            "description": s.get("Description", ""), "result": result or None, "max_age_seconds": allowed,
        }
        if not last:
            item.update({"state": "empty", "files": 0})
        else:
            item.update({"state": "failed" if failed else "ok", "latest_at": last, "age_seconds": int(now - last)})
        out.append(item)
    return out


async def timer_backups(patterns: list[str], max_age: int) -> list[dict[str, Any]]:
    if not patterns:
        return []
    r = await run(["systemctl", "list-timers", "--all", "--no-pager", "--output=json"], timeout=15)
    timers = parse_timers(r.stdout, patterns)
    if not timers:
        return []
    services = sorted({t["service"] for t in timers if t["service"]})
    show: dict[str, dict[str, str]] = {}
    if services:
        s = await run(["systemctl", "show", "--no-pager", "--timestamp=unix", f"--property={PROPS}", "--", *services], timeout=15)
        if s.code != 0:  # systemd ouder dan 247 kent --timestamp niet: dan enkel de timer-trigger
            s = await run(["systemctl", "show", "--no-pager", f"--property={PROPS}", "--", *services], timeout=15)
        for b in parse_show(s.stdout):
            show[b.get("Id", "")] = b
    return build(timers, show, max_age)
