import json


def test_save_and_load_collector_tasks_roundtrip(tmp_path, monkeypatch):
    import gateway.server as srv
    from gateway.collector import CollectTask

    p = tmp_path / "collector-tasks.json"
    monkeypatch.setattr(srv, "_COLLECTOR_TASKS_PATH", p)

    class FakeCollector:
        def __init__(self):
            self.tasks = {}

        def add_task(self, task):
            self.tasks[task.id] = task

    collector = FakeCollector()
    monkeypatch.setattr(srv, "_collector", collector)
    collector.add_task(CollectTask(
        id="persisted_temp",
        protocol="modbus",
        mb_host="192.168.10.254",
        mb_port=502,
        mb_address=12,
        table="raw_data_demo",
        site="plant",
        device="cabinet",
    ))

    srv._save_collector_tasks()
    assert p.exists()
    saved = json.loads(p.read_text())
    assert saved[0]["id"] == "persisted_temp"
    assert saved[0]["mb_host"] == "192.168.10.254"

    restored = FakeCollector()
    monkeypatch.setattr(srv, "_collector", restored)
    srv._load_collector_tasks()

    task = restored.tasks["persisted_temp"]
    assert task.protocol == "modbus"
    assert task.mb_address == 12
    assert task.table == "raw_data_demo"
    assert task.site == "plant"
    assert task.device == "cabinet"


def test_collector_start_accepts_query_task_id(monkeypatch):
    import gateway.server as srv

    started = []

    class FakeCollector:
        def start_task(self, task_id):
            started.append(task_id)

    monkeypatch.setattr(srv, "_collector", FakeCollector())

    assert srv.collector_start(body=None, task_id="point_1") == {"ok": True}
    assert started == ["point_1"]


def test_collector_add_restarts_running_task_with_latest_config():
    from gateway.collector import CollectTask, DataCollector

    collector = DataCollector.__new__(DataCollector)
    collector.tasks = {"point_1": CollectTask(id="point_1", protocol="opcua", ua_url="old", ua_node_id="ns=1;i=1")}
    collector._running = {"point_1": True}
    calls = []

    def stop_task(task_id):
        calls.append(("stop", task_id))
        collector._running[task_id] = False

    def start_task(task_id):
        calls.append(("start", task_id, collector.tasks[task_id].ua_url, collector.tasks[task_id].ua_node_id))
        collector._running[task_id] = True

    collector.stop_task = stop_task
    collector.start_task = start_task

    collector.add_task(CollectTask(id="point_1", protocol="opcua", ua_url="new", ua_node_id="ns=1;i=10"))

    assert calls == [("stop", "point_1"), ("start", "point_1", "new", "ns=1;i=10")]
    assert collector.tasks["point_1"].ua_url == "new"
    assert collector.tasks["point_1"].ua_node_id == "ns=1;i=10"


def test_opcua_collect_task_requires_url_and_node_id():
    import pytest
    import gateway.server as srv
    from gateway.collector import CollectTask

    with pytest.raises(srv.HTTPException):
        srv._validate_collect_task(CollectTask(id="bad", protocol="opcua", ua_url="", ua_node_id="ns=1;i=10"))
    with pytest.raises(srv.HTTPException):
        srv._validate_collect_task(CollectTask(id="bad", protocol="opcua", ua_url="opc.tcp://host:4840", ua_node_id=""))
