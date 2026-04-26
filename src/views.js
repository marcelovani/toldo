// Per-view setup, projection definitions, zoom/pan handling, and
// top-level redraw orchestration. VIEW_DEFS lives here because it ties
// projection + base drawing together for each viewport.

import {
  drawBaseFront,
  drawBasePreview,
  drawBaseSide,
  drawBaseTop,
} from "./base-render.js";
import { SVG_NS, VIEW_KEYS } from "./config.js";
import { computeBaseGeometry } from "./geometry.js";
import { projectPreview } from "./math.js";
import { state, views } from "./state.js";
import {
  drawTriangleAllViews,
  drawTriangleInView,
  updateTriangleInView,
} from "./triangle.js";

// Each view sees the world through a different orthographic projection
// and edits a specific subset of the triangle's world coordinates and
// rotation.
export const VIEW_DEFS = {
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

// Build the view runtime object for each canvas in the DOM. Pointer/wheel
// listeners are attached separately by interactions.attachInteractions(),
// so this module doesn't have to import interactions.
export function setupViews() {
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
      // Camera is only consulted by the preview view's projection; other
      // views ignore it.
      camera: { azimuth: 30, elevation: 25 },
    };
  });
}

export function clearView(view) {
  const { canvas } = view;
  while (canvas.firstChild) canvas.removeChild(canvas.firstChild);
  view.zoomGroup = document.createElementNS(SVG_NS, "g");
  view.zoomGroup.setAttribute("class", "zoom-group");
  applyZoomTransform(view);
  canvas.appendChild(view.zoomGroup);
}

export function applyZoomTransform(view) {
  if (!view.zoomGroup) return;
  view.zoomGroup.setAttribute(
    "transform",
    `translate(${view.panX} ${view.panY}) scale(${view.zoom})`,
  );
}

export function viewBoxForCanvas(view) {
  const rect = view.canvas.getBoundingClientRect();
  view.canvas.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  return rect;
}

// Centre the world origin (which is the L-shape's centre) in this view's
// canvas if pan/zoom haven't been customised yet.
export function centerViewIfDefault(view) {
  if (view.panX !== 0 || view.panY !== 0 || view.zoom !== 1) return;
  const rect = view.canvas.getBoundingClientRect();
  view.panX = rect.width / 2;
  view.panY = rect.height / 2;
  applyZoomTransform(view);
}

// Full re-render: recompute base geometry, clear/reset every viewport,
// redraw the L-shape, and redraw every triangle in every view. Called on
// boot and on window resize.
export function redraw() {
  state.baseBbox = computeBaseGeometry();
  for (const key of VIEW_KEYS) {
    const view = views[key];
    viewBoxForCanvas(view);
    clearView(view);
    centerViewIfDefault(view);
    view.def.drawBase(view);
  }
  state.items.forEach(drawTriangleAllViews);
}

// Re-render only the preview view. Used while orbiting the camera so we
// don't re-draw the orthographic views every frame.
export function redrawPreview() {
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
