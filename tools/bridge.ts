/**
 * The MCP bridge: the tool surface over stdio, for any MCP client.
 *
 * A browser tab cannot accept an inbound connection, so the client dials a process
 * instead. This is that process. It holds the same session and the same tool registry
 * a page would (`src/features/mcp/`), and resolves real parts over HTTPS through the
 * shared reader — no mirror sync, no prebake, no key.
 *
 * Framing is newline-delimited JSON, one JSON-RPC message per line, per the MCP stdio
 * transport. **stdout carries the protocol**: everything diagnostic goes to stderr, or
 * it corrupts the stream.
 *
 * Run it directly (`node tools/bridge.ts`), or let `.mcp.json` do it.
 *
 * `model_screenshot` needs a page's WebGL context and reports itself unavailable here.
 * Every other tool works.
 */

/// <reference types="node" />

import { createInterface } from 'node:readline';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHttpReader } from '../src/ldraw/httpReader.ts';
import { createPartSource } from '../src/features/mcp/parts.ts';
import { handleFrame } from '../src/features/mcp/protocol.ts';
import { createReference, type CatalogEntry } from '../src/features/mcp/reference.ts';
import { Session } from '../src/features/mcp/session.ts';
import type { ToolContext } from '../src/features/mcp/tools.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/**
 * Where `model_save` writes. Its own directory, deliberately not `public/models/` —
 * that is the curated corpus, with an `index.json` and per-model manifests built by
 * `tools/build-model-manifests.ts`, and dropping loose files into it would corrupt a
 * managed set.
 */
const SAVE_DIR = path.join(root, '.mcp');

const log = (message: string): void => {
  process.stderr.write(`[brickyard] ${message}\n`);
};

async function loadCatalog(): Promise<readonly CatalogEntry[]> {
  const file = path.join(root, 'src', 'ui', 'PartsChest', 'catalog.generated.json');
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as CatalogEntry[];
  } catch (error) {
    log(`no chest catalog (${error instanceof Error ? error.message : String(error)}); parts_search will be empty`);
    return [];
  }
}

async function main(): Promise<void> {
  const catalog = await loadCatalog();
  const titles = Object.fromEntries(catalog.map((entry) => [entry.id, entry.title]));

  const context: ToolContext = {
    session: new Session(createPartSource(createHttpReader(), { titles })),
    reference: createReference(catalog),
    save: async (body, format) => {
      await fsp.mkdir(SAVE_DIR, { recursive: true });
      const file = path.join(SAVE_DIR, format === 'ldr' ? 'current.ldr' : 'current.json');
      await fsp.writeFile(file, body, 'utf8');
      return path.relative(root, file);
    },
  };

  log(`ready — ${catalog.length} catalog parts, saving to ${path.relative(root, SAVE_DIR)}/`);

  const lines = createInterface({ input: process.stdin });

  // Sequential on purpose: the session is a single mutable document, and interleaving
  // two placements would race the spatial index against the transaction that follows it.
  let queue: Promise<void> = Promise.resolve();

  for await (const line of lines) {
    const frame = line.trim();
    if (frame === '') continue;

    queue = queue.then(async () => {
      try {
        const response = await handleFrame(frame, context);
        if (response !== null) process.stdout.write(`${response}\n`);
      } catch (error) {
        log(`frame failed: ${error instanceof Error ? error.stack : String(error)}`);
      }
    });
  }

  await queue;
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
