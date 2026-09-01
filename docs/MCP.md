# MCP

A second channel into the document. A model builds through the same transactions a person does, so
it cannot produce an invalid model: every placement is solved by the mating code and validated
against the connection graph.

An ordinary MCP server, spoken over stdio. Any MCP client can use it.

```bash
npm run mcp
```

`.mcp.json` declares it, so a client that opens this repository is offered it without configuration.

## What a model can do

Twelve tools, built to the
[guidance for writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):
a few tools over whole workflows rather than one per `Operation`. The operations in `SPEC.md` are what
a person performs with a mouse; a model works in batches and wants fewer, larger tools.

| Tool | Workflow |
| --- | --- |
| `brick_place` | Place one or many bricks in a single call, each on a named connection point |
| `brick_transform` | Move or rotate a set about the Y axis, with the connectivity changes it implies |
| `brick_recolor` | Recolour a set, by handle or by group |
| `brick_remove` | Delete a set |
| `model_inspect` | The graph: model summary, one brick's detail, free points, neighbours, component, edges between a pair |
| `model_find` | Locate bricks by part, colour, group or region |
| `model_group` | Create, rename, set members, ungroup, list the tree |
| `model_history` | Undo, redo |
| `model_save` | Persist the document, or export `.ldr` |
| `parts_search` | The chest catalog by title and category |
| `model_screenshot` | Render from a named view or an explicit angle; returns an image |
| `reference_lookup` | Idiomatic construction from the step-decomposed model corpus |

**A session advertises only what it can serve.** The last two need capabilities an adapter supplies —
a renderer, a corpus — and are absent from `tools/list` when nothing provides them, because an
unusable tool still costs a model context to read and a call to discover. `callTool` accepts them
regardless and explains what is missing, for a client holding an older list.

**Placement names a target, not a matrix.** `brick_place` takes a target brick and connection point;
the session runs `findMates` and the collision check and derives the transform. A caller-supplied
`Mat4` would be an unconstrained 4×4 and the validity guarantee would not hold, so free placement is
a flag on the same tool and is still collision-checked. Cursor-driven scoring in `src/snap/resolve.ts`
answers a different question — which candidate a person meant — and is not involved.

**Handles, not ids.** `BrickId` is twelve characters from a 64-character alphabet, which is the
opaque-identifier case that costs agent accuracy. The session keeps a stable, legible handle per
brick — `brick-2x4-3` — and maps it to the `BrickId` internally. Ids surface only on request.

**Responses are bounded.** `model_inspect` and `model_find` return summaries by default, take a
`response_format` of `concise` or `detailed`, and truncate with a note naming a narrower query. A
large model is a few thousand bricks and must not fill a context window.

**Failures explain.** A rejected placement reports what was wrong — no compatible point on that face,
collision with a named brick, unknown part — and what to try instead.

Hide, isolate and selection are view state rather than document state, and are not exposed.

## Guidance the server carries

The server ships its own methodology: `instructions` in the `initialize` result, a `build` prompt, and
tool descriptions written as if for a new colleague.

Rendering a subject in brick is a creative problem, and a few decisions determine everything after
them. The guidance names those decisions rather than prescribing a procedure:

- **Scale, first and hardest.** The same subject is a different model at every size — at minifig scale
  a feature is a sub-assembly, at microscale a single part. Fix footprint and height in studs before
  anything else.
- **What has to read.** Three or four features make a subject recognisable. At small scale only the
  silhouette survives.
- **Which way the studs face.** Smooth and angled surfaces mean sideways building, which the
  connection model supports directly.
- **A small parts vocabulary.** Choose a handful of parts and reuse them, the way published sets do.
- **Check as you go.** A build that has drifted is easier to fix at fifty bricks than four hundred.

## Parts

The server resolves parts over HTTPS through `src/ldraw/httpReader.ts`, the network half of the reader
`LDRAW-PRIMER.md` and `src/ldraw/mirror.ts` describe — so it needs no mirror sync and no prebake.
Cold-resolving one part costs roughly twenty fetches, so `createPartSource` memoises per process.

The resolvers treat an unreadable file as an absent one, which is right for probing paths that
legitimately do not exist. `createPartSource` watches its own reader so a dropped connection is
reported as a read failure rather than a bad part number.

## Layout

```
src/features/mcp/
  session.ts        document + history, applies transactions, answers queries
  handles.ts        legible brick handles ⇄ BrickId
  tools.ts          schemas and handlers — the registry
  protocol.ts       JSON-RPC: initialize, tools/*, prompts/*, ping
  instructions.ts   server instructions and the build prompt
  parts.ts          a PartSource from any ReadFile
  reference.ts      catalog search, and a corpus when one is attached
src/model/serialize.ts   lossless JSON, and .ldr export
src/ldraw/httpReader.ts  the upstream libraries over HTTPS
tools/bridge.ts          the stdio server
```

`src/features/mcp/` is pure — no DOM, no three.js — like `src/model/` and `src/snap/`, and is tested
the same way. It runs unchanged in a page.

The session owns its own document. `model_save` writes to `.mcp/`, not `public/models/`, which is a
curated corpus with an index and per-model manifests built by `tools/build-model-manifests.ts`.

Serialization carries two formats because `.ldr` holds neither ids, groups nor the graph. The JSON
form is lossless and is what the tools save; `.ldr` is for interop, and a round trip through it mints
fresh ids.

## Ahead: agent-to-app interaction

The server drives a document of its own. The richer thing is an agent and a person working the same
model in a live tab — the agent placing bricks the person watches land, `model_screenshot` rendering
through the real `SceneRenderer`, undo shared across both.

The tool layer is already the right shape for it: pure, transport-agnostic, and the capability hooks
(`render`, `save`, `reference`) are the seams a page adapter fills. What is missing is a way to reach
a browser tab, and the platform is what makes that hard:

- A tab cannot listen. `new WebSocket(url)` dials outward and never creates an address, so the client
  has to dial something else.
- An `https://` page cannot open `ws://localhost`. The browser blocks it before the connection is
  attempted, so a local listener cannot serve a page hosted anywhere but localhost.
- A hosted client connects from its own infrastructure rather than the reader's machine, so a local
  listener is unreachable to it whatever the page's origin.

Three shapes survive those constraints, in increasing cost. The server also serves the application
over `http://localhost`, making page and listener same-origin. A public hostname resolving to
`127.0.0.1` with a real certificate, so an `https://` page can open `wss://`. Or a relay both sides
dial, the only one that works for a page on a public domain talking to a hosted client.

[WebMCP](https://github.com/webmachinelearning/webmcp) — `document.modelContext` — removes the network
hop entirely by letting a page declare its tools to an agent already inside the browser. It is the
cheapest of all of them and needs no transport work at all, once a client reads it.

## Verification

```bash
npm run test
```

The session is tested against real parts from the captured corpus, so the assertions are physical: a
squarely stacked pair of 2x4s mates eight studs because it does, and a brick placed into occupied
space is refused because the occupancy masks overlap.

End to end, drive the server over stdio and ask it to build something. What matters is that a
colliding placement is refused with a reason, that free points shrink as studs are built on, that a
connected component returns the whole structure from any brick in it, and that groups survive a save
and reload.
