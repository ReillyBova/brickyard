/**
 * The protocol handler as a pure function: a request object in, a response object out.
 *
 * The tools underneath are exercised against real parts in `session.test.ts`; here the
 * subject is the envelope — negotiation, notifications, unknown methods, and the shape
 * a client actually receives.
 */

import { describe, expect, it } from 'vitest';

import { createReference } from './reference';
import { DEFAULT_PROTOCOL_VERSION, handleFrame, handleRequest } from './protocol';
import { Session } from './session';
import type { ToolContext } from './tools';
import { fixtureParts } from './__fixtures__/parts';

const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  session: new Session(fixtureParts),
  ...over,
});

/** Every call here carries an id, so a response is always due. */
async function call(method: string, params?: Record<string, unknown>, ctx = context()) {
  const res = await handleRequest(
    { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) },
    ctx,
  );
  if (res === null) throw new Error(`${method} answered a request with nothing`);
  return res;
}

describe('initialize', () => {
  it('echoes the version the client asked for', async () => {
    const res = await call('initialize', { protocolVersion: '2099-01-01' });
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe('2099-01-01');
  });

  it('falls back to a known version when the client names none', async () => {
    const res = await call('initialize', {});
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(
      DEFAULT_PROTOCOL_VERSION,
    );
  });

  it('carries the build guidance, which is the point of the field', async () => {
    const res = await call('initialize', {});
    const instructions = (res.result as { instructions: string }).instructions;
    expect(instructions).toMatch(/Scale, first and hardest/);
    expect(instructions).toMatch(/brick_place takes many bricks in one call/);
  });
});

describe('dispatch', () => {
  it('does not answer a notification', async () => {
    const res = await handleRequest(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      context(),
    );
    expect(res).toBeNull();
  });

  it('reports an unknown method rather than throwing', async () => {
    const res = await call('resources/list');
    expect(res.error?.code).toBe(-32601);
  });

  it('answers malformed JSON instead of throwing', async () => {
    const raw = await handleFrame('{not json', context());
    expect(JSON.parse(raw!).error.code).toBe(-32700);
  });

  it('answers ping', async () => {
    expect((await call('ping'))?.result).toEqual({});
  });
});

describe('tools/list', () => {
  it('advertises every tool with a schema', async () => {
    const res = await call('tools/list');
    const tools = (res.result as { tools: { name: string; inputSchema: unknown }[] }).tools;

    expect(tools.map((t) => t.name)).toContain('brick_place');
    expect(tools.every((t) => t.inputSchema !== undefined)).toBe(true);
  });

  it('namespaces tools by what they act on', async () => {
    const res = await call('tools/list');
    const names = (res.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names.every((n) => /^(brick|model|parts|reference)_/.test(n))).toBe(true);
  });
});

describe('tools/call', () => {
  it('places a brick through the protocol', async () => {
    const ctx = context();
    const res = await call(
      'tools/call',
      {
        name: 'brick_place',
        arguments: { bricks: [{ part: '3001', color: 4, transform: [...Session.IDENTITY] }] },
      },
      ctx,
    );

    const body = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
    expect(body.placed[0].brick).toBe('brick-2x4-1');
    expect(ctx.session.document.bricks.size).toBe(1);
  });

  it('returns a caller mistake as a tool error, not a protocol error', async () => {
    const res = await call('tools/call', {
      name: 'brick_remove',
      arguments: { bricks: ['nope-1'] },
    });

    expect(res.error).toBeUndefined();
    const result = res.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no brick or group by that name/);
  });

  it('rejects a call with no tool name', async () => {
    const res = await call('tools/call', { arguments: {} });
    expect(res.error?.code).toBe(-32602);
  });

  it('says a screenshot needs a page rather than failing silently', async () => {
    const res = await call('tools/call', { name: 'model_screenshot', arguments: {} });
    const result = res.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/connected page/);
  });

  it('renders a screenshot as an image block when a page is attached', async () => {
    const ctx = context({ render: async () => 'iVBORw0KGgo=' });
    const res = await call('tools/call', { name: 'model_screenshot', arguments: {} }, ctx);
    expect((res.result as { content: unknown[] }).content[0]).toEqual({
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    });
  });

  it('searches the catalog through the reference hook', async () => {
    const ctx = context({
      reference: createReference([
        { id: '3023', title: 'Plate 1 x 2', category: 'Plate' },
        { id: '3001', title: 'Brick 2 x 4', category: 'Brick' },
      ]),
    });
    const res = await call(
      'tools/call',
      { name: 'parts_search', arguments: { query: 'plate 1x2' } },
      ctx,
    );

    const body = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
    expect(body.parts[0].id).toBe('3023');
  });

  it('finds a part by its number', async () => {
    const ctx = context({
      reference: createReference([
        { id: '3023', title: 'Plate 1 x 2', category: 'Plate' },
        { id: '3001', title: 'Brick 2 x 4', category: 'Brick' },
      ]),
    });
    const res = await call('tools/call', { name: 'parts_search', arguments: { query: '3001' } }, ctx);
    const body = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
    expect(body.parts[0].id).toBe('3001');
  });
});

describe('prompts', () => {
  it('lists the build prompt with its arguments', async () => {
    const res = await call('prompts/list');
    const prompts = (res.result as { prompts: { name: string }[] }).prompts;
    expect(prompts.map((p) => p.name)).toEqual(['build']);
  });

  it('renders the prompt around the subject', async () => {
    const res = await call('prompts/get', { name: 'build', arguments: { subject: 'a dragon' } });
    const messages = (res.result as { messages: { content: { text: string } }[] }).messages;

    expect(messages[0].content.text).toContain('Build a dragon.');
    expect(messages[0].content.text).toMatch(/footprint and height in studs/);
  });

  it('names the scale when given one', async () => {
    const res = await call('prompts/get', {
      name: 'build',
      arguments: { subject: 'a house', scale: 'minifig' },
    });
    const messages = (res.result as { messages: { content: { text: string } }[] }).messages;
    expect(messages[0].content.text).toContain('Build it at minifig.');
  });

  it('refuses a prompt without its required argument', async () => {
    const res = await call('prompts/get', { name: 'build', arguments: {} });
    expect(res.error?.message).toMatch(/missing argument: subject/);
  });

  it('reports an unknown prompt', async () => {
    const res = await call('prompts/get', { name: 'nope' });
    expect(res.error?.code).toBe(-32602);
  });
});
