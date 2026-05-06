export type Vec2 = { x: number; y: number };

export type EntityKind = "player" | "zombie" | "pig" | "cow" | "tree" | "rock" | "bullet" | "corpse";

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
