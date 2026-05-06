import { Entity, InputState } from "./types";
import { WORLD_SIZE, dist, makeBullet, rand } from "./world";

const PLAYER_SPEED = 240;
const ZOMBIE_SPEED = 95;
const ZOMBIE_AGGRO = 420;
const ZOMBIE_ATTACK_RANGE = 38;
const ZOMBIE_DAMAGE = 8;
const ANIMAL_SPEED = 60;
const FIRE_RATE = 0.12; // seconds

export interface GameState {
  entities: Entity[];
  player: Entity;
  fireCooldown: number;
  kills: number;
  shake: number;
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
    const aStatic = a.kind === "tree" || a.kind === "rock";
    const bStatic = b.kind === "tree" || b.kind === "rock";
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

export function updateGame(state: GameState, input: InputState, dt: number) {
  const { player } = state;

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 4);

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
    player.pos.x += vx * PLAYER_SPEED * dt;
    player.pos.y += vy * PLAYER_SPEED * dt;
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
      if (d < ZOMBIE_AGGRO && player.hp > 0) {
        e.state = "chase";
        const ang = Math.atan2(player.pos.y - e.pos.y, player.pos.x - e.pos.x);
        e.angle = ang;
        e.pos.x += Math.cos(ang) * ZOMBIE_SPEED * dt;
        e.pos.y += Math.sin(ang) * ZOMBIE_SPEED * dt;
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
    }
  }

  // Bullet collisions
  for (const b of state.entities) {
    if (b.kind !== "bullet" || b.hp <= 0) continue;
    for (const t of state.entities) {
      if (t.id === b.ownerId || t.hp <= 0) continue;
      if (t.kind === "bullet" || t.kind === "corpse") continue;
      if (dist(b.pos, t.pos) < b.radius + t.radius) {
        if (t.kind === "tree" || t.kind === "rock") {
          b.hp = 0;
          break;
        }
        t.hp -= b.damage ?? 20;
        t.hitFlash = 0.08;
        b.hp = 0;
        if (t.hp <= 0) {
          state.kills++;
          // turn into corpse
          t.kind = "corpse";
          t.fadeTtl = 8;
          t.radius = Math.max(8, t.radius - 4);
        }
        break;
      }
    }
  }

  // Entity-entity collisions (simple O(n^2), fine for sandbox counts)
  const solids = state.entities.filter(
    (e) => e.hp > 0 && (e.kind === "player" || e.kind === "zombie" || e.kind === "pig" || e.kind === "cow" || e.kind === "tree" || e.kind === "rock")
  );
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      resolveCollision(solids[i], solids[j]);
    }
  }

  // Corpses fade
  for (const e of state.entities) {
    if (e.kind === "corpse") {
      e.fadeTtl = (e.fadeTtl ?? 0) - dt;
    }
  }

  // Cleanup
  state.entities = state.entities.filter((e) => {
    if (e.kind === "bullet") return e.hp > 0;
    if (e.kind === "corpse") return (e.fadeTtl ?? 0) > 0;
    return true;
  });
}
