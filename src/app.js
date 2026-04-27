// Main entry point: imports every module, wires DOM event listeners on
// the sidebar buttons, and kicks off the initial render + autosave
// restoration. Everything else lives in dedicated modules.

import { config } from "./config.js";
import {
  exportCurrentDesign,
  exportCurrentDesignAsDae,
  exportCurrentDesignAsDxf,
  exportCurrentDesignAsStl,
  importDesignFromFile,
} from "./export.js";
import { attachInteractions } from "./interactions.js";
import { restoreAutosave, saveCurrentDesign } from "./persistence.js";
import { buildSizeList, refreshDesignList } from "./sidebar.js";
import { applyDisplayOptions, attachToolsListeners } from "./tools.js";
import { addShape } from "./triangle.js";
import { redraw, setupViews } from "./views.js";

// ---------- DOM-driven config readouts ----------

document.getElementById("scale-label").textContent = config.pxPerUnit;
document.getElementById("rect1-label").textContent =
  `${config.rect1.w} × ${config.rect1.h}`;
document.getElementById("rect2-label").textContent =
  `${config.rect2.w} × ${config.rect2.h}`;

// ---------- Wire sidebar buttons ----------

document.getElementById("add-btn").addEventListener("click", addShape);
document
  .getElementById("save-btn")
  .addEventListener("click", saveCurrentDesign);
document
  .getElementById("export-btn")
  .addEventListener("click", exportCurrentDesign);
document
  .getElementById("export-stl-btn")
  .addEventListener("click", exportCurrentDesignAsStl);
document
  .getElementById("export-dae-btn")
  .addEventListener("click", exportCurrentDesignAsDae);
document
  .getElementById("export-dxf-btn")
  .addEventListener("click", exportCurrentDesignAsDxf);

const importFileInput = document.getElementById("import-file");
document
  .getElementById("import-btn")
  .addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importDesignFromFile(file);
  // Reset so picking the same file again still fires "change".
  e.target.value = "";
});

// ---------- Boot ----------

window.addEventListener("resize", redraw);

setupViews();
attachInteractions();
attachToolsListeners();
buildSizeList();
refreshDesignList();
applyDisplayOptions();
redraw();
restoreAutosave();
