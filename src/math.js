// Pure 3D math. No DOM, no state, no config — every function is a
// straightforward transformation of its arguments.

// Apply Rx then Ry then Rz to a 3D point (degrees).
export function rotateXYZ(p, rxDeg, ryDeg, rzDeg) {
  let [x, y, z] = p;
  const rx = (rxDeg * Math.PI) / 180;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const ry = (ryDeg * Math.PI) / 180;
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const rz = (rzDeg * Math.PI) / 180;
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}

// Transform a local 2D triangle vertex (z=0) into world 3D coordinates,
// applying the item's rotation and translation.
export function worldVertex(p2d, item) {
  return worldVertex3D([p2d[0], p2d[1], 0], item);
}

export function worldVertex3D(p3d, item) {
  const r = rotateXYZ(p3d, item.rotX || 0, item.rotY || 0, item.rotZ || 0);
  return [r[0] + item.x, r[1] + item.y, r[2] + (item.z || 0)];
}

// Andrew's monotone chain. Returns the convex hull of an [x, y] point set
// in counter-clockwise order.
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Orbit-camera orthographic projection for the 3D preview. Camera angles
// are stored on view.camera as { azimuth, elevation } (degrees). At
// (0, 0) the camera looks down the -Y axis with Z up. At el=90 (looking
// straight down) the result matches the top-view (x, y) projection, so
// positions in the preview line up with the top view at any orbit angle.
export function projectPreview(p, view) {
  const cam = view.camera || { azimuth: 30, elevation: 25 };
  let [x, y, z] = p;
  const azRad = (-cam.azimuth * Math.PI) / 180;
  const ca = Math.cos(azRad);
  const sa = Math.sin(azRad);
  [x, y] = [x * ca - y * sa, x * sa + y * ca];
  const elRad = (-cam.elevation * Math.PI) / 180;
  const ce = Math.cos(elRad);
  const se = Math.sin(elRad);
  [y, z] = [y * ce - z * se, y * se + z * ce];
  return [x, -z];
}
