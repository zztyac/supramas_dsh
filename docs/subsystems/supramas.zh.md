# SupraMAS

[English](supramas.md) | 中文

SupraMAS 是叠加在 DSH 上的材料科学扩展接缝。它负责持久研究任务状态、受溯源约束的论文证据，以及确定性的 Stage 1 builder/reviewer 工作流，不修改核心 agent loop。

服务定义：[dsh-supramas](../../packages/supramas/supramas) 提供 `ctx.supramas`；[dsh-api-supramas](../../packages/supramas/api-supramas) 提供版本化的 `ctx.supramasController` Typert Remote 边界。[dsh-tool-supramas](../../packages/supramas/tool-supramas) 是模型侧消费者，[dsh-client-ui-supramas](../../packages/supramas/client-ui-supramas) 是浏览器侧消费者。

## 运行时所有权

运行时通过比较并交换 revision 保存不可变运行快照，并在 DSH storage domain 中持久化带版本的 Stage 1 工作流。重启恢复会先重新校验序列化状态，再公开下一动作。API 和 UI 只负责投影或请求转换，不复制状态机。

## 证据所有权

每篇论文产物只属于一个运行，包含稳定的本地溯源路径和抽取文本块。策略记录、限制记录和边只能引用可解析到已保存文本块的逐字证据。候选论文只有经过 reviewer 接受才能进入策略树。

## Stage 1 控制流

持久下一动作只会选择一个合法步骤：构建根节点、针对开放限制构建子节点、审查候选、依据审查意见修订、完成导出，或报告终态结果。builder 提出有证据支撑的候选，reviewer 接受、修订或拒绝；coordinator 在继续前持久化每次交接。

## 浏览器边界

V1 Remote 视图公开任务标识、生命周期状态、限制、汇总进度和下一动作，并有意隐藏 Host 文件系统路径与内部工作流载荷。非技术型任务面板通过这个边界创建和控制任务，再向活动 SupraMAS 会话加入一条有界协调消息。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsupramas--supramasruntime"></a>

### `ctx.supramas` — `SupraMasRuntime`

Durable material-science run registry over the DSH storage-domain form.

```ts cordis-catalog
/**
 * Create one run in the `created` phase.
 * @param request - Job identity and canonical run-local paths.
 * @returns a detached initial snapshot.
 */
create(request: CreateRunRequest): Promise<RunSnapshot>

/**
 * Register one canonical paper artifact under a run.
 * @param id - Stable owning run identity.
 * @param metadata - Canonical run-local paper metadata.
 * @returns a detached empty artifact.
 */
storePaper(id: SupraMasRunIdBrand, metadata: PaperArtifactMetadata): Promise<PaperArtifact>

/**
 * Add one provenance-bound chunk to a stored paper.
 * @param id - Stable owning run identity.
 * @param paperId - Owning paper identity.
 * @param chunk - Local page-aware evidence text.
 * @returns a detached stored chunk.
 */
addEvidenceChunk(id: SupraMasRunIdBrand, paperId: string, chunk: EvidenceChunk): Promise<EvidenceChunk>

/**
 * Read one detached local paper artifact.
 * @param id - Stable owning run identity.
 * @param paperId - Paper identity.
 * @returns the artifact or `undefined` when absent.
 */
readPaper(id: SupraMasRunIdBrand, paperId: string): PaperArtifact | undefined

/**
 * Verify one evidence quote against run-local paper chunks.
 * @param id - Stable owning run identity.
 * @param paperId - Expected owning paper.
 * @param evidence - Chunk, page, and exact evidence quote.
 * @returns stable verified provenance.
 */
verifyEvidence(id: SupraMasRunIdBrand, paperId: string, evidence: EvidenceRef): EvidenceVerification

/**
 * Read one current run.
 * @param id - Stable run identity.
 * @returns a detached snapshot or `undefined` when absent.
 */
get(id: SupraMasRunIdBrand): RunSnapshot | undefined

/**
 * List every current run without exposing mutable registry state.
 * @returns detached snapshots in creation order.
 */
list(): RunSnapshot[]

/**
 * Start a durable Stage 1 workflow and atomically enter the running phase.
 * @param ref - Expected current run revision.
 * @param config - Validated Stage 1 research scope and limits.
 * @returns the committed workflow and its next action.
 */
startStage1(ref: RunRef, config: Stage1WorkflowConfig): Promise<Stage1RunState>

/**
 * Read a detached workflow plus the exact next builder/reviewer action.
 * @param id - Stable run identity.
 * @returns the current workflow state or `undefined` when absent.
 */
getStage1(id: SupraMasRunIdBrand): Stage1RunState | undefined

/**
 * Persist one builder result under compare-and-set revision control.
 * @param ref - Expected current run revision.
 * @param submission - Builder candidate, edge proposal, or no-result record.
 * @returns the committed workflow and its next action.
 */
submitStage1Builder(ref: RunRef, submission: Stage1BuilderSubmission): Promise<Stage1RunState>

/**
 * Persist one reviewer decision; only acceptance can add the candidate to the tree.
 * @param ref - Expected current run revision.
 * @param submission - Reviewer decision and actionable findings.
 * @returns the committed workflow and its next action.
 */
submitStage1Review(ref: RunRef, submission: Stage1ReviewSubmission): Promise<Stage1RunState>

/**
 * Validate and atomically commit the completed workflow and final strategy tree.
 * @param ref - Expected current run revision.
 * @returns the completed workflow state and final tree.
 */
finalizeStage1(ref: RunRef): Promise<FinalizedStage1RunState>

/**
 * Commit one legal compare-and-set phase transition.
 * @param ref - Expected current revision.
 * @param request - Next phase and required failure details.
 * @returns the detached committed snapshot.
 */
transition(ref: RunRef, request: TransitionRunRequest): Promise<RunSnapshot>
```

Source: [`packages/supramas/supramas/src/index.ts`](../../packages/supramas/supramas/src/index.ts)

<a id="ctxsupramascontroller--supramascontroller"></a>

### `ctx.supramasController` — `SupraMasController`

Host service backing the generated `ctx.remote.supramas` namespace.

```ts cordis-catalog
/**
 * List every task in durable creation order.
 * @returns the versioned public task list.
 */
@Remote // oxlint-disable-next-line typescript/require-await -- Remote handlers preserve an asynchronous transport contract. async list(): Promise<SupraMasRunListV1>

/**
 * Read one complete public task view.
 * @param runId - Stable public run identity.
 * @returns the current versioned task view.
 */
@Remote // oxlint-disable-next-line typescript/require-await -- Remote handlers preserve an asynchronous transport contract. async get(runId: string): Promise<SupraMasRunViewV1>

/**
 * Create a task, approve its normalized task definition, and start Stage 1.
 * @param request - User-facing Stage 1 scope and optional execution limits.
 * @returns the committed task after Stage 1 starts.
 */
@Remote async createStage1(request: SupraMasCreateStage1RequestV1): Promise<SupraMasRunViewV1>

/**
 * Resume one run that was durably marked recoverable after interruption.
 * @param runId - Stable public run identity.
 * @param expectedRevision - Revision observed by the caller.
 * @returns the committed resumed task view.
 */
@Remote async resume(runId: string, expectedRevision: number): Promise<SupraMasRunViewV1>

/**
 * Cancel one non-terminal run under compare-and-set revision control.
 * @param runId - Stable public run identity.
 * @param expectedRevision - Revision observed by the caller.
 * @returns the committed cancelled task view.
 */
@Remote async cancel(runId: string, expectedRevision: number): Promise<SupraMasRunViewV1>
```

Source: [`packages/supramas/api-supramas/src/index.ts`](../../packages/supramas/api-supramas/src/index.ts)
<!-- END GENERATED cordis-surface -->
