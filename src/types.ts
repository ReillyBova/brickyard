/**
 * Shared primitives. Contract file — see docs/ARCHITECTURE.md.
 *
 * Units are LDU throughout and +Y points down. The only conversion to three.js
 * convention is a single rotation on the scene root.
 */

export type Vec3 = readonly [number, number, number];

/** Column-major, identical in layout to three.js `Matrix4.elements`. */
export type Mat4 = readonly number[];

/** Column-major 3×3 orientation basis. */
export type Mat3 = readonly number[];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/**
 * Identifiers are branded so they cannot be built from a bare string. Everything
 * that enters the document is minted or validated (see `src/model/ids.ts`), which
 * matters because LDraw carries no per-part identity of its own — a part reference
 * is only a colour, a transform, and a filename. Ids are entirely ours, and
 * external callers (import, MCP) must pass through validation rather than being
 * trusted.
 */
export type BrickId = string & { readonly __brand: 'BrickId' };
export type GroupId = string & { readonly __brand: 'GroupId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };
