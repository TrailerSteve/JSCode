// scripts.js — minimal WebGL + orbit camera + V-nose mesh (dropdown-driven)
(() => {
  "use strict";
  // DOM
  const canvas = document.getElementById("gl");
  if (!canvas) { console.error("Canvas #gl not found"); return; }

  // WebGL setup (WebGL2 -> WebGL1 fallback)
  const opts = { antialias: true, alpha: true };
  const gl =
    canvas.getContext("webgl2", opts) ||
    canvas.getContext("webgl", opts) ||
    canvas.getContext("experimental-webgl", opts);

  if (!gl) { console.error("WebGL context creation failed"); return; }

  const isWebGL2 =
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext;

  // Tiny mat4 helpers (column-major)
  const M4 = {
    ident: () => new Float32Array([
      1,0,0,0,
      0,1,0,0,
      0,0,1,0,
      0,0,0,1
    ]),
    perspective: (fovy, aspect, near, far) => {
      const f = 1 / Math.tan(fovy/2);
      const nf = 1 / (near - far);
      const o = new Float32Array(16);
      o[0] = f / aspect;
      o[5] = f;
      o[10] = (far + near) * nf;
      o[11] = -1;
      o[14] = (2 * far * near) * nf;
      return o;
    },
    lookAt: (eye, ctr, up) => {
      let [ex,ey,ez] = eye, [cx,cy,cz] = ctr, [ux,uy,uz] = up;

      let zx = ex - cx, zy = ey - cy, zz = ez - cz;
      let zl = 1 / (Math.hypot(zx,zy,zz) || 1);
      zx *= zl; zy *= zl; zz *= zl;

      let xx = uy*zz - uz*zy;
      let xy = uz*zx - ux*zz;
      let xz = ux*zy - uy*zx;
      let xl = 1 / (Math.hypot(xx,xy,xz) || 1);
      xx *= xl; xy *= xl; xz *= xl;

      let yx = zy*xz - zz*xy;
      let yy = zz*xx - zx*xz;
      let yz = zx*xy - zy*xx;

      const o = M4.ident();
      o[0]=xx; o[4]=xy; o[8]=xz;
      o[1]=yx; o[5]=yy; o[9]=yz;
      o[2]=zx; o[6]=zy; o[10]=zz;

      o[12]=-(xx*ex + xy*ey + xz*ez);
      o[13]=-(yx*ex + yy*ey + yz*ez);
      o[14]=-(zx*ex + zy*ey + zz*ez);
      return o;
    }
  };

  // Shaders
const VERT_300 = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uProjection, uView, uModel;

out vec3 vN;
out vec3 vWPos;

void main() {
  vec4 wpos = uModel * vec4(aPosition, 1.0);
  vWPos = wpos.xyz;

  vN = mat3(uView * uModel) * aNormal;
  gl_Position = uProjection * uView * wpos;
}`;

const FRAG_300 = `#version 300 es
precision highp float;

in vec3 vN;
in vec3 vWPos;

uniform vec3  uColor;
uniform float uTwoSided;
uniform float uAmbient;

// texture controls
uniform sampler2D uDiamondTex;
uniform sampler2D uBlackoutTex;
uniform int   uUseTex;
uniform float uTexScale;
uniform sampler2D uFloorTex;
uniform sampler2D uWallTex;
uniform int uTexMode;
uniform sampler2D uGroundTex;

// diamond procedural controls
uniform int   uDiamond;
uniform int uBlackout;
uniform float uDScale;
uniform float uDLine;

out vec4 outColor;

void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(0.6, 1.0, 0.6));
  float ndl = dot(N, L);
  if (uTwoSided > 0.5) ndl = abs(ndl);
  float diff = max(ndl, 0.0);

  vec3 baseColor = uColor;

  // TEXTURE
if (uUseTex == 1) {
  float scale = abs(uTexScale);
  vec2 uv;

  // pick mapping by mode
  if (uTexMode == 2) {
    uv = vWPos.xz * scale;
  } else if (uTexMode == 3) {
    uv = vWPos.zy * scale;
  } else if (uTexMode == 4) {
    uv = vWPos.xz * scale;
  } else {
    // DIAMOND or default
    if (uDiamond == 1) uv = vWPos.yz * scale;
    else {
      vec3 n = normalize(vN);
      if (abs(n.y) > abs(n.x) && abs(n.y) > abs(n.z)) uv = vWPos.xz * scale;
      else if (abs(n.x) > abs(n.z))                  uv = vWPos.zy * scale;
      else                                           uv = vWPos.xy * scale;
      if (uTexScale < 0.0) uv.y = -uv.y;
    }
  }

  if (uTexMode == 2) baseColor = texture(uFloorTex, uv).rgb;
  else if (uTexMode == 3) baseColor = texture(uWallTex, uv).rgb;
  else if (uTexMode == 4) baseColor = texture(uGroundTex, uv).rgb;
  else if (uBlackout == 1) baseColor = texture(uBlackoutTex, uv).rgb;
  else baseColor = texture(uDiamondTex, uv).rgb;
}

  // PROCEDURAL DIAMOND (only if uDiamond==1 AND texture off)
  if (uDiamond == 1 && uUseTex == 0) {
    vec2 yz = vec2(vWPos.y, vWPos.z);
    float c = 0.70710678;
    mat2 R = mat2(c, -c, c, c);
    vec2 p = (R * yz) / max(uDScale, 1e-4);

    vec2 g = abs(fract(p) - 0.5);
    float edge = min(g.x, g.y);
    float lineMask = smoothstep(0.5 - uDLine, 0.5, 0.5 - edge);
    float ridgeBoost = mix(0.9, 1.3, lineMask);
    baseColor = uColor * ridgeBoost;
  }

  vec3 lit = baseColor * (uAmbient + (1.0 - uAmbient) * diff);
  outColor = vec4(lit, 1.0);
}`;

const VERT_100 = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uProjection, uView, uModel;

varying vec3 vN;
varying vec3 vWPos;

void main() {
  vec4 wpos = uModel * vec4(aPosition, 1.0);
  vWPos = wpos.xyz;

  vN = mat3(uView * uModel) * aNormal;
  gl_Position = uProjection * uView * wpos;
}`;

const FRAG_100 = `
precision highp float;

varying vec3 vN;
varying vec3 vWPos;

uniform vec3  uColor;
uniform float uTwoSided;
uniform float uAmbient;

uniform sampler2D uDiamondTex;
uniform sampler2D uBlackoutTex;
uniform int   uUseTex;
uniform float uTexScale;
uniform sampler2D uFloorTex;
uniform sampler2D uWallTex;
uniform int uTexMode;
uniform sampler2D uGroundTex;

uniform int   uDiamond;
uniform float uDScale;
uniform float uDLine;
uniform int uBlackout;

void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(0.6, 1.0, 0.6));
  float ndl = dot(N, L);
  if (uTwoSided > 0.5) ndl = abs(ndl);
  float diff = max(ndl, 0.0);

  vec3 baseColor = uColor;

if (uUseTex == 1) {
  float scale = abs(uTexScale);
  vec2 uv;

  if (uTexMode == 2) {
    uv = vWPos.xz * scale;
  } else if (uTexMode == 3) {
    uv = vWPos.zy * scale;
  } else if (uTexMode == 4) {
    uv = vWPos.xz * scale;
  } else {
    if (uDiamond == 1) uv = vWPos.yz * scale;
    else {
      vec3 n = normalize(vN);
      if (abs(n.y) > abs(n.x) && abs(n.y) > abs(n.z)) uv = vWPos.xz * scale;
      else if (abs(n.x) > abs(n.z))                  uv = vWPos.zy * scale;
      else                                           uv = vWPos.xy * scale;
      if (uTexScale < 0.0) uv.y = -uv.y;
    }
  }

  if (uTexMode == 2)      baseColor = texture2D(uFloorTex,   uv).rgb;
  else if (uTexMode == 3) baseColor = texture2D(uWallTex,    uv).rgb;
  else if (uTexMode == 4) baseColor = texture2D(uGroundTex,  uv).rgb;
  else if (uBlackout == 1) baseColor = texture2D(uBlackoutTex, uv).rgb;
  else baseColor = texture2D(uDiamondTex, uv).rgb;
}

  if (uDiamond == 1 && uUseTex == 0) {
    vec2 yz = vec2(vWPos.y, vWPos.z);
    float c = 0.70710678;
    mat2 R = mat2(c, -c, c, c);
    vec2 p = (R * yz) / max(uDScale, 1e-4);

    vec2 g = abs(fract(p) - 0.5);
    float edge = min(g.x, g.y);
    float lineMask = smoothstep(0.5 - uDLine, 0.5, 0.5 - edge);
    float ridgeBoost = mix(0.9, 1.3, lineMask);
    baseColor = uColor * ridgeBoost;
  }

  vec3 lit = baseColor * (uAmbient + (1.0 - uAmbient) * diff);
  gl_FragColor = vec4(lit, 1.0);
}`;
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(s) || "Shader compile failed";
      gl.deleteShader(s);
      throw new Error(msg);
    }
    return s;
  }

  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(p) || "Program link failed";
      gl.deleteProgram(p);
      throw new Error(msg);
    }
    return p;
  }

  const program = link(
    compile(gl.VERTEX_SHADER, isWebGL2 ? VERT_300 : VERT_100),
    compile(gl.FRAGMENT_SHADER, isWebGL2 ? FRAG_300 : FRAG_100)
  );
  gl.useProgram(program);

  const uProjection = gl.getUniformLocation(program, "uProjection");
  const uView       = gl.getUniformLocation(program, "uView");
  const uModel      = gl.getUniformLocation(program, "uModel");
  const uColor      = gl.getUniformLocation(program, "uColor");
  const uTwoSided = gl.getUniformLocation(program, "uTwoSided");
  const uAmbient = gl.getUniformLocation(program, "uAmbient");
  const uDiamond    = gl.getUniformLocation(program, "uDiamond");
  const uBlackout = gl.getUniformLocation(program, "uBlackout");
  const uDScale     = gl.getUniformLocation(program, "uDScale");
  const uDLine      = gl.getUniformLocation(program, "uDLine");
  const uDiamondTex = gl.getUniformLocation(program, "uDiamondTex");
  const uBlackoutTex = gl.getUniformLocation(program, "uBlackoutTex");
  const uFloorTex  = gl.getUniformLocation(program, "uFloorTex");
  const uWallTex   = gl.getUniformLocation(program, "uWallTex");
  const uTexMode   = gl.getUniformLocation(program, "uTexMode");
  const uUseTex     = gl.getUniformLocation(program, "uUseTex");
  const uTexScale   = gl.getUniformLocation(program, "uTexScale");
  // defaults
  if (uUseTex)   gl.uniform1i(uUseTex, 0);
  if (uTexScale) gl.uniform1f(uTexScale, 3.0);
  if (uDiamond)  gl.uniform1i(uDiamond, 0);
  if (uBlackout) gl.uniform1i(uBlackout, 0);
  if (uDScale)   gl.uniform1f(uDScale, 0.12);
  if (uDLine)    gl.uniform1f(uDLine, 0.06);
  gl.uniform1f(uAmbient, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.uniform1f(uTwoSided, 0.0);

function loadTexture(url, unit, onReady) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // temporary 1x1 while loading
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
    gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([128, 128, 128, 255])
  );

  const img = new Image();
  img.onload = () => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);

    if (onReady) onReady();
  };
  img.onerror = () => {
    console.error("Texture failed to load: " + url);
  };
  img.src = url;

  return tex;
}
let groundTexReady = false;
const diamondTex = loadTexture("diamond_plate.png", 0);
const floorTex    = loadTexture("Floor.jpg", 1);
const wallTex = loadTexture("Wall.jpg", 2);
const groundTex = loadTexture("ground.jpg", 3, () => {groundTexReady = true;});
const blackoutTex = loadTexture("blackout.jpg", 4)

gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, diamondTex);
if (uDiamondTex) gl.uniform1i(uDiamondTex, 0);

// Floor
gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, floorTex);
if (uFloorTex) gl.uniform1i(uFloorTex, 1);

// Wall
gl.activeTexture(gl.TEXTURE2);
gl.bindTexture(gl.TEXTURE_2D, wallTex);
if (uWallTex) gl.uniform1i(uWallTex, 2);

// Ground
const uGroundTex = gl.getUniformLocation(program, "uGroundTex");
gl.activeTexture(gl.TEXTURE3);
gl.bindTexture(gl.TEXTURE_2D, groundTex);
if (uGroundTex) gl.uniform1i(uGroundTex, 3);

gl.activeTexture(gl.TEXTURE4);
gl.bindTexture(gl.TEXTURE_2D, blackoutTex);
if (uBlackoutTex) gl.uniform1i(uBlackoutTex, 4);

let showRoofLines = true;
let structurePreview = false;
let blackout = false;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, (canvas.clientWidth * dpr) | 0);
    const h = Math.max(1, (canvas.clientHeight * dpr) | 0);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const proj = M4.perspective((45 * Math.PI) / 180, w / h, 0.05, 100.0);
    gl.uniformMatrix4fv(uProjection, false, proj);
  }
  window.addEventListener("resize", resize);
  resize();

const btnRoofLines = document.getElementById("btnRoofLines");
const btnBlackout = document.getElementById("btnBlackout");
const btnRearFlare = document.getElementById("btnRearFlare");

if (btnRoofLines) {
  btnRoofLines.checked = false;
  btnRoofLines.addEventListener("change", () => {
    showRoofLines = !btnRoofLines.checked;
    rebuildMesh();
  });
}

if (btnBlackout) {
  btnBlackout.checked = false;
  btnBlackout.addEventListener("change", () => {
    blackout = btnBlackout.checked;
  });
}

if (btnRearFlare) {
    btnRearFlare.checked = false;

    btnRearFlare.addEventListener("change", () => {
        rearFlare = btnRearFlare.checked;
        rebuildMesh();
    });
}

// Debug button (hidden): toggles roof lines the same way the checkbox does,
// but wired here in JS so it doesn't rely on a global variable.
const btnRoofLinesDbg = document.getElementById("btnRoofLinesDbg");
if (btnRoofLinesDbg) {
  btnRoofLinesDbg.addEventListener("click", () => {
    showRoofLines = !showRoofLines;
    rebuildMesh();
  });
}

  // Camera (orbit controls) 
  let camYaw = 0.8;
  let camPitch = 0.35;
  let camDist = 5;
  const CAM_MIN = 2;
  const CAM_MAX = 15;
  const target = [0, 0, 0];
  // debug free cam
  let freeCam = false;
  let freeCamPos = [0, 0.8, -4.5];
  let freeCamYaw = 0.0;
  let freeCamPitch = 0.0;
  const freeKeys = {
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function updateView() {
  if (!freeCam) {
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const cy = Math.cos(camYaw),   sy = Math.sin(camYaw);

    const eye = [
      target[0] + camDist * sy * cp,
      target[1] + camDist * sp,
      target[2] + camDist * cy * cp
    ];

    const view = M4.lookAt(eye, target, [0, 1, 0]);
    gl.uniformMatrix4fv(uView, false, view);
    return;
  }

  const cp = Math.cos(freeCamPitch), sp = Math.sin(freeCamPitch);
  const cy = Math.cos(freeCamYaw),   sy = Math.sin(freeCamYaw);

  const forward = [sy * cp, sp, cy * cp];
  const center = [
    freeCamPos[0] + forward[0],
    freeCamPos[1] + forward[1],
    freeCamPos[2] + forward[2]
  ];

  const view = M4.lookAt(freeCamPos, center, [0, 1, 0]);
  gl.uniformMatrix4fv(uView, false, view);
}

  canvas.style.touchAction = "none";
  let dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  if (!freeCam) {
    camYaw += dx * 0.005;
    camPitch += dy * 0.005;
    camPitch = clamp(camPitch, -1.45, 1.45);
  } else {
    freeCamYaw += dx * 0.005;
    freeCamPitch += dy * 0.005;
    freeCamPitch = clamp(freeCamPitch, -1.45, 1.45);
  }
});

  canvas.addEventListener("pointerup", () => dragging = false);
  canvas.addEventListener("pointercancel", () => dragging = false);

window.addEventListener("keydown", (e) => {
  if (e.key === "`") {
    freeCam = !freeCam;

    if (freeCam) {
      const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
      const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
      const startDist = Math.max(camDist, 3.5);

      freeCamPos = [
        target[0] + startDist * sy * cp,
        target[1] + startDist * sp,
        target[2] + startDist * cy * cp
      ];

      const dx = target[0] - freeCamPos[0];
      const dy = target[1] - freeCamPos[1];
      const dz = target[2] - freeCamPos[2];
      const flatLen = Math.hypot(dx, dz) || 1;

      freeCamYaw = Math.atan2(dx, dz);
      freeCamPitch = Math.atan2(dy, flatLen);
    }

    const hud = document.getElementById("hud");
    if (hud) {
      hud.textContent = freeCam ? "Free Cam ON" : "Orbit Cam ON";
    }

    console.log("freeCam:", freeCam, freeCamPos);
    e.preventDefault();
    return;
  }

  const k = e.key.toLowerCase();

  // R = restart: same as the Restart button - back to panel 1, all defaults
  if (k === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    setPanelByIndex(0);
    resetAllToDefaults();
    e.preventDefault();
    return;
  }

  if (k in freeKeys) {
    freeKeys[k] = true;
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k in freeKeys) {
    freeKeys[k] = false;
    e.preventDefault();
  }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  if (!freeCam) {
    camDist *= Math.exp(e.deltaY * 0.001);
    camDist = clamp(camDist, CAM_MIN, CAM_MAX);
    return;
  }

  const cp = Math.cos(freeCamPitch);
  const sp = Math.sin(freeCamPitch);
  const cy = Math.cos(freeCamYaw);
  const sy = Math.sin(freeCamYaw);

  const forward = [sy * cp, sp, cy * cp];
  const wheelStep = 0.25;
  const dir = e.deltaY > 0 ? 1 : -1;

  freeCamPos[0] += forward[0] * wheelStep * dir;
  freeCamPos[1] += forward[1] * wheelStep * dir;
  freeCamPos[2] += forward[2] * wheelStep * dir;
}, { passive: false });

  let enclosedColor = [0.7, 0.7, 0.7];

function resetAllToDefaults() {
  // set default length first (because width options depend on it)
  if (lengthSelect) lengthSelect.value = String(DEFAULTS.lengthFt);

  // rebuild width dropdown based on that length
  applyWidthFilterForLength();

  // now set the default width (only if it exists in the rebuilt list)
  if (widthSelect) {
    const want = String(DEFAULTS.widthIn);
    const exists = Array.from(widthSelect.options).some(o => o.value === want);
    widthSelect.value = exists ? want : (widthSelect.options[0]?.value || "");
  }

  if (addHeightSel) addHeightSel.value = String(DEFAULTS.addHeight);

  // Feature checkboxes back to off (and their flags to match the boxes)
  if (btnRoofLines) { btnRoofLines.checked = false; showRoofLines = true; }
  if (btnBlackout)  { btnBlackout.checked = false;  blackout = false; }
  if (btnRearFlare) { btnRearFlare.checked = false; rearFlare = false; }

  // Clear ticks on the remaining (currently unwired) feature checkboxes too,
  // so Reset leaves no stale ticks behind
  document.querySelectorAll(".feature_e input[type='checkbox'], .feature_i input[type='checkbox']").forEach(cb => { cb.checked = false; });

  // Extended tongue (unwired option, but its select still resets)
  if (extTongueSel) extTongueSel.value = "none";

  // Interior view back to exterior
  interiorView = false;
  if (btnInterior) btnInterior.textContent = "Interior View";

  setAxleMode(DEFAULTS.axleMode);
  updateAxleSizeOptions();
  noseLenFt = DEFAULTS.noseLenFt;
  enclosedColor = [0.7, 0.7, 0.7];

  // Color highlight back to the silver card
  document.querySelectorAll(".color-option").forEach(b => b.classList.remove("is-selected"));
  document.querySelector(".color-option[data-color='silver']")?.classList.add("is-selected");

  if (typeof applyAxleRulesForLength === "function") applyAxleRulesForLength();

  if (ocFloorSel) ocFloorSel.value = "24_foc";
  if (ocWallSel)  ocWallSel.value = "24_woc";
  if (ocRoofSel)  ocRoofSel.value = "24_roc";

  readDimsFromUI();
  rebuildMesh();
}

  // UI panels
  function showPanel(panelName) {
    document.querySelectorAll(".config-panel-body").forEach(panel => {
      const shouldShow = panel.dataset.tabBody === panelName;
      const display = panel.dataset.display || "block";
      panel.style.display = shouldShow ? display : "none";
    });
    const nextStructurePreview = (panelName === "feature_oc");
    if (structurePreview !== nextStructurePreview) {
      structurePreview = nextStructurePreview;
      rebuildMesh();
    } else {
      structurePreview = nextStructurePreview;
    }
  }
  const PANEL_ORDER = ["length","width","size_axle","color","feature_oc","feature_ad","feature_e","feature_i"];
  let currentIndex = 0;
  function setPanelByIndex(i) {
    currentIndex = Math.max(0, Math.min(PANEL_ORDER.length - 1, i));
    const name = PANEL_ORDER[currentIndex];
    showPanel(name);
    // No dead-end clicks: Next is off on the last step, Back is off on the first
    document.getElementById("next")?.toggleAttribute("disabled", currentIndex >= PANEL_ORDER.length - 1);
    document.getElementById("back")?.toggleAttribute("disabled", currentIndex <= 0);
    if (name === "color" && typeof revealColorOptions === "function") revealColorOptions();
  }
  setPanelByIndex(0);
  document.getElementById("next")?.addEventListener("click", (e) => { e.preventDefault(); setPanelByIndex(currentIndex + 1); });
  document.getElementById("back")?.addEventListener("click", (e) => { e.preventDefault(); setPanelByIndex(currentIndex - 1); });
  document.getElementById("restart")?.addEventListener("click", (e) => {e.preventDefault();setPanelByIndex(0);resetAllToDefaults();});
  document.getElementById("btnReset")?.addEventListener("click", (e) => {e.preventDefault();setPanelByIndex(0);resetAllToDefaults();});

  // Size controls (dropdowns)
  const lengthSelect = document.getElementById("length-options"); 
  const widthSelect  = document.getElementById("width-options"); 
  const addHeightSel = document.getElementById("add_height");
  const ocFloorSel = document.getElementById("oc_floor");
  const ocWallSel  = document.getElementById("oc_wall");
  const ocRoofSel  = document.getElementById("oc_roof");
  const extTongueSel = document.getElementById("ext_tongue");
  const ALL_WIDTH_OPTIONS = Array.from(widthSelect.options).map(opt => ({value: String(opt.value), text: opt.textContent}));

  const BASE_HEIGHT_IN = 72; 
  const UNITS_PER_FOOT = 0.18; 

  const OC_24=2*UNITS_PER_FOOT
  const OC_16=(16/12)*UNITS_PER_FOOT
  const OC_12=1*UNITS_PER_FOOT

  let noseLenFt = 2; // later: dropdown 2–5
  const dims = { lengthFt: 10, widthFt: 6, heightFt: 6 };

  function readDimsFromUI() {
    dims.lengthFt = Number(lengthSelect?.value || 8);

    const widthIn = Number(widthSelect?.value || 60);
    dims.widthFt = widthIn / 12;

    const addIn = (addHeightSel && addHeightSel.value !== "none") ? Number(addHeightSel.value) : 0;
    dims.heightFt = (BASE_HEIGHT_IN + addIn * .5) / 12;
  }

  // Geometry buffers (V-nose)
  let vertexCount = 0;
  const posB = gl.createBuffer();
  const norB = gl.createBuffer();
  let pos=[], nor=[];

const DEFAULTS = {
  lengthFt: 8,
  widthIn: 60,
  addHeight: "none",
  axleMode: "single",
  noseLenFt: 2,
};

  function pushTri(pos, nor, a, b, c, nOverride) {
    let nx, ny, nz;
    if (nOverride) {
      [nx, ny, nz] = nOverride;
    } else {
      const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
      const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
      nx = uy*vz - uz*vy;
      ny = uz*vx - ux*vz;
      nz = ux*vy - uy*vx;
      const l = Math.hypot(nx,ny,nz) || 1;
      nx/=l; ny/=l; nz/=l;
    }
    pos.push(...a, ...b, ...c);
    nor.push(nx,ny,nz, nx,ny,nz, nx,ny,nz);
  }

function pushQuad(p0, p1, p2, p3, n) {
  // two triangles: (0,1,2) and (0,2,3)
  pushTri(pos, nor, p0, p1, p2, n);
  pushTri(pos, nor, p0, p2, p3, n);
}

function addRectBeam(A, B, thicknessZ, heightY, upBias = 0, flipNormals = false){
  const ax=A[0], ay=A[1], az=A[2];
  const bx=B[0], by=B[1], bz=B[2];

  // direction (beam axis)
  let dx = bx-ax, dy = by-ay, dz = bz-az;
  const dl = Math.hypot(dx,dy,dz) || 1;
  dx/=dl; dy/=dl; dz/=dl;

  // build a stable local frame: side + up2
  // world up
  let wx = 0, wy = 1, wz = 0;

  // side = normalize(cross(worldUp, dir))
  let sx = wy*dz - wz*dy;
  let sy = wz*dx - wx*dz;
  let sz = wx*dy - wy*dx;
  let sl = Math.hypot(sx,sy,sz);

  // if dir is almost parallel to worldUp, use a fallback up axis
  if (sl < 1e-6) {
    wx = 0; wy = 0; wz = 1; // fallback up
    sx = wy*dz - wz*dy;
    sy = wz*dx - wx*dz;
    sz = wx*dy - wy*dx;
    sl = Math.hypot(sx,sy,sz) || 1;
  }
  sx/=sl; sy/=sl; sz/=sl;

  // up2 = normalize(cross(dir, side))
  let ux = dy*sz - dz*sy;
  let uy = dz*sx - dx*sz;
  let uz = dx*sy - dy*sx;
  const ul = Math.hypot(ux,uy,uz) || 1;
  ux/=ul; uy/=ul; uz/=ul;

  // optional: flip all normals for this beam
  if (flipNormals){
    sx=-sx; sy=-sy; sz=-sz;
    ux=-ux; uy=-uy; uz=-uz;
    dx=-dx; dy=-dy; dz=-dz;
  }

  // helpers for biasing normals upward (only affects THIS beam if upBias > 0)
  function nrm(v){
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
  }
  function biasUp(n){
    if (!upBias) return n;
    const t = upBias; // 0..1
    // blend toward +worldY (not beam-up) so it catches your top light more
    return nrm([ n[0]*(1-t), n[1]*(1-t) + t, n[2]*(1-t) ]);
  }

  const hy = heightY/2, hz = thicknessZ/2;

  // offsets
  const up   = [ux*hy, uy*hy, uz*hy];
  const side = [sx*hz, sy*hz, sz*hz];

  function add(v,w){ return [v[0]+w[0], v[1]+w[1], v[2]+w[2]]; }
  function sub(v,w){ return [v[0]-w[0], v[1]-w[1], v[2]-w[2]]; }

  // 8 corners at A and B
  const A0 = add(A, add( up,  side));
  const A1 = add(A, sub( up,  side));
  const A2 = sub(A, add( up,  side));
  const A3 = sub(A, sub( up,  side));

  const B0 = add(B, add( up,  side));
  const B1 = add(B, sub( up,  side));
  const B2 = sub(B, add( up,  side));
  const B3 = sub(B, sub( up,  side));

  // TOP (+up)
  pushQuad(A0, B0, B1, A1, biasUp([ ux, uy, uz ]));

  // BOTTOM (-up)
  pushQuad(A2, A3, B3, B2, biasUp([ -ux, -uy, -uz ]));

  // +SIDE (+side)
  pushQuad(A0, A2, B2, B0, biasUp([ sx, sy, sz ]));

  // -SIDE (-side)
  pushQuad(A1, B1, B3, A3, biasUp([ -sx, -sy, -sz ]));

  // CAP at A (-dir)
  pushQuad(A0, A1, A3, A2, biasUp([ -dx, -dy, -dz ]));

  // CAP at B (+dir)
  pushQuad(B0, B2, B3, B1, biasUp([ dx, dy, dz ]));
}

function addBox(cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx/2, x1 = cx + sx/2;
  const y0 = cy - sy/2, y1 = cy + sy/2;
  const z0 = cz - sz/2, z1 = cz + sz/2;

  // 6 faces, each 2 tris
  // +Z
  pushTri(pos,nor, [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[0,0,1]);
  pushTri(pos,nor, [x0,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]);
  // -Z
  pushTri(pos,nor, [x0,y0,z0],[x1,y1,z0],[x1,y0,z0],[0,0,-1]);
  pushTri(pos,nor, [x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]);
  // -X
  pushTri(pos,nor, [x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[-1,0,0]);
  pushTri(pos,nor, [x0,y0,z0],[x0,y1,z1],[x0,y1,z0],[-1,0,0]);
  // +X
  pushTri(pos,nor, [x1,y0,z0],[x1,y1,z1],[x1,y0,z1],[1,0,0]);
  pushTri(pos,nor, [x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]);
  // +Y
  pushTri(pos,nor, [x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[0,1,0]);
  pushTri(pos,nor, [x0,y1,z0],[x1,y1,z1],[x1,y1,z0],[0,1,0]);
  // -Y
  pushTri(pos,nor, [x0,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]);
  pushTri(pos,nor, [x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[0,-1,0]);
}

function addDisc(cx, cy, cz, r, axis = "y", seg = 24) {
  // flat disc made of triangles, normal points +axis
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    let p0, p1, p2, n;

    if (axis === "y") {
      p0 = [cx, cy, cz];
      p1 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
      p2 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
      n = [0, 1, 0];
    } else if (axis === "x") {
      p0 = [cx, cy, cz];
      p1 = [cx, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
      p2 = [cx, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      n = [1, 0, 0];
    } else { // "z"
      p0 = [cx, cy, cz];
      p1 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz];
      p2 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz];
      n = [0, 0, 1];
    }

    pushTri(pos, nor, p0, p1, p2, n);
  }
}

function addDiscX(x, cy, cz, r, normalSign = 1, seg = 32) {
  // disc in YZ plane at X=x, normal +/-X
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;

    const p0 = [x, cy, cz];
    const p1 = [x, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
    const p2 = [x, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];

    // flip winding when normalSign is -1
    if (normalSign > 0) pushTri(pos, nor, p0, p1, p2, [ 1, 0, 0]);
    else                pushTri(pos, nor, p0, p2, p1, [-1, 0, 0]);
  }
}

function addCylinder(cx, cy, cz, r, h, axis = "y", seg = 24) {
  const half = h / 2;

  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;

    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);

    if (axis === "y") {
      const p00 = [cx + c0*r, cy - half, cz + s0*r];
      const p01 = [cx + c0*r, cy + half, cz + s0*r];
      const p10 = [cx + c1*r, cy - half, cz + s1*r];
      const p11 = [cx + c1*r, cy + half, cz + s1*r];
      const n = [(c0 + c1) * 0.5, 0, (s0 + s1) * 0.5];
      pushTri(pos, nor, p00, p10, p11, n);
      pushTri(pos, nor, p00, p11, p01, n);
    }

    if (axis === "x") {
      const p00 = [cx - half, cy + c0*r, cz + s0*r];
      const p01 = [cx + half, cy + c0*r, cz + s0*r];
      const p10 = [cx - half, cy + c1*r, cz + s1*r];
      const p11 = [cx + half, cy + c1*r, cz + s1*r];
      const n = [0, (c0 + c1) * 0.5, (s0 + s1) * 0.5];
      pushTri(pos, nor, p00, p01, p11, n);
      pushTri(pos, nor, p00, p11, p10, n);
    }

    if (axis === "z") {
      const p00 = [cx + c0*r, cy + s0*r, cz - half];
      const p01 = [cx + c0*r, cy + s0*r, cz + half];
      const p10 = [cx + c1*r, cy + s1*r, cz - half];
      const p11 = [cx + c1*r, cy + s1*r, cz + half];
      const n = [(c0 + c1) * 0.5, (s0 + s1) * 0.5, 0];
      pushTri(pos, nor, p00, p10, p11, n);
      pushTri(pos, nor, p00, p11, p01, n);
    }
  }
}

function tireProfile(width, treadR, sideR, beadR) {
  const w2 = width / 2;
  const rings = 9;
  const arr = [];
  for (let k = 0; k < rings; k++) {
    const t = k / (rings - 1);        // 0..1
    const x = -w2 + t * width;        // across thickness (X)
    // nice bulge
    let r = sideR + (treadR - sideR) * (1 - (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.abs(0.5 - t) * 2))));
    if (k === 0 || k === rings - 1) r = beadR;
    if (k === 1 || k === rings - 2) r = (r + beadR) * 0.5;
    arr.push([x, r]); // [offsetX, radius]
  }
  return arr;
}

function addTireX(cx, cy, cz, rings, seg = 48) {
  // rings: array of [xOffset, radius] along X (thickness axis)
  for (let k = 0; k < rings.length - 1; k++) {
    const x0 = cx + rings[k][0];
    const x1 = cx + rings[k + 1][0];
    const r0 = rings[k][1];
    const r1 = rings[k + 1][1];

    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;

      const y00 = cy + Math.cos(a0) * r0, z00 = cz + Math.sin(a0) * r0;
      const y01 = cy + Math.cos(a1) * r0, z01 = cz + Math.sin(a1) * r0;
      const y10 = cy + Math.cos(a0) * r1, z10 = cz + Math.sin(a0) * r1;
      const y11 = cy + Math.cos(a1) * r1, z11 = cz + Math.sin(a1) * r1;

      const p00 = [x0, y00, z00];
      const p01 = [x0, y01, z01];
      const p10 = [x1, y10, z10];
      const p11 = [x1, y11, z11];

      // normals approx radial (ignoring taper)
      const n0 = [0, Math.cos(a0), Math.sin(a0)];
      const n1 = [0, Math.cos(a1), Math.sin(a1)];
      const n  = [0, (n0[1] + n1[1]) * 0.5, (n0[2] + n1[2]) * 0.5];

      pushTri(pos, nor, p00, p10, p11, n);
      pushTri(pos, nor, p00, p11, p01, n);
    }
  }
}

function addCurvedPlaneOverTireX(centerX, centerZ, radius, widthX, yOffset, seg=96){
  const innerX = centerX - widthX/2;
  const outerX = centerX + widthX/2;

  for (let i = 0; i < seg; i++){
    const t0 = i/seg, t1 = (i+1)/seg;
    const a0 = Math.PI * t0, a1 = Math.PI * t1; // 0..π arch

    // arch in Y/Z plane (wraps around the wheel front/back)
    const z0 = centerZ + Math.cos(a0) * radius;
    const y0 = yOffset + Math.sin(a0) * radius;
    const z1 = centerZ + Math.cos(a1) * radius;
    const y1 = yOffset + Math.sin(a1) * radius;

    // make a thin "strip" across X (tire width direction)
    const q0 = [innerX, y0 - 0.05, z0];
    const q1 = [outerX, y0 - 0.05, z0];
    const q2 = [outerX, y1 - 0.05, z1];
    const q3 = [innerX, y1 - 0.05, z1];

    // normal
    const am = 0.5 * (a0 + a1);
    let nx = 0;
    let ny = Math.sin(am);
    let nz = Math.cos(am);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    pushQuad(q0, q1, q2, q3, [nx, ny, nz]);

  }
}

function addHalfDisc(cx, cy, cz, r, axis='x', seg=32, flip=false){
  // build a TRIANGLE FAN: center -> rim i -> rim i+1
  const center = [cx, cy, cz];

  function nForAxis(){
    if(axis==='x') return [flip?-1:1, 0, 0];
    if(axis==='y') return [0, flip?-1:1, 0];
    return [0, 0, flip?-1:1]; // 'z'
  }
  const n = nForAxis();

  for(let i=0;i<seg;i++){
    const a0 = Math.PI * (i/seg);
    const a1 = Math.PI * ((i+1)/seg);

    let p0, p1;

    if(axis==='x'){
      // YZ plane 
      p0 = [cx, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r];
      p1 = [cx, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r];
    } else if(axis==='z'){
      // XY plane
      p0 = [cx + Math.cos(a0)*r, cy + Math.sin(a0)*r, cz];
      p1 = [cx + Math.cos(a1)*r, cy + Math.sin(a1)*r, cz];
    } else {
      // XZ plane
      p0 = [cx + Math.cos(a0)*r, cy, cz + Math.sin(a0)*r];
      p1 = [cx + Math.cos(a1)*r, cy, cz + Math.sin(a1)*r];
    }

    // flip winding if you want the normal reversed
    if(!flip) pushTri(pos, nor, center, p0, p1, n);
    else      pushTri(pos, nor, center, p1, p0, n);
  }
}

function addTandemFenderOverWheelsX(centerX, zRear, zFront, radius, widthX, yOffset, seg=220) {
  const innerX = centerX - widthX/2;
  const outerX = centerX + widthX/2;

  // normalize so "rear" is smaller Z and "front" is larger Z
  const zBack = Math.min(zRear, zFront);
  const zFwd  = Math.max(zRear, zFront);

  // overall span includes the outside half-curves
  const zMin = zBack - radius;
  const zMax = zFwd  + radius;

  // profile: back half-arch, then flat, then front half-arch
  function profileY(z){
    // rear OUTSIDE half only (zBack - r .. zBack)
    if (z <= zBack) {
      const dz = z - zBack; // [-r .. 0]
      if (dz >= -radius) {
        return yOffset + Math.sqrt(Math.max(0, radius*radius - dz*dz));
      }
      return yOffset;
    }

    // front OUTSIDE half only (zFwd .. zFwd + r)
    if (z >= zFwd) {
      const dz = z - zFwd; // [0 .. r]
      if (dz <= radius) {
        return yOffset + Math.sqrt(Math.max(0, radius*radius - dz*dz));
      }
      return yOffset;
    }

    // between wheel centers: FLAT the whole way (no inside curves)
    return yOffset + radius;
  }

  for (let i=0; i<seg; i++){
    const t0 = i/seg, t1 = (i+1)/seg;
    const z0 = zMin + (zMax - zMin) * t0;
    const z1 = zMin + (zMax - zMin) * t1;

    const y0 = profileY(z0);
    const y1 = profileY(z1);

    const q0 = [innerX, y0 - 0.05, z0];
    const q1 = [outerX, y0 - 0.05, z0];
    const q2 = [outerX, y1 - 0.05, z1];
    const q3 = [innerX, y1 - 0.05, z1];

    // normal: from profile slope (stable, no flipping)
    const zMid = 0.5 * (z0 + z1);
    const e = 0.001;
    const yA = profileY(zMid - e);
    const yB = profileY(zMid + e);
    const dydz = (yB - yA) / (2 * e);

    // surface is y(z), extruded across X => normal ~ (0, 1, -dydz)
    let nx = 0, ny = 1, nz = -dydz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

pushQuad(q0, q1, q2, q3, [nx, ny, nz]);

  }
}

function addTandemFenderSidePlateX(sideX, zRear, zFront, radius, yOffset, yBottom, seg=220, normalSign=+1) {
  const zBack = Math.min(zRear, zFront);
  const zFwd  = Math.max(zRear, zFront);

  const zMin = zBack - radius;
  const zMax = zFwd  + radius;

  // SAME profile as your tandem fender (no inside curves)
  function profileY(z){
    if (z <= zBack) {
      const dz = z - zBack; // [-r..0]
      if (dz >= -radius) return yOffset + Math.sqrt(Math.max(0, radius*radius - dz*dz));
      return yOffset;
    }
    if (z >= zFwd) {
      const dz = z - zFwd; // [0..r]
      if (dz <= radius) return yOffset + Math.sqrt(Math.max(0, radius*radius - dz*dz));
      return yOffset;
    }
    return yOffset + radius; // flat between wheels
  }

  for (let i=0; i<seg; i++){
    const t0 = i/seg, t1 = (i+1)/seg;
    const z0 = zMin + (zMax - zMin) * t0;
    const z1 = zMin + (zMax - zMin) * t1;

    const yTop0 = profileY(z0);
    const yTop1 = profileY(z1);

    // vertical strip on the side of the box (X = sideX)
    const p0 = [sideX, yBottom, z0];
    const p1 = [sideX, yBottom, z1];
    const p2 = [sideX, yTop1,  z1];
    const p3 = [sideX, yTop0,  z0];

    if (normalSign > 0) {
      pushQuad(p0, p1, p2, p3, [ 1, 0, 0]);
    } else {
      pushQuad(p1, p0, p3, p2, [-1, 0, 0]);
    }
  }
}

// inside lighting
const AMB_OUT=0.25
const AMB_IN=0.95

function drawInterior(start,count,rgb){
  if(count<=0)return
  gl.uniform1f(uTwoSided,1.0)
  gl.uniform1f(uAmbient,AMB_IN)
  gl.uniform3f(uColor,...rgb)
  gl.drawArrays(gl.TRIANGLES,start,count)
  gl.uniform1f(uTwoSided,0.0)
  gl.uniform1f(uAmbient,AMB_OUT)
}

function addTongueTube(A, B, width, height) {
  const ax = A[0], ay = A[1], az = A[2];
  const bx = B[0], by = B[1], bz = B[2];

  let dx = bx - ax;
  let dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;

  // sideways in XZ plane
  const sx = -dz * (width * 0.5);
  const sz =  dx * (width * 0.5);

  const hy = height * 0.5;

  // A end
  const A0 = [ax + sx, ay + hy, az + sz];
  const A1 = [ax - sx, ay + hy, az - sz];
  const A2 = [ax + sx, ay - hy, az + sz];
  const A3 = [ax - sx, ay - hy, az - sz];

  // B end
  const B0 = [bx + sx, by + hy, bz + sz];
  const B1 = [bx - sx, by + hy, bz - sz];
  const B2 = [bx + sx, by - hy, bz + sz];
  const B3 = [bx - sx, by - hy, bz - sz];

  // top
  pushQuad(A0, B0, B1, A1, [0, 1, 0]);

  // bottom
  pushQuad(A2, A3, B3, B2, [0, -1, 0]);

  // left side
  pushQuad(A1, B1, B3, A3, [-dz, 0, dx]);

  // right side
  pushQuad(A0, A2, B2, B0, [dz, 0, -dx]);

  // cap at A
  pushQuad(A0, A1, A3, A2, [-dx, 0, -dz]);

  // cap at B
  pushQuad(B0, B2, B3, B1, [dx, 0, dz]);
}

    function pushTriRev(pos,nor,a,b,c,nOverride){
        pushTri(pos,nor,a,c,b,nOverride)
    }

  const COLOR_MAP = {
    silver:[0.7, 0.7, 0.7],
    black:[0.1, 0.1, 0.1],
    charcoal:[0.35, 0.35, 0.35],
    white:[2.0, 2.0, 2.0],
    green:[0.0, 1.0, 0.0],
    blue:[0.0, 0.0, 1.0],
    red:[1.0, 0.0, 0.0],
    yellow:[1.5, 1.5, 0.0],
  };

function ocValueToSpacing(value, fallback) {
  if (value?.startsWith("12")) return OC_12;
  if (value?.startsWith("16")) return OC_16;
  if (value?.startsWith("24")) return OC_24;
  return fallback;
}

let bodyCount = 0;
let tongueStart = 0, tongueCount = 0;
let jackStart = 0, jackCount = 0;
let footStart = 0, footCount = 0;
let axleStart = 0, axleCount = 0;
let tireRStart = 0, tireRCount = 0;
let rimRStart  = 0, rimRCount  = 0;
let hubRStart  = 0, hubRCount  = 0;
let tireLStart = 0, tireLCount = 0;
let rimLStart  = 0, rimLCount  = 0;
let hubLStart  = 0, hubLCount  = 0;
let fendRStart = 0, fendRCount = 0;
let fendLStart = 0, fendLCount = 0;
let tandemAxleStart = 0, tandemAxleCount = 0;
let tandemWheelStart = 0, tandemWheelCount = 0;
let tandemTireStart = 0, tandemTireCount = 0;
let tandemFendRStart = 0, tandemFendRCount = 0;
let tandemFendLStart = 0, tandemFendLCount = 0;
let trimStart = 0, trimCount = 0;
let roofLineStart = 0, roofLineCount = 0;
let stoneGuardStart = 0, stoneGuardCount = 0;
let sideDoorTrimStart = 0, sideDoorTrimCount = 0;
let sideBarStart = 0, sideBarCount = 0;
let sideTipStart = 0, sideTipCount = 0;
let rearDoorStart = 0, rearDoorCount = 0;
let rearDoorTrimStart = 0, rearDoorTrimCount = 0;
let rearBarStart = 0, rearBarCount = 0;
let rearTipStart = 0, rearTipCount = 0;
let outerFendRStart = 0, outerFendRCount = 0;
let outerFendLStart = 0, outerFendLCount = 0;
let innerFloorStart = 0, innerFloorCount = 0;
let innerWallStart = 0, innerWallCount = 0;
let innerRoofStart = 0, innerRoofCount = 0;
let noseInnerFloorStart = 0, noseInnerFloorCount = 0;
let roofStart = 0, roofCount = 0;
let innerVNoseStart = 0, innerVNoseCount = 0;
let vNoseStart = 0, vNoseCount = 0;
let innerDoorStart = 0, innerDoorCount = 0;
let vnoseStudStart = 0, vnoseStudCount = 0;
let floorCrossStart = 0, floorCrossCount = 0;
let wallStudStart = 0, wallStudCount = 0;
let roofMemberStart = 0, roofMemberCount = 0;
let innerFendStart = 0, innerFendCount = 0;
let bottomStart = 0, bottomCount = 0;
let groundStart = 0, groundCount = 0;
let rearFlareStart = 0, rearFlareCount = 0;
let topFlareStart = 0, topFlareCount = 0;

let interiorView = false;
let axleMode = 'single';
let rearFlare = false;

  function rebuildMesh() {
    // Core dimensions
    const L = dims.lengthFt * UNITS_PER_FOOT;
    const W = dims.widthFt  * UNITS_PER_FOOT;
    const H = dims.heightFt * UNITS_PER_FOOT;
    pos.length = 0;
    nor.length = 0;
    outerFendRStart = 0; outerFendRCount = 0;
    outerFendLStart = 0; outerFendLCount = 0;
    roofStart = 0; roofCount = 0;
    fendRStart = 0; fendRCount = 0;
    fendLStart = 0; fendLCount = 0;
    tandemFendRStart = 0; tandemFendRCount = 0;
    tandemFendLStart = 0; tandemFendLCount = 0;
    outerFendRStart = 0; outerFendRCount = 0;
    outerFendLStart = 0; outerFendLCount = 0;
    innerFendStart = 0; innerFendCount = 0;
    roofStart = 0; roofCount = 0;
    bottomStart = 0; bottomCount = 0;
    floorCrossStart = 0; floorCrossCount = 0;
    roofMemberStart = 0; roofMemberCount = 0; 
    rearFlareStart = 0; rearFlareCount = 0;
    topFlareStart = 0; topFlareCount = 0;

    // V nose sizing and main extents
    const safeMax = Math.max(2, dims.lengthFt - 2);
    const Nft = Math.min(Math.max(2, noseLenFt), safeMax);
    const N = Nft * UNITS_PER_FOOT;
    const zBack = -L * 0.5;
    const zApex =  L * 0.5;
    const zNoseBase = zApex - N;
    const xL = -W * 0.5;
    const xR =  W * 0.5;
    const yB = -H * 0.5;
    const yT =  H * 0.5;

    // Key corners and apex points
    const BLB = [xL,yB,zBack];
    const BRB = [xR,yB,zBack];
    const BRT = [xR,yT,zBack];
    const BLT = [xL,yT,zBack];
    const NLB = [xL,yB,zNoseBase];
    const NRB = [xR,yB,zNoseBase];
    const NRT = [xR,yT,zNoseBase];
    const NLT = [xL,yT,zNoseBase];
    const APEX_B = [0,yB,zApex];
    const APEX_T = [0,yT,zApex];

    // V nose normals
    const vEdgeL = [APEX_B[0] - NLB[0], 0, APEX_B[2] - NLB[2]];
    const vEdgeR = [APEX_B[0] - NRB[0], 0, APEX_B[2] - NRB[2]];
    const up = [0, 1, 0];
    const nNoseL = norm(cross(vEdgeL, up));
    const nNoseR = norm(cross(up, vEdgeR));

    // Tongue beams and attach points
    const beamThick = 0.1 * UNITS_PER_FOOT;
    const beamTall  = 0.3 * UNITS_PER_FOOT;
    const tongueLenFt = 2;
    const tongueLen = tongueLenFt * UNITS_PER_FOOT;
    const attachInset = W * 0.08;
    const leftBase  = [xL + .01, yB + beamTall * -0.2, zNoseBase - 0.3];
    const rightBase = [xR - .01, yB + beamTall * -0.2, zNoseBase - 0.3];
    const tip = [0, yB + beamTall * -0.2, zApex + tongueLen];

    // Tongue cross member points
    const tTongue = 0.80;
    const pL  = lerp3(leftBase,  tip, tTongue);
    const pR  = lerp3(rightBase, tip, tTongue);
    const tTongue2 = 0.70;
    const pL2 = lerp3(leftBase,  tip, tTongue2);
    const pR2 = lerp3(rightBase, tip, tTongue2);

    // Jack location and sizes
    const jackX = (pL[0] + pR[0] + pL2[0] + pR2[0]) / 4;
    const jackZ = (pL[2] + pR[2] + pL2[2] + pR2[2]) / 4;
    const jackHeight = 1.5 * UNITS_PER_FOOT;
    const jackRadius = 0.2 * UNITS_PER_FOOT;
    const jackY = (pL[1] + pL2[1]) / 2 - 0.27 * UNITS_PER_FOOT;
    const footHeight = jackHeight * 1.0;
    const footRadius = jackRadius * 1.10;
    const plateThickness = 0.05 * UNITS_PER_FOOT;
    const plateRadius = footRadius * 1.5;

    // Axle placement and wheel sizes
    const boxLen = zNoseBase - zBack;
    const axleFromRearFt = Math.max(2.5, dims.lengthFt * 0.22);
    let axleZ = zBack + axleFromRearFt * UNITS_PER_FOOT;
    axleZ = Math.min(axleZ, zNoseBase - 0.25);
    axleZ = Math.max(axleZ, zBack + 0.25);
    const tireRadiusFt = 0.8;
    const tireWidthFt  = 0.7;
    const tireR = tireRadiusFt * UNITS_PER_FOOT;
    const tireW = tireWidthFt  * UNITS_PER_FOOT;
    const tireTreadR = tireR;
    const tireSideR = tireR * 0.96;
    const beadR = tireR * 0.70;
    const rimR = beadR;
    const rimW = tireW * 0.70;
    const hubR = rimR;
    const hubW = rimW * 1.45;
    const rings = tireProfile(tireW, tireTreadR, tireSideR, beadR);
    const axleRadius = 0.10 * UNITS_PER_FOOT;
    const axleY = yB + tireR * 0.5;
    const wheelY = yB + tireR - 0.25;
    const wheelGap = 0.02;

    // Width mode
    const widthIn = Math.round(dims.widthFt * 12);
    const isWide102 = (widthIn === 102);

    // Wheel track lock for 102
    const W84 = (84 / 12) * UNITS_PER_FOOT;
    const wheelXRight84 = (W84 * 0.5) + (tireW * 0.5) + wheelGap;
    const wheelXRight = isWide102 ? wheelXRight84 : ((W * 0.5) + (tireW * 0.5) + wheelGap);
    const wheelXLeft  = -wheelXRight;
    const axleSpanW = isWide102 ? W84 : W;
    const axleSpan = axleSpanW + tireW * 2;

    // Fender and tandem positions
    const fenderY0  = wheelY + tireR * 0.10;
    const fenderR   = tireR * 1.10;
    const fenderW   = tireW * 1.05;
    const fenderYc  = fenderY0 + 0.03;
    const fZBack    = axleZ - fenderW * 0.5;
    const fZFront   = axleZ + fenderW * 0.5;
    const eps = 0.001;
    const capY = fenderY0;
    const capZ = axleZ;
    const capR = fenderR;
    const zRear  = axleZ - 0.3;
    const zFront = axleZ + 0.3;
    const tFenderR  = fenderR;
    const tFenderW  = fenderW;
    const tFenderY  = fenderYc + 0.02;

    // Body trim loop and roof lines
    const TRIM_T = 0.06 * UNITS_PER_FOOT;
    const TRIM_H = 0.06 * UNITS_PER_FOOT;
    const OX = TRIM_T * 0.6;
    const OZ = TRIM_T * 0.6;
    const yTopTrim = yT + TRIM_H * 0.5;
    const yBotTrim = yB - TRIM_H * 0.5;
    const lineThickY = (0.04 / 1.5) / 50;
    const lineThickZ = 0.03;
    const insetX = 0.03;
    const insetRearZ = 0.08;
    const roofY = yT + lineThickY * 0.5 + 0.001;
    const xSpan = (xR - xL) - insetX * 2;
    const xCenter = (xL + xR) * 0.5;
    const zStart = zNoseBase;
    const zEnd = zBack + insetRearZ;
    const ROOF_LINE_SPACING = 0.36; // pick the look you want
    const spacing = ROOF_LINE_SPACING;

    // Stone guard placement and nose strips
    const guardH = Math.min(H * 0.30, 0.55);
    const guardY0 = yB;
    const guardY1 = yB + guardH;
    const guardOffset = 0.001;
    const stripUCenter = 0.82;
    const stripUWidth  = 0.14;
    const stripY0 = guardY1;
    const stripY1 = yT;
    const yInsetTop = 0.01;
    const yInsetBot = 0.00;

    // Side door placement and sizing
    const zLen = (zNoseBase - zBack);
    const marginFromFront = zLen * 0.18;
    const doorZCenter = zNoseBase - marginFromFront;
    const doorH = 0.80;
    const doorW = doorH * 0.45;
    const threshold = .1;
    const y0 = yB + threshold;
    const y1 = y0 + doorH;
    const z0 = doorZCenter - doorW * 0.5;
    const z1 = doorZCenter + doorW * 0.5;
    const trimW = H * 0.02;
    const wallOut = 0.004;
    const wallIn  = 0.004;
    const DOOR_SIDE = "left";
    const outwardDir = (DOOR_SIDE === "right") ? 1 : -1;
    const nOut = [outwardDir, 0, 0];
    const nIn  = [-outwardDir, 0, 0];
    const xWallOutside = (DOOR_SIDE === "right") ? (xR + wallOut) : (xL - wallOut);
    const xWallInside  = (DOOR_SIDE === "right") ? (xR - wallIn)  : (xL + wallIn);
    const trimOut   = 0.010;
    const panelOut  = 0.006;
    const doorInset = 0.010;
    const xDoorPanel = xWallOutside + outwardDir * panelOut + 0.009;
    const xDoorTrim  = xWallOutside + outwardDir * trimOut + 0.009;
    const frameW = H * 0.02;
    const innerFrameW = H * 0.02;
    const barOut = 0.006;
    const xDoorBar   = xDoorTrim + outwardDir * barOut;
    const xDoorTip   = xDoorBar - outwardDir * 0.001 - 0.009;
    const xDoorInner = xWallInside - outwardDir * doorInset - 0.0151;
    const barW = doorW * 0.55;
    const barH = doorH * 0.035;
    const yBarC = (y0 + y1) * 0.55;
    const yb0 = yBarC - barH * 0.5;
    const yb1 = yBarC + barH * 0.5;
    const zBar0 = z0 + doorW * 0.18 - 0.1;
    const zBar1 = zBar0 + barW;
    const tipW = barW * 0.18;
    const zTip0 = zBar1 - tipW;
    const zTip1 = zBar1;

    // Rear door normals and sizing
    const nOutB = [0, 0, -1];
    const nInB  = [0, 0,  1];
    const rearDoorH = H * 0.75;
    const rearDoorSideMargin = W * 0.12;
    const rearDoorW = Math.max(0.4, W - rearDoorSideMargin * 4);
    const rearThreshold = H * 0.05;
    const ry0 = yB + rearThreshold;
    const ry1 = Math.min(ry0 + rearDoorH, yT - H * 0.05);
    const rxC = (xL + xR) * 0.5;
    const rx0 = rxC - rearDoorW * 0.5;
    const rx1 = rxC + rearDoorW * 0.5;
    const rearWallOut = wallOut;
    const rearWallIn  = wallIn;
    const zWallOutside = zBack - rearWallOut;
    const zWallInside  = zBack + rearWallIn;
    const rearTrimOut   = 0.010;
    const rearPanelOut  = 0.006;
    const rearDoorInset = 0.010;
    const rearBarOut    = 0.006;
    const zRearPanel = zWallOutside - rearPanelOut;
    const zRearTrim  = zWallOutside - rearTrimOut;
    const zRearBar   = zRearTrim - rearBarOut;
    const zRearTip   = zRearBar - 0.001;
    const zRearInner = zWallInside + rearDoorInset;
    const rearFrameW = H * 0.02;
    const rearInnerFrame = H * 0.02;
    const rearBarW = rearDoorW * 0.22;
    const rearBarH = rearDoorH * 0.035;
    const rBarYC = (ry0 + ry1) * 0.55;
    const rby0 = rBarYC - rearBarH * 0.5;
    const rby1 = rBarYC + rearBarH * 0.5;
    const rearBarMargin = rearDoorW * 0.10;
    const rBarX0 = rx0 - rearBarMargin;
    const rBarX1 = rBarX0 - rearBarW;
    const rearTipW = rearBarW * 0.18;
    const rTipX0 = rBarX0;
    const rTipX1 = rBarX0 + rearTipW;

    // Cut out for 102 wide
    const cutZHalf = tireR * 1.10;
    const cutYTop = Math.min(yT - 0.03, (wheelY + tireR * 1.05));
    const cutRearPad = 0.01;
    const cutFrontPad = 0.02;
    const zWheelRear = axleZ + 0.10;
    const zWheelFront = axleZ + 0.40;
    const zCut1 = Math.min(zNoseBase - 0.06, zWheelFront + tireR + cutFrontPad);
    const yCut1 = cutYTop + 0.07;
    const zCut0 = Math.max(zBack + 0.06, zWheelRear - tireR - cutRearPad);
    const cutCornerR = Math.min(tireR * 0.55, (zCut1 - zCut0) * 0.25, (yCut1 - yB) * 0.60);
    const rampLen = Math.min((zCut1 - zCut0) * 0.20, tireR * 0.70);
    const cutSeg = 42;
    const wellDepth = 0.35;
    const wellSeg = 48;
    const xWallInR = xR - wallIn;
    const xWallInL = xL + wallIn;
    const xWellPlateR = xWallInR - wellDepth;
    const xWellPlateL = xWallInL + wellDepth;

    //Teardrop fender 
    const fTop = wheelY + tireR * 1.10;
    const fDip = fTop - tireR * 0.55;
    const fPad = tireR * 0.20;
    const fSegR = tireR * 1.35;
    const nTop = [0, 1, 0];
    const nPlateR = [ 1, 0, 0];
    const nPlateL = [-1, 0, 0];
    const nTopLocal = [0, 1, 0];

    // 102 wide
    const x84L = -W84 * 0.5;
    const x84R =  W84 * 0.5;
    const nD = [0, -1, 0];
    const nL = [-1, 0, 0];
    const nR = [ 1, 0, 0];

    // inside walls
    const inset=0.006
    const xLi = xL + wallIn
    const xRi = xR - wallIn
    const zBi = zBack + wallIn
    const zFi = zNoseBase - wallIn
    const nInL = [ 1, 0, 0]
    const nInR = [-1, 0, 0]
    const nInBack = [0, 0, 1]
    const zBaseI = zNoseBase + inset
    const zApexI = zApex - inset
    const yBi = yB + inset
    const yTi = yT - inset
    const NLB_i = [xLi, yBi, zBaseI]
    const NLT_i = [xLi, yTi, zBaseI]
    const NRB_i = [xRi, yBi, zBaseI]
    const NRT_i = [xRi, yTi, zBaseI]
    const APEX_B_i = [0,   yBi, zApexI]
    const APEX_T_i = [0,   yTi, zApexI]
    const nInNoseL = [-nNoseL[0], -nNoseL[1], -nNoseL[2]]
    const nInNoseR = [-nNoseR[0], -nNoseR[1], -nNoseR[2]]
    const NLB_IN=[xL+inset,yB,zNoseBase]
    const NLT_IN=[xL+inset,yT,zNoseBase]
    const NRB_IN=[xR-inset,yB,zNoseBase]
    const NRT_IN=[xR-inset,yT,zNoseBase]
    const APEX_B_IN=[0,yB,zApex-inset]
    const APEX_T_IN=[0,yT,zApex-inset]
    const nInRoof = [0, -1, 0]

    // floor
    const floorY=yB-0.001
    const innerFloorY=yB+0.04
    const floorTopY=yB+0.05
    const floorBotY=yB

    // studs
    const railT=TRIM_T
    const crossSX=(xR-xL)
    const crossSY=railT
    const crossSZ=railT
    const studSX=railT
    const studSZ=railT
    const studSY=(yT-yB)
    const crossY=yB-0.009
    const studY=(yB+yT)*0.5
    const xStudL=xL+studSX*0.5
    const xStudR=xR-studSX*0.5
    const zMinBox=zBack
    const zMaxBox=zNoseBase
    const defaultFloorOC = (axleMode === "tandem") ? OC_16 : OC_24;
    const defaultWallOC  = defaultFloorOC;
    const defaultRoofOC  = OC_24;
    const floorOC = ocValueToSpacing(ocFloorSel?.value, defaultFloorOC);
    const wallOC  = ocValueToSpacing(ocWallSel?.value,  defaultWallOC);
    const roofOC  = ocValueToSpacing(ocRoofSel?.value,  defaultRoofOC);
    if (structurePreview) {
      const floorCrossDefault = buildFloorCrossmembers(floorOC);
      const wallStudDefault   = buildWallStuds(wallOC);
      floorCrossStart = floorCrossDefault.start;
      floorCrossCount = floorCrossDefault.count;
      wallStudStart = wallStudDefault.start;
      wallStudCount = wallStudDefault.count;
    }
    const VNoseOC = wallOC;
    const dzN=(zApex-zNoseBase)
    const edgeLenL=Math.hypot(xL, dzN)||1
    const edgeLenR=Math.hypot(xR, dzN)||1
    const edgeLen=Math.max(edgeLenL,edgeLenR)
    const vnCount=Math.max(2,Math.floor(edgeLen/VNoseOC)+1)
    const roofMemberY = yT - wallIn - .002;
    const roofMemberDefault = buildRoofMembers(roofOC);
    roofMemberStart = roofMemberDefault.start;
    roofMemberCount = roofMemberDefault.count;

    //Ground
    const groundY = yB - 0.21;
    const groundSize = 20.0;

    //Rear Flare
    const rearFlareDepth = .5 * UNITS_PER_FOOT;
    const rearFlareDrop = (.01 / 12) * UNITS_PER_FOOT;
    const rearFlareThickness = (2.5 / 12) * UNITS_PER_FOOT;
    const rearFlareSideOverhang = dims.widthFt*.000099999;
    const flareX0 = xL - rearFlareSideOverhang;
    const flareX1 = xR + rearFlareSideOverhang;
    const flareZInner = zBack - 0.002;
    const flareZOuter = flareZInner - rearFlareDepth;
    const flareYInnerTop = yT;
    const flareYOuterTop = yT - rearFlareDrop;
    const flareYInnerBottom = flareYInnerTop - rearFlareThickness;
    const flareYOuterBottom = flareYOuterTop - rearFlareThickness;
    const flareSlopeLen = Math.hypot(rearFlareDepth, rearFlareDrop) || 1;

    const flareTopNormal = [
        0,
        rearFlareDepth / flareSlopeLen,
        -rearFlareDrop / flareSlopeLen
    ];

    const flareBottomNormal = [
        0,
        -rearFlareDepth / flareSlopeLen,
        rearFlareDrop / flareSlopeLen
    ];

    function buildRoofMembers(oc) {
      const start = pos.length / 3;
      const roofMemberY = yT - wallIn - .0015;
      const roofMemberSX = (xRi - xLi);
      const roofMemberSY = railT;
      const roofMemberSZ = railT;
      const zs = makeZs(zMinBox, zMaxBox, oc);
      for (const z of zs) {
        addBox(
          (xLi + xRi) * 0.5,
          roofMemberY,
          z,
          roofMemberSX,
          roofMemberSY,
          roofMemberSZ
        );
      }
      return { start, count: (pos.length / 3) - start, zs };
    }

    function addOuterFenderSidePlateWithHolesX(side, zRear, zFront, radius, yOffset, yBottom, outOffset = 0.07, holeY, holeR, holePadZ = 0.00, seg = 260){
        const dir = (side === "right") ? 1 : -1;
        const xWallOutLocal = (side === "right") ? (xR + wallOut) : (xL - wallOut);
        const xOuter = xWallOutLocal + dir * outOffset;
        const nOuter = (side === "right") ? [ 1, 0, 0] : [-1, 0, 0];
        const zBack = Math.min(zRear, zFront);
        const zFwd  = Math.max(zRear, zFront);
        const zMin  = zBack - radius;
        const zMax  = zFwd  + radius;
        // Fender top profile: curve–flat–curve (same idea as tandem fender)
        function profileY(z){
          if (z <= zBack) {
            const dz = z - zBack; // [-r..0]
            if (dz >= -radius) return yOffset + Math.sqrt(Math.max(0, radius*radius - dz*dz));
            return yOffset;
          }
          if (z >= zFwd) {
            const dz = z - zFwd; // [0..r]
            if (dz <= radius) return yOffset + Math.sqrt(Math.max(0, radius*radius - dz*dz));
            return yOffset;
          }
          return yOffset + radius; // flat between wheels
        }
        // Wheel hole “top” at a given z for a wheel centered at zC
        function holeTopYForWheel(z, zC){
          const dz = z - zC;
          const R  = holeR;
          const inside = R*R - dz*dz;
          if (inside <= 0) return -1e9;
          return holeY + Math.sqrt(inside);
        }
        for (let i=0; i<seg; i++){
          const t0 = i/seg, t1 = (i+1)/seg;
          const z0 = zMin + (zMax - zMin) * t0;
          const z1 = zMin + (zMax - zMin) * t1;
          const yTop0 = profileY(z0);
          const yTop1 = profileY(z1);
          // hole top for BOTH wheels (take the max)
          const yHole0 = Math.max(holeTopYForWheel(z0, zRear), holeTopYForWheel(z0, zFront));
          const yHole1 = Math.max(holeTopYForWheel(z1, zRear), holeTopYForWheel(z1, zFront));
          // start drawing at bottom OR above the hole if we're in the opening region
          const yStart0 = Math.max(yBottom, yHole0);
          const yStart1 = Math.max(yBottom, yHole1);
          // if the hole completely eats the plate at this z slice, skip
          if (yStart0 >= yTop0 && yStart1 >= yTop1) continue;
          pushQuad(
              [xOuter, yStart0, z0],
              [xOuter, yStart1, z1],
              [xOuter, yTop1,   z1],
              [xOuter, yTop0,   z0],
              nOuter
          );
        }
    }

    function cutBoundaryY(z) {
        const z0 = zCut0;
        const z1 = zCut1;
        const r = cutCornerR;
        const yTop = yCut1;
        const zcL = z0 + r;
        const zcR = z1 - r;
        const yc = yTop - r;
        if (z < zcL) {
          const dz = z - zcL;
          const inside = Math.max(0, r * r - dz * dz);
          return yc + Math.sqrt(inside);
        }
        if (z > zcR) {
            const dz = z - zcR;
            const inside = Math.max(0, r * r - dz * dz);
            return yc + Math.sqrt(inside);
        }
        return yTop;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function openingTopY(z) {
      const yCurve = cutBoundaryY(z);
      if (rampLen > 1e-6) {
        if (z <= zCut0 + rampLen) {
          const t = Math.max(0, Math.min(1, (z - zCut0) / rampLen));
          return lerp(yB, yCurve, t);
        }
        if (z >= zCut1 - rampLen) {
          const t = Math.max(0, Math.min(1, (zCut1 - z) / rampLen));
          return lerp(yB, yCurve, t);
        }
      }
      return yCurve;
    }

    // V-nose side normals (stable, outward)
    function cross(a,b){
      return [
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0]
      ];
    }
    function norm(v){
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }
function addWellTopPlate(xA, xB, nTopLocal) {
  for (let i = 0; i < wellSeg; i++) {
    const t0 = i / wellSeg;
    const t1 = (i + 1) / wellSeg;
    const zA  = zCut0 + (zCut1 - zCut0) * t0;
    const zB2 = zCut0 + (zCut1 - zCut0) * t1;

    const yA  = Math.max(openingTopY(zA), yBotTrim);
    const yB3 = Math.max(openingTopY(zB2), yBotTrim);

    pushQuad(
      [xA, yA,  zA],
      [xB, yA,  zA],
      [xB, yB3, zB2],
      [xA, yB3, zB2],
      nTopLocal
    );
  }
};
    function addWellBackPlate(sideX, nSide) {
        for (let i = 0; i < wellSeg; i++) {
          const t0 = i / wellSeg;
          const t1 = (i + 1) / wellSeg;
          const zA  = zCut0 + (zCut1 - zCut0) * t0;
          const zB2 = zCut0 + (zCut1 - zCut0) * t1;
          const yA  = openingTopY(zA);
          const yB3 = openingTopY(zB2);
          pushQuad(
              [sideX, yBotTrim, zA],
              [sideX, yBotTrim, zB2],
              [sideX, yB3, zB2],
              [sideX, yA,  zA],
              nSide
         );
        }
       };

    // left V-nose wall
    pushTri(pos,nor, NLB, NLT, APEX_T, nNoseL);
    pushTri(pos,nor, NLB, APEX_T, APEX_B, nNoseL);

    // right V-nose wall
    pushTri(pos,nor, NRB, APEX_B, APEX_T, nNoseR);
    pushTri(pos,nor, NRB, APEX_T, NRT, nNoseR);

    // rear wall
    pushTri(pos,nor, BLB, BRT, BRB, [0,0,-1]);
    pushTri(pos,nor, BLB, BLT, BRT, [0,0,-1]);
    

    if (!isWide102) {
      // left and right walls
      pushTri(pos,nor, BLB, NLT, BLT, [-1,0,0]);
      pushTri(pos,nor, BLB, NLB, NLT, [-1,0,0]);
      pushTri(pos,nor, BRB, BRT, NRT, [1,0,0]);
      pushTri(pos,nor, BRB, NRT, NRB, [1,0,0]);
    } else {
        // Left wall rear section
        pushQuad(
            [xL, yB, zBack],
            [xL, yB, zCut0],
            [xL, yT, zCut0],
            [xL, yT, zBack],
            nL
        );

        // Left wall front section
        pushQuad(
            [xL, yB, zCut1],
            [xL, yB, zNoseBase],
            [xL, yT, zNoseBase],
            [xL, yT, zCut1],
            nL
        );

        // Left wall above the opening (drive-over ramps + rounded corners)(Good)
        for (let i = 0; i < cutSeg; i++) {
            const t0 = i / cutSeg;
            const t1 = (i + 1) / cutSeg;

            const zA = zCut0 + (zCut1 - zCut0) * t0;
            const zB2 = zCut0 + (zCut1 - zCut0) * t1;

            const yA = openingTopY(zA);
            const yB3 = openingTopY(zB2);

            pushQuad(
                [xL, yA,  zA],
                [xL, yB3, zB2],
                [xL, yT,  zB2],
                [xL, yT,  zA],
                nL
            );
        }

        // Right wall rear section
        pushQuad(
            [xR, yB, zCut0],
            [xR, yB, zBack],
            [xR, yT, zBack],
            [xR, yT, zCut0],
            [ 1, 0, 0]
        );

        // Right wall front section
        pushQuad(
            [xR, yB, zNoseBase],
            [xR, yB, zCut1],
            [xR, yT, zCut1],
            [xR, yT, zNoseBase],
            [ 1, 0, 0]
        );

        // Right wall above the opening 
        for (let i = 0; i < cutSeg; i++) {
            const t0 = i / cutSeg;
            const t1 = (i + 1) / cutSeg;

            const zA = zCut1 - (zCut1 - zCut0) * t0;
            const zB2 = zCut1 - (zCut1 - zCut0) * t1;

            const yA = openingTopY(zA);
            const yB3 = openingTopY(zB2);

            pushQuad(
                [xR, yA,  zA],
                [xR, yB3, zB2],
                [xR, yT,  zB2],
                [xR, yT,  zA],
                nR
            );
        }
    }

if (rearFlare) {

    rearFlareStart = pos.length / 3;

    // UNDERSIDE
    pushQuad(
        [flareX0, flareYInnerBottom, flareZInner],
        [flareX0, flareYOuterBottom, flareZOuter],
        [flareX1, flareYOuterBottom, flareZOuter],
        [flareX1, flareYInnerBottom, flareZInner],
        flareBottomNormal
    );


    // LEFT SIDE
    pushQuad(
        [flareX0, flareYInnerBottom, flareZInner],
        [flareX0, flareYInnerTop, flareZInner],
        [flareX0, flareYOuterTop, flareZOuter],
        [flareX0, flareYOuterBottom, flareZOuter],
        [-1, 0, 0]
    );


    // RIGHT SIDE
    pushQuad(
        [flareX1, flareYInnerTop, flareZInner],
        [flareX1, flareYInnerBottom, flareZInner],
        [flareX1, flareYOuterBottom, flareZOuter],
        [flareX1, flareYOuterTop, flareZOuter],
        [1, 0, 0]
    );


    // OUTER / REAR EDGE
    pushQuad(
        [flareX0, flareYOuterBottom, flareZOuter],
        [flareX0, flareYOuterTop, flareZOuter],
        [flareX1, flareYOuterTop, flareZOuter],
        [flareX1, flareYOuterBottom, flareZOuter],
        [0, 0, -1]
    );


    rearFlareCount =
        (pos.length / 3) - rearFlareStart;
}
    bodyCount = pos.length / 3;

    // TOP - roof extension to the end of the flare.
    // Kept out of the body range so it is only drawn once, in ROOF colour.
    if (rearFlare) {
        topFlareStart = pos.length / 3;
        pushQuad(
            [flareX0, flareYInnerTop, flareZInner],
            [flareX1, flareYInnerTop, flareZInner],
            [flareX1, flareYOuterTop, flareZOuter],
            [flareX0, flareYOuterTop, flareZOuter],
            flareTopNormal
        );
        topFlareCount = (pos.length / 3) - topFlareStart;
    }

    bottomStart = pos.length / 3;
    if (!isWide102) {
      pushTri(pos, nor, BLB, BRB, NRB, [0, -1, 0]);
      pushTri(pos, nor, BLB, NRB, APEX_B, [0, -1, 0]);
      pushTri(pos, nor, BLB, APEX_B, NLB, [0, -1, 0]);
    } else {
      // rear floor
      pushQuad(
        [xL, yB, zBack],
        [xR, yB, zBack],
        [xR, yB, zCut0],
        [xL, yB, zCut0],
        [0, -1, 0]
      );
      // middle floor
      pushQuad(
        [x84L, yB, zCut0],
        [x84R, yB, zCut0],
        [x84R, yB, zCut1],
        [x84L, yB, zCut1],
        [0, -1, 0]
      );
      // front floor
      pushQuad(
        [xL, yB, zCut1],
        [xR, yB, zCut1],
        [xR, yB, zNoseBase],
        [xL, yB, zNoseBase],
        [0, -1, 0]
      );
      // V-nose floor
      pushTri(pos, nor, NLB, APEX_B, NRB, [0, -1, 0]);
    }
    bottomCount = (pos.length / 3) - bottomStart;
    
    tongueStart = pos.length / 3;
    addTongueTube(leftBase, tip, beamThick, beamTall);
    addTongueTube(rightBase, tip, beamThick, beamTall);

    // Cross bars across tongue
    function lerp3(A, B, t) {
      return [
        A[0] + (B[0]-A[0]) * t,
        A[1] + (B[1]-A[1]) * t,
        A[2] + (B[2]-A[2]) * t,
      ];
    }

    addRectBeam(pL, pR, beamThick, beamTall, 0.35);

    addRectBeam(pL2, pR2, beamThick, beamTall, 0.35);
    tongueCount = (pos.length / 3) - tongueStart;

    roofStart = pos.length / 3;
    pushTri(pos,nor, BLT, BRT, NRT, [0,1,0]);
    pushTri(pos,nor, BLT, NRT, APEX_T, [0,1,0]);
    pushTri(pos,nor, BLT, APEX_T, NLT, [0,1,0]);
    roofCount = (pos.length / 3) - roofStart;

    vNoseStart = pos.length / 3;
    // under side floor
    if (!isWide102) {
      pushTri(pos,nor, BLB, NLT, BLT, [-1,0,0]);
      pushTri(pos,nor, BLB, NLB, NLT, [-1,0,0]);
      pushTri(pos,nor, BLB, BRB, NRB, [0,-1,0]);
      pushTri(pos,nor, BLB, NRB, APEX_B, [0,-1,0]);
      pushTri(pos,nor, BLB, APEX_B, NLB, [0,-1,0]);
    }else{
        // GOOD
        // rear floor
        pushQuad(
            [xL,  yB, zBack],
            [xR,  yB, zBack],
            [xR,  yB, zCut0],
            [xL,  yB, zCut0],
            nD
        );
        // floor near fenders(mid)
        pushQuad(
            [x84L, yB, zCut0],
            [x84R, yB, zCut0],
            [x84R, yB, zCut1],
            [x84L, yB, zCut1],
            nD
        );
        // front floor
        pushQuad(
            [xL,  yB, zCut1],
            [xR,  yB, zCut1],
            [xR,  yB, zNoseBase],
            [xL,  yB, zNoseBase],
            nD
        );
        // V-nose Floor
        pushTri(pos,nor, NLB, APEX_B, NRB, nD);
        // Left wall rear section
        pushQuad(
            [xL, yB, zBack],
            [xL, yB, zCut0],
            [xL, yT, zCut0],
            [xL, yT, zBack],
            nL
        );

        // Left wall front section (outer wall)
        pushQuad(
            [xL, yB, zCut1],
            [xL, yB, zNoseBase],
            [xL, yT, zNoseBase],
            [xL, yT, zCut1],
            nL
        );

        // Left wall above the opening (drive-over ramps + rounded corners)
        for (let i = 0; i < cutSeg; i++) {
            const t0 = i / cutSeg;
            const t1 = (i + 1) / cutSeg;

            const zA = zCut0 + (zCut1 - zCut0) * t0;
            const zB2 = zCut0 + (zCut1 - zCut0) * t1;

            const yA = openingTopY(zA);
            const yB3 = openingTopY(zB2);

            pushQuad(
                [xL, yA,  zA],
                [xL, yB3, zB2],
                [xL, yT,  zB2],
                [xL, yT,  zA],
                nL
            );
        }
    }

    // left V-nose wall
    pushTri(pos,nor, NLB, NLT, APEX_T, nNoseL);
    pushTri(pos,nor, NLB, APEX_T, APEX_B, nNoseL);

    // right V-nose wall
    pushTri(pos,nor, NRB, APEX_B, APEX_T, nNoseR);
    pushTri(pos,nor, NRB, APEX_T, NRT, nNoseR);
    vNoseCount = (pos.length / 3) - vNoseStart;

    jackStart = pos.length / 3;

    // main jack
    addDisc(jackX, jackY + jackHeight/2 + .123, jackZ, jackRadius + .004, "y", 32);
    addCylinder(jackX, jackY + footHeight/2 - .01, jackZ, footRadius, footHeight, "y", 32);
    jackCount = (pos.length / 3) - jackStart;

    // small foot cylinder
    footStart = pos.length / 3;
    addCylinder(jackX, jackY + jackHeight/5 - .05, jackZ, jackRadius, jackHeight, "y", 32);

    // plate under foot 
    addBox(jackX, jackY - plateThickness/2 - .14, jackZ, plateRadius*2, plateThickness, plateRadius*2);
    footCount = (pos.length / 3) - footStart;

    // axle
    axleStart = pos.length / 3;
    
    addCylinder(0, axleY - .13, axleZ, axleRadius, (W + tireW*2), "x", 32);
    axleCount = (pos.length / 3) - axleStart;

    tireRStart = pos.length / 3;
    addTireX(wheelXRight, wheelY + .05, axleZ, rings, 64);
    tireRCount = (pos.length / 3) - tireRStart;

    rimRStart = pos.length / 3;
    addCylinder(wheelXRight, wheelY + .05, axleZ, rimR, rimW, "x", 64);    
    rimRCount = (pos.length / 3) - rimRStart;

    // RIGHT hub/cap
    hubRStart = pos.length / 3;
    addDiscX(wheelXRight + hubW * 0.5, wheelY + .05, axleZ, hubR, +1, 48); 
    addDiscX(wheelXRight - hubW * 0.5, wheelY + .05, axleZ, hubR, -1, 48);
    hubRCount = (pos.length / 3) - hubRStart;

    tireLStart = pos.length / 3;
    addTireX(wheelXLeft, wheelY + .05, axleZ, rings, 64);
    tireLCount = (pos.length / 3) - tireLStart;

    rimLStart = pos.length / 3;
    addCylinder(wheelXLeft, wheelY + .05, axleZ, rimR, rimW, "x", 64);
    rimLCount = (pos.length / 3) - rimLStart;

    // LEFT hub/cap
    hubLStart = pos.length / 3;
    addDiscX(wheelXLeft + hubW * 0.5, wheelY + .05, axleZ, hubR, +1, 48);
    addDiscX(wheelXLeft - hubW * 0.5, wheelY + .05, axleZ, hubR, -1, 48);
    hubLCount = (pos.length / 3) - hubLStart;

    // Fenders
    // Right fender
    fendRStart = pos.length / 3;
    addCurvedPlaneOverTireX(wheelXRight - .01, axleZ, fenderR, fenderW, fenderYc + .07, 192);
    addHalfDisc(xR + eps + .015, capY + .05, capZ, capR, 'x', 64, false);
    fendRCount = (pos.length / 3) - fendRStart;
    // Left fender
    fendLStart = pos.length / 3;
    addCurvedPlaneOverTireX(wheelXLeft + .01, axleZ, fenderR, fenderW, fenderYc + .07, 192);
    addHalfDisc(xL - eps - .015, capY + .05, capZ, capR, 'x', 64, true);
    fendLCount = (pos.length / 3) - fendLStart;

    // Tandem Axle
    tandemAxleStart = pos.length /3;
    addCylinder(0, axleY - .13, axleZ + .1, axleRadius, axleSpan, "x", 32);
    addCylinder(0, axleY - .13, axleZ + .4, axleRadius, axleSpan, "x", 32);
    tandemAxleCount = (pos.length / 3) - tandemAxleStart;
    // Tandem Wheels
    tandemWheelStart = pos.length /3;
    // Right Side
    addDiscX(wheelXRight + hubW * 0.5, wheelY + .05, axleZ + .1, hubR, +1, 48); 
    addDiscX(wheelXRight - hubW * 0.5, wheelY + .05, axleZ + .4, hubR, -1, 48);
    addDiscX(wheelXRight + hubW * 0.5, wheelY + .05, axleZ + .4, hubR, +1, 48); 
    addDiscX(wheelXRight - hubW * 0.5, wheelY + .05, axleZ + .1, hubR, -1, 48);
    // Left Side
    addDiscX(wheelXLeft + hubW * 0.5, wheelY + .05, axleZ + .4, hubR, +1, 48);
    addDiscX(wheelXLeft - hubW * 0.5, wheelY + .05, axleZ + .4, hubR, -1, 48);
    addDiscX(wheelXLeft + hubW * 0.5, wheelY + .05, axleZ + .1, hubR, +1, 48);
    addDiscX(wheelXLeft - hubW * 0.5, wheelY + .05, axleZ + .1, hubR, -1, 48);
    tandemWheelCount = (pos.length /3) - tandemWheelStart;
    // Tandem Tires
    tandemTireStart = pos.length /3;
    // Right Side
    addTireX(wheelXRight, wheelY + .05, axleZ + .4, rings, 64);
    addTireX(wheelXRight, wheelY + .05, axleZ + .1, rings, 64);
    // Left Side
    addTireX(wheelXLeft, wheelY + .05, axleZ + .1, rings, 64);
    addTireX(wheelXLeft, wheelY + .05, axleZ + .4, rings, 64);
    tandemTireCount = (pos.length /3) - tandemTireStart;

    // Tandem fenders
    // right side
    
    if (!isWide102) {
        tandemFendRStart = pos.length / 3;
	addTandemFenderOverWheelsX(wheelXRight - .01, zRear + .4, zFront + .1, tFenderR, tFenderW, tFenderY + .05, 260);
	addTandemFenderSidePlateX(xR + eps + .01, zRear + .4, zFront + .1, tFenderR, tFenderY, yB - .01, 260, -1);
        tandemFendRCount = (pos.length / 3) - tandemFendRStart;

        // left side
        tandemFendLStart = pos.length / 3;
    	addTandemFenderOverWheelsX(wheelXLeft + 0.01, zRear + .4, zFront + .1, tFenderR, tFenderW, tFenderY + .05, 260);
	addTandemFenderSidePlateX(xL - eps - .01, zRear + .4, zFront + .1, tFenderR, tFenderY, yB - .01, 260, -1);
        tandemFendLCount = (pos.length / 3) - tandemFendLStart;
    }else{
      // GOOD
      // right fender
      outerFendRStart = pos.length / 3;
      addOuterFenderSidePlateWithHolesX("right", axleZ + 0.099, axleZ + 0.41, tFenderR + .01, tFenderY + 0.05, yB - 0.01, -0.001, wheelY + 0.05, tireR * 1.05, 0.0, 260);
      outerFendRCount = (pos.length / 3) - outerFendRStart;

      // left fender
      outerFendLStart = pos.length / 3;
      addOuterFenderSidePlateWithHolesX("left", axleZ + 0.099, axleZ + 0.41, tFenderR + .01, tFenderY + 0.05, yB + 0.01, -0.001, wheelY + 0.05, tireR * 1.05, 0.0, 260);
      outerFendLCount = (pos.length / 3) - outerFendLStart;

      // inner fender parts

      innerFendStart = pos.length / 3;
      // Driver Side
        pushQuad(
            [xWellPlateL-.215, yB-.011, zCut0],
            [xWellPlateL-.215, yB-.011, zCut1],
            [xWellPlateL-.215, yT-.965, zCut1],
            [xWellPlateL-.215, yT-.965, zCut0],
            [ 1, 0, 0]
        );
        pushQuad(
            [xL+.14, yT-.965, zCut0],
            [xL+.14, yT-.965, zCut1],
            [xL, yT-.965, zCut1],
            [xL, yT-.965, zCut0],
            [ 1, 0, 0]
        );
        pushQuad(
            [xL + .14, yB-.011, zCut0],
            [xL, yB-.011, zCut0],
            [xL, yT-.965, zCut0],
            [xL + .14, yT-.965, zCut0],
            [ 1, 0, 0]
        );
        pushQuad(
            [xL + .14, yB-.011, zCut1],
            [xL, yB-.011, zCut1],
            [xL, yT-.965, zCut1],
            [xL + .14, yT-.965, zCut1],
            [ 1, 0, 0]
        );

      // Passager Side
        pushQuad(
            [xWellPlateL+1.037, yB-.011, zCut0],
            [xWellPlateL+1.037, yB-.011, zCut1],
            [xWellPlateL+1.037, yT-.965, zCut1],
            [xWellPlateL+1.037, yT-.965, zCut0],
            [ 1, 0, 0]
        );
        pushQuad(
            [xR-.14, yT-.965, zCut0],
            [xR-.14, yT-.965, zCut1],
            [xR, yT-.965, zCut1],
            [xR, yT-.965, zCut0],
            [ 1, 0, 0]
        );
        pushQuad(
            [xR-.14, yB-.011, zCut0],
            [xR, yB-.011, zCut0],
            [xR, yT-.965, zCut0],
            [xR - .14, yT-.965, zCut0],
            [ 1, 0, 0]
        );
        pushQuad(
            [xR-.14, yB-.011, zCut1],
            [xR, yB-.011, zCut1],
            [xR, yT-.965, zCut1],
            [xR-.14, yT-.965, zCut1],
            [ 1, 0, 0]
        );
      innerFendCount = (pos.length / 3) - innerFendStart;
    }

    // TRIM (top + bottom)
    trimStart = pos.length / 3; 
    // TOP LOOP 
    addRectBeam([xL - OX, yTopTrim - .005, zBack - OZ], [xR + OX, yTopTrim - .005, zBack - OZ], TRIM_T, TRIM_H);
    addRectBeam([xR + OX, yTopTrim - .005, zBack - OZ], [xR + OX, yTopTrim - .005, zNoseBase], TRIM_T, TRIM_H);
    addRectBeam([xR + OX, yTopTrim - .005, zNoseBase], [0, yTopTrim - .005, zApex + OZ], TRIM_T, TRIM_H);
    addRectBeam([0, yTopTrim - .005, zApex + OZ], [xL - OX, yTopTrim - .005, zNoseBase], TRIM_T, TRIM_H);
    addRectBeam([xL - OX, yTopTrim - .005, zNoseBase], [xL - OX, yTopTrim - .005, zBack - OZ], TRIM_T, TRIM_H);
    // BOTTOM LOOP
    // Bottom trim loop
    if (!isWide102) {
        addRectBeam([xL - OX, yBotTrim, zBack - OZ], [xR + OX, yBotTrim, zBack - OZ], TRIM_T, TRIM_H);
        addRectBeam([xR + OX, yBotTrim, zBack - OZ], [xR + OX, yBotTrim, zNoseBase], TRIM_T, TRIM_H);
        addRectBeam([xR + OX, yBotTrim, zNoseBase], [0, yBotTrim, zApex + OZ], TRIM_T, TRIM_H);
        addRectBeam([0, yBotTrim, zApex + OZ], [xL - OX, yBotTrim, zNoseBase], TRIM_T, TRIM_H);
        addRectBeam([xL - OX, yBotTrim, zNoseBase], [xL - OX, yBotTrim, zBack - OZ], TRIM_T, TRIM_H, 0, true);
    } else {
        // GOOD
        addRectBeam([xL - OX, yBotTrim, zBack - OZ], [xR + OX, yBotTrim, zBack - OZ], TRIM_T, TRIM_H);
        addRectBeam([xR + OX, yBotTrim, zBack - OZ], [xR + OX, yBotTrim, zCut0], TRIM_T, TRIM_H);
        addRectBeam([xR + OX, yBotTrim, zCut1], [xR + OX, yBotTrim, zNoseBase], TRIM_T, TRIM_H);
        addRectBeam([xR + OX, yBotTrim, zNoseBase], [0, yBotTrim, zApex + OZ], TRIM_T, TRIM_H);
        addRectBeam([0, yBotTrim, zApex + OZ], [xL - OX, yBotTrim, zNoseBase], TRIM_T, TRIM_H);
        addRectBeam([xL - OX, yBotTrim, zNoseBase], [xL - OX, yBotTrim, zCut1], TRIM_T, TRIM_H, 0, true);
        addRectBeam([xL - OX, yBotTrim, zCut0], [xL - OX, yBotTrim, zBack - OZ], TRIM_T, TRIM_H, 0, true);
    }
    trimCount = (pos.length / 3) - trimStart;

    // Roof line geometry
   roofLineStart = pos.length / 3;
   for (let z = zStart; z >= zEnd - 1e-6; z -= ROOF_LINE_SPACING) {
     addBox(xCenter, roofY, z, xSpan + .06, lineThickY, lineThickZ);
   }
   roofLineCount = (pos.length / 3) - roofLineStart;

   // STONE GUARD (flat band on both V-nose faces)
   stoneGuardStart = pos.length / 3;
   // point on a V-nose face: u=0 at nose base, u=1 at apex
   function noseFacePoint(isLeft, u, y, pushOut) {
     const xEdge = isLeft ? xL : xR;
     const x = xEdge * (1.0 - u);                    
     const z = zNoseBase + (zApex - zNoseBase) * u;  
     // push outward along the face normal direction (use your nose normals)
     const n = isLeft ? nNoseL : nNoseR;
     return [x + n[0] * pushOut, y + n[1] * pushOut, z + n[2] * pushOut];
   }
   // LEFT face quad (base->apex, bottom->top)
   {
     const p0 = noseFacePoint(true,  0.0, guardY0, guardOffset); // base bottom
     const p1 = noseFacePoint(true,  0.0, guardY1, guardOffset); // base top
     const p2 = noseFacePoint(true,  1.0, guardY1, guardOffset); // apex top
     const p3 = noseFacePoint(true,  1.0, guardY0, guardOffset); // apex bottom
     pushQuad(p0, p1, p2, p3, nNoseL);
   }
   // RIGHT face quad
   {
     const p0 = noseFacePoint(false, 0.0, guardY0, guardOffset);
     const p1 = noseFacePoint(false, 0.0, guardY1, guardOffset);
     const p2 = noseFacePoint(false, 1.0, guardY1, guardOffset);
     const p3 = noseFacePoint(false, 1.0, guardY0, guardOffset);
     pushQuad(p0, p1, p2, p3, nNoseR);
   }

   function addNoseStrip(isLeft, uCenter) {
     const u0 = Math.max(0.0, uCenter - stripUWidth * 0.5);
     const u1 = Math.min(1.0, uCenter + stripUWidth * 0.5 + 1);
     const n  = isLeft ? nNoseL : nNoseR;
     const p0 = noseFacePoint(isLeft, u0, stripY0 + yInsetBot, guardOffset);
     const p1 = noseFacePoint(isLeft, u0, stripY1 - yInsetTop, guardOffset);
     const p2 = noseFacePoint(isLeft, u1, stripY1 - yInsetTop, guardOffset);
     const p3 = noseFacePoint(isLeft, u1, stripY0 + yInsetBot, guardOffset);
     pushQuad(p0, p1, p2, p3, n);
   }
   // left face strip
   addNoseStrip(true,  stripUCenter);
   // right face strip
   addNoseStrip(false, stripUCenter);  
   stoneGuardCount = (pos.length / 3) - stoneGuardStart;

    sideDoorTrimStart = pos.length / 3;
    // TOP strip
    pushQuad(
      [xDoorInner, y1 - innerFrameW, z0],
      [xDoorInner, y1 - innerFrameW, z1],
      [xDoorInner, y1, z1],
      [xDoorInner, y1, z0],
      nIn
    );

    // BOTTOM strip
    pushQuad(
      [xDoorInner, y0, z0],
      [xDoorInner, y0, z1],
      [xDoorInner, y0 + innerFrameW, z1],
      [xDoorInner, y0 + innerFrameW, z0],
      nIn
    );

    // left strip
    pushQuad(
      [xDoorInner, y0, z0],
      [xDoorInner, y0, z0 + innerFrameW],
      [xDoorInner, y1, z0 + innerFrameW],
      [xDoorInner, y1, z0],
      nIn
    );

    // right strip
    pushQuad(
      [xDoorInner, y0, z1 - innerFrameW],
      [xDoorInner, y0, z1],
      [xDoorInner, y1, z1],
      [xDoorInner, y1, z1 - innerFrameW],
      nIn
    );
    sideDoorTrimCount = (pos.length / 3) - sideDoorTrimStart;

    // position bar closer to the rear edge of the door
    sideBarStart = pos.length / 3;
    pushQuad(
      [xDoorBar + .009, yb0, zBar0],
      [xDoorBar + .009, yb0, zBar1],
      [xDoorBar + .009, yb1, zBar1],
      [xDoorBar + .009, yb1, zBar0], 
      nOut
    );
    sideBarCount = (pos.length / 3) - sideBarStart;
    // tip
    sideTipStart = pos.length / 3;
    pushQuad(
      [xDoorTip + .016, yb0, zTip0],
      [xDoorTip + .016, yb0, zTip1],
      [xDoorTip + .016, yb1, zTip1],
      [xDoorTip + .016, yb1, zTip0], 
      nOut
    );
    sideTipCount = (pos.length / 3) - sideTipStart;
   
    if (Math.round(dims.widthFt * 12) === 102 && interiorView) {
      rearDoorTrimCount = 0;
      rearBarCount = 0;
      rearTipCount = 0;
    }

    innerWallStart = pos.length / 3
    if (!isWide102){
      // inside left wall (facing right)
      pushQuad(
        [xLi, yB, zBi],
        [xLi, yB, zFi + .005],
        [xLi, yT, zFi + .005],
        [xLi, yT, zBi],
        nInL
     );
    }else{
      // Left wall rear section
      pushQuad(
         [xLi, yB, zBack],
         [xLi, yB, zCut0],
         [xLi, yT, zCut0],
         [xLi, yT, zBack],
         nL
      );
      // Left wall front section
      pushQuad(
         [xLi, yB, zCut1],
         [xLi, yB, zNoseBase],
         [xLi, yT, zNoseBase],
         [xLi, yT, zCut1],
         nL
      );
      // Left wall above the opening 
      for (let i = 0; i < cutSeg; i++) {
        const t0 = i / cutSeg;
        const t1 = (i + 1) / cutSeg;
        const zA = zCut0 + (zCut1 - zCut0) * t0;
        const zB2 = zCut0 + (zCut1 - zCut0) * t1;
        const yA = openingTopY(zA);
        const yB3 = openingTopY(zB2);
        pushQuad(
           [xLi, yA,  zA],
           [xLi, yB3, zB2],
           [xLi, yT,  zB2],
           [xLi, yT,  zA],
           nL
        );
      }
    }
    innerWallCount = (pos.length / 3) - innerWallStart

    innerRoofStart = pos.length / 3
    // inside roof box (faces down into trailer)
    pushQuad(
      [xLi, yT - wallIn, zBi],
      [xRi, yT - wallIn, zBi],
      [xRi, yT - wallIn, zFi + .01],
      [xLi, yT - wallIn, zFi + .01],
      nInRoof
    )
    pushTri(pos,nor,
        [xL,innerFloorY + 1.039,zNoseBase],
        [0,innerFloorY + 1.039,zApex],
        [xR,innerFloorY + 1.039,zNoseBase],
        [0,1,0]
    )
    innerRoofCount = (pos.length / 3) - innerRoofStart

   // Interior floor geometry ranges
   innerFloorStart=pos.length/3
   if (!isWide102){
     // Box interior floor top
     pushQuad(
        [xL,innerFloorY,zBack+0.008],
        [xR,innerFloorY,zBack+0.008],
        [xR,innerFloorY,zNoseBase],
        [xL,innerFloorY,zNoseBase],
        [0,1,0]
     )
     pushQuad(
        [xR,floorTopY - .01,zBack + .005],
        [xR,floorTopY - .01,zNoseBase],
        [xR,floorBotY,zNoseBase],
        [xR,floorBotY,zBack + .005],
        [1,0,0]
     )
   }else{
     // 102 WIDE INTERIOR FLOOR (GOOD)
     const inX = 0.01; 
     const inZ = 0.008;  
     const nUp = [0, 1, 0];
     const xInL   = xL   + inX;
     const xInR   = xR   - inX;
     const xIn84L = x84L + inX;
     const xIn84R = x84R - inX;
     // Rear interior floor
     pushQuad(
       [xInL, innerFloorY, zBack + inZ],
       [xInR, innerFloorY, zBack + inZ],
       [xInR, innerFloorY, zCut0],
       [xInL, innerFloorY, zCut0],
       nUp
     );
     // Middle interior floor
     pushQuad(
       [xIn84L, innerFloorY, zCut0],
       [xIn84R, innerFloorY, zCut0],
       [xIn84R, innerFloorY, zCut1],
       [xIn84L, innerFloorY, zCut1],
       nUp
     );
     // Front interior floor
     pushQuad(
       [xInL, innerFloorY, zCut1],
       [xInR, innerFloorY, zCut1],
       [xInR, innerFloorY, zNoseBase],
       [xInL, innerFloorY, zNoseBase],
       nUp
     );
     pushQuad(
        [xR - .01,floorTopY,zCut1],
        [xR - .01,floorTopY,zNoseBase],
        [xR - .01,floorBotY,zNoseBase],
        [xR - .01,floorBotY,zCut1],
        [1,0,0]
     );
     pushQuad(
        [xR - .01,floorTopY - .01,zBack],
        [xR - .01,floorTopY - .01,zCut0],
        [xR - .01,floorBotY,zCut0],
        [xR - .01,floorBotY,zBack],
        [1,0,0]
     );
   }
   // REAR INTERIOR RISER (vertical face inside at back)
   const rearInZ = zBack + 0.008;
   const rearInX0 = xL;
   const rearInX1 = xR;
   pushQuad(
     [rearInX0, floorBotY,   rearInZ],
     [rearInX1, floorBotY,   rearInZ],
     [rearInX1, innerFloorY, rearInZ],  
     [rearInX0, innerFloorY, rearInZ],
     [0, 0, 1]
   );
   innerFloorCount=(pos.length/3)-innerFloorStart

   // V nose interior floor top
   noseInnerFloorStart=pos.length/3
   pushTri(pos,nor,
        [xL,innerFloorY,zNoseBase],
        [0,innerFloorY,zApex],
        [xR,innerFloorY,zNoseBase],
        [0,1,0]
   )
   noseInnerFloorCount=(pos.length/3)-noseInnerFloorStart

   innerVNoseStart = pos.length / 3;
   pushTriRev(pos,nor,NLB_IN,NLT_IN,APEX_T_IN,nNoseL);
   pushTriRev(pos,nor,NLB_IN,APEX_T_IN,APEX_B_IN,nNoseL);
   pushTriRev(pos,nor,NRB_IN,APEX_B_IN,APEX_T_IN,nNoseR);
   pushTriRev(pos,nor,NRB_IN,APEX_T_IN,NRT_IN,nNoseR);
   innerVNoseCount = (pos.length / 3) - innerVNoseStart;
 
   innerDoorStart = pos.length / 3;
   // TOP strip
   pushQuad(
      [xDoorInner + wallIn + .01, y1 - innerFrameW, z0],
      [xDoorInner + wallIn + .01, y1 - innerFrameW, z1],
      [xDoorInner + wallIn + .01, y1, z1],
      [xDoorInner + wallIn + .01, y1, z0],
      nIn
   );
   // BOTTOM strip
   pushQuad(
      [xDoorInner + wallIn + .01, y0, z0],
      [xDoorInner + wallIn + .01, y0, z1],
      [xDoorInner + wallIn + .01, y0 + innerFrameW, z1],
      [xDoorInner + wallIn + .01, y0 + innerFrameW, z0],
      nIn
   );
   // left strip
   pushQuad(
      [xDoorInner + wallIn + .01, y0, z0],
      [xDoorInner + wallIn + .01, y0, z0 + innerFrameW],
      [xDoorInner + wallIn + .01, y1, z0 + innerFrameW],
      [xDoorInner + wallIn + .01, y1, z0],
      nIn
   );
   // right strip
   pushQuad(
      [xDoorInner + wallIn + .01, y0, z1 - innerFrameW],
      [xDoorInner + wallIn + .01, y0, z1],
      [xDoorInner + wallIn + .01, y1, z1],
      [xDoorInner + wallIn + .01, y1, z1 - innerFrameW],
      nIn
   );
   innerDoorCount = (pos.length / 3) - innerDoorStart;

   vnoseStudStart = pos.length / 3;
   function makeZs(z0,z1,oc){
     const zs=[]
     for(let z=z0;z<=z1+1e-6;z+=oc)zs.push(z)
     if(Math.abs(zs[zs.length-1]-z1)>(oc*0.25))zs.push(z1)
     return zs
  }

  function buildFloorCrossmembers(oc){
    const start = pos.length / 3;
    const zs = makeZs(zMinBox, zMaxBox, oc);
    for (const z of zs) {
        if (!isWide102) {
            addBox(0, crossY, z, crossSX, crossSY, crossSZ);
            continue;
        }
        const crossHalfZ = crossSZ * 0.5;
        const overlapsOpening = ((z + crossHalfZ) > zCut0 && (z - crossHalfZ) < zCut1);
        if (!overlapsOpening) {
            addBox(0, crossY, z, crossSX, crossSY, crossSZ);
            continue;
        }
        // In the fender opening zone, only build the center section
        const innerWidth = x84R - x84L;
        const innerCenterX = (x84L + x84R) * 0.5;
        if (innerWidth > 0) {
            addBox(innerCenterX, crossY, z, innerWidth, crossSY, crossSZ);
        }
    }
    return { start, count: (pos.length / 3) - start, zs };
  }

  function buildWallStuds(oc){
    const start = pos.length / 3;
    const zs = makeZs(zMinBox, zMaxBox, oc);
    for (const z of zs) {
        if (!isWide102) {
            addBox(xStudL, studY, z, studSX, studSY, studSZ);
            addBox(xStudR, studY, z, studSX, studSY, studSZ);
            continue;
        }
        const studHalfZ = studSZ * 0.5;
        const overlapsOpening = ((z + studHalfZ) > zCut0 && (z - studHalfZ) < zCut1);
        if (!overlapsOpening) {
            addBox(xStudL, studY, z, studSX, studSY, studSZ);
            addBox(xStudR, studY, z, studSX, studSY, studSZ);
            continue;
        }
        // In the fender opening zone:
        // stop the stud at the top of the opening and continue upward only
        const yOpen = openingTopY(z);
        const topClearance = 0.01;
        const y0 = yOpen + topClearance;
        const y1 = yT;
        if (y1 > y0) {
            const shortStudCY = (y0 + y1) * 0.5;
            const shortStudSY = (y1 - y0);
            addBox(xStudL, shortStudCY - .006, z, studSX, shortStudSY + .006, studSZ);
            addBox(xStudR, shortStudCY - .006, z, studSX, shortStudSY + .006, studSZ);
        }
    }
    return { start, count: (pos.length / 3) - start, zs };
  }

  function vnoseXZ(isLeft,u){
    const z=zNoseBase+dzN*u
    const xEdge=isLeft?xL:xR
    const x=xEdge*(1-u)
    return[x,z]
  }

  for(let i=0;i<vnCount;i++){
    const u=(vnCount===1)?0:i/(vnCount-1)
    {
        const p=vnoseXZ(true,u)
        addBox(p[0],studY,p[1],studSX,studSY,studSZ)
    }
    {
        const p=vnoseXZ(false,u)
        addBox(p[0],studY,p[1],studSX,studSY,studSZ)
    }
  }

  vnoseStudCount=(pos.length/3)-vnoseStudStart
  // REAR DOOR 
  rearDoorTrimStart = pos.length / 3;
  // TOP strip
  pushQuad(
     [rx0 - .2, ry1 - rearInnerFrame + .1, zRearInner - .019],
     [rx1 + .2, ry1 - rearInnerFrame + .1, zRearInner - .019],
     [rx1 + .2, ry1 + .1, zRearInner - .019],
     [rx0 - .2, ry1 + .1, zRearInner - .019],
     nInB
  );
   // BOTTOM strip
   pushQuad(
     [rx0 - .2, ry0, zRearInner - .019],
     [rx1 + .2, ry0, zRearInner - .019],
     [rx1 + .2, ry0 + rearInnerFrame, zRearInner - .019],
     [rx0 - .2, ry0 + rearInnerFrame, zRearInner - .019],
     nInB
   );
   // LEFT strip
   pushQuad(
     [rx0 - .2, ry0, zRearInner - .019],
     [rx0 + rearInnerFrame - .2, ry0, zRearInner - .019],
     [rx0 + rearInnerFrame - .2, ry1 + .1, zRearInner - .019],
     [rx0 - .2, ry1 + .1, zRearInner - .019],
     nInB
   );
   // RIGHT strip
   pushQuad(
     [rx1 - rearInnerFrame + .2, ry0, zRearInner - .019],
     [rx1 + .2, ry0, zRearInner - .019],
     [rx1 + .2, ry1 + .1, zRearInner - .019],
     [rx1 - rearInnerFrame + .2, ry1 + .1, zRearInner - .019],
     nInB
   ); 
   rearDoorTrimCount = (pos.length / 3) - rearDoorTrimStart;

   // BAR
   rearBarStart = pos.length / 3;
   pushQuad(
     [rBarX0, rby0, zRearBar + .014],
     [rBarX1, rby0, zRearBar + .014],
     [rBarX1, rby1, zRearBar + .014],
     [rBarX0, rby1, zRearBar + .014],
     nOutB
   );
   rearBarCount = (pos.length / 3) - rearBarStart;
   // TIP 
   rearTipStart = pos.length / 3;
   pushQuad(
     [rTipX0, rby0, zRearTip + .014],
     [rTipX1, rby0, zRearTip + .014],
     [rTipX1, rby1, zRearTip + .014],
     [rTipX0, rby1, zRearTip + .014],
     nOutB
   );
   rearTipCount = (pos.length / 3) - rearTipStart;

   groundStart = pos.length / 3;
   pushQuad(
     [-groundSize, groundY, -groundSize],
     [-groundSize, groundY,  groundSize],
     [ groundSize, groundY,  groundSize],
     [ groundSize, groundY, -groundSize],
     [0, 1, 0]
   );
   groundCount = (pos.length / 3) - groundStart;
   
    vertexCount = pos.length / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, posB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, norB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);

  }
  function setAxleMode(mode) {
    axleMode = (mode === 'tandem') ? 'tandem' : 'single';
    // keep header button text in sync (until you remove it)
    if (typeof btnAxle !== 'undefined' && btnAxle) {
      btnAxle.textContent = (axleMode === 'single') ? 'Single Axle' : 'Tandem Axle';
    }
    // update card selection UI
    axleButtons.forEach(b => {
      const isSelected = (b.dataset.axle === axleMode);
      b.classList.toggle("is-selected", isSelected);
    });
    updateAxleSizeOptions();
    console.log('Axle mode set by cards:', axleMode);
    // updateFloorOcForAxle(); Needed Later
  }

// Debug
console.assert(typeof axleMode === 'string', 'axleMode initialized before use');

  const aPosition = gl.getAttribLocation(program, "aPosition");
  const aNormal   = gl.getAttribLocation(program, "aNormal");
  const axleButtons = document.querySelectorAll('.axle-option');
  const tandemCard = document.querySelector('.axle-option[data-axle="tandem"]');
  const singleCard = document.querySelector('.axle-option[data-axle="single"]');

  const vao = isWebGL2 ? gl.createVertexArray() : null;
  if (vao) gl.bindVertexArray(vao);
  // Axle mode toggle (axleMode already initialized above)
  const btnAxle = document.getElementById('btnAxleDbg');
  if (btnAxle) {
    btnAxle.onclick = () => {
      axleMode = (axleMode === "single") ? "tandem" : "single";
      btnAxle.textContent = (axleMode === "single") ? "Single Axle" : "Tandem Axle";
      console.log("Axle mode:", axleMode);
      rebuildMesh();
    };
  }  

const axleWarning = document.getElementById("axle-warning");
const axleWarningTandem = document.getElementById("axle-warning-tandem");
const btnInterior=document.getElementById('btnInterior')
const btnStructure=document.getElementById('btnStructure')
const axleSizeSelect = document.getElementById("axle_size");
const SINGLE_AXLE_SIZES = [
  { value: "3_5_k", label: "3.5K Axle" },
  { value: "5_k",   label: "5K Axle" }
];
const TANDEM_AXLE_SIZES = [
  { value: "7_k",   label: "7K (2-3.5K) Axles" },
  { value: "10_k",  label: "10K (2-5K) Axles" },
  { value: "14_k",  label: "14K (2-7K) Axles" }
];
if(btnStructure){
  btnStructure.onclick=()=>{
    structurePreview=!structurePreview
    btnStructure.textContent=structurePreview?'Exterior View':'Structure View'
  }
}
if(btnInterior){
  btnInterior.onclick=()=>{
    interiorView=!interiorView
    btnInterior.textContent=interiorView?'Exterior View':'Interior View'
  }
}

function updateAxleSizeOptions() {
  if (!axleSizeSelect) return;

  const list = (axleMode === "single")
    ? SINGLE_AXLE_SIZES
    : TANDEM_AXLE_SIZES;

  const prev = axleSizeSelect.value;
  axleSizeSelect.innerHTML = "";

  list.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    axleSizeSelect.appendChild(opt);
  });

  const stillExists = list.some(item => item.value === prev);
  axleSizeSelect.value = stillExists ? prev : list[0].value;
}

function applyAxleRulesForLength() { 
  const L = Number(lengthSelect.value);
  const W = Number(widthSelect.value);

  const is102Wide = (W === 102);

  const singleAllowed = (L <= 14) && !is102Wide;
  const tandemAllowed = (L !== 8) && (W !== 60);

  if (singleCard) {
    singleCard.classList.toggle("is-disabled", !singleAllowed);
  }

  if (tandemCard) {
    tandemCard.classList.toggle("is-disabled", !tandemAllowed);
  }

  // Warning for tandem not allowed
  if (axleWarning) {
    axleWarning.hidden = tandemAllowed;
  }

  // Warning for single not allowed
  if (axleWarningTandem) {
    axleWarningTandem.hidden = singleAllowed;
  }

  // If current axle is no longer allowed, switch to the allowed one
  if (axleMode === "single" && !singleAllowed && tandemAllowed) {
    setAxleMode("tandem");
  } else if (axleMode === "tandem" && !tandemAllowed && singleAllowed) {
    setAxleMode("single");
  }

  // If both are somehow false, log it so we know the selected size combo has no valid axle
  if (!singleAllowed && !tandemAllowed) {
    console.warn("No axle option allowed for:", { length: L, width: W });
  }
}
  applyAxleRulesForLength();

const LENGTH_TO_WIDTHS = {
  8: [60],
  10: [60, 72, 84],
  12: [60, 72, 84],
  14: [84, 102],
  16: [84, 102],
  18: [84, 102],
  20: [84, 102],
  22: [84, 102],
  24: [84, 102],
};

function applyWidthFilterForLength() {
  const L = Number(lengthSelect.value);
  const allowed = new Set((LENGTH_TO_WIDTHS[L] || []).map(String));

  const allowAll = allowed.size === 0;

  const prev = String(widthSelect.value || ""); // remember selection

  widthSelect.innerHTML = "";
  const list = allowAll
    ? ALL_WIDTH_OPTIONS
    : ALL_WIDTH_OPTIONS.filter(o => allowed.has(o.value));

  list.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.text;
    widthSelect.appendChild(opt);
  });

  // pick previous if still valid, otherwise first
  if (widthSelect.options.length > 0) {
    const prevStillValid = Array.from(widthSelect.options).some(o => o.value === prev);
    widthSelect.value = prevStillValid ? prev : widthSelect.options[0].value;
  }
}

function handleLengthChange() {
  applyWidthFilterForLength();     // first fix the width dropdown
  readDimsFromUI();                // then update dimensions
  applyAxleRulesForLength();       // then apply axle rules using the corrected width
  rebuildMesh();
}

function handleWidthChange() {
  readDimsFromUI();
  applyAxleRulesForLength();
  rebuildMesh();
}

lengthSelect.addEventListener("change", handleLengthChange);
widthSelect.addEventListener("change", handleWidthChange);

  gl.bindBuffer(gl.ARRAY_BUFFER, posB);
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, norB);
  gl.enableVertexAttribArray(aNormal);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

  if (vao) gl.bindVertexArray(null);

  // Initial build
  resetAllToDefaults();

  function onDimsChange() { readDimsFromUI(); rebuildMesh(); }
  addHeightSel?.addEventListener("change", onDimsChange);
  ocFloorSel?.addEventListener("change", rebuildMesh);
  ocWallSel?.addEventListener("change", rebuildMesh);
  ocRoofSel?.addEventListener("change", rebuildMesh);
  // click behavior for cards
  axleButtons.forEach(b => {b.addEventListener('click', () => setAxleMode(b.dataset.axle));});

// COLOR BUTTON LISTENER
document.querySelectorAll(".color-option").forEach(btn => {
  btn.addEventListener("click", () => {

    // remove highlight from all colors
    document.querySelectorAll(".color-option")
      .forEach(b => b.classList.remove("is-selected"));

    // highlight the clicked one
    btn.classList.add("is-selected");

    // existing color logic (keep yours)
    const key = btn.dataset.color;
    if (COLOR_MAP[key]) {
      enclosedColor = COLOR_MAP[key];
    }
  });
});


// DEFAULT COLOR
const defaultKey = "silver";
const defaultBtn = document.querySelector(`.color-option[data-color="${defaultKey}"]`);

if (defaultBtn) {
  defaultBtn.click();
}
// Horizontal color scroll arrows
const colorScroll = document.querySelector(".color-scroll");
const arrows = document.querySelectorAll(".scroll-arrow");

arrows.forEach(btn => {
  btn.addEventListener("click", () => {
    const dir = btn.dataset.scroll;
    const amount = 250; 


    if (dir === "left") {
      colorScroll.scrollLeft -= amount;
    } else {
      colorScroll.scrollLeft += amount;
    }
  });
});
// Reveal color cards as they scroll into view
function updateColorReveal() {
  const colorStrip = document.querySelector('.color-strip');
  if (!colorScroll || !colorStrip) return;

  // Recalculate on resize (width is recomputed at click-time too)
  window.addEventListener('resize', () => {
    // no persistent offset to fix—each click uses fresh measurements
  });
}
function revealColorOptions() {
  const options = document.querySelectorAll('.color-option');
  let delay = 0;

  options.forEach(opt => {
    opt.style.transitionDelay = delay + "ms";
    opt.classList.add('in-view');
    delay += 80; // staggered reveal
  });
}
// Run on scroll + on resize + on first load
if (colorScroll) {
  colorScroll.addEventListener('scroll', () => {
    window.requestAnimationFrame(updateColorReveal);
  });
}
window.addEventListener('resize', updateColorReveal);
window.setTimeout(updateColorReveal, 0);
gl.useProgram(program);

function updateFreeCam(dt) {
  if (!freeCam) return;

  const moveSpeed = 1.5;
  const riseSpeed = 1.2;

  const cp = Math.cos(freeCamPitch);
  const sp = Math.sin(freeCamPitch);
  const cy = Math.cos(freeCamYaw);
  const sy = Math.sin(freeCamYaw);

  // camera-local forward
  let forward = [sy * cp, sp, cy * cp];
  let fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  forward = [forward[0] / fl, forward[1] / fl, forward[2] / fl];

  // camera-local right = up x forward
  let right = [forward[2], 0, -forward[0]];
  let rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rl, right[1] / rl, right[2] / rl];

  // camera-local up = forward x right
  let up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];
  let ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up = [up[0] / ul, up[1] / ul, up[2] / ul];

  let mx = 0, my = 0, mz = 0;

  if (freeKeys.w) {
    mx += forward[0];
    my += forward[1];
    mz += forward[2];
  }
  if (freeKeys.s) {
    mx -= forward[0];
    my -= forward[1];
    mz -= forward[2];
  }
  if (freeKeys.d) {
    mx += right[0];
    my += right[1];
    mz += right[2];
  }
  if (freeKeys.a) {
    mx -= right[0];
    my -= right[1];
    mz -= right[2];
  }
  if (freeKeys.e) {
    mx += up[0];
    my += up[1];
    mz += up[2];
  }
  if (freeKeys.q) {
    mx -= up[0];
    my -= up[1];
    mz -= up[2];
  }

  const ml = Math.hypot(mx, my, mz);
  if (ml > 0) {
    mx /= ml;
    my /= ml;
    mz /= ml;
  }

  freeCamPos[0] += mx * moveSpeed * dt;
  freeCamPos[1] += my * riseSpeed * dt;
  freeCamPos[2] += mz * moveSpeed * dt;
}

// Render loop
let lastFrameTime = performance.now();
let fpsFrames = 0, fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  const L = Number(lengthSelect.value);
  lastFrameTime = now;

  // FPS counter: refresh the HUD about twice a second
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
    const hudEl = document.getElementById("hud");
    if (hudEl) hudEl.textContent = "FPS: " + fps + " — " + (freeCam ? "Free Cam" : "Orbit Cam");
  }
  updateFreeCam(dt);
  resize();
  updateView();

  if (vao) {
    gl.bindVertexArray(vao);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, posB);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, norB);
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
  }

  gl.useProgram(program);
  gl.uniformMatrix4fv(uModel, false, M4.ident());

  // clear FIRST
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // if any segment values are NaN, draw everything one color
  const bad =
    !Number.isFinite(bodyCount) ||
    !Number.isFinite(axleStart) || !Number.isFinite(axleCount) ||
    !Number.isFinite(tireRStart) || !Number.isFinite(tireRCount) ||
    !Number.isFinite(tireLStart) || !Number.isFinite(tireLCount) ||
    !Number.isFinite(rimRStart)  || !Number.isFinite(rimRCount)  ||
    !Number.isFinite(rimLStart)  || !Number.isFinite(rimLCount)  ||
    !Number.isFinite(fendRStart) || !Number.isFinite(fendRCount) ||
    !Number.isFinite(fendLStart) || !Number.isFinite(fendLCount);

  if (bad) {
    gl.uniform3f(uColor, 0.75, 0.78, 0.82);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    if (vao) gl.bindVertexArray(null);
    requestAnimationFrame(frame);
    return;
  }

if (groundCount > 0) {
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  if (groundTexReady) {
    if (uUseTex) gl.uniform1i(uUseTex, 1);
    if (uTexMode) gl.uniform1i(uTexMode, 4);
    if (uTexScale) gl.uniform1f(uTexScale, 0.35);

    gl.uniform3f(uColor, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, groundStart, groundCount);

    if (uUseTex) gl.uniform1i(uUseTex, 0);
    if (uTexMode) gl.uniform1i(uTexMode, 0);
  } else {
    // fallback while texture is still loading
    gl.uniform3f(uColor, 0.35, 0.38, 0.32);
    gl.drawArrays(gl.TRIANGLES, groundStart, groundCount);
  }
  gl.disable(gl.CULL_FACE);
}
  // Colors
  const BODY = enclosedColor
  const TONGUE = [0.08, 0.08, 0.09];
  const TRIM = blackout ? [0.04, 0.04, 0.045] : [0.75, 0.77, 0.80];
  const TRIM_DOOR = blackout ? [0.04, 0.04, 0.045] : [0.85, 0.87, 0.90];
  const ROOF = [0.75, 0.77, 0.80];
  const AXLE_DARK = [0.17, 0.18, 0.20]; 
  const TIRE_RUBBER = [0.10, 0.10, 0.10];
  const RIM_BLACK = [0.07, 0.07, 0.08];
  const HUB_STEEL = [0.30, 0.33, 0.36];
  const TEST = [0.1, 0.8, 0.10];
  const TEST2 = [0.10, 0.80, 0.85]; 
  const TEST3 = [0.80, 0.85, 0.10];
  const TEST4 = [0.85, 0.10, .80];
  const TEST5 = [0.8, 0.10, 0.10];
  const TEST6 = [.10, .10, .80];

if (structurePreview) {
  gl.uniform1f(uTwoSided, 0.0);

  // floor framing
  gl.uniform3f(uColor, 0.15, 0.15, 0.18); 
  gl.drawArrays(gl.TRIANGLES, floorCrossStart, floorCrossCount);

  // wall studs
  gl.uniform3f(uColor, 0.20, 0.20, 0.24);
  gl.drawArrays(gl.TRIANGLES, wallStudStart, wallStudCount);

  // v-nose studs
  gl.uniform3f(uColor, 0.25, 0.25, 0.30);
  gl.drawArrays(gl.TRIANGLES, vnoseStudStart, vnoseStudCount);

  // roof lines / roof members
  gl.uniform3f(uColor, 0.55, 0.55, 0.60); 
  gl.drawArrays(gl.TRIANGLES, roofMemberStart, roofMemberCount);
}

if (!interiorView && !structurePreview){
  gl.uniform1f(uTwoSided, 0.0);
  gl.uniform3f(uColor, ...BODY);
  gl.drawArrays(gl.TRIANGLES, 0, bodyCount);


  gl.uniform3f(uColor, ...TRIM_DOOR);
  gl.drawArrays(gl.TRIANGLES, rearDoorTrimStart, rearDoorTrimCount);
  gl.drawArrays(gl.TRIANGLES, rearBarStart, rearBarCount);

  gl.uniform3f(uColor, ...RIM_BLACK);
  gl.drawArrays(gl.TRIANGLES, rearTipStart, rearTipCount);
}
if (!structurePreview && bottomCount > 0) {
  if (uUseTex) gl.uniform1i(uUseTex, 1);
  if (uTexMode) gl.uniform1i(uTexMode, 2);
  if (uTexScale) gl.uniform1f(uTexScale, 1.0);

  gl.uniform3f(uColor, 1, 1, 1);
  gl.drawArrays(gl.TRIANGLES, bottomStart, bottomCount);

  if (uUseTex) gl.uniform1i(uUseTex, 0);
  if (uTexMode) gl.uniform1i(uTexMode, 0);
}
if (!structurePreview){
  if (roofCount > 0){
    gl.uniform3f(uColor, ...ROOF);
    gl.drawArrays(gl.TRIANGLES, roofStart, roofCount);
  }

  // Rear flare top: extends the roof to the end of the flare when on
  if (topFlareCount > 0){
    gl.uniform3f(uColor, ...ROOF);
    gl.drawArrays(gl.TRIANGLES, topFlareStart, topFlareCount);
  }

if (L !== 8){
  // side door
  gl.uniform3f(uColor, ...TRIM_DOOR);
  gl.drawArrays(gl.TRIANGLES, sideDoorTrimStart, sideDoorTrimCount);
  gl.drawArrays(gl.TRIANGLES, sideBarStart, sideBarCount);
  gl.uniform3f(uColor, ...RIM_BLACK);
  gl.drawArrays(gl.TRIANGLES, sideTipStart, sideTipCount);
}

  // stone guard (diamond plate texture on)
  if (blackout){
     if (uBlackout) {gl.uniform1i(uBlackout, 1); gl.uniform1i(uDiamond, 0);}
  }else{
     if (uDiamond)  {gl.uniform1i(uDiamond, 1); gl.uniform1i(uBlackout, 0);}
  }
  if (uUseTex)   gl.uniform1i(uUseTex, 1);
  if (uTexScale) gl.uniform1f(uTexScale, 1.0);
  gl.uniform3f(uColor, ...TEST);
  gl.drawArrays(gl.TRIANGLES, stoneGuardStart, stoneGuardCount);
  // back to normal parts
  if (uBlackout) gl.uniform1i(uBlackout, 0);
  if (uDiamond) gl.uniform1i(uDiamond, 0);
  if (uUseTex)  gl.uniform1i(uUseTex, 0);

  // roof lines
  if (showRoofLines){
    gl.uniform3f(uColor, 0.85, 0.85, 0.85);
    gl.drawArrays(gl.TRIANGLES, roofLineStart, roofLineCount);
  }
}
  // draw tongue with 2-sided lighting
  gl.uniform1f(uTwoSided, 1.0);
  gl.uniform3f(uColor, ...TONGUE); 
  gl.drawArrays(gl.TRIANGLES, tongueStart, tongueCount);
  gl.uniform1f(uTwoSided, 0.0);

  // jack
  gl.uniform1f(uTwoSided, 1);
  gl.uniform3f(uColor, ...TONGUE);
  gl.drawArrays(gl.TRIANGLES, jackStart, jackCount);

  // trim
  gl.uniform1f(uAmbient, 0.08);
  gl.uniform3f(uColor, ...TRIM);
  gl.drawArrays(gl.TRIANGLES, trimStart, trimCount);
  gl.uniform3f(uColor, ...ROOF);
  gl.drawArrays(gl.TRIANGLES, footStart, footCount);
  gl.uniform1f(uAmbient, 0.25);


  if (outerFendRCount > 0 && !interiorView && !structurePreview) {
    gl.uniform3f(uColor, ...TRIM);
    gl.drawArrays(gl.TRIANGLES, outerFendRStart, outerFendRCount);
  } 
  if (outerFendLCount > 0 && !structurePreview) {
    gl.uniform3f(uColor, ...TRIM);
    gl.drawArrays(gl.TRIANGLES, outerFendLStart, outerFendLCount);
  }
  if (innerFendCount > 0) {
    gl.uniform3f(uColor, ...RIM_BLACK);
    gl.drawArrays(gl.TRIANGLES, innerFendStart, innerFendCount);
  }

if (interiorView && !structurePreview) {
  gl.uniform3f(uColor, ...BODY);
  gl.drawArrays(gl.TRIANGLES, vNoseStart, vNoseCount);

  if (uUseTex)  gl.uniform1i(uUseTex, 1);
  if (uTexMode) gl.uniform1i(uTexMode, 3);
  if (uTexScale) gl.uniform1f(uTexScale, 1);
  drawInterior(innerVNoseStart, innerVNoseCount, TEST2);
  drawInterior(innerWallStart, innerWallCount, TEST);

  if (uUseTex)  gl.uniform1i(uUseTex, 1);
  if (uTexMode) gl.uniform1i(uTexMode, 2);
  if (uTexScale) gl.uniform1f(uTexScale, 1.0);
  drawInterior(innerFloorStart, innerFloorCount, TEST);
  drawInterior(noseInnerFloorStart, noseInnerFloorCount, TEST);
  drawInterior(innerRoofStart, innerRoofCount, TEST);

  if (uUseTex)  gl.uniform1i(uUseTex, 0);
  if (uTexMode) gl.uniform1i(uTexMode, 0);

  drawInterior(innerDoorStart, innerDoorCount, TRIM);

  drawInterior(roofMemberStart, roofMemberCount, ROOF);
}
  // Single Axle Mode
  if (axleMode === 'single'){
    // axle
    gl.uniform3f(uColor, ...AXLE_DARK);
    gl.drawArrays(gl.TRIANGLES, axleStart, axleCount);
    // fenders
    gl.uniform3f(uColor, ...TRIM);
    gl.drawArrays(gl.TRIANGLES, fendRStart, fendRCount);
    gl.drawArrays(gl.TRIANGLES, fendLStart, fendLCount);
    // tires
    gl.uniform3f(uColor, ...TIRE_RUBBER);
    gl.drawArrays(gl.TRIANGLES, tireRStart, tireRCount);
    gl.drawArrays(gl.TRIANGLES, tireLStart, tireLCount);
    // rims
    gl.uniform3f(uColor, ...RIM_BLACK);
    gl.drawArrays(gl.TRIANGLES, rimRStart, rimRCount);
    gl.drawArrays(gl.TRIANGLES, rimLStart, rimLCount);
    // hubs
    gl.uniform3f(uColor, ...HUB_STEEL);
    gl.drawArrays(gl.TRIANGLES, hubRStart, hubRCount);
    gl.drawArrays(gl.TRIANGLES, hubLStart, hubLCount);
  }else{
    // tandem axle + fenders
    gl.uniform3f(uColor, ...AXLE_DARK);
    gl.drawArrays(gl.TRIANGLES, tandemAxleStart, tandemAxleCount);
    // tandem fenders
    gl.uniform3f(uColor, ...TRIM);
    gl.drawArrays(gl.TRIANGLES, tandemFendRStart, tandemFendRCount);
    gl.drawArrays(gl.TRIANGLES, tandemFendLStart, tandemFendLCount);
    // tandem hubs
    gl.uniform3f(uColor, ...HUB_STEEL);
    gl.drawArrays(gl.TRIANGLES, tandemWheelStart, tandemWheelCount);
    // tandem tires
    gl.uniform3f(uColor, ...TIRE_RUBBER);
    gl.drawArrays(gl.TRIANGLES, tandemTireStart, tandemTireCount);
  }

  if (vao) gl.bindVertexArray(null);
  requestAnimationFrame(frame);
}

  requestAnimationFrame(frame);
})();
