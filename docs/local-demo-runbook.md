# 1052 OS 本地 Demo 运行手册

这份手册用于现场电脑快速启动 1052 OS demo。目标是先把产品跑起来，再逐步接入真实 PLC、MQTT、Node-RED、TDengine 等工业数据源。

## 1. 一键启动

在项目根目录执行：

```bash
./scripts/start-demo.sh
```

默认启动以下服务：

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| 1052 前端 | http://127.0.0.1:10055/today | 客户看到的主界面 |
| 1052 后端 | http://127.0.0.1:10053/api/health | Agent、设置、知识库、工作区 API |
| 工业网关 gateway | http://127.0.0.1:18765/api/health | Modbus、MQTT、Node-RED 等工业代理 |
| Node-RED 子服务 | http://127.0.0.1:1885 | 由 gateway 拉起，用于工业网关页面 |

启动脚本可以重复执行。如果端口已经被服务占用，脚本会跳过已在线服务并继续做健康检查。

## 2. 查看系统状态

```bash
./scripts/demo-health.sh
```

健康检查会确认：

- 前端 `10055` 是否监听。
- 后端 `10053` 是否返回 `/api/health`。
- gateway `18765` 是否返回 `/api/health`。
- Node-RED `1885` 是否运行。
- 前端代理链路 `10055 -> 18765` 是否打通。

只要 `frontend-proxy-gateway` 是 `OK`，说明 10055 工业网关页面已经不是单纯静态打开，而是能连到真实 gateway 服务。

## 3. 停止 Demo

```bash
./scripts/stop-demo.sh
```

脚本只停止由 `start-demo.sh` 拉起并记录 PID 的服务，不会主动强杀未知进程。现场如果手动开过别的服务，先用 `demo-health.sh` 看清楚端口占用。

## 4. 常见状态解释

工业网关页面里看到以下状态时，不代表页面坏了：

- `modbus: false`
- `mqtt: false`
- `tdengine: false`
- `Node-RED Bridge: not_initialized`

这些表示对应工业数据源还没有配置或连接。现场接入 PLC/MQTT 后，再通过工业网关配置页或后端配置开启。

当前 demo 默认设置了：

```bash
GATEWAY_DISABLE_AUTOCONNECT=1
```

原因是现场可能还没安装 TDengine 或 MQTT broker。默认不自动连接外部依赖，可以减少误报和启动失败。

## 5. 端口覆盖

如现场端口冲突，可以临时覆盖：

```bash
FRONTEND_PORT=10055 BACKEND_PORT=10053 GATEWAY_PORT=18765 NODERED_PORT=1885 ./scripts/start-demo.sh
```

如果修改 `GATEWAY_PORT`，前端启动时会自动把 `VITE_GATEWAY_TARGET` 指向对应 gateway 地址。

## 6. 推荐现场启动顺序

1. 先运行 `./scripts/start-demo.sh`。
2. 打开 http://127.0.0.1:10055/today。
3. 打开 http://127.0.0.1:10055/industrial-gateway。
4. 运行 `./scripts/demo-health.sh` 保存状态截图或文本。
5. 再配置 PLC/MQTT/Node-RED 等现场数据源。

安全边界：1052 OS 的 Agent 和工业网关默认用于读取、诊断和运维辅助，不应直接绕过现场 PLC 安全逻辑执行控制。
