# SupraMAS Migration Architecture: Codex to DSH

English | [中文](supramas-migration-architecture.zh.md)

这份文档回答三个问题：原来的 SupraMAS 是怎么运行的，迁移到 DSH 时改了什么，以及现在在 DSH 中一项任务会按什么顺序执行。

当前迁移范围是 Stage 1：根据论文建立材料策略树。Stage 2 的新方案生成、实验协议、贝叶斯优化和实验反馈还没有放进 DSH。

## 1. 最终要生成什么

输入是一项材料研究任务，例如“梳理 REBCO 涂层导体中人工钉扎中心对高场 Jc 的影响”。输出不是一段普通综述，而是三类信息组成的树：

```text
研究目标
  -> 找论文
  -> 一篇论文建立一个节点
  -> 从论文中提取策略和局限
  -> 审查引用是否真的支持这些说法
  -> 根据局限提出的 expectation 找下一篇论文
  -> 连接父节点和子节点
  -> 导出结果文件
```

树中的字段含义固定：

- `strategy_records[]`：论文使用了什么可控手段，以及产生了什么效果。
- `limitation_records[]`：论文还有什么限制，以及下一步应该解决什么问题。
- `edges[]`：父节点的 expectation 对应哪篇子论文。边类型为 `direct`、`transferable` 或 `exploratory`。
- `evidence`：每条记录引用的本地论文片段。`chunk_id` 必须能在本次运行保存的论文文件中找到。

允许的调节维度只有五类：Composition、Grain boundary、Interface、Texture 和 Stress tuning。

## 2. 原来的 Codex 项目怎么运行

### 2.1 四个角色

原项目把任务分成四个 Codex 角色：

| 角色 | 做什么 |
| --- | --- |
| `task-setup-agent` | 把用户的研究目标写成 `input_task.yaml`。范围不清楚时先问用户。 |
| `strategy-mining-agent` | 读取任务文件，安排其他角色，保存树状态，直到导出完成。 |
| `strategy-builder-agent` | 搜索论文、下载全文、保存 evidence chunks，并生成一个论文节点。 |
| `strategy-tree-reviewer` | 检查论文身份、引用、数值、策略记录、局限记录和父子边。 |

角色定义在原项目的 `.codex/agents/*.toml`。builder 使用文献检索技能，reviewer 使用树验证规则。

### 2.2 启动入口

入口脚本是：

```text
scripts/stage1_strategy_tree_builder.py
```

脚本通过 `openai_codex` Python SDK 启动一个主 Codex 线程。主线程读取任务文件，然后通过 Codex 子代理调用 builder 和 reviewer。

执行顺序如下：

1. 读取 `runs/{job_id}/input_task.yaml`。
2. 创建或读取 `runs/{job_id}/tree_state.json`。
3. builder 找根论文，保存论文元数据、原始文件和 chunks。
4. reviewer 返回 `accept`、`revise` 或 `reject`。
5. 只有被接受的节点和边才写入策略树。
6. 对根节点的 limitation 继续找子论文，重复 builder/reviewer 流程。
7. 每次审查、重试、节点接受和 frontier 状态改变都更新 `tree_state.json`。
8. 所有 frontier 结束后导出：

```text
runs/{job_id}/outputs/strategy_tree.json
runs/{job_id}/outputs/node_review_log.jsonl
runs/{job_id}/outputs/review_report.md
```

最后运行 `scripts/validate_schema.py` 检查 `strategy_tree.json`。

### 2.3 Codex 的文件结构

```text
runs/{job_id}/
├── input_task.yaml       # 任务参数
├── tree_state.json       # 中间状态和 frontier
├── papers/               # 论文、PDF、metadata、evidence chunks
├── work/                 # builder/reviewer 工作文件
├── logs/                 # Codex session 备份
└── outputs/              # 三个最终文件
```

Codex 版本的状态主要由 Python 协调脚本和 agent 约定维护。恢复、并发写入和子代理超时的处理也主要在脚本层完成。

## 3. 迁移到 DSH 时做了什么

迁移没有改 DSH 的核心 agent loop，而是在 DSH 的 Web profile 上挂载一组 SupraMAS provider。挂载入口是：

```text
packages/bundle/supramas/cordis.patch.yml
```

DSH 中的关系可以简单看成：

```text
Web 页面 / SupraMAS preset
          |
          v
模型工具：创建任务、推进 Stage 1、提交 builder/reviewer、导出
          |
          v
SupraMAS runtime：保存 run、revision、论文和策略树状态
          |
      +---+-------------+--------------+
      |                 |              |
      v                 v              v
  domain 校验       文献/PDF       artifacts 导出
```

原来的“脚本负责记状态”，改成了“DSH runtime 负责记状态”。原来的“子代理直接回 JSON”，改成了“DSH 内部 handoff 返回受 schema 约束的结果，再由 runtime 提交”。

## 4. DSH 中各个包的职责

| 包 | 作用 |
| --- | --- |
| `supramas-domain` | 定义 Stage 1 数据结构，检查节点、边和 evidence 引用。 |
| `supramas` | 保存 run、任务阶段、revision、论文和 workflow。 |
| `tool-supramas` | 向模型提供运行控制、Stage 1 控制、handoff、证据核验和导出修复工具。 |
| `supramas-literature` | 文献检索的统一接口。 |
| `supramas-literature-openalex` | OpenAlex 检索实现。 |
| `supramas-paper-http` | 有范围限制的论文下载。 |
| `supramas-pdf-pypdf` | 从 PDF 提取文本。 |
| `supramas-paper-ingest` | 把论文、全文和 chunks 保存到 run。 |
| `supramas-artifacts` | 把已完成状态写成三个兼容文件。 |
| `api-supramas` / `client-ui-supramas` | 浏览器 API 和材料任务页面。 |

### 4.1 Codex 和 DSH 的对应关系

| Codex 中的部分 | DSH 中的对应实现 |
| --- | --- |
| Python coordinator | DSH preset、runtime 和模型工具 |
| Codex builder 子代理 | builder structured handoff |
| Codex reviewer 子代理 | reviewer structured handoff |
| `tree_state.json` | DSH 持久 workflow；完成后可重新生成兼容文件 |
| `runs/{job_id}/papers/` | DSH run 内的 PaperArtifact 和 evidence chunks |
| Python 重试 | revision、handoff key、超时分类和安全重试 |
| 脚本校验 | domain 层校验和导出校验 |

角色名称没有原样复制到 DSH，但 builder、reviewer、coordinator 三个职责仍然存在。

## 5. DSH 中一项任务的完整流程

### 5.1 启动

源码分支需要 Node.js `^22.19.0` 或 `>=24`，并安装 `pypdf`：

```powershell
corepack enable
pnpm install --frozen-lockfile
python -m pip install --upgrade pypdf
pnpm run build
pnpm run build:web
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

打开 `http://127.0.0.1:3080`，新建会话并确认 preset 是 `SupraMAS`。已有的 `Standard` 会话不会自动切换 preset。

### 5.2 创建 run

coordinator 创建一个任务，并使用下面的固定路径：

```text
runs/{job_id}/input_task.yaml
runs/{job_id}/
```

run 的阶段大致是：

```text
created -> task_ready -> running -> validating -> completed
                         |          |
                         +-> recoverable_failed
                         +-> failed / cancelled
```

每次修改都要带当前 `revision`。如果传入的 revision 不是最新值，runtime 拒绝写入，避免两个调用互相覆盖。

### 5.3 Builder

coordinator 调用 builder 工具时只传 `run_id` 和 `revision`。论文节点不能由 coordinator 任意写入。

runtime 会根据当前 frontier 给 builder 分配工具：

- 没有可复用全文时，builder 可以检索文献、导入论文、读取 chunks 和核验证据。
- 已有可复用全文时，优先读取已有论文，减少重复下载。
- builder 一次只返回一个论文节点，或者返回没有合适论文的原因。
- 返回前必须核验每条 evidence 引文。

builder 的默认超时时间是 3,600,000 ms，因为下载和解析全文可能较慢。

### 5.4 Reviewer

builder 返回的是候选节点，不是最终节点。reviewer 会重新读取 chunks，并检查：

- 论文是否真实且与节点对应；
- 是否有全文，而不是只有摘要；
- strategy 和 limitation 是否放在正确的数组；
- 声称的数值是否在引用文本中出现；
- limitation 是否能形成合理的 expectation；
- 子论文是否真的回答了父节点的 expectation；
- `edge_type` 是否正确。

reviewer 返回 `accept`、`revise` 或 `reject`。系统还会做一次固定规则检查：如果引用只是半句话、只有材料名称，或者缺少声明的数值，模型即使返回 accept，也会被改为 revise。

reviewer 的默认超时时间是 600,000 ms。

### 5.5 提交节点并继续展开

只有 reviewer 接受后，节点和边才会正式写入 workflow。revise 会把修改条件传回 builder；reject 或达到尝试上限的 limitation 会被标记为终态。

根节点接受后，每个 limitation 都成为一个 frontier。系统根据它的 expectation 搜索子论文，重复 Builder -> Reviewer，直到：

- 子节点被接受；
- 达到最大深度、宽度或尝试次数；
- 找不到有全文证据的合适论文；
- 任务发生不可恢复错误。

### 5.6 Finalize 和文件导出

所有 frontier 都结束后，runtime 再检查整棵树、所有论文和 evidence 引用。检查通过后生成：

```text
runs/{job_id}/outputs/strategy_tree.json
runs/{job_id}/outputs/node_review_log.jsonl
runs/{job_id}/outputs/review_report.md
```

如果任务状态已经完成但文件丢失，可以运行 `supramas_artifacts_sync`，从持久状态重新生成文件，不需要重新检索论文。

## 6. 证据为什么比原来更严格

原项目主要靠 prompt、reviewer 和脚本约束证据。DSH 把关键检查放进 domain/runtime：

1. 论文必须先导入，才能产生本地 chunks。
2. EvidenceCatalog 用 `paper_id + chunk_id` 找到原文。
3. `supramas_evidence_verify` 检查引文是否真的出现在 chunk 中。
4. PDF 中换行、空格和连字符变化可以被识别，但最终保存的还是原始精确片段。
5. abstract-only、缺全文、chunk 不存在、引用不匹配和边类型错误会分别报错。
6. coordinator 没有权限绕过 reviewer 直接写一个已接受节点。

这样可以避免“JSON Schema 通过，但引用只有一句摘要，或者数字没有原文支持”的结果。

## 7. 出错和恢复

每次 handoff 都按 `角色 + run_id + revision` 标识：

- 第一次失败且状态没有变化时，可以在同一进程按原 revision 重试一次。
- 同一 revision 的第二次失败会要求重启 DSH 后再恢复。
- 同一 revision 正在执行时，重复提交会被拒绝。
- timeout、调用方取消和子代理主动中止会记录为不同原因。
- handoff 失败不会伪造节点，也不会推进 revision。
- `cancelled` 和 `failed` 是终态，不能直接当作 running 继续使用；应新建任务或按支持的恢复流程处理。

## 8. 如何比较 Codex 和 DSH 的结果

两边不一定找到完全相同的论文，因为检索顺序和模型决策可能不同。比较时看这些内容：

- 节点数和层级是否符合任务限制；
- limitation 是否真的生成了子节点或被明确标记为 exhausted；
- 每个节点是否对应真实论文；
- strategy、limitation、edge 是否都有本地全文证据；
- evidence 是否覆盖声称的数字和机理；
- reviewer 历史是否完整；
- 是否出现 timeout、aborted 或 cancelled 后仍错误导出的文件。

`strategy_tree.json` 通过 Schema 只能说明字段格式正确，不能证明科学内容正确。原项目的 `scripts/compare_stage1_runs.py` 可以比较结构、论文来源、review 记录和 evidence provenance，但不会把两个结果判定为科学结论完全相同。

## 9. 当前边界

- 当前迁移完成的是 Stage 1，不是完整的 Stage 2 材料智能体。
- Codex 原生 custom agent 名称没有保留，改成了 DSH 内部 handoff。
- OpenAlex、公开 PDF 和网络限流会影响检索结果。
- 图片型 PDF 目前没有 OCR。
- 浏览器进度使用轮询，不是实时事件流。
- DSH fork 目前按源码交付，还没有迁移到独立 npm scope。

## 10. 关键文件

原 Codex 项目：

- `scripts/stage1_strategy_tree_builder.py`
- `.codex/agents/strategy-mining-agent.toml`
- `.codex/agents/strategy-builder-agent.toml`
- `.codex/agents/strategy-tree-reviewer.toml`
- `schemas/strategy_tree.schema.json`
- `scripts/validate_schema.py`
- `scripts/compare_stage1_runs.py`

DSH 迁移项目：

- `packages/bundle/supramas/cordis.patch.yml`
- `packages/supramas/supramas-domain/src/types.ts`
- `packages/supramas/supramas-domain/src/index.ts`
- `packages/supramas/supramas/src/index.ts`
- `packages/supramas/tool-supramas/src/index.ts`
- `packages/supramas/supramas-artifacts/src/index.ts`
- `packages/bundle/supramas/README.zh.md`

简单说，原项目是“Codex 主协调器加文件型状态”，现在是“DSH 页面和 preset 加持久 runtime、受约束的 builder/reviewer handoff 和证据校验”。研究树的数据结构没有变，任务状态、恢复、证据和导出由 DSH 统一负责。
