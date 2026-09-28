from hal_agent.history import HistoryStore, describe_metric


def test_write_query_and_aggregate(tmp_path):
    h = HistoryStore(tmp_path / "h.db")
    base = 1_800_000_000 - 1_800_000_000 % 3600
    for i in range(360):  # 1 uur op 10 s
        h.write(base + i * 10, {"cpu": float(i % 60), "temp": 50.0})
    now = base + 3600
    q = h.query("cpu", "1h", now=now)
    assert len(q["points"]) == 360
    assert q["summary"]["min"] == 0 and q["summary"]["max"] == 59
    q6 = h.query("cpu", "6h", now=now)
    assert len(q6["points"]) == 60
    h.maintain(now=now)
    q7 = h.query("temp", "7d", now=now)
    assert q7["points"] and q7["points"][0][1] == 50.0
    q30 = h.query("temp", "30d", now=now)
    assert q30["points"]
    csv = h.export_csv("cpu", "1h")
    assert csv.startswith("timestamp_utc")


def test_retention(tmp_path):
    h = HistoryStore(tmp_path / "h.db")
    h.write(1000, {"cpu": 1.0})
    h.maintain(now=1000 + 26 * 3600)
    assert h.query("cpu", "24h", now=1000 + 26 * 3600)["points"] == []


def test_describe():
    assert describe_metric("cpu.core2")["label"] == "CPU kern 2"
    assert describe_metric("disk.usage:/mnt/data")["unit"] == "%"
    assert describe_metric("site.home.example.com.latency")["unit"] == "ms"
    assert describe_metric("sensor.kast.humidity")["unit"] == "%"
