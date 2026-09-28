"""GPIO (libgpiod v2) en sensoren (1-wire, IIO/DHT, BMP280 via I2C).

Enkel pinnen in gpio.yml `allowed_pins` zijn schakelbaar. Pinnen die de kernel of een HAT gebruikt,
worden altijd als beschermd getoond.
"""

from __future__ import annotations

import asyncio
import glob
import threading
import time
from pathlib import Path
from typing import Any

from hal_common.i18n import L, tr

try:  # op de Pi aanwezig; op dev-machines niet
    import gpiod  # type: ignore
    from gpiod.line import Direction, Value  # type: ignore
except Exception:  # pragma: no cover - afhankelijk van hardware
    gpiod = None  # type: ignore

# Fysieke 40-pin header van de Raspberry Pi (identiek voor Pi 3, 4 en 5)
PINOUT: list[dict[str, Any]] = [
    {"pin": 1, "name": "3V3", "kind": "power"}, {"pin": 2, "name": "5V", "kind": "power"},
    {"pin": 3, "name": "GPIO2", "bcm": 2, "kind": "i2c", "alt": "SDA1"}, {"pin": 4, "name": "5V", "kind": "power"},
    {"pin": 5, "name": "GPIO3", "bcm": 3, "kind": "i2c", "alt": "SCL1"}, {"pin": 6, "name": "GND", "kind": "ground"},
    {"pin": 7, "name": "GPIO4", "bcm": 4, "kind": "gpio", "alt": "GPCLK0"}, {"pin": 8, "name": "GPIO14", "bcm": 14, "kind": "uart", "alt": "TXD"},
    {"pin": 9, "name": "GND", "kind": "ground"}, {"pin": 10, "name": "GPIO15", "bcm": 15, "kind": "uart", "alt": "RXD"},
    {"pin": 11, "name": "GPIO17", "bcm": 17, "kind": "gpio"}, {"pin": 12, "name": "GPIO18", "bcm": 18, "kind": "gpio", "alt": "PCM_CLK/PWM0"},
    {"pin": 13, "name": "GPIO27", "bcm": 27, "kind": "gpio"}, {"pin": 14, "name": "GND", "kind": "ground"},
    {"pin": 15, "name": "GPIO22", "bcm": 22, "kind": "gpio"}, {"pin": 16, "name": "GPIO23", "bcm": 23, "kind": "gpio"},
    {"pin": 17, "name": "3V3", "kind": "power"}, {"pin": 18, "name": "GPIO24", "bcm": 24, "kind": "gpio"},
    {"pin": 19, "name": "GPIO10", "bcm": 10, "kind": "spi", "alt": "MOSI"}, {"pin": 20, "name": "GND", "kind": "ground"},
    {"pin": 21, "name": "GPIO9", "bcm": 9, "kind": "spi", "alt": "MISO"}, {"pin": 22, "name": "GPIO25", "bcm": 25, "kind": "gpio"},
    {"pin": 23, "name": "GPIO11", "bcm": 11, "kind": "spi", "alt": "SCLK"}, {"pin": 24, "name": "GPIO8", "bcm": 8, "kind": "spi", "alt": "CE0"},
    {"pin": 25, "name": "GND", "kind": "ground"}, {"pin": 26, "name": "GPIO7", "bcm": 7, "kind": "spi", "alt": "CE1"},
    {"pin": 27, "name": "GPIO0", "bcm": 0, "kind": "eeprom", "alt": "ID_SD"}, {"pin": 28, "name": "GPIO1", "bcm": 1, "kind": "eeprom", "alt": "ID_SC"},
    {"pin": 29, "name": "GPIO5", "bcm": 5, "kind": "gpio"}, {"pin": 30, "name": "GND", "kind": "ground"},
    {"pin": 31, "name": "GPIO6", "bcm": 6, "kind": "gpio"}, {"pin": 32, "name": "GPIO12", "bcm": 12, "kind": "gpio", "alt": "PWM0"},
    {"pin": 33, "name": "GPIO13", "bcm": 13, "kind": "gpio", "alt": "PWM1"}, {"pin": 34, "name": "GND", "kind": "ground"},
    {"pin": 35, "name": "GPIO19", "bcm": 19, "kind": "gpio", "alt": "PCM_FS"}, {"pin": 36, "name": "GPIO16", "bcm": 16, "kind": "gpio"},
    {"pin": 37, "name": "GPIO26", "bcm": 26, "kind": "gpio"}, {"pin": 38, "name": "GPIO20", "bcm": 20, "kind": "gpio", "alt": "PCM_DIN"},
    {"pin": 39, "name": "GND", "kind": "ground"}, {"pin": 40, "name": "GPIO21", "bcm": 21, "kind": "gpio", "alt": "PCM_DOUT"},
]

ALWAYS_PROTECTED = {0, 1}  # HAT EEPROM
CHIP_LABELS = ("pinctrl-rp1", "pinctrl-bcm2711", "pinctrl-bcm2835")


class GpioUnavailable(RuntimeError):
    pass


class GpioManager:
    """Houdt output-requests vast zolang de agent draait (anders valt de pin terug)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._chip_path: str | None = None
        self._outputs: dict[int, Any] = {}
        self._values: dict[int, int] = {}
        self._pulsing: set[int] = set()
        self.error: str | None = None
        if gpiod is None:
            self.error = "libgpiod niet geïnstalleerd"  # vertaald via tr()
            return
        for path in sorted(glob.glob("/dev/gpiochip*")):
            try:
                with gpiod.Chip(path) as chip:
                    if chip.get_info().label in CHIP_LABELS:
                        self._chip_path = path
                        break
            except OSError:
                continue
        if not self._chip_path:
            self.error = "Geen Raspberry Pi GPIO-chip gevonden of geen toegang"

    @property
    def available(self) -> bool:
        return self._chip_path is not None

    def _line_info(self, bcm: int) -> dict[str, Any]:
        with gpiod.Chip(self._chip_path) as chip:
            li = chip.get_line_info(bcm)
            return {
                "used": li.used,
                "consumer": li.consumer or "",
                "direction": "out" if li.direction == Direction.OUTPUT else "in",
            }

    def state(self, allowed: set[int], labels: dict[int, str]) -> dict[str, Any]:
        pins = []
        for p in PINOUT:
            entry = dict(p)
            bcm = p.get("bcm")
            if bcm is not None:
                entry["label"] = labels.get(bcm)
                entry["allowed"] = bcm in allowed and bcm not in ALWAYS_PROTECTED
                if self.available:
                    with self._lock:
                        owned = bcm in self._outputs
                        if owned:
                            entry.update({"mode": "out", "value": self._values.get(bcm, 0), "owner": "hal-agent",
                                          "pulsing": bcm in self._pulsing})
                        else:
                            try:
                                info = self._line_info(bcm)
                            except OSError:
                                info = {"used": True, "consumer": "?", "direction": "in"}
                            entry.update({"mode": info["direction"], "value": None,
                                          "owner": info["consumer"] if info["used"] else None})
                            if info["used"]:
                                entry["allowed"] = False
                                entry["protected_reason"] = L(f"In gebruik door {info['consumer'] or 'kernel'}", f"In use by {info['consumer'] or 'kernel'}")
                if bcm in ALWAYS_PROTECTED:
                    entry["protected_reason"] = "HAT-EEPROM"
            pins.append(entry)
        return {"available": self.available, "error": tr(self.error) if self.error else None, "pins": pins}

    def _ensure_output(self, bcm: int, value: int) -> None:
        req = self._outputs.get(bcm)
        v = Value.ACTIVE if value else Value.INACTIVE
        if req is None:
            req = gpiod.request_lines(
                self._chip_path,
                consumer="hal-agent",
                config={bcm: gpiod.LineSettings(direction=Direction.OUTPUT, output_value=v)},
            )
            self._outputs[bcm] = req
        else:
            req.set_value(bcm, v)
        self._values[bcm] = 1 if value else 0

    def set(self, bcm: int, value: int) -> dict[str, Any]:
        if not self.available:
            raise GpioUnavailable(self.error or "GPIO niet beschikbaar")
        with self._lock:
            self._ensure_output(bcm, value)
        return {"pin": bcm, "value": self._values[bcm]}

    async def pulse(self, bcm: int, duration_ms: int) -> dict[str, Any]:
        if not self.available:
            raise GpioUnavailable(self.error or "GPIO niet beschikbaar")
        with self._lock:
            if bcm in self._pulsing:
                raise GpioUnavailable("Pin pulseert al")
            before = self._values.get(bcm, 0)
            self._ensure_output(bcm, 1 - before)
            self._pulsing.add(bcm)
        try:
            await asyncio.sleep(duration_ms / 1000)
        finally:
            with self._lock:
                self._ensure_output(bcm, before)
                self._pulsing.discard(bcm)
        return {"pin": bcm, "value": before, "pulsed_ms": duration_ms}

    def read(self, bcm: int) -> dict[str, Any]:
        if not self.available:
            raise GpioUnavailable(self.error or "GPIO niet beschikbaar")
        with self._lock:
            if bcm in self._outputs:
                return {"pin": bcm, "value": self._values.get(bcm, 0), "mode": "out"}
            req = gpiod.request_lines(self._chip_path, consumer="hal-agent", config={bcm: gpiod.LineSettings(direction=Direction.INPUT)})
            try:
                v = req.get_value(bcm)
            finally:
                req.release()
        return {"pin": bcm, "value": 1 if v == Value.ACTIVE else 0, "mode": "in"}

    def release(self, bcm: int) -> None:
        with self._lock:
            req = self._outputs.pop(bcm, None)
            self._values.pop(bcm, None)
            if req is not None:
                req.release()

    def close(self) -> None:
        with self._lock:
            for req in self._outputs.values():
                try:
                    req.release()
                except Exception:
                    pass
            self._outputs.clear()


# Sensoren ---------------------------------------------------------------------

def read_ds18b20(device: str) -> dict[str, float]:
    base = Path("/sys/bus/w1/devices") / device
    t = base / "temperature"
    if t.exists():
        return {"temp": round(int(t.read_text().strip()) / 1000, 2)}
    text = (base / "w1_slave").read_text()
    if "YES" not in text.splitlines()[0]:
        raise OSError("CRC-fout bij 1-wire sensor")
    return {"temp": round(int(text.split("t=")[-1]) / 1000, 2)}


def read_iio_dht(device: str) -> dict[str, float]:
    base = Path("/sys/bus/iio/devices") / device
    last: Exception | None = None
    for _ in range(4):  # DHT via kernel-driver geeft af en toe EIO
        try:
            temp = int((base / "in_temp_input").read_text()) / 1000
            hum = int((base / "in_humidityrelative_input").read_text()) / 1000
            return {"temp": round(temp, 1), "humidity": round(hum, 1)}
        except OSError as exc:
            last = exc
            time.sleep(0.6)
    raise OSError(f"DHT leesfout: {last}")


def read_bmp280(bus: int, address: int) -> dict[str, float]:
    from smbus2 import SMBus  # lokaal geïmporteerd: optioneel pakket

    with SMBus(bus) as b:
        chip_id = b.read_byte_data(address, 0xD0)
        if chip_id not in (0x58, 0x60):
            raise OSError(f"Onverwacht chip-id 0x{chip_id:02x}")
        cal = b.read_i2c_block_data(address, 0x88, 24)
        b.write_byte_data(address, 0xF4, 0x27)  # normal mode, oversampling x1
        b.write_byte_data(address, 0xF5, 0xA0)
        time.sleep(0.05)
        d = b.read_i2c_block_data(address, 0xF7, 6)
    return bmp280_compensate(cal, d)


def _u16(lo, hi):
    return lo | (hi << 8)


def _s16(lo, hi):
    v = _u16(lo, hi)
    return v - 65536 if v > 32767 else v


def bmp280_compensate(cal: list[int], d: list[int]) -> dict[str, float]:
    t1 = _u16(cal[0], cal[1]); t2 = _s16(cal[2], cal[3]); t3 = _s16(cal[4], cal[5])
    p1 = _u16(cal[6], cal[7]); p2 = _s16(cal[8], cal[9]); p3 = _s16(cal[10], cal[11])
    p4 = _s16(cal[12], cal[13]); p5 = _s16(cal[14], cal[15]); p6 = _s16(cal[16], cal[17])
    p7 = _s16(cal[18], cal[19]); p8 = _s16(cal[20], cal[21]); p9 = _s16(cal[22], cal[23])
    adc_p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
    adc_t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
    var1 = (adc_t / 16384.0 - t1 / 1024.0) * t2
    var2 = ((adc_t / 131072.0 - t1 / 8192.0) ** 2) * t3
    t_fine = var1 + var2
    temp = t_fine / 5120.0
    var1 = t_fine / 2.0 - 64000.0
    var2 = var1 * var1 * p6 / 32768.0
    var2 = var2 + var1 * p5 * 2.0
    var2 = var2 / 4.0 + p4 * 65536.0
    var1 = (p3 * var1 * var1 / 524288.0 + p2 * var1) / 524288.0
    var1 = (1.0 + var1 / 32768.0) * p1
    if var1 == 0:
        raise OSError("BMP280 kalibratie ongeldig")
    p = 1048576.0 - adc_p
    p = (p - var2 / 4096.0) * 6250.0 / var1
    var1 = p9 * p * p / 2147483648.0
    var2 = p * p8 / 32768.0
    p = p + (var1 + var2 + p7) / 16.0
    return {"temp": round(temp, 2), "pressure": round(p / 100.0, 2)}


def read_sensor(cfg: dict[str, Any]) -> dict[str, float]:
    kind = cfg["type"]
    if kind == "ds18b20":
        dev = str(cfg.get("device", ""))
        if not dev.startswith("28-") or "/" in dev:
            raise ValueError("ongeldig 1-wire apparaat")
        return read_ds18b20(dev)
    if kind == "dht":
        dev = str(cfg.get("iio_device", "iio:device0"))
        if not dev.startswith("iio:device") or "/" in dev:
            raise ValueError("ongeldig IIO-apparaat")
        return read_iio_dht(dev)
    if kind == "bmp280":
        return read_bmp280(int(cfg.get("bus", 1)), int(str(cfg.get("address", "0x76")), 0))
    raise ValueError("onbekend sensortype")


def discover_sensors() -> dict[str, list[str]]:
    return {
        "ds18b20": sorted(Path(p).name for p in glob.glob("/sys/bus/w1/devices/28-*")),
        "iio": sorted(Path(p).name for p in glob.glob("/sys/bus/iio/devices/iio:device*")),
        "i2c_buses": sorted(Path(p).name for p in glob.glob("/dev/i2c-*")),
    }
