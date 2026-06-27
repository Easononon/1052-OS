"""
1052-OS Industrial Gateway — Node-RED flows.json builder
Generates a Node-RED-compatible flows.json from collector tasks.
"""
import re
from typing import Iterable


def _safe_id(prefix: str, *parts: str, _seen: set | None = None) -> str:
    """Build a Node-RED-safe node ID from prefix and tag-name parts.

    Replaces non-alphanumeric chars with '_'. Ensures uniqueness via _seen set.
    """
    if _seen is None:
        _seen = set()
    raw = re.sub(r"[^A-Za-z0-9_]", "_", "_".join([prefix, *parts]))
    base = raw
    n = 1
    while raw in _seen:
        n += 1
        raw = f"{base}_{n}"
    _seen.add(raw)
    return raw


def _broker_node(broker: str, port: int) -> dict:
    return {
        "id": "brk_1052os",
        "type": "mqtt-broker",
        "name": "1052-OS Broker",
        "broker": broker,
        "port": str(port),  # Node-RED exports port as STRING
        "clientid": "",
        "usetls": False,
        "protocolVersion": "4",  # MQTT 3.1.1
        "keepalive": "60",
        "cleansession": True,
        "autoConnect": True,
    }


def _tab_node(protocol: str) -> dict:
    labels = {
        "modbus": "Modbus",
        "opcua": "OPC UA",
        "mqtt": "MQTT",
    }
    return {
        "id": f"tab_{protocol}",
        "type": "tab",
        "label": labels.get(protocol, protocol.upper()),
        "disabled": False,
        "info": "",
    }


def _mqtt_in_node(node_id: str, tab_id: str, name: str, topic: str,
                  broker_id: str, x: int, y: int, debug_id: str) -> dict:
    return {
        "id": node_id,
        "type": "mqtt in",
        "z": tab_id,
        "name": name,
        "topic": topic,
        "qos": "0",
        "datatype": "auto",
        "broker": broker_id,
        "nl": False,
        "rap": True,
        "rh": 0,
        "inputs": 0,
        "x": x,
        "y": y,
        "wires": [[debug_id]],
    }


def _debug_node(node_id: str, tab_id: str, x: int, y: int) -> dict:
    return {
        "id": node_id,
        "type": "debug",
        "z": tab_id,
        "name": "",
        "active": True,
        "tosidebar": True,
        "console": False,
        "tostatus": False,
        "complete": "payload",
        "targetType": "msg",
        "x": x,
        "y": y,
        "wires": [],
    }


def build_flows_json(tasks: dict, broker: str = "localhost", port: int = 1883) -> list[dict]:
    """Generate a Node-RED flows.json array from collector tasks.

    Layout: 4 nodes per row, 200px column / 80px row.
    Returns a list of node dicts; safe to serialize with json.dumps().
    """
    flows: list[dict] = []
    protocols = ["modbus", "opcua", "mqtt"]
    for protocol in protocols:
        flows.append(_tab_node(protocol))
    flows.append(_broker_node(broker, port))

    seen_ids: set[str] = {*(f"tab_{protocol}" for protocol in protocols), "brk_1052os"}
    tasks_by_protocol = {protocol: [] for protocol in protocols}
    for tid in sorted(tasks.keys()):
        t = tasks[tid]
        if t.protocol in tasks_by_protocol:
            tasks_by_protocol[t.protocol].append(t)

    def _emit(t, idx, tab_id, y_offset=0):
        device = t.device or t.table
        site = t.site
        topic = t.mq_topic if t.protocol == "mqtt" and t.mq_topic else f"1052os/{site}/{device}/{t.id}/value"
        in_id = _safe_id("in", site, device, t.id, _seen=seen_ids)
        dbg_id = _safe_id("dbg", site, device, t.id, _seen=seen_ids)
        col, row = idx % 4, idx // 4
        x, y = 240 + col * 200, 120 + row * 80 + y_offset
        flows.append(_mqtt_in_node(in_id, tab_id, f"{site}/{device}/{t.id}", topic,
                                   "brk_1052os", x, y, dbg_id))
        flows.append(_debug_node(dbg_id, tab_id, x + 190, y))

    for i, t in enumerate(tasks_by_protocol["modbus"]):
        _emit(t, i, "tab_modbus")
    for i, t in enumerate(tasks_by_protocol["opcua"]):
        _emit(t, i, "tab_opcua", y_offset=400)
    for i, t in enumerate(tasks_by_protocol["mqtt"]):
        _emit(t, i, "tab_mqtt", y_offset=800)

    return flows
