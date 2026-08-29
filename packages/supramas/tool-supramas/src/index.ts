/** Model-facing tools for the SupraMAS material-science run capability. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  SupraMasError,
  SupraMasRunId,
  type RunSnapshot,
} from '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas'

export const name = 'tool-supramas'
export const inject = ['tools', 'supramas']

interface ToolFailure {
  code: string
  root_cause_hint: string
  safe_retry: string
  stop_condition: string
}

interface ToolEnvelope {
  status: 'success' | 'error'
  summary: string
  next_actions: string[]
  artifacts: string[]
  data?: { run: RunSnapshot }
  error?: ToolFailure
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['success', 'error'] },
    summary: { type: 'string', required: true },
    next_actions: { type: 'array', required: true, items: { type: 'string' } },
    artifacts: { type: 'array', required: true, items: { type: 'string' } },
    data: {
      type: 'object',
      additionalProperties: false,
      properties: {
        run: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            jobId: { type: 'string', required: true },
            revision: { type: 'integer', required: true },
            phase: {
              type: 'string',
              required: true,
              enum: [
                'created',
                'clarifying',
                'task_ready',
                'running',
                'validating',
                'completed',
                'recoverable_failed',
                'failed',
                'cancelled',
              ],
            },
            inputTaskPath: { type: 'string', required: true },
            runDir: { type: 'string', required: true },
            createdAt: { type: 'integer', required: true },
            updatedAt: { type: 'integer', required: true },
            failure: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
                retryable: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
    },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        root_cause_hint: { type: 'string', required: true },
        safe_retry: { type: 'string', required: true },
        stop_condition: { type: 'string', required: true },
      },
    },
  },
} as const satisfies ValueSchemaSpec

const output = {
  schema: outputSchema,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function domainError(error: SupraMasError): ToolEnvelope {
  if (error.code === 'SUPRAMAS_RUN_EXISTS') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['choose_another_job_id', 'inspect_existing_run'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Retry with a new job_id, or inspect the existing run first.',
        stop_condition: 'Do not overwrite an existing run or reuse its job_id blindly.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_RUN_NOT_FOUND') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['list_or_create_run'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Verify the run_id or create the run before reading it.',
        stop_condition: 'Stop if the requested run belongs to another workspace or job.',
      },
    }
  }
  return {
    status: 'error',
    summary: error.message,
    next_actions: ['correct_request'],
    artifacts: [],
    error: {
      code: error.code,
      root_cause_hint: error.message,
      safe_retry: 'Correct the request using the reported lifecycle constraint, then retry once.',
      stop_condition: 'Stop after the same validated request fails again without state changing.',
    },
  }
}

function guard(action: () => ToolEnvelope): ToolEnvelope {
  try {
    return action()
  } catch (error) {
    if (error instanceof SupraMasError) return domainError(error)
    throw error
  }
}

/** Register the narrow M1 run creation and lookup tools. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'supramas_run_create',
    description: 'Create one deterministic, revisioned SupraMAS material-science run.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'Stable job id used below runs/<job_id>.' },
      input_task_path: { type: 'string', required: true, description: 'Canonical runs/<job_id>/input_task.yaml path.' },
      run_dir: { type: 'string', required: true, description: 'Canonical runs/<job_id> directory.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const run = ctx.supramas.create({
          jobId: args.job_id,
          inputTaskPath: args.input_task_path,
          runDir: args.run_dir,
        })
        return {
          status: 'success',
          summary: `Created SupraMAS run ${run.jobId}.`,
          next_actions: ['prepare_input_task'],
          artifacts: [run.inputTaskPath, run.runDir],
          data: { run },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_run_get',
    description: 'Read the current detached snapshot of one SupraMAS run.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Deterministic run id such as supramas:demo.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const run = ctx.supramas.get(SupraMasRunId(args.run_id))
        if (run === undefined) {
          throw new SupraMasError(`SupraMAS run ${args.run_id} was not found.`, 'SUPRAMAS_RUN_NOT_FOUND')
        }
        return {
          status: 'success',
          summary: `Loaded SupraMAS run ${run.jobId}.`,
          next_actions: run.phase === 'created' ? ['prepare_input_task'] : ['continue_run'],
          artifacts: [run.inputTaskPath, run.runDir],
          data: { run },
        }
      })
    },
  }))
}
