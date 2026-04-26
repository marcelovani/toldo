// Persistence: serialise/restore the full design state, named saved
// designs in localStorage, and an autosave that mirrors the canvas on
// every change.

import { AUTOSAVE_KEY, STORAGE_KEY, VIEW_KEYS, config } from "./config.js";
import { localApex, pointsRadius, trianglePoints } from "./geometry.js";
import { refreshDesignList, refreshItemList } from "./sidebar.js";
import { state, views } from "./state.js";
import { applyDisplayOptions } from "./tools.js";
import { drawTriangleAllViews } from "./triangle.js";
import { VIEW_DEFS, applyZoomTransform, redrawPreview } from "./views.js";

// ---------- Named designs ----------

export function loadDesigns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function persistDesigns(designs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
}

export function saveCurrentDesign() {
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

export function loadDesign(name) {
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

export function deleteDesign(name) {
  if (!confirm(`Delete saved design "${name}"? This cannot be undone.`)) return;
  const designs = loadDesigns();
  delete designs[name];
  persistDesigns(designs);
  refreshDesignList();
}

// ---------- Serialise / restore ----------

export function serializeDesign() {
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
    display: { ...state.display },
  };
}

// Accept three formats for backwards compatibility:
//   1) bare items array (very old)
//   2) { items, zoom, panX, panY } (single-view 2D era)
//   3) { items, views: { top, front, side, preview } } (current 3D)
export function restoreDesign(saved) {
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
  if (data.display) {
    if (typeof data.display.trianglesOpaque === "boolean") {
      state.display.trianglesOpaque = data.display.trianglesOpaque;
    }
  }
  applyDisplayOptions();
  refreshItemList();
  // The preview triangles were drawn with the default camera; re-render
  // now that any restored camera angles are applied.
  redrawPreview();
}

export function clearItems() {
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

// ---------- Autosave ----------

export function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeDesign()));
  } catch {
    // localStorage may be full or disabled; silently drop.
  }
}

export function restoreAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    restoreDesign(JSON.parse(raw));
  } catch {
    // Bad JSON or missing — ignore.
  }
}

// Debounced autosave used during continuous interactions (zoom, orbit) so
// fast wheel scrolls don't hammer localStorage.
let autosaveTimer = null;
export function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    autosave();
  }, 200);
}
