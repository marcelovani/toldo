// SVG drawing for the L-shape base in each view, plus rulers and the 3D
// preview's wireframe boxes. None of these functions touch state.items;
// they read state.baseBbox (set by app/views before each redraw).

import { SVG_NS, config } from "./config.js";
import { state } from "./state.js";

// Top view: actual filled rectangles for the L-shape, plus rulers along
// the top and right edges of the bbox.
export function drawBaseTop(view) {
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

// Front view (X-Z): the two extruded boxes' silhouette merges into a
// single rectangle (the union of their X-Z extents).
export function drawBaseFront(view) {
  const b = state.baseBbox;
  const xMin = b.rect1.x;
  const xMax = b.anchorX;
  const heightPx = config.rectHeight * config.pxPerUnit;
  drawSilhouetteRect(view, xMin, xMax, -heightPx, 0);
  drawHorizontalRuler(view, xMin, xMax, -heightPx);
  drawZRuler(view, xMax);
}

export function drawBaseSide(view) {
  const b = state.baseBbox;
  const yMin = b.anchorY;
  const yMax = b.anchorY + b.bboxH;
  const heightPx = config.rectHeight * config.pxPerUnit;
  drawSilhouetteRect(view, yMin, yMax, -heightPx, 0);
  drawHorizontalRuler(view, yMin, yMax, -heightPx);
  drawZRuler(view, yMax);
}

// 3D preview: render each box as 12 wireframe edges through the view's
// projection (so the preview's camera angles flow through automatically).
export function drawBasePreview(view) {
  const b = state.baseBbox;
  const heightPx = config.rectHeight * config.pxPerUnit;
  drawBoxWireframe(
    view,
    b.rect1.x,
    b.rect1.y,
    0,
    b.rect1.w,
    b.rect1.h,
    heightPx,
  );
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

function drawSilhouetteRect(view, uMin, uMax, vMin, vMax) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", uMin);
  r.setAttribute("y", vMin);
  r.setAttribute("width", uMax - uMin);
  r.setAttribute("height", vMax - vMin);
  r.setAttribute("class", "toldo-base");
  view.zoomGroup.appendChild(r);
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
