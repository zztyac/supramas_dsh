/** Compare two SupraMAS Stage 1 run directories and print or write a markdown report. */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import * as yaml from 'js-yaml'

interface JsonRecord {
  readonly [key: string]: unknown
}

interface PaperDocument {
  readonly path: string
  readonly paperId: string
  readonly doi: string
  readonly chunks: readonly JsonRecord[]
  readonly rawArtifacts: readonly string[]
}

interface TreeMetrics {
  readonly counts: { nodes: number; edges: number; strategies: number; limitations: number }
  readonly levels: Record<string, number>
  readonly tuningDimensions: Record<string, number>
  readonly edgeTypes: Record<string, number>
  readonly dois: string[]
  readonly nodes: readonly JsonRecord[]
}

interface ReviewMetrics {
  readonly reviewRecords: number
  readonly decisions: Record<string, number>
  readonly reviewedItems: number
  readonly repeatedReviewEvents: number
  readonly explicitRetryEvents: number
}

interface EvidenceMetrics {
  readonly persistedDocuments: number
  readonly storedChunks: number
  readonly citedChunks: number
  readonly resolvedCitations: number
  readonly rawFiles: number
  readonly abstractOnlyViolations: string[]
  readonly unresolvedCitations: { paperId: string; chunkId: string }[]
}

interface RunAnalysis {
  readonly runDir: string
  readonly inputTask: JsonRecord
  readonly tree: TreeMetrics
  readonly review: ReviewMetrics
  readonly evidence: EvidenceMetrics
  readonly reviewLogPath: string | null
}

const IGNORED_INPUT_KEYS = new Set(['job_id', 'output_dir', 'papers_dir'])
const RAW_TEXT_SUFFIXES = new Set(['.pdf', '.txt', '.html', '.htm', '.xml', '.tei'])
const TREE_CANDIDATES = ['outputs/strategy_tree.json', 'strategy_tree.json']
const REVIEW_LOG_CANDIDATES = ['outputs/node_review_log.jsonl', 'node_review_log.jsonl']

class ComparisonError extends Error {}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Render one unknown scalar as text; objects and nullish values fall back. */
function textOf(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

/** Narrow one unknown array value into its record members. */
function recordList(value: unknown): JsonRecord[] {
  return (Array.isArray(value) ? value : []).filter(isRecord)
}

function loadJson(path: string): JsonRecord {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(data)) throw new ComparisonError(`${path} is not a JSON object`)
  return data
}

function loadInputTask(runDir: string): JsonRecord {
  const path = join(runDir, 'input_task.yaml')
  if (!existsSync(path)) throw new ComparisonError(`missing input_task.yaml under ${runDir}`)
  const data: unknown = yaml.load(readFileSync(path, 'utf8'))
  if (!isRecord(data)) throw new ComparisonError(`${path} is not a YAML mapping`)
  return data
}

function normalizeDoi(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
}

function walkFiles(directory: string): string[] {
  const files: string[] = []
  if (!existsSync(directory)) return files
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}

function paperDocuments(papersDir: string): PaperDocument[] {
  return walkFiles(papersDir)
    .filter(path => extname(path).toLowerCase() === '.json')
    .sort()
    .flatMap((path): PaperDocument[] => {
      let data: unknown
      try {
        data = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        return []
      }
      if (!isRecord(data) || !Array.isArray(data.chunks)) return []
      const raw = isRecord(data.raw_artifacts) ? undefined : data.raw_artifacts
      return [{
        path,
        paperId: typeof data.paper_id === 'string' ? data.paper_id.trim() : '',
        doi: normalizeDoi(data.doi),
        chunks: data.chunks.filter(isRecord),
        rawArtifacts: Array.isArray(raw)
          ? raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
          : [],
      }]
    })
}

function counter(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function treeMetrics(tree: JsonRecord): TreeMetrics {
  const nodes = recordList(tree.nodes)
  const edges = recordList(tree.edges)
  const strategies = nodes.flatMap(node => recordList(node.strategy_records))
  const limitations = nodes.flatMap(node => recordList(node.limitation_records))
  const dois = [...new Set(nodes.map(node => normalizeDoi(node.doi)))].filter(doi => doi !== '')
  return {
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      strategies: strategies.length,
      limitations: limitations.length,
    },
    levels: counter(nodes.map(node => textOf(node.level, 'missing'))),
    tuningDimensions: counter(strategies.map(record => textOf(record.tuning_dimension, 'missing'))),
    edgeTypes: counter(edges.map(edge => textOf(edge.edge_type, 'missing'))),
    dois: [...dois].sort(),
    nodes,
  }
}

function reviewMetrics(entries: readonly JsonRecord[]): ReviewMetrics {
  const groups: Record<string, number> = {}
  let explicitRetries = 0
  for (const entry of entries) {
    const frontierKey = typeof entry.frontier_key === 'string' ? entry.frontier_key.trim() : ''
    const identity = frontierKey.length > 0
      ? frontierKey
      : `${textOf(entry.scope, 'unknown')}:${textOf(entry.paper_id, 'unknown')}`
    groups[identity] = (groups[identity] ?? 0) + 1
    const attempt = entry.attempt_index
    const revision = entry.revision_round
    const retriedByAttempt = typeof attempt === 'number' && attempt > 1
    const retriedByRevision = typeof revision === 'number' && revision > 0
    if (retriedByAttempt || retriedByRevision) explicitRetries += 1
  }
  return {
    reviewRecords: entries.length,
    decisions: counter(entries.map(entry => textOf(entry.decision, 'unknown'))),
    reviewedItems: Object.keys(groups).length,
    repeatedReviewEvents: Object.values(groups).reduce((total, count) => total + Math.max(0, count - 1), 0),
    explicitRetryEvents: explicitRetries,
  }
}

function isAbstractChunk(chunk: JsonRecord): boolean {
  const chunkId = textOf(chunk.chunk_id, '').toLowerCase()
  const section = textOf(chunk.section, '').toLowerCase()
  return chunkId.includes('abstract') || section.includes('abstract')
}

function excludesAbstractOnly(inputTask: JsonRecord): boolean {
  const constraints = isRecord(inputTask.constraints) ? inputTask.constraints : undefined
  const excluded = Array.isArray(constraints?.exclude) ? constraints.exclude : []
  return excluded.some(item =>
    String(item).replace(/[-_]/g, ' ').toLowerCase().includes('abstract only'))
}

function evidenceMetrics(runDir: string, tree: TreeMetrics, inputTask: JsonRecord): EvidenceMetrics {
  const papersDir = join(runDir, 'papers')
  const documents = paperDocuments(papersDir)
  const byPaperId = new Map(documents.filter(doc => doc.paperId !== '').map(doc => [doc.paperId, doc] as const))
  const byDoi = new Map(documents.filter(doc => doc.doi !== '').map(doc => [doc.doi, doc] as const))
  const rawFiles = new Set(
    walkFiles(papersDir).filter(path => RAW_TEXT_SUFFIXES.has(extname(path).toLowerCase()))
      .map(path => resolve(path)))

  const cited = new Set<string>()
  const unresolved: { paperId: string; chunkId: string }[] = []
  const violations: string[] = []

  for (const node of tree.nodes) {
    const paperId = typeof node.paper_id === 'string' ? node.paper_id.trim() : ''
    const document = byPaperId.get(paperId) ?? byDoi.get(normalizeDoi(node.doi))
    const records = [
      ...recordList(node.strategy_records),
      ...recordList(node.limitation_records),
    ]
    let allCitedAbstract = records.length > 0
    for (const record of records) {
      const evidence = isRecord(record.evidence) ? record.evidence : undefined
      const chunkId = typeof evidence?.chunk_id === 'string' ? evidence.chunk_id : ''
      if (chunkId.length === 0) continue
      cited.add(`${paperId}\u0000${chunkId}`)
      const chunk = document?.chunks.find(candidate => textOf(candidate.chunk_id, '') === chunkId)
      if (chunk === undefined) {
        unresolved.push({ paperId, chunkId })
        allCitedAbstract = false
        continue
      }
      if (!isAbstractChunk(chunk)) allCitedAbstract = false
    }
    if (document !== undefined) {
      const allStoredAbstract = document.chunks.length > 0 && document.chunks.every(isAbstractChunk)
      const rawArtifacts = document.rawArtifacts
        .flatMap((artifact) => {
          const candidates = [artifact, join(resolve(document.path, '..'), artifact), join(papersDir, artifact)]
          return candidates.filter(candidate => existsSync(candidate)).map(candidate => resolve(candidate))
        })
      const hasRaw = rawArtifacts.length > 0
        || document.chunks.some(chunk => textOf(chunk.evidence_kind, '') === 'full_text')
      if (excludesAbstractOnly(inputTask) && allCitedAbstract && allStoredAbstract && !hasRaw) {
        violations.push(paperId)
      }
    }
  }

  return {
    persistedDocuments: documents.length,
    storedChunks: documents.reduce((total, doc) => total + doc.chunks.length, 0),
    citedChunks: cited.size,
    resolvedCitations: cited.size - unresolved.length,
    rawFiles: rawFiles.size,
    abstractOnlyViolations: [...new Set(violations)],
    unresolvedCitations: unresolved,
  }
}

function loadReviewLog(runDir: string): { entries: JsonRecord[]; path: string | null } {
  for (const candidate of REVIEW_LOG_CANDIDATES) {
    const path = join(runDir, candidate)
    if (!existsSync(path)) continue
    const entries = readFileSync(path, 'utf8').split('\n')
      .filter(line => line.trim().length > 0)
      .map((line): unknown => JSON.parse(line))
      .filter(isRecord)
    return { entries, path }
  }
  return { entries: [], path: null }
}

function analyzeRun(runDir: string): RunAnalysis {
  const treePath = TREE_CANDIDATES.map(candidate => join(runDir, candidate)).find(path => existsSync(path))
  if (treePath === undefined) {
    throw new ComparisonError(`missing strategy_tree.json under ${runDir}`)
  }
  const inputTask = loadInputTask(runDir)
  const tree = treeMetrics(loadJson(treePath))
  const reviewLog = loadReviewLog(runDir)
  return {
    runDir,
    inputTask,
    tree,
    review: reviewMetrics(reviewLog.entries),
    evidence: evidenceMetrics(runDir, tree, inputTask),
    reviewLogPath: reviewLog.path,
  }
}

function inputDifferences(baseline: unknown, candidate: unknown, prefix = ''): string[] {
  if (baseline === candidate) return []
  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    if (baseline.length !== candidate.length) {
      return [`${prefix || 'input'}: ${JSON.stringify(baseline)} != ${JSON.stringify(candidate)}`]
    }
    return baseline.flatMap((item, index) =>
      inputDifferences(item, candidate[index], prefix === '' ? `[${index}]` : `${prefix}[${index}]`))
  }
  if (!isRecord(baseline) || !isRecord(candidate)) {
    return [`${prefix || 'input'}: ${JSON.stringify(baseline)} != ${JSON.stringify(candidate)}`]
  }
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort()
  return keys.flatMap((key) => {
    if (IGNORED_INPUT_KEYS.has(key)) return []
    const child = prefix === '' ? key : `${prefix}.${key}`
    return inputDifferences(baseline[key], candidate[key], child)
  })
}

interface Warning {
  readonly level: 'ERROR' | 'NOTE'
  readonly code: string
  readonly message: string
}

function compareRuns(baseline: RunAnalysis, candidate: RunAnalysis): {
  verdict: string
  inputsMatch: boolean
  warnings: Warning[]
  differences: string[]
} {
  const differences = inputDifferences(baseline.inputTask, candidate.inputTask)
  const inputsMatch = differences.length === 0
  const warnings: Warning[] = []
  if (!inputsMatch) {
    warnings.push({
      level: 'ERROR',
      code: 'INPUT_MISMATCH',
      message: 'Normalized Stage 1 inputs differ; output differences are not an apples-to-apples comparison.',
    })
  }
  for (const paperId of candidate.evidence.abstractOnlyViolations) {
    warnings.push({
      level: 'ERROR',
      code: 'ABSTRACT_ONLY_POLICY_VIOLATION',
      message: `Candidate cites or stores only abstract evidence for paper ${paperId}.`,
    })
  }
  const verdict = !inputsMatch
    ? 'not_comparable_input_mismatch'
    : candidate.evidence.abstractOnlyViolations.length > 0
      ? 'candidate_fails_policy_checks'
      : 'policy_checks_pass'
  return { verdict, inputsMatch, warnings, differences }
}

function formatCounter(values: Record<string, number>): string {
  return Object.entries(values).map(([key, count]) => `${key}=${count}`).join(', ') || 'none'
}

function renderMarkdown(report: {
  baseline: RunAnalysis
  candidate: RunAnalysis
  verdict: string
  inputsMatch: boolean
  warnings: Warning[]
  differences: string[]
}): string {
  const { baseline, candidate } = report
  const shared = new Set(baseline.tree.dois.filter(doi => candidate.tree.dois.includes(doi)))
  const baselineOnly = baseline.tree.dois.filter(doi => !candidate.tree.dois.includes(doi))
  const candidateOnly = candidate.tree.dois.filter(doi => !baseline.tree.dois.includes(doi))
  const lines = [
    '# SupraMAS Stage 1 run comparison',
    '',
    `- Verdict: \`${report.verdict}\``,
    `- Normalized inputs match: \`${report.inputsMatch}\``,
    '- Note: Matching counts or distributions do not establish scientific semantic equivalence; expert review is still required.',
    '',
    '## Run summary',
    '',
    '| Metric | Baseline | Candidate |',
    '| --- | ---: | ---: |',
    `| nodes | ${baseline.tree.counts.nodes} | ${candidate.tree.counts.nodes} |`,
    `| edges | ${baseline.tree.counts.edges} | ${candidate.tree.counts.edges} |`,
    `| strategies | ${baseline.tree.counts.strategies} | ${candidate.tree.counts.strategies} |`,
    `| limitations | ${baseline.tree.counts.limitations} | ${candidate.tree.counts.limitations} |`,
    '',
    '## Distributions',
    '',
    `- Levels (baseline): ${formatCounter(baseline.tree.levels)}`,
    `- Levels (candidate): ${formatCounter(candidate.tree.levels)}`,
    `- Tuning dimensions (baseline): ${formatCounter(baseline.tree.tuningDimensions)}`,
    `- Tuning dimensions (candidate): ${formatCounter(candidate.tree.tuningDimensions)}`,
    `- Edge types (baseline): ${formatCounter(baseline.tree.edgeTypes)}`,
    `- Edge types (candidate): ${formatCounter(candidate.tree.edgeTypes)}`,
    '',
    '## Evidence and review',
    '',
    '| Metric | Baseline | Candidate |',
    '| --- | ---: | ---: |',
    `| persisted paper documents | ${baseline.evidence.persistedDocuments} | ${candidate.evidence.persistedDocuments} |`,
    `| stored chunks | ${baseline.evidence.storedChunks} | ${candidate.evidence.storedChunks} |`,
    `| cited chunks | ${baseline.evidence.citedChunks} | ${candidate.evidence.citedChunks} |`,
    `| resolved citations | ${baseline.evidence.resolvedCitations} | ${candidate.evidence.resolvedCitations} |`,
    `| raw/full-text files | ${baseline.evidence.rawFiles} | ${candidate.evidence.rawFiles} |`,
    `| abstract-only policy violations | ${baseline.evidence.abstractOnlyViolations.length} | ${candidate.evidence.abstractOnlyViolations.length} |`,
    `| review records | ${baseline.review.reviewRecords} | ${candidate.review.reviewRecords} |`,
    `| repeated review events | ${baseline.review.repeatedReviewEvents} | ${candidate.review.repeatedReviewEvents} |`,
    '',
    '## Paper overlap',
    '',
    `- Shared DOIs: ${[...shared].join(', ') || 'none'}`,
    `- Baseline-only DOIs: ${baselineOnly.join(', ') || 'none'}`,
    `- Candidate-only DOIs: ${candidateOnly.join(', ') || 'none'}`,
    '',
    '## Warnings',
    '',
  ]
  if (report.warnings.length === 0) {
    lines.push('- None from automated policy and provenance checks.')
  } else {
    for (const warning of report.warnings) {
      lines.push(`- **${warning.level} \`${warning.code}\`:** ${warning.message}`)
    }
  }
  if (report.differences.length > 0) {
    lines.push('', '## Normalized input differences', '')
    for (const difference of report.differences) lines.push(`- ${difference}`)
  }
  return lines.join('\n')
}

function main(): number {
  const { values, positionals } = parseArgs({
    options: { 'output-md': { type: 'string' } },
    allowPositionals: true,
  })
  if (positionals.length !== 2) {
    console.error('usage: tsx scripts/compare-stage1-runs.ts <baseline-run> <candidate-run> [--output-md <file>]')
    return 2
  }  const [baselinePositional, candidatePositional] = positionals
  if (baselinePositional === undefined || candidatePositional === undefined) {
    console.error('usage: tsx scripts/compare-stage1-runs.ts <baseline-run> <candidate-run> [--output-md <file>]')
    return 2
  }
  const baselineDir = resolve(baselinePositional)
  const candidateDir = resolve(candidatePositional)
  try {
    const baseline = analyzeRun(baselineDir)
    const candidate = analyzeRun(candidateDir)
    const comparison = compareRuns(baseline, candidate)
    const markdown = renderMarkdown({ baseline, candidate, ...comparison })
    if (typeof values['output-md'] === 'string') {
      mkdirSync(dirname(values['output-md']), { recursive: true })
      writeFileSync(values['output-md'], `${markdown}\n`, 'utf8')
      console.log(`verdict=${comparison.verdict} inputs_match=${comparison.inputsMatch} warnings=${comparison.warnings.length}`)
      console.log(values['output-md'])
    } else {
      console.log(markdown)
    }
    return comparison.verdict === 'policy_checks_pass' ? 0 : 1
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
