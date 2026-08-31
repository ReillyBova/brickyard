/**
 * The connection graph: one edge per brick pair, carrying every `Mate` that joins
 * them, with adjacency stored per node in both directions.
 *
 * This module does not compute mates. Deriving which connection points coincide is
 * snap geometry, owned by `src/snap/`; the graph consumes precomputed `Mate` values.
 * Only the `Mate` and `SnapKind` *types* are imported from there.
 *
 * Pure: no three.js imports, no DOM.
 */

import type { BrickId, EdgeId } from '../types';
import type { Mate } from '../snap/types';
import type { ConnectionEdge, ConnectionGraph, GraphNode } from './types';

/**
 * A pairwise connection supplied by the caller. `mates` are expressed in the
 * orientation of this link: a mate's `aPoint` belongs to `a`, its `bPoint` to `b`,
 * and `polarity: 'a'` means `a` carries the male half.
 */
export interface MateLink {
  a: BrickId;
  b: BrickId;
  mates: readonly Mate[];
}

/** Which adjacency list an edge occupies on each of its two nodes. */
type EdgeDirection = 'a-out' | 'b-out' | 'peer';

/**
 * Deterministic and orientation-independent, so add/remove/add is idempotent.
 *
 * `BrickId` is an unconstrained string, so a plain separator would not be injective:
 * {'x', 'y~z'} and {'x~y', 'z'} would both render as 'x~y~z'. Length-prefixing the
 * first id makes the encoding reversible and therefore collision-free.
 */
export const edgeIdFor = (a: BrickId, b: BrickId): EdgeId => {
  const [first, second] = a <= b ? [a, b] : [b, a];
  return `${first.length}~${first}~${second}`;
};

/** Reverse a mate's sense, for restating a link in the opposite orientation. */
export const flipMate = (m: Mate): Mate => ({
  aPoint: m.bPoint,
  bPoint: m.aPoint,
  kind: m.kind,
  polarity: m.polarity === 'a' ? 'b' : m.polarity === 'b' ? 'a' : 'symmetric',
});

/**
 * An edge sits in exactly one adjacency list per node, so that the sum of node
 * degrees is exactly twice the edge count.
 *
 * A mix of both gendered directions on one edge — each brick's male half entering
 * the other's female half — is mutual support with no single supporting side, and is
 * classified `peer` alongside genuinely symmetric connections.
 */
const directionOf = (mates: readonly Mate[]): EdgeDirection => {
  let hasA = false;
  let hasB = false;
  for (const m of mates) {
    if (m.polarity === 'a') hasA = true;
    else if (m.polarity === 'b') hasB = true;
  }
  if (hasA && !hasB) return 'a-out';
  if (hasB && !hasA) return 'b-out';
  return 'peer';
};

const emptyNode = (brick: BrickId): GraphNode => ({ brick, out: [], in: [], peer: [] });

const withEdge = (node: GraphNode, list: keyof GraphNode & ('out' | 'in' | 'peer'), id: EdgeId): GraphNode =>
  node[list].includes(id) ? node : { ...node, [list]: [...node[list], id] };

const withoutEdge = (node: GraphNode, id: EdgeId): GraphNode => {
  const out = node.out.includes(id) ? node.out.filter((e) => e !== id) : node.out;
  const inn = node.in.includes(id) ? node.in.filter((e) => e !== id) : node.in;
  const peer = node.peer.includes(id) ? node.peer.filter((e) => e !== id) : node.peer;
  if (out === node.out && inn === node.in && peer === node.peer) return node;
  return { brick: node.brick, out, in: inn, peer };
};

/** Mutable working copy. Maps are shallow-copied once per operation; entries are shared. */
interface Draft {
  nodes: Map<BrickId, GraphNode>;
  edges: Map<EdgeId, ConnectionEdge>;
}

const attach = (draft: Draft, edge: ConnectionEdge): void => {
  const dir = directionOf(edge.mates);
  const aList = dir === 'a-out' ? 'out' : dir === 'b-out' ? 'in' : 'peer';
  const bList = dir === 'a-out' ? 'in' : dir === 'b-out' ? 'out' : 'peer';
  const a = draft.nodes.get(edge.a) ?? emptyNode(edge.a);
  const b = draft.nodes.get(edge.b) ?? emptyNode(edge.b);
  draft.nodes.set(edge.a, withEdge(withoutEdge(a, edge.id), aList, edge.id));
  draft.nodes.set(edge.b, withEdge(withoutEdge(b, edge.id), bList, edge.id));
  draft.edges.set(edge.id, edge);
};

const detach = (draft: Draft, id: EdgeId): void => {
  const edge = draft.edges.get(id);
  if (!edge) return;
  draft.edges.delete(id);
  for (const brick of [edge.a, edge.b]) {
    const node = draft.nodes.get(brick);
    if (node) draft.nodes.set(brick, withoutEdge(node, id));
  }
};

/**
 * Restate a link with its bricks in canonical order, flipping the mates to match.
 *
 * Storing one canonical orientation makes the graph a function of the connections
 * themselves rather than of the order a caller happened to write them, which is what
 * lets a disconnect and its inverting connect restore a byte-identical structure.
 */
const normalizeLink = (l: MateLink): MateLink =>
  l.a <= l.b ? l : { a: l.b, b: l.a, mates: l.mates.map(flipMate) };

const assertDistinct = (a: BrickId, b: BrickId): void => {
  if (a === b) throw new Error(`graph: a brick cannot connect to itself (${a})`);
};

/** Merge a link into the draft, uniting its mates with any already on that pair. */
const link = (draft: Draft, raw: MateLink): void => {
  assertDistinct(raw.a, raw.b);
  const l = normalizeLink(raw);
  const id = edgeIdFor(l.a, l.b);
  const existing = draft.edges.get(id);
  if (!existing) {
    attach(draft, { id, a: l.a, b: l.b, mates: [...l.mates] });
    return;
  }
  if (existing.a !== l.a || existing.b !== l.b) {
    throw new Error(
      `graph: edge id ${id} already holds (${existing.a}, ${existing.b}), refusing to merge (${l.a}, ${l.b})`,
    );
  }
  const mateKey = (m: Mate): string => `${m.aPoint.length}|${m.aPoint}|${m.bPoint}`;
  const seen = new Set(existing.mates.map(mateKey));
  const merged = [...existing.mates];
  for (const m of l.mates) {
    const key = mateKey(m);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(m);
    }
  }
  attach(draft, { id, a: existing.a, b: existing.b, mates: merged });
};

export class Graph implements ConnectionGraph {
  readonly nodes: ReadonlyMap<BrickId, GraphNode>;
  readonly edges: ReadonlyMap<EdgeId, ConnectionEdge>;

  constructor(nodes: ReadonlyMap<BrickId, GraphNode>, edges: ReadonlyMap<EdgeId, ConnectionEdge>) {
    this.nodes = nodes;
    this.edges = edges;
  }

  private draft(): Draft {
    return { nodes: new Map(this.nodes), edges: new Map(this.edges) };
  }

  private static from(draft: Draft): Graph {
    return new Graph(draft.nodes, draft.edges);
  }

  neighbors(id: BrickId): readonly BrickId[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    const out: BrickId[] = [];
    for (const edgeId of [...node.out, ...node.in, ...node.peer]) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      out.push(edge.a === id ? edge.b : edge.a);
    }
    return out;
  }

  /** Connected component containing `id`, traversing `out`, `in` and `peer` alike. */
  component(id: BrickId): ReadonlySet<BrickId> {
    const seen = new Set<BrickId>();
    if (!this.nodes.has(id)) return seen;
    const queue: BrickId[] = [id];
    seen.add(id);
    while (queue.length > 0) {
      const current = queue.pop() as BrickId;
      for (const next of this.neighbors(current)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  /** Edges joining `id` to anything, in no particular order. */
  edgesOf(id: BrickId): readonly ConnectionEdge[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    const ids = [...node.out, ...node.in, ...node.peer];
    return ids.map((e) => this.edges.get(e)).filter((e): e is ConnectionEdge => e !== undefined);
  }

  /** Total degree of a node, counting each incident edge once. */
  degree(id: BrickId): number {
    const node = this.nodes.get(id);
    return node ? node.out.length + node.in.length + node.peer.length : 0;
  }

  /**
   * Add a brick as a node, together with the links that join it to bricks already
   * present. Every link must name `brick` on one side; the other side must exist.
   */
  addBrick(brick: BrickId, mates: readonly MateLink[] = []): Graph {
    return this.addBricks([{ brick, mates }]);
  }

  /** Batch form: one map copy for the whole batch, not one per brick. */
  addBricks(entries: readonly { brick: BrickId; mates?: readonly MateLink[] }[]): Graph {
    const draft = this.draft();
    for (const entry of entries) {
      if (!draft.nodes.has(entry.brick)) draft.nodes.set(entry.brick, emptyNode(entry.brick));
    }
    for (const entry of entries) {
      for (const l of entry.mates ?? []) {
        if (l.a !== entry.brick && l.b !== entry.brick) {
          throw new Error(`graph.addBrick: link ${l.a}~${l.b} does not involve ${entry.brick}`);
        }
        const other = l.a === entry.brick ? l.b : l.a;
        if (!draft.nodes.has(other)) {
          throw new Error(`graph.addBrick: ${entry.brick} links to unknown brick ${other}`);
        }
        link(draft, l);
      }
    }
    return Graph.from(draft);
  }

  /** Remove a brick and every edge touching it, from both adjacency directions. */
  removeBrick(id: BrickId): Graph {
    return this.removeBricks([id]);
  }

  removeBricks(ids: readonly BrickId[]): Graph {
    const draft = this.draft();
    for (const id of ids) {
      const node = draft.nodes.get(id);
      if (!node) continue;
      for (const edgeId of [...node.out, ...node.in, ...node.peer]) detach(draft, edgeId);
      draft.nodes.delete(id);
    }
    return Graph.from(draft);
  }

  /** Add or extend edges between bricks that are already nodes. */
  connect(links: readonly MateLink[]): Graph {
    const draft = this.draft();
    for (const l of links) {
      for (const brick of [l.a, l.b]) {
        if (!draft.nodes.has(brick)) {
          throw new Error(`graph.connect: unknown brick ${brick}`);
        }
      }
      link(draft, l);
    }
    return Graph.from(draft);
  }

  /** Drop the entire edge between each pair, if present. */
  disconnect(pairs: readonly { a: BrickId; b: BrickId }[]): Graph {
    const draft = this.draft();
    for (const p of pairs) detach(draft, edgeIdFor(p.a, p.b));
    return Graph.from(draft);
  }

  /**
   * Install whole edges, exactly as the `connect` operation carries them.
   *
   * Strict where `connect` is lenient: an edge is the complete set of mates joining
   * its pair, so a pair that already has one is a caller error rather than something
   * to merge into. That strictness is what makes `addEdges` and `removeEdges` exact
   * inverses of each other, which the undo path depends on.
   */
  addEdges(edges: readonly ConnectionEdge[]): Graph {
    const draft = this.draft();
    for (const raw of edges) {
      assertDistinct(raw.a, raw.b);
      for (const brick of [raw.a, raw.b]) {
        if (!draft.nodes.has(brick)) throw new Error(`graph.addEdges: unknown brick ${brick}`);
      }
      const id = edgeIdFor(raw.a, raw.b);
      if (draft.edges.has(id)) {
        throw new Error(`graph.addEdges: ${raw.a} and ${raw.b} are already connected`);
      }
      const l = normalizeLink({ a: raw.a, b: raw.b, mates: raw.mates });
      attach(draft, { id, a: l.a, b: l.b, mates: [...l.mates] });
    }
    return Graph.from(draft);
  }

  /** Remove whole edges, as the `disconnect` operation carries them. */
  removeEdges(edges: readonly ConnectionEdge[]): Graph {
    const draft = this.draft();
    for (const raw of edges) {
      const id = edgeIdFor(raw.a, raw.b);
      if (!draft.edges.has(id)) {
        throw new Error(`graph.removeEdges: ${raw.a} and ${raw.b} are not connected`);
      }
      detach(draft, id);
    }
    return Graph.from(draft);
  }

  /** The stored edge joining a pair, in canonical orientation. */
  edgeBetween(a: BrickId, b: BrickId): ConnectionEdge | undefined {
    return this.edges.get(edgeIdFor(a, b));
  }
}

export const emptyGraph = (): Graph => new Graph(new Map(), new Map());

/**
 * Build a graph from a brick list and a solved edge list — the shape the graph
 * solver returns after importing a model.
 */
export const buildGraph = (
  bricks: readonly BrickId[],
  edges: readonly ConnectionEdge[] = [],
): Graph => {
  const draft: Draft = { nodes: new Map(), edges: new Map() };
  for (const brick of bricks) draft.nodes.set(brick, emptyNode(brick));
  for (const edge of edges) {
    for (const brick of [edge.a, edge.b]) {
      if (!draft.nodes.has(brick)) {
        throw new Error(`buildGraph: edge ${edge.id} references unknown brick ${brick}`);
      }
    }
    link(draft, { a: edge.a, b: edge.b, mates: edge.mates });
  }
  return new Graph(draft.nodes, draft.edges);
};
