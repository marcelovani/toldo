// File export and import. Each exporter takes the same scene-triangle
// pipeline (buildSceneTriangles → format-specific writer → downloadBlob)
// and only differs in the writer.

import { buildSceneTriangles, pxToUnits } from "./geometry.js";
import {
  autosave,
  clearItems,
  restoreDesign,
  serializeDesign,
} from "./persistence.js";
import { state } from "./state.js";

// ---------- Common helpers ----------

export function promptExportName() {
  const defaultName = state.currentDesignName || "untitled";
  const promptInput = prompt("Name for the exported design:", defaultName);
  if (promptInput === null) return null;
  const name = promptInput.trim() || defaultName;
  state.currentDesignName = name;
  return name;
}

// Sanitise for filesystem: replace whitespace with dashes and drop
// characters that aren't safe across operating systems.
export function safeFilename(name) {
  return (
    name
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9._\-]/g, "")
      .slice(0, 80) || "design"
  );
}

export function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ensureScene() {
  if (!state.baseBbox) {
    alert("Nothing to export yet — open a design first.");
    return null;
  }
  return buildSceneTriangles(state.baseBbox, state.items);
}

// ---------- JSON (round-trip) ----------

export function exportCurrentDesign() {
  const name = promptExportName();
  if (name === null) return;
  const data = serializeDesign();
  data.name = name;
  data.exportedAt = new Date().toISOString();
  data.format = "toldo-design-v1";
  downloadBlob(
    JSON.stringify(data, null, 2),
    `toldo-${safeFilename(name)}.json`,
    "application/json",
  );
}

// ---------- STL (ASCII) ----------

// All triangles are emitted in real-world units (1 unit = config.pxPerUnit
// pixels). STL doesn't carry a unit, but most 3D apps assume mm or some
// user-configured scale; sticking to the design's "units" makes downstream
// scaling trivial.
export function trianglesToStlAscii(name, triangles) {
  const lines = [`solid ${name}`];
  for (const [a, bb, c] of triangles) {
    const ux = bb[0] - a[0],
      uy = bb[1] - a[1],
      uz = bb[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    lines.push(`  facet normal ${nx} ${ny} ${nz}`);
    lines.push(`    outer loop`);
    lines.push(
      `      vertex ${pxToUnits(a[0])} ${pxToUnits(a[1])} ${pxToUnits(a[2])}`,
    );
    lines.push(
      `      vertex ${pxToUnits(bb[0])} ${pxToUnits(bb[1])} ${pxToUnits(bb[2])}`,
    );
    lines.push(
      `      vertex ${pxToUnits(c[0])} ${pxToUnits(c[1])} ${pxToUnits(c[2])}`,
    );
    lines.push(`    endloop`);
    lines.push(`  endfacet`);
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n") + "\n";
}

export function exportCurrentDesignAsStl() {
  const triangles = ensureScene();
  if (!triangles) return;
  const name = promptExportName();
  if (name === null) return;
  const stl = trianglesToStlAscii(safeFilename(name), triangles);
  downloadBlob(stl, `toldo-${safeFilename(name)}.stl`, "model/stl");
}

// ---------- DAE (Collada 1.4.1) ----------

export function escapeXml(s) {
  return String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}

export function trianglesToCollada(name, triangles) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < triangles.length; i++) {
    const [a, b, c] = triangles[i];
    positions.push(
      pxToUnits(a[0]),
      pxToUnits(a[1]),
      pxToUnits(a[2]),
      pxToUnits(b[0]),
      pxToUnits(b[1]),
      pxToUnits(b[2]),
      pxToUnits(c[0]),
      pxToUnits(c[1]),
      pxToUnits(c[2]),
    );
    indices.push(i * 3, i * 3 + 1, i * 3 + 2);
  }
  const vertCount = triangles.length * 3;
  const now = new Date().toISOString();
  const safeName = escapeXml(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <created>${now}</created>
    <modified>${now}</modified>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_geometries>
    <geometry id="toldo-mesh" name="${safeName}">
      <mesh>
        <source id="toldo-positions">
          <float_array id="toldo-positions-array" count="${positions.length}">${positions.join(" ")}</float_array>
          <technique_common>
            <accessor source="#toldo-positions-array" count="${vertCount}" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="toldo-vertices">
          <input semantic="POSITION" source="#toldo-positions"/>
        </vertices>
        <triangles count="${triangles.length}">
          <input semantic="VERTEX" source="#toldo-vertices" offset="0"/>
          <p>${indices.join(" ")}</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="scene">
      <node id="toldo-node" name="${safeName}">
        <instance_geometry url="#toldo-mesh"/>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#scene"/>
  </scene>
</COLLADA>
`;
}

export function exportCurrentDesignAsDae() {
  const triangles = ensureScene();
  if (!triangles) return;
  const name = promptExportName();
  if (name === null) return;
  const dae = trianglesToCollada(name, triangles);
  downloadBlob(dae, `toldo-${safeFilename(name)}.dae`, "model/vnd.collada+xml");
}

// ---------- DXF (AutoCAD R12) ----------

// One 3DFACE entity per triangle on a single TOLDO layer. The 4th corner
// duplicates the 3rd so the face stays triangular, which every DXF reader
// I've checked accepts.
export function trianglesToDxf(triangles) {
  const out = [];
  const push = (...pairs) => {
    for (const v of pairs) out.push(String(v));
  };
  push("0", "SECTION", "2", "HEADER");
  push("9", "$ACADVER", "1", "AC1009");
  push("0", "ENDSEC");
  push("0", "SECTION", "2", "TABLES");
  push("0", "TABLE", "2", "LAYER", "70", "1");
  push("0", "LAYER", "2", "TOLDO", "70", "0", "62", "7", "6", "CONTINUOUS");
  push("0", "ENDTAB", "0", "ENDSEC");
  push("0", "SECTION", "2", "ENTITIES");
  for (const [a, b, c] of triangles) {
    push("0", "3DFACE", "8", "TOLDO");
    push("10", pxToUnits(a[0]), "20", pxToUnits(a[1]), "30", pxToUnits(a[2]));
    push("11", pxToUnits(b[0]), "21", pxToUnits(b[1]), "31", pxToUnits(b[2]));
    push("12", pxToUnits(c[0]), "22", pxToUnits(c[1]), "32", pxToUnits(c[2]));
    push("13", pxToUnits(c[0]), "23", pxToUnits(c[1]), "33", pxToUnits(c[2]));
  }
  push("0", "ENDSEC", "0", "EOF");
  return out.join("\n") + "\n";
}

export function exportCurrentDesignAsDxf() {
  const triangles = ensureScene();
  if (!triangles) return;
  const name = promptExportName();
  if (name === null) return;
  const dxf = trianglesToDxf(triangles);
  downloadBlob(dxf, `toldo-${safeFilename(name)}.dxf`, "image/vnd.dxf");
}

// ---------- Import (JSON only) ----------

export function importDesignFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      alert(`Could not parse the file as JSON: ${err.message}`);
      return;
    }
    if (
      state.items.length > 0 &&
      !confirm("Importing will replace the current design. Continue?")
    ) {
      return;
    }
    clearItems();
    restoreDesign(data);
    if (typeof data.name === "string" && data.name.trim()) {
      state.currentDesignName = data.name.trim();
    }
    autosave();
  };
  reader.onerror = () => {
    alert("Could not read the file.");
  };
  reader.readAsText(file);
}
