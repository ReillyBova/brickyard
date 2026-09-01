/**
 * MCP over JSON-RPC, for the socket adapters.
 *
 * Small on purpose. The official SDK's transports are Node- and fetch-shaped and would
 * have to be carried into the browser bundle to be used here, for four methods and a
 * handful of shapes. Written directly, the handler is a pure function from request to
 * response, which is also the easiest thing in the codebase to test.
 *
 * Pure: no three.js imports, no DOM, no I/O.
 */

import { PROMPTS, SERVER_INSTRUCTIONS } from './instructions.ts';
import { TOOLS, callTool, type ToolContext } from './tools.ts';

/** Used when a client does not name one. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

export const SERVER_INFO = { name: 'brickyard', version: '0.1.0' } as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC reserved codes. */
const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

const err = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

/**
 * Handle one request. Returns `null` for a notification — a request with no `id` —
 * which by the JSON-RPC contract must not be answered.
 */
export async function handleRequest(
  request: JsonRpcRequest,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const isNotification = request.id === undefined;
  const params = request.params ?? {};

  try {
    switch (request.method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        return ok(id, {
          protocolVersion:
            typeof requested === 'string' && requested !== '' ? requested : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        });
      }

      // The client telling us it is ready. A notification: no reply.
      case 'notifications/initialized':
      case 'initialized':
        return null;

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });

      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string') {
          return err(id, INVALID_PARAMS, 'tools/call requires a tool name');
        }
        const args =
          typeof params.arguments === 'object' && params.arguments !== null
            ? (params.arguments as Record<string, unknown>)
            : {};
        return ok(id, await callTool(name, args, ctx));
      }

      case 'prompts/list':
        return ok(id, {
          prompts: PROMPTS.map((prompt) => ({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
          })),
        });

      case 'prompts/get': {
        const name = params.name;
        const prompt = PROMPTS.find((p) => p.name === name);
        if (!prompt) return err(id, INVALID_PARAMS, `no prompt called ${JSON.stringify(name)}`);

        const args = (params.arguments ?? {}) as Record<string, string>;
        const missing = prompt.arguments.filter((a) => a.required && !args[a.name]);
        if (missing.length > 0) {
          return err(
            id,
            INVALID_PARAMS,
            `missing argument: ${missing.map((a) => a.name).join(', ')}`,
          );
        }
        return ok(id, {
          description: prompt.description,
          messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }],
        });
      }

      default:
        if (isNotification) return null;
        return err(id, METHOD_NOT_FOUND, `unsupported method ${JSON.stringify(request.method)}`);
    }
  } catch (error) {
    if (isNotification) return null;
    return err(id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  }
}

/** Parse and dispatch one frame. Malformed JSON is answered, not thrown. */
export async function handleFrame(frame: string, ctx: ToolContext): Promise<string | null> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(frame) as JsonRpcRequest;
  } catch {
    return JSON.stringify(err(null, PARSE_ERROR, 'parse error'));
  }
  const response = await handleRequest(request, ctx);
  return response === null ? null : JSON.stringify(response);
}
