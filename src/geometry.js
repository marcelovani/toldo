// Pure geometry helpers. No DOM, no state — each function takes its
// inputs and returns a value.

import { config } from "./config.js";
import { worldVertex3D } from "./math.js";

export function unitsToPx(u) {
  return u * config.pxPerUnit;
}

export function pxToUnits(px) {
  return px / config.pxPerUnit;
}

// Build a triangle's three local vertices, centred on its centroid, from
// a size definition { a, b, c } (side lengths in units). Side `a` is laid
// along the local +X axis; the apex falls in -Y.
export function trianglePoints(size) {
  const a = unitsToPx(size.a);
  const b = unitsToPx(size.b);
  const c = unitsToPx(size.c);

  const cosB = (a * a + c * c - b * b) / (2 * a * c);
  const angleB = Math.acos(Math.max(-1, Math.min(1, cosB)));
  const Ax = c * Math.cos(angleB);
  const Ay = -c * Math.sin(angleB);

  const cx = (0 + a + Ax) / 3;
  const cy = (0 + 0 + Ay) / 3;

  return [
    [0 - cx, 0 - cy],
    [a - cx, 0 - cy],
    [Ax - cx, Ay - cy],
  ];
}

export function pointsRadius(points) {
  return Math.max(...points.map(([x, y]) => Math.hypot(x, y)));
}

export function pointsToString(points) {
  return points.map((p) => `${p[0]},${p[1]}`).join(" ");
}

// Vertex with the smallest local y — anchors the rotate handle.
export function localApex(points) {
  return points.reduce((best, p) => (p[1] < best[1] ? p : best), points[0]);
}

// Six 3D vertices for a triangle's slab (top face at local z=0, bottom
// face at local z=thickness), already in world space.
export function trianglePrismVertices(item) {
  const t = config.triangleThickness * config.pxPerUnit;
  const verts = [];
  for (const [px, py] of item.points) {
    verts.push(worldVertex3D([px, py, 0], item));
    verts.push(worldVertex3D([px, py, t], item));
  }
  return verts;
}

// Compute the L-shape bbox + per-rectangle dimensions in pixel coords,
// centred on the world origin.
export function computeBaseGeometry() {
  const r1w = unitsToPx(config.rect1.w);
  const r1h = unitsToPx(config.rect1.h);
  const r2w = unitsToPx(config.rect2.w);
  const r2h = unitsToPx(config.rect2.h);

  const bboxW = Math.max(r1w, r2h);
  const bboxH = Math.max(r1h, r2w);

  // Anchor (shared top-right corner) is at the bbox's top-right; placing
  // it at world (bboxW/2, -bboxH/2) centres the bbox on the origin.
  const anchorX = bboxW / 2;
  const anchorY = -bboxH / 2;

  return {
    bboxW,
    bboxH,
    anchorX,
    anchorY,
    r1w,
    r1h,
    r2w,
    r2h,
    rect1: { x: anchorX - r1w, y: anchorY, w: r1w, h: r1h },
    rect2: { x: anchorX, y: anchorY, w: r2w, h: r2h },
  };
}

// 12 triangles for an axis-aligned box. Vertices are emitted CCW from
// outside so each pair of triangles forms a face with an outward normal.
export function boxTriangles(x, y, z, w, h, d) {
  const v = [
    [x, y, z], // 0
    [x + w, y, z], // 1
    [x + w, y + h, z], // 2
    [x, y + h, z], // 3
    [x, y, z + d], // 4
    [x + w, y, z + d], // 5
    [x + w, y + h, z + d], // 6
    [x, y + h, z + d], // 7
  ];
  return [
    // Bottom (-Z) and top (+Z)
    [v[0], v[3], v[2]],
    [v[0], v[2], v[1]],
    [v[4], v[5], v[6]],
    [v[4], v[6], v[7]],
    // -Y and +Y
    [v[0], v[1], v[5]],
    [v[0], v[5], v[4]],
    [v[3], v[7], v[6]],
    [v[3], v[6], v[2]],
    // -X and +X
    [v[0], v[4], v[7]],
    [v[0], v[7], v[3]],
    [v[1], v[2], v[6]],
    [v[1], v[6], v[5]],
  ];
}

// 8 triangles for a triangular prism: 2 end caps + 3 rectangular sides.
export function trianglePrismTrianglesFor(item) {
  const t = config.triangleThickness * config.pxPerUnit;
  const top = item.points.map(([px, py]) => worldVertex3D([px, py, 0], item));
  const bot = item.points.map(([px, py]) => worldVertex3D([px, py, t], item));
  return [
    [top[0], top[1], top[2]],
    [bot[0], bot[2], bot[1]],
    [top[0], bot[0], bot[1]],
    [top[0], bot[1], top[1]],
    [top[1], bot[1], bot[2]],
    [top[1], bot[2], top[2]],
    [top[2], bot[2], bot[0]],
    [top[2], bot[0], top[0]],
  ];
}

// All triangles for the whole scene (L-shape boxes + every item prism),
// in pixel coordinates. Callers convert to design units via pxToUnits at
// emit time.
export function buildSceneTriangles(baseBbox, items) {
  const tris = [];
  const heightPx = config.rectHeight * config.pxPerUnit;
  tris.push(
    ...boxTriangles(
      baseBbox.rect1.x,
      baseBbox.rect1.y,
      0,
      baseBbox.rect1.w,
      baseBbox.rect1.h,
      heightPx,
    ),
  );
  tris.push(
    ...boxTriangles(
      baseBbox.anchorX - baseBbox.r2h,
      baseBbox.anchorY,
      0,
      baseBbox.r2h,
      baseBbox.r2w,
      heightPx,
    ),
  );
  for (const item of items) {
    tris.push(...trianglePrismTrianglesFor(item));
  }
  return tris;
}
