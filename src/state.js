// Single shared mutable runtime state. Other modules import these
// objects directly and mutate fields on them; the bindings themselves
// (state, views) are stable across the lifetime of the app.

export const state = {
  selectedSizeId: null,
  // Each item: { id, sizeId, x, y, z, rotX, rotY, rotZ, points, radius,
  //              apex, viewParts: { top, front, side, preview } }
  items: [],
  nextId: 1,
  selectedItemId: null,
  // Active drag operation, one of { kind: "move" | "rotate" | "orbit", ... }
  drag: null,
  // L-shape bbox in pixel coordinates, computed from config by
  // geometry.computeBaseGeometry on each redraw.
  baseBbox: null,
  // Current named/loaded design — used as the default when prompting for an
  // export or save name.
  currentDesignName: null,
  // Per-design display options. Persisted alongside items so each design
  // remembers its own view settings.
  display: {
    trianglesOpaque: false,
  },
};

// Per-view runtime, keyed by the view name (top, front, side, preview).
// Each entry: { key, canvas, zoomGroup, zoom, panX, panY, def, camera }.
export const views = {};
