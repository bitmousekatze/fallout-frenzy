export type Vec2 = { x: number; y: number };

export type EntityKind = "player" | "zombie" | "pig" | "cow" | "tree" | "rock" | "bullet" | "corpse" | "ruin" | "car" | "grenade" | "explosion" | "doggo";

export interface RuinArea {
  cx: number;
  cy: number;
  radius: number;
  name: string;
}

export interface Road {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  // quadratic bezier control point — gives roads a slight curve
  cx: number;
  cy: number;
  // per-road RNG seed so detail patterns are stable each frame
  seed: number;
  // broken gap segments as [tStart, tEnd] pairs along the bezier (0–1)
  gaps: Array<[number, number]>;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  angle: number;
  hp: number;
  maxHp: number;
  // bullet specific
  ttl?: number;
  damage?: number;
  ownerId?: number;
  // ai
  state?: "idle" | "wander" | "chase" | "attack";
  wanderTarget?: Vec2;
  attackCooldown?: number;
  // corpse
  fadeTtl?: number;
  color?: string; // for corpse
  // muzzle flash timer (player)
  muzzleFlash?: number;
  // hit flash
  hitFlash?: number;
  // animation
  animTime?: number;
  facing?: "down" | "up" | "left" | "right" | "back";
  moving?: boolean;
  // ruin building variant (0-3)
  ruinVariant?: number;
  ruinW?: number;
  ruinH?: number;
  twoDoors?: boolean;
  // car
  carVariant?: number;
  // grenade
  fuseTimer?: number;
  throwTarget?: Vec2;
}

export interface TownBuilding {
  x: number;
  y: number;
  variant: number;
  angle: number;
}

export interface TownRoad {
  ax: number; ay: number;
  bx: number; by: number;
  cx: number; cy: number; // quadratic bezier control point
}

export interface TownTemplate {
  id: string;
  name: string;
  buildings: TownBuilding[];
  rubble: Array<{ x: number; y: number }>;
  roads: TownRoad[];
  // Points where world-level roads connect into this town (relative to town center)
  roadEndpoints: Array<{ x: number; y: number }>;
  createdAt: number;
}

export interface ChunkData {
  cx: number;
  cy: number;
  entityIds: number[]; // all entity IDs spawned by this chunk
}

export type FoodType = "pork" | "beef";

export interface InventoryItem {
  food: FoodType;
  count: number;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  mouseWorld: Vec2;
}
