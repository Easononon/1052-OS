---
name: aiaas-trend-analysis
description: Use when comparing aeration DO, NH4-N, airflow, power or pressure over time, including baseline shifts, extrema and rate of change.
---

# 历史趋势与基线比较

先阅读 aiaas-data-quality。先发现批准的数据源，再调用 aiaas_database_analyze。
输入 sourceId、metric、start、end；需要基线时同时提供 baselineStart、baselineEnd，均含时区。

1. 选同工艺段、同单位、相近运行工况和相同长度的窗口；不同窗口长度必须明示。
2. 报告 count、minimum、maximum、mean、first/last、delta、slopePerMinute 和质量指标。
   slope 是按真实时间回归的描述量，不是预测；短窗口、异常值、采样不均匀时不能过度外推。
3. 基线 change.comparable=false 时只报告样本差异和缺口，不能宣称可靠改善。
   基线为零时百分比无定义；不能编造百分比。对平均变化不等于处理效果因果变化。
4. 多指标分别查询并按时间对齐，考虑在线氨氮仪延迟、池容停留时间及DO/风机响应时间。
   未测定滞后，不把同时变化当作控制因果证据。
5. kW是功率，kWh是电量；缺电表累计值或可靠积分时长就不能回答“今天总用电量”。
6. 阈值仅用批准配置；需现场排放限值、工艺目标和设备额定值，不用演示数字代替。
7. 输出“事实 → 差异 → 质量限制 → 可能解释 → 待核实数据”。若用户要求未来15分钟预测，读取预测API并区分预测与描述统计。

禁止修改数据库、模型版本、PID/控制参数或直接写 PLC。分析报告标注 advisory_only。
