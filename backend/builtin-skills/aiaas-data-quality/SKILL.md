---
name: aiaas-data-quality
description: Use before interpreting aeration database statistics, stale PLC telemetry, missing readings or suspected collection failures.
---

# 曝气数据质量门

1. 使用 aiaas_database_sources 获取批准测点，不猜表名；使用 aiaas_database_analyze 指定含时区时间窗。
2. 报告 sourceId、metric、unit、start/end、simulated。仿真结果绝不能称为现场结果。
3. 检查 count/totalRows、expectedSamples、missingSlots、duplicateTimestamps、invalidValues、coverage、maximumGapSeconds、irregularSampling。
   即使coverage=1，时间桶内聚集采样仍可能产生长间隔；irregularSampling=true必须提示采样不规则，不能称为完整可比。
   complete=false 或 truncated=true：统计只代表返回的有效样本，不代表完整时间窗；先缩短窗口或请工程师调整上限。
4. 空值不补零；重复不当作额外覆盖；采样密度突然变高不能抵消缺测。工具统计为样本均值，不是时间加权均值。
5. 核对 firstTimestampMs/lastTimestampMs 与所问历史窗口。历史窗口旧数据不等于现在断线；实时判断需对照当前时间和批准采集周期。
6. 采集接口可读仅证明接口响应，不能证明测点新鲜、仪表准确或 PLC 通信正常。
   读取AIAAS状态时先检查provenance.source/simulated/cache_status/data_timestamp/age_seconds：样例或场景叠加必须声明仿真；缓存数据的physical_source_verified=false不能包装为已确认PLC实测。scenario刷新显示时间不改变原始采集时间。
7. 有质量问题时先列影响、仍可计算的内容、不可下的结论以及补采/标定/通信核查需求，不直接归因工艺。

示例：查到100条但totalRows=10000且truncated=true，应说“前100条样本均值”，不能说“全天平均”。
禁止为了补数据调用终端、sql_query、改采集配置或报警确认。只读诊断，不执行控制。
