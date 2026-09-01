/**
 * The tool registry — the single source of truth every adapter exposes.
 *
 * Shaped for how a model works rather than mirroring the operation set: `docs/SPEC.md`
 * lists what a person does with a mouse, one brick at a time, while a model works in
 * batches and pays for every round trip. So `brick_place` takes many bricks, the graph
 * queries collapse into one `model_inspect`, and responses are summaries by default.
 *
 * Pure: no three.js imports, no DOM. Capabilities that need a browser — rendering,
 * persistence — arrive as optional hooks on `ToolContext` and report themselves absent
 * rather than failing when a session has no page attached.
 */

import type { Vec3 } from '../../types.ts';
import { toLdr, stringifyDocument } from '../../model/serialize.ts';
import type { ReferenceLookup } from './reference.ts';
import { Session, SessionError, type PlacementRequest } from './session.ts';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

export interface ScreenshotRequest {
  view?: string;
  azimuth?: number;
  elevation?: number;
  frame?: readonly string[];
  highlight?: readonly string[];
  size?: number;
}

/** Returns a base64 PNG, without the data-URL prefix. */
export type Screenshot = (request: ScreenshotRequest) => Promise<string>;

export interface ToolContext {
  session: Session;
  /** Present when a page is attached; `model_screenshot` is unavailable without it. */
  render?: Screenshot;
  /** Persistence, when the adapter has somewhere to put a document. */
  save?: (text: string, format: 'json' | 'ldr') => Promise<string>;
  reference?: ReferenceLookup;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ---------------------------------------------------------------- helpers

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });

const json = (value: unknown): ToolResult => text(JSON.stringify(value, null, 2));

const failure = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * Cap a list and say what was cut, naming the narrower query rather than leaving a
 * model to guess. A large model is thousands of bricks and must not fill a window.
 */
function capped<T>(items: readonly T[], max: number, narrower: string) {
  if (items.length <= max) return { items, note: undefined };
  return {
    items: items.slice(0, max),
    note: `${items.length} matched; showing ${max}. ${narrower}`,
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Tools take `bricks` as a list of handles, or a single handle, or a group name. */
function names(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

const HANDLES_SCHEMA = {
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  description: 'Brick handles such as "brick-2x4-3", or a group name to mean all its members.',
};

// ---------------------------------------------------------------- tools

const brickPlace: ToolDefinition = {
  name: 'brick_place',
  description:
    'Place one or many bricks. Each brick names the connection point it joins — a target brick and one of its points, which you can read from model_inspect. Placements are solved with the real mating geometry and refused if they would overlap, so a returned brick is one that would physically hold. Bricks later in the list can build on bricks earlier in the same call, so build a wall in one call rather than one call per brick.',
  inputSchema: {
    type: 'object',
    properties: {
      bricks: {
        type: 'array',
        description: 'The bricks to place, in order.',
        items: {
          type: 'object',
          properties: {
            part: { type: 'string', description: 'LDraw part number, e.g. "3001".' },
            color: { type: 'number', description: 'LDraw colour code, e.g. 4 for red.' },
            on: {
              type: 'object',
              description: 'The connection to join.',
              properties: {
                brick: { type: 'string', description: 'Handle of the brick to build on.' },
                point: { type: 'string', description: 'One of that brick’s connection points.' },
              },
              required: ['brick', 'point'],
            },
            using: {
              type: 'string',
              description:
                'Which point on the new part does the joining. Chosen for you when omitted.',
            },
            roll: {
              type: 'number',
              description: 'Quarter turns about the shared axis: 0, 1, 2 or 3.',
            },
            transform: {
              type: 'array',
              items: { type: 'number' },
              description:
                'Free placement: a 16-element column-major world matrix, used instead of "on". Still collision-checked. Prefer "on".',
            },
            group: { type: 'string', description: 'Existing group to file this brick under.' },
          },
          required: ['part', 'color'],
        },
      },
    },
    required: ['bricks'],
  },
  handler: async (args, { session }) => {
    const requests = Array.isArray(args.bricks) ? (args.bricks as PlacementRequest[]) : [];
    if (requests.length === 0) return failure('brick_place: "bricks" must be a non-empty array.');

    const { placed, rejected } = await session.place(requests);
    return json({
      placed: placed.map((p) => ({
        brick: p.handle,
        part: p.part,
        position: p.position,
        connectedTo: p.connectedTo,
      })),
      ...(rejected.length === 0
        ? {}
        : {
            rejected: rejected.map((r) => ({
              part: r.request.part,
              on: r.request.on,
              reason: r.reason,
            })),
          }),
    });
  },
};

const brickTransform: ToolDefinition = {
  name: 'brick_transform',
  description:
    'Move or rotate a set of bricks together. Connectivity is re-solved afterwards: edges that no longer hold are dropped and new ones recorded, so the graph always describes where things actually are.',
  inputSchema: {
    type: 'object',
    properties: {
      bricks: HANDLES_SCHEMA,
      translate: {
        type: 'array',
        items: { type: 'number' },
        description: '[x, y, z] in LDU. A stud is 20 apart; Y points down, so up is negative.',
      },
      rotate: {
        type: 'object',
        description: 'Rotation about the Y axis, in quarter turns.',
        properties: { quarterTurns: { type: 'number' } },
      },
    },
    required: ['bricks'],
  },
  handler: async (args, { session }) => {
    const selection = names(args.bricks);
    if (selection.length === 0) return failure('brick_transform: name at least one brick or group.');

    const t = Array.isArray(args.translate) ? (args.translate as number[]) : [0, 0, 0];
    const quarters = num((args.rotate as Record<string, unknown> | undefined)?.quarterTurns) ?? 0;
    const angle = (quarters * Math.PI) / 2;
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    // Column-major, rotation about Y with the translation in the last column.
    const delta = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, 1];

    const moved = session.transform(
      selection,
      delta,
      quarters === 0 ? 'Move bricks' : 'Rotate bricks',
    );
    return json({ moved: moved.length, bricks: capped(moved, 40, 'Ask by group instead.').items });
  },
};

const brickRecolor: ToolDefinition = {
  name: 'brick_recolor',
  description: 'Recolour bricks, named individually or by the group they belong to.',
  inputSchema: {
    type: 'object',
    properties: {
      bricks: HANDLES_SCHEMA,
      color: { type: 'number', description: 'LDraw colour code.' },
    },
    required: ['bricks', 'color'],
  },
  handler: async (args, { session }) => {
    const color = num(args.color);
    if (color === undefined) return failure('brick_recolor: "color" must be an LDraw colour code.');
    const changed = session.recolor(names(args.bricks), color);
    return json({ recoloured: changed.length });
  },
};

const brickRemove: ToolDefinition = {
  name: 'brick_remove',
  description: 'Delete bricks and the connections they carried. Undoable with model_history.',
  inputSchema: {
    type: 'object',
    properties: { bricks: HANDLES_SCHEMA },
    required: ['bricks'],
  },
  handler: async (args, { session }) => {
    const removed = session.remove(names(args.bricks));
    return json({ removed: removed.length, bricks: removed });
  },
};

const modelInspect: ToolDefinition = {
  name: 'model_inspect',
  description:
    'Read the model. With no brick, returns a summary: how many bricks, which parts and colours, the group tree, and how many separate structures there are. With a brick, returns that brick in full — where it is, what it is joined to, and crucially which of its connection points are still free, which is what your next placement chooses among.',
  inputSchema: {
    type: 'object',
    properties: {
      brick: { type: 'string', description: 'Handle of a brick. Omit for a whole-model summary.' },
      include: {
        type: 'string',
        enum: ['detail', 'neighbors', 'component', 'free_points'],
        description:
          'What to return for a brick: full detail, its immediate neighbours, every brick structurally joined to it, or just its free connection points.',
      },
      response_format: { type: 'string', enum: ['concise', 'detailed'] },
    },
  },
  handler: async (args, { session }) => {
    const brick = str(args.brick);
    if (brick === undefined) {
      const summary = session.summary();
      if (str(args.response_format) === 'detailed') return json(summary);
      return json({
        bricks: summary.bricks,
        parts: summary.parts.slice(0, 10),
        colors: summary.colors,
        groups: summary.groups,
        connections: summary.connections,
        structures: summary.components.length,
        bounds: summary.bounds,
      });
    }

    switch (str(args.include)) {
      case 'neighbors':
        return json({ brick, neighbors: session.neighbors(brick) });
      case 'component': {
        const all = session.component(brick);
        const { items, note } = capped(all, 60, 'Group them and inspect the group instead.');
        return json({ brick, size: all.length, bricks: items, note });
      }
      case 'free_points':
        return json({ brick, freePoints: session.freePoints(brick) });
      default: {
        const detail = session.inspect(brick);
        if (str(args.response_format) === 'detailed') return json(detail);
        const { id: _id, ...rest } = detail;
        return json({
          ...rest,
          freePoints: capped(detail.freePoints, 24, 'Ask with include:"free_points".').items,
        });
      }
    }
  },
};

const modelFind: ToolDefinition = {
  name: 'model_find',
  description:
    'Find bricks by part, colour, group, or a region of space. Returns handles you can pass straight to the editing tools.',
  inputSchema: {
    type: 'object',
    properties: {
      part: { type: 'string', description: 'LDraw part number.' },
      color: { type: 'number', description: 'LDraw colour code.' },
      group: { type: 'string', description: 'Group name.' },
      within: {
        type: 'object',
        description: 'Axis-aligned box in LDU.',
        properties: {
          min: { type: 'array', items: { type: 'number' } },
          max: { type: 'array', items: { type: 'number' } },
        },
        required: ['min', 'max'],
      },
    },
  },
  handler: async (args, { session }) => {
    const within = args.within as { min: Vec3; max: Vec3 } | undefined;
    const found = session.find({
      ...(str(args.part) === undefined ? {} : { part: str(args.part)! }),
      ...(num(args.color) === undefined ? {} : { color: num(args.color)! }),
      ...(str(args.group) === undefined ? {} : { group: str(args.group)! }),
      ...(within === undefined ? {} : { within }),
    });
    const { items, note } = capped(found, 50, 'Narrow by colour, group or region.');
    return json({ matched: found.length, bricks: items, note });
  },
};

const modelGroup: ToolDefinition = {
  name: 'model_group',
  description:
    'Organise the model into named groups — a wall, a wing, a roof. A group name can be used anywhere a brick handle can, meaning all its members, so grouping as you build saves tracking handles later. Groups can nest.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'add', 'rename', 'ungroup', 'list'] },
      name: { type: 'string', description: 'The group to act on.' },
      bricks: HANDLES_SCHEMA,
      parent: { type: 'string', description: 'Parent group, when creating.' },
      newName: { type: 'string', description: 'The new name, when renaming.' },
    },
    required: ['action'],
  },
  handler: async (args, { session }) => {
    const action = str(args.action);
    const name = str(args.name);

    if (action === 'list') return json({ groups: session.summary().groups });
    if (name === undefined) return failure('model_group: "name" is required for this action.');

    switch (action) {
      case 'create':
        return json({ created: session.createGroup(name, names(args.bricks), str(args.parent)) });
      case 'add':
        return json({ added: session.setGroupMembers(name, names(args.bricks)) });
      case 'rename': {
        const next = str(args.newName);
        if (next === undefined) return failure('model_group: "newName" is required to rename.');
        return json({ renamed: session.renameGroup(name, next) });
      }
      case 'ungroup':
        return json({ released: session.ungroup(name) });
      default:
        return failure(`model_group: unknown action ${JSON.stringify(action)}.`);
    }
  },
};

const modelScreenshot: ToolDefinition = {
  name: 'model_screenshot',
  description:
    'Look at the model. Renders the current build from a named view or an explicit angle and returns an image. Cheap — check the silhouette every so often while building rather than at the end.',
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['iso', 'front', 'back', 'left', 'right', 'top'],
        description: 'Named viewpoint. Defaults to iso.',
      },
      azimuth: { type: 'number', description: 'Degrees around the model, instead of "view".' },
      elevation: { type: 'number', description: 'Degrees above the horizon.' },
      frame: {
        anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description: 'Fit the view to these bricks or this group. Defaults to everything.',
      },
      highlight: HANDLES_SCHEMA,
      size: { type: 'number', description: 'Pixels on the longest edge, up to 1024.' },
    },
  },
  handler: async (args, { render }) => {
    if (!render) {
      return failure(
        'model_screenshot needs a connected page to render with. Open the app and connect it, then try again.',
      );
    }
    const data = await render({
      ...(str(args.view) === undefined ? {} : { view: str(args.view)! }),
      ...(num(args.azimuth) === undefined ? {} : { azimuth: num(args.azimuth)! }),
      ...(num(args.elevation) === undefined ? {} : { elevation: num(args.elevation)! }),
      ...(args.frame === undefined ? {} : { frame: names(args.frame) }),
      ...(args.highlight === undefined ? {} : { highlight: names(args.highlight) }),
      ...(num(args.size) === undefined ? {} : { size: Math.min(1024, num(args.size)!) }),
    });
    return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
  },
};

const modelHistory: ToolDefinition = {
  name: 'model_history',
  description:
    'Undo or redo. Each tool call that changed the model is one step, so undoing a batch of forty bricks takes one undo, not forty.',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['undo', 'redo'] } },
    required: ['action'],
  },
  handler: async (args, { session }) => {
    const step = str(args.action) === 'redo' ? session.redo() : session.undo();
    return json(
      step === undefined ? { changed: false, reason: 'nothing to undo' } : { changed: true, step },
    );
  },
};

const modelSave: ToolDefinition = {
  name: 'model_save',
  description:
    'Save the model. The native format keeps brick identity, groups and connections; the ldr format is for opening in other LEGO tools and cannot carry any of those three.',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['native', 'ldr'] },
      name: { type: 'string', description: 'Model name, for the ldr header.' },
    },
  },
  handler: async (args, { session, save }) => {
    const ldr = str(args.format) === 'ldr';
    const body = ldr
      ? toLdr(session.document, str(args.name) === undefined ? {} : { name: str(args.name)! })
      : stringifyDocument(session.document);

    if (!save) {
      return text(
        `No save location is attached to this session, so here is the document instead.\n\n${body}`,
      );
    }
    return json({ saved: await save(body, ldr ? 'ldr' : 'json'), bytes: body.length });
  },
};

const partsSearch: ToolDefinition = {
  name: 'parts_search',
  description:
    'Search the parts catalog by name or category — "plate 1x2", "slope", "hinge". Returns part numbers to pass to brick_place.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to match against part names and categories.' },
      limit: { type: 'number', description: 'How many to return. Defaults to 20.' },
    },
    required: ['query'],
  },
  handler: async (args, { reference }) => {
    if (!reference) return failure('parts_search: no catalog is attached to this session.');
    const found = reference.searchParts(str(args.query) ?? '', num(args.limit) ?? 20);
    return json({ matched: found.length, parts: found });
  },
};

const referenceLookup: ToolDefinition = {
  name: 'reference_lookup',
  description:
    'Look up how published models solve a construction problem — attaching a wing, turning a surface sideways, building a hinge. Returns real examples as the bricks involved and how they connect.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you are trying to build.' },
      limit: { type: 'number' },
    },
    required: ['query'],
  },
  handler: async (args, { reference }) => {
    if (!reference) {
      return failure(
        'reference_lookup: the reference corpus is not built in this session. Everything else still works.',
      );
    }
    const found = await reference.lookup(str(args.query) ?? '', num(args.limit) ?? 5);
    return json({ examples: found });
  },
};

export const TOOLS: readonly ToolDefinition[] = [
  brickPlace,
  brickTransform,
  brickRecolor,
  brickRemove,
  modelInspect,
  modelFind,
  modelGroup,
  modelScreenshot,
  modelHistory,
  modelSave,
  partsSearch,
  referenceLookup,
];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map((tool) => [tool.name, tool]),
);

/**
 * Run a tool, turning caller error into a result the model can act on. A thrown
 * `SessionError` means the request was wrong — an unknown handle, a group that does
 * not exist — which is information, not a protocol failure.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return failure(`No tool called ${JSON.stringify(name)}.`);
  try {
    return await tool.handler(args, ctx);
  } catch (error) {
    if (error instanceof SessionError) return failure(error.message);
    throw error;
  }
}
