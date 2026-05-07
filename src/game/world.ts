import { Entity, Road, RuinArea, TownRoad, TownTemplate, Vec2 } from "./types";

export const WORLD_SIZE = 10000;
export const TILE = 64;
export const ROAD_HALF_WIDTH = 30; // used by renderer and spawn checks

let _id = 1;
export const nextId = () => _id++;

export function dist(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}

function bezierPoint(ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, t: number): Vec2 {
  const mt = 1 - t;
  return {
    x: mt * mt * ax + 2 * mt * t * cpx + t * t * bx,
    y: mt * mt * ay + 2 * mt * t * cpy + t * t * by,
  };
}

export function isNearAnyRoad(pos: Vec2, roads: Road[], clearance = ROAD_HALF_WIDTH + 40): boolean {
  for (const r of roads) {
    for (let i = 0; i <= 60; i++) {
      const p = bezierPoint(r.ax, r.ay, r.cx, r.cy, r.bx, r.by, i / 60);
      if (dist(pos, p) < clearance) return true;
    }
  }
  return false;
}

export const SPAWN_POINT: Vec2 = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
// Safe zone is a 50x50 world-unit box centered on spawn (25 units each side)
export const SAFE_ZONE_HALF = 25;
export const SPAWN_SAFE_RADIUS = SAFE_ZONE_HALF;

export function makePlayer(): Entity {
  return {
    id: nextId(),
    kind: "player",
    pos: { ...SPAWN_POINT },
    vel: { x: 0, y: 0 },
    radius: 20,
    angle: 0,
    hp: 100,
    maxHp: 100,
  };
}

export function makeZombie(pos: Vec2): Entity {
  return {
    id: nextId(),
    kind: "zombie",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: 18,
    angle: 0,
    hp: 60,
    maxHp: 60,
    state: "wander",
    attackCooldown: 0,
  };
}

export function makeAnimal(kind: "pig" | "cow", pos: Vec2): Entity {
  return {
    id: nextId(),
    kind,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: kind === "cow" ? 24 : 18,
    angle: rand(0, Math.PI * 2),
    hp: kind === "cow" ? 80 : 50,
    maxHp: kind === "cow" ? 80 : 50,
    state: "wander",
  };
}

export function makeTree(pos: Vec2): Entity {
  return {
    id: nextId(),
    kind: "tree",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: 28,
    angle: 0,
    hp: 999,
    maxHp: 999,
  };
}

export function makeRock(pos: Vec2): Entity {
  return {
    id: nextId(),
    kind: "rock",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: 32,
    angle: rand(0, Math.PI * 2),
    hp: 999,
    maxHp: 999,
  };
}

export function makeBullet(pos: Vec2, angle: number, ownerId: number): Entity {
  const speed = 1100;
  return {
    id: nextId(),
    kind: "bullet",
    pos: { ...pos },
    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
    radius: 4,
    angle,
    hp: 1,
    maxHp: 1,
    ttl: 0.6,
    damage: 25,
    ownerId,
  };
}

export const RUIN_BUILDING_SIZES: Array<{ w: number; h: number; r: number }> = [
  { w: 240, h: 180, r: 120 },  // 0: medium rect
  { w: 165, h: 135, r: 90 },   // 1: small rect
  { w: 300, h: 120, r: 135 },  // 2: long narrow
  { w: 135, h: 135, r: 82 },   // 3: small square
  { w: 360, h: 240, r: 165 },  // 4: large warehouse
  { w: 105, h: 105, r: 68 },   // 5: tiny shack
  { w: 270, h: 210, r: 143 },  // 6: medium-large
  { w: 195, h: 195, r: 105 },  // 7: medium square
];

export function makeRuinBuilding(pos: Vec2, variant: number, angle?: number): Entity {
  const s = RUIN_BUILDING_SIZES[variant % RUIN_BUILDING_SIZES.length];
  return {
    id: nextId(),
    kind: "ruin",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: s.r,
    angle: angle ?? rand(0, Math.PI * 2),
    hp: 999,
    maxHp: 999,
    ruinVariant: variant % RUIN_BUILDING_SIZES.length,
    ruinW: s.w,
    ruinH: s.h,
  };
}

function loadTownTemplates(): TownTemplate[] {
  try {
    const raw = typeof localStorage !== "undefined"
      ? localStorage.getItem("fallout-frenzy-town-templates")
      : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function makeGrenade(from: Vec2, to: Vec2): Entity {
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const speed = 380;
  return {
    id: nextId(),
    kind: "grenade",
    pos: { x: from.x, y: from.y },
    vel: { x: (dx / d) * speed, y: (dy / d) * speed },
    radius: 7,
    angle: Math.atan2(dy, dx),
    hp: 1,
    maxHp: 1,
    fuseTimer: 4,
    throwTarget: { x: to.x, y: to.y },
  };
}

export function makeExplosion(pos: Vec2): Entity {
  return {
    id: nextId(),
    kind: "explosion",
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    radius: 120,
    angle: 0,
    hp: 1,
    maxHp: 1,
    ttl: 0.5,
  };
}

export function makeDerelictCar(pos: Vec2, variant: number): Entity {
  return {
    id: nextId(),
    kind: "car",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: 36,
    angle: rand(0, Math.PI * 2),
    hp: 999,
    maxHp: 999,
    carVariant: variant % 4,
  };
}

const RUIN_AREA_NAMES = [
  "Dusty Creek",
  "Old Pines",
  "Ashwood",
  "Ironfield",
  "Bleakhaven",
  "Rusted Fork",
  "Gravelmoor",
  "Cinderhollow",
  "Pale Junction",
  "Wormwood",
  "Saltmarsh",
  "Copperveil",
  "Dreadhollow",
  "Ashgate",
  "Fernwick",
  "Scorched Bluff",
  "The Sump",
  "Blackthorn",
  "Ember Ridge",
  "Coldfall",
];

function isInsideAnyBuilding(pos: Vec2, buildings: Entity[]): boolean {
  for (const b of buildings) {
    if (b.kind !== "ruin") continue;
    const w = b.ruinW ?? 120, h = b.ruinH ?? 100;
    const dx = pos.x - b.pos.x, dy = pos.y - b.pos.y;
    const cos = Math.cos(-b.angle), sin = Math.sin(-b.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) < w / 2 && Math.abs(ly) < h / 2) return true;
  }
  return false;
}

export function generateWorld() {
  const entities: Entity[] = [];
  const player = makePlayer();
  entities.push(player);

  // TEST: all 8 building variants in a row south of spawn — door faces north (toward player)
  // Walk south from spawn to reach them; approach from the south side to enter
  {
    const spacing = 310;
    const startX = SPAWN_POINT.x - spacing * 3.5;
    const testY = SPAWN_POINT.y + 420;
    for (let v = 0; v < 8; v++) {
      entities.push(makeRuinBuilding({ x: startX + v * spacing, y: testY }, v, Math.PI));
    }
  }

  const margin = 600;
  const ruinAreas: RuinArea[] = [];
  const spawnSafeRadius = SAFE_ZONE_HALF + 800; // ruins stay outside safe zone + buffer
  // Track which template (if any) was assigned to each ruin area, for road endpoint lookup
  const ruinTemplates: Array<TownTemplate | null> = [];

  // --- Ruin areas ---
  for (let attempt = 0; ruinAreas.length < 20 && attempt < 2000; attempt++) {
    const cx = rand(margin, WORLD_SIZE - margin);
    const cy = rand(margin, WORLD_SIZE - margin);
    const center = { x: cx, y: cy };

    if (dist(center, player.pos) < spawnSafeRadius) continue;
    if (ruinAreas.some(r => dist(center, { x: r.cx, y: r.cy }) < 1200)) continue;

    const ruinRadius = rand(500, 700);
    ruinAreas.push({ cx, cy, radius: ruinRadius, name: RUIN_AREA_NAMES[ruinAreas.length] });

    // Buildings — use a saved town template if available, else random scatter
    const templates = loadTownTemplates();
    const ruinBuildings: Entity[] = [];
    if (templates.length > 0) {
      const tmpl = templates[Math.floor(Math.random() * templates.length)];
      ruinTemplates.push(tmpl);
      for (const tb of tmpl.buildings) {
        const b = makeRuinBuilding({ x: cx + tb.x, y: cy + tb.y }, tb.variant, tb.angle);
        entities.push(b);
        ruinBuildings.push(b);
      }
      for (const rb of tmpl.rubble) {
        const pos = { x: cx + rb.x, y: cy + rb.y };
        if (!isInsideAnyBuilding(pos, ruinBuildings)) entities.push(makeRock(pos));
      }
    } else {
      ruinTemplates.push(null);
      const buildingCount = randInt(5, 15);
      const placed: Vec2[] = [];
      for (let b = 0; b < buildingCount; b++) {
        let bPos: Vec2 = { x: 0, y: 0 };
        let tries = 0;
        do {
          const angle = rand(0, Math.PI * 2);
          const r = rand(80, ruinRadius - 80);
          bPos = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
          tries++;
        } while (placed.some(o => dist(bPos, o) < 130) && tries < 50);
        placed.push(bPos);
        const b2 = makeRuinBuilding(bPos, randInt(0, 7));
        entities.push(b2);
        ruinBuildings.push(b2);
      }
    }

    // Rubble rocks inside ruin — skip positions inside building footprints
    for (let i = 0; i < randInt(5, 10); i++) {
      const angle = rand(0, Math.PI * 2);
      const r = rand(40, ruinRadius);
      const pos = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
      if (!isInsideAnyBuilding(pos, ruinBuildings)) entities.push(makeRock(pos));
    }

    // Zombies
    for (let i = 0; i < randInt(8, 18); i++) {
      const angle = rand(0, Math.PI * 2);
      const r = rand(50, ruinRadius + 120);
      entities.push(makeZombie({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }));
    }

    // Trees on edges
    for (let i = 0; i < randInt(2, 5); i++) {
      const angle = rand(0, Math.PI * 2);
      const r = rand(ruinRadius * 0.7, ruinRadius * 1.4);
      entities.push(makeTree({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }));
    }

    // Derelict cars inside ruin (2–4)
    for (let i = 0; i < randInt(2, 4); i++) {
      const angle = rand(0, Math.PI * 2);
      const r = rand(60, ruinRadius - 60);
      entities.push(makeDerelictCar({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }, randInt(0, 3)));
    }
  }

  // --- Roads ---
  // Build per-ruin connection points: if a template has road endpoints, use the nearest
  // one to the world center; otherwise use the ruin center.
  const connectionPoints: Vec2[] = ruinAreas.map((ra, i) => {
    const tmpl = ruinTemplates[i];
    if (tmpl && tmpl.roadEndpoints && tmpl.roadEndpoints.length > 0) {
      // Pick the endpoint closest to the world center (most likely to be on a road edge)
      let best = tmpl.roadEndpoints[0];
      let bestDist = Math.hypot(best.x, best.y);
      for (const ep of tmpl.roadEndpoints) {
        const d = Math.hypot(ep.x, ep.y);
        if (d < bestDist) { bestDist = d; best = ep; }
      }
      return { x: ra.cx + best.x, y: ra.cy + best.y };
    }
    return { x: ra.cx, y: ra.cy };
  });
  const roads = generateRoads(ruinAreas, connectionPoints);

  // Instantiate internal roads from templates
  for (let i = 0; i < ruinAreas.length; i++) {
    const tmpl = ruinTemplates[i];
    if (!tmpl || !tmpl.roads) continue;
    const { cx, cy } = ruinAreas[i];
    for (const tr of tmpl.roads) {
      roads.push(makeTownRoad(tr, cx, cy));
    }
  }

  // Cars abandoned along road midpoints (1–2 per road)
  for (const road of roads) {
    const count = randInt(1, 2);
    for (let i = 0; i < count; i++) {
      const t = rand(0.2, 0.8);
      const p = bezierPoint(road.ax, road.ay, road.cx, road.cy, road.bx, road.by, t);
      // offset sideways so they're on the verge or partially blocking
      const dtx = 2 * (1 - t) * (road.cx - road.ax) + 2 * t * (road.bx - road.cx);
      const dty = 2 * (1 - t) * (road.cy - road.ay) + 2 * t * (road.by - road.cy);
      const tlen = Math.hypot(dtx, dty) || 1;
      const nx = -dty / tlen;
      const ny = dtx / tlen;
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = rand(0, ROAD_HALF_WIDTH * 1.2) * side;
      entities.push(makeDerelictCar({ x: p.x + nx * offset, y: p.y + ny * offset }, randInt(0, 3)));
    }
  }

  // --- Trees (skip ruin cores and road corridors) ---
  for (let i = 0; i < 600; i++) {
    const pos = { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) };
    if (ruinAreas.some(r => dist(pos, { x: r.cx, y: r.cy }) < r.radius * 0.6)) continue;
    if (isNearAnyRoad(pos, roads)) continue;
    entities.push(makeTree(pos));
  }

  // --- Rocks (skip road corridors) ---
  for (let i = 0; i < 220; i++) {
    const pos = { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) };
    if (isNearAnyRoad(pos, roads)) continue;
    entities.push(makeRock(pos));
  }

  // --- Roaming zombies ---
  for (let i = 0; i < 80; i++) {
    let p: Vec2;
    do {
      p = { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) };
    } while (dist(p, SPAWN_POINT) < 500);
    entities.push(makeZombie(p));
  }

  // --- Animals ---
  for (let i = 0; i < 60; i++) {
    entities.push(makeAnimal("pig", { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) }));
  }
  for (let i = 0; i < 40; i++) {
    entities.push(makeAnimal("cow", { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) }));
  }

  return { entities, player, ruinAreas, roads };
}

function makeTownRoad(tr: TownRoad, cx: number, cy: number): Road {
  const gapCount = randInt(1, 3);
  const gaps: Array<[number, number]> = [];
  for (let k = 0; k < gapCount; k++) {
    const start = rand(0.15, 0.8);
    const length = rand(0.04, 0.08);
    gaps.push([start, Math.min(start + length, 0.9)]);
  }
  return {
    ax: cx + tr.ax, ay: cy + tr.ay,
    bx: cx + tr.bx, by: cy + tr.by,
    cx: cx + tr.cx, cy: cy + tr.cy,
    seed: Math.floor(Math.random() * 100000),
    gaps,
  };
}

function generateRoads(ruins: RuinArea[], connectionPoints?: Vec2[]): Road[] {
  const roads: Road[] = [];
  const connected = new Set<number>();
  const edgeSet = new Set<string>();

  // Use provided connection points or fall back to ruin centers
  const pts: Vec2[] = ruins.map((r, i) =>
    connectionPoints?.[i] ?? { x: r.cx, y: r.cy }
  );

  function addRoad(i: number, j: number) {
    const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    connected.add(i);
    connected.add(j);

    const a = pts[i];
    const b = pts[j];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const perpX = -dy / len;
    const perpY = dx / len;
    const bend = (Math.random() - 0.5) * len * 0.25;

    // pre-bake gap segments (2–4 breaks per road, each 8–18% of road length)
    const gapCount = randInt(2, 4);
    const gaps: Array<[number, number]> = [];
    for (let k = 0; k < gapCount; k++) {
      const start = rand(0.1, 0.85);
      const length = rand(0.04, 0.10);
      gaps.push([start, Math.min(start + length, 0.95)]);
    }

    roads.push({
      ax: a.x, ay: a.y,
      bx: b.x, by: b.y,
      cx: mx + perpX * bend,
      cy: my + perpY * bend,
      seed: Math.floor(Math.random() * 100000),
      gaps,
    });
  }

  // Prim's MST — distance still based on ruin centers (not endpoints) for stable layout
  connected.add(0);
  while (connected.size < ruins.length) {
    let bestDist = Infinity, bestI = -1, bestJ = -1;
    for (const i of connected) {
      for (let j = 0; j < ruins.length; j++) {
        if (connected.has(j)) continue;
        const d = Math.hypot(ruins[i].cx - ruins[j].cx, ruins[i].cy - ruins[j].cy);
        if (d < bestDist) { bestDist = d; bestI = i; bestJ = j; }
      }
    }
    if (bestI === -1) break;
    addRoad(bestI, bestJ);
  }

  // Extra link per ruin to 2nd nearest
  for (let i = 0; i < ruins.length; i++) {
    const sorted = ruins
      .map((r, j) => ({ j, d: Math.hypot(r.cx - ruins[i].cx, r.cy - ruins[i].cy) }))
      .filter(x => x.j !== i)
      .sort((a, b) => a.d - b.d);
    if (sorted.length >= 2) addRoad(i, sorted[1].j);
  }

  return roads;
}
