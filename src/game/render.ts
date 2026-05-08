import { Entity, RemotePlayer, Road } from "./types";
import { GameState } from "./update";
import { SAFE_ZONE_HALF, SPAWN_POINT, TILE, WORLD_SIZE } from "./world";
import { doggoSprites, playerSprites } from "./sprites";

// --- CSS variable cache: resolve once, never query the DOM again ---
const _hslCache = new Map<string, string>();
function hsl(varName: string, alpha = 1): string {
  const key = varName + alpha;
  let v = _hslCache.get(key);
  if (v) return v;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  v = alpha === 1 ? `hsl(${raw})` : `hsla(${raw.replace(/\s+/g, ", ")}, ${alpha})`;
  _hslCache.set(key, v);
  return v;
}

// Viewport bounds reused each frame — avoids per-entity in-view math
let _vLeft = 0, _vTop = 0, _vRight = 0, _vBottom = 0;
function setViewport(camX: number, camY: number, viewW: number, viewH: number) {
  const PAD = 120;
  _vLeft   = camX - PAD;
  _vTop    = camY - PAD;
  _vRight  = camX + viewW + PAD;
  _vBottom = camY + viewH + PAD;
}
function inView(x: number, y: number, r: number): boolean {
  return x + r > _vLeft && x - r < _vRight && y + r > _vTop && y - r < _vBottom;
}
function roadInView(road: Road): boolean {
  // Quadratic bezier is always within convex hull of its 3 control points
  const pad = 80;
  const minX = Math.min(road.ax, road.cx, road.bx) - pad;
  const maxX = Math.max(road.ax, road.cx, road.bx) + pad;
  const minY = Math.min(road.ay, road.cy, road.by) - pad;
  const maxY = Math.max(road.ay, road.cy, road.by) + pad;
  return maxX > _vLeft && minX < _vRight && maxY > _vTop && minY < _vBottom;
}

// --- Ruin gradient cache: build once per ruin, reuse every frame ---
const _ruinGradCache = new Map<number, CanvasGradient>();

// --- Ruin building OffscreenCanvas cache (Option C) ---
const _ruinCanvasCache = new Map<number, OffscreenCanvas>();

function getRuinCanvas(e: Entity): OffscreenCanvas {
  let oc = _ruinCanvasCache.get(e.id);
  if (oc) return oc;
  const w = e.ruinW ?? 120;
  const h = e.ruinH ?? 100;
  // Diagonal gives enough room for any rotation
  const diag = Math.ceil(Math.hypot(w + 30, h + 30)) + 4;
  oc = new OffscreenCanvas(diag, diag);
  const cx = oc.getContext("2d")!;
  cx.translate(diag / 2, diag / 2);
  _drawRuinBuildingShape(cx, w, h, e.ruinVariant ?? 0, e.twoDoors ?? false);
  _ruinCanvasCache.set(e.id, oc);
  return oc;
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  viewW: number,
  viewH: number,
  isMobile = false,
  remotePlayers: Map<string, RemotePlayer> = new Map()
) {
  const { player } = state;
  const shakeX = (Math.random() - 0.5) * state.shake * 8;
  const shakeY = (Math.random() - 0.5) * state.shake * 8;
  const camX = player.pos.x - viewW / 2 + shakeX;
  const camY = player.pos.y - viewH / 2 + shakeY;

  setViewport(camX, camY, viewW, viewH);

  ctx.save();
  ctx.translate(-camX, -camY);

  // Ground
  ctx.fillStyle = hsl("--grass");
  ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  // Tile grid — only visible tiles, only even checker squares
  ctx.fillStyle = hsl("--grass-dark", 0.35);
  const startX = Math.max(0, Math.floor(camX / TILE));
  const startY = Math.max(0, Math.floor(camY / TILE));
  const endX = Math.min(WORLD_SIZE / TILE, Math.ceil((camX + viewW) / TILE));
  const endY = Math.min(WORLD_SIZE / TILE, Math.ceil((camY + viewH) / TILE));
  for (let tx = startX; tx < endX; tx++) {
    for (let ty = startY; ty < endY; ty++) {
      if ((tx + ty) % 2 === 0) ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }

  // Safe zone — single rect + grid lines, only when on screen
  const szX1 = SPAWN_POINT.x - SAFE_ZONE_HALF;
  const szY1 = SPAWN_POINT.y - SAFE_ZONE_HALF;
  const szW = SAFE_ZONE_HALF * 2;
  if (inView(SPAWN_POINT.x, SPAWN_POINT.y, SAFE_ZONE_HALF + 10)) {
    ctx.fillStyle = "rgba(145,150,145,0.55)";
    ctx.fillRect(szX1, szY1, szW, szW);
    ctx.strokeStyle = "rgba(100,110,100,0.4)";
    ctx.lineWidth = 0.5;
    for (let i = 10; i < szW; i += 10) {
      ctx.beginPath(); ctx.moveTo(szX1 + i, szY1); ctx.lineTo(szX1 + i, szY1 + szW); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(szX1, szY1 + i); ctx.lineTo(szX1 + szW, szY1 + i); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(200,210,200,0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(szX1, szY1, szW, szW);
    ctx.setLineDash([]);
  }

  // World border
  ctx.strokeStyle = hsl("--accent");
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  // Ruin area ground tint — cached gradients, skip off-screen
  for (let i = 0; i < state.ruinAreas.length; i++) {
    const ra = state.ruinAreas[i];
    if (!inView(ra.cx, ra.cy, ra.radius * 1.8)) continue;
    let grad = _ruinGradCache.get(i);
    if (!grad) {
      // Gradients are attached to a context so we can't truly cache across frames,
      // but we can recreate only when first seen or on respawn.
      // Use a flag: store on the object itself.
      grad = ctx.createRadialGradient(ra.cx, ra.cy, ra.radius * 0.1, ra.cx, ra.cy, ra.radius * 1.8);
      grad.addColorStop(0, "rgba(15,10,5,0.55)");
      grad.addColorStop(0.6, "rgba(25,18,8,0.35)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      _ruinGradCache.set(i, grad);
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ra.cx, ra.cy, ra.radius * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Roads — skip roads whose bounding box is off screen
  for (const road of state.roads) {
    if (roadInView(road)) drawRoad(ctx, road);
  }

  // Entities — cull to viewport first, then sort only what's visible.
  // If player is inside a building, draw that building first (below player).
  const drawList: Entity[] = [];
  for (const e of state.entities) {
    if (!inView(e.pos.x, e.pos.y, e.radius + 60)) continue;
    if (state.insideBuilding !== null && e.id === state.insideBuilding) {
      drawEntity(ctx, e); // draw behind everything else
      continue;
    }
    drawList.push(e);
  }
  drawList.sort((a, b) => a.pos.y - b.pos.y);
  for (const e of drawList) drawEntity(ctx, e);

  // Remote players
  for (const rp of remotePlayers.values()) {
    if (!inView(rp.x, rp.y, 40)) continue;
    const fake = {
      id: -1, kind: "player" as const,
      pos: { x: rp.x, y: rp.y }, vel: { x: 0, y: 0 },
      radius: 20, angle: rp.angle, hp: 1, maxHp: 1,
      facing: rp.facing, moving: rp.moving, animTime: rp.animTime,
      avatar: rp.avatar,
    } as Entity;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y + 12, 19, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (rp.avatar === "doggo") drawDoggo(ctx, fake);
    else drawPlayerSprite(ctx, fake);
    ctx.save();
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(rp.name, rp.x + 1, rp.y - 30 + 1);
    ctx.fillStyle = "#fff";
    ctx.fillText(rp.name, rp.x, rp.y - 30);
    ctx.restore();
  }

  ctx.restore();

  drawHud(ctx, state, viewW, viewH, isMobile, remotePlayers.size);
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity) {
  const { x, y } = e.pos;

  if (e.kind !== "bullet" && e.kind !== "corpse" && e.kind !== "car") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + e.radius * 0.6, e.radius * 0.95, e.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  switch (e.kind) {
    case "tree": {
      ctx.fillStyle = hsl("--tree-shadow");
      ctx.beginPath();
      ctx.arc(x, y, e.radius + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hsl("--tree");
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "rock": {
      ctx.fillStyle = hsl("--rock-shadow");
      ctx.beginPath();
      ctx.arc(x, y + 3, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hsl("--rock");
      ctx.beginPath();
      ctx.arc(x, y, e.radius - 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ruin":  { drawRuinBuilding(ctx, e); break; }
    case "car":   { drawCar(ctx, e); break; }
    case "player": {
      if (e.avatar === "doggo") drawDoggo(ctx, e);
      else drawPlayerSprite(ctx, e);
      break;
    }
    case "doggo":  { drawDoggo(ctx, e); break; }
    case "zombie": {
      const flash = e.hitFlash ? "#fff" : hsl("--zombie");
      drawCharacter(ctx, e, flash);
      break;
    }
    case "pig":
    case "cow": {
      const flash = e.hitFlash ? "#fff" : hsl(e.kind === "pig" ? "--pig" : "--cow");
      drawAnimal(ctx, e, flash);
      break;
    }
    case "bullet": {
      ctx.fillStyle = hsl("--bullet");
      ctx.shadowColor = hsl("--bullet");
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case "grenade": {
      const blink = (e.fuseTimer ?? 4) < 1.5 && Math.floor((e.fuseTimer ?? 0) * 8) % 2 === 0;
      ctx.fillStyle = blink ? "#ff4400" : "#2a2a18";
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = blink ? "#ff8800" : "#888860";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#666644";
      ctx.beginPath();
      ctx.arc(x, y - e.radius + 2, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "explosion": {
      const pct = Math.max(0, (e.ttl ?? 0) / 0.5);
      const r = e.radius * (1.2 - pct * 0.2);
      ctx.globalAlpha = pct;
      ctx.fillStyle = "rgba(255,180,40,0.9)";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,80,0,0.7)";
      ctx.beginPath(); ctx.arc(x, y, r * 0.65, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,240,200,0.9)";
      ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "corpse": {
      const a = Math.max(0, Math.min(1, (e.fadeTtl ?? 0) / 8));
      ctx.fillStyle = `hsla(0,65%,25%,${a * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, e.radius + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(95,30%,25%,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  if (
    (e.kind === "zombie" || e.kind === "pig" || e.kind === "cow") &&
    e.hp > 0 && e.hp < e.maxHp
  ) {
    const w = 40;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - w / 2, y - e.radius - 12, w, 5);
    ctx.fillStyle = hsl("--accent");
    ctx.fillRect(x - w / 2, y - e.radius - 12, (w * e.hp) / e.maxHp, 5);
  }
}

function drawPlayerSprite(ctx: CanvasRenderingContext2D, e: Entity) {
  const { x, y } = e.pos;
  const facing = e.facing ?? "down";
  const frames = playerSprites[facing];
  const frameIdx = e.moving ? (Math.floor((e.animTime ?? 0) * 8) % 2) : 0;
  const img = frames[frameIdx];
  const size = e.radius * 2.6;
  if (img.complete && img.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x - size / 2, y - size / 2 - 4, size, size);
  } else {
    ctx.fillStyle = hsl("--player");
    ctx.beginPath();
    ctx.arc(x, y, e.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(e.radius - 2, -3, 22, 6);
  if (e.muzzleFlash) {
    ctx.fillStyle = "rgba(255,220,120,0.95)";
    ctx.beginPath();
    ctx.arc(e.radius + 22, 0, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDoggo(ctx: CanvasRenderingContext2D, e: Entity) {
  const { x, y } = e.pos;
  const f = e.facing;
  const facing: "down" | "up" | "left" | "right" =
    f === "up" || f === "left" || f === "right" ? f : "down";
  const frames = doggoSprites[facing];
  const frameIdx = Math.floor(Math.abs(e.animTime ?? 0) * 8) % 2;
  const img = frames[frameIdx];
  const size = e.radius * 3.2;
  if (img.complete && img.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x - size / 2, y - size / 2 - 4, size, size);
  } else {
    ctx.fillStyle = "#c8a96e";
    ctx.beginPath();
    ctx.arc(x, y, e.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(e.radius - 2, -3, 22, 6);
  if (e.muzzleFlash) {
    ctx.fillStyle = "rgba(255,220,120,0.95)";
    ctx.beginPath();
    ctx.arc(e.radius + 22, 0, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCharacter(ctx: CanvasRenderingContext2D, e: Entity, color: string) {
  const { x, y } = e.pos;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, e.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(e.radius - 4, -e.radius * 0.55, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.arc(e.radius - 4, e.radius * 0.55, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // claws
  ctx.fillStyle = "#2a1a1a";
  ctx.fillRect(e.radius - 2, -10, 8, 4);
  ctx.fillRect(e.radius - 2, 6, 8, 4);
  ctx.restore();
}

function drawAnimal(ctx: CanvasRenderingContext2D, e: Entity, color: string) {
  const { x, y } = e.pos;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, e.radius * 1.25, e.radius * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(e.radius * 0.95, 0, e.radius * 0.55, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(e.radius * 1.15, -e.radius * 0.2, 2.5, 0, Math.PI * 2);
  ctx.fill();
  if (e.kind === "cow") {
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath(); ctx.ellipse(-4, -6, 7, 5, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, 8, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// --- Road rendering ---

function seededRand(seed: number, index: number): number {
  const x = Math.sin(seed * 9301 + index * 49297 + 233720) * 439769.0;
  return x - Math.floor(x);
}

function bezPt(ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, t: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * ax + 2 * mt * t * cpx + t * t * bx,
    y: mt * mt * ay + 2 * mt * t * cpy + t * t * by,
  };
}

function inGap(t: number, gaps: Array<[number, number]>): boolean {
  for (let i = 0; i < gaps.length; i++) {
    if (t >= gaps[i][0] && t <= gaps[i][1]) return true;
  }
  return false;
}

function drawRoad(ctx: CanvasRenderingContext2D, road: Road) {
  const { ax, ay, bx, by, cx: cpx, cy: cpy, seed, gaps } = road;
  const STEPS = 60; // reduced from 120 — visually identical
  const pathW = 48;
  const vergeW = 68;

  function strokeSegments(lineW: number, style: string) {
    ctx.lineWidth = lineW;
    ctx.strokeStyle = style;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let drawing = false;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const { x, y } = bezPt(ax, ay, cpx, cpy, bx, by, t);
      if (inGap(t, gaps)) {
        if (drawing) { ctx.stroke(); drawing = false; }
      } else {
        if (!drawing) { ctx.beginPath(); ctx.moveTo(x, y); drawing = true; }
        else ctx.lineTo(x, y);
      }
    }
    if (drawing) ctx.stroke();
  }

  strokeSegments(vergeW, "rgba(90,65,35,0.45)");
  strokeSegments(pathW, "rgba(105,78,45,0.82)");
  strokeSegments(pathW * 0.45, "rgba(140,108,62,0.38)");

  // Wheel ruts
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(55,38,18,0.65)";
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    const rutOffset = pathW * 0.28 * side;
    let drawing = false;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      if (inGap(t, gaps)) { if (drawing) { ctx.stroke(); drawing = false; } continue; }
      const { x, y } = bezPt(ax, ay, cpx, cpy, bx, by, t);
      const dtx = 2 * (1 - t) * (cpx - ax) + 2 * t * (bx - cpx);
      const dty = 2 * (1 - t) * (cpy - ay) + 2 * t * (by - cpy);
      const tl = Math.hypot(dtx, dty) || 1;
      const nx = -dty / tl * rutOffset;
      const ny =  dtx / tl * rutOffset;
      if (!drawing) { ctx.beginPath(); ctx.moveTo(x + nx, y + ny); drawing = true; }
      else ctx.lineTo(x + nx, y + ny);
    }
    if (drawing) ctx.stroke();
  }

  // Grass tufts (reduced count)
  const tuftCount = 12 + Math.floor(seededRand(seed, 0) * 8);
  for (let k = 0; k < tuftCount; k++) {
    const t = seededRand(seed, k + 1);
    if (inGap(t, gaps)) continue;
    const { x, y } = bezPt(ax, ay, cpx, cpy, bx, by, t);
    const dtx = 2 * (1 - t) * (cpx - ax) + 2 * t * (bx - cpx);
    const dty = 2 * (1 - t) * (cpy - ay) + 2 * t * (by - cpy);
    const tl = Math.hypot(dtx, dty) || 1;
    const nx = -dty / tl;
    const ny =  dtx / tl;
    const side = seededRand(seed, k + 300) < 0.5 ? 1 : -1;
    const edgeDist = pathW * 0.5 * (0.85 + seededRand(seed, k + 400) * 0.3) * side;
    const r = 4 + seededRand(seed, k + 500) * 7;
    ctx.beginPath();
    ctx.arc(x + nx * edgeDist, y + ny * edgeDist, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(55,80,30,${0.25 + seededRand(seed, k + 600) * 0.25})`;
    ctx.fill();
  }

  // Gap edges
  for (const [gs, ge] of gaps) {
    for (const gEdge of [gs, ge]) {
      const { x, y } = bezPt(ax, ay, cpx, cpy, bx, by, gEdge);
      ctx.beginPath();
      ctx.arc(x, y, pathW * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(65,45,20,0.5)";
      ctx.fill();
    }
  }
}

function drawCar(ctx: CanvasRenderingContext2D, e: Entity) {
  const v = e.carVariant ?? 0;
  const bodies = [
    { w: 52, h: 26 }, { w: 58, h: 30 }, { w: 44, h: 24 }, { w: 64, h: 28 },
  ];
  const { w: bw, h: bh } = bodies[v];

  ctx.save();
  ctx.translate(e.pos.x, e.pos.y);
  ctx.rotate(e.angle);

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(4, 4, bw * 0.55, bh * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = v === 1 ? "#4a2e10" : "#3d2510";
  ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 5); ctx.fill();

  const bodyColors = ["#6b3a1a", "#5c3212", "#7a3e18", "#4e2a0e"];
  ctx.fillStyle = bodyColors[v];
  ctx.beginPath(); ctx.roundRect(-bw / 2 + 2, -bh / 2 + 2, bw - 4, bh - 4, 4); ctx.fill();

  ctx.fillStyle = "rgba(90,40,5,0.55)";
  ctx.beginPath(); ctx.ellipse(-bw * 0.15, -bh * 0.25, bw * 0.12, bh * 0.18, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bw * 0.2, bh * 0.1, bw * 0.1, bh * 0.2, -0.3, 0, Math.PI * 2); ctx.fill();

  const cabinX = v === 1 ? -bw * 0.05 : -bw * 0.08;
  ctx.fillStyle = "#1a1208";
  ctx.beginPath(); ctx.roundRect(cabinX - bw * 0.18, -bh * 0.32, bw * 0.36, bh * 0.64, 3); ctx.fill();
  ctx.strokeStyle = "rgba(180,160,100,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cabinX - bw * 0.1, -bh * 0.28); ctx.lineTo(cabinX + bw * 0.05, bh * 0.22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cabinX + bw * 0.08, -bh * 0.2); ctx.lineTo(cabinX - bw * 0.04, bh * 0.28); ctx.stroke();

  const wx = bw * 0.38, wy = bh * 0.42, wr = 5;
  for (const [sx, sy] of [[-wx, -wy], [wx, -wy], [-wx, wy], [wx, wy]] as [number,number][]) {
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.ellipse(sx, sy, wr + 1, wr * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath(); ctx.ellipse(sx, sy, wr - 1, (wr - 1) * 0.65, 0, 0, Math.PI * 2); ctx.fill();
  }

  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 5); ctx.stroke();

  ctx.restore();
}

// per-variant: [wallColor, wallHighlight, floorColor, detailColor, rubbleColor]
const _ruinPalette: Array<[string, string, string, string, string]> = [
  ["#4a3a28", "#6a5a3c", "#1e1408", "#0e0a04", "#3a2c18"],  // 0 brown house
  ["#3d3a22", "#585430", "#141612", "#0a0c06", "#2c2c14"],  // 1 olive shop
  ["#5a2c18", "#784030", "#180e08", "#0c0604", "#3c1e10"],  // 2 red factory
  ["#484848", "#686868", "#141414", "#080808", "#363636"],  // 3 concrete shed
  ["#3a4228", "#506038", "#0e1208", "#060804", "#283016"],  // 4 mossy warehouse
  ["#5a3828", "#7a5038", "#1c1008", "#100804", "#3e2818"],  // 5 brick shack
  ["#484040", "#645858", "#101010", "#060404", "#302828"],  // 6 ash L-shape
  ["#504e30", "#706e44", "#181608", "#0c0a04", "#3a3820"],  // 7 tan hall
];

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function _fr(ctx: Ctx2D, x: number, y: number, w: number, h: number) {
  ctx.fillRect(x, y, w, h);
}

function _hole(ctx: Ctx2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

function _drawRuinBuildingShape(ctx: Ctx2D, w: number, h: number, v: number, twoDoors = false) {
  const [wall, wallHi, floor, void_, rubble] = _ruinPalette[v % _ruinPalette.length];
  const T = Math.round(Math.max(8, w * 0.075)); // wall thickness
  const hx = w / 2, hy = h / 2;
  const doorHW = Math.round(w * 0.20); // must match update.ts isInDoorZone

  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  _fr(ctx, -hx + 4, -hy + 4, w, h);

  // Floor
  ctx.fillStyle = floor;
  _fr(ctx, -hx, -hy, w, h);

  // ── variant interior details (drawn on floor, under walls) ──
  ctx.fillStyle = rubble;

  if (v === 0) {
    // House: interior room divider (partial), rubble pile NE corner
    _fr(ctx, T, -hy + T, 4, h * 0.55);           // room divider
    _fr(ctx, hx - T - 14, -hy + T + 4, 14, 10);  // rubble NE
    _fr(ctx, hx - T - 10, -hy + T + 14, 10, 8);
  } else if (v === 1) {
    // Shop: counter near N wall, rubble SW
    _fr(ctx, -hx + T + 4, -hy + T + 6, w * 0.55, 6); // counter
    _fr(ctx, -hx + T + 4, -hy + T + 12, w * 0.35, 4);
    _fr(ctx, -hx + T + 2, hy - T - 16, 12, 10);        // rubble SW
    _fr(ctx, -hx + T + 2, hy - T - 22, 8, 6);
  } else if (v === 2) {
    // Factory: 2 bay dividers + long floor stripe
    _fr(ctx, -w * 0.22, -hy + T, 5, h - T * 2);
    _fr(ctx,  w * 0.18, -hy + T, 5, h - T * 2);
    ctx.fillStyle = void_;
    _fr(ctx, -hx + T, -hy + T + 2, w - T * 2, 3); // floor seam
  } else if (v === 3) {
    // Shed: rubble pile in SE where wall collapsed
    _fr(ctx, hx - T - 20, hy - T - 20, 20, 12);
    _fr(ctx, hx - T - 14, hy - T - 30, 14, 10);
    _fr(ctx, hx - T - 22, hy - T - 12, 8, 8);
  } else if (v === 4) {
    // Warehouse: 4 support pillars + center divider
    const px = T + 8, py = T + 8, ps = 10;
    _fr(ctx, -hx + px, -hy + py, ps, ps);
    _fr(ctx,  hx - px - ps, -hy + py, ps, ps);
    _fr(ctx, -hx + px,  hy - py - ps, ps, ps);
    _fr(ctx,  hx - px - ps,  hy - py - ps, ps, ps);
    _fr(ctx, -5, -hy + T, 5, h * 0.6);              // partial divider
  } else if (v === 5) {
    // Shack: large roof collapse hole
    ctx.fillStyle = void_;
    _hole(ctx, w * 0.05, h * 0.05, w * 0.28, h * 0.28);
    ctx.fillStyle = rubble;
    _fr(ctx, -hx + T + 2, hy - T - 10, 10, 6);
  } else if (v === 6) {
    // L-shape: scorch marks
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    _hole(ctx, -w * 0.2, h * 0.1, w * 0.18, h * 0.14);
    _hole(ctx,  w * 0.25, -h * 0.2, w * 0.12, h * 0.1);
    ctx.fillStyle = rubble;
    _fr(ctx, T + 2, -hy + T + 4, 16, 8);
  } else if (v === 7) {
    // Hall: 4 pew/bench blocks symmetrically placed
    const bx = hx * 0.45, bw = 6, bh = h * 0.18;
    _fr(ctx, -bx - bw, -hy + T + 8, bw, bh);
    _fr(ctx,  bx, -hy + T + 8, bw, bh);
    _fr(ctx, -bx - bw,  hy - T - 8 - bh, bw, bh);
    _fr(ctx,  bx,  hy - T - 8 - bh, bw, bh);
    ctx.fillStyle = void_;
    _fr(ctx, -8, -8, 16, 16); // altar mark
  }

  // ── walls as filled rectangles ──
  function wallRect(x: number, y: number, ww: number, wh: number) {
    ctx.fillStyle = wall; _fr(ctx, x, y, ww, wh);
    ctx.fillStyle = wallHi; _fr(ctx, x, y, ww, 3); // top-edge highlight
  }
  // South wall with centered door gap
  function wallS(thick: number) {
    wallRect(-hx, hy - thick, hx - doorHW, thick);
    wallRect(doorHW, hy - thick, hx - doorHW, thick);
  }
  // North wall with centered door gap (mirrors wallS)
  function wallN(thick: number) {
    wallRect(-hx, -hy, hx - doorHW, thick);
    wallRect(doorHW, -hy, hx - doorHW, thick);
  }

  if (v === 0) {
    wallRect(hx - T, -hy, T, h);                             // E
    wallRect(-hx, -hy, T, h);                                // W
    twoDoors ? wallN(T) : wallRect(-hx, -hy, w, T);          // N
    wallS(T);                                                 // S door
    ctx.fillStyle = floor; _fr(ctx, hx - T, -hy, T, T + 8); // crumbled NE corner
  } else if (v === 1) {
    // Shop: always has storefront gap on N — treated as second opening when twoDoors
    wallRect(-hx, -hy, w * 0.28, T);                         // N left
    wallRect(hx - T - w * 0.25, -hy, w * 0.25 + T, T);      // N right
    wallRect(hx - T, -hy, T, h);                             // E
    wallRect(-hx, -hy, T, h * 0.7);                          // W partial
    wallS(T);                                                 // S door
  } else if (v === 2) {
    wallRect(-hx, -hy, T, h);                                // W
    wallRect(hx - T, -hy, T, h * 0.38);                      // E upper only
    twoDoors ? wallN(T) : wallRect(-hx, -hy, w, T);          // N
    wallS(T);                                                 // S door
  } else if (v === 3) {
    wallRect(-hx, -hy, w, T);                                // N (shacks never get two doors)
    wallRect(-hx, -hy, T, h);                                // W
    wallRect(hx - T, -hy, T, h * 0.55);                      // E partial
    wallS(T);                                                 // S door
  } else if (v === 4) {
    const TT = T + 3;
    twoDoors ? wallN(TT) : wallRect(-hx, -hy, w, TT);        // N
    wallRect(-hx, -hy, TT, h);                               // W
    wallRect(hx - TT, -hy, TT, h * 0.62);                    // E upper
    wallRect(hx - TT, hy - TT - h * 0.22, TT, h * 0.22);    // E lower (dock gap)
    ctx.fillStyle = void_; _fr(ctx, hx - TT, hy - TT - h * 0.22, TT, h * 0.22 - 2);
    wallRect(-hx, hy - TT, hx - doorHW, TT);                 // S door left
    wallRect(doorHW, hy - TT, hx - doorHW, TT);              // S door right
  } else if (v === 5) {
    wallRect(-hx, -hy, w, T);                                // N (shacks never get two doors)
    wallRect(hx - T, -hy, T, h);                             // E
    wallRect(-hx, -hy, T, h * 0.42);                         // W upper only
    wallS(T);                                                 // S door
  } else if (v === 6) {
    twoDoors ? wallN(T) : wallRect(-hx, -hy, w, T);          // N
    wallRect(hx - T, -hy, T, h * 0.55);                      // E upper
    wallRect(-hx, -hy, T, h);                                // W
    wallRect(w * 0.55 - hx, -hy + h * 0.55 - T, T, h * 0.45 + T); // inner E wall
    wallRect(-hx, -hy + h * 0.55 - T, w * 0.55, T);          // connector ledge
    wallS(T);                                                 // S door
  } else if (v === 7) {
    twoDoors ? wallN(T) : wallRect(-hx, -hy, w, T);          // N
    wallRect(hx - T, -hy, T, h);                             // E
    wallRect(-hx, -hy, T, h);                                // W
    wallS(T);                                                 // S door
    const pw2 = doorHW * 2 + 8, ph2 = T + 4;
    wallRect(-pw2 / 2, hy - T, pw2, ph2);                    // S porch bump
    if (!twoDoors) {
      // Window gaps only when N is solid
      ctx.fillStyle = floor;
      _fr(ctx, -hx * 0.5 - 5, -hy, 10, T);
      _fr(ctx,  hx * 0.5 - 5, -hy, 10, T);
    }
  }

  // ── damage: small void holes punched into walls ──
  ctx.fillStyle = void_;
  if (v === 0) { _fr(ctx, -hx + T * 1.5, -hy, 8, 5); }
  if (v === 1) { _fr(ctx, hx - T, hy - T * 2, T, 6); }
  if (v === 2) { _fr(ctx, -hx + w * 0.3, -hy, 12, T * 0.6); _fr(ctx, -hx + w * 0.6, -hy, 8, T * 0.6); }
  if (v === 3) { _fr(ctx, -hx + T * 2, hy - T, 10, T); }
  if (v === 6) { _fr(ctx, hx - T, -hy + h * 0.3, T, 7); }
}

function drawRuinBuilding(ctx: CanvasRenderingContext2D, e: Entity) {
  const { x, y } = e.pos;
  const oc = getRuinCanvas(e);
  const half = oc.width / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  ctx.drawImage(oc, -half, -half);
  ctx.restore();
}

// --- HUD ---

function drawHud(ctx: CanvasRenderingContext2D, state: GameState, viewW: number, viewH: number, isMobile = false, onlineCount = 0) {
  const { player } = state;

  // Health bar — on mobile move to top-center so it clears the joystick
  const barW = 280, barH = 18;
  const bx = isMobile ? (viewW - barW) / 2 : 24;
  const by = isMobile ? 14 : viewH - 48;
  ctx.fillStyle = hsl("--hud-bg", 0.85);
  ctx.fillRect(bx - 6, by - 6, barW + 12, barH + 12);
  ctx.fillStyle = hsl("--secondary");
  ctx.fillRect(bx, by, barW, barH);
  const pct = player.hp / player.maxHp;
  ctx.fillStyle = pct > 0.5 ? hsl("--primary") : pct > 0.25 ? "hsl(40,80%,55%)" : hsl("--accent");
  ctx.fillRect(bx, by, barW * pct, barH);
  ctx.fillStyle = hsl("--foreground");
  ctx.font = "bold 13px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  ctx.fillText(`HP ${Math.ceil(player.hp)} / ${player.maxHp}`, bx + 10, by + barH / 2);

  // Kills + coords + online count
  ctx.fillStyle = hsl("--hud-bg", 0.85);
  ctx.fillRect(viewW - 200, 16, 184, 72);
  ctx.fillStyle = hsl("--foreground");
  ctx.font = "bold 14px ui-sans-serif, system-ui";
  ctx.textBaseline = "top";
  ctx.fillText(`Kills: ${state.kills}`, viewW - 188, 26);
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillStyle = hsl("--muted-foreground");
  ctx.fillText(
    `X ${Math.round(player.pos.x - SPAWN_POINT.x)}  Y ${Math.round(player.pos.y - SPAWN_POINT.y)}`,
    viewW - 188, 48
  );
  ctx.fillStyle = onlineCount > 0 ? "rgba(100,220,100,0.9)" : "rgba(180,180,180,0.6)";
  ctx.fillText(`● ${onlineCount + 1} online`, viewW - 188, 64);

  // Minimap
  const mmSize = 180;
  const mmX = viewW - mmSize - 16;
  const mmY = viewH - mmSize - 16;
  const mmViewRange = 1100;
  const mmScale = mmSize / mmViewRange;
  const mmOriginX = player.pos.x - mmViewRange / 2;
  const mmOriginY = player.pos.y - mmViewRange / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(mmX, mmY, mmSize, mmSize);
  ctx.clip();

  ctx.fillStyle = hsl("--hud-bg", 0.85);
  ctx.fillRect(mmX - 4, mmY - 4, mmSize + 8, mmSize + 8);
  ctx.fillStyle = hsl("--grass-dark");
  ctx.fillRect(mmX, mmY, mmSize, mmSize);

  // Roads
  ctx.strokeStyle = "rgba(55,48,35,0.85)";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (const road of state.roads) {
    const rax = mmX + (road.ax - mmOriginX) * mmScale;
    const ray = mmY + (road.ay - mmOriginY) * mmScale;
    const rbx = mmX + (road.bx - mmOriginX) * mmScale;
    const rby = mmY + (road.by - mmOriginY) * mmScale;
    const rcx = mmX + (road.cx - mmOriginX) * mmScale;
    const rcy = mmY + (road.cy - mmOriginY) * mmScale;
    ctx.beginPath();
    ctx.moveTo(rax, ray);
    ctx.quadraticCurveTo(rcx, rcy, rbx, rby);
    ctx.stroke();
  }

  // Ruin zones
  for (const ra of state.ruinAreas) {
    const rx = mmX + (ra.cx - mmOriginX) * mmScale;
    const ry = mmY + (ra.cy - mmOriginY) * mmScale;
    ctx.fillStyle = "rgba(60,30,10,0.7)";
    ctx.beginPath();
    ctx.arc(rx, ry, ra.radius * mmScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8b6040";
    ctx.beginPath();
    ctx.arc(rx, ry, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Entities — skip trees/rocks on minimap (too many, add noise)
  for (const e of state.entities) {
    if (e.hp <= 0) continue;
    if (e.kind === "tree" || e.kind === "rock") continue;
    const ex = mmX + (e.pos.x - mmOriginX) * mmScale;
    const ey = mmY + (e.pos.y - mmOriginY) * mmScale;
    if (ex < mmX || ex > mmX + mmSize || ey < mmY || ey > mmY + mmSize) continue;
    let col: string | null = null, r = 1.5;
    if (e.kind === "zombie")            { col = hsl("--zombie"); r = 2.5; }
    else if (e.kind === "pig")          { col = hsl("--pig");    r = 2;   }
    else if (e.kind === "cow")          { col = hsl("--cow");    r = 2;   }
    else if (e.kind === "ruin")         { col = "#7a5535";       r = 4;   }
    else if (e.kind === "car")          { col = "#6b3a1a";       r = 3;   }
    if (col) {
      ctx.fillStyle = col;
      ctx.fillRect(ex - r / 2, ey - r / 2, r, r);
    }
  }

  // Player dot
  const px = mmX + (player.pos.x - mmOriginX) * mmScale;
  const py = mmY + (player.pos.y - mmOriginY) * mmScale;
  ctx.fillStyle = hsl("--player");
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.strokeStyle = hsl("--foreground");
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmSize, mmSize);

  // Nearest ruin label
  let nearestRuin = state.ruinAreas[0];
  let nearestDist = Infinity;
  for (const ra of state.ruinAreas) {
    const d = Math.hypot(ra.cx - player.pos.x, ra.cy - player.pos.y);
    if (d < nearestDist) { nearestDist = d; nearestRuin = ra; }
  }
  if (nearestRuin && nearestDist < 3000) {
    ctx.fillStyle = hsl("--hud-bg", 0.8);
    ctx.fillRect(mmX, mmY - 22, mmSize, 20);
    ctx.fillStyle = nearestDist < 600 ? "hsl(30,80%,65%)" : hsl("--muted-foreground");
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(
      nearestDist < 600 ? `⚠ ${nearestRuin.name}` : `→ ${nearestRuin.name} ${Math.round(nearestDist)}m`,
      mmX + mmSize / 2, mmY - 12
    );
    ctx.textAlign = "left";
  }

  // Large map overlay
  if (state.showLargeMap) {
    const LM = 600;
    const lmX = (viewW - LM) / 2;
    const lmY = (viewH - LM) / 2;
    const lmViewRange = 5000;
    const lmScale = LM / lmViewRange;
    const lmOriginX = player.pos.x - lmViewRange / 2;
    const lmOriginY = player.pos.y - lmViewRange / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(lmX, lmY, LM, LM);
    ctx.clip();

    ctx.fillStyle = "rgba(10,12,8,0.93)";
    ctx.fillRect(lmX, lmY, LM, LM);
    ctx.fillStyle = hsl("--grass-dark", 0.4);
    ctx.fillRect(lmX, lmY, LM, LM);

    // Roads
    ctx.strokeStyle = "rgba(90,68,40,0.9)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const road of state.roads) {
      const rax = lmX + (road.ax - lmOriginX) * lmScale;
      const ray = lmY + (road.ay - lmOriginY) * lmScale;
      const rbx = lmX + (road.bx - lmOriginX) * lmScale;
      const rby = lmY + (road.by - lmOriginY) * lmScale;
      const rcx = lmX + (road.cx - lmOriginX) * lmScale;
      const rcy = lmY + (road.cy - lmOriginY) * lmScale;
      ctx.beginPath();
      ctx.moveTo(rax, ray);
      ctx.quadraticCurveTo(rcx, rcy, rbx, rby);
      ctx.stroke();
    }

    // Ruin zones + labels
    for (const ra of state.ruinAreas) {
      const rx = lmX + (ra.cx - lmOriginX) * lmScale;
      const ry = lmY + (ra.cy - lmOriginY) * lmScale;
      ctx.fillStyle = "rgba(80,40,10,0.65)";
      ctx.beginPath();
      ctx.arc(rx, ry, ra.radius * lmScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c8904a";
      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(210,175,110,0.9)";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(ra.name, rx, ry - 6);
    }

    // Entities
    for (const e of state.entities) {
      if (e.hp <= 0) continue;
      if (e.kind === "tree" || e.kind === "rock" || e.kind === "bullet") continue;
      const ex = lmX + (e.pos.x - lmOriginX) * lmScale;
      const ey = lmY + (e.pos.y - lmOriginY) * lmScale;
      if (ex < lmX || ex > lmX + LM || ey < lmY || ey > lmY + LM) continue;
      let col: string | null = null, r = 2;
      if (e.kind === "zombie")       { col = hsl("--zombie"); r = 3; }
      else if (e.kind === "pig")     { col = hsl("--pig");    r = 2.5; }
      else if (e.kind === "cow")     { col = hsl("--cow");    r = 2.5; }
      else if (e.kind === "ruin")    { col = "#6a4828";       r = 5; }
      else if (e.kind === "car")     { col = "#7a4020";       r = 3.5; }
      if (col) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Player dot
    const lmpx = lmX + (player.pos.x - lmOriginX) * lmScale;
    const lmpy = lmY + (player.pos.y - lmOriginY) * lmScale;
    ctx.fillStyle = hsl("--player");
    ctx.beginPath(); ctx.arc(lmpx, lmpy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = "rgba(200,175,120,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeRect(lmX, lmY, LM, LM);

    ctx.fillStyle = "rgba(210,185,140,0.9)";
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("[ MAP — M to close ]", viewW / 2, lmY - 4);
    ctx.textAlign = "left";
  }

  if (state.insideBuilding) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = "rgba(210,185,145,0.92)";
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("[ INSIDE BUILDING ]", viewW / 2, 18);
    ctx.textAlign = "left";
  }

  if (player.hp <= 0) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = hsl("--accent");
    ctx.font = "bold 64px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("YOU DIED", viewW / 2, viewH / 2 - 20);
    ctx.fillStyle = hsl("--foreground");
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.fillText("Press R to respawn", viewW / 2, viewH / 2 + 30);
    ctx.textAlign = "left";
  }
}
