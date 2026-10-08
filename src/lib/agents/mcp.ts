/**
 * A minimal Model Context Protocol server (docs/adr/0004): JSON-RPC over
 * one POST per message, answered with JSON (MCP's Streamable HTTP without
 * the optional event stream), offering tools only. Pure: the tools carry
 * their own data access.
 */

import { z } from 'zod'

/** Newest first; a client asking for one we don't know gets the newest. */
const PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]

export const SERVER_INFO = { name: 'budgy', version: '1.0.0' }

export interface McpTool<TInput extends z.ZodType = z.ZodType> {
  name: string
  title: string
  description: string
  input: TInput
  /** JSON-serializable data; an object is also sent as structured content. */
  call: (args: z.infer<TInput>) => Promise<unknown>
}

/** Define a tool with its argument types inferred from its schema. */
export function tool<TInput extends z.ZodType>(
  t: McpTool<TInput>,
): McpTool<TInput> {
  return t
}

type Id = string | number

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: Id | null; result: unknown }
  | {
      jsonrpc: '2.0'
      id: Id | null
      error: { code: number; message: string }
    }

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

const Message = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
})

const CallParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
})

function error(id: Id | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** The body couldn't be read as JSON. */
export const parseError = error(null, PARSE_ERROR, 'Parse error')

/**
 * Answer one JSON-RPC message. Null for a notification or a response,
 * which get no reply (HTTP 202).
 */
export async function handleMcp(
  message: unknown,
  tools: ReadonlyArray<McpTool>,
  instructions?: string,
): Promise<JsonRpcResponse | null> {
  const parsed = Message.safeParse(message)
  if (!parsed.success) return error(null, INVALID_REQUEST, 'Invalid request')
  const { id, method, params } = parsed.data
  if (id === undefined || method === undefined) return null
  const ok = (result: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    result,
  })

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.find((v) => v === asked)
          ? asked
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        ...(instructions ? { instructions } : {}),
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input),
        })),
      })
    case 'tools/call': {
      const call = CallParams.safeParse(params)
      if (!call.success) return error(id, INVALID_PARAMS, 'Invalid params')
      const t = tools.find((x) => x.name === call.data.name)
      if (!t)
        return error(id, INVALID_PARAMS, `Unknown tool: ${call.data.name}`)
      const args = t.input.safeParse(call.data.arguments ?? {})
      // Tool errors go back as results, so the model can see and correct them.
      if (!args.success) {
        return ok(
          toolError(`Invalid arguments: ${z.prettifyError(args.error)}`),
        )
      }
      try {
        return ok(toolResult(await t.call(args.data)))
      } catch (e) {
        return ok(toolError(e instanceof Error ? e.message : String(e)))
      }
    }
    default:
      return error(id, METHOD_NOT_FOUND, `Method not found: ${method}`)
  }
}

function toolResult(data: unknown) {
  const structured =
    data !== null && typeof data === 'object' && !Array.isArray(data)
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    ...(structured ? { structuredContent: data } : {}),
  }
}

function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true }
}
