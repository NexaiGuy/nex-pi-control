"""Bevoorrechte acties. Nooit via sudo: de agent vraagt systemd (via D-Bus) om vaste units te starten.
polkit (50-hal-agent.rules) laat enkel die units en verbs toe voor gebruiker halagent.
"""

from __future__ import annotations

import asyncio
import time

from hal_common.i18n import L, tr
from hal_common.web import run

SHELL_UNIT = "hal-shell.service"


def command_unit(cmd_id: str) -> str:
    return f"hal-cmd@{cmd_id}.service"


async def restart_unit(unit: str) -> tuple[bool, str]:
    r = await run(["systemctl", "restart", "--no-ask-password", "--", unit], timeout=90)
    if r.timed_out:
        return False, tr("Herstart duurde langer dan 90 s")
    return r.code == 0, (r.stderr or r.stdout).strip()[:500] or (L("Herstart", "Restarted") if r.code == 0 else L("Mislukt", "Failed"))


async def run_oneshot(unit: str, timeout: int) -> tuple[bool, list[str], str]:
    """Start een oneshot-unit, wacht tot ze klaar is en haalt de uitvoer uit de journal."""
    since = int(time.time()) - 1
    r = await run(["systemctl", "start", "--wait", "--no-ask-password", "--", unit], timeout=timeout + 10)
    show = await run(["systemctl", "show", "--no-pager", "--property=Result,ExecMainStatus", "--", unit], timeout=10)
    props = dict(line.split("=", 1) for line in show.stdout.splitlines() if "=" in line)
    logs = await run(["journalctl", "--no-pager", "-u", unit, "--since", f"@{since}", "-o", "cat", "-n", "500"], timeout=15)
    lines = [ln for ln in logs.stdout.splitlines() if ln.strip()][-500:]
    ok = r.code == 0 and props.get("Result", "success") == "success"
    if r.timed_out:
        return False, lines, tr("Tijdslimiet overschreden")
    reason = "" if ok else (r.stderr.strip() or L(f"Resultaat: {props.get('Result', '?')}, exitcode {props.get('ExecMainStatus', '?')}", f"Result: {props.get('Result', '?')}, exit code {props.get('ExecMainStatus', '?')}"))
    return ok, lines, reason[:500]


async def unit_state(unit: str) -> dict:
    r = await run(["systemctl", "show", "--no-pager", "--property=ActiveState,ActiveEnterTimestampMonotonic", "--", unit], timeout=10)
    props = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    active = props.get("ActiveState") == "active"
    enter = int(props.get("ActiveEnterTimestampMonotonic") or 0)
    since = int((time.monotonic() * 1_000_000 - enter) / 1_000_000) if active and enter else None
    return {"active": active, "state": props.get("ActiveState", "unknown"), "active_seconds": since}


async def start_unit(unit: str) -> tuple[bool, str]:
    r = await run(["systemctl", "start", "--no-ask-password", "--", unit], timeout=30)
    return r.code == 0, (r.stderr or "").strip()[:300]


async def stop_unit(unit: str) -> tuple[bool, str]:
    r = await run(["systemctl", "stop", "--no-ask-password", "--", unit], timeout=30)
    return r.code == 0, (r.stderr or "").strip()[:300]


async def power(action: str, delay: float = 3.0) -> None:
    """Wacht even zodat het antwoord de gsm nog bereikt, en vraagt dan logind om te herstarten of uit te schakelen."""
    await asyncio.sleep(delay)
    verb = "reboot" if action == "reboot" else "poweroff"
    await run(["systemctl", verb, "--no-ask-password"], timeout=30)

