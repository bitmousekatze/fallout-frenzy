import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { InputState, InventoryItem } from "@/game/types";
import { GameState, updateGame } from "@/game/update";
import { render } from "@/game/render";
import { generateWorld, makeGrenade } from "@/game/world";

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showHelp, setShowHelp] = useState(true);
  const [showInventory, setShowInventory] = useState(false);
  const [inventoryDisplay, setInventoryDisplay] = useState<InventoryItem[]>([]);
  const stateRef = useRef<GameState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const init = generateWorld();
    let state: GameState = {
      entities: init.entities,
      player: init.player,
      fireCooldown: 0,
      kills: 0,
      shake: 0,
      inventory: [],
      ruinAreas: init.ruinAreas,
      roads: init.roads,
      ruinSpawnTimers: init.ruinAreas.map(() => 10),
      globalSpawnTimer: 20,
      insideBuilding: null,
      showLargeMap: false,
    };
    stateRef.current = state;

    const input: InputState = {
      up: false,
      down: false,
      left: false,
      right: false,
      shoot: false,
      mouseWorld: { x: 0, y: 0 },
    };
    const mouseScreen = { x: 0, y: 0 };

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "tab") {
        if (down) {
          e.preventDefault();
          setShowInventory((prev) => {
            const next = !prev;
            if (next) setInventoryDisplay([...state.inventory]);
            return next;
          });
        }
        return;
      }
      if (k === "w" || k === "arrowup") input.up = down;
      else if (k === "s" || k === "arrowdown") input.down = down;
      else if (k === "a" || k === "arrowleft") input.left = down;
      else if (k === "d" || k === "arrowright") input.right = down;
      else if (k === " ") { e.preventDefault(); input.shoot = down; }
      else if (down && k === "3" && state.player.hp > 0) {
        state.entities.push(makeGrenade({ ...state.player.pos }, { ...input.mouseWorld }));
      }
      else if (down && k === "m") {
        state.showLargeMap = !state.showLargeMap;
      }
      else if (down && k === "r" && state.player.hp <= 0) {
        const fresh = generateWorld();
        state = {
          entities: fresh.entities,
          player: fresh.player,
          fireCooldown: 0,
          kills: 0,
          shake: 0,
          inventory: [],
          ruinAreas: fresh.ruinAreas,
          roads: fresh.roads,
          ruinSpawnTimers: fresh.ruinAreas.map(() => 10),
          globalSpawnTimer: 20,
          insideBuilding: null,
          showLargeMap: false,
        };
        stateRef.current = state;
        setShowInventory(false);
        setInventoryDisplay([]);
      }
      if (down) setShowHelp(false);
    };
    const kd = onKey(true);
    const ku = onKey(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseScreen.x = e.clientX - rect.left;
      mouseScreen.y = e.clientY - rect.top;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) input.shoot = true;
      setShowHelp(false);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) input.shoot = false;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Map screen mouse to world
      input.mouseWorld.x = state.player.pos.x + (mouseScreen.x - w / 2);
      input.mouseWorld.y = state.player.pos.y + (mouseScreen.y - h / 2);

      updateGame(state, input, dt);
      render(ctx, state, w, h);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const consumeFood = (food: InventoryItem["food"]) => {
    const s = stateRef.current;
    if (!s) return;
    const slot = s.inventory.find((i) => i.food === food);
    if (!slot || slot.count <= 0) return;
    slot.count--;
    if (slot.count === 0) s.inventory.splice(s.inventory.indexOf(slot), 1);
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + 30);
    setInventoryDisplay([...s.inventory]);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        aria-label="Wasteland top-down shooter game"
      />
      <div className="pointer-events-none absolute left-4 top-4 select-none">
        <h1 className="font-mono text-xl font-bold tracking-widest text-primary drop-shadow">
          FALLOUT<span className="text-accent">/</span>SANDBOX
        </h1>
        <p className="font-mono text-xs text-muted-foreground">v0.1 — mechanics build</p>
      </div>
      <Link
        to="/town-builder"
        className="pointer-events-auto absolute right-4 top-4 font-mono text-xs text-muted-foreground hover:text-primary border border-border bg-card/80 px-3 py-1.5 rounded backdrop-blur"
      >
        Town Builder
      </Link>
      {showInventory && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card/95 px-8 py-6 font-mono text-card-foreground shadow-2xl backdrop-blur min-w-64">
          <div className="mb-4 text-base font-bold tracking-wider text-primary text-center">INVENTORY</div>
          {inventoryDisplay.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Empty</p>
          ) : (
            <div className="space-y-2">
              {inventoryDisplay.map((item) => (
                <button
                  key={item.food}
                  onClick={() => consumeFood(item.food)}
                  className="flex w-full items-center justify-between rounded border border-border bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <span className="capitalize">{item.food === "pork" ? "🥩 Pork" : "🥩 Beef"}</span>
                  <span className="ml-4 text-muted-foreground">x{item.count}</span>
                  <span className="ml-4 text-xs text-green-400">+30 HP</span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-center text-xs text-muted-foreground">TAB to close · click food to eat</p>
        </div>
      )}
      {showHelp && !showInventory && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card/90 px-6 py-5 text-center font-mono text-sm text-card-foreground shadow-2xl backdrop-blur">
          <div className="mb-2 text-base font-bold tracking-wider text-primary">CONTROLS</div>
          <div className="space-y-1 text-muted-foreground">
            <div><span className="text-foreground">WASD</span> move</div>
            <div><span className="text-foreground">Mouse</span> aim</div>
            <div><span className="text-foreground">Left click</span> shoot</div>
            <div><span className="text-foreground">3</span> throw grenade</div>
            <div><span className="text-foreground">M</span> map</div>
            <div><span className="text-foreground">TAB</span> inventory</div>
            <div><span className="text-foreground">R</span> respawn</div>
          </div>
          <div className="mt-3 text-xs text-accent">click to begin</div>
        </div>
      )}
    </div>
  );
}
