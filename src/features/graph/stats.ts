/**
 * Graph statistics — the numbers that let a person judge whether a loaded model's
 * connectivity looks right. A model that comes apart into more connected components
 * than it visibly should have is a real bug in the connection analysis, not a
 * cosmetic detail; this is the module that surfaces it.
 *
 * Pure: no three.js imports, no DOM. Feature-owned, not a frozen contract.
 */
import type { BrickId } from '../../types';
import type { SceneDocument } from '../../model/types';

export interface GraphStats {
  brickCount: number;
  edgeCount: number;
  /** Edges where one side's `out` list carries the edge — a support relationship. */
  directedEdgeCount: number;
  /** Edges with no gendered side — hinge fingers and other symmetric connections. */
  peerEdgeCount: number;
  /** Connected components, per `ConnectionGraph.component`, largest first. */
  componentCount: number;
  componentSizes: readonly number[];
  /** Bricks that are their own component — every one is a candidate missed connection. */
  isolatedBrickIds: readonly BrickId[];
}

export function computeGraphStats(doc: SceneDocument): GraphStats {
  const { graph } = doc;

  const seen = new Set<BrickId>();
  const componentSizes: number[] = [];
  const isolatedBrickIds: BrickId[] = [];

  for (const id of doc.bricks.keys()) {
    if (seen.has(id)) continue;
    const component = graph.component(id);
    for (const member of component) seen.add(member);
    componentSizes.push(component.size);
    if (component.size <= 1) isolatedBrickIds.push(id);
  }
  componentSizes.sort((a, b) => b - a);

  let directedEdgeCount = 0;
  let peerEdgeCount = 0;
  for (const edge of graph.edges.values()) {
    const aOut = graph.nodes.get(edge.a)?.out.includes(edge.id) ?? false;
    const bOut = graph.nodes.get(edge.b)?.out.includes(edge.id) ?? false;
    if (aOut || bOut) directedEdgeCount++;
    else peerEdgeCount++;
  }

  return {
    brickCount: doc.bricks.size,
    edgeCount: graph.edges.size,
    directedEdgeCount,
    peerEdgeCount,
    componentCount: componentSizes.length,
    componentSizes,
    isolatedBrickIds,
  };
}
