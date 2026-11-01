# AIAAS / 1052 只读诊断调试说明

## 新增AIAAS独立入口（2026-11-01）

AIAAS新增 `#/diagnostics`，原 `#/assistant` 保留。两个后端配置相同的私有 `AIAAS_DIAGNOSTIC_BRIDGE_TOKEN`，本后端必须以diagnostic模式启动；未配置Token拒绝专用协议。浏览器不持有该Token。

新协议前缀 `/api/aiaas/diagnostics`：GET capabilities、GET scope/:deploymentId（认证修订核对）、PUT scope、POST stream、POST revoke。不得用通用无鉴权chat作为AIAAS多用户代理。

新入口默认关闭，仅simulation_only；只允许skills_list、skills_read、aiaas_get_state、aiaas_database_sources、aiaas_database_analyze。只读批准的仿真历史源；未知缓存、局部工况覆盖和旧API均不能据此变成已验证仿真。快照返回evidence_limits，不能推断历史完整或无报警。

模型与数据源/连接组态共同形成不泄密HMAC指纹；每轮模型调用、工具边界和活动租约检查，变化后旧会话失效，需工程师重新确认。固定模型，不自动fallback。截断或缺少明确完成原因的模型响应一律中断，不能发done。

复用既有Agent循环但不使用web检查点或私人记忆。历史归AIAAS独立存储，owner/chat/run及scope修订被服务端约束；SQLite共享租约支持跨工作进程取消。停止、断线、180秒超时会终止当前请求；租约200秒过期。此机制不替代OS、数据库和网络权限隔离。

详细操作说明位于AIAAS仓库 `docs/architecture/1052-readonly-entry-operations.md`；本轮结果见 `docs/qa/2026-11-01-1052-entry-implementation.md`。当前仅仿真验收，不代表真实现场数据库或预测准确率已通过。

## 本次实现与边界

- 复用1052既有Agent循环、模型路由、流式对话和Skill加载，不另造聊天引擎。
- 诊断模式 `AIAAS_AGENT_MODE=diagnostic` 通过工具白名单和HTTP修改接口拦截执行限制。
- 传统会话与渐进式会话均加载 `backend/prompts/aiaas-diagnostic-agent.md`。
- 禁止终端、任意SQL、PLC写入、参数/权限/报警变更、外部通知、调度与工作流代执行。
- 即使fullAccess或confirmed为true也不能扩权。未知新工具默认拒绝。
- 只读状态/报警/预测/日志沿用AIAAS API；不让LLM扫描或直连S7，不启动PLC采集。
- 当前状态优先读取AIAAS `/api/state/observation`，检查来源、仿真、原始时间与时区异常；generated_sample不是现场实测，缓存命中也不证明PLC已接通。当前契约只允许simulated=true或null，拒绝把未知缓存标为false。
- 仅新来源接口404时兼容旧 `/api/state` 并标source=unknown；格式错误或503不能静默降级。预测历史输入尚未完成全链路来源认证，不能据此宣称现场预测已验收。
- 启动时不恢复定时任务及微信/飞书通道，服务只监听127.0.0.1。
- 诊断模式对所有HTTP方法禁用外部通道及回调；拒绝外部网页Origin和非loopback Host。
- 不迁移或删除既有wiki/笔记；数据库样例与现场数据严格分开。

**不代表已完成：** AIAAS原内置聊天替换（不在本轮目标内）、现场WinCC数据库接入、生产级身份鉴别、OS沙箱、远端网关写权限隔离、真实数据预测精度验证。新入口已接AIAAS现有登录权限，不把现有演示认证宣称为生产认证。
通用模式不受此诊断白名单约束，不能把通用1052直接作为工业安全边界。

## 权限与技能在哪里维护

| 对象 | 文件 |
| --- | --- |
| 能做/不能做、回答规则 | backend/prompts/aiaas-diagnostic-agent.md |
| 真正工具允许名单 | backend/src/modules/agent/agent.diagnostic-policy.ts |
| 数据质量技能 | backend/builtin-skills/aiaas-data-quality/SKILL.md |
| 趋势基线技能 | backend/builtin-skills/aiaas-trend-analysis/SKILL.md |
| 工艺原因分析技能 | backend/builtin-skills/aiaas-process-diagnosis/SKILL.md |
| 批准数据源和测点 | data/aiaas-diagnostics/sources.json |
| 数据源连接定义 | data/sql-datasources/<datasourceId>.json |

Skill在启动时安装到既有data/skills；本地改过的版本遵循1052原有保留/升级机制，不强行覆盖。
MD只指导模型，不提供权限；新增工具必须单独安全评审，不能改成按名称猜测“只读”。

## 启动（不使用Docker）

使用与better-sqlite3编译版本匹配的Node，本次本机验证使用Node24。

```sh
cd /Users/easonliu/1052-OS/backend
AIAAS_AGENT_MODE=diagnostic PORT=10053 DATA_DIR=/Users/easonliu/1052-OS/data npm run dev
```

另一个终端：

```sh
cd /Users/easonliu/1052-OS/frontend
npm run dev -- --host 127.0.0.1 --port 10055 --strictPort --configLoader runner
```

访问 http://127.0.0.1:10055 。先检查 `/api/agent/diagnostics/policy` 中mode为diagnostic。
退出诊断模式需由本机管理员停止服务并修改进程环境，不能用聊天或设置页切换。
诊断模式禁用设置写入；需要更改模型接入时，应离线由管理员配置，确认后重启。

## 数据库组态

第一版只支持批准的SQLite历史副本，不等于直接支持SQL Server/WinCC。
现有通用SQL模块支持某种数据库，也不代表其已获工业诊断授权。
现场优先提供**数据库类型/版本、表结构、只读视图、点名/单位、采样周期、时间字段/时区、仪表维护记录**，不要通过聊天发密码。
工程师配置后，Agent只选择sourceId、metric、时间窗，不能自由选表、路径或SQL。

sources.json结构：

```json
{"version":1,"sources":[{"id":"plant-history","name":"批准历史副本","datasourceId":"plant-copy","table":"readings","timeColumn":"ts_ms","metricColumn":"tag","valueColumn":"value","sampleIntervalSeconds":60,"maxRows":10000,"maxWindowHours":24,"simulated":false,"metrics":[{"id":"nh4n_mg_l","unit":"mg N/L"}]}]}
```

数据是长表：UTC Unix毫秒整数、测点标识、有限数值。建议在测点+时间字段建索引。
阈值可在metrics中配置warningHigh，但仅用于描述性提示，不能冒充现场排放标准。
数据库进程以mode=ro + query_only打开；固定模板参数查询，独立子进程10秒超时并限制行数。
不完整窗口、缺测、重复、无效值、截断都会显式返回；均值是有效样本均值，不是时间加权值。
source可配置samplingToleranceFraction（0至0.5，缺省0.2），用于识别相邻采样间隔偏离名义周期。
irregularSampling与maximumGapSeconds纳入质量门，防止时间桶覆盖率掩盖长间隔。

## 隔离样例与功能验证

仅初次创建，已有配置时拒绝覆盖：

```sh
python3 backend/scripts/seed_aiaas_diagnostic_demo.py --data-dir /Users/easonliu/1052-OS/data --create-simulated-data
```

记录输出时间窗，在1052中问：

> 使用aiaas-data-quality和aiaas-trend-analysis，分析demo-aiaas的nh4n_mg_l；按刚才时间窗对比基线。列出均值、极值、变化和缺失数据，明确是仿真，不能把DO关联当作原因确诊。

无模型调试接口：GET `/api/agent/diagnostics/sources`，POST `/api/agent/diagnostics/analyze`（结构与工具参数相同）。
不提供任意工具执行HTTP接口。越权请求应403；仿真统计不是现场预测性能证明。

```sh
cd backend
npm test -- --configLoader runner agent.diagnostic.test.ts
npm run build
```

## 上现场前

1. 确认真实数据库适配：只读账号、批准视图、字段/时间映射、索引、限流、超时。
2. 确认模型部署：真实工艺数据是否允许发往外部模型；未批准不得外发，可改本地Qwen等兼容端点。
3. 独立账号与网络隔离；数据库只读权限、PLC网络ACL不能依赖MD或服务进程白名单代替。
4. 增加正式认证授权、可归属的审计和日志留存。当前本地调试HTTP不是生产用户权限系统。
5. 在历史留出集与影子运行中验证漏报/误报、预测偏差、异常工况、数据中断恢复；不给准确率空口承诺。
6. 保留PLC本地PID、限幅与故障兜底；只读诊断不创建任何自动控制通路。
