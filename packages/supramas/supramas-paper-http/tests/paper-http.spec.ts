import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { publicHttpNetwork } from '@deepseek-ai/dsh-web-fetch-http'
import { HttpPaperAcquisitionProvider } from '../src/index.ts'

type Handler = (request: IncomingMessage, response: ServerResponse) => void
let server: Server
let base: string
let handler: Handler

beforeEach(async () => {
  handler = (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf' })
    response.end('%PDF-')
  }
  server = createServer((request, response) => { handler(request, response) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
  vi.spyOn(publicHttpNetwork, 'resolve').mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

function provider(overrides: ConstructorParameters<typeof HttpPaperAcquisitionProvider>[0] = {}): HttpPaperAcquisitionProvider {
  return new HttpPaperAcquisitionProvider(overrides)
}

describe('HttpPaperAcquisitionProvider', () => {
  it('returns exact complete PDF bytes at the configured request cap', async () => {
    const result = await provider().acquire({ url: `${base}/paper.pdf`, maxBytes: 5 })
    expect(result).toMatchObject({ statusCode: 200, mediaType: 'application/pdf', url: `${base}/paper.pdf` })
    expect(new TextDecoder().decode(result.bytes)).toBe('%PDF-')
  })

  it('rejects declared and streamed overflow without returning partial bytes', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '6' })
      response.end('123456')
    }
    await expect(provider().acquire({ url: `${base}/declared.pdf`, maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_TOO_LARGE' })

    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/pdf' })
      response.write('123')
      response.end('456')
    }
    await expect(provider().acquire({ url: `${base}/streamed.pdf`, maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_TOO_LARGE' })
  })

  it('returns non-success status without retaining its response body', async () => {
    handler = (_request, response) => {
      response.writeHead(404, { 'content-type': 'text/html' })
      response.end('not found')
    }
    const result = await provider().acquire({ url: `${base}/missing.pdf`, maxBytes: 100 })
    expect(result.statusCode).toBe(404)
    expect(result.bytes.byteLength).toBe(0)
  })

  it('follows bounded public redirects across origins and revalidates every hop', async () => {
    handler = (request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: '/paper.pdf' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/pdf' })
      response.end('%PDF-')
    }
    await expect(provider().acquire({ url: `${base}/start`, maxBytes: 5 }))
      .resolves.toMatchObject({ url: `${base}/paper.pdf` })

    const port = (server.address() as AddressInfo).port
    handler = (request, response) => {
      if (request.url === '/cross') {
        response.writeHead(302, { location: `http://paper.test:${port}/paper.pdf` })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/pdf' })
      response.end('%PDF-')
    }
    await expect(provider().acquire({ url: `${base}/cross`, maxBytes: 5 }))
      .resolves.toMatchObject({ url: `http://paper.test:${port}/paper.pdf` })

    handler = (_request, response) => {
      response.writeHead(302, { location: 'https://private.test/paper.pdf' })
      response.end()
    }
    vi.mocked(publicHttpNetwork.resolve)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockRejectedValueOnce(Object.assign(new Error('private'), { code: 'WEB_BLOCKED_URL' }))
    await expect(provider().acquire({ url: `${base}/private-redirect`, maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_SOURCE_BLOCKED' })

    handler = (_request, response) => {
      response.writeHead(302, { location: '/loop' })
      response.end()
    }
    await expect(provider({ maxRedirects: 1 }).acquire({ url: `${base}/loop`, maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_REDIRECT_BLOCKED' })
  })

  it('blocks credentialed, private, and unsupported source URLs before transport', async () => {
    const fetcher = provider()
    await expect(fetcher.acquire({ url: 'https://user:pass@example.com/paper.pdf', maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_SOURCE_BLOCKED' })
    await expect(fetcher.acquire({ url: 'file:///tmp/paper.pdf', maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_SOURCE_BLOCKED' })
    vi.mocked(publicHttpNetwork.resolve).mockRejectedValueOnce(Object.assign(new Error('private'), { code: 'WEB_BLOCKED_URL' }))
    await expect(fetcher.acquire({ url: 'https://private.test/paper.pdf', maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_SOURCE_BLOCKED' })
  })

  it('distinguishes provider timeout from caller cancellation', async () => {
    handler = (_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/pdf' })
        response.end('%PDF-')
      }, 100)
    }
    await expect(provider({ timeoutMs: 10 }).acquire({ url: `${base}/slow`, maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_TIMEOUT' })

    const controller = new AbortController()
    controller.abort('cancelled')
    await expect(provider().acquire({ url: `${base}/cancel`, maxBytes: 5 }, controller.signal))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_ABORTED' })
  })
})
