import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { RUIN_BUILDING_SIZES } from "@/game/world";
import type { TownBuilding, TownRoad, TownTemplate } from "@/game/types";

const CANVAS_SIZE = 800;
const WORLD_SCALE = 1400 / CANVAS_SIZE; // canvas px → world units
const GRID_CELLS = 20;
const CELL_PX = CANVAS_SIZE / GRID_CELLS;
const MAX_TEMPLATES = 10;
const STORAGE_KEY = "fallout-frenzy-town-templates";

const VARIANT_COLORS = [
  "#3a2c1c", "#2e2a1a", "#3c2010", "#2a2a2a",
  "#2c3018", "#382018", "#302828", "#343020",
];
const VARIANT_NAMES = [
  "Medium Rect", "Small Rect", "Long Narrow", "Small Square",
  "Warehouse", "Shack", "Med-Large", "Med Square",
];

type Mode = "place" | "delete" | "rubble" | "road" | "endpoint";

interface CanvasRoad { ax: number; ay: number; bx: number; by: number; cx: number; cy: number; }
interface Endpoint { x: number; y: number; }

// Compute a smooth quadratic bezier control point for a segment A→B given optional
// previous point (for incoming tangent) and next point (for outgoing tangent).
function smoothCP(
  ax: number, ay: number,
  bx: number, by: number,
  prevX?: number, prevY?: number,
  nextX?: number, nextY?: number
): { cx: number; cy: number } {
  // Tangent at A: direction from prev→B (or A→B if no prev)
  const tax = prevX !== undefined ? bx - prevX : bx - ax;
  const tay = prevY !== undefined ? by - prevY : by - ay;
  const taLen = Math.hypot(tax, tay) || 1;
  // Tangent at B: direction from A→next (or A→B if no next)
  const tbx = nextX !== undefined ? nextX - ax : bx - ax;
  const tby = nextY !== undefined ? nextY - ay : by - ay;
  const tbLen = Math.hypot(tbx, tby) || 1;
  // Control point = intersection of ray from A along t_a and ray from B along -t_b
  // P = A + s*(tax/taLen),  Q = B - t*(tbx/tbLen)
  // Solve: A.x + s*dax = B.x - t*dbx  →  using Cramer's rule
  const dax = tax / taLen, day = tay / taLen;
  const dbx = tbx / tbLen, dby = tby / tbLen;
  const det = dax * dby - day * dbx;
  if (Math.abs(det) > 0.001) {
    const dx = bx - ax, dy = by - ay;
    const s = (dx * dby - dy * dbx) / det;
    const cx = ax + s * dax;
    const cy = ay + s * day;
    // Clamp so control point doesn't fly off to infinity
    const dist = Math.hypot(bx - ax, by - ay);
    if (Math.hypot(cx - ax, cy - ay) < dist * 2) return { cx, cy };
  }
  return { cx: (ax + bx) / 2, cy: (ay + by) / 2 };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function loadTemplates(): TownTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveTemplates(ts: TownTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ts));
}
function snap(v: number, on: boolean): number {
  return on ? Math.round(v / CELL_PX) * CELL_PX : v;
}
function bezPt(ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, t: number) {
  const mt = 1 - t;
  return { x: mt * mt * ax + 2 * mt * t * cpx + t * t * bx, y: mt * mt * ay + 2 * mt * t * cpy + t * t * by };
}

// ── draw helpers ─────────────────────────────────────────────────────────────

// Matches render.ts palette: [wall, wallHi, floor, void, rubble]
const BUILDER_PALETTE: Array<[string, string, string, string, string]> = [
  ["#4a3a28", "#6a5a3c", "#1e1408", "#0e0a04", "#3a2c18"],
  ["#3d3a22", "#585430", "#141612", "#0a0c06", "#2c2c14"],
  ["#5a2c18", "#784030", "#180e08", "#0c0604", "#3c1e10"],
  ["#484848", "#686868", "#141414", "#080808", "#363636"],
  ["#3a4228", "#506038", "#0e1208", "#060804", "#283016"],
  ["#5a3828", "#7a5038", "#1c1008", "#100804", "#3e2818"],
  ["#484040", "#645858", "#101010", "#060404", "#302828"],
  ["#504e30", "#706e44", "#181608", "#0c0a04", "#3a3820"],
];

function _drawVariantShape(ctx: CanvasRenderingContext2D, v: number, pw: number, ph: number) {
  const [wall, wallHi, floor, void_, rubble] = BUILDER_PALETTE[v % BUILDER_PALETTE.length];
  const T = Math.max(3, Math.round(pw * 0.075));
  const hx = pw / 2, hy = ph / 2;

  function fr(x: number, y: number, w: number, h: number, col?: string) {
    ctx.fillStyle = col ?? wall;
    ctx.fillRect(x, y, w, h);
  }
  function wallR(x: number, y: number, w: number, h: number) {
    fr(x, y, w, h, wall);
    fr(x, y, w, 2, wallHi);
  }

  // Floor
  fr(-hx, -hy, pw, ph, floor);

  // Interior details
  if (v === 0) {
    fr(T, -hy + T, 2, ph * 0.55, rubble);
    fr(hx - T - 8, -hy + T + 2, 8, 6, rubble);
    fr(hx - T - 6, -hy + T + 8, 6, 4, rubble);
  } else if (v === 1) {
    fr(-hx + T + 2, -hy + T + 4, pw * 0.55, 4, rubble);
    fr(-hx + T + 2, -hy + T + 8, pw * 0.3, 3, rubble);
  } else if (v === 2) {
    fr(-pw * 0.22, -hy + T, 3, ph - T * 2, rubble);
    fr(pw * 0.18, -hy + T, 3, ph - T * 2, rubble);
  } else if (v === 3) {
    fr(hx - T - 12, hy - T - 12, 12, 7, rubble);
    fr(hx - T - 8, hy - T - 18, 8, 6, rubble);
  } else if (v === 4) {
    const ps = Math.max(4, T - 1);
    fr(-hx + T + 4, -hy + T + 4, ps, ps, rubble);
    fr(hx - T - 4 - ps, -hy + T + 4, ps, ps, rubble);
    fr(-hx + T + 4, hy - T - 4 - ps, ps, ps, rubble);
    fr(hx - T - 4 - ps, hy - T - 4 - ps, ps, ps, rubble);
    fr(-2, -hy + T, 2, ph * 0.6, rubble);
  } else if (v === 5) {
    ctx.fillStyle = void_;
    ctx.beginPath(); ctx.ellipse(pw * 0.05, ph * 0.05, pw * 0.28, ph * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  } else if (v === 6) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.ellipse(-pw * 0.2, ph * 0.08, pw * 0.18, ph * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  } else if (v === 7) {
    const bw = 3, bh = ph * 0.18;
    fr(-hx * 0.45 - bw, -hy + T + 4, bw, bh, rubble);
    fr(hx * 0.45, -hy + T + 4, bw, bh, rubble);
    fr(-hx * 0.45 - bw, hy - T - 4 - bh, bw, bh, rubble);
    fr(hx * 0.45, hy - T - 4 - bh, bw, bh, rubble);
    fr(-4, -4, 8, 8, void_);
  }

  // Walls
  if (v === 0) {
    wallR(-hx, -hy, pw, T);
    wallR(hx - T, -hy, T, ph);
    wallR(-hx, -hy, T, ph);
    wallR(-hx, hy - T, pw * 0.38, T);
    wallR(hx - T - pw * 0.28, hy - T, pw * 0.28 + T, T);
    fr(hx - T, -hy, T, T + 4, floor); // crumbled NE
  } else if (v === 1) {
    wallR(-hx, -hy, pw * 0.28, T);
    wallR(hx - T - pw * 0.25, -hy, pw * 0.25 + T, T);
    wallR(hx - T, -hy, T, ph);
    wallR(-hx, -hy, T, ph * 0.7);
    wallR(-hx, hy - T, pw * 0.4, T);
    wallR(hx - T - pw * 0.35, hy - T, pw * 0.35 + T, T);
  } else if (v === 2) {
    wallR(-hx, -hy, pw, T);
    wallR(-hx, hy - T, pw, T);
    wallR(-hx, -hy, T, ph);
    wallR(hx - T, -hy, T, ph * 0.4);
  } else if (v === 3) {
    wallR(-hx, -hy, pw, T);
    wallR(-hx, -hy, T, ph);
    wallR(hx - T, -hy, T, ph * 0.55);
    wallR(-hx, hy - T, pw * 0.52, T);
  } else if (v === 4) {
    const TT = T + 2;
    wallR(-hx, -hy, pw, TT);
    wallR(-hx, hy - TT, pw, TT);
    wallR(-hx, -hy, TT, ph);
    wallR(hx - TT, -hy, TT, ph * 0.62);
    wallR(hx - TT, hy - TT - ph * 0.22, TT, ph * 0.22);
    fr(hx - TT, hy - TT - ph * 0.22, TT, ph * 0.22 - 1, void_);
  } else if (v === 5) {
    wallR(-hx, -hy, pw, T);
    wallR(hx - T, -hy, T, ph);
    wallR(-hx, -hy, T, ph * 0.42);
    wallR(hx - T - pw * 0.3, hy - T, pw * 0.3 + T, T);
  } else if (v === 6) {
    wallR(-hx, -hy, pw, T);
    wallR(hx - T, -hy, T, ph * 0.55);
    wallR(-hx, -hy, T, ph);
    wallR(-hx, hy - T, pw * 0.55, T);
    wallR(pw * 0.55 - hx, -hy + ph * 0.55 - T, T, ph * 0.45 + T);
    wallR(-hx, -hy + ph * 0.55 - T, pw * 0.55, T);
  } else if (v === 7) {
    wallR(-hx, -hy, pw, T);
    wallR(hx - T, -hy, T, ph);
    wallR(-hx, -hy, T, ph);
    wallR(-hx, hy - T, pw * 0.32, T);
    wallR(hx - T - pw * 0.32, hy - T, pw * 0.32 + T, T);
    const pw2 = pw * 0.3;
    wallR(-pw2 / 2, hy - T, pw2, T + 3);
    fr(-hx * 0.5 - 3, -hy, 6, T, floor);
    fr(hx * 0.5 - 3, -hy, 6, T, floor);
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: TownBuilding, alpha = 1, highlight = false) {
  const s = RUIN_BUILDING_SIZES[b.variant % RUIN_BUILDING_SIZES.length];
  const pw = s.w / WORLD_SCALE;
  const ph = s.h / WORLD_SCALE;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(-pw / 2 + 2, -ph / 2 + 2, pw, ph);
  // Variant shape
  _drawVariantShape(ctx, b.variant, pw, ph);
  // Highlight border
  if (highlight) {
    ctx.strokeStyle = "#ffdc64";
    ctx.lineWidth = 2;
    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
  }
  ctx.restore();
}

function drawRoad(ctx: CanvasRenderingContext2D, r: CanvasRoad, alpha = 1) {
  const { ax, ay, bx, by, cx: cpx, cy: cpy } = r;
  const STEPS = 40;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(90,65,35,0.45)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  for (let i = 1; i <= STEPS; i++) {
    const { x, y } = bezPt(ax, ay, cpx, cpy, bx, by, i / STEPS);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(120,90,50,0.9)";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  for (let i = 1; i <= STEPS; i++) {
    const { x, y } = bezPt(ax, ay, cpx, cpy, bx, by, i / STEPS);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEndpoint(ctx: CanvasRenderingContext2D, ep: Endpoint, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#60c0ff";
  ctx.fillStyle = "rgba(60,140,220,0.2)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(ep.x, ep.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  // crosshair
  ctx.strokeStyle = "#60c0ff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ep.x - 14, ep.y); ctx.lineTo(ep.x + 14, ep.y);
  ctx.moveTo(ep.x, ep.y - 14); ctx.lineTo(ep.x, ep.y + 14);
  ctx.stroke();
  ctx.restore();
}

function drawRubbleDot(ctx: CanvasRenderingContext2D, r: { x: number; y: number }, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#6a5a40";
  ctx.beginPath();
  ctx.arc(r.x, r.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── component ─────────────────────────────────────────────────────────────────

export default function TownBuilder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [buildings, setBuildings] = useState<TownBuilding[]>([]);
  const [roads, setRoads] = useState<CanvasRoad[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [rubble, setRubble] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [mode, setMode] = useState<Mode>("place");
  const [showGrid, setShowGrid] = useState(true);
  const [townName, setTownName] = useState("New Town");
  const [templates, setTemplates] = useState<TownTemplate[]>(loadTemplates);
  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);
  const [placeAngle, setPlaceAngle] = useState(0);
  const [status, setStatus] = useState("");
  // Road waypoints: each Ctrl+click adds a point; plain click commits the road
  const [roadWaypoints, setRoadWaypoints] = useState<Array<{ x: number; y: number }>>([]);
  // Hover position for ghost preview
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Background
    ctx.fillStyle = "#1a1a14";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Ruin area circle boundary
    ctx.strokeStyle = "rgba(180,120,60,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= GRID_CELLS; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL_PX, 0); ctx.lineTo(i * CELL_PX, CANVAS_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL_PX); ctx.lineTo(CANVAS_SIZE, i * CELL_PX); ctx.stroke();
      }
    }

    // Center crosshair
    ctx.strokeStyle = "rgba(255,200,100,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CANVAS_SIZE / 2, 0); ctx.lineTo(CANVAS_SIZE / 2, CANVAS_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, CANVAS_SIZE / 2); ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE / 2); ctx.stroke();

    // Roads
    for (const r of roads) drawRoad(ctx, r);

    // Road endpoints
    for (const ep of endpoints) drawEndpoint(ctx, ep);

    // Rubble
    for (const r of rubble) drawRubbleDot(ctx, r);

    // Buildings
    for (let i = 0; i < buildings.length; i++) {
      drawBuilding(ctx, buildings[i], 1, i === selectedBuilding);
    }

    // ── Ghost preview at hover ──
    if (hover) {
      const { x, y } = hover;
      if (mode === "place") {
        drawBuilding(ctx, { x: snap(x, showGrid), y: snap(y, showGrid), variant: selectedVariant, angle: placeAngle }, 0.45);
      } else if (mode === "rubble") {
        drawRubbleDot(ctx, { x, y }, 0.5);
      } else if (mode === "endpoint") {
        drawEndpoint(ctx, { x, y }, 0.5);
      } else if (mode === "road") {
        const pts = roadWaypoints;
        if (pts.length > 0) {
          // Draw already-committed waypoints as dots + preview segment to cursor
          for (const wp of pts) {
            ctx.save(); ctx.globalAlpha = 0.9;
            ctx.fillStyle = "#e0c870";
            ctx.beginPath(); ctx.arc(wp.x, wp.y, 5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
          const last = pts[pts.length - 1];
          const prev = pts.length >= 2 ? pts[pts.length - 2] : undefined;
          const { cx: cpx, cy: cpy } = smoothCP(last.x, last.y, x, y, prev?.x, prev?.y);
          drawRoad(ctx, { ax: last.x, ay: last.y, bx: x, by: y, cx: cpx, cy: cpy }, 0.45);
        } else {
          ctx.save(); ctx.globalAlpha = 0.5;
          ctx.fillStyle = "#e0c870";
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }
  }, [buildings, roads, endpoints, rubble, showGrid, selectedBuilding, mode, hover, roadWaypoints, selectedVariant, placeAngle]);

  useEffect(() => { redraw(); }, [redraw]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }
  function handleMouseLeave() { setHover(null); }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const sx = snap(px, showGrid);
    const sy = snap(py, showGrid);

    if (mode === "rubble") {
      setRubble(prev => [...prev, { x: px, y: py }]);
      return;
    }

    if (mode === "endpoint") {
      setEndpoints(prev => [...prev, { x: px, y: py }]);
      return;
    }

    if (mode === "road") {
      if (e.ctrlKey) {
        // Ctrl+click: add waypoint (keep extending)
        setRoadWaypoints(prev => [...prev, { x: px, y: py }]);
      } else {
        // Plain click: finish the road
        const pts = [...roadWaypoints, { x: px, y: py }];
        if (pts.length >= 2) {
          // Build one Road segment per consecutive pair, with smooth control points
          const newRoads: CanvasRoad[] = [];
          for (let i = 0; i < pts.length - 1; i++) {
            const A = pts[i], B = pts[i + 1];
            const prev = i > 0 ? pts[i - 1] : undefined;
            const next = i + 2 < pts.length ? pts[i + 2] : undefined;
            const { cx: cpx, cy: cpy } = smoothCP(
              A.x, A.y, B.x, B.y,
              prev?.x, prev?.y, next?.x, next?.y
            );
            newRoads.push({ ax: A.x, ay: A.y, bx: B.x, by: B.y, cx: cpx, cy: cpy });
          }
          setRoads(prev => [...prev, ...newRoads]);
        }
        setRoadWaypoints([]);
      }
      return;
    }

    if (mode === "delete") {
      // Delete building
      let closest = -1, closestDist = Infinity;
      for (let i = 0; i < buildings.length; i++) {
        const d = Math.hypot(buildings[i].x - px, buildings[i].y - py);
        if (d < 20 && d < closestDist) { closestDist = d; closest = i; }
      }
      if (closest >= 0) { setBuildings(prev => prev.filter((_, i) => i !== closest)); setSelectedBuilding(null); return; }
      // Delete endpoint
      const epIdx = endpoints.findIndex(ep => Math.hypot(ep.x - px, ep.y - py) < 14);
      if (epIdx >= 0) { setEndpoints(prev => prev.filter((_, i) => i !== epIdx)); return; }
      // Delete road (click near any point on bezier)
      const roadIdx = roads.findIndex(r => {
        for (let i = 0; i <= 20; i++) {
          const { x, y } = bezPt(r.ax, r.ay, r.cx, r.cy, r.bx, r.by, i / 20);
          if (Math.hypot(x - px, y - py) < 10) return true;
        }
        return false;
      });
      if (roadIdx >= 0) { setRoads(prev => prev.filter((_, i) => i !== roadIdx)); return; }
      // Delete rubble
      setRubble(prev => prev.filter(rb => Math.hypot(rb.x - px, rb.y - py) > 8));
      return;
    }

    // Place mode: click existing building to select, otherwise place new
    for (let i = 0; i < buildings.length; i++) {
      if (Math.hypot(buildings[i].x - px, buildings[i].y - py) < 20) {
        setSelectedBuilding(i);
        return;
      }
    }
    setSelectedBuilding(null);
    setBuildings(prev => [...prev, { x: sx, y: sy, variant: selectedVariant, angle: placeAngle }]);
  }

  function rotateSelected() {
    if (selectedBuilding === null) return;
    setBuildings(prev => prev.map((b, i) =>
      i === selectedBuilding ? { ...b, angle: b.angle + Math.PI / 2 } : b
    ));
  }

  // Cancel road placement with Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "r" || e.key === "R") {
        if (selectedBuilding !== null) rotateSelected();
        else setPlaceAngle(a => a + Math.PI / 2);
      }
      if (e.key === "Escape") { setRoadWaypoints([]); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBuilding !== null) {
        setBuildings(prev => prev.filter((_, i) => i !== selectedBuilding));
        setSelectedBuilding(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function handleSave() {
    if (!townName.trim()) { setStatus("Enter a town name first."); return; }
    const current = loadTemplates();
    if (current.length >= MAX_TEMPLATES) { setStatus(`Max ${MAX_TEMPLATES} templates.`); return; }
    const half = CANVAS_SIZE / 2;
    const tmpl: TownTemplate = {
      id: crypto.randomUUID(),
      name: townName.trim(),
      buildings: buildings.map(b => ({
        x: (b.x - half) * WORLD_SCALE, y: (b.y - half) * WORLD_SCALE,
        variant: b.variant, angle: b.angle,
      })),
      rubble: rubble.map(r => ({ x: (r.x - half) * WORLD_SCALE, y: (r.y - half) * WORLD_SCALE })),
      roads: roads.map(r => ({
        ax: (r.ax - half) * WORLD_SCALE, ay: (r.ay - half) * WORLD_SCALE,
        bx: (r.bx - half) * WORLD_SCALE, by: (r.by - half) * WORLD_SCALE,
        cx: (r.cx - half) * WORLD_SCALE, cy: (r.cy - half) * WORLD_SCALE,
      })),
      roadEndpoints: endpoints.map(ep => ({ x: (ep.x - half) * WORLD_SCALE, y: (ep.y - half) * WORLD_SCALE })),
      createdAt: Date.now(),
    };
    const updated = [...current, tmpl];
    saveTemplates(updated);
    setTemplates(updated);
    setStatus(`Saved "${tmpl.name}"! (${updated.length}/${MAX_TEMPLATES})`);
  }

  function handleLoad(tmpl: TownTemplate) {
    const half = CANVAS_SIZE / 2;
    setTownName(tmpl.name);
    setBuildings((tmpl.buildings ?? []).map(b => ({
      x: b.x / WORLD_SCALE + half, y: b.y / WORLD_SCALE + half,
      variant: b.variant, angle: b.angle,
    })));
    setRubble((tmpl.rubble ?? []).map(r => ({ x: r.x / WORLD_SCALE + half, y: r.y / WORLD_SCALE + half })));
    setRoads((tmpl.roads ?? []).map(r => ({
      ax: r.ax / WORLD_SCALE + half, ay: r.ay / WORLD_SCALE + half,
      bx: r.bx / WORLD_SCALE + half, by: r.by / WORLD_SCALE + half,
      cx: r.cx / WORLD_SCALE + half, cy: r.cy / WORLD_SCALE + half,
    })));
    setEndpoints((tmpl.roadEndpoints ?? []).map(ep => ({ x: ep.x / WORLD_SCALE + half, y: ep.y / WORLD_SCALE + half })));
    setSelectedBuilding(null);
    setRoadWaypoints([]);
    setStatus(`Loaded "${tmpl.name}"`);
  }

  function handleDelete(id: string) {
    const updated = templates.filter(t => t.id !== id);
    saveTemplates(updated);
    setTemplates(updated);
    setStatus("Template deleted.");
  }

  function handleClear() {
    setBuildings([]); setRoads([]); setEndpoints([]); setRubble([]);
    setSelectedBuilding(null); setRoadWaypoints([]);
    setTownName("New Town"); setStatus("Cleared.");
  }

  function handleExportJSON() {
    const half = CANVAS_SIZE / 2;
    const tmpl = {
      name: townName.trim() || "Unnamed",
      buildings: buildings.map(b => ({
        x: Math.round((b.x - half) * WORLD_SCALE),
        y: Math.round((b.y - half) * WORLD_SCALE),
        variant: b.variant,
        angle: parseFloat(b.angle.toFixed(3)),
      })),
      rubble: rubble.map(r => ({
        x: Math.round((r.x - half) * WORLD_SCALE),
        y: Math.round((r.y - half) * WORLD_SCALE),
      })),
      roads: roads.map(r => ({
        ax: Math.round((r.ax - half) * WORLD_SCALE), ay: Math.round((r.ay - half) * WORLD_SCALE),
        bx: Math.round((r.bx - half) * WORLD_SCALE), by: Math.round((r.by - half) * WORLD_SCALE),
        cx: Math.round((r.cx - half) * WORLD_SCALE), cy: Math.round((r.cy - half) * WORLD_SCALE),
      })),
      roadEndpoints: endpoints.map(ep => ({
        x: Math.round((ep.x - half) * WORLD_SCALE),
        y: Math.round((ep.y - half) * WORLD_SCALE),
      })),
    };
    setImportText(JSON.stringify(tmpl, null, 2));
    setShowImport(true);
  }

  function handleImportJSON() {
    try {
      const raw = JSON.parse(importText);
      const half = CANVAS_SIZE / 2;
      if (raw.name) setTownName(raw.name);
      if (Array.isArray(raw.buildings)) {
        setBuildings(raw.buildings.map((b: TownBuilding) => ({
          x: b.x / WORLD_SCALE + half, y: b.y / WORLD_SCALE + half,
          variant: b.variant ?? 0, angle: b.angle ?? 0,
        })));
      }
      if (Array.isArray(raw.rubble)) {
        setRubble(raw.rubble.map((r: {x:number;y:number}) => ({
          x: r.x / WORLD_SCALE + half, y: r.y / WORLD_SCALE + half,
        })));
      }
      if (Array.isArray(raw.roads)) {
        setRoads(raw.roads.map((r: TownRoad) => ({
          ax: r.ax / WORLD_SCALE + half, ay: r.ay / WORLD_SCALE + half,
          bx: r.bx / WORLD_SCALE + half, by: r.by / WORLD_SCALE + half,
          cx: r.cx / WORLD_SCALE + half, cy: r.cy / WORLD_SCALE + half,
        })));
      }
      if (Array.isArray(raw.roadEndpoints)) {
        setEndpoints(raw.roadEndpoints.map((e: {x:number;y:number}) => ({
          x: e.x / WORLD_SCALE + half, y: e.y / WORLD_SCALE + half,
        })));
      }
      setSelectedBuilding(null); setRoadWaypoints([]);
      setShowImport(false); setImportText("");
      setStatus(`Imported "${raw.name ?? "town"}" — review and Save when ready.`);
    } catch {
      setStatus("Invalid JSON — check the format.");
    }
  }

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");

  const modeList: Mode[] = ["place", "road", "endpoint", "rubble", "delete"];

  return (
    <div style={{ background: "#0e0e0a", minHeight: "100vh", color: "#d4c8a0", fontFamily: "monospace", padding: "16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "12px", flexWrap: "wrap" }}>
        <Link to="/" style={{ color: "#a08060", textDecoration: "none", fontSize: "13px" }}>← Back to Game</Link>
        <h1 style={{ margin: 0, fontSize: "18px", color: "#e0c870", letterSpacing: "2px" }}>TOWN BUILDER</h1>
        <input
          value={townName}
          onChange={e => setTownName(e.target.value)}
          placeholder="Town name"
          style={{ background: "#1e1a12", border: "1px solid #5a4a2a", color: "#e0c870", padding: "4px 8px", fontFamily: "monospace", fontSize: "14px", width: "160px" }}
        />
        <button onClick={handleSave} style={btnStyle("#3a6030")}>Save</button>
        <button onClick={() => { setShowImport(v => !v); setImportText(""); }} style={btnStyle("#204060")}>Import / Export JSON</button>
        <button onClick={handleClear} style={btnStyle("#603030")}>Clear</button>
        <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid Snap
        </label>
        {status && <span style={{ fontSize: "12px", color: "#80c060" }}>{status}</span>}
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {/* Canvas */}
        <div>
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ border: "1px solid #3a2c1c", cursor: mode === "delete" ? "crosshair" : "default", display: "block" }}
          />
          <div style={{ fontSize: "11px", color: "#806040", marginTop: "4px" }}>
            {mode === "road"
              ? roadWaypoints.length > 0
                ? `${roadWaypoints.length} point(s) • Ctrl+click = add waypoint • Click = finish road • Esc = cancel`
                : "Click to place first point • Ctrl+click to add waypoints, then click to finish"
              : "R = rotate selected • Delete = remove selected"}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "220px" }}>
          {/* Mode */}
          <div>
            <div style={{ fontSize: "11px", color: "#806040", marginBottom: "6px" }}>MODE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {modeList.map(m => (
                <button key={m} onClick={() => { setMode(m); setRoadWaypoints([]); }}
                  style={btnStyle(mode === m ? "#5a4020" : "#2a2018", mode === m ? "#e0c870" : "#a08060")}>
                  {m === "endpoint" ? "Road Endpoint" : m.charAt(0).toUpperCase() + m.slice(1)}
                  {m === "endpoint" && <span style={{ fontSize: "10px", color: "#6090a0", marginLeft: "6px" }}>🔵 world road link</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Building palette (only when in place mode) */}
          {mode === "place" && (
            <div>
              <div style={{ fontSize: "11px", color: "#806040", marginBottom: "6px" }}>BUILDING VARIANT</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                {VARIANT_NAMES.map((name, i) => {
                  const s = RUIN_BUILDING_SIZES[i];
                  return (
                    <button key={i} onClick={() => setSelectedVariant(i)}
                      style={{
                        background: selectedVariant === i ? "#3a2c10" : "#1a1610",
                        border: `1px solid ${selectedVariant === i ? "#e0c870" : "#3a2c1c"}`,
                        color: "#d4c8a0", padding: "6px 8px",
                        fontFamily: "monospace", fontSize: "11px", cursor: "pointer", textAlign: "left",
                      }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "16px", height: "12px", background: VARIANT_COLORS[i], border: "1px solid #5a4a30", flexShrink: 0 }} />
                        <span style={{ color: "#a08060" }}>{i}</span>
                      </div>
                      <div style={{ fontSize: "10px", color: "#806040", marginTop: "2px" }}>{name}</div>
                      <div style={{ fontSize: "10px", color: "#504030" }}>{s.w}×{s.h}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Road mode hint */}
          {mode === "road" && (
            <div style={{ background: "#101810", border: "1px solid #3a5020", padding: "8px", fontSize: "11px", color: "#80a060" }}>
              <div style={{ marginBottom: "4px", color: "#a0c070" }}>Road Tool</div>
              Click to set start → click again to place road. Road auto-curves at midpoint.
              <div style={{ marginTop: "6px", color: "#506040" }}>Esc = cancel waypoints</div>
            </div>
          )}

          {/* Endpoint mode hint */}
          {mode === "endpoint" && (
            <div style={{ background: "#0e1418", border: "1px solid #205060", padding: "8px", fontSize: "11px", color: "#60a0c0" }}>
              <div style={{ marginBottom: "4px", color: "#80c0e0" }}>Road Endpoint</div>
              Place markers where the world's inter-town roads should connect into this town. Usually on the edge of your town layout.
            </div>
          )}

          {/* Selected building info */}
          {selectedBuilding !== null && buildings[selectedBuilding] && (
            <div style={{ background: "#1a1610", border: "1px solid #5a4020", padding: "8px", fontSize: "12px" }}>
              <div style={{ color: "#e0c870", marginBottom: "4px" }}>Selected #{selectedBuilding}</div>
              <div>{VARIANT_NAMES[buildings[selectedBuilding].variant]}</div>
              <div style={{ color: "#806040" }}>Angle: {(buildings[selectedBuilding].angle * 180 / Math.PI).toFixed(0)}°</div>
              <button onClick={rotateSelected} style={{ ...btnStyle("#3a3020"), marginTop: "6px", fontSize: "11px" }}>Rotate 90° (R)</button>
              <button onClick={() => { setBuildings(prev => prev.filter((_, i) => i !== selectedBuilding)); setSelectedBuilding(null); }}
                style={{ ...btnStyle("#603030"), marginTop: "4px", fontSize: "11px" }}>Delete</button>
            </div>
          )}

          {/* Stats */}
          <div style={{ fontSize: "11px", color: "#605040" }}>
            {buildings.length} buildings · {roads.length} roads · {endpoints.length} endpoints · {rubble.length} rubble
          </div>
        </div>
      </div>

      {/* Import / Export JSON panel */}
      {showImport && (
        <div style={{ marginTop: "16px", background: "#0e1420", border: "1px solid #204060", padding: "12px" }}>
          <div style={{ fontSize: "13px", color: "#60a0e0", marginBottom: "8px" }}>
            IMPORT / EXPORT JSON
          </div>
          <div style={{ fontSize: "11px", color: "#406080", marginBottom: "8px" }}>
            Paste JSON from Claude here to import a town, or click Export to see the current canvas as JSON you can share.
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={'{\n  "name": "My Town",\n  "buildings": [...],\n  "roads": [...],\n  "roadEndpoints": [...],\n  "rubble": [...]\n}'}
            style={{
              width: "100%", height: "200px", background: "#080e18", border: "1px solid #204060",
              color: "#a0c0e0", fontFamily: "monospace", fontSize: "11px", padding: "8px",
              resize: "vertical", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button onClick={handleImportJSON} style={{ ...btnStyle("#204060", "#80c0ff"), width: "auto", padding: "4px 16px" }}>
              Import JSON → Canvas
            </button>
            <button onClick={handleExportJSON} style={{ ...btnStyle("#203040", "#60a0d0"), width: "auto", padding: "4px 16px" }}>
              Export Canvas → JSON
            </button>
            <button onClick={() => setShowImport(false)} style={{ ...btnStyle("#2a1a1a", "#a06060"), width: "auto", padding: "4px 16px" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Saved Templates */}
      <div style={{ marginTop: "20px" }}>
        <div style={{ fontSize: "13px", color: "#a08060", marginBottom: "8px" }}>
          SAVED TEMPLATES ({templates.length}/{MAX_TEMPLATES})
        </div>
        {templates.length === 0 && (
          <div style={{ fontSize: "12px", color: "#504030" }}>No templates saved. Build a town and click Save.</div>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {templates.map(t => (
            <div key={t.id} style={{ background: "#1a1610", border: "1px solid #3a2c1c", padding: "8px 12px", fontSize: "12px" }}>
              <div style={{ color: "#e0c870", marginBottom: "4px" }}>{t.name}</div>
              <div style={{ color: "#605040", fontSize: "11px" }}>
                {t.buildings.length} bldg · {(t.roads ?? []).length} roads · {(t.roadEndpoints ?? []).length} endpoints
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                <button onClick={() => handleLoad(t)} style={btnStyle("#3a3020", undefined, "11px")}>Load</button>
                <button onClick={() => handleDelete(t.id)} style={btnStyle("#603030", undefined, "11px")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg: string, color = "#d4c8a0", fontSize = "12px"): React.CSSProperties {
  return {
    background: bg, border: "1px solid #5a4a2a", color,
    padding: "4px 10px", fontFamily: "monospace", fontSize,
    cursor: "pointer", display: "block", width: "100%",
  };
}
