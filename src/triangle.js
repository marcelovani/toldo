// SVG drawing and lifecycle for triangle items: per-view groups,
// silhouette polygon (convex hull of the prism vertices), rotate/delete
// handles, selection, and the high-level add/remove operations.

import { SVG_NS, VIEW_KEYS, config } from "./config.js";
import {
  localApex,
  pointsRadius,
  trianglePoints,
  trianglePrismVertices,
} from "./geometry.js";
import {
  onDeletePointerDown,
  onRotateHandlePointerDown,
  onTrianglePointerDown,
} from "./interactions.js";
import { convexHull, worldVertex } from "./math.js";
import { autosave } from "./persistence.js";
import { refreshItemList } from "./sidebar.js";
import { state, views } from "./state.js";

// ---------- Operations ----------

export function addTriangle() {
  if (!state.selectedSizeId) return;
  const size = config.triangleSizes.find((s) => s.id === state.selectedSizeId);
  if (!size) return;

  const points = trianglePoints(size);
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

export function removeItem(id) {
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

// ---------- Drawing ----------

export function drawTriangleAllViews(item) {
  for (const key of VIEW_KEYS) {
    drawTriangleInView(item, views[key]);
  }
  updateTriangleRender(item);
}

export function drawTriangleInView(item, view) {
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
export function updateTriangleRender(item) {
  for (const key of VIEW_KEYS) {
    updateTriangleInView(item, views[key]);
  }
}

export function updateTriangleInView(item, view) {
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

  // Top-face vertices for handle positioning + bbox.
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

// ---------- Selection ----------

export function bringToFront(item) {
  for (const key of VIEW_KEYS) {
    const parts = item.viewParts[key];
    if (parts && parts.group.parentNode) {
      parts.group.parentNode.appendChild(parts.group);
    }
  }
}

export function markSelected(item, selected) {
  for (const key of VIEW_KEYS) {
    const parts = item.viewParts[key];
    if (!parts) continue;
    parts.polygon.classList.toggle("selected", selected);
    parts.rotateGroup.style.display = selected ? "" : "none";
    parts.deleteGroup.style.display = selected ? "" : "none";
  }
}

export function setSelected(itemId) {
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
