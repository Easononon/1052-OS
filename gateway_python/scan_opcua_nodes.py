#!/usr/bin/env python3
"""扫描 OPC UA PLC 节点树"""
import sys
sys.path.insert(0, 'gateway_python')

from drivers.opcua import OpcuaClientWrapper, OpcuaConfig

PLC_URL = "opc.tcp://192.168.10.112:4840"

config = OpcuaConfig(url=PLC_URL)
client = OpcuaClientWrapper(config)

def get_all_variables(node, indent=0, results=None):
    if results is None:
        results = []
    try:
        children = client.client.get_children(node)
        for child in children:
            try:
                browse_name = child.get_browse_name()
                node_class = child.get_node_class()
                display_name = child.get_display_name().Text
                ns = browse_name.NamespaceIndex
                nid = browse_name.Name

                if node_class.name == 'Variable':
                    try:
                        val = child.get_value()
                        dtype = type(val).__name__
                        results.append({
                            'ns': ns, 'id': nid,
                            'display': display_name,
                            'value': val, 'type': dtype
                        })
                        print(f"  ns={ns};i={nid} | {display_name} = {val} ({dtype})")
                    except Exception as e:
                        pass
                else:
                    print(f"[Folder] ns={ns};i={nid} | {display_name}")
                    get_all_variables(child, indent + 1, results)
            except Exception as e:
                pass
    except Exception as e:
        pass
    return results

print(f"=== 连接 {PLC_URL} ===")
objects = client.client.get_objects_node()
vars = get_all_variables(objects)
print(f"\n=== 共发现 {len(vars)} 个变量节点 ===")

# 重点扫描 ns=1（数据主命名空间）
print("\n=== ns=1 变量详情（前50个）===")
ns1_vars = [v for v in vars if v['ns'] == 1][:50]
for v in ns1_vars:
    print(f"  ns=1;i={v['id']} | {v['display']} = {v['value']} ({v['type']})")

client.disconnect()
