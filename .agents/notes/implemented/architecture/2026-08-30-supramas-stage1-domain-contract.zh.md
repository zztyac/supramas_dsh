# Agent Note: SupraMAS Stage 1 domain and evidence contract

Status: implemented

[English](2026-08-30-supramas-stage1-domain-contract.md) | 中文

## Problem

Codex 原生 SupraMAS 项目已经导出实用的 Stage 1 `strategy_tree.json`
结构，但 JSON Schema 只能逐字段校验。它无法证明一篇论文只出现一次、限制
只引用本节点记录、边精确复述父限制期望，或证据原文确实存在于已保存的
本地文本块中。

如果只把 JSON Schema 搬到 DSH，就只保留了语法，没有保留文献策略树可信
所需的证据纪律。

## Decision

`@deepseek-ai/dsh-supramas-domain` 保留现有蛇形 wire 字段、封闭的来源与
边类型以及五个调优维度，并在严格解析后执行语义图检查和本地证据解析。

一个 `EvidenceCatalog` 只属于一个任务，并且只接受规范路径
`runs/<jobId>/papers/<paperId>.json`。文本块标识在任务内唯一，页码声明必须
匹配，每条 `evidence_text` 都必须逐字存在于引用文本块。
`StrategyTreeAssembler.build()` 与直接调用 `validateStrategyTree()` 经过
同一个校验边界。

现有 `ctx.supramas` 能力为每次运行管理一个目录。四个窄工具分别登记论文、
加入文本块、读取产物和核验证据原文。它们复用 M1 结果信封，把不匹配暴露
为调用方可修正的领域错误，同时不隐藏编程故障。

## Alternatives considered

**只复制 JSON Schema，停留在结构校验。** 这种方式最接近旧导出命令，但
悬空记录标识、矛盾的边文本和虚构证据仍会通过。迁移只保留文件格式，没有
保留科学契约。

**在 DSH 内把 artifact 字段改成驼峰。** 这样可与 M1 运行类型一致，却会在
每个导入、导出和 UI 边界引入转换层。Stage 1 artifact 已经是外部契约，
因此继续使用蛇形；只有内部运行生命周期使用驼峰。

**在 M2 直接把论文和文本块写入磁盘。** 最终需要持久化文件，但把文件系统
恢复与领域语义同时耦合，会妨碍独立契约测试。M2 管理规范路径和隔离的
进程内状态；M3 在相同运行时方法后接入持久化 provider。

## Consequences

- 现有策略树 artifact 无需字段重命名即可迁移。
- 本地证据或跨记录关系未解析时，策略树不能完成。
- Builder 与 reviewer 工具共享同一证据来源，不再通过提示词传递未经检查的
  引文。
- 在 M3 之前，进程重启仍会丢失证据目录；包和工具文档会明确该限制。
- PDF 解析和科学上的接受、修改、拒绝判断仍不属于领域包。

## Validation

契约测试覆盖当前 wire 结构、缺失和不匹配证据、重复论文和标识、错误记录
与边引用、增量装配、四个工具、错误信封、释放行为和真实 Loader 组合。
