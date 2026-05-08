// Fallout Frenzy — authoritative game server
// Run: node server.js
// Requires: npm install ws  (one-time, or: bun add ws)

import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const PORT = process.env.PORT || 3001;
const TICK_RATE = 20; // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const PLAYER_SPEED = 240;
const WORLD_SIZE = 1_000_000;
const SPAWN = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };

const wss = new WebSocketServer({ port: PORT });

// id -> { ws, player, input, name, avatar, lastSeen }
const clients = new Map();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function makeServerPlayer(id, name, avatar) {
  return {
    id,
    name: name || "Survivor",
    avatar: avatar || "cat",
    x: SPAWN.x + (Math.random() - 0.5) * 200,
    y: SPAWN.y + (Math.random() - 0.5) * 200,
    angle: 0,
    facing: "down",
    moving: false,
    animTime: 0,
    hp: 100,
  };
}

// --- Game loop ---
let tick = 0;
setInterval(() => {
  const dt = TICK_MS / 1000;
  tick++;

  for (const [id, c] of clients) {
    if (!c.player) continue;
    const inp = c.input;
    const p = c.player;

    // Authoritative movement
    let dx = 0, dy = 0;
    if (inp.up)    dy -= 1;
    if (inp.down)  dy += 1;
    if (inp.left)  dx -= 1;
    if (inp.right) dx += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len; dy /= len;
      p.x = clamp(p.x + dx * PLAYER_SPEED * dt, 0, WORLD_SIZE);
      p.y = clamp(p.y + dy * PLAYER_SPEED * dt, 0, WORLD_SIZE);
      p.moving = true;
      p.animTime = (p.animTime + dt) % 1000;
    } else {
      p.moving = false;
    }
    p.angle = inp.angle ?? p.angle;
    p.facing = inp.facing ?? p.facing;
  }

  // Build snapshot — send all player states to every client
  const players = [];
  for (const [, c] of clients) {
    if (c.player) players.push(c.player);
  }
  const snapshot = JSON.stringify({ type: "snapshot", tick, players });
  for (const [, c] of clients) {
    if (c.ws.readyState === 1) c.ws.send(snapshot);
  }
}, TICK_MS);

// --- Connections ---
wss.on("connection", (ws) => {
  const id = randomUUID();

  clients.set(id, {
    ws,
    player: null,
    input: { up: false, down: false, left: false, right: false, angle: 0, facing: "down" },
  });

  ws.send(JSON.stringify({ type: "init", id }));
  console.log(`+ ${id.slice(0, 8)} (${clients.size} connected)`);

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const c = clients.get(id);
    if (!c) return;

    if (msg.type === "join") {
      // Client announces name/avatar on connect
      c.player = makeServerPlayer(id, msg.name, msg.avatar);
      console.log(`  ${msg.name || "Survivor"} joined`);
    } else if (msg.type === "input") {
      // Client sends input state each frame
      c.input.up    = !!msg.up;
      c.input.down  = !!msg.down;
      c.input.left  = !!msg.left;
      c.input.right = !!msg.right;
      c.input.angle  = msg.angle  ?? c.input.angle;
      c.input.facing = msg.facing ?? c.input.facing;
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    const leave = JSON.stringify({ type: "leave", id });
    for (const [, c] of clients) {
      if (c.ws.readyState === 1) c.ws.send(leave);
    }
    console.log(`- ${id.slice(0, 8)} (${clients.size} connected)`);
  });

  ws.on("error", () => clients.delete(id));
});

console.log(`Authoritative game server running on ws://localhost:${PORT}`);
console.log(`Tick rate: ${TICK_RATE}Hz | World: ${WORLD_SIZE.toLocaleString()} x ${WORLD_SIZE.toLocaleString()}`);
