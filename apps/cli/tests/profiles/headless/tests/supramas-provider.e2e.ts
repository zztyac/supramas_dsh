import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL(
  '../../../../../../packages/test-support/loader-smoke/tests/fixtures/headless-driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL('../supramas.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))

describe('SupraMAS real provider and agent-loop canary', () => {
  it('boots the real Loader tree and executes a SupraMAS tool over HTTP/SSE', async () => {
    const provider = await startMockLlmServer({
      apiKey: 'supramas-keyless-canary',
      sequence: ['tool_call_success', 'success'],
      toolName: 'supramas_run_create',
      toolArguments: JSON.stringify({
        job_id: 'provider-canary',
        input_task_path: 'runs/provider-canary/input_task.yaml',
        run_dir: 'runs/provider-canary',
      }),
      successText: 'SUPRAMAS_PROVIDER_CANARY_OK',
    })
    try {
      const { stdout } = await runLoaderSmoke({
        label: 'SupraMAS real provider canary',
        tempDirPrefix: 'dsh-supramas-provider-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [configPath, 'Create the provider-canary material task, then report success.'],
        tsconfigPath,
        processTimeoutMs: 60_000,
        env: {
          DEEPSEEK_API_KEY: 'supramas-keyless-canary',
          DSH_SUPRAMAS_BASE_URL: provider.baseURL,
        },
      })

      expect(stdout).toContain('SUPRAMAS_PROVIDER_CANARY_OK')
      expect(provider.requests).toHaveLength(2)
      const first = provider.requests[0]?.body as {
        tools?: { function?: { name?: string } }[]
      }
      expect(first.tools?.map(tool => tool.function?.name)).toEqual(expect.arrayContaining([
        'supramas_run_create',
        'supramas_artifacts_sync',
      ]))
      expect(JSON.stringify(provider.requests[1]?.body)).toContain('Created SupraMAS run provider-canary.')
    } finally {
      await provider.close()
    }
  }, 75_000)

  it('hands one task through isolated builder and reviewer agents', async () => {
    const requests: unknown[] = []
    let callSequence = 0
    const provider = createServer((request, response) => {
      let payload = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { payload += chunk })
      request.on('end', () => {
        const body = JSON.parse(payload) as unknown
        requests.push(body)
        const wire = JSON.stringify(body)
        const text = wire.includes('SupraMAS Stage 1 strategy builder')
          ? '{"role":"builder","status":"candidate_ready"}'
          : wire.includes('SupraMAS Stage 1 evidence reviewer')
            ? '{"role":"reviewer","status":"review_accepted"}'
            : wire.includes('review_accepted')
              ? 'SUPRAMAS_MULTI_AGENT_CANARY_OK'
              : undefined
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        if (text !== undefined) {
          response.end([
            `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({
              choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 3, completion_tokens: 1 },
            })}`,
            'data: [DONE]',
            '',
          ].join('\n\n'))
          return
        }
        const builderFinished = wire.includes('candidate_ready')
        const toolName = builderFinished ? 'supramas_reviewer' : 'supramas_builder'
        const toolArguments = builderFinished
          ? { description: 'Review golden root', prompt: 'Return review_accepted JSON for the golden root.' }
          : { description: 'Build golden root', prompt: 'Return candidate_ready JSON for the golden root.' }
        callSequence += 1
        response.end([
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
            index: 0,
            id: `supramas-agent-${callSequence}`,
            type: 'function',
            function: { name: toolName, arguments: JSON.stringify(toolArguments) },
          }] }, finish_reason: null }] })}`,
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
    })
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (address === null || typeof address === 'string') throw new Error('provider did not bind a TCP port')
    try {
      const { stdout } = await runLoaderSmoke({
        label: 'SupraMAS multi-agent provider canary',
        tempDirPrefix: 'dsh-supramas-multi-agent-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [configPath, 'Delegate the golden root to the SupraMAS builder and then the reviewer.'],
        tsconfigPath,
        processTimeoutMs: 60_000,
        env: {
          DEEPSEEK_API_KEY: 'supramas-keyless-agents',
          DSH_SUPRAMAS_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
      })
      expect(stdout).toContain('SUPRAMAS_MULTI_AGENT_CANARY_OK')
      expect(requests).toHaveLength(5)
      expect(requests.some(request => JSON.stringify(request).includes('SupraMAS Stage 1 strategy builder'))).toBe(true)
      expect(requests.some(request => JSON.stringify(request).includes('SupraMAS Stage 1 evidence reviewer'))).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => provider.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    }
  }, 75_000)
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('SupraMAS live DeepSeek canary', () => {
  it('lets the official model create one durable material task', async () => {
    const { stdout } = await runLoaderSmoke({
      label: 'SupraMAS live DeepSeek canary',
      tempDirPrefix: 'dsh-supramas-live-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [
        configPath,
        'Call supramas_run_create exactly once with job_id live-provider-canary, '
        + 'input_task_path runs/live-provider-canary/input_task.yaml, and run_dir runs/live-provider-canary. '
        + 'Do not use another tool. After it succeeds, report briefly.',
      ],
      tsconfigPath,
      processTimeoutMs: 120_000,
      env: { DSH_SUPRAMAS_BASE_URL: undefined },
    })
    expect(stdout).toContain('Created SupraMAS run live-provider-canary.')
  }, 135_000)
})
