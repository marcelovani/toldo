// Constants and tunable parameters. No imports — this is a leaf module.

export const SVG_NS = "http://www.w3.org/2000/svg";

export const config = {
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
  rectangleSizes: [
    { id: "2x3", w: 2, h: 3 },
    { id: "3x4", w: 3, h: 4 },
  ],
  rotateHandleOffset: 28,
  dragThreshold: 4,
  rectHeight: 2.4, // L-shape extruded height (Z) in units
  triangleThickness: 0.1, // triangle slab thickness in units
};

export const STORAGE_KEY = "toldo:designs";
export const AUTOSAVE_KEY = "toldo:autosave";

// Order matters: app.js iterates VIEW_KEYS to set up canvases, draw,
// serialize, etc. Adding a view = add the canvas in HTML and add its key
// here.
export const VIEW_KEYS = ["top", "front", "side", "preview"];
