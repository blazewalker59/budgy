import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { handleMcp, tool } from '@/lib/agents/mcp'

const echo = tool({
  name: 'echo',
  title: 'Echo',
  description: 'Says it back',
  input: z.object({ word: z.string() }),
  call: ({ word }) => Promise.resolve({ said: word }),
})
const broken = tool({
  name: 'broken',
  title: 'Broken',
  description: 'Always fails',
  input: z.object({}),
  call: () => Promise.reject(new Error('no slate yet')),
})
const tools = [echo, broken]
const req = (method: string, params?: object, id: number | string = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params ? { params } : {}),
})

describe('handleMcp', () => {
  it('agrees a protocol version, falling back to the newest it knows', async () => {
    const known = await handleMcp(
      req('initialize', { protocolVersion: '2025-06-18' }),
      tools,
      'Hi',
    )
    expect(known).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'budgy' },
        instructions: 'Hi',
      },
    })
    const unknown = await handleMcp(
      req('initialize', { protocolVersion: '1999-01-01' }),
      tools,
    )
    expect(unknown).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  })

  it('answers no notification or response', async () => {
    expect(
      await handleMcp(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        tools,
      ),
    ).toBeNull()
    expect(
      await handleMcp({ jsonrpc: '2.0', id: 3, result: {} }, tools),
    ).toBeNull()
  })

  it('lists tools with JSON Schema inputs', async () => {
    const r = await handleMcp(req('tools/list'), tools)
    expect(r).toMatchObject({
      result: {
        tools: [
          {
            name: 'echo',
            inputSchema: {
              type: 'object',
              properties: { word: { type: 'string' } },
              required: ['word'],
            },
          },
          { name: 'broken' },
        ],
      },
    })
  })

  it('calls a tool, returning text and structured content', async () => {
    const r = await handleMcp(
      req('tools/call', { name: 'echo', arguments: { word: 'hi' } }, 'a'),
      tools,
    )
    expect(r).toEqual({
      jsonrpc: '2.0',
      id: 'a',
      result: {
        content: [{ type: 'text', text: '{\n  "said": "hi"\n}' }],
        structuredContent: { said: 'hi' },
      },
    })
  })

  it('returns bad arguments and tool failures as tool errors the model can read', async () => {
    const bad = await handleMcp(
      req('tools/call', { name: 'echo', arguments: { word: 3 } }),
      tools,
    )
    expect(bad).toMatchObject({ result: { isError: true } })
    const failed = await handleMcp(req('tools/call', { name: 'broken' }), tools)
    expect(failed).toMatchObject({
      result: { isError: true, content: [{ text: 'no slate yet' }] },
    })
  })

  it('reports protocol errors as JSON-RPC errors', async () => {
    expect(
      await handleMcp(req('tools/call', { name: 'nope' }), tools),
    ).toMatchObject({ error: { code: -32602 } })
    expect(await handleMcp(req('resources/list'), tools)).toMatchObject({
      error: { code: -32601 },
    })
    expect(await handleMcp({ hello: 'world' }, tools)).toMatchObject({
      id: null,
      error: { code: -32600 },
    })
    expect(await handleMcp(req('ping'), tools)).toMatchObject({ result: {} })
  })
})
