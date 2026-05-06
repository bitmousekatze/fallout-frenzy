import { Entity } from "./types";
import { GameState } from "./update";
import { TILE, WORLD_SIZE } from "./world";
import { playerSprites } from "./sprites";


function hsl(varName: string, alpha = 1) {
  const root = getComputedStyle(document.documentElement);
  const v = root.getPropertyValue(varName).trim();
  return alpha === 1 ? `hsl(${v})` : `hsla(${v.replace(/\s+/g, ", ")}, ${alpha})`;
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  viewW: number,
  viewH: number
) {
  const { player } = state;
  const shakeX = (Math.random() - 0.5) * state.shake * 8;
  const shakeY = (Math.random() - 0.5) * state.shake * 8;
  const camX = player.pos.x - viewW / 2 + shakeX;
  const camY = player.pos.y - viewH / 2 + shakeY;

  ctx.save();
  ctx.translate(-camX, -camY);

  // Ground
  ctx.fillStyle = hsl("--grass");
  ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  // Tile grid (subtle darker checkers)
  ctx.fillStyle = hsl("--grass-dark", 0.35);
  const startX = Math.max(0, Math.floor(camX / TILE));
  const startY = Math.max(0, Math.floor(camY / TILE));
  const endX = Math.min(WORLD_SIZE / TILE, Math.ceil((camX + viewW) / TILE));
  const endY = Math.min(WORLD_SIZE / TILE, Math.ceil((camY + viewH) / TILE));
  for (let x = startX; x < endX; x++) {
    for (let y = startY; y < endY; y++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  // World border
  ctx.strokeStyle = hsl("--accent");
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

  // Sort entities by y for fake depth
  const drawList = [...state.entities].sort((a, b) => a.pos.y - b.pos.y);

  for (const e of drawList) {
    drawEntity(ctx, e, state.player.id);
  }

  ctx.restore();

  // HUD
  drawHud(ctx, state, viewW, viewH);
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, playerId: number) {
  const { x, y } = e.pos;

  // shadow
  if (e.kind !== "bullet" && e.kind !== "corpse") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + e.radius * 0.6, e.radius * 0.95, e.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  switch (e.kind) {
    case "tree": {
      ctx.fillStyle = hsl("--tree-shadow");
      ctx.beginPath();
      ctx.arc(x, y, e.radius + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hsl("--tree");
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      // trunk hint
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "rock": {
      ctx.fillStyle = hsl("--rock-shadow");
      ctx.beginPath();
      ctx.arc(x, y + 3, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hsl("--rock");
      ctx.beginPath();
      ctx.arc(x, y, e.radius - 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "player": {
      drawPlayerSprite(ctx, e);
      break;
    }
    case "zombie": {
      const flash = e.hitFlash ? "#fff" : hsl("--zombie");
      drawCharacter(ctx, e, flash, false, false);
      break;
    }
    case "pig":
    case "cow": {
      const flash = e.hitFlash ? "#fff" : hsl(e.kind === "pig" ? "--pig" : "--cow");
      drawAnimal(ctx, e, flash);
      break;
    }
    case "bullet": {
      ctx.fillStyle = hsl("--bullet");
      ctx.shadowColor = hsl("--bullet");
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case "corpse": {
      const a = Math.max(0, Math.min(1, (e.fadeTtl ?? 0) / 8));
      ctx.fillStyle = `hsla(0, 65%, 25%, ${a * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, e.radius + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(95, 30%, 25%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  // health bar for damaged living entities
  if (
    (e.kind === "zombie" || e.kind === "pig" || e.kind === "cow") &&
    e.hp > 0 &&
    e.hp < e.maxHp
  ) {
    const w = 40;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - w / 2, y - e.radius - 12, w, 5);
    ctx.fillStyle = hsl("--accent");
    ctx.fillRect(x - w / 2, y - e.radius - 12, (w * e.hp) / e.maxHp, 5);
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  color: string,
  isPlayer: boolean,
  showGun: boolean
) {
  const { x, y } = e.pos;
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, e.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // facing / gun
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  // hands
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(e.radius - 4, -e.radius * 0.55, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(e.radius - 4, e.radius * 0.55, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (showGun || isPlayer) {
    // gun
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(e.radius - 2, -4, 26, 8);
    if (e.muzzleFlash) {
      ctx.fillStyle = "rgba(255,220,120,0.95)";
      ctx.beginPath();
      ctx.arc(e.radius + 26, 0, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // claws for zombies
    ctx.fillStyle = "#2a1a1a";
    ctx.fillRect(e.radius - 2, -10, 8, 4);
    ctx.fillRect(e.radius - 2, 6, 8, 4);
  }
  ctx.restore();
}

function drawAnimal(ctx: CanvasRenderingContext2D, e: Entity, color: string) {
  const { x, y } = e.pos;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(e.angle);
  // body (oval)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, e.radius * 1.25, e.radius * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // head
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(e.radius * 0.95, 0, e.radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // dark eye
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(e.radius * 1.15, -e.radius * 0.2, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // cow spots
  if (e.kind === "cow") {
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.ellipse(-4, -6, 7, 5, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, 8, 6, 4, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  viewW: number,
  viewH: number
) {
  const { player } = state;
  // Health bar
  const barW = 280;
  const barH = 18;
  const x = 24;
  const y = viewH - 48;
  ctx.fillStyle = hsl("--hud-bg", 0.85);
  ctx.fillRect(x - 6, y - 6, barW + 12, barH + 12);
  ctx.fillStyle = hsl("--secondary");
  ctx.fillRect(x, y, barW, barH);
  const pct = player.hp / player.maxHp;
  ctx.fillStyle =
    pct > 0.5 ? hsl("--primary") : pct > 0.25 ? "hsl(40, 80%, 55%)" : hsl("--accent");
  ctx.fillRect(x, y, barW * pct, barH);
  ctx.fillStyle = hsl("--foreground");
  ctx.font = "bold 13px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  ctx.fillText(`HP ${Math.ceil(player.hp)} / ${player.maxHp}`, x + 10, y + barH / 2);

  // Kills + pos
  ctx.fillStyle = hsl("--hud-bg", 0.85);
  ctx.fillRect(viewW - 200, 16, 184, 56);
  ctx.fillStyle = hsl("--foreground");
  ctx.font = "bold 14px ui-sans-serif, system-ui";
  ctx.textBaseline = "top";
  ctx.fillText(`Kills: ${state.kills}`, viewW - 188, 26);
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillStyle = hsl("--muted-foreground");
  ctx.fillText(
    `X ${Math.round(player.pos.x)}  Y ${Math.round(player.pos.y)}`,
    viewW - 188,
    48
  );

  // Minimap
  const mmSize = 160;
  const mmX = viewW - mmSize - 16;
  const mmY = viewH - mmSize - 16;
  ctx.fillStyle = hsl("--hud-bg", 0.85);
  ctx.fillRect(mmX - 4, mmY - 4, mmSize + 8, mmSize + 8);
  ctx.fillStyle = hsl("--grass-dark");
  ctx.fillRect(mmX, mmY, mmSize, mmSize);
  const scale = mmSize / WORLD_SIZE;
  for (const e of state.entities) {
    if (e.hp <= 0) continue;
    let col: string | null = null;
    let r = 1.5;
    if (e.kind === "zombie") {
      col = hsl("--zombie");
      r = 2;
    } else if (e.kind === "pig" || e.kind === "cow") {
      col = hsl(e.kind === "pig" ? "--pig" : "--cow");
      r = 1.5;
    } else if (e.kind === "tree") {
      col = hsl("--tree");
      r = 1;
    }
    if (col) {
      ctx.fillStyle = col;
      ctx.fillRect(mmX + e.pos.x * scale - r / 2, mmY + e.pos.y * scale - r / 2, r, r);
    }
  }
  // player on minimap
  ctx.fillStyle = hsl("--player");
  ctx.beginPath();
  ctx.arc(mmX + player.pos.x * scale, mmY + player.pos.y * scale, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hsl("--foreground");
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmSize, mmSize);

  if (player.hp <= 0) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = hsl("--accent");
    ctx.font = "bold 64px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("YOU DIED", viewW / 2, viewH / 2 - 20);
    ctx.fillStyle = hsl("--foreground");
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.fillText("Press R to respawn", viewW / 2, viewH / 2 + 30);
    ctx.textAlign = "left";
  }
}
