const SVG_NS = "http://www.w3.org/2000/svg";

const config = {
    pxPerUnit: 50,
    rect1: { w: 1.5, h: 3 },   // first rectangle in units
    rect2: { w: 1.5, h: 4 },   // second rectangle (pre-rotation)
    triangleSizes: [
        { id: "3x3x3", a: 3, b: 3, c: 3 },
        { id: "4x4x4", a: 4, b: 4, c: 4 },
        { id: "5x5x5", a: 5, b: 5, c: 5 },
        { id: "3x4x5", a: 3, b: 4, c: 5 },
    ],
};

const state = {
    selectedSizeId: null,
    items: [],          // { id, sizeId, x, y, rotation, points }
    nextId: 1,
    base: null,         // { rect1, rect2, originX, originY }
    drag: null,         // active drag info
};

const canvas = document.getElementById("canvas");
const sizeList = document.getElementById("size-list");
const addBtn = document.getElementById("add-btn");
const itemList = document.getElementById("item-list");
const scaleLabel = document.getElementById("scale-label");

scaleLabel.textContent = config.pxPerUnit;

function unitsToPx(u) { return u * config.pxPerUnit; }

function buildSizeList() {
    sizeList.innerHTML = "";
    config.triangleSizes.forEach(size => {
        const li = document.createElement("li");
        li.dataset.id = size.id;
        li.innerHTML = `<span>${size.id}</span><small>${size.a} × ${size.b} × ${size.c}</small>`;
        li.addEventListener("click", () => selectSize(size.id));
        sizeList.appendChild(li);
    });
}

function selectSize(id) {
    state.selectedSizeId = id;
    [...sizeList.children].forEach(li => {
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

    // After rotating rect2 by 90°, its visible bounding box becomes (h, w) = (4u, 1.5u)
    // We want the top-right corner of rect2's visual bbox to coincide with top-right of rect1.
    // Place rect1 so the combined shape sits roughly centered.
    const visibleW = r2h; // rotated width
    const visibleH = r1h + 0; // we'll place rect2 overlapping rect1 at the top
    const padding = 60;

    // Top-right corner anchor for both shapes:
    const anchorX = padding + visibleW; // rightmost extent
    const anchorY = padding;

    // Rect 1: top-right at (anchorX, anchorY)
    const rect1 = {
        x: anchorX - r1w,
        y: anchorY,
        w: r1w,
        h: r1h,
    };

    // Rect 2 is drawn pre-rotation with its top-LEFT at the anchor, then
    // rotated 90° around that point. In SVG (y-down), rotate(90) maps the
    // pre-rotation bottom-right (anchorX+w, anchorY+h) to (anchorX-h, anchorY+w),
    // so the rotated rectangle spans (anchorX-r2h, anchorY) to (anchorX, anchorY+r2w)
    // — its visible top-right corner coincides with rect1's top-right corner.
    const rect2 = {
        x: anchorX,
        y: anchorY,
        w: r2w,
        h: r2h,
    };

    state.base = {
        anchorX,
        anchorY,
        rect1,
        rect2,
    };

    // Draw rect1
    const r1 = document.createElementNS(SVG_NS, "rect");
    r1.setAttribute("x", rect1.x);
    r1.setAttribute("y", rect1.y);
    r1.setAttribute("width", rect1.w);
    r1.setAttribute("height", rect1.h);
    r1.setAttribute("class", "toldo-base");
    canvas.appendChild(r1);

    // Draw rect2 (rotated)
    const r2 = document.createElementNS(SVG_NS, "rect");
    r2.setAttribute("x", rect2.x);
    r2.setAttribute("y", rect2.y);
    r2.setAttribute("width", rect2.w);
    r2.setAttribute("height", rect2.h);
    r2.setAttribute("class", "toldo-base");
    r2.setAttribute("transform", `rotate(90 ${anchorX} ${anchorY})`);
    canvas.appendChild(r2);
}

// Build an SVG triangle (points string) for the given size, centered at (0,0)
function trianglePoints(size) {
    // triangle with sides a (bottom), b (left), c (right) — using law of cosines
    const a = unitsToPx(size.a);
    const b = unitsToPx(size.b);
    const c = unitsToPx(size.c);

    // Place side a horizontally on the bottom: B at (0,0), C at (a,0)
    // A is the apex. Use law of cosines to find angle at B.
    const cosB = (a * a + c * c - b * b) / (2 * a * c);
    const angleB = Math.acos(Math.max(-1, Math.min(1, cosB)));
    const Ax = c * Math.cos(angleB);
    const Ay = -c * Math.sin(angleB); // negative because SVG y goes down and we want apex up

    // Centroid:
    const cx = (0 + a + Ax) / 3;
    const cy = (0 + 0 + Ay) / 3;

    // Recenter at origin
    const points = [
        [0 - cx, 0 - cy],
        [a - cx, 0 - cy],
        [Ax - cx, Ay - cy],
    ];
    return points;
}

function pointsToString(points) {
    return points.map(p => `${p[0]},${p[1]}`).join(" ");
}

function addTriangle() {
    if (!state.selectedSizeId) return;
    const size = config.triangleSizes.find(s => s.id === state.selectedSizeId);
    if (!size) return;

    const points = trianglePoints(size);

    // Drop near the center of the L-shape (rect1 area)
    const dropX = state.base.rect1.x + state.base.rect1.w / 2;
    const dropY = state.base.rect1.y + state.base.rect1.h / 2;

    const item = {
        id: state.nextId++,
        sizeId: size.id,
        x: dropX,
        y: dropY,
        rotation: 0,
        points,
    };
    state.items.push(item);
    drawTriangle(item);
    refreshItemList();
}

function drawTriangle(item) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("data-id", item.id);
    g.setAttribute("transform", `translate(${item.x} ${item.y}) rotate(${item.rotation})`);

    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", pointsToString(item.points));
    poly.setAttribute("class", "triangle-shape");
    g.appendChild(poly);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "triangle-label");
    label.setAttribute("x", 0);
    label.setAttribute("y", 0);
    label.textContent = item.sizeId;
    g.appendChild(label);

    g.addEventListener("pointerdown", e => startDrag(e, item, g, poly));
    canvas.appendChild(g);
    item.element = g;
    item.polygon = poly;
}

function startDrag(e, item, g, poly) {
    e.preventDefault();
    const pt = clientToSvg(e.clientX, e.clientY);
    state.drag = {
        item,
        offsetX: pt.x - item.x,
        offsetY: pt.y - item.y,
    };
    poly.classList.add("dragging");
    g.parentNode.appendChild(g); // bring to front
}

function clientToSvg(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function onPointerMove(e) {
    if (!state.drag) return;
    const pt = clientToSvg(e.clientX, e.clientY);
    const item = state.drag.item;
    item.x = pt.x - state.drag.offsetX;
    item.y = pt.y - state.drag.offsetY;
    item.element.setAttribute("transform", `translate(${item.x} ${item.y}) rotate(${item.rotation})`);
}

function onPointerUp() {
    if (!state.drag) return;
    state.drag.item.polygon.classList.remove("dragging");
    state.drag = null;
}

function refreshItemList() {
    itemList.innerHTML = "";
    state.items.forEach(item => {
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
    const idx = state.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const [item] = state.items.splice(idx, 1);
    if (item.element && item.element.parentNode) {
        item.element.parentNode.removeChild(item.element);
    }
    refreshItemList();
}

function redraw() {
    clearCanvas();
    drawBase();
    state.items.forEach(drawTriangle);
}

addBtn.addEventListener("click", addTriangle);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("resize", redraw);

buildSizeList();
redraw();
