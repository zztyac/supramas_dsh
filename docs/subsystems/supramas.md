# SupraMAS

English | [中文](supramas.zh.md)

SupraMAS is the material-science extension seam layered on DSH. It owns durable research-task state, provenance-bound paper evidence, and the deterministic Stage 1 builder/reviewer workflow without changing the core agent loop.

Service definitions: [dsh-supramas](../../packages/supramas/supramas) provides `ctx.supramas`; [dsh-api-supramas](../../packages/supramas/api-supramas) provides the versioned `ctx.supramasController` Typert Remote boundary. [dsh-tool-supramas](../../packages/supramas/tool-supramas) is the model-facing consumer, and [dsh-client-ui-supramas](../../packages/supramas/client-ui-supramas) is the browser-facing consumer.

## Runtime ownership

The runtime stores immutable run snapshots behind compare-and-set revisions and persists a versioned Stage 1 workflow in the DSH storage domain. Restart recovery revalidates serialized state before exposing its next action. The API and UI only project or request transitions; they do not duplicate the state machine.

## Evidence ownership

Each paper artifact belongs to one run and carries a stable local provenance path plus extracted chunks. Strategy records, limitation records, and edges may cite only literal text that resolves to a stored chunk. Review acceptance is the sole path by which a candidate paper enters the strategy tree.

## Stage 1 control flow

The durable next action selects one legal step: build a root, build a child for an open limitation, review a candidate, revise from reviewer findings, finalize, or report a terminal outcome. Builders propose evidence-grounded candidates; reviewers accept, revise, or reject them; the coordinator persists every handoff before continuing.

## Compatibility files

`ctx.supramasArtifacts` projects the durable workflow into `runs/<jobId>/input_task.yaml`, paper JSON files, `tree_state.json`, and the three final outputs. It confines every path to one configured workspace root and atomically replaces complete files. Durable state remains authoritative: callers repair a partial or interrupted export by repeating synchronization instead of rolling back a completed run.

## Browser boundary

The V1 Remote view exposes task identity, lifecycle state, limits, aggregate progress, the next action, and browser-safe readiness for the three final outputs. It intentionally omits host filesystem paths and internal workflow payloads. The non-technical dashboard creates and controls tasks through that boundary, then queues a bounded coordinator message into the active SupraMAS Session.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

<a id="ctxsupramasartifacts--supramasartifacts"></a>

### `ctx.supramasArtifacts` — `SupraMasArtifacts`

Workspace-confined writer for the Codex-native Stage 1 file layout.

```ts cordis-catalog
/**
 * Materialize the current approved task definition.
 * @param id - Owning durable run identity.
 * @returns the canonical relative task path.
 */
syncTask(id: SupraMasRunIdBrand): Promise<string>

/**
 * Materialize one stored paper and its complete current chunk list.
 * @param id - Owning durable run identity.
 * @param paperId - Stored paper identity.
 * @returns the canonical relative paper path.
 */
syncPaper(id: SupraMasRunIdBrand, paperId: string): Promise<string>

/**
 * Read final-output readiness without exposing the configured absolute root.
 * @param id - Owning durable run identity.
 * @returns the three stable final output names in contract order.
 */
async outputStatus(id: SupraMasRunIdBrand): Promise<Stage1OutputStatus[]>

/**
 * Idempotently materialize every compatibility artifact for a completed run.
 * @param id - Owning durable completed run identity.
 * @returns the stable relative artifact manifest.
 */
syncCompleted(id: SupraMasRunIdBrand): Promise<Stage1ArtifactManifest>
```

Source: [`packages/supramas/supramas-artifacts/src/index.ts`](../../packages/supramas/supramas-artifacts/src/index.ts)

<a id="ctxsupramascontroller--supramascontroller"></a>

### `ctx.supramasController` — `SupraMasController`

Host service backing the generated `ctx.remote.supramas` namespace.

```ts cordis-catalog
/**
 * List every task in durable creation order.
* @returns the versioned public task list.
*/
@Remote list(): Promise<SupraMasRunListV1>

/**
 * Read one complete public task view.
 * @param runId - Stable public run identity.
* @returns the current versioned task view.
*/
@Remote get(runId: string): Promise<SupraMasRunViewV1>

/**
 * Read the browser-safe readiness of the three canonical Stage 1 outputs.
 * @param runId - Stable public run identity.
 * @returns fixed output names and readiness without Host paths.
 */
@Remote async artifacts(runId: string): Promise<SupraMasArtifactsViewV1>

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
