// Sidebar UI: triangle size picker, items-on-canvas list, saved-designs
// list. The "Add to canvas" / "Save" / "Export" / "Import" buttons are
// wired up in app.js — sidebar.js only owns the lists themselves.

import { config } from "./config.js";
import { deleteDesign, loadDesign, loadDesigns } from "./persistence.js";
import { state } from "./state.js";
import { removeItem } from "./triangle.js";

const sizeList = document.getElementById("size-list");
const itemList = document.getElementById("item-list");
const designList = document.getElementById("design-list");
const addBtn = document.getElementById("add-btn");

export function buildSizeList() {
  sizeList.innerHTML = "";
  config.triangleSizes.forEach((size) => {
    const li = document.createElement("li");
    li.dataset.id = size.id;
    li.innerHTML = `<span>${size.id}</span><small>${size.a} × ${size.b} × ${size.c}</small>`;
    li.addEventListener("click", () => selectSize(size.id));
    sizeList.appendChild(li);
  });
}

export function selectSize(id) {
  state.selectedSizeId = id;
  [...sizeList.children].forEach((li) => {
    li.classList.toggle("selected", li.dataset.id === id);
  });
  addBtn.disabled = !id;
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
