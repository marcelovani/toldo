// Floating "Tools" panel above the stage: per-design display options
// that toggle classes on <body> for CSS to react to. Designed so adding a
// new toggle = a new button in the panel and a new field on
// state.display.

import { autosave } from "./persistence.js";
import { state } from "./state.js";

const toggleTriangleOpacityBtn = document.getElementById(
  "toggle-triangle-opacity",
);

// Sync DOM (body class + button state) with state.display. Called on
// boot, after restoring a design, and after toggling.
export function applyDisplayOptions() {
  document.body.classList.toggle(
    "triangles-opaque",
    !!state.display.trianglesOpaque,
  );
  if (toggleTriangleOpacityBtn) {
    toggleTriangleOpacityBtn.setAttribute(
      "aria-pressed",
      state.display.trianglesOpaque ? "true" : "false",
    );
    toggleTriangleOpacityBtn.title = state.display.trianglesOpaque
      ? "Triangles opaque — click for transparent"
      : "Triangles transparent — click for opaque";
  }
}

export function toggleTriangleOpacity() {
  state.display.trianglesOpaque = !state.display.trianglesOpaque;
  applyDisplayOptions();
  autosave();
}

// Wire up button click(s). Called once from app.js after the DOM is ready.
export function attachToolsListeners() {
  if (toggleTriangleOpacityBtn) {
    toggleTriangleOpacityBtn.addEventListener("click", toggleTriangleOpacity);
  }
}
