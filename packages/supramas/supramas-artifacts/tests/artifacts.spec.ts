import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply,
  Config as storageJsonConfig,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply,
  Config as storageDomainConfig,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import SupraMasRuntime from '../../supramas/src/index.ts'
import type { PaperNodeDraft } from '../../supramas-domain/src/index.ts'
import SupraMasArtifacts, { resolveArtifactsSpec } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

async function setup(): Promise<{ ctx: Context; root: string }> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-supramas-artifacts-storage-'))
  const artifactRoot = await mkdtemp(join(tmpdir(), 'dsh-supramas-artifacts-output-'))
  roots.push(storageRoot, artifactRoot)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({
    name: storageJsonName,
    inject: storageJsonInject,
    apply: storageJsonApply,
    Config: storageJsonConfig,
  }, { root: storageRoot })
  await ctx.plugin({
    name: storageDomainName,
    inject: storageDomainInject,
    apply: storageDomainApply,
    Config: storageDomainConfig,
  }, { backend: 'json' })
  await ctx.plugin(SupraMasRuntime)
  await ctx.plugin(SupraMasArtifacts, { root: artifactRoot })
  return { ctx, root: artifactRoot }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function draft(effect = 'BZO additions improve in-field Jc.'): PaperNodeDraft {
  return {
    paper_id: 'paper-1',
    paper_title: 'BZO pinning paper',
    year: 2024,
    doi: '10.0000/example',
    url: 'https://example.invalid/paper-1',
    source_type: 'experimental',
    strategy_records: [{
      record_id: 'R1',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Add BZO artificial pinning centers.',
      tuning_effect: effect,
      evidence: {
        chunk_id: 'paper-1-c1',
        page: 1,
        evidence_text: 'BZO additions improve in-field Jc',
      },
      confidence: 0.9,
    }],
    limitation_records: [{
      limitation_id: 'L1',
      limitation: 'Only one loading was measured.',
      expectation: 'Compare multiple BZO loadings.',
      related_record_ids: ['R1'],
      evidence: {
        chunk_id: 'paper-1-c1',
        page: 1,
        evidence_text: 'only one loading was measured',
      },
      confidence: 0.9,
    }],
  }
}

async function complete(ctx: Context) {
  const created = await ctx.supramas.create({
    jobId: 'artifact-demo',
    inputTaskPath: 'runs/artifact-demo/input_task.yaml',
    runDir: 'runs/artifact-demo',
  })
  const ready = await ctx.supramas.transition(created, { phase: 'task_ready' })
  const source = new TextEncoder().encode('%PDF-1.7\nfull-text fixture')
  const sourcePath = await ctx.supramasArtifacts.writePaperSource(ready.id, 'paper-1', source)
  await ctx.supramas.storePaper(ready.id, {
    paper_id: 'paper-1',
    paper_title: 'BZO pinning paper',
    local_path: 'runs/artifact-demo/papers/paper-1.json',
    source_type: 'experimental',
    full_text_source: {
      local_path: sourcePath,
      media_type: 'application/pdf',
      sha256: createHash('sha256').update(source).digest('hex'),
      byte_length: source.byteLength,
      page_count: 1,
    },
  })
  await ctx.supramas.addEvidenceChunk(ready.id, 'paper-1', {
    chunk_id: 'paper-1-c1',
    page: 1,
    text: 'BZO additions improve in-field Jc, but only one loading was measured.',
    evidence_kind: 'full_text',
  })
  const started = await ctx.supramas.startStage1(ready, {
    jobId: 'artifact-demo',
    researchTopic: 'BZO pinning in REBCO',
    materialScope: ['REBCO coated conductors'],
    targetProperty: ['in-field Jc'],
    evidencePolicy: 'Use full-text local evidence only.',
    include: ['BZO artificial pinning centers'],
    exclude: ['abstract-only evidence'],
    maxDepth: 0,
    maxRootAttempts: 2,
    maxChildAttemptsPerLimitation: 3,
  })
  const built = await ctx.supramas.submitStage1Builder(started.run, {
    paper_node: draft(),
    edge: null,
    notes: [],
  })
  const revised = await ctx.supramas.submitStage1Review(built.run, {
    decision: 'revise',
    expectation_satisfaction: 'not_applicable',
    summary: 'Narrow one claim before acceptance.',
    critical_issues: [{ target_id: 'R1', issue: 'Use the literal result.', required_action: 'revise' }],
    edge_issues: [],
    acceptance_conditions: ['Use the literal result.'],
  })
  const rebuilt = await ctx.supramas.submitStage1Builder(revised.run, {
    paper_node: draft('BZO additions improve in-field Jc.'),
    edge: null,
    notes: ['Revised against reviewer feedback.'],
  })
  const accepted = await ctx.supramas.submitStage1Review(rebuilt.run, {
    decision: 'accept',
    expectation_satisfaction: 'not_applicable',
    summary: 'The local evidence supports the revised candidate.',
    critical_issues: [],
    edge_issues: [],
    acceptance_conditions: [],
  })
  return ctx.supramas.finalizeStage1(accepted.run)
}

describe('SupraMAS compatibility artifacts', () => {
  it('requires one explicit absolute workspace root', () => {
    expect(() => resolveArtifactsSpec({ root: 'relative' })).toThrow('absolute')
  })

  it('atomically writes exact source PDF bytes only to a canonical run-local path', async () => {
    const { ctx, root } = await setup()
    const run = await ctx.supramas.create({
      jobId: 'source-demo',
      inputTaskPath: 'runs/source-demo/input_task.yaml',
      runDir: 'runs/source-demo',
    })
    const source = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff])
    const path = await ctx.supramasArtifacts.writePaperSource(run.id, 'arxiv_cond-mat_0406087', source)
    expect(path).toBe('runs/source-demo/papers/raw/arxiv_cond-mat_0406087.pdf')
    expect(new Uint8Array(await readFile(join(root, path)))).toEqual(source)
    expect(await ctx.supramasArtifacts.resolvePaperSourcePath(run.id, 'arxiv_cond-mat_0406087')).toBe(join(root, path))
    expect((await readdir(join(root, 'runs/source-demo/papers/raw'))).filter(name => name.endsWith('.tmp'))).toEqual([])

    for (const unsafe of ['../escape', 'nested/paper', 'drive:paper', '.hidden']) {
      await expect(ctx.supramasArtifacts.writePaperSource(run.id, unsafe, source)).rejects.toThrow('filename-safe')
    }
    await expect(ctx.supramasArtifacts.writePaperSource(run.id, 'paper-empty', new Uint8Array(0)))
      .rejects.toThrow('must not be empty')
  })

  it('writes the original Stage 1 task, paper, tree, review log, report, and audit state', async () => {
    const { ctx, root } = await setup()
    const completed = await complete(ctx)
    const first = await ctx.supramasArtifacts.syncCompleted(completed.run.id)
    const before = await Promise.all(first.files.map(path => readFile(join(root, path), 'utf8')))
    const second = await ctx.supramasArtifacts.syncCompleted(completed.run.id)
    const after = await Promise.all(second.files.map(path => readFile(join(root, path), 'utf8')))

    expect(second).toEqual(first)
    expect(after).toEqual(before)
    expect(first.files).toEqual([
      'runs/artifact-demo/input_task.yaml',
      'runs/artifact-demo/papers/paper-1.json',
      'runs/artifact-demo/papers/raw/paper-1.pdf',
      'runs/artifact-demo/tree_state.json',
      'runs/artifact-demo/outputs/strategy_tree.json',
      'runs/artifact-demo/outputs/node_review_log.jsonl',
      'runs/artifact-demo/outputs/review_report.md',
    ])

    const task = await readFile(join(root, first.files[0]!), 'utf8')
    expect(task).toContain('evidence_policy: "Use full-text local evidence only."')
    expect(task).toContain('max_depth: 0')
    expect(task).toContain('max_child_attempts_per_limitation: 3')

    const paper = JSON.parse(await readFile(join(root, first.files[1]!), 'utf8')) as Record<string, unknown>
    expect(paper).toMatchObject({ paper_id: 'paper-1', doi: '10.0000/example' })
    expect(paper['chunks']).toHaveLength(1)

    const tree = JSON.parse(await readFile(join(root, first.files[4]!), 'utf8')) as Record<string, unknown>
    expect(tree).toMatchObject({ job_id: 'artifact-demo', nodes: [{ paper_id: 'paper-1' }] })
    const reviews = (await readFile(join(root, first.files[5]!), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { decision: string })
    expect(reviews.map(review => review.decision)).toEqual(['revise', 'accept'])
    expect(await readFile(join(root, first.files[6]!), 'utf8').then(text => text.includes('Exported nodes: `1`')))
      .toBe(true)
    expect(await readdir(join(root, 'runs/artifact-demo/outputs'))).toEqual([
      'node_review_log.jsonl',
      'review_report.md',
      'strategy_tree.json',
    ])
  })

  it('reads only bounded canonical final outputs without accepting caller paths', async () => {
    const { ctx } = await setup()
    const completed = await complete(ctx)
    await ctx.supramasArtifacts.syncCompleted(completed.run.id)

    const bytes = await ctx.supramasArtifacts.readOutput(completed.run.id, 'strategy_tree.json', 64 * 1024)
    expect(new TextDecoder().decode(bytes)).toContain('"job_id": "artifact-demo"')
    await expect(ctx.supramasArtifacts.readOutput(completed.run.id, '../tree_state.json' as never, 64 * 1024))
      .rejects.toThrow('canonical output name')
    await expect(ctx.supramasArtifacts.readOutput(completed.run.id, 'strategy_tree.json', 8))
      .rejects.toThrow('exceeds')
    await expect(ctx.supramasArtifacts.readOutput(completed.run.id, 'strategy_tree.json', 0))
      .rejects.toThrow('positive safe integer')
  })
})
