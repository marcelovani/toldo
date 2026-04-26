// All canvas pointer and wheel handlers. These are the mutating
// counterparts to the per-view rendering: they update state.drag, mutate
// item world coordinates, and call back into triangle/views to re-render.

import { VIEW_KEYS, config } from "./config.js";
import { autosave, scheduleAutosave } from "./persistence.js";
import { state, views } from "./state.js";
import {
  bringToFront,
  removeItem,
  setSelected,
  updateTriangleRender,
} from "./triangle.js";
import { VIEW_DEFS, applyZoomTransform, redrawPreview } from "./views.js";

// Map a client (mouse) coordinate to the zoomed/panned world space that
// triangle x/y/z values live in.
export function clientToWorld(view, clientX, clientY) {
  const rect = view.canvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  return {
    u: (cx - view.panX) / view.zoom,
    v: (cy - view.panY) / view.zoom,
  };
}

export function onTrianglePointerDown(e, item, view) {
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

export function onRotateHandlePointerDown(e, item, view) {
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

export function onDeletePointerDown(e, item) {
  e.preventDefault();
  e.stopPropagation();
  removeItem(item.id);
}

export function onPointerMove(e) {
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
    view.camera.azimuth = drag.startAzimuth + dx * 0.5;
    view.camera.elevation = Math.max(
      -89,
      Math.min(89, drag.startElevation - dy * 0.5),
    );
    redrawPreview();
  }
}

export function onPointerUp() {
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

export function onCanvasPointerDown(e, view) {
  // Empty-canvas press → deselect (triangle/handle handlers stop
  // propagation, so reaching here means the press was on background).
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

export function onCanvasWheel(e, view) {
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

// Attach per-canvas pointer + wheel listeners after setupViews has
// populated the views object. Kept separate from setupViews() so views.js
// doesn't have to depend on this module (one-way import only).
export function attachInteractions() {
  for (const key of VIEW_KEYS) {
    const view = views[key];
    if (!view) continue;
    view.canvas.addEventListener("pointerdown", (e) =>
      onCanvasPointerDown(e, view),
    );
    view.canvas.addEventListener("wheel", (e) => onCanvasWheel(e, view), {
      passive: false,
    });
  }
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}
