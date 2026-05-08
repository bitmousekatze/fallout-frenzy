import { ChunkData, Entity, InputState, InventoryItem, Road, RuinArea } from "./types";
import {
  SPAWN_POINT, SPAWN_SAFE_RADIUS, WORLD_SIZE,
  CHUNK_SIZE, LOAD_RADIUS, UNLOAD_RADIUS,
  dist, makeBullet, makeExplosion, makeZombie, rand,
  chunkKey, worldToChunk, generateChunk,
} from "./world";

// --- Spatial grid for O(n) broad-phase collision (Option A) ---
const GRID_CELL = 256;
const _grid = new Map<number, Entity[]>();
const _candidateBuf: Entity[] = [];

function _gridKey(gx: number, gy: number): number {
  return (gx & 0x7fff) | ((gy & 0x7fff) << 15);
}
function _gridInsert(e: Entity) {
  const k = _gridKey(Math.floor(e.pos.x / GRID_CELL), Math.floor(e.pos.y / GRID_CELL));
  let cell = _grid.get(k);
  if (!cell) { cell = []; _grid.set(k, cell); }
  cell.push(e);
}
function _gridCandidates(e: Entity): Entity[] {
  _candidateBuf.length = 0;
  const gx = Math.floor(e.pos.x / GRID_CELL);
  const gy = Math.floor(e.pos.y / GRID_CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cell = _grid.get(_gridKey(gx + dx, gy + dy));
      if (cell) for (const c of cell) _candidateBuf.push(c);
    }
  }
  return _candidateBuf;
}

// Physics only runs for entities within this radius of the player (Option B)
const PHYSICS_RADIUS = 900;

const PLAYER_SPEED = 240;
const ZOMBIE_SPEED = 95;
const ZOMBIE_AGGRO = 420;
const ZOMBIE_ATTACK_RANGE = 38;
const ZOMBIE_DAMAGE = 8;
const ANIMAL_SPEED = 60;
const FIRE_RATE = 0.12; // seconds

const RUIN_SPAWN_INTERVAL = 10;  // seconds between ruin spawns
const GLOBAL_SPAWN_INTERVAL = 20; // seconds between roaming spawns

export interface GameState {
  entities: Entity[];
  player: Entity;
  fireCooldown: number;
  kills: number;
  money: number;
  displayName: string;
  shake: number;
  inventory: InventoryItem[];
  ruinAreas: RuinArea[];
  roads: Road[];
  ruinSpawnTimers: number[];   // countdown per ruin area
  globalSpawnTimer: number;
  insideBuilding: number | null; // entity id of building player is currently inside
  showLargeMap: boolean;
  loadedChunks: Map<string, ChunkData>;
  discoveredRuinRegions: Set<string>;
}

function resolveCollision(a: Entity, b: Entity) {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const d = Math.hypot(dx, dy) || 0.0001;
  const overlap = a.radius + b.radius - d;
  if (overlap > 0) {
    const nx = dx / d;
    const ny = dy / d;
    // trees/rocks are immovable
    const aStatic = a.kind === "tree" || a.kind === "rock" || a.kind === "ruin" || a.kind === "car";
    const bStatic = b.kind === "tree" || b.kind === "rock" || b.kind === "ruin" || b.kind === "car";
    if (aStatic && bStatic) return;
    if (aStatic) {
      b.pos.x -= nx * overlap;
      b.pos.y -= ny * overlap;
    } else if (bStatic) {
      a.pos.x += nx * overlap;
      a.pos.y += ny * overlap;
    } else {
      a.pos.x += (nx * overlap) / 2;
      a.pos.y += (ny * overlap) / 2;
      b.pos.x -= (nx * overlap) / 2;
      b.pos.y -= (ny * overlap) / 2;
    }
  }
}

function ruinLocalPos(player: Entity, ruin: Entity) {
  const dx = player.pos.x - ruin.pos.x;
  const dy = player.pos.y - ruin.pos.y;
  const cos = Math.cos(-ruin.angle), sin = Math.sin(-ruin.angle);
  return { lx: dx * cos - dy * sin, ly: dx * sin + dy * cos };
}

function isInsideBuildingRect(player: Entity, ruin: Entity): boolean {
  const w = ruin.ruinW ?? 120, h = ruin.ruinH ?? 100;
  const { lx, ly } = ruinLocalPos(player, ruin);
  return Math.abs(lx) < w / 2 - 4 && Math.abs(ly) < h / 2 - 4;
}

// Returns true if a bullet has entered solid wall (not the door corridor)
function bulletHitsWall(bullet: Entity, ruin: Entity): boolean {
  const w = ruin.ruinW ?? 120, h = ruin.ruinH ?? 100;
  const doorHW = w * 0.20;
  const dx = bullet.pos.x - ruin.pos.x;
  const dy = bullet.pos.y - ruin.pos.y;
  const cos = Math.cos(-ruin.angle), sin = Math.sin(-ruin.angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  if (Math.abs(lx) >= w / 2 || Math.abs(ly) >= h / 2) return false; // outside rect
  if (Math.abs(lx) < doorHW) return false; // inside door corridor — passable
  return true;
}

// AABB push-out for player approaching a ruin from outside.
// Uses rectangle math so corners can't be clipped into.
// The south face is open at the door zone (|lx| < doorHW).
function resolvePlayerVsRuinExterior(player: Entity, ruin: Entity) {
  const w = ruin.ruinW ?? 120, h = ruin.ruinH ?? 100;
  const doorHW = w * 0.20;
  const r = player.radius;
  const { lx, ly } = ruinLocalPos(player, ruin);
  const hw = w / 2, hh = h / 2;

  const ox = hw + r - Math.abs(lx);
  const oy = hh + r - Math.abs(ly);
  if (ox <= 0 || oy <= 0) return; // no overlap

  let nlx = lx, nly = ly;
  if (ox < oy) {
    // least penetration is horizontal — push sideways
    nlx = lx > 0 ? lx + ox : lx - ox;
  } else {
    // least penetration is vertical
    if (ly > 0 && Math.abs(lx) < doorHW) return; // south door open
    if (ly < 0 && ruin.twoDoors && Math.abs(lx) < doorHW) return; // north door open
    nly = ly > 0 ? ly + oy : ly - oy;
  }

  const cos = Math.cos(ruin.angle), sin = Math.sin(ruin.angle);
  player.pos.x = ruin.pos.x + nlx * cos - nly * sin;
  player.pos.y = ruin.pos.y + nlx * sin + nly * cos;
}

function constrainPlayerInsideBuilding(player: Entity, ruin: Entity) {
  const w = ruin.ruinW ?? 120, h = ruin.ruinH ?? 100;
  const doorHW = w * 0.20;
  const r = player.radius;
  const { lx, ly } = ruinLocalPos(player, ruin);
  const hw = w / 2, hh = h / 2;

  let nlx = lx, nly = ly;
  // South wall — open at door zone
  if (ly > hh - r && Math.abs(lx) >= doorHW) nly = hh - r;
  // North wall — solid, or open at door zone for two-door buildings
  if (ly < -hh + r && (!ruin.twoDoors || Math.abs(lx) >= doorHW)) nly = -hh + r;
  // East wall — solid
  if (lx > hw - r) nlx = hw - r;
  // West wall — solid
  if (lx < -hw + r) nlx = -hw + r;

  if (nlx !== lx || nly !== ly) {
    const cos = Math.cos(ruin.angle), sin = Math.sin(ruin.angle);
    player.pos.x = ruin.pos.x + nlx * cos - nly * sin;
    player.pos.y = ruin.pos.y + nlx * sin + nly * cos;
  }
}

export function updateGame(state: GameState, input: InputState, dt: number) {
  const { player } = state;

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 4);

  // Defensive init for hot-reload / state migration
  if (!state.loadedChunks) state.loadedChunks = new Map();
  if (!state.discoveredRuinRegions) state.discoveredRuinRegions = new Set();

  // Chunk streaming: load nearby chunks, unload distant ones
  {
    const { cx: pcx, cy: pcy } = worldToChunk(player.pos.x, player.pos.y);
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
        const cx = pcx + dx, cy = pcy + dy;
        const key = chunkKey(cx, cy);
        if (state.loadedChunks.has(key)) continue;
        const wx = cx * CHUNK_SIZE, wy = cy * CHUNK_SIZE;
        if (wx < 0 || wy < 0 || wx >= WORLD_SIZE || wy >= WORLD_SIZE) continue;
        const result = generateChunk(cx, cy, state.roads);
        state.loadedChunks.set(key, { cx, cy, entityIds: result.entities.map(e => e.id) });
        state.entities.push(...result.entities);
        if (result.newRoads.length > 0) state.roads.push(...result.newRoads);
        if (result.ruinRegionKey && !state.discoveredRuinRegions.has(result.ruinRegionKey)) {
          state.discoveredRuinRegions.add(result.ruinRegionKey);
          if (result.newRuinArea) {
            state.ruinAreas.push(result.newRuinArea);
            state.ruinSpawnTimers.push(RUIN_SPAWN_INTERVAL);
          }
        }
      }
    }
    for (const [key, chunk] of state.loadedChunks) {
      if (Math.abs(chunk.cx - pcx) > UNLOAD_RADIUS || Math.abs(chunk.cy - pcy) > UNLOAD_RADIUS) {
        const idSet = new Set(chunk.entityIds);
        state.entities = state.entities.filter(e => {
          if (!idSet.has(e.id)) return true;
          // Keep living dynamic entities still near the player
          if (e.hp > 0 &&
              (e.kind === "zombie" || e.kind === "pig" || e.kind === "cow") &&
              dist(e.pos, player.pos) < PHYSICS_RADIUS) return true;
          return false;
        });
        state.loadedChunks.delete(key);
      }
    }
  }

  // Player movement
  if (player.hp > 0) {
    let vx = 0;
    let vy = 0;
    if (input.up) vy -= 1;
    if (input.down) vy += 1;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx /= len;
      vy /= len;
    }
    const speed = PLAYER_SPEED * (input.sprint ? 1.6 : 1);
    player.pos.x += vx * speed * dt;
    player.pos.y += vy * speed * dt;
    player.angle = Math.atan2(input.mouseWorld.y - player.pos.y, input.mouseWorld.x - player.pos.x);

    // Animation: pick facing from movement; idle keeps last facing
    player.moving = len > 0;
    if (player.moving) {
      // Prefer dominant axis for clean 4-directional sprites
      if (Math.abs(vx) > Math.abs(vy)) {
        player.facing = vx > 0 ? "right" : "left";
      } else {
        player.facing = vy > 0 ? "down" : "up";
      }
      player.animTime = (player.animTime ?? 0) + dt;
    } else {
      player.animTime = 0;
    }
  }

  // Clamp to world
  player.pos.x = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.pos.x));
  player.pos.y = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.pos.y));

  // Track which building the player is inside and scale radius 20% smaller indoors
  let _inBuilding: number | null = null;
  for (const e of state.entities) {
    if (e.kind !== "ruin" || e.hp <= 0) continue;
    if (isInsideBuildingRect(player, e)) { _inBuilding = e.id; break; }
  }
  state.insideBuilding = _inBuilding;
  player.radius = _inBuilding ? 16 : 20;

  // Shooting
  state.fireCooldown = Math.max(0, state.fireCooldown - dt);
  if (input.shoot && state.fireCooldown <= 0 && player.hp > 0) {
    state.fireCooldown = FIRE_RATE;
    const muzzleX = player.pos.x + Math.cos(player.angle) * (player.radius + 18);
    const muzzleY = player.pos.y + Math.sin(player.angle) * (player.radius + 18);
    const spread = (Math.random() - 0.5) * 0.04;
    state.entities.push(makeBullet({ x: muzzleX, y: muzzleY }, player.angle + spread, player.id));
    player.muzzleFlash = 0.06;
    state.shake = Math.min(1, state.shake + 0.15);
  }
  if (player.muzzleFlash) {
    player.muzzleFlash -= dt;
    if (player.muzzleFlash <= 0) player.muzzleFlash = undefined;
  }

  // AI: zombies
  for (const e of state.entities) {
    if (e.hitFlash) {
      e.hitFlash -= dt;
      if (e.hitFlash <= 0) e.hitFlash = undefined;
    }
    if (e.kind === "zombie" && e.hp > 0) {
      const d = dist(e.pos, player.pos);
      // D: skip AI entirely for zombies well outside aggro + buffer — imperceptible at that range
      if (d > 1200) continue;
      if (d < ZOMBIE_AGGRO && player.hp > 0) {
        e.state = "chase";
        const ang = Math.atan2(player.pos.y - e.pos.y, player.pos.x - e.pos.x);
        e.angle = ang;
        let mvx = Math.cos(ang) * ZOMBIE_SPEED * dt;
        let mvy = Math.sin(ang) * ZOMBIE_SPEED * dt;

        // Steer around ruin buildings: add tangential force when inside avoidance radius
        for (const ruin of state.entities) {
          if (ruin.kind !== "ruin" || ruin.hp <= 0) continue;
          const rdx = e.pos.x - ruin.pos.x;
          const rdy = e.pos.y - ruin.pos.y;
          const rd = Math.hypot(rdx, rdy);
          const avoidR = ruin.radius + e.radius + 20;
          if (rd < avoidR && rd > 0) {
            // Tangent that points toward the player
            const tx = -rdy / rd, ty = rdx / rd;
            const toPlayerDot = tx * (player.pos.x - e.pos.x) + ty * (player.pos.y - e.pos.y);
            const sign = toPlayerDot >= 0 ? 1 : -1;
            const w = 1 - rd / avoidR;
            mvx += tx * sign * ZOMBIE_SPEED * w * dt;
            mvy += ty * sign * ZOMBIE_SPEED * w * dt;
          }
        }

        // Separation from nearby zombies so they don't stack into one blob
        for (const other of state.entities) {
          if (other === e || other.kind !== "zombie" || other.hp <= 0) continue;
          const sdx = e.pos.x - other.pos.x;
          const sdy = e.pos.y - other.pos.y;
          const sd = Math.hypot(sdx, sdy);
          if (sd < 44 && sd > 0) {
            const push = ((44 - sd) / 44) * ZOMBIE_SPEED * 0.6 * dt;
            mvx += (sdx / sd) * push;
            mvy += (sdy / sd) * push;
          }
        }

        e.pos.x += mvx;
        e.pos.y += mvy;
        e.attackCooldown = (e.attackCooldown ?? 0) - dt;
        if (d < ZOMBIE_ATTACK_RANGE && (e.attackCooldown ?? 0) <= 0) {
          player.hp = Math.max(0, player.hp - ZOMBIE_DAMAGE);
          e.attackCooldown = 0.8;
          state.shake = Math.min(1, state.shake + 0.3);
        }
      } else {
        // wander
        if (!e.wanderTarget || dist(e.pos, e.wanderTarget) < 20) {
          e.wanderTarget = {
            x: e.pos.x + rand(-200, 200),
            y: e.pos.y + rand(-200, 200),
          };
        }
        const ang = Math.atan2(e.wanderTarget.y - e.pos.y, e.wanderTarget.x - e.pos.x);
        e.angle = ang;
        e.pos.x += Math.cos(ang) * ZOMBIE_SPEED * 0.4 * dt;
        e.pos.y += Math.sin(ang) * ZOMBIE_SPEED * 0.4 * dt;
      }
    }


    if ((e.kind === "pig" || e.kind === "cow") && e.hp > 0) {
      // peaceful wander
      if (!e.wanderTarget || dist(e.pos, e.wanderTarget) < 20 || Math.random() < 0.001) {
        e.wanderTarget = {
          x: e.pos.x + rand(-150, 150),
          y: e.pos.y + rand(-150, 150),
        };
      }
      const ang = Math.atan2(e.wanderTarget.y - e.pos.y, e.wanderTarget.x - e.pos.x);
      e.angle = ang;
      e.pos.x += Math.cos(ang) * ANIMAL_SPEED * dt;
      e.pos.y += Math.sin(ang) * ANIMAL_SPEED * dt;
    }

    // clamp to world
    if (e.kind !== "bullet") {
      e.pos.x = Math.max(e.radius, Math.min(WORLD_SIZE - e.radius, e.pos.x));
      e.pos.y = Math.max(e.radius, Math.min(WORLD_SIZE - e.radius, e.pos.y));
    }
  }

  // Bullets
  for (const e of state.entities) {
    if (e.kind !== "bullet") continue;
    e.pos.x += e.vel.x * dt;
    e.pos.y += e.vel.y * dt;
    e.ttl = (e.ttl ?? 0) - dt;
    if (e.ttl <= 0 || e.pos.x < 0 || e.pos.y < 0 || e.pos.x > WORLD_SIZE || e.pos.y > WORLD_SIZE) {
      e.hp = 0;
      continue;
    }
    // Stop bullet when it hits a building wall (skip the building the player is inside)
    if (e.hp > 0) {
      for (const ruin of state.entities) {
        if (ruin.kind !== "ruin" || ruin.hp <= 0) continue;
        if (state.insideBuilding === ruin.id) continue;
        if (bulletHitsWall(e, ruin)) { e.hp = 0; break; }
      }
    }
  }

  // Grenades — move toward target, count down fuse, explode
  for (const e of state.entities) {
    if (e.kind !== "grenade" || e.hp <= 0) continue;
    e.fuseTimer = (e.fuseTimer ?? 4) - dt;

    // Slow down as grenade nears its target
    if (e.throwTarget) {
      const dx = e.throwTarget.x - e.pos.x;
      const dy = e.throwTarget.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 10) {
        e.vel.x = 0;
        e.vel.y = 0;
      } else {
        const decel = Math.min(1, d / 80);
        e.vel.x *= 1 - dt * 4 * (1 - decel);
        e.vel.y *= 1 - dt * 4 * (1 - decel);
      }
    }
    e.pos.x += e.vel.x * dt;
    e.pos.y += e.vel.y * dt;

    // Explode on impact with solids or world boundary
    const hitWall = e.pos.x <= e.radius || e.pos.x >= WORLD_SIZE - e.radius ||
                    e.pos.y <= e.radius || e.pos.y >= WORLD_SIZE - e.radius;
    const hitSolid = !hitWall && state.entities.some(t =>
      t !== e && t.hp > 0 &&
      (t.kind === "zombie" || t.kind === "pig" || t.kind === "cow" || t.kind === "tree" || t.kind === "rock" || t.kind === "ruin" || t.kind === "car") &&
      dist(e.pos, t.pos) < e.radius + t.radius
    );

    if (e.fuseTimer <= 0 || hitWall || hitSolid) {
      e.hp = 0;
      const EXPLOSION_RADIUS = 120;
      const EXPLOSION_DAMAGE = 80;
      state.entities.push(makeExplosion(e.pos));
      state.shake = Math.min(3, state.shake + 2.5);
      for (const t of state.entities) {
        if (t === e || t.hp <= 0) continue;
        if (t.kind === "player") continue; // player is immune
        if (t.kind === "bullet" || t.kind === "corpse" || t.kind === "tree" || t.kind === "rock" || t.kind === "ruin" || t.kind === "car" || t.kind === "explosion") continue;
        const d = dist(e.pos, t.pos);
        if (d < EXPLOSION_RADIUS + t.radius) {
          const dmg = EXPLOSION_DAMAGE * Math.max(0, 1 - d / EXPLOSION_RADIUS);
          t.hp -= dmg;
          t.hitFlash = 0.12;
          if (t.hp <= 0) {
            state.kills++;
            if (t.kind === "zombie") state.money += 5 + Math.floor(Math.random() * 11);
            if (t.kind === "pig" || t.kind === "cow") {
              const food = t.kind === "pig" ? "pork" : "beef";
              const slot = state.inventory.find(i => i.food === food);
              if (slot) slot.count++; else state.inventory.push({ food, count: 1 });
            }
            t.kind = "corpse";
            t.fadeTtl = 8;
            t.radius = Math.max(8, t.radius - 4);
          }
        }
      }
    }
  }

  // Explosions — tick down
  for (const e of state.entities) {
    if (e.kind === "explosion") e.ttl = (e.ttl ?? 0) - dt;
  }

  // Bullet collisions
  for (const b of state.entities) {
    if (b.kind !== "bullet" || b.hp <= 0) continue;
    for (const t of state.entities) {
      if (t.id === b.ownerId || t.hp <= 0) continue;
      if (t.kind === "bullet" || t.kind === "corpse" || t.kind === "ruin") continue;
      if (dist(b.pos, t.pos) < b.radius + t.radius) {
        if (t.kind === "tree" || t.kind === "rock" || t.kind === "car") {
          b.hp = 0;
          break;
        }
        t.hp -= b.damage ?? 20;
        t.hitFlash = 0.08;
        b.hp = 0;
        if (t.hp <= 0) {
          state.kills++;
          if (t.kind === "zombie") state.money += 5 + Math.floor(Math.random() * 11);
          if (t.kind === "pig" || t.kind === "cow") {
            const food = t.kind === "pig" ? "pork" : "beef";
            const slot = state.inventory.find((i) => i.food === food);
            if (slot) slot.count++;
            else state.inventory.push({ food, count: 1 });
          }
          // turn into corpse
          t.kind = "corpse";
          t.fadeTtl = 8;
          t.radius = Math.max(8, t.radius - 4);
        }
        break;
      }
    }
  }

  // Entity-entity collisions — spatial grid broad-phase (A) + player-proximity cull (B)
  const solids = state.entities.filter(
    (e) => e.hp > 0 &&
    (e.kind === "player" || e.kind === "zombie" || e.kind === "pig" || e.kind === "cow" || e.kind === "tree" || e.kind === "rock" || e.kind === "ruin" || e.kind === "car") &&
    (e.kind === "player" || dist(e.pos, player.pos) < PHYSICS_RADIUS)
  );
  _grid.clear();
  for (const e of solids) _gridInsert(e);
  for (const a of solids) {
    const candidates = _gridCandidates(a);
    for (const b of candidates) {
      if (b.id <= a.id) continue; // each pair exactly once
      // handled separately with door awareness below
      if ((a.kind === "player" && b.kind === "ruin") || (a.kind === "ruin" && b.kind === "player")) continue;
      resolveCollision(a, b);
    }
  }

  // Player vs ruin buildings: allow entry through door gap, enforce walls from inside
  if (player.hp > 0) {
    for (const e of state.entities) {
      if (e.kind !== "ruin" || e.hp <= 0) continue;
      if (state.insideBuilding === e.id) {
        constrainPlayerInsideBuilding(player, e);
      } else {
        resolvePlayerVsRuinExterior(player, e);
      }
    }
  }

  // Corpses fade
  for (const e of state.entities) {
    if (e.kind === "corpse") {
      e.fadeTtl = (e.fadeTtl ?? 0) - dt;
    }
  }

  // Ruin zombie respawns — only when cleared, every 10s
  if (player.hp > 0) {
    for (let i = 0; i < state.ruinAreas.length; i++) {
      const ra = state.ruinAreas[i];
      state.ruinSpawnTimers[i] = (state.ruinSpawnTimers[i] ?? RUIN_SPAWN_INTERVAL) - dt;

      if (state.ruinSpawnTimers[i] <= 0) {
        state.ruinSpawnTimers[i] = RUIN_SPAWN_INTERVAL;

        // Only spawn if ruin is cleared (no living zombies inside radius)
        const livingInRuin = state.entities.some(
          e => e.kind === "zombie" && e.hp > 0 && dist(e.pos, { x: ra.cx, y: ra.cy }) < ra.radius + 100
        );
        if (!livingInRuin) {
          const count = Math.random() < 0.20 ? 15 : 8;
          for (let z = 0; z < count; z++) {
            const angle = rand(0, Math.PI * 2);
            const r = rand(60, ra.radius);
            const pos = { x: ra.cx + Math.cos(angle) * r, y: ra.cy + Math.sin(angle) * r };
            // never spawn inside the safe zone
            if (dist(pos, SPAWN_POINT) < SPAWN_SAFE_RADIUS) continue;
            state.entities.push(makeZombie(pos));
          }
        }
      }
    }

    // Global constant spawn — roaming zombie somewhere on the map
    state.globalSpawnTimer = (state.globalSpawnTimer ?? GLOBAL_SPAWN_INTERVAL) - dt;
    if (state.globalSpawnTimer <= 0) {
      state.globalSpawnTimer = GLOBAL_SPAWN_INTERVAL;
      let pos: { x: number; y: number } | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        // Spawn within 1500–3000 units of player so it's relevant
        const angle = Math.random() * Math.PI * 2;
        const radius = rand(1500, 3000);
        const p = {
          x: player.pos.x + Math.cos(angle) * radius,
          y: player.pos.y + Math.sin(angle) * radius,
        };
        if (p.x < 100 || p.y < 100 || p.x > WORLD_SIZE - 100 || p.y > WORLD_SIZE - 100) continue;
        if (dist(p, SPAWN_POINT) < SPAWN_SAFE_RADIUS) continue;
        pos = p;
        break;
      }
      if (pos) state.entities.push(makeZombie(pos));
    }
  }

  // Cleanup
  state.entities = state.entities.filter((e) => {
    if (e.kind === "bullet") return e.hp > 0;
    if (e.kind === "corpse") return (e.fadeTtl ?? 0) > 0;
    if (e.kind === "grenade") return e.hp > 0;
    if (e.kind === "explosion") return (e.ttl ?? 0) > 0;
    return true;
  });
}
