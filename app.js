const SVG_NS = "http://www.w3.org/2000/svg";

const config = {
  pxPerUnit: 50,
  rect1: { w: 3.3, h: 1.5 }, // first rectangle in units
  rect2: { w: 3.8, h: 1.5 }, // second rectangle (pre-rotation)
  triangleSizes: [
    { id: "2x2x2", a: 2, b: 2, c: 2 },
    { id: "3x3x3", a: 3, b: 3, c: 3 },
    { id: "3.6x3.6x3.6", a: 3.6, b: 3.6, c: 3.6 },
    { id: "4x4x4", a: 4, b: 4, c: 4 },
    { id: "5x5x5", a: 5, b: 5, c: 5 },
    { id: "3x4x5", a: 3, b: 4, c: 5 },
  ],
  rotateHandleOffset: 28,
  dragThreshold: 4,
  rectHeight: 2.4, // L-shape extruded height (Z) in units
  triangleThickness: 0.1, // triangle slab thickness in units
};

// View definitions: each view sees the world through a different
// orthographic projection, and editing a triangle in that view changes a
// specific subset of its world coordinates and rotation.
const VIEW_DEFS = {
  top: {
    label: "Top",
    axes: ["X", "Y"],
    rotAxis: "rotZ",
    editable: true,
    project: (p) => [p[0], p[1]],
    setItemUV: (item, u, v) => {
      item.x = u;
      item.y = v;
    },
    itemUV: (item) => [item.x, item.y],
    drawBase: drawBaseTop,
  },
  front: {
    label: "Front",
    axes: ["X", "Z"],
    rotAxis: "rotY",
    editable: true,
    project: (p) => [p[0], -p[2]],
    setItemUV: (item, u, v) => {
      item.x = u;
      item.z = -v;
    },
    itemUV: (item) => [item.x, -item.z],
    drawBase: drawBaseFront,
  },
  side: {
    label: "Side",
    axes: ["Y", "Z"],
    rotAxis: "rotX",
    editable: true,
    project: (p) => [p[1], -p[2]],
    setItemUV: (item, u, v) => {
      item.y = u;
      item.z = -v;
    },
    itemUV: (item) => [item.y, -item.z],
    drawBase: drawBaseSide,
  },
  preview: {
    label: "3D Preview",
    editable: false,
    project: projectPreview,
    drawBase: drawBasePreview,
  },
};

const VIEW_KEYS = ["top", "front", "side", "preview"];

const state = {
  selectedSizeId: null,
  items: [],
  nextId: 1,
  selectedItemId: null,
  drag: null, // { kind: "move" | "rotate", item, viewKey, ... }
  // L-shape bbox in world units (centered at origin).
  baseBbox: null,
  // Name of the currently-loaded/saved design, if any. Used as the default
  // file name when exporting.
  currentDesignName: null,
};

// Per-view runtime: { canvas, zoomGroup, zoom, panX, panY, def }
const views = {};

const STORAGE_KEY = "toldo:designs";
const AUTOSAVE_KEY = "toldo:autosave";

const sizeList = document.getElementById("size-list");
const addBtn = document.getElementById("add-btn");
const itemList = document.getElementById("item-list");
const scaleLabel = document.getElementById("scale-label");
const saveBtn = document.getElementById("save-btn");
const designList = document.getElementById("design-list");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file");

scaleLabel.textContent = config.pxPerUnit;
document.getElementById("rect1-label").textContent =
  `${config.rect1.w} × ${config.rect1.h}`;
document.getElementById("rect2-label").textContent =
  `${config.rect2.w} × ${config.rect2.h}`;

function unitsToPx(u) {
  return u * config.pxPerUnit;
}

// ---------- 3D math ----------

function rotateXYZ(p, rxDeg, ryDeg, rzDeg) {
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

// Transform a local 2D triangle vertex (z=0) into world 3D coordinates.
function worldVertex(p2d, item) {
  return worldVertex3D([p2d[0], p2d[1], 0], item);
}

function worldVertex3D(p3d, item) {
  const r = rotateXYZ(p3d, item.rotX || 0, item.rotY || 0, item.rotZ || 0);
  return [r[0] + item.x, r[1] + item.y, r[2] + (item.z || 0)];
}

// Six 3D vertices of a triangle's slab (top face at z=0, bottom face at
// z=thickness in local space).
function trianglePrismVertices(item) {
  const t = config.triangleThickness * config.pxPerUnit;
  const verts = [];
  for (const [px, py] of item.points) {
    verts.push(worldVertex3D([px, py, 0], item));
    verts.push(worldVertex3D([px, py, t], item));
  }
  return verts;
}

// Andrew's monotone chain convex hull. Input/output: array of [x, y].
function convexHull(points) {
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

// ---------- Sidebar lists ----------

function buildSizeList() {
  sizeList.innerHTML = "";
  config.triangleSizes.forEach((size) => {
    const li = document.createElement("li");
    li.dataset.id = size.id;
    li.innerHTML = `<span>${size.id}</span><small>${size.a} × ${size.b} × ${size.c}</small>`;
    li.addEventListener("click", () => selectSize(size.id));
    sizeList.appendChild(li);
  });
}

function selectSize(id) {
  state.selectedSizeId = id;
  [...sizeList.children].forEach((li) => {
    li.classList.toggle("selected", li.dataset.id === id);
  });
  addBtn.disabled = !id;
}

// ---------- View setup ----------

function setupViews() {
  document.querySelectorAll(".canvas").forEach((canvas) => {
    const key = canvas.dataset.view;
    if (!VIEW_DEFS[key]) return;
    views[key] = {
      key,
      canvas,
      zoomGroup: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      def: VIEW_DEFS[key],
      // Camera for the orbit-able 3D preview; ignored by the other views.
      camera: { azimuth: 30, elevation: 25 },
    };
    canvas.addEventListener("pointerdown", (e) =>
      onCanvasPointerDown(e, views[key]),
    );
    canvas.addEventListener("wheel", (e) => onCanvasWheel(e, views[key]), {
      passive: false,
    });
  });
}

function clearView(view) {
  const { canvas } = view;
  while (canvas.firstChild) canvas.removeChild(canvas.firstChild);
  view.zoomGroup = document.createElementNS(SVG_NS, "g");
  view.zoomGroup.setAttribute("class", "zoom-group");
  applyZoomTransform(view);
  canvas.appendChild(view.zoomGroup);
}

function applyZoomTransform(view) {
  if (!view.zoomGroup) return;
  view.zoomGroup.setAttribute(
    "transform",
    `translate(${view.panX} ${view.panY}) scale(${view.zoom})`,
  );
}

function viewBoxForCanvas(view) {
  const rect = view.canvas.getBoundingClientRect();
  view.canvas.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  return rect;
}

// Center the world origin (which is the L-shape's center) in this view's
// canvas if pan/zoom haven't been customized yet.
function centerViewIfDefault(view) {
  if (view.panX !== 0 || view.panY !== 0 || view.zoom !== 1) return;
  const rect = view.canvas.getBoundingClientRect();
  view.panX = rect.width / 2;
  view.panY = rect.height / 2;
  applyZoomTransform(view);
}

// ---------- Base shape drawing ----------

function computeBaseGeometry() {
  const r1w = unitsToPx(config.rect1.w);
  const r1h = unitsToPx(config.rect1.h);
  const r2w = unitsToPx(config.rect2.w);
  const r2h = unitsToPx(config.rect2.h);

  const bboxW = Math.max(r1w, r2h);
  const bboxH = Math.max(r1h, r2w);

  // Anchor (shared top-right corner) is at the bbox's top-right, which we
  // place at world (bboxW/2, -bboxH/2) so the bbox is centered on the origin.
  const anchorX = bboxW / 2;
  const anchorY = -bboxH / 2;

  state.baseBbox = {
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

function drawBaseTop(view) {
  const b = state.baseBbox;
  const r1 = document.createElementNS(SVG_NS, "rect");
  r1.setAttribute("x", b.rect1.x);
  r1.setAttribute("y", b.rect1.y);
  r1.setAttribute("width", b.rect1.w);
  r1.setAttribute("height", b.rect1.h);
  r1.setAttribute("class", "toldo-base");
  view.zoomGroup.appendChild(r1);

  const r2 = document.createElementNS(SVG_NS, "rect");
  r2.setAttribute("x", b.rect2.x);
  r2.setAttribute("y", b.rect2.y);
  r2.setAttribute("width", b.rect2.w);
  r2.setAttribute("height", b.rect2.h);
  r2.setAttribute("class", "toldo-base");
  r2.setAttribute("transform", `rotate(90 ${b.anchorX} ${b.anchorY})`);
  view.zoomGroup.appendChild(r2);

  drawHorizontalRuler(view, b.rect1.x, b.anchorX, b.anchorY);
  drawVerticalRulerFromTop(view, b.anchorY, b.anchorY + b.bboxH, b.anchorX);
}

// In front view (X-Z), the L-shape's two extruded boxes project to a single
// rectangle (the union of their X-Z silhouettes), with v from -rectHeight to 0.
function drawBaseFront(view) {
  const b = state.baseBbox;
  const xMin = b.rect1.x;
  const xMax = b.anchorX;
  const heightPx = config.rectHeight * config.pxPerUnit;
  drawSilhouetteRect(view, xMin, xMax, -heightPx, 0);
  drawHorizontalRuler(view, xMin, xMax, -heightPx);
  drawZRuler(view, xMax);
}

function drawBaseSide(view) {
  const b = state.baseBbox;
  const yMin = b.anchorY;
  const yMax = b.anchorY + b.bboxH;
  const heightPx = config.rectHeight * config.pxPerUnit;
  drawSilhouetteRect(view, yMin, yMax, -heightPx, 0);
  drawHorizontalRuler(view, yMin, yMax, -heightPx);
  drawZRuler(view, yMax);
}

// Orbit-camera orthographic projection for the 3D preview. Camera angles
// are stored on view.camera as { azimuth, elevation } (degrees). At
// (0, 0) the camera looks down the -Y axis (front view) with Z up.
function projectPreview(p, view) {
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
  // Mirror horizontally so the preview's orientation matches expectations.
  return [-x, -z];
}

function drawBasePreview(view) {
  const b = state.baseBbox;
  const heightPx = config.rectHeight * config.pxPerUnit;
  // Rect1 box, axis-aligned in world.
  drawBoxWireframe(
    view,
    b.rect1.x,
    b.rect1.y,
    0,
    b.rect1.w,
    b.rect1.h,
    heightPx,
  );
  // Rect2 was rotated 90° around the anchor in the XY plane; the resulting
  // box is still axis-aligned, just with swapped X/Y dimensions and a
  // shifted origin.
  drawBoxWireframe(
    view,
    b.anchorX - b.r2h,
    b.anchorY,
    0,
    b.r2h,
    b.r2w,
    heightPx,
  );
}

function drawBoxWireframe(view, x, y, z, w, h, d) {
  const corners = [
    [x, y, z],
    [x, y, z + d],
    [x, y + h, z],
    [x, y + h, z + d],
    [x + w, y, z],
    [x + w, y, z + d],
    [x + w, y + h, z],
    [x + w, y + h, z + d],
  ];
  const edges = [
    [0, 2],
    [2, 6],
    [6, 4],
    [4, 0], // bottom (z=0)
    [1, 3],
    [3, 7],
    [7, 5],
    [5, 1], // top (z=d)
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7], // verticals
  ];
  for (const [a, b] of edges) {
    const pa = view.def.project(corners[a], view);
    const pb = view.def.project(corners[b], view);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", pa[0]);
    line.setAttribute("y1", pa[1]);
    line.setAttribute("x2", pb[0]);
    line.setAttribute("y2", pb[1]);
    line.setAttribute("class", "wireframe-edge");
    view.zoomGroup.appendChild(line);
  }
}

function drawSilhouetteRect(view, uMin, uMax, vMin, vMax) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", uMin);
  r.setAttribute("y", vMin);
  r.setAttribute("width", uMax - uMin);
  r.setAttribute("height", vMax - vMin);
  r.setAttribute("class", "toldo-base");
  view.zoomGroup.appendChild(r);
}

// ---------- Rulers ----------

function drawHorizontalRuler(view, leftPx, rightPx, vAtTopPx) {
  const ruler = document.createElementNS(SVG_NS, "g");
  ruler.setAttribute("class", "ruler");

  const rulerY = vAtTopPx - 18;
  const totalUnits = (rightPx - leftPx) / config.pxPerUnit;
  const minorStep = 0.5;
  const eps = 1e-6;

  const baseline = document.createElementNS(SVG_NS, "line");
  baseline.setAttribute("x1", leftPx);
  baseline.setAttribute("y1", rulerY);
  baseline.setAttribute("x2", rightPx);
  baseline.setAttribute("y2", rulerY);
  baseline.setAttribute("class", "ruler-baseline");
  ruler.appendChild(baseline);

  const tickAt = (u, kind) => {
    const x = leftPx + u * config.pxPerUnit;
    const len = kind === "minor" ? 4 : 8;
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", x);
    tick.setAttribute("y1", rulerY);
    tick.setAttribute("x2", x);
    tick.setAttribute("y2", rulerY + len);
    tick.setAttribute("class", `ruler-tick-${kind}`);
    ruler.appendChild(tick);
    if (kind !== "minor") {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", x);
      label.setAttribute("y", rulerY - 4);
      label.setAttribute("class", "ruler-label");
      label.textContent = Number.isInteger(u) ? String(u) : u.toFixed(1);
      ruler.appendChild(label);
    }
  };

  for (let u = 0; u <= totalUnits + eps; u += minorStep) {
    const isMajor = Math.abs(u - Math.round(u)) < eps;
    tickAt(u, isMajor ? "major" : "minor");
  }
  const remainder = totalUnits - Math.floor(totalUnits / minorStep) * minorStep;
  if (remainder > eps && remainder < minorStep - eps) {
    tickAt(totalUnits, "edge");
  }

  view.zoomGroup.appendChild(ruler);
}

function drawVerticalRulerFromTop(view, topPx, bottomPx, shapeRightPx) {
  // Top-view Y ruler: 0 at the top edge of the L-shape, increasing
  // downward to bboxH/pxPerUnit at the bottom.
  const totalUnits = (bottomPx - topPx) / config.pxPerUnit;
  drawVerticalRulerLine(
    view,
    shapeRightPx + 18,
    topPx,
    bottomPx,
    0,
    totalUnits,
  );
}

// Z ruler for front/side views: shows Z values from a fixed +4 at the top
// down to 0 at the ground line.
function drawZRuler(view, shapeRightPx) {
  const zMax = 4;
  const topPx = -zMax * config.pxPerUnit;
  const bottomPx = 0;
  drawVerticalRulerLine(view, shapeRightPx + 18, topPx, bottomPx, zMax, 0);
}

// Generic vertical ruler. labelTop is the value at the top of the ruler
// (smallest screen v), labelBottom at the bottom (largest screen v).
function drawVerticalRulerLine(
  view,
  rulerX,
  topPx,
  bottomPx,
  labelTop,
  labelBottom,
) {
  const ruler = document.createElementNS(SVG_NS, "g");
  ruler.setAttribute("class", "ruler");
  const totalUnits = (bottomPx - topPx) / config.pxPerUnit;
  const minorStep = 0.5;
  const eps = 1e-6;

  const baseline = document.createElementNS(SVG_NS, "line");
  baseline.setAttribute("x1", rulerX);
  baseline.setAttribute("y1", topPx);
  baseline.setAttribute("x2", rulerX);
  baseline.setAttribute("y2", bottomPx);
  baseline.setAttribute("class", "ruler-baseline");
  ruler.appendChild(baseline);

  const tickAt = (u, kind) => {
    const y = topPx + u * config.pxPerUnit;
    const len = kind === "minor" ? 4 : 8;
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", rulerX);
    tick.setAttribute("y1", y);
    tick.setAttribute("x2", rulerX - len);
    tick.setAttribute("y2", y);
    tick.setAttribute("class", `ruler-tick-${kind}`);
    ruler.appendChild(tick);
    if (kind !== "minor") {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", rulerX + 4);
      label.setAttribute("y", y);
      label.setAttribute("class", "ruler-label ruler-label-v");
      const t = totalUnits === 0 ? 0 : u / totalUnits;
      const value = labelTop + (labelBottom - labelTop) * t;
      label.textContent = Number.isInteger(value)
        ? String(value)
        : value.toFixed(1);
      ruler.appendChild(label);
    }
  };

  for (let u = 0; u <= totalUnits + eps; u += minorStep) {
    const isMajor = Math.abs(u - Math.round(u)) < eps;
    tickAt(u, isMajor ? "major" : "minor");
  }
  const remainder = totalUnits - Math.floor(totalUnits / minorStep) * minorStep;
  if (remainder > eps && remainder < minorStep - eps) {
    tickAt(totalUnits, "edge");
  }

  view.zoomGroup.appendChild(ruler);
}

// ---------- Triangle geometry ----------

function trianglePoints(size) {
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

function pointsRadius(points) {
  return Math.max(...points.map(([x, y]) => Math.hypot(x, y)));
}

function pointsToString(points) {
  return points.map((p) => `${p[0]},${p[1]}`).join(" ");
}

// Pick the local apex used to anchor the rotate handle. We use the
// vertex with the smallest local y (the "top" in the un-rotated frame).
function localApex(points) {
  return points.reduce((best, p) => (p[1] < best[1] ? p : best), points[0]);
}

// ---------- Adding triangles ----------

function addTriangle() {
  if (!state.selectedSizeId) return;
  const size = config.triangleSizes.find((s) => s.id === state.selectedSizeId);
  if (!size) return;

  const points = trianglePoints(size);
  // Drop near the center of the L-shape (which is at world origin).
  const item = {
    id: state.nextId++,
    sizeId: size.id,
    x: 0,
    y: 0,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    points,
    radius: pointsRadius(points),
    apex: localApex(points),
    viewParts: {},
  };
  state.items.push(item);
  drawTriangleAllViews(item);
  refreshItemList();
  autosave();
}

// ---------- Triangle drawing ----------

function drawTriangleAllViews(item) {
  for (const key of VIEW_KEYS) {
    drawTriangleInView(item, views[key]);
  }
  updateTriangleRender(item);
}

function drawTriangleInView(item, view) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("data-id", item.id);
  g.setAttribute("data-view", view.key);

  const poly = document.createElementNS(SVG_NS, "polygon");
  poly.setAttribute("class", "triangle-shape");
  g.appendChild(poly);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "triangle-label");
  label.textContent = item.sizeId;
  g.appendChild(label);

  // Rotate handle.
  const rotateGroup = document.createElementNS(SVG_NS, "g");
  rotateGroup.setAttribute("class", "rotate-handle");
  rotateGroup.style.display = "none";

  const stem = document.createElementNS(SVG_NS, "line");
  stem.setAttribute("class", "rotate-handle-stem");
  rotateGroup.appendChild(stem);

  const knob = document.createElementNS(SVG_NS, "circle");
  knob.setAttribute("r", 9);
  knob.setAttribute("class", "rotate-handle-knob");
  rotateGroup.appendChild(knob);

  const rotateIcon = document.createElementNS(SVG_NS, "path");
  rotateIcon.setAttribute("class", "rotate-handle-icon");
  rotateGroup.appendChild(rotateIcon);

  g.appendChild(rotateGroup);

  // Delete handle.
  const deleteGroup = document.createElementNS(SVG_NS, "g");
  deleteGroup.setAttribute("class", "delete-handle");
  deleteGroup.style.display = "none";

  const deleteCircle = document.createElementNS(SVG_NS, "circle");
  deleteCircle.setAttribute("r", 9);
  deleteCircle.setAttribute("class", "delete-handle-bg");
  deleteGroup.appendChild(deleteCircle);

  const deleteIcon = document.createElementNS(SVG_NS, "path");
  deleteIcon.setAttribute("class", "delete-handle-icon");
  deleteGroup.appendChild(deleteIcon);

  g.appendChild(deleteGroup);

  // Edit handlers only fire in views that allow editing. The 3D preview
  // is read-only — pointer events fall through to the canvas and become
  // an orbit drag.
  if (view.def.editable) {
    g.addEventListener("pointerdown", (e) =>
      onTrianglePointerDown(e, item, view),
    );
    rotateGroup.addEventListener("pointerdown", (e) =>
      onRotateHandlePointerDown(e, item, view),
    );
    deleteGroup.addEventListener("pointerdown", (e) =>
      onDeletePointerDown(e, item),
    );
  } else {
    g.style.pointerEvents = "none";
  }

  view.zoomGroup.appendChild(g);

  item.viewParts[view.key] = {
    group: g,
    polygon: poly,
    label,
    rotateGroup,
    rotateStem: stem,
    rotateKnob: knob,
    rotateIcon,
    deleteGroup,
    deleteCircle,
    deleteIcon,
  };
}

// Recompute polygon points and handle positions for an item across all views.
function updateTriangleRender(item) {
  for (const key of VIEW_KEYS) {
    updateTriangleInView(item, views[key]);
  }
}

function updateTriangleInView(item, view) {
  const parts = item.viewParts[view.key];
  if (!parts) return;

  // Build the silhouette polygon by projecting all 6 prism vertices and
  // taking the convex hull. In the top view (when rotX/rotY are zero), the
  // hull collapses to the original triangle; in the other views with the
  // triangle flat on the ground, it's a thin parallelogram.
  const prism3D = trianglePrismVertices(item);
  const projAll = prism3D.map((p) => view.def.project(p, view));
  const hull = convexHull(projAll);
  parts.polygon.setAttribute(
    "points",
    hull.map((v) => `${v[0]},${v[1]}`).join(" "),
  );

  // For the rotate-handle and bbox math we still want the projected top
  // face vertices.
  const projVerts = item.points.map((p) =>
    view.def.project(worldVertex(p, item), view),
  );

  const [cu, cv] = view.def.project([item.x, item.y, item.z || 0], view);
  parts.label.setAttribute("x", cu);
  parts.label.setAttribute("y", cv);

  // Rotate handle: at the projected apex, pushed outward from the
  // projected centroid by rotateHandleOffset. If the projection collapses
  // to the centroid (apex sits on the rotation axis), fall back to a fixed
  // offset directly above.
  const apexProj = view.def.project(worldVertex(item.apex, item), view);
  const dx = apexProj[0] - cu;
  const dy = apexProj[1] - cv;
  const len = Math.hypot(dx, dy);
  let hx, hy;
  if (len >= 1) {
    const scale = (len + config.rotateHandleOffset) / len;
    hx = cu + dx * scale;
    hy = cv + dy * scale;
  } else {
    hx = cu;
    hy = cv - config.rotateHandleOffset;
  }
  parts.rotateStem.setAttribute("x1", apexProj[0]);
  parts.rotateStem.setAttribute("y1", apexProj[1]);
  parts.rotateStem.setAttribute("x2", hx);
  parts.rotateStem.setAttribute("y2", hy);
  parts.rotateKnob.setAttribute("cx", hx);
  parts.rotateKnob.setAttribute("cy", hy);
  parts.rotateIcon.setAttribute(
    "d",
    `M ${hx - 4} ${hy - 1}
     A 4 4 0 1 1 ${hx + 4} ${hy + 1}
     M ${hx + 4} ${hy + 1} l -2 -3 m 2 3 l 3 -2`,
  );

  // Delete handle: top-right of the projected bbox, with screen-space offset.
  let minU = projVerts[0][0],
    maxU = projVerts[0][0],
    minV = projVerts[0][1],
    maxV = projVerts[0][1];
  for (const v of projVerts) {
    minU = Math.min(minU, v[0]);
    maxU = Math.max(maxU, v[0]);
    minV = Math.min(minV, v[1]);
    maxV = Math.max(maxV, v[1]);
  }
  const dxOffset = maxU + 14;
  const dyOffset = minV - 14;
  parts.deleteCircle.setAttribute("cx", dxOffset);
  parts.deleteCircle.setAttribute("cy", dyOffset);
  parts.deleteIcon.setAttribute(
    "d",
    `M ${dxOffset - 4} ${dyOffset - 4} L ${dxOffset + 4} ${dyOffset + 4}
     M ${dxOffset + 4} ${dyOffset - 4} L ${dxOffset - 4} ${dyOffset + 4}`,
  );
}

function bringToFront(item) {
  for (const key of VIEW_KEYS) {
    const parts = item.viewParts[key];
    if (parts && parts.group.parentNode) {
      parts.group.parentNode.appendChild(parts.group);
    }
  }
}

function markSelected(item, selected) {
  for (const key of VIEW_KEYS) {
    const parts = item.viewParts[key];
    if (!parts) continue;
    parts.polygon.classList.toggle("selected", selected);
    parts.rotateGroup.style.display = selected ? "" : "none";
    parts.deleteGroup.style.display = selected ? "" : "none";
  }
}

function setSelected(itemId) {
  if (state.selectedItemId === itemId) return;
  if (state.selectedItemId) {
    const prev = state.items.find((i) => i.id === state.selectedItemId);
    if (prev) markSelected(prev, false);
  }
  state.selectedItemId = itemId;
  if (itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (item) {
      markSelected(item, true);
      bringToFront(item);
    }
  }
}

// ---------- Pointer handlers ----------

function clientToWorld(view, clientX, clientY) {
  const rect = view.canvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  return {
    u: (cx - view.panX) / view.zoom,
    v: (cy - view.panY) / view.zoom,
  };
}

function onTrianglePointerDown(e, item, view) {
  if (e.target.closest(".rotate-handle, .delete-handle")) return;
  e.preventDefault();
  e.stopPropagation();

  const pt = clientToWorld(view, e.clientX, e.clientY);
  const [iu, iv] = view.def.itemUV(item);
  state.drag = {
    kind: "move",
    item,
    view,
    startClientX: e.clientX,
    startClientY: e.clientY,
    offsetU: pt.u - iu,
    offsetV: pt.v - iv,
    moved: false,
  };
  bringToFront(item);
  view.canvas.setPointerCapture?.(e.pointerId);
}

function onRotateHandlePointerDown(e, item, view) {
  e.preventDefault();
  e.stopPropagation();
  const pt = clientToWorld(view, e.clientX, e.clientY);
  const [cu, cv] = view.def.project([item.x, item.y, item.z || 0], view);
  const startPointerAngle = Math.atan2(pt.v - cv, pt.u - cu);
  state.drag = {
    kind: "rotate",
    item,
    view,
    startPointerAngle,
    startRotValue: item[view.def.rotAxis] || 0,
  };
  view.canvas.setPointerCapture?.(e.pointerId);
}

function onDeletePointerDown(e, item) {
  e.preventDefault();
  e.stopPropagation();
  removeItem(item.id);
}

function onPointerMove(e) {
  if (!state.drag) return;
  const drag = state.drag;
  const item = drag.item;
  const view = drag.view;

  if (drag.kind === "move") {
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < config.dragThreshold) return;
    if (!drag.moved) {
      drag.moved = true;
      for (const key of VIEW_KEYS) {
        item.viewParts[key]?.polygon.classList.add("dragging");
      }
    }
    const pt = clientToWorld(view, e.clientX, e.clientY);
    view.def.setItemUV(item, pt.u - drag.offsetU, pt.v - drag.offsetV);
    updateTriangleRender(item);
  } else if (drag.kind === "rotate") {
    const pt = clientToWorld(view, e.clientX, e.clientY);
    const [cu, cv] = view.def.project([item.x, item.y, item.z || 0], view);
    const currentAngle = Math.atan2(pt.v - cv, pt.u - cu);
    const deltaRad = currentAngle - drag.startPointerAngle;
    const deltaDeg = (deltaRad * 180) / Math.PI;
    item[view.def.rotAxis] = drag.startRotValue + deltaDeg;
    updateTriangleRender(item);
  } else if (drag.kind === "orbit") {
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    // Negative dx because the projection is mirrored horizontally; this
    // keeps "drag right rotates view right" intuitive.
    view.camera.azimuth = drag.startAzimuth - dx * 0.5;
    view.camera.elevation = Math.max(
      -89,
      Math.min(89, drag.startElevation - dy * 0.5),
    );
    redrawPreview();
  }
}

function onPointerUp(e) {
  if (!state.drag) return;
  const drag = state.drag;
  const item = drag.item;

  if (drag.kind === "move") {
    if (drag.moved) {
      for (const key of VIEW_KEYS) {
        item.viewParts[key]?.polygon.classList.remove("dragging");
      }
      autosave();
    } else {
      setSelected(state.selectedItemId === item.id ? null : item.id);
    }
  } else if (drag.kind === "rotate") {
    autosave();
  } else if (drag.kind === "orbit") {
    scheduleAutosave();
  }
  state.drag = null;
}

function onCanvasPointerDown(e, view) {
  // If the press hits a triangle/handle, those handlers stop propagation.
  // Reaching here means an empty-canvas click → deselect.
  if (state.selectedItemId) setSelected(null);

  // In the 3D preview, dragging the canvas orbits the camera.
  if (view.def === VIEW_DEFS.preview) {
    e.preventDefault();
    state.drag = {
      kind: "orbit",
      view,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startAzimuth: view.camera.azimuth,
      startElevation: view.camera.elevation,
    };
    view.canvas.setPointerCapture?.(e.pointerId);
  }
}

function onCanvasWheel(e, view) {
  e.preventDefault();
  const rect = view.canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const worldX = (cx - view.panX) / view.zoom;
  const worldY = (cy - view.panY) / view.zoom;

  const factor = Math.exp(-e.deltaY * 0.005);
  const newZoom = Math.max(0.2, Math.min(8, view.zoom * factor));
  if (newZoom === view.zoom) return;
  view.zoom = newZoom;
  view.panX = cx - worldX * view.zoom;
  view.panY = cy - worldY * view.zoom;

  applyZoomTransform(view);
  scheduleAutosave();
}

let autosaveTimer = null;
function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    autosave();
  }, 200);
}

// ---------- Item list / removal ----------

function refreshItemList() {
  itemList.innerHTML = "";
  state.items.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>#${item.id} — ${item.sizeId}</span>`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove";
    del.addEventListener("click", () => removeItem(item.id));
    li.appendChild(del);
    itemList.appendChild(li);
  });
}

function removeItem(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx === -1) return;
  const [item] = state.items.splice(idx, 1);
  for (const key of VIEW_KEYS) {
    const parts = item.viewParts?.[key];
    if (parts && parts.group.parentNode) {
      parts.group.parentNode.removeChild(parts.group);
    }
  }
  if (state.selectedItemId === id) state.selectedItemId = null;
  refreshItemList();
  autosave();
}

// ---------- Redraw ----------

function redraw() {
  computeBaseGeometry();
  for (const key of VIEW_KEYS) {
    const view = views[key];
    viewBoxForCanvas(view);
    clearView(view);
    centerViewIfDefault(view);
    view.def.drawBase(view);
  }
  state.items.forEach(drawTriangleAllViews);
}

// Re-render only the preview view. Used while orbiting the camera.
function redrawPreview() {
  const view = views.preview;
  if (!view) return;
  clearView(view);
  view.def.drawBase(view);
  state.items.forEach((item) => {
    drawTriangleInView(item, view);
    updateTriangleInView(item, view);
  });
  if (state.selectedItemId) {
    const sel = state.items.find((i) => i.id === state.selectedItemId);
    if (sel) {
      const parts = sel.viewParts.preview;
      if (parts) parts.polygon.classList.add("selected");
    }
  }
}

// ---------- Saved designs ----------

function loadDesigns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistDesigns(designs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
}

function serializeDesign() {
  return {
    items: state.items.map((i) => ({
      sizeId: i.sizeId,
      x: i.x,
      y: i.y,
      z: i.z,
      rotX: i.rotX,
      rotY: i.rotY,
      rotZ: i.rotZ,
    })),
    views: VIEW_KEYS.reduce((acc, key) => {
      const v = views[key];
      const entry = { zoom: v.zoom, panX: v.panX, panY: v.panY };
      if (v.def === VIEW_DEFS.preview) {
        entry.azimuth = v.camera.azimuth;
        entry.elevation = v.camera.elevation;
      }
      acc[key] = entry;
      return acc;
    }, {}),
  };
}

function restoreDesign(saved) {
  // Accept three formats:
  //   1) bare items array (very old)
  //   2) { items, zoom, panX, panY } (single-view 2D era)
  //   3) { items, views: { top, front, side } } (current 3D)
  const data = Array.isArray(saved) ? { items: saved } : saved || {};
  if (Array.isArray(data.items)) {
    data.items.forEach((s) => {
      const size = config.triangleSizes.find((sz) => sz.id === s.sizeId);
      if (!size) return;
      const points = trianglePoints(size);
      const item = {
        id: state.nextId++,
        sizeId: s.sizeId,
        x: s.x ?? 0,
        y: s.y ?? 0,
        z: s.z ?? 0,
        rotX: s.rotX ?? 0,
        rotY: s.rotY ?? 0,
        rotZ: s.rotZ ?? s.rotation ?? 0,
        points,
        radius: pointsRadius(points),
        apex: localApex(points),
        viewParts: {},
      };
      state.items.push(item);
      drawTriangleAllViews(item);
    });
  }
  if (data.views) {
    for (const key of VIEW_KEYS) {
      const v = data.views[key];
      if (v) {
        if (typeof v.zoom === "number") views[key].zoom = v.zoom;
        if (typeof v.panX === "number") views[key].panX = v.panX;
        if (typeof v.panY === "number") views[key].panY = v.panY;
        if (typeof v.azimuth === "number")
          views[key].camera.azimuth = v.azimuth;
        if (typeof v.elevation === "number")
          views[key].camera.elevation = v.elevation;
        applyZoomTransform(views[key]);
      }
    }
  } else if (
    typeof data.zoom === "number" ||
    typeof data.panX === "number" ||
    typeof data.panY === "number"
  ) {
    // Legacy single-view zoom: apply to top view only.
    if (typeof data.zoom === "number") views.top.zoom = data.zoom;
    if (typeof data.panX === "number") views.top.panX = data.panX;
    if (typeof data.panY === "number") views.top.panY = data.panY;
    applyZoomTransform(views.top);
  }
  refreshItemList();
  // The preview triangles were drawn with the default camera; re-render
  // now that any restored camera angles are applied.
  redrawPreview();
}

function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeDesign()));
  } catch {}
}

function restoreAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    restoreDesign(JSON.parse(raw));
  } catch {}
}

function clearItems() {
  state.items.forEach((item) => {
    for (const key of VIEW_KEYS) {
      const parts = item.viewParts?.[key];
      if (parts && parts.group.parentNode) {
        parts.group.parentNode.removeChild(parts.group);
      }
    }
  });
  state.items = [];
  state.selectedItemId = null;
  state.nextId = 1;
  refreshItemList();
}

function saveCurrentDesign() {
  const name = prompt("Name this design:");
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const designs = loadDesigns();
  if (
    designs[trimmed] &&
    !confirm(`A design named "${trimmed}" already exists. Overwrite it?`)
  ) {
    return;
  }
  designs[trimmed] = {
    ...serializeDesign(),
    savedAt: new Date().toISOString(),
  };
  persistDesigns(designs);
  state.currentDesignName = trimmed;
  refreshDesignList();
}

function loadDesign(name) {
  const designs = loadDesigns();
  const design = designs[name];
  if (!design) return;
  if (
    state.items.length > 0 &&
    !confirm(`Loading "${name}" will discard the current design. Continue?`)
  ) {
    return;
  }
  clearItems();
  restoreDesign(design);
  state.currentDesignName = name;
  autosave();
}

function deleteDesign(name) {
  if (!confirm(`Delete saved design "${name}"? This cannot be undone.`)) return;
  const designs = loadDesigns();
  delete designs[name];
  persistDesigns(designs);
  refreshDesignList();
}

function refreshDesignList() {
  const designs = loadDesigns();
  designList.innerHTML = "";
  const names = Object.keys(designs).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No saved designs yet";
    designList.appendChild(empty);
    return;
  }
  names.forEach((name) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = name;
    span.title = `Saved ${new Date(designs[name].savedAt).toLocaleString()} — click to load`;
    li.appendChild(span);
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDesign(name);
    });
    li.appendChild(del);
    li.addEventListener("click", () => loadDesign(name));
    designList.appendChild(li);
  });
}

// ---------- Export / Import ----------

function exportCurrentDesign() {
  const defaultName = state.currentDesignName || "untitled";
  const promptInput = prompt("Name for the exported design:", defaultName);
  if (promptInput === null) return; // user cancelled
  const name = promptInput.trim() || defaultName;
  state.currentDesignName = name;

  const data = serializeDesign();
  data.name = name;
  data.exportedAt = new Date().toISOString();
  data.format = "toldo-design-v1";
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Sanitize for filesystem: replace whitespace with dashes and drop
  // characters that aren't safe across operating systems.
  const safeName =
    name
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9._\-]/g, "")
      .slice(0, 80) || "design";
  a.download = `toldo-${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importDesignFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      alert(`Could not parse the file as JSON: ${err.message}`);
      return;
    }
    if (
      state.items.length > 0 &&
      !confirm("Importing will replace the current design. Continue?")
    ) {
      return;
    }
    clearItems();
    restoreDesign(data);
    if (typeof data.name === "string" && data.name.trim()) {
      state.currentDesignName = data.name.trim();
    }
    autosave();
  };
  reader.onerror = () => {
    alert("Could not read the file.");
  };
  reader.readAsText(file);
}

// ---------- Wire it up ----------

addBtn.addEventListener("click", addTriangle);
saveBtn.addEventListener("click", saveCurrentDesign);
exportBtn.addEventListener("click", exportCurrentDesign);
importBtn.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importDesignFromFile(file);
  // Reset so picking the same file again still fires "change".
  e.target.value = "";
});
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("resize", redraw);

setupViews();
buildSizeList();
refreshDesignList();
redraw();
restoreAutosave();
