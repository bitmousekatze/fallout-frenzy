import { Entity, Road, RuinArea, TownRoad, TownTemplate, Vec2 } from "./types";

export const WORLD_SIZE = 1_000_000;
export const CHUNK_SIZE = 2048;
export const LOAD_RADIUS = 5;    // chunks around player to keep loaded
export const UNLOAD_RADIUS = 8;  // unload chunks beyond this many from player
const RUIN_REGION_CHUNKS = 2;
export const RUIN_REGION_SIZE = CHUNK_SIZE * RUIN_REGION_CHUNKS; // 4 096 units
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

// Mulberry32 seeded PRNG — deterministic per-chunk generation
function mulberry32(seed: number): () => number {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunkHash(a: number, b: number): number {
  let h = (a * 1664525 + b * 22695477) ^ (b * 1013904223 + a * 6364136);
  h = (((h >>> 16) ^ h) * 0x45d9f3b) | 0;
  h = (((h >>> 16) ^ h) * 0x45d9f3b) | 0;
  return ((h >>> 16) ^ h) >>> 0;
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function worldToChunk(wx: number, wy: number): { cx: number; cy: number } {
  return { cx: Math.floor(wx / CHUNK_SIZE), cy: Math.floor(wy / CHUNK_SIZE) };
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
export const SAFE_ZONE_HALF = 25; // visual marker only — actual exclusion zone is SPAWN_SAFE_RADIUS

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

// Variants large enough to justify a second door (not tiny shacks/sheds)
const TWO_DOOR_VARIANTS = new Set([0, 2, 4, 6, 7]);

export function makeRuinBuilding(pos: Vec2, variant: number, angle?: number): Entity {
  const v = variant % RUIN_BUILDING_SIZES.length;
  const s = RUIN_BUILDING_SIZES[v];
  return {
    id: nextId(),
    kind: "ruin",
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    radius: s.r,
    angle: angle ?? rand(0, Math.PI * 2),
    hp: 999,
    maxHp: 999,
    ruinVariant: v,
    ruinW: s.w,
    ruinH: s.h,
    twoDoors: TWO_DOOR_VARIANTS.has(v) && Math.random() < 0.4,
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

export function makeDoggo(): Entity {
  const offset = rand(-200, 200);
  return {
    id: nextId(),
    kind: "doggo",
    pos: { x: SPAWN_POINT.x + offset, y: SPAWN_POINT.y + offset },
    vel: { x: 0, y: 0 },
    radius: 16,
    angle: 0,
    hp: 999,
    maxHp: 999,
    state: "wander",
    animTime: 0,
    facing: "down",
    moving: false,
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

// --- Ruin layout system ---

type LayoutType = "grid" | "strip" | "compound";

const LAYOUT_SEQUENCE: LayoutType[] = [
  "grid", "strip", "compound", "grid", "strip",
  "compound", "grid", "strip", "grid", "compound",
  "strip", "grid", "compound", "strip", "grid",
  "compound", "strip", "grid", "compound", "strip",
];

// Rotate a local offset vector by the ruin's primary axis angle
function rv(lx: number, ly: number, a: number): Vec2 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}

// Place a building in ruin-local space; returns false if overlapping another building or a road
function tryPlaceBuilding(
  cx: number, cy: number,
  lx: number, ly: number,
  localDoorDir: number,
  variant: number,
  primaryAngle: number,
  placed: Entity[], entities: Entity[],
  roads: Road[]
): boolean {
  const drift = rand(-Math.PI / 14, Math.PI / 14);
  const p = rv(lx, ly, primaryAngle);
  const pos = { x: cx + p.x, y: cy + p.y };
  const s = RUIN_BUILDING_SIZES[variant % RUIN_BUILDING_SIZES.length];
  for (const b of placed) {
    if (dist(pos, b.pos) < s.r + b.radius + 24) return false;
  }
  if (isNearAnyRoad(pos, roads, ROAD_HALF_WIDTH + s.r + 20)) return false;
  const worldDoorDir = localDoorDir + primaryAngle;
  const buildingAngle = worldDoorDir - Math.PI / 2 + drift;
  const b = makeRuinBuilding(pos, variant, buildingAngle);
  entities.push(b);
  placed.push(b);
  return true;
}

function placeGrid(cx: number, cy: number, primaryAngle: number, placed: Entity[], entities: Entity[], roads: Road[]) {
  const SETBACK = 60;
  const mainLotXs = [-320, -180, -50, 50, 180, 320];
  for (const lx of mainLotXs) {
    if (Math.abs(lx) < 80) continue;
    const vN = Math.abs(lx) > 220 ? randInt(3, 5) : randInt(0, 2);
    const sN = RUIN_BUILDING_SIZES[vN];
    tryPlaceBuilding(cx, cy, lx, -(SETBACK + sN.h / 2), Math.PI / 2, vN, primaryAngle, placed, entities, roads);

    const vS = Math.abs(lx) > 220 ? randInt(3, 5) : randInt(0, 2);
    const sS = RUIN_BUILDING_SIZES[vS];
    tryPlaceBuilding(cx, cy, lx, SETBACK + sS.h / 2, -Math.PI / 2, vS, primaryAngle, placed, entities, roads);
  }
  for (const ly of [-240, 240]) {
    const vW = randInt(1, 5);
    const sW = RUIN_BUILDING_SIZES[vW];
    tryPlaceBuilding(cx, cy, -(SETBACK + sW.h / 2), ly, 0, vW, primaryAngle, placed, entities, roads);

    const vE = randInt(1, 5);
    const sE = RUIN_BUILDING_SIZES[vE];
    tryPlaceBuilding(cx, cy, SETBACK + sE.h / 2, ly, Math.PI, vE, primaryAngle, placed, entities, roads);
  }
}

function placeStrip(cx: number, cy: number, primaryAngle: number, placed: Entity[], entities: Entity[], roads: Road[]) {
  const SETBACK = 60;
  const lotXs = [-300, -160, 0, 160, 300];
  for (const lx of lotXs) {
    const vN = randInt(0, 5);
    const sN = RUIN_BUILDING_SIZES[vN];
    tryPlaceBuilding(cx, cy, lx, -(SETBACK + sN.h / 2), Math.PI / 2, vN, primaryAngle, placed, entities, roads);

    const vS = randInt(0, 5);
    const sS = RUIN_BUILDING_SIZES[vS];
    tryPlaceBuilding(cx, cy, lx, SETBACK + sS.h / 2, -Math.PI / 2, vS, primaryAngle, placed, entities, roads);
  }
}

function placeCompound(cx: number, cy: number, primaryAngle: number, placed: Entity[], entities: Entity[], roads: Road[]) {
  const D = 200;
  tryPlaceBuilding(cx, cy, -130, -D, Math.PI / 2, 4, primaryAngle, placed, entities, roads);
  tryPlaceBuilding(cx, cy, 130, -D, Math.PI / 2, 2, primaryAngle, placed, entities, roads);
  tryPlaceBuilding(cx, cy, -80, D, -Math.PI / 2, 6, primaryAngle, placed, entities, roads);
  tryPlaceBuilding(cx, cy, 120, D, -Math.PI / 2, 4, primaryAngle, placed, entities, roads);
  tryPlaceBuilding(cx, cy, -D, -100, 0, 2, primaryAngle, placed, entities, roads);
  tryPlaceBuilding(cx, cy, -D, 90, 0, 3, primaryAngle, placed, entities, roads);
  tryPlaceBuilding(cx, cy, D, 0, Math.PI, 4, primaryAngle, placed, entities, roads);
}

function placeRuinLayout(cx: number, cy: number, type: LayoutType, placed: Entity[], entities: Entity[], roads: Road[]) {
  const primaryAngle = type === "grid"
    ? (Math.random() < 0.5 ? 0 : Math.PI / 2)
    : Math.round(Math.random() * 4) * (Math.PI / 4);

  if (type === "grid")       placeGrid(cx, cy, primaryAngle, placed, entities, roads);
  else if (type === "strip") placeStrip(cx, cy, primaryAngle, placed, entities, roads);
  else                       placeCompound(cx, cy, primaryAngle, placed, entities, roads);
}

// True if pos falls inside any building's rectangular footprint (with a small buffer)
function posOnAnyBuilding(pos: Vec2, buildings: Entity[]): boolean {
  for (const b of buildings) {
    if (b.kind !== "ruin") continue;
    const w = b.ruinW ?? 120, h = b.ruinH ?? 100;
    const dx = pos.x - b.pos.x, dy = pos.y - b.pos.y;
    const cos = Math.cos(-b.angle), sin = Math.sin(-b.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) < w / 2 + 40 && Math.abs(ly) < h / 2 + 40) return true;
  }
  return false;
}

// Place 2–4 cars along the ruin's internal "street" (derived from building orientations)
function placeRuinCars(cx: number, cy: number, buildings: Entity[], entities: Entity[]) {
  if (buildings.length === 0) return;
  // Derive street direction from the most common building angle group
  const streetAngle = buildings[0].angle + Math.PI / 2; // perpendicular to first building's door
  const count = randInt(2, 4);
  for (let i = 0; i < count; i++) {
    const along = rand(-250, 250);
    const across = rand(-40, 40) + (Math.random() < 0.5 ? 55 : -55);
    const p = rv(along, across, streetAngle);
    const pos = { x: cx + p.x, y: cy + p.y };
    const car = makeDerelictCar(pos, randInt(0, 3));
    car.angle = streetAngle + rand(-Math.PI / 10, Math.PI / 10);
    entities.push(car);
  }
}

// Hardcoded spawn town — placed at player start, no zombies, no ruins nearby
const SPAWN_TEMPLATE = {
  roadEndpoints: [
    { x: -9, y: 460 },
    { x: 686, y: -4 },
    { x: -693, y: -4 },
    { x: -7, y: -693 },
  ],
  buildings: [
    { x: 490, y: -140, variant: 0, angle: 6.283 },
    { x: 140, y: -140, variant: 0, angle: 6.283 },
    { x: 210, y: -350, variant: 2, angle: 15.708 },
    { x: 210, y: -490, variant: 2, angle: 15.708 },
    { x: -560, y: -70, variant: 5, angle: 23.562 },
    { x: -490, y: -280, variant: 5, angle: 23.562 },
    { x: -350, y: -490, variant: 5, angle: 23.562 },
    { x: -140, y: -630, variant: 5, angle: 23.562 },
    { x: -280, y: 280, variant: 4, angle: 25.133 },
    { x: 350, y: 280, variant: 4, angle: 28.274 },
  ],
  roads: [
    { ax: -3, ay: -673, bx: -5, by: -693, cx: -5, cy: -693 },
    { ax: -5, ay: 454, bx: 0, by: 7, cx: -5, cy: 454 },
    { ax: -689, ay: -1, bx: 684, by: 0, cx: -3, cy: -1 },
    { ax: 684, ay: 0, bx: 684, by: 0, cx: 684, cy: 0 },
    { ax: -5, ay: -689, bx: -3, by: -8, cx: -3, cy: -8 },
    { ax: -3, ay: -8, bx: -5, by: 6, cx: -3, cy: -8 },
  ],
};

// Spawn area safe radius — covers all spawn template buildings (farthest ~645 units) + margin
export const SPAWN_SAFE_RADIUS = 800;

export const RUIN_AREA_NAMES = [
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


export function generateChunk(
  cx: number,
  cy: number,
  roads: Road[]
): { entities: Entity[]; newRoads: Road[]; newRuinArea: RuinArea | null; ruinRegionKey: string | null } {
  const rng = mulberry32(chunkHash(cx, cy));
  const r = (min: number, max: number) => min + rng() * (max - min);
  const ri = (min: number, max: number) => Math.floor(r(min, max + 1));

  const entities: Entity[] = [];
  const newRoads: Road[] = [];
  const chunkWorldX = cx * CHUNK_SIZE;
  const chunkWorldY = cy * CHUNK_SIZE;
  const chunkCenterX = chunkWorldX + CHUNK_SIZE / 2;
  const chunkCenterY = chunkWorldY + CHUNK_SIZE / 2;
  const nearSpawn = dist({ x: chunkCenterX, y: chunkCenterY }, SPAWN_POINT) < SPAWN_SAFE_RADIUS + 400;

  // Determine if this chunk owns a ruin region center
  const rx = Math.floor(chunkWorldX / RUIN_REGION_SIZE);
  const ry = Math.floor(chunkWorldY / RUIN_REGION_SIZE);
  const ruinCenterX = rx * RUIN_REGION_SIZE + RUIN_REGION_SIZE / 2;
  const ruinCenterY = ry * RUIN_REGION_SIZE + RUIN_REGION_SIZE / 2;
  const ruinOwnerChunk = worldToChunk(ruinCenterX, ruinCenterY);
  const ownsRuinRegion = ruinOwnerChunk.cx === cx && ruinOwnerChunk.cy === cy;
  const regionKey = ownsRuinRegion ? `${rx},${ry}` : null;

  let newRuinArea: RuinArea | null = null;

  if (ownsRuinRegion && !nearSpawn) {
    const ruinRng = mulberry32(chunkHash(rx * 31337, ry * 99991));
    const rr = (min: number, max: number) => min + ruinRng() * (max - min);
    const rri = (min: number, max: number) => Math.floor(rr(min, max + 1));

    if (ruinRng() < 0.6) {
      const ruinRadius = rr(500, 700);
      const nameIdx = ((rx * 7 + ry * 13) & 0x7fffffff) % RUIN_AREA_NAMES.length;
      newRuinArea = { cx: ruinCenterX, cy: ruinCenterY, radius: ruinRadius, name: RUIN_AREA_NAMES[nameIdx] };

      const placed: Entity[] = [];
      const layoutIdx = ((rx + ry) & 0x7fffffff) % LAYOUT_SEQUENCE.length;
      placeRuinLayout(ruinCenterX, ruinCenterY, LAYOUT_SEQUENCE[layoutIdx], placed, entities, roads);

      // Zombies in ruin
      const zombieCount = rri(8, 18);
      for (let z = 0; z < zombieCount; z++) {
        const angle = rr(0, Math.PI * 2);
        const radius = rr(50, ruinRadius + 120);
        entities.push(makeZombie({ x: ruinCenterX + Math.cos(angle) * radius, y: ruinCenterY + Math.sin(angle) * radius }));
      }

      // Cars and perimeter trees
      placeRuinCars(ruinCenterX, ruinCenterY, placed, entities);
      for (let t = 0; t < rri(2, 5); t++) {
        const angle = rr(0, Math.PI * 2);
        const radius = rr(ruinRadius * 0.7, ruinRadius * 1.4);
        const pos = { x: ruinCenterX + Math.cos(angle) * radius, y: ruinCenterY + Math.sin(angle) * radius };
        if (!posOnAnyBuilding(pos, placed)) entities.push(makeTree(pos));
      }

      // Internal ruin roads: horizontal and vertical streets through the center
      const streetLen = ruinRadius * 2.2;
      for (let s = 0; s < 2; s++) {
        const a = s * Math.PI / 2;
        const sax = ruinCenterX - Math.cos(a) * streetLen / 2;
        const say = ruinCenterY - Math.sin(a) * streetLen / 2;
        const sbx = ruinCenterX + Math.cos(a) * streetLen / 2;
        const sby = ruinCenterY + Math.sin(a) * streetLen / 2;
        newRoads.push({
          ax: sax, ay: say, bx: sbx, by: sby,
          cx: (sax + sbx) / 2 + (rr(0, 1) - 0.5) * 40,
          cy: (say + sby) / 2 + (rr(0, 1) - 0.5) * 40,
          seed: chunkHash(cx * 13 + s, cy * 17 + s) >>> 0,
          gaps: [[rr(0.05, 0.22), rr(0.08, 0.25)], [rr(0.74, 0.88), rr(0.77, 0.92)]],
        });
      }

      // Helper: check if a neighbouring region has a ruin (mirrors the ruin-chance test)
      const regionHasRuin = (nrx: number, nry: number) => {
        const nRng = mulberry32(chunkHash(nrx * 31337, nry * 99991));
        return nRng() < 0.6;
      };

      // Road segment helper
      const pushRoad = (ax: number, ay: number, bx: number, by: number, seedMix: number) => {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const bend = (rr(0, 1) - 0.5) * len * 0.12;
        newRoads.push({
          ax, ay, bx, by,
          cx: mx + (-dy / len) * bend,
          cy: my + (dx / len) * bend,
          seed: chunkHash(rx * 7 + seedMix, ry * 11 + seedMix) >>> 0,
          gaps: [[rr(0.12, 0.38), rr(0.16, 0.42)], [rr(0.56, 0.78), rr(0.6, 0.82)]],
        });
      };

      // Connect east to west: this ruin → east neighbour (generated by western ruin only)
      if (regionHasRuin(rx + 1, ry)) {
        const eCX = (rx + 1) * RUIN_REGION_SIZE + RUIN_REGION_SIZE / 2;
        const eCY = ruinCenterY;
        pushRoad(ruinCenterX, ruinCenterY, eCX, eCY, 1);
      }

      // Connect north to south: this ruin → south neighbour (generated by northern ruin only)
      if (regionHasRuin(rx, ry + 1)) {
        const sCX = ruinCenterX;
        const sCY = (ry + 1) * RUIN_REGION_SIZE + RUIN_REGION_SIZE / 2;
        pushRoad(ruinCenterX, ruinCenterY, sCX, sCY, 2);
      }

      // Ruins directly adjacent to spawn connect to the nearest spawn road endpoint
      const spawnRx = Math.floor(SPAWN_POINT.x / RUIN_REGION_SIZE);
      const spawnRy = Math.floor(SPAWN_POINT.y / RUIN_REGION_SIZE);
      if (Math.abs(rx - spawnRx) <= 1 && Math.abs(ry - spawnRy) <= 1) {
        const spx = SPAWN_POINT.x, spy = SPAWN_POINT.y;
        const spawnEps = SPAWN_TEMPLATE.roadEndpoints.map(ep => ({ x: spx + ep.x, y: spy + ep.y }));
        let nearEp = spawnEps[0];
        let nearEpD = dist({ x: ruinCenterX, y: ruinCenterY }, nearEp);
        for (const ep of spawnEps) {
          const d = dist({ x: ruinCenterX, y: ruinCenterY }, ep);
          if (d < nearEpD) { nearEpD = d; nearEp = ep; }
        }
        pushRoad(ruinCenterX, ruinCenterY, nearEp.x, nearEp.y, 3);
      }
    }
  } else if (!nearSpawn) {
    // Terrain: trees, rocks, zombies, animals
    const treeCount = ri(2, 6);
    for (let i = 0; i < treeCount; i++) {
      entities.push(makeTree({ x: chunkWorldX + r(40, CHUNK_SIZE - 40), y: chunkWorldY + r(40, CHUNK_SIZE - 40) }));
    }
    const rockCount = ri(0, 2);
    for (let i = 0; i < rockCount; i++) {
      entities.push(makeRock({ x: chunkWorldX + r(40, CHUNK_SIZE - 40), y: chunkWorldY + r(40, CHUNK_SIZE - 40) }));
    }
    if (rng() < 0.8) {
      const zombieCount = ri(2, 6);
      for (let i = 0; i < zombieCount; i++) {
        entities.push(makeZombie({ x: chunkWorldX + r(40, CHUNK_SIZE - 40), y: chunkWorldY + r(40, CHUNK_SIZE - 40) }));
      }
    }
    if (rng() < 0.25) {
      const kind = rng() < 0.5 ? "pig" : "cow" as const;
      entities.push(makeAnimal(kind, { x: chunkWorldX + r(40, CHUNK_SIZE - 40), y: chunkWorldY + r(40, CHUNK_SIZE - 40) }));
    }
  }

  return { entities, newRoads, newRuinArea, ruinRegionKey: regionKey };
}

export function generateWorld() {
  const entities: Entity[] = [];
  const player = makePlayer();
  entities.push(player);

  const roads: Road[] = [];
  const { x: sx, y: sy } = SPAWN_POINT;

  // Spawn town buildings
  for (const tb of SPAWN_TEMPLATE.buildings) {
    entities.push(makeRuinBuilding({ x: sx + tb.x, y: sy + tb.y }, tb.variant, tb.angle));
  }

  // Spawn town internal roads (no gaps — safe zone)
  for (const tr of SPAWN_TEMPLATE.roads) {
    roads.push({
      ax: sx + tr.ax, ay: sy + tr.ay,
      bx: sx + tr.bx, by: sy + tr.by,
      cx: sx + tr.cx, cy: sy + tr.cy,
      seed: Math.floor(Math.random() * 100000),
      gaps: [],
    });
  }

  // ruinAreas starts empty — chunks populate it as the player explores
  return { entities, player, ruinAreas: [] as RuinArea[], roads };
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
