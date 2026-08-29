# Agent Note：SupraMAS 持久运行与证据恢复

Status: implemented

[English](2026-08-30-supramas-durable-run-recovery.md) | 中文

## 问题

早期 SupraMAS 能力把生命周期快照和证据目录保存在进程内存中。DSH 重启后既会 丢失当前 revision，也会丢失校验策略树所依赖的溯源信息。如果生命周期与证据 分开写入，还会产生第二类失败：运行阶段已经推进而引用的论文文本块尚未保存， 或文本块已经提交但可见运行 revision 仍然过期。

恢复还需要明确的控制边界。自动重启科学工作流可能重复模型调用或外部操作； 保持 active 状态不变则会把中断任务错误地显示为仍在运行。

## 决策

`@deepseek-ai/dsh-supramas` 复用官方 DSH 存储栈并打开带版本的 `supramas` 存储领域。每次运行对应一条记录，其中包含稳定创建 sequence、完整生命周期快照， 以及全部论文产物与证据文本块。每次变更先构造并校验下一条完整记录，通过 `KvTable.put()` 写入，然后才发布对应的内存目录状态。

初始化会校验所有持久记录并重建隔离的 `EvidenceCatalog`。处于 `running` 或 `validating` 的记录会被原子改写为 `recoverable_failed`，revision 递增，并附带 可重试的 `process-restarted` 失败。操作方或协调器只能携带这个新 revision， 通过正常生命周期迁移恢复执行。

两个模型工具暴露该契约。`supramas_run_list` 按稳定创建顺序发现持久任务， `supramas_run_transition` 执行精确 CAS 状态迁移。任务配置角色可以列出、创建和 读取运行；只有协调器角色拥有迁移权限。

## 考虑过的替代方案

**分别写运行快照与证据文件。** 这种方式接近现有目录布局，但无法保证可见 revision 与其证据溯源一起提交；补偿式回滚还会引入领域并不需要的新状态。

**追加自定义 SupraMAS 事件日志。** 回放有利于审计历史，但当前里程碑需要的是 最新可恢复事实。在出现审计需求前，于 DSH storage 之外新增第二套事件框架会重复 迁移、损坏恢复和压缩机制。

**启动时自动继续 `running` 工作。** 这样操作更少，却可能重复非幂等的模型或 文件系统操作。把运行标记为可恢复失败能显式表达中断，并在重新执行前保留 CAS 边界。

## 结果

- 生命周期与证据变更共享一个持久发布边界。
- 重启后的 active 任务不会永久显示为运行中，也不能从旧 revision 恢复。
- 运行时与后端解耦；base bundle 当前提供 JSON backend，其他 storage backend 可以实现相同领域。
- 记录表示当前状态快照，而不是历史审计日志。
- 规范论文路径仍是溯源标识；PDF 获取和解析仍需要独立导入 provider。

## 验证

测试让两个独立 Cordis context 共用同一个 JSON root 并重启，证明运行状态、论文 元数据和证据文本块能够保留。测试还覆盖 active 运行恢复、revision 冲突、稳定模型 信封、存储发布失败时不产生部分内存状态、角色白名单，以及采用 DSH 存储栈的真实 Loader 组合。
