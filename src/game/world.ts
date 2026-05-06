import { Entity, Vec2 } from "./types";

export const WORLD_SIZE = 4000; // sandbox area; map can scale later
export const TILE = 64;

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

export function makePlayer(): Entity {
  return {
    id: nextId(),
    kind: "player",
    pos: { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 },
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

export function generateWorld() {
  const entities: Entity[] = [];
  const player = makePlayer();
  entities.push(player);

  // Trees clustered
  for (let i = 0; i < 180; i++) {
    entities.push(
      makeTree({
        x: rand(100, WORLD_SIZE - 100),
        y: rand(100, WORLD_SIZE - 100),
      })
    );
  }
  // Rocks
  for (let i = 0; i < 60; i++) {
    entities.push(
      makeRock({
        x: rand(100, WORLD_SIZE - 100),
        y: rand(100, WORLD_SIZE - 100),
      })
    );
  }
  // Zombies
  for (let i = 0; i < 40; i++) {
    let p: Vec2;
    do {
      p = { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) };
    } while (dist(p, player.pos) < 400);
    entities.push(makeZombie(p));
  }
  // Pigs
  for (let i = 0; i < 25; i++) {
    entities.push(
      makeAnimal("pig", {
        x: rand(100, WORLD_SIZE - 100),
        y: rand(100, WORLD_SIZE - 100),
      })
    );
  }
  // Cows
  for (let i = 0; i < 18; i++) {
    entities.push(
      makeAnimal("cow", {
        x: rand(100, WORLD_SIZE - 100),
        y: rand(100, WORLD_SIZE - 100),
      })
    );
  }

  return { entities, player };
}
