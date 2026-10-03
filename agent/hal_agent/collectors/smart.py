"""SMART-evaluatie. Leest de JSON die hal-smart-collect (root) wegschrijft en beslist ok/warning/failing.

Een falende schijf moet altijd bovenaan komen. Bij twijfel kiezen we de strengere status.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from hal_common.i18n import L

STALE_SECONDS = 20 * 60

# Firmware met gekende defecten. Samsung 870 EVO SVT01B6Q gaf massaal slechte sectoren.
KNOWN_BAD_FIRMWARE: dict[str, set[str]] = {
    "samsung ssd 870 evo": {"SVT01B6Q"},
}

ATA_REALLOCATED = 5
ATA_REPORTED_UNCORRECT = 187
ATA_PENDING = 197
ATA_OFFLINE_UNCORRECT = 198
ATA_CRC = 199
ATA_TEMPERATURE = (194, 190)
ATA_POWER_ON_HOURS = 9

SSD_LIFE_LEFT = 231  # genormaliseerde waarde = resterende levensduur in procent (Transcend, Kingston, ...)

SEVERITY = {"ok": 0, "unknown": 1, "warning": 2, "failing": 3}

# Een USB-adapter die een commando niet kent, antwoordt met "unsupported scsi opcode" of "unsupported field".
# Dat is een beperking van de adapter, geen signaal van de schijf. "aborted command" is dat wel.
ADAPTER_UNSUPPORTED = re.compile(r"unsupported (scsi opcode|field in scsi command)|not supported", re.I)
DISK_ABORTED = re.compile(r"aborted command|checksum", re.I)


def _messages(data: dict[str, Any]) -> list[str]:
    msgs = (data.get("smartctl") or {}).get("messages") or []
    return [str(m.get("string", "")) for m in msgs if isinstance(m, dict) and m.get("severity") in ("error", "warning")]


def adapter_limitation_only(data: dict[str, Any], transport: str = "") -> bool:
    """True als de afbreking van de USB-adapter komt en niet van de schijf.

    1. smartctl meldt enkel "unsupported scsi opcode/field" of "not supported", nooit "aborted command"; of
    2. (smartctl zet die melding niet altijd in de JSON) USB-schijf, gezondheid PASSED en een volledige attributentabel,
       en geen enkele melding van een afgebroken commando. Een stervende schijf breekt net het lezen van die tabel af.
    """
    msgs = _messages(data)
    if any(DISK_ABORTED.search(m) for m in msgs):
        return False
    errors = [m for m in msgs if re.search(r"fail|abort|error", m, re.I)]
    if errors and all(ADAPTER_UNSUPPORTED.search(m) for m in errors):
        return True
    status = data.get("smart_status")
    table = (data.get("ata_smart_attributes") or {}).get("table") or []
    return transport == "usb" and isinstance(status, dict) and status.get("passed") is True and len(table) >= 3


def _raw(attr: dict[str, Any]) -> int:
    raw = attr.get("raw", {})
    val = raw.get("value")
    if isinstance(val, int):
        # Sommige fabrikanten stoppen extra info in de hoge bytes; de lage 32 bits zijn de telling.
        return val & 0xFFFFFFFF if val > 0xFFFFFFFFFFFF else val
    s = str(raw.get("string", "0")).split()[0]
    try:
        return int(s)
    except ValueError:
        return 0


def has_smart_data(data: dict[str, Any]) -> bool:
    """True als smartctl echte gezondheidsgegevens teruggaf (status, ATA-attributen of NVMe-log)."""
    return (
        isinstance(data.get("smart_status"), dict)
        or bool((data.get("ata_smart_attributes") or {}).get("table"))
        or isinstance(data.get("nvme_smart_health_information_log"), dict)
    )


def _worse(a: str, b: str) -> str:
    return a if SEVERITY[a] >= SEVERITY[b] else b


def evaluate(record: dict[str, Any], previous_crc: int | None = None, now: float | None = None) -> dict[str, Any]:
    """record = {"device", "collected_at", "exit_code", "size_bytes", "smartctl": {...}}"""
    now = time.time() if now is None else now
    device = record.get("device", "?")
    data = record.get("smartctl") or {}
    exit_code = int(record.get("exit_code", 0) or 0)
    status = "ok"
    flagged: list[tuple[int, int, str]] = []
    stale = False

    def flag(level: str, reason: str) -> None:
        nonlocal status
        status = _worse(status, level)
        flagged.append((-SEVERITY[level], len(flagged), reason))

    info = {
        "device": device,
        "model": data.get("model_name") or data.get("model_family") or record.get("model") or "",
        "serial": data.get("serial_number", ""),
        "firmware": data.get("firmware_version", ""),
        "protocol": (data.get("device") or {}).get("protocol", ""),
        "capacity_bytes": (data.get("user_capacity") or {}).get("bytes") or record.get("size_bytes") or None,
        "temperature_c": (data.get("temperature") or {}).get("current"),
        "power_on_hours": (data.get("power_on_time") or {}).get("hours"),
        "smart_supported": True,
        "attributes": {},
        "crc_errors": None,
        "health_source": "smart",
        "transport": record.get("transport") or "",
        "device_type": record.get("device_type") or "",
        "size_bytes": record.get("size_bytes"),
        "removable": bool(record.get("removable")),
        "partitions": record.get("partitions") or [],
        "error_log_available": (record.get("error_log") or {}).get("available", True) if record.get("error_log") is not None else None,
    }
    if not info["serial"]:
        info["serial"] = record.get("serial") or ""

    if record.get("unsupported"):
        info["smart_supported"] = False
        if record.get("transport") == "usb":
            why = L("De USB-adapter van deze schijf geeft geen SMART-gegevens door. Gezondheid onbekend.",
                    "This disk's USB adapter does not pass SMART data through. Health unknown.")
        else:
            why = L("SMART niet ondersteund door dit apparaat", "SMART not supported by this device")
        return {**info, "status": "unknown", "reasons": [why], "problems": [], "stale": False, "collected_at": record.get("collected_at")}

    collected = float(record.get("collected_at") or 0)
    if now - collected > STALE_SECONDS:
        stale = True
        stale_text = L("SMART-gegevens zijn verouderd, de controle draait niet meer", "SMART data is stale, the check is no longer running")
        flag("warning", stale_text)

    # smartctl exit status bits (man smartctl, EXIT STATUS)
    if exit_code & 0b10:
        flag("warning", L("Schijf kon niet geopend worden voor SMART", "Disk could not be opened for SMART"))
    if exit_code & 0b100:
        if has_smart_data(data) and adapter_limitation_only(data, str(record.get("transport") or "")):
            # Bv. Transcend ESD310C: de adapter kent SMART RETURN STATUS niet, smartctl leidt de gezondheid af uit de attributen.
            info["health_source"] = "attributes"
        else:
            flag("warning", L("SMART-commando afgebroken of checksumfout", "SMART command aborted or checksum error"))
    if exit_code & 0b1000:
        flag("failing", L("SMART meldt: schijf faalt", "SMART reports: disk is failing"))
    if exit_code & 0b10000:
        flag("failing", L("Pre-fail attributen onder de drempel", "Pre-fail attributes below threshold"))
    if exit_code & 0b100000:
        flag("warning", L("Attributen waren in het verleden onder de drempel", "Attributes were below threshold in the past"))
    if exit_code & 0b1000000:
        flag("warning", L("Foutlog van de schijf bevat meldingen", "Disk error log contains entries"))
    if exit_code & 0b10000000:
        flag("warning", L("Zelftest van de schijf meldde fouten", "Disk self-test reported errors"))

    health = data.get("smart_status")
    if isinstance(health, dict) and health.get("passed") is False:
        flag("failing", L("Algemene SMART-gezondheid: NIET GESLAAGD", "Overall SMART health: FAILED"))

    # ATA
    table = (data.get("ata_smart_attributes") or {}).get("table") or []
    by_id = {a.get("id"): a for a in table if isinstance(a, dict)}
    attrs = {}
    for aid, key in (
        (ATA_REALLOCATED, "reallocated_sectors"),
        (ATA_PENDING, "pending_sectors"),
        (ATA_OFFLINE_UNCORRECT, "offline_uncorrectable"),
        (ATA_REPORTED_UNCORRECT, "reported_uncorrectable"),
        (ATA_CRC, "crc_errors"),
    ):
        if aid in by_id:
            attrs[key] = _raw(by_id[aid])
    for a in table:
        when = a.get("when_failed")
        if when in ("now", "FAILING_NOW"):
            flag("failing", L(f"Attribuut {a.get('name', a.get('id'))} faalt nu", f"Attribute {a.get('name', a.get('id'))} is failing now"))
    if attrs.get("reallocated_sectors", 0) > 0:
        flag("failing", L(f"{attrs['reallocated_sectors']} verplaatste sectoren (reallocated)", f"{attrs['reallocated_sectors']} reallocated sectors"))
    if attrs.get("pending_sectors", 0) > 0:
        flag("failing", L(f"{attrs['pending_sectors']} onleesbare sectoren in wachtrij (pending)", f"{attrs['pending_sectors']} pending (unreadable) sectors"))
    unc = attrs.get("offline_uncorrectable", 0) + attrs.get("reported_uncorrectable", 0)
    if unc > 0:
        flag("failing", L(f"{unc} onherstelbare leesfouten (uncorrectable)", f"{unc} uncorrectable read errors"))
    crc = attrs.get("crc_errors")
    if crc is not None:
        info["crc_errors"] = crc
        if previous_crc is not None and crc > previous_crc:
            flag("warning", L(f"CRC-fouten stijgen ({previous_crc} naar {crc}), controleer kabel of adapter", f"CRC errors rising ({previous_crc} to {crc}), check cable or adapter"))
    if info["temperature_c"] is None:
        for tid in ATA_TEMPERATURE:
            if tid in by_id:
                info["temperature_c"] = _raw(by_id[tid]) & 0xFF
                break
    if SSD_LIFE_LEFT in by_id:
        life = by_id[SSD_LIFE_LEFT].get("value")
        if isinstance(life, int) and 0 <= life <= 100:
            attrs["life_left"] = life
            if life <= 10:
                flag("warning", L(f"Nog {life}% levensduur over", f"{life}% life left"))
    if info["power_on_hours"] is None and ATA_POWER_ON_HOURS in by_id:
        info["power_on_hours"] = _raw(by_id[ATA_POWER_ON_HOURS])

    # NVMe
    nvme = data.get("nvme_smart_health_information_log")
    if isinstance(nvme, dict):
        cw = int(nvme.get("critical_warning", 0) or 0)
        if cw:
            flag("failing", L(f"NVMe kritieke waarschuwing (code {cw})", f"NVMe critical warning (code {cw})"))
        me = int(nvme.get("media_errors", 0) or 0)
        if me > 0:
            flag("failing", L(f"{me} NVMe mediafouten", f"{me} NVMe media errors"))
        attrs["media_errors"] = me
        used = int(nvme.get("percentage_used", 0) or 0)
        attrs["percentage_used"] = used
        if used >= 90:
            flag("warning", L(f"Slijtage {used}%", f"Wear {used}%"))
        spare = nvme.get("available_spare")
        thr = nvme.get("available_spare_threshold")
        if isinstance(spare, int) and isinstance(thr, int) and spare < thr:
            flag("failing", L(f"Reservecapaciteit {spare}% onder drempel {thr}%", f"Available spare {spare}% below threshold {thr}%"))
        if info["temperature_c"] is None:
            info["temperature_c"] = nvme.get("temperature")
        if info["power_on_hours"] is None:
            info["power_on_hours"] = nvme.get("power_on_hours")

    # Capaciteit (enkel wat de schijf zelf rapporteert, niet de lsblk-terugval)
    reported = (data.get("user_capacity") or {}).get("bytes")
    size = record.get("size_bytes")
    if isinstance(reported, int) and isinstance(size, int) and size > 0 and reported > 0:
        if abs(reported - size) / size > 0.01:
            flag("failing", L("Schijf rapporteert een andere capaciteit dan het systeem ziet", "Disk reports a different capacity than the system sees"))
    elif reported == 0:
        flag("failing", L("Schijf rapporteert capaciteit 0", "Disk reports zero capacity"))

    # Firmware
    model_l = str(info["model"]).lower()
    for bad_model, fws in KNOWN_BAD_FIRMWARE.items():
        if bad_model in model_l and info["firmware"] in fws:
            flag("warning", L(f"Firmware {info['firmware']} heeft gekende defecten, update aanbevolen", f"Firmware {info['firmware']} has known defects, update recommended"))

    # Zonder gezondheidsgegevens is "ok" nooit verdiend: dan weten we het gewoon niet.
    if not has_smart_data(data) and status == "ok":
        status = "unknown"
        info["smart_supported"] = False
        if exit_code & 0b1:
            flagged.append((-SEVERITY["unknown"], len(flagged), L("smartctl herkent het apparaattype niet, gezondheid onbekend",
                                                                   "smartctl does not recognise the device type, health unknown")))
        else:
            flagged.append((-SEVERITY["unknown"], len(flagged), L("Geen SMART-gegevens ontvangen, gezondheid onbekend", "No SMART data received, health unknown")))

    info["attributes"] = attrs
    reasons = [r for _, _, r in sorted(flagged)]  # ernstigste eerst
    problems = [r for r in reasons if not (stale and r == stale_text)] if status in ("warning", "failing") else []
    return {**info, "status": status, "reasons": reasons, "problems": problems, "stale": stale, "collected_at": record.get("collected_at")}


class SmartStore:
    def __init__(self, smart_dir: Path, crc_file: Path) -> None:
        self.smart_dir = smart_dir
        self.crc_file = crc_file

    def _load_crc(self) -> dict[str, int]:
        try:
            return json.loads(self.crc_file.read_text())
        except (OSError, ValueError):
            return {}

    def _save_crc(self, crc: dict[str, int]) -> None:
        try:
            tmp = self.crc_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(crc))
            tmp.replace(self.crc_file)
        except OSError:
            pass

    def read_all(self) -> list[dict[str, Any]]:
        results = []
        prev = self._load_crc()
        # Baseline = hoogste eerder geziene waarde, zodat een stijging blijft opvallen tot iemand ze reset.
        new_prev = dict(prev)
        try:
            files = sorted(self.smart_dir.glob("*.json"))
        except OSError:
            files = []
        for f in files:
            try:
                record = json.loads(f.read_text())
            except (OSError, ValueError):
                results.append({"device": f"/dev/{f.stem}", "status": "unknown", "reasons": [L("SMART-bestand onleesbaar", "SMART file unreadable")]})
                continue
            key = str(record.get("smartctl", {}).get("serial_number") or record.get("device"))
            res = evaluate(record, previous_crc=prev.get(key + ":base"))
            crc = res.get("crc_errors")
            if isinstance(crc, int) and key + ":base" not in new_prev:
                new_prev[key + ":base"] = crc
            results.append(res)
        if new_prev != prev:
            self._save_crc(new_prev)
        return results

    def acknowledge_crc(self) -> None:
        """Zet de CRC-basislijn gelijk aan de huidige waarden (na kabelwissel)."""
        crc = {}
        for r in self.read_all():
            if isinstance(r.get("crc_errors"), int):
                crc[str(r.get("serial") or r.get("device")) + ":base"] = r["crc_errors"]
        self._save_crc(crc)
