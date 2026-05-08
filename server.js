// Fallout Frenzy — thin relay WebSocket server
// Run: node server.js
// Requires: npm install ws  (one-time)

import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });
const clients = new Map(); // id -> ws

wss.on("connection", (ws) => {
  const id = randomUUID();
  clients.set(id, ws);
  ws.send(JSON.stringify({ type: "init", id }));
  console.log(`+ ${id.slice(0, 8)} (${clients.size} connected)`);

  ws.on("message", (data) => {
    for (const [cid, client] of clients) {
      if (cid !== id && client.readyState === 1) client.send(data);
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    const leave = JSON.stringify({ type: "leave", id });
    for (const [, client] of clients) {
      if (client.readyState === 1) client.send(leave);
    }
    console.log(`- ${id.slice(0, 8)} (${clients.size} connected)`);
  });

  ws.on("error", () => clients.delete(id));
});

console.log(`Relay server running on ws://localhost:${PORT}`);
console.log(`Network players connect to ws://<your-ip>:${PORT}`);
