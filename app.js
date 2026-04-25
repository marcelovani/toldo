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
  rotateHandleOffset: 28, // px above the triangle's bounding circle
  dragThreshold: 4, // px before a pointerdown becomes a drag
};

const state = {
  selectedSizeId: null,
  items: [], // { id, sizeId, x, y, rotation, points, radius, element, polygon, handle }
  nextId: 1,
  base: null,
  selectedItemId: null,
  drag: null, // { kind: "move" | "rotate", item, ... }
};

const STORAGE_KEY = "toldo:designs";
const AUTOSAVE_KEY = "toldo:autosave";

const canvas = document.getElementById("canvas");
const sizeList = document.getElementById("size-list");
const addBtn = document.getElementById("add-btn");
const itemList = document.getElementById("item-list");
const scaleLabel = document.getElementById("scale-label");
const saveBtn = document.getElementById("save-btn");
const designList = document.getElementById("design-list");

scaleLabel.textContent = config.pxPerUnit;
document.getElementById("rect1-label").textContent =
  `${config.rect1.w} × ${config.rect1.h}`;
document.getElementById("rect2-label").textContent =
  `${config.rect2.w} × ${config.rect2.h}`;

function unitsToPx(u) {
  return u * config.pxPerUnit;
}

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

function clearCanvas() {
  while (canvas.firstChild) canvas.removeChild(canvas.firstChild);
}

function drawBase() {
  const stage = canvas.getBoundingClientRect();
  canvas.setAttribute("viewBox", `0 0 ${stage.width} ${stage.height}`);

  const r1w = unitsToPx(config.rect1.w);
  const r1h = unitsToPx(config.rect1.h);
  const r2w = unitsToPx(config.rect2.w);
  const r2h = unitsToPx(config.rect2.h);

  // Combined bounding box: width = widest of (rect1, rotated-rect2),
  // height = tallest of the two. After 90° rotation, rect2's visible
  // dimensions are (h, w).
  const bboxW = Math.max(r1w, r2h);
  const bboxH = Math.max(r1h, r2w);

  // Center the bbox in the canvas. The shared top-right corner sits at
  // (bboxLeft + bboxW, bboxTop).
  const bboxLeft = (stage.width - bboxW) / 2;
  const bboxTop = (stage.height - bboxH) / 2;
  const anchorX = bboxLeft + bboxW;
  const anchorY = bboxTop;

  const rect1 = { x: anchorX - r1w, y: anchorY, w: r1w, h: r1h };
  const rect2 = { x: anchorX, y: anchorY, w: r2w, h: r2h };

  state.base = { anchorX, anchorY, rect1, rect2 };

  const r1 = document.createElementNS(SVG_NS, "rect");
  r1.setAttribute("x", rect1.x);
  r1.setAttribute("y", rect1.y);
  r1.setAttribute("width", rect1.w);
  r1.setAttribute("height", rect1.h);
  r1.setAttribute("class", "toldo-base");
  canvas.appendChild(r1);

  const r2 = document.createElementNS(SVG_NS, "rect");
  r2.setAttribute("x", rect2.x);
  r2.setAttribute("y", rect2.y);
  r2.setAttribute("width", rect2.w);
  r2.setAttribute("height", rect2.h);
  r2.setAttribute("class", "toldo-base");
  r2.setAttribute("transform", `rotate(90 ${anchorX} ${anchorY})`);
  canvas.appendChild(r2);

  drawRuler(bboxLeft, anchorX, anchorY);
  drawVerticalRuler(anchorY, bboxTop + bboxH, anchorX);
}

function drawRuler(leftPx, rightPx, shapeTopPx) {
  const ruler = document.createElementNS(SVG_NS, "g");
  ruler.setAttribute("class", "ruler");

  const rulerY = shapeTopPx - 18;
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
    const len = kind === "major" ? 8 : kind === "edge" ? 8 : 4;
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", x);
    tick.setAttribute("y1", rulerY);
    tick.setAttribute("x2", x);
    tick.setAttribute("y2", rulerY + len);
    tick.setAttribute("class", `ruler-tick-${kind}`);
    ruler.appendChild(tick);
    if (kind === "major" || kind === "edge") {
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
  // Draw an explicit edge tick if the right edge isn't on the minor grid.
  const remainder = totalUnits - Math.floor(totalUnits / minorStep) * minorStep;
  if (remainder > eps && remainder < minorStep - eps) {
    tickAt(totalUnits, "edge");
  }

  canvas.appendChild(ruler);
}

function drawVerticalRuler(topPx, bottomPx, shapeRightPx) {
  const ruler = document.createElementNS(SVG_NS, "g");
  ruler.setAttribute("class", "ruler");

  const rulerX = shapeRightPx + 18;
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
    const len = kind === "major" ? 8 : kind === "edge" ? 8 : 4;
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", rulerX);
    tick.setAttribute("y1", y);
    tick.setAttribute("x2", rulerX - len);
    tick.setAttribute("y2", y);
    tick.setAttribute("class", `ruler-tick-${kind}`);
    ruler.appendChild(tick);
    if (kind === "major" || kind === "edge") {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", rulerX + 4);
      label.setAttribute("y", y);
      label.setAttribute("class", "ruler-label ruler-label-v");
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

  canvas.appendChild(ruler);
}

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

function addTriangle() {
  if (!state.selectedSizeId) return;
  const size = config.triangleSizes.find((s) => s.id === state.selectedSizeId);
  if (!size) return;

  const points = trianglePoints(size);
  const dropX = state.base.rect1.x + state.base.rect1.w / 2;
  const dropY = state.base.rect1.y + state.base.rect1.h / 2;

  const item = {
    id: state.nextId++,
    sizeId: size.id,
    x: dropX,
    y: dropY,
    rotation: 0,
    points,
    radius: pointsRadius(points),
  };
  state.items.push(item);
  drawTriangle(item);
  refreshItemList();
  autosave();
}

function applyTransform(item) {
  item.element.setAttribute("transform", `translate(${item.x} ${item.y})`);
  item.inner.setAttribute("transform", `rotate(${item.rotation})`);
}

function drawTriangle(item) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("data-id", item.id);

  // Inner group rotates; outer group only translates. Handles live on the
  // outer group so they keep a stable screen-space position regardless of
  // the triangle's rotation.
  const inner = document.createElementNS(SVG_NS, "g");
  g.appendChild(inner);

  const poly = document.createElementNS(SVG_NS, "polygon");
  poly.setAttribute("points", pointsToString(item.points));
  poly.setAttribute("class", "triangle-shape");
  inner.appendChild(poly);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "triangle-label");
  label.setAttribute("x", 0);
  label.setAttribute("y", 0);
  label.textContent = item.sizeId;
  inner.appendChild(label);

  // Rotation handle — placed at the triangle's apex (top corner in the
  // un-rotated frame) and lives INSIDE the rotated inner group, so it
  // visually rotates with the triangle and always sits at that corner.
  const apex = item.points.reduce(
    (best, p) => (p[1] < best[1] ? p : best),
    item.points[0],
  );
  const rotateGroup = document.createElementNS(SVG_NS, "g");
  rotateGroup.setAttribute("class", "rotate-handle");
  rotateGroup.style.display = "none";

  const handleX = apex[0];
  const handleY = apex[1] - config.rotateHandleOffset;

  const stem = document.createElementNS(SVG_NS, "line");
  stem.setAttribute("x1", apex[0]);
  stem.setAttribute("y1", apex[1]);
  stem.setAttribute("x2", handleX);
  stem.setAttribute("y2", handleY);
  stem.setAttribute("class", "rotate-handle-stem");
  rotateGroup.appendChild(stem);

  const knob = document.createElementNS(SVG_NS, "circle");
  knob.setAttribute("cx", handleX);
  knob.setAttribute("cy", handleY);
  knob.setAttribute("r", 9);
  knob.setAttribute("class", "rotate-handle-knob");
  rotateGroup.appendChild(knob);

  const rotateIcon = document.createElementNS(SVG_NS, "path");
  rotateIcon.setAttribute(
    "d",
    `M ${handleX - 4} ${handleY - 1}
         A 4 4 0 1 1 ${handleX + 4} ${handleY + 1}
         M ${handleX + 4} ${handleY + 1} l -2 -3 m 2 3 l 3 -2`,
  );
  rotateIcon.setAttribute("class", "rotate-handle-icon");
  rotateGroup.appendChild(rotateIcon);

  inner.appendChild(rotateGroup);

  // Remember the un-rotated handle position so we can recover the
  // intended rotation from a pointer position during drag.
  item.handleX = handleX;
  item.handleY = handleY;

  // Delete handle (hidden until selected). Sits at the top-right of the
  // triangle's bounding circle, in screen-space.
  const deleteGroup = document.createElementNS(SVG_NS, "g");
  deleteGroup.setAttribute("class", "delete-handle");
  deleteGroup.style.display = "none";

  const deleteOffset = item.radius + 14;
  const dx = deleteOffset * Math.cos(-Math.PI / 4);
  const dy = deleteOffset * Math.sin(-Math.PI / 4);

  const deleteCircle = document.createElementNS(SVG_NS, "circle");
  deleteCircle.setAttribute("cx", dx);
  deleteCircle.setAttribute("cy", dy);
  deleteCircle.setAttribute("r", 9);
  deleteCircle.setAttribute("class", "delete-handle-bg");
  deleteGroup.appendChild(deleteCircle);

  const deleteIcon = document.createElementNS(SVG_NS, "path");
  deleteIcon.setAttribute(
    "d",
    `M ${dx - 4} ${dy - 4} L ${dx + 4} ${dy + 4}
         M ${dx + 4} ${dy - 4} L ${dx - 4} ${dy + 4}`,
  );
  deleteIcon.setAttribute("class", "delete-handle-icon");
  deleteGroup.appendChild(deleteIcon);

  g.appendChild(deleteGroup);

  item.element = g;
  item.inner = inner;
  item.polygon = poly;
  item.handle = rotateGroup;
  item.deleteHandle = deleteGroup;

  applyTransform(item);

  g.addEventListener("pointerdown", (e) => onTrianglePointerDown(e, item));
  rotateGroup.addEventListener("pointerdown", (e) =>
    onHandlePointerDown(e, item),
  );
  deleteGroup.addEventListener("pointerdown", (e) =>
    onDeletePointerDown(e, item),
  );

  canvas.appendChild(g);

  if (state.selectedItemId === item.id) markSelected(item, true);
}

function bringToFront(item) {
  if (item.element.parentNode) {
    item.element.parentNode.appendChild(item.element);
  }
}

function markSelected(item, selected) {
  item.polygon.classList.toggle("selected", selected);
  item.handle.style.display = selected ? "" : "none";
  item.deleteHandle.style.display = selected ? "" : "none";
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

function onTrianglePointerDown(e, item) {
  // Ignore if the press was on a handle (each has its own handler).
  if (e.target.closest(".rotate-handle, .delete-handle")) return;
  e.preventDefault();
  e.stopPropagation();

  const pt = clientToSvg(e.clientX, e.clientY);
  state.drag = {
    kind: "move",
    item,
    startClientX: e.clientX,
    startClientY: e.clientY,
    offsetX: pt.x - item.x,
    offsetY: pt.y - item.y,
    moved: false,
  };
  bringToFront(item);
  canvas.setPointerCapture?.(e.pointerId);
}

function onHandlePointerDown(e, item) {
  e.preventDefault();
  e.stopPropagation();
  state.drag = {
    kind: "rotate",
    item,
    startRotation: item.rotation,
  };
  canvas.setPointerCapture?.(e.pointerId);
}

function onDeletePointerDown(e, item) {
  e.preventDefault();
  e.stopPropagation();
  removeItem(item.id);
}

function clientToSvg(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function onPointerMove(e) {
  if (!state.drag) return;
  const drag = state.drag;
  const item = drag.item;

  if (drag.kind === "move") {
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < config.dragThreshold) return;
    if (!drag.moved) {
      drag.moved = true;
      item.polygon.classList.add("dragging");
    }
    const pt = clientToSvg(e.clientX, e.clientY);
    item.x = pt.x - drag.offsetX;
    item.y = pt.y - drag.offsetY;
    applyTransform(item);
  } else if (drag.kind === "rotate") {
    const pt = clientToSvg(e.clientX, e.clientY);
    const dx = pt.x - item.x;
    const dy = pt.y - item.y;
    // Solve for θ such that rotating the handle's un-rotated position
    // (handleX, handleY) by θ aligns it with the pointer (dx, dy):
    //   θ = atan2(dy, dx) - atan2(handleY, handleX)
    const pointerAngle = Math.atan2(dy, dx);
    const handleAngle = Math.atan2(item.handleY, item.handleX);
    item.rotation = ((pointerAngle - handleAngle) * 180) / Math.PI;
    applyTransform(item);
  }
}

function onPointerUp(e) {
  if (!state.drag) return;
  const drag = state.drag;
  const item = drag.item;

  if (drag.kind === "move") {
    if (drag.moved) {
      item.polygon.classList.remove("dragging");
      autosave();
    } else {
      // Treat as click — toggle selection.
      setSelected(state.selectedItemId === item.id ? null : item.id);
    }
  } else if (drag.kind === "rotate") {
    autosave();
  }
  state.drag = null;
}

function onCanvasPointerDown(e) {
  // Pointerdowns that hit a triangle stop propagation, so reaching here
  // means an empty-canvas click → deselect.
  if (state.selectedItemId) setSelected(null);
}

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
  if (item.element && item.element.parentNode) {
    item.element.parentNode.removeChild(item.element);
  }
  if (state.selectedItemId === id) state.selectedItemId = null;
  refreshItemList();
  autosave();
}

function redraw() {
  clearCanvas();
  drawBase();
  state.items.forEach(drawTriangle);
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

function serializeItems() {
  return state.items.map((i) => ({
    sizeId: i.sizeId,
    x: i.x,
    y: i.y,
    rotation: i.rotation,
  }));
}

function restoreItems(savedItems) {
  if (!Array.isArray(savedItems)) return;
  savedItems.forEach((saved) => {
    const size = config.triangleSizes.find((s) => s.id === saved.sizeId);
    if (!size) return;
    const points = trianglePoints(size);
    const item = {
      id: state.nextId++,
      sizeId: saved.sizeId,
      x: saved.x,
      y: saved.y,
      rotation: saved.rotation,
      points,
      radius: pointsRadius(points),
    };
    state.items.push(item);
    drawTriangle(item);
  });
  refreshItemList();
}

function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeItems()));
  } catch {}
}

function restoreAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    restoreItems(JSON.parse(raw));
  } catch {}
}

function clearItems() {
  state.items.forEach((item) => {
    if (item.element && item.element.parentNode) {
      item.element.parentNode.removeChild(item.element);
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
    items: serializeItems(),
    savedAt: new Date().toISOString(),
  };
  persistDesigns(designs);
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
  restoreItems(design.items);
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

addBtn.addEventListener("click", addTriangle);
saveBtn.addEventListener("click", saveCurrentDesign);
canvas.addEventListener("pointerdown", onCanvasPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("resize", redraw);

buildSizeList();
refreshDesignList();
redraw();
restoreAutosave();
