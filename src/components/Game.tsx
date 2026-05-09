import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AvatarKind, InputState, InventoryItem, RemotePlayer, WeaponItem, ArmorItem, WEAPONS, ARMORS } from "@/game/types";
import { GameState, updateGame } from "@/game/update";
import { render } from "@/game/render";
import { generateWorld, makeGrenade } from "@/game/world";
import MobileControls from "./MobileControls";
import { randomUUID } from "@/lib/uuid";
import { type Account, updateAccount, getAccount } from "@/lib/accounts";

function resolveSession(routerState: { account?: Account | null; avatar?: AvatarKind } | null): { account: Account | null; avatar: AvatarKind } {
  if (routerState?.account) return { account: routerState.account, avatar: routerState.avatar ?? "cat" };
  try {
    const raw = localStorage.getItem("ff-session");
    if (!raw) return { account: null, avatar: "cat" };
    const { username, avatar } = JSON.parse(raw) as { username: string; avatar: AvatarKind };
    return { account: getAccount(username), avatar: avatar ?? "cat" };
  } catch {
    return { account: null, avatar: "cat" };
  }
}

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001";

const isTouchDevice = () => navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;

export default function Game() {
  const location = useLocation();
  const navigate = useNavigate();
  const { account, avatar } = resolveSession(location.state as { account?: Account | null; avatar?: AvatarKind } | null);
  const name = account?.displayName ?? "Unknown";
  const accountRef = useRef<Account | null>(account);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showHelp, setShowHelp] = useState(true);
  const [showInventory, setShowInventory] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [inventoryDisplay, setInventoryDisplay] = useState<InventoryItem[]>([]);
  const [weaponSlots, setWeaponSlots] = useState<[WeaponItem | null, WeaponItem | null]>([WEAPONS.pistol, null]);
  const [armorSlot, setArmorSlot] = useState<ArmorItem | null>(null);
  const [activeWeaponSlot, setActiveWeaponSlot] = useState<0 | 1>(0);
  const stateRef = useRef<GameState | null>(null);
  const [isMobile] = useState(() => isTouchDevice());
  const mobileInputRef = useRef({ dx: 0, dy: 0, shoot: false, aimScreenX: 0, aimScreenY: 0 });
  const remotePlayersRef = useRef<Map<string, RemotePlayer>>(new Map());
  const myIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsSendTimerRef = useRef(0);
  const prevKillsRef = useRef(0);

  // WebSocket — authoritative server connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", name, avatar }));
      console.log("[FF] Connected to game server");
    };

    ws.onmessage = (e) => {
      let msg: { type: string; id?: string; tick?: number; players?: RemotePlayer[] };
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === "init" && msg.id) {
        myIdRef.current = msg.id;
      } else if (msg.type === "snapshot" && msg.players) {
        const myId = myIdRef.current;
        const newMap = new Map<string, RemotePlayer>();
        for (const p of msg.players) {
          if (p.id !== myId) newMap.set(p.id, p);
        }
        remotePlayersRef.current = newMap;
      } else if (msg.type === "leave" && msg.id) {
        remotePlayersRef.current.delete(msg.id);
      }
    };

    ws.onclose = () => console.log("[FF] Disconnected from game server");
    ws.onerror = () => console.warn("[FF] Game server unreachable — solo mode");

    return () => ws.close();
  }, []);

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
    init.player.avatar = avatar;
    let state: GameState = {
      entities: init.entities,
      player: init.player,
      fireCooldown: 0,
      kills: 0,
      money: 0,
      bankedMoney: account?.money ?? 0,
      bankNotify: 0,
      displayName: account?.displayName ?? "Survivor",
      shake: 0,
      inventory: [],
      ruinAreas: init.ruinAreas,
      roads: init.roads,
      ruinSpawnTimers: init.ruinAreas.map(() => 10),
      globalSpawnTimer: 20,
      insideBuilding: null,
      showLargeMap: false,
      loadedChunks: new Map(),
      discoveredRuinRegions: new Set(),
      weaponSlots: [WEAPONS.pistol, null],
      activeWeaponSlot: 0,
      armorSlot: null,
    };
    stateRef.current = state;

    const input: InputState = {
      up: false,
      down: false,
      left: false,
      right: false,
      shoot: false,
      sprint: false,
      mouseWorld: { x: 0, y: 0 },
    };
    const mouseScreen = { x: 0, y: 0 };

    let paused = false;

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (down) {
          e.preventDefault();
          paused = !paused;
          setShowPause(paused);
          if (paused) setShowHelp(false);
        }
        return;
      }
      if (k === "tab") {
        if (down) {
          e.preventDefault();
          setShowInventory((prev) => {
            const next = !prev;
            if (next) {
              setInventoryDisplay([...state.inventory]);
              setWeaponSlots([...state.weaponSlots] as [WeaponItem | null, WeaponItem | null]);
              setArmorSlot(state.armorSlot);
              setActiveWeaponSlot(state.activeWeaponSlot);
            }
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
      else if (e.key === "Shift") input.sprint = down;
      else if (down && k === "1") {
        state.activeWeaponSlot = 0;
        setActiveWeaponSlot(0);
      }
      else if (down && k === "2") {
        state.activeWeaponSlot = 1;
        setActiveWeaponSlot(1);
      }
      else if (down && k === "3" && state.player.hp > 0) {
        state.entities.push(makeGrenade({ ...state.player.pos }, { ...input.mouseWorld }));
      }
      else if (down && k === "m") {
        state.showLargeMap = !state.showLargeMap;
      }
      else if (down && k === "r" && state.player.hp <= 0) {
        const fresh = generateWorld();
        fresh.player.avatar = avatar;
        prevKillsRef.current = 0;
        state = {
          entities: fresh.entities,
          player: fresh.player,
          fireCooldown: 0,
          kills: 0,
          money: 0,
          bankedMoney: state.bankedMoney,
          bankNotify: 0,
          displayName: state.displayName,
          shake: 0,
          inventory: [],
          ruinAreas: fresh.ruinAreas,
          roads: fresh.roads,
          ruinSpawnTimers: fresh.ruinAreas.map(() => 10),
          globalSpawnTimer: 20,
          insideBuilding: null,
          showLargeMap: false,
          loadedChunks: new Map(),
          discoveredRuinRegions: new Set(),
          weaponSlots: [WEAPONS.pistol, null],
          activeWeaponSlot: 0,
          armorSlot: null,
        };
        stateRef.current = state;
        setShowInventory(false);
        setInventoryDisplay([]);
        setWeaponSlots([WEAPONS.pistol, null]);
        setActiveWeaponSlot(0);
        setArmorSlot(null);
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

      const mob = mobileInputRef.current;
      if (isMobile) {
        // Joystick drives WASD
        input.up = mob.dy < -0.2;
        input.down = mob.dy > 0.2;
        input.left = mob.dx < -0.2;
        input.right = mob.dx > 0.2;
        input.shoot = mob.shoot;
        // Aim toward where the player is pressing on the right side
        input.mouseWorld.x = state.player.pos.x + (mob.aimScreenX - w / 2);
        input.mouseWorld.y = state.player.pos.y + (mob.aimScreenY - h / 2);
      } else {
        // Map screen mouse to world
        input.mouseWorld.x = state.player.pos.x + (mouseScreen.x - w / 2);
        input.mouseWorld.y = state.player.pos.y + (mouseScreen.y - h / 2);
      }

      if (!paused) updateGame(state, input, dt);

      // Persist kills + bankedMoney whenever banking happens (bankNotify just turned on)
      if (accountRef.current && state.bankedMoney !== accountRef.current.money) {
        accountRef.current = {
          ...accountRef.current,
          kills: accountRef.current.kills + state.kills - prevKillsRef.current,
          money: state.bankedMoney,
        };
        prevKillsRef.current = state.kills;
        updateAccount(accountRef.current);
      }

      // Send input to authoritative server at ~20fps
      wsSendTimerRef.current -= dt;
      if (wsSendTimerRef.current <= 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsSendTimerRef.current = 0.05;
        wsRef.current.send(JSON.stringify({
          type: "input",
          up: input.up,
          down: input.down,
          left: input.left,
          right: input.right,
          angle: state.player.angle,
          facing: state.player.facing ?? "down",
        }));
      }

      render(ctx, state, w, h, isMobile, remotePlayersRef.current);
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

  const onMobileMove = useCallback((dx: number, dy: number) => {
    mobileInputRef.current.dx = dx;
    mobileInputRef.current.dy = dy;
    setShowHelp(false);
  }, []);
  const onMobileShootStart = useCallback((x: number, y: number) => {
    const m = mobileInputRef.current;
    m.shoot = true; m.aimScreenX = x; m.aimScreenY = y;
    setShowHelp(false);
  }, []);
  const onMobileShootMove = useCallback((x: number, y: number) => {
    const m = mobileInputRef.current;
    m.aimScreenX = x; m.aimScreenY = y;
  }, []);
  const onMobileShootEnd = useCallback(() => { mobileInputRef.current.shoot = false; }, []);

  const saveAndExit = () => {
    const s = stateRef.current;
    if (s && accountRef.current) {
      accountRef.current = { ...accountRef.current, money: s.bankedMoney };
      updateAccount(accountRef.current);
    }
    navigate("/");
  };

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

  const equipWeapon = (weapon: WeaponItem, slot: 0 | 1) => {
    const s = stateRef.current;
    if (!s) return;
    s.weaponSlots[slot] = weapon;
    s.activeWeaponSlot = slot;
    setWeaponSlots([...s.weaponSlots] as [WeaponItem | null, WeaponItem | null]);
    setActiveWeaponSlot(slot);
  };

  const equipArmor = (armor: ArmorItem) => {
    const s = stateRef.current;
    if (!s) return;
    s.armorSlot = armor;
    setArmorSlot(armor);
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
      {showPause && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-72 rounded-lg border border-border bg-card/97 p-8 font-mono text-card-foreground shadow-2xl text-center">
            <div className="mb-1 text-2xl font-bold tracking-widest text-primary">PAUSED</div>
            <div className="mb-6 text-xs text-muted-foreground">ESC to resume</div>
            <div className="space-y-3">
              <button
                onClick={() => { setShowPause(false); }}
                className="w-full rounded border border-border bg-background px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Resume
              </button>
              <button
                onClick={saveAndExit}
                className="w-full rounded border border-primary bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                Save &amp; Exit to Lobby
              </button>
            </div>
          </div>
        </div>
      )}
      {showInventory && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[96vw] rounded-lg border border-border bg-card/97 p-5 font-mono text-card-foreground shadow-2xl backdrop-blur">
          <div className="mb-4 text-sm font-bold tracking-widest text-primary text-center uppercase">Inventory</div>

          {/* Equipment row */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {/* Weapon slot 1 */}
            {([0, 1] as const).map((slotIdx) => {
              const w = weaponSlots[slotIdx];
              const isActive = activeWeaponSlot === slotIdx;
              return (
                <div key={slotIdx} className={`rounded border p-2 text-xs ${isActive ? "border-primary bg-primary/10" : "border-border bg-background/60"}`}>
                  <div className="text-muted-foreground mb-1 flex items-center justify-between">
                    <span>WEAPON {slotIdx + 1}</span>
                    <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{slotIdx + 1}</kbd>
                  </div>
                  {w ? (
                    <div>
                      <div className="text-base">{w.icon} <span className="text-foreground">{w.name}</span></div>
                      <div className="text-muted-foreground mt-0.5">DMG {w.damage} · {(1 / w.fireRate).toFixed(1)} rps</div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground italic">— empty —</div>
                  )}
                  {/* Swap weapon picker */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(Object.values(WEAPONS) as WeaponItem[]).map((ww) => (
                      <button
                        key={ww.id}
                        onClick={() => equipWeapon(ww, slotIdx)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${w?.id === ww.id ? "border-primary bg-primary/20 text-primary" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                      >
                        {ww.icon} {ww.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Armor slot */}
            <div className="rounded border border-border bg-background/60 p-2 text-xs">
              <div className="text-muted-foreground mb-1">ARMOR</div>
              {armorSlot ? (
                <div>
                  <div className="text-base">{armorSlot.icon} <span className="text-foreground">{armorSlot.name}</span></div>
                  <div className="text-muted-foreground mt-0.5">-{armorSlot.defense}% dmg</div>
                </div>
              ) : (
                <div className="text-muted-foreground italic">— none —</div>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {(Object.values(ARMORS) as ArmorItem[]).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => equipArmor(a)}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${armorSlot?.id === a.id ? "border-primary bg-primary/20 text-primary" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                  >
                    {a.icon} {a.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Food / consumables */}
          <div className="rounded border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground mb-2 tracking-wider">FOOD &amp; CONSUMABLES</div>
            {inventoryDisplay.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground">No food</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {inventoryDisplay.map((item) => (
                  <button
                    key={item.food}
                    onClick={() => consumeFood(item.food)}
                    className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span>🥩 {item.food === "pork" ? "Pork" : "Beef"}</span>
                    <span className="text-muted-foreground">×{item.count}</span>
                    <span className="text-green-400">+30 HP</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-[10px] text-muted-foreground">{isMobile ? "🎒 to close · tap food to eat" : "TAB to close · 1/2 swap weapon · click food to eat"}</p>
        </div>
      )}
      {showHelp && !showInventory && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card/90 px-6 py-5 text-center font-mono text-sm text-card-foreground shadow-2xl backdrop-blur">
          <div className="mb-2 text-base font-bold tracking-wider text-primary">CONTROLS</div>
          {isMobile ? (
            <div className="space-y-1 text-muted-foreground">
              <div><span className="text-foreground">Left joystick</span> move</div>
              <div><span className="text-foreground">Tap &amp; hold right side</span> shoot toward tap</div>
            </div>
          ) : (
            <div className="space-y-1 text-muted-foreground">
              <div><span className="text-foreground">WASD</span> move</div>
              <div><span className="text-foreground">Shift</span> sprint</div>
              <div><span className="text-foreground">Mouse</span> aim</div>
              <div><span className="text-foreground">Left click</span> shoot</div>
              <div><span className="text-foreground">1 / 2</span> swap weapon</div>
              <div><span className="text-foreground">3</span> throw grenade</div>
              <div><span className="text-foreground">M</span> map</div>
              <div><span className="text-foreground">TAB</span> inventory</div>
              <div><span className="text-foreground">R</span> respawn</div>
            </div>
          )}
          <div className="mt-3 text-xs text-accent">{isMobile ? "tap to begin" : "click to begin"}</div>
        </div>
      )}
      {isMobile && (
        <button
          className="pointer-events-auto absolute right-4 bottom-4 z-20 rounded-full border border-border bg-card/90 p-4 font-mono text-xl shadow-lg backdrop-blur active:bg-accent"
          onPointerDown={(e) => { e.preventDefault(); setShowInventory((prev) => { const next = !prev; if (next) setInventoryDisplay([...stateRef.current?.inventory ?? []]); return next; }); }}
        >
          🎒
        </button>
      )}
      {isMobile && (
        <MobileControls
          onMove={onMobileMove}
          onShootStart={onMobileShootStart}
          onShootMove={onMobileShootMove}
          onShootEnd={onMobileShootEnd}
        />
      )}
    </div>
  );
}
