// Sidebar UI: triangle size picker, items-on-canvas list, saved-designs
// list. The "Add to canvas" / "Save" / "Export" / "Import" buttons are
// wired up in app.js — sidebar.js only owns the lists themselves.

import { config } from "./config.js";
import { deleteDesign, loadDesign, loadDesigns } from "./persistence.js";
import { state } from "./state.js";
import { removeItem } from "./triangle.js";

const triangleSizeList = document.getElementById("size-list");
const rectangleSizeList = document.getElementById("rect-size-list");
const itemList = document.getElementById("item-list");
const designList = document.getElementById("design-list");
const addBtn = document.getElementById("add-btn");

// Render both shape lists. Each list item carries data-kind + data-id so
// selectShape() can highlight the right one and clear the other.
export function buildSizeList() {
  triangleSizeList.innerHTML = "";
  config.triangleSizes.forEach((size) => {
    const li = document.createElement("li");
    li.dataset.kind = "triangle";
    li.dataset.id = size.id;
    li.innerHTML = `<span>${size.id}</span><small>${size.a} × ${size.b} × ${size.c}</small>`;
    li.addEventListener("click", () => selectShape("triangle", size.id));
    triangleSizeList.appendChild(li);
  });

  rectangleSizeList.innerHTML = "";
  config.rectangleSizes.forEach((size) => {
    const li = document.createElement("li");
    li.dataset.kind = "rectangle";
    li.dataset.id = size.id;
    li.innerHTML = `<span>${size.id}</span><small>${size.w} × ${size.h}</small>`;
    li.addEventListener("click", () => selectShape("rectangle", size.id));
    rectangleSizeList.appendChild(li);
  });
}

export function selectShape(kind, sizeId) {
  state.selectedShape = { kind, sizeId };
  highlightSelected();
  addBtn.disabled = false;
}

function highlightSelected() {
  const sel = state.selectedShape;
  for (const list of [triangleSizeList, rectangleSizeList]) {
    [...list.children].forEach((li) => {
      const match =
        sel && li.dataset.kind === sel.kind && li.dataset.id === sel.sizeId;
      li.classList.toggle("selected", !!match);
    });
  }
}

export function refreshItemList() {
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

export function refreshDesignList() {
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
