# SupraMAS

English | [中文](supramas.zh.md)

SupraMAS is the material-science extension seam layered on DSH. It owns durable research-task state, provenance-bound paper evidence, and the deterministic Stage 1 builder/reviewer workflow without changing the core agent loop.

Service definitions: [dsh-supramas](../../packages/supramas/supramas) provides `ctx.supramas`; [dsh-api-supramas](../../packages/supramas/api-supramas) provides the versioned `ctx.supramasController` Typert Remote boundary. [dsh-tool-supramas](../../packages/supramas/tool-supramas) is the model-facing consumer, and [dsh-client-ui-supramas](../../packages/supramas/client-ui-supramas) is the browser-facing consumer.

## Runtime ownership

The runtime stores immutable run snapshots behind compare-and-set revisions and persists a versioned Stage 1 workflow in the DSH storage domain. Restart recovery revalidates serialized state before exposing its next action. The API and UI only project or request transitions; they do not duplicate the state machine.

## Evidence ownership

Each paper artifact belongs to one run and carries a stable local provenance path plus extracted chunks. Strategy records, limitation records, and edges may cite only literal text that resolves to a stored chunk. Review acceptance is the sole path by which a candidate paper enters the strategy tree.

## Stage 1 control flow

The durable next action selects one legal step: build a root, build a child for an open limitation, review a candidate, revise from reviewer findings, finalize, or report a terminal outcome. In the shipped preset, the coordinator supplies only the run id and exact revision. Each submit tool atomically starts one isolated, schema-constrained builder or reviewer, persists its structured result with the child run id, and then advances the workflow. The coordinator cannot construct or repair either payload. Accepted reviews must be clean, and restoration plus finalization revalidate the recorded handoff identities.

Builder delegation reuses imported full-text papers before enabling new discovery. Each child has a configurable wall-clock bound, defaulting to ten minutes. A failed child leaves revision and attempt counters unchanged and latches that run/revision/role for the process, so a coordinator retry receives a stop envelope instead of spawning another child. Restarting the process clears only this transient latch and permits one resume attempt against the same durable revision.

## Compatibility files

`ctx.supramasArtifacts` projects the durable workflow into `runs/<jobId>/input_task.yaml`, paper JSON files, `tree_state.json`, and the three final outputs. It confines every path to one configured workspace root and atomically replaces complete files. Durable state remains authoritative: callers repair a partial or interrupted export by repeating synchronization instead of rolling back a completed run.

## Browser boundary

The V1 Remote view exposes task identity, lifecycle state, limits, aggregate progress, the next action, reviewer-accepted tree projections, text-free paper chunk catalogs, bounded evidence slices, and bounded content for the three canonical final outputs. It intentionally omits host filesystem paths, pending candidates, and internal workflow payloads. The non-technical workspace creates and controls tasks through that boundary, polls active details until terminal state, and queues a bounded coordinator message into the active SupraMAS Session.

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
 * @param metadata - Canonical run-local paper metadata, including durable full-text provenance when acquired.
 * @returns a detached empty artifact.
 */
storePaper(id: SupraMasRunIdBrand, metadata: PaperArtifactMetadata): Promise<PaperArtifact>

/**
 * Validate and persist one paper plus all of its provenance-classified page-aware chunks as one storage mutation.
 * Any invalid metadata or chunk fails before the durable record and process catalog change.
 * @param id - Stable owning run identity.
 * @param request - Complete paper metadata and extracted chunk set.
 * @returns the detached complete stored artifact.
 */
importPaper(id: SupraMasRunIdBrand, request: PaperImportRequest): Promise<PaperArtifact>

/**
 * Add one provenance-bound chunk to a stored paper; omitted evidence kind is stored fail-closed as abstract.
 * @param id - Stable owning run identity.
 * @param paperId - Owning paper identity.
 * @param chunk - Local page-aware evidence text and optional provenance class.
 * @returns a detached stored chunk.
 */
addEvidenceChunk(id: SupraMasRunIdBrand, paperId: string, chunk: EvidenceChunkInput): Promise<EvidenceChunk>

/**
 * Read one detached local paper artifact.
 * @param id - Stable owning run identity.
 * @param paperId - Paper identity.
 * @returns the artifact or `undefined` when absent.
 */
readPaper(id: SupraMasRunIdBrand, paperId: string): PaperArtifact | undefined

/**
 * List detached local paper artifacts available to one run.
 * @param id - Stable owning run identity.
 * @returns papers in their stable import order.
 */
listPapers(id: SupraMasRunIdBrand): PaperArtifact[]

/**
 * Verify one evidence quote against run-local paper chunks.
 * @param id - Stable owning run identity.
 * @param paperId - Expected owning paper.
 * @param evidence - Chunk, page, and exact evidence quote.
 * @returns stable verified provenance including the persisted evidence kind.
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
 * Persist one reviewer decision; accepted child edges must match the declared expectation satisfaction.
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
 * Atomically publish one verified source PDF under the canonical run-local raw directory.
 * The method accepts an owning run id and a filename-safe paper id, never an arbitrary path.
 * @param id - Owning durable run identity.
 * @param paperId - Stable filename-safe paper identity.
 * @param bytes - Complete verified PDF bytes.
 * @returns the canonical path relative to the configured workspace root.
 */
writePaperSource(id: SupraMasRunIdBrand, paperId: string, bytes: Uint8Array): Promise<string>

/**
 * Resolve the existing canonical source path for an internal parser.
 * This absolute path is an execution boundary and must never be returned by model-facing tools.
 * @param id - Owning durable run identity.
 * @param paperId - Stable filename-safe paper identity.
 * @returns the canonical absolute source path for internal parser use.
 */
async resolvePaperSourcePath(id: SupraMasRunIdBrand, paperId: string): Promise<string>

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
 * Read one canonical completed output through a caller-supplied complete byte bound.
 * The fixed output-name vocabulary prevents this method from becoming a filesystem read primitive.
 * @param id - Owning durable run identity.
 * @param name - One closed canonical output basename.
 * @param maxBytes - Maximum complete payload size, capped again by the service.
 * @returns detached exact output bytes.
 */
async readOutput(id: SupraMasRunIdBrand, name: Stage1OutputName, maxBytes: number): Promise<Uint8Array>

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
 * Read the current accepted Stage 1 tree without exposing pending candidates or Host paths.
 * @param runId - Stable public run identity.
 * @returns accepted nodes and edges at the exact durable revision.
 */
@Remote tree(runId: string): Promise<SupraMasStrategyTreeViewV1>

/**
 * List text-free local evidence chunks for one run-local paper.
 * @param runId - Stable public run identity.
 * @param paperId - Stable paper identity selected from the accepted tree.
 * @returns paper metadata and bounded chunk summaries without local paths or chunk text.
 */
@Remote paper(runId: string, paperId: string): Promise<SupraMasPaperEvidenceViewV1>

/**
 * Read one bounded text slice from an identified run-local evidence chunk.
 * @param runId - Stable public run identity.
 * @param paperId - Owning paper identity.
 * @param chunkId - Exact local evidence chunk identity.
 * @param start - Zero-based character offset.
 * @param maxCharacters - Complete response character bound, at most 8,000.
 * @returns one detached evidence slice with explicit range metadata.
 */
@Remote evidence( runId: string, paperId: string, chunkId: string, start: number, maxCharacters: number, ): Promise<SupraMasEvidenceSliceViewV1>

/**
 * Read the browser-safe readiness of the three canonical Stage 1 outputs.
 * @param runId - Stable public run identity.
 * @returns fixed output names and readiness without Host paths.
 */
@Remote async artifacts(runId: string): Promise<SupraMasArtifactsViewV1>

/**
 * Read one bounded canonical Stage 1 output for browser download.
 * @param runId - Stable public run identity.
 * @param name - One closed canonical output basename.
 * @returns complete UTF-8 content and media metadata without a Host path.
 */
@Remote async artifact(runId: string, name: SupraMasOutputNameV1): Promise<SupraMasArtifactContentV1>

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

<a id="ctxsupramasliterature--supramasliterature"></a>

### `ctx.supramasLiterature` — `SupraMasLiterature`

Registry and execution owner for structured scholarly-index providers.

```ts cordis-catalog
/**
 * Register one provider for the calling fiber and return an eager disposer.
 * @param provider - Structured scholarly-index provider with a stable id.
 * @returns a disposer that removes the provider registration.
 */
registerIndexProvider(provider: LiteratureIndexProvider): () => void

/**
 * Register one acquisition provider for the calling fiber.
 * @param provider - Safe complete-byte acquisition provider with a stable id.
 * @returns a disposer that removes the provider registration.
 */
registerAcquisitionProvider(provider: PaperAcquisitionProvider): () => void

/**
 * Register one isolated document parser for the calling fiber.
 * @param provider - Bounded parser provider with a stable id.
 * @returns a disposer that removes the provider registration.
 */
registerParserProvider(provider: DocumentParserProvider): () => void

/**
 * Search one selected structured index with complete service-owned bounds.
 * @param request - Normalized query and requested result bound.
 * @param signal - Optional cancellation signal forwarded to the provider.
 * @returns bounded, deduplicated candidates with opaque ids.
 */
async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureSearchResult>

/**
 * Resolve one service-issued opaque id through its owning provider.
 * @param candidateId - Opaque provider-qualified candidate identity.
 * @param signal - Optional cancellation signal forwarded to the provider.
 * @returns the validated candidate and any internal acquisition metadata.
 */
async resolve(candidateId: string, signal?: AbortSignal): Promise<ResolvedLiteratureCandidate>

/**
 * Resolve and acquire one open-access PDF without accepting caller-supplied metadata or URLs.
 * @param candidateId - Opaque provider-qualified candidate identity.
 * @param signal - Optional cancellation signal forwarded through acquisition.
 * @returns complete verified PDF bytes plus safe candidate metadata and digest.
 */
async acquire(candidateId: string, signal?: AbortSignal): Promise<AcquiredPaper>

/**
 * Parse and revalidate one local source through the explicitly selected isolated parser.
 * @param path - Canonical absolute source path owned by the harness.
 * @param signal - Optional cancellation signal forwarded to the parser.
 * @returns normalized page-aware text within configured limits.
 */
async parseDocument(path: string, signal?: AbortSignal): Promise<DocumentParseResult>
```

Source: [`packages/supramas/supramas-literature/src/index.ts`](../../packages/supramas/supramas-literature/src/index.ts)

<a id="ctxsupramaspaperingest--supramaspaperingest"></a>

### `ctx.supramasPaperIngest` — `SupraMasPaperIngest`

Coordinator for acquire -> persist source -> parse -> chunk -> one durable evidence import.

```ts cordis-catalog
/**
 * Import one resolved literature candidate into an existing run.
 * Durable metadata and all chunks commit in one runtime mutation after parsing succeeds.
 * @param runId - Owning durable SupraMAS run identity.
 * @param candidateId - Opaque provider-qualified literature candidate identity.
 * @param sourceType - Scientific provenance classification stored with the paper.
 * @param signal - Optional cancellation signal forwarded through acquire and parse.
 * @returns a public-safe summary of the completed durable import.
 */
async importCandidate( runId: SupraMasRunIdBrand, candidateId: string, sourceType: SourceType = 'unknown', signal?: AbortSignal, ): Promise<PaperImportSummary>
```

Source: [`packages/supramas/supramas-paper-ingest/src/index.ts`](../../packages/supramas/supramas-paper-ingest/src/index.ts)
<!-- END GENERATED cordis-surface -->
