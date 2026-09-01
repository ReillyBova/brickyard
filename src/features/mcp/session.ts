/**
 * The document as an MCP session sees it.
 *
 * Everything a tool can do runs through here, and everything here runs through the
 * same `Transaction`s the interface commits — so an MCP edit is undoable next to a
 * mouse edit, and a placement is solved by the mating code rather than asserted by
 * the caller. That is what makes the channel unable to produce an invalid model.
 *
 * Bricks are addressed by handle (see `./handles.ts`), never by `BrickId`, and groups
 * by name. Both are validated on the way in; nothing casts a caller's string into a
 * branded id.
 *
 * Pure: no three.js imports, no DOM. Part geometry arrives through `PartSource`, which
 * the caller supplies — over the network in a page, from disk in a test.
 */

import type { BrickId, GroupId, Mat4, Vec3 } from '../../types.ts';
import type { BrickInstance, ConnectionEdge, GroupDef, SceneDocument, Transaction } from '../../model/types.ts';
import type { ColorLibrary } from '../../ldraw/types.ts';
import type { ConnectionPoint, MateGroup, PartDef } from '../../snap/types.ts';
import { IDENTITY, multiply, positionOf, transformPoint } from '../../math.ts';
import { allBricks, emptyDocument, getBrick } from '../../model/document.ts';
import { edgeIdFor, mintBrickId, mintGroupId } from '../../model/ids.ts';
import {
  type History,
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from '../../model/history.ts';
import { collides } from '../../snap/collision.ts';
import { isCompatible } from '../../snap/compat.ts';
import { findMates, solveMating } from '../../snap/mating.ts';
import { HashSpatialIndex } from '../../snap/spatialIndex.ts';
import { HandleTable } from './handles.ts';

export type PartSource = (partId: string) => Promise<PartDef>;

export interface PlacementRequest {
  /** LDraw part number, e.g. `'3001'`. */
  part: string;
  /** LDraw colour code. */
  color: number;
  /** The connection this brick is joining. Omit only with `transform`. */
  on?: { brick: string; point: string };
  /** Which of the new part's points does the joining. Chosen for you when absent. */
  using?: string;
  /** Quarter turns about the shared axis. */
  roll?: number;
  /** Free placement: an explicit world matrix. Still collision-checked. */
  transform?: readonly number[];
  /** Group to file the brick under, by name. */
  group?: string;
}

export interface PlacedBrick {
  handle: string;
  part: string;
  position: Vec3;
  /** Handles of everything this brick ended up joined to. */
  connectedTo: readonly string[];
}

export interface Rejection {
  request: PlacementRequest;
  reason: string;
}

export interface PlaceResult {
  placed: readonly PlacedBrick[];
  rejected: readonly Rejection[];
}

export interface BrickDetail {
  handle: string;
  part: string;
  title: string;
  color: number;
  position: Vec3;
  group?: string;
  connectedTo: readonly string[];
  freePoints: readonly { point: string; kind: string; gender: string }[];
  occupiedPoints: readonly string[];
  id: BrickId;
}

export interface ModelSummary {
  bricks: number;
  groups: readonly { name: string; members: number; parent?: string }[];
  parts: readonly { part: string; title: string; count: number }[];
  colors: readonly number[];
  connections: number;
  /** Sizes of each structurally joined cluster, largest first. */
  components: readonly number[];
  bounds?: { min: Vec3; max: Vec3 };
}

const round = (v: Vec3): Vec3 => [
  Math.round(v[0] * 1000) / 1000,
  Math.round(v[1] * 1000) / 1000,
  Math.round(v[2] * 1000) / 1000,
];

/** Thrown for caller error — an unknown handle, a part that will not load. */
export class SessionError extends Error {}

export class Session {
  private history: History;
  private readonly index = new HashSpatialIndex();
  private readonly handles = new HandleTable();
  private readonly parts = new Map<string, PartDef>();
  private readonly source: PartSource;
  /** Validates `colorCode` against the loaded LDraw palette. Absent skips the check. */
  private readonly colors?: ColorLibrary;
  /** What the index currently holds, so syncing is a diff rather than a rebuild. */
  private indexed = new Map<BrickId, Mat4>();
  /** Bricks placed by the batch in flight, visible to later requests in the same call. */
  private pending = new Map<BrickId, BrickInstance>();

  constructor(source: PartSource, doc: SceneDocument = emptyDocument(), colors?: ColorLibrary) {
    this.source = source;
    this.history = createHistory(doc);
    this.colors = colors;
  }

  get document(): SceneDocument {
    return this.history.doc;
  }

  /**
   * Load every part the document references and bring the handle table and spatial
   * index up to date. Call after construction with a loaded document, and after any
   * change made outside `commitTransaction`.
   */
  async sync(): Promise<void> {
    for (const brick of this.document.bricks.values()) await this.part(brick.partId);
    this.syncHandles();
    this.syncIndex();
  }

  private async part(partId: string): Promise<PartDef> {
    const cached = this.parts.get(partId);
    if (cached) return cached;
    let def: PartDef;
    try {
      def = await this.source(partId);
    } catch (cause) {
      throw new SessionError(
        `part ${partId} could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    this.parts.set(partId, def);
    return def;
  }

  private syncHandles(): void {
    for (const brick of this.document.bricks.values()) {
      this.handles.assign(brick.id, brick.partId, this.parts.get(brick.partId)?.title);
    }
  }

  /**
   * Reconcile the index with the document. Transform equality is by reference: every
   * operation writes a fresh matrix, so an unchanged brick keeps the same array and a
   * moved one does not.
   */
  private syncIndex(): void {
    const next = new Map<BrickId, Mat4>();
    for (const brick of this.document.bricks.values()) {
      const part = this.parts.get(brick.partId);
      if (!part) continue;
      if (this.indexed.get(brick.id) !== brick.transform) {
        this.index.insert(brick.id, part, brick.transform);
      }
      next.set(brick.id, brick.transform);
    }
    for (const id of this.indexed.keys()) {
      if (!next.has(id)) {
        this.index.remove(id);
        this.handles.release(id);
      }
    }
    this.indexed = next;
  }

  private commitTransaction(tx: Transaction): void {
    this.history = commit(this.history, tx);
    this.syncHandles();
    this.syncIndex();
  }

  // ---------------------------------------------------------------- addressing

  /** A handle, or a raw id for a caller that kept one. Throws rather than returning undefined. */
  brickId(nameOrId: string): BrickId {
    const id = this.handles.resolve(nameOrId);
    if (id === undefined || !(this.document.bricks.has(id) || this.pending.has(id))) {
      throw new SessionError(`no brick called ${JSON.stringify(nameOrId)}`);
    }
    return id;
  }

  /**
   * A brick from the document, or from the batch currently being placed. Bricks in a
   * batch are not in the document until it commits, and a wall built in one call has
   * to be able to stack on the course it just laid.
   */
  private brickAt(id: BrickId): BrickInstance | undefined {
    return getBrick(this.document, id) ?? this.pending.get(id);
  }

  handleOf(id: BrickId): string {
    return this.handles.handleFor(id) ?? id;
  }

  groupId(name: string): GroupId {
    for (const group of this.document.groups.values()) {
      if (group.name === name || group.id === name) return group.id;
    }
    throw new SessionError(`no group called ${JSON.stringify(name)}`);
  }

  /** Bricks named directly, or every member of a named group. Unknown names are skipped. */
  resolveSelection(names: readonly string[]): readonly BrickId[] {
    const out: BrickId[] = [];
    const seen = new Set<BrickId>();
    for (const name of names) {
      for (const id of this.matching(name)) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
    return out;
  }

  /**
   * A name is a brick handle or a group name. Neither matching is an error here: a
   * selection built from several names reports what it could not find as a whole,
   * rather than failing on the first miss with a message about whichever kind it
   * happened to check last.
   */
  private matching(name: string): readonly BrickId[] {
    const direct = this.handles.resolve(name);
    if (direct !== undefined && (this.document.bricks.has(direct) || this.pending.has(direct))) {
      return [direct];
    }
    const group = [...this.document.groups.values()].find((g) => g.name === name || g.id === name);
    if (!group) return [];
    return allBricks(this.document)
      .filter((b) => b.groupId === group.id)
      .map((b) => b.id);
  }

  // ---------------------------------------------------------------- placement

  async place(requests: readonly PlacementRequest[]): Promise<PlaceResult> {
    const placed: PlacedBrick[] = [];
    const rejected: Rejection[] = [];
    const bricks: BrickInstance[] = [];
    const edges: ConnectionEdge[] = [];

    this.pending = new Map();
    for (const request of requests) {
      try {
        const outcome = await this.solve(request);
        bricks.push(outcome.brick);
        edges.push(...outcome.edges);
        // Visible and indexed immediately: later requests in the same batch stack on
        // earlier ones, and a wall built in one call must collide with its own course.
        this.pending.set(outcome.brick.id, outcome.brick);
        this.index.insert(outcome.brick.id, outcome.part, outcome.brick.transform);
        this.indexed.set(outcome.brick.id, outcome.brick.transform);
        placed.push({
          handle: this.handles.assign(outcome.brick.id, outcome.brick.partId, outcome.part.title),
          part: outcome.brick.partId,
          position: round(positionOf(outcome.brick.transform)),
          connectedTo: outcome.edges.map((e) =>
            this.handleOf(e.a === outcome.brick.id ? e.b : e.a),
          ),
        });
      } catch (error) {
        rejected.push({
          request,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.pending = new Map();
    if (bricks.length > 0) {
      const label = bricks.length === 1 ? 'Place brick' : `Place ${bricks.length} bricks`;
      this.commitTransaction({
        label,
        ops: [
          { type: 'add', bricks },
          ...(edges.length > 0 ? ([{ type: 'connect', edges }] as const) : []),
        ],
      });
    }

    return { placed, rejected };
  }

  /** Refuses a colour code the loaded palette does not recognise. No-op with no palette loaded. */
  private checkColor(code: number): void {
    if (this.colors !== undefined && !this.colors.has(code)) {
      throw new SessionError(`${code} is not a colour code in the loaded LDraw palette.`);
    }
  }

  private async solve(
    request: PlacementRequest,
  ): Promise<{ brick: BrickInstance; part: PartDef; edges: readonly ConnectionEdge[] }> {
    this.checkColor(request.color);
    const part = await this.part(request.part);
    const id = mintBrickId();
    const transform = request.on ? this.solveOnPoint(part, request) : this.freeTransform(request);

    if (collides(part, transform, this.index)) {
      throw new SessionError(
        `${request.part} would overlap a brick already there. Try a different connection point, or move the obstruction first.`,
      );
    }

    const groups: readonly MateGroup[] = findMates(part, transform, this.index);
    if (request.on && groups.length === 0) {
      throw new SessionError(
        `${request.part} does not reach any connection from there — the point exists but nothing on this part mates with it.`,
      );
    }

    const brick: BrickInstance = {
      id,
      partId: request.part,
      colorCode: request.color,
      transform,
      ...(request.group === undefined ? {} : { groupId: this.groupId(request.group) }),
    };
    const edges = groups.map((g) => ({
      id: edgeIdFor(id, g.brick),
      a: id,
      b: g.brick,
      mates: g.mates,
    }));
    return { brick, part, edges };
  }

  private freeTransform(request: PlacementRequest): Mat4 {
    if (request.transform === undefined) {
      throw new SessionError(
        `${request.part} needs either a connection point in "on", or an explicit "transform".`,
      );
    }
    if (request.transform.length !== 16) {
      throw new SessionError(`"transform" must be 16 numbers, column-major; got ${request.transform.length}.`);
    }
    return [...request.transform];
  }

  private solveOnPoint(part: PartDef, request: PlacementRequest): Mat4 {
    const on = request.on!;
    const targetId = this.brickId(on.brick);
    const target = this.brickAt(targetId)!;
    const targetPart = this.parts.get(target.partId);
    if (!targetPart) throw new SessionError(`part ${target.partId} is not loaded`);

    const targetPoint = targetPart.connections.find((p) => p.id === on.point);
    if (!targetPoint) throw new SessionError(this.pointHint(on.brick, on.point, targetPart));

    const moving = this.chooseMovingPoint(part, targetPoint, request.using);
    return solveMating(part, moving, targetPoint, target.transform, request.roll ?? 0);
  }

  /**
   * What to try instead of a point that does not exist.
   *
   * Sampled across the point's source files rather than taken from the front of the
   * list: a 2x4 carries eight underside sockets before its first stud, so a flat head
   * of the list would name only sockets and steer a caller away from the studs they
   * almost certainly wanted.
   */
  private pointHint(brick: string, missing: string, part: PartDef): string {
    const bySource = new Map<string, ConnectionPoint[]>();
    for (const point of part.connections) {
      const bucket = bySource.get(point.source) ?? [];
      bucket.push(point);
      bySource.set(point.source, bucket);
    }

    const sample = [...bySource.values()].flatMap((points) =>
      points.slice(0, 3).map((p) => `${p.id} (${p.kind} ${p.gender})`),
    );
    return `${brick} has no connection point "${missing}". It has ${part.connections.length} points, including: ${sample.join(', ')}`;
  }

  /**
   * Which of the new part's points does the joining. Naming it is optional because a
   * model asking to put a brick on a stud should not also have to know which of that
   * brick's eight studs to name; the first compatible one is the natural reading, and
   * `roll` covers the orientation that choice leaves open.
   */
  private chooseMovingPoint(
    part: PartDef,
    targetPoint: ConnectionPoint,
    named?: string,
  ): ConnectionPoint {
    if (named !== undefined) {
      const point = part.connections.find((p) => p.id === named);
      if (!point) throw new SessionError(`${part.id} has no connection point "${named}"`);
      if (!isCompatible(point, targetPoint)) {
        throw new SessionError(`${part.id} point "${named}" does not mate with "${targetPoint.id}"`);
      }
      return point;
    }
    const compatible = part.connections.find((p) => isCompatible(p, targetPoint));
    if (!compatible) {
      throw new SessionError(
        `nothing on ${part.id} mates with a ${targetPoint.kind} of gender ${targetPoint.gender}.`,
      );
    }
    return compatible;
  }

  // ---------------------------------------------------------------- editing

  /**
   * Apply one delta to a set. Connectivity is re-solved rather than carried: the old
   * edges are dropped and whatever the new position engages is recorded, which is what
   * lets undo restore the graph exactly.
   *
   * Collision is checked per moved brick against the rest of the scene, the same way
   * `solve()` checks it on placement, with the moving set exempted exactly as
   * `findMates` already exempts it below. Any hit refuses the whole call before
   * anything is computed further — nothing is applied partially.
   */
  transform(names: readonly string[], delta: Mat4, label = 'Move bricks'): readonly string[] {
    const ids = this.requireSelection(names);
    const moving = new Set(ids);

    const before = this.edgesTouching(moving);
    const after: ConnectionEdge[] = [];
    for (const id of ids) {
      const brick = getBrick(this.document, id)!;
      const part = this.parts.get(brick.partId);
      if (!part) continue;
      const next = multiply(delta, brick.transform);
      if (collides(part, next, this.index, moving)) {
        throw new SessionError(
          `moving ${this.handleOf(id)} would overlap a brick already there. Try a different destination, or move the obstruction first.`,
        );
      }
      for (const group of findMates(part, next, this.index, moving)) {
        after.push({ id: edgeIdFor(id, group.brick), a: id, b: group.brick, mates: group.mates });
      }
    }

    this.commitTransaction({
      label,
      ops: [
        ...(before.length > 0 ? ([{ type: 'disconnect', edges: before }] as const) : []),
        { type: 'transformMany', ids, delta },
        ...(after.length > 0 ? ([{ type: 'connect', edges: after }] as const) : []),
      ],
    });
    return ids.map((id) => this.handleOf(id));
  }

  recolor(names: readonly string[], color: number): readonly string[] {
    this.checkColor(color);
    const ids = this.requireSelection(names);
    const changes = ids
      .map((id) => ({ id, from: getBrick(this.document, id)!.colorCode, to: color }))
      .filter((c) => c.from !== c.to);
    if (changes.length > 0) {
      this.commitTransaction({ label: 'Recolour', ops: [{ type: 'recolor', changes }] });
    }
    return ids.map((id) => this.handleOf(id));
  }

  remove(names: readonly string[]): readonly string[] {
    const ids = this.requireSelection(names);
    const removed = ids.map((id) => this.handleOf(id));
    const bricks = ids.map((id) => getBrick(this.document, id)!);
    const edges = this.edgesTouching(new Set(ids));

    this.commitTransaction({
      label: bricks.length === 1 ? 'Delete brick' : `Delete ${bricks.length} bricks`,
      ops: [
        ...(edges.length > 0 ? ([{ type: 'disconnect', edges }] as const) : []),
        { type: 'remove', bricks },
      ],
    });
    return removed;
  }

  private requireSelection(names: readonly string[]): readonly BrickId[] {
    const ids = this.resolveSelection(names);
    if (ids.length === 0) {
      const unknown = names.filter((n) => this.matching(n).length === 0);
      throw new SessionError(
        `nothing matched ${unknown.map((n) => JSON.stringify(n)).join(', ')} — no brick or group by that name.`,
      );
    }
    return ids;
  }

  private edgesTouching(ids: ReadonlySet<BrickId>): readonly ConnectionEdge[] {
    const out: ConnectionEdge[] = [];
    for (const edge of this.document.graph.edges.values()) {
      if (ids.has(edge.a) || ids.has(edge.b)) out.push(edge);
    }
    return out;
  }

  // ---------------------------------------------------------------- groups

  createGroup(name: string, members: readonly string[] = [], parent?: string): string {
    for (const group of this.document.groups.values()) {
      if (group.name === name) {
        throw new SessionError(`a group called ${JSON.stringify(name)} already exists`);
      }
    }
    const group: GroupDef = {
      id: mintGroupId(),
      name,
      ...(parent === undefined ? {} : { parentId: this.groupId(parent) }),
    };
    const ids = this.resolveSelection(members);
    this.commitTransaction({
      label: `Group ${name}`,
      ops: [
        { type: 'addGroup', group },
        ...(ids.length > 0
          ? ([
              {
                type: 'reparent',
                changes: ids.map((id) => {
                  const from = getBrick(this.document, id)!.groupId;
                  return { id, ...(from === undefined ? {} : { from }), to: group.id };
                }),
              },
            ] as const)
          : []),
      ],
    });
    return name;
  }

  setGroupMembers(name: string, members: readonly string[]): number {
    const group = this.groupId(name);
    const ids = this.resolveSelection(members);
    const changes = ids
      .map((id) => {
        const from = getBrick(this.document, id)!.groupId;
        return { id, ...(from === undefined ? {} : { from }), to: group };
      })
      .filter((c) => c.from !== group);
    if (changes.length > 0) {
      this.commitTransaction({ label: `Add to ${name}`, ops: [{ type: 'reparent', changes }] });
    }
    return changes.length;
  }

  renameGroup(name: string, next: string): string {
    const id = this.groupId(name);
    const group = this.document.groups.get(id)!;
    this.commitTransaction({
      label: `Rename ${name}`,
      ops: [
        { type: 'removeGroup', group },
        { type: 'addGroup', group: { ...group, name: next } },
      ],
    });
    return next;
  }

  /** Dissolve the group; its bricks stay where they are. */
  ungroup(name: string): number {
    const id = this.groupId(name);
    const group = this.document.groups.get(id)!;
    const members = allBricks(this.document).filter((b) => b.groupId === id);
    this.commitTransaction({
      label: `Ungroup ${group.name}`,
      ops: [
        ...(members.length > 0
          ? ([
              { type: 'reparent', changes: members.map((b) => ({ id: b.id, from: id })) },
            ] as const)
          : []),
        { type: 'removeGroup', group },
      ],
    });
    return members.length;
  }

  // ---------------------------------------------------------------- history

  undo(): string | undefined {
    const label = undoLabel(this.history);
    if (!canUndo(this.history)) return undefined;
    this.history = undo(this.history);
    this.syncHandles();
    this.syncIndex();
    return label;
  }

  redo(): string | undefined {
    const label = redoLabel(this.history);
    if (!canRedo(this.history)) return undefined;
    this.history = redo(this.history);
    this.syncHandles();
    this.syncIndex();
    return label;
  }

  // ---------------------------------------------------------------- queries

  summary(): ModelSummary {
    const doc = this.document;
    const bricks = allBricks(doc);

    const byPart = new Map<string, number>();
    const colors = new Set<number>();
    for (const brick of bricks) {
      byPart.set(brick.partId, (byPart.get(brick.partId) ?? 0) + 1);
      colors.add(brick.colorCode);
    }

    const seen = new Set<BrickId>();
    const components: number[] = [];
    for (const brick of bricks) {
      if (seen.has(brick.id)) continue;
      const component = doc.graph.component(brick.id);
      for (const id of component) seen.add(id);
      components.push(component.size);
    }

    return {
      bricks: bricks.length,
      groups: [...doc.groups.values()].map((g) => ({
        name: g.name,
        members: bricks.filter((b) => b.groupId === g.id).length,
        ...(g.parentId === undefined
          ? {}
          : { parent: doc.groups.get(g.parentId)?.name ?? g.parentId }),
      })),
      parts: [...byPart]
        .map(([part, count]) => ({ part, title: this.parts.get(part)?.title ?? part, count }))
        .sort((a, b) => b.count - a.count),
      colors: [...colors].sort((a, b) => a - b),
      connections: doc.graph.edges.size,
      components: components.sort((a, b) => b - a),
      ...(bricks.length === 0 ? {} : { bounds: this.bounds(bricks) }),
    };
  }

  private bounds(bricks: readonly BrickInstance[]): { min: Vec3; max: Vec3 } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const brick of bricks) {
      const part = this.parts.get(brick.partId);
      const local = part?.bounds ?? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
      // Eight corners, because a rotated brick's world box is not its local box.
      for (const x of [local.min[0], local.max[0]]) {
        for (const y of [local.min[1], local.max[1]]) {
          for (const z of [local.min[2], local.max[2]]) {
            const p = transformPoint(brick.transform, [x, y, z]);
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], p[i]);
              max[i] = Math.max(max[i], p[i]);
            }
          }
        }
      }
    }
    return { min: round(min), max: round(max) };
  }

  inspect(name: string): BrickDetail {
    const id = this.brickId(name);
    const brick = getBrick(this.document, id)!;
    const part = this.parts.get(brick.partId);

    const occupied = new Set<string>();
    for (const edge of this.document.graph.edges.values()) {
      if (edge.a === id) for (const m of edge.mates) occupied.add(m.aPoint);
      if (edge.b === id) for (const m of edge.mates) occupied.add(m.bPoint);
    }

    const connections = part?.connections ?? [];
    return {
      handle: this.handleOf(id),
      part: brick.partId,
      title: part?.title ?? brick.partId,
      color: brick.colorCode,
      position: round(positionOf(brick.transform)),
      ...(brick.groupId === undefined
        ? {}
        : { group: this.document.groups.get(brick.groupId)?.name ?? brick.groupId }),
      connectedTo: [...this.document.graph.neighbors(id)].map((n) => this.handleOf(n)),
      freePoints: connections
        .filter((p) => !occupied.has(p.id))
        .map((p) => ({ point: p.id, kind: p.kind, gender: p.gender })),
      occupiedPoints: [...occupied],
      id,
    };
  }

  neighbors(name: string): readonly string[] {
    return [...this.document.graph.neighbors(this.brickId(name))].map((id) => this.handleOf(id));
  }

  component(name: string): readonly string[] {
    return [...this.document.graph.component(this.brickId(name))].map((id) => this.handleOf(id));
  }

  edgeBetween(a: string, b: string): ConnectionEdge | undefined {
    return this.document.graph.edges.get(edgeIdFor(this.brickId(a), this.brickId(b)));
  }

  find(filter: {
    part?: string;
    color?: number;
    group?: string;
    within?: { min: Vec3; max: Vec3 };
  }): readonly string[] {
    const groupId = filter.group === undefined ? undefined : this.groupId(filter.group);
    return allBricks(this.document)
      .filter((brick) => {
        if (filter.part !== undefined && brick.partId !== filter.part) return false;
        if (filter.color !== undefined && brick.colorCode !== filter.color) return false;
        if (groupId !== undefined && brick.groupId !== groupId) return false;
        if (filter.within !== undefined) {
          const p = positionOf(brick.transform);
          for (let i = 0; i < 3; i++) {
            if (p[i] < filter.within.min[i] || p[i] > filter.within.max[i]) return false;
          }
        }
        return true;
      })
      .map((brick) => this.handleOf(brick.id));
  }

  /** Free connection points on a brick, which is what a next placement chooses among. */
  freePoints(name: string): readonly { point: string; kind: string; gender: string }[] {
    return this.inspect(name).freePoints;
  }

  /** The identity matrix, for callers assembling a free-placement transform. */
  static readonly IDENTITY: Mat4 = IDENTITY;
}
