import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AvatarKind, InputState, InventoryItem, RemotePlayer, WeaponItem, ArmorItem, WEAPONS, ARMORS,
  ConsumableId, ConsumableItem, WeaponUpgrades, WeaponId, CONSUMABLES, AMMO_PACKS,
  freshUpgrades, effectiveDamage, effectiveMag, upgradeCost, DAMAGE_UPGRADE_BASE, MAG_UPGRADE_BASE,
  DAMAGE_PER_LEVEL, MAG_PER_LEVEL, MAX_UPGRADE_LEVEL } from "@/game/types";
import { GameState, updateGame } from "@/game/update";
import { render } from "@/game/render";
import { generateWorld, makeGrenade } from "@/game/world";
import MobileControls from "./MobileControls";
import Blackjack from "./casino/Blackjack";
import Roulette from "./casino/Roulette";
import Slots from "./casino/Slots";
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
  // Shop / economy UI mirrors of game state
  const [showShop, setShowShop] = useState<"health" | "guns" | null>(null);
  const [nearShop, setNearShop] = useState<"health" | "guns" | null>(null);
  const [nearGame, setNearGame] = useState<"blackjack" | "roulette" | "slots" | null>(null);
  const [showCasino, setShowCasino] = useState<"blackjack" | "roulette" | "slots" | null>(null);
  const [padConnected, setPadConnected] = useState(false);
  const [wallet, setWallet] = useState(0);
  const [ammo, setAmmo] = useState(0);
  const [consumables, setConsumables] = useState<ConsumableItem[]>([]);
  const [weaponUpgrades, setWeaponUpgrades] = useState<WeaponUpgrades>(() => freshUpgrades());
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
      mapMode: 0,
      loadedChunks: new Map(),
      discoveredRuinRegions: new Set(),
      weaponSlots: [WEAPONS.pistol, null],
      activeWeaponSlot: 0,
      armorSlot: null,
      ammo: 200,
      mags: { pistol: 12, rifle: 0, shotgun: 0 },
      weaponUpgrades: freshUpgrades(),
      consumables: [],
      nearShop: null,
      nearGame: null,
      aimTargetId: null,
    };
    stateRef.current = state;

    const input: InputState = {
      up: false,
      down: false,
      left: false,
      right: false,
      shoot: false,
      sprint: false,
      aim: false,
      mouseWorld: { x: 0, y: 0 },
    };
    const mouseScreen = { x: 0, y: 0 };

    let paused = false;
    // Shoot intent from mouse/keyboard, kept separate so the gamepad can OR into
    // input.shoot each frame without the value sticking on.
    let manualShoot = false;
    let manualAim = false;     // right mouse button → hold-to-aim
    let sprintToggle = false;  // sprint is a toggle, not hold

    // Interact with whatever the player is next to (trader shop or casino table).
    const doInteract = () => {
      if (state.nearShop) {
        setShowShop((prev) => {
          if (prev) return null;
          syncShopState();
          return state.nearShop;
        });
      } else if (state.nearGame) {
        setShowCasino((prev) => {
          if (prev) return null;
          syncShopState();
          return state.nearGame;
        });
      } else {
        setShowShop(null);
        setShowCasino(null);
      }
    };

    const doRespawn = () => {
      if (state.player.hp > 0) return;
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
        mapMode: 0,
        loadedChunks: new Map(),
        discoveredRuinRegions: new Set(),
        weaponSlots: [WEAPONS.pistol, null],
        activeWeaponSlot: 0,
        armorSlot: null,
        ammo: 200,
        mags: { pistol: 12, rifle: 0, shotgun: 0 },
        weaponUpgrades: freshUpgrades(),
        consumables: [],
        nearShop: null,
        nearGame: null,
        aimTargetId: null,
      };
      stateRef.current = state;
      setShowInventory(false);
      setInventoryDisplay([]);
      setWeaponSlots([WEAPONS.pistol, null]);
      setActiveWeaponSlot(0);
      setArmorSlot(null);
    };

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (down) {
          e.preventDefault();
          // Escape closes the map first if it's open, before pausing
          if (state.mapMode !== 0) {
            state.mapMode = 0;
            return;
          }
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
              setArmorSlot(state.armorSlot);
              syncShopState();
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
      else if (k === " ") { e.preventDefault(); manualShoot = down; }
      else if (e.key === "Shift") { if (down) sprintToggle = !sprintToggle; }
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
        // Cycle: hidden → minimap → fullscreen → hidden
        state.mapMode = ((state.mapMode + 1) % 3) as 0 | 1 | 2;
      }
      else if (down && k === "e") {
        doInteract();
      }
      else if (down && k === "r" && state.player.hp <= 0) {
        doRespawn();
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
      if (e.button === 0) manualShoot = true;
      if (e.button === 2) manualAim = true;
      setShowHelp(false);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) manualShoot = false;
      if (e.button === 2) manualAim = false;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    const onPadConnect = (e: GamepadEvent) => {
      console.log("[FF] Gamepad connected:", e.gamepad.id);
      setPadConnected(true);
      setShowHelp(false);
    };
    const onPadDisconnect = () => {
      // Only clear if no pads remain
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      setPadConnected(Array.from(pads).some((p) => p && p.connected));
    };
    window.addEventListener("gamepadconnected", onPadConnect);
    window.addEventListener("gamepaddisconnected", onPadDisconnect);
    // A pad paired before load won't fire 'connected' until first input — seed it
    {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (Array.from(pads).some((p) => p && p.connected)) setPadConnected(true);
    }

    let raf = 0;
    let last = performance.now();
    let lastNearShop: "health" | "guns" | null = null;
    let lastNearGame: "blackjack" | "roulette" | "slots" | null = null;
    // Gamepad edge-detection state (prev pressed status per button) + movement latch
    const prevPad: boolean[] = [];
    let padMovedLast = false;
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
        input.shoot = manualShoot;
        input.sprint = sprintToggle;
        input.aim = manualAim;
        input.mouseWorld.x = state.player.pos.x + (mouseScreen.x - w / 2);
        input.mouseWorld.y = state.player.pos.y + (mouseScreen.y - h / 2);
      }

      // --- Gamepad (Trust GX / any standard-mapping pad over Bluetooth) ---
      if (!isMobile) {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let gp: Gamepad | null = null;
        for (const p of pads) { if (p && p.connected) { gp = p; break; } }
        if (gp) {
          const DEAD = 0.28;
          const ax = (i: number) => gp!.axes[i] ?? 0;
          const btn = (i: number) => gp!.buttons[i]?.pressed ?? false;
          const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);

          // Left stick OR d-pad → movement. Latch so releasing the stick clears
          // movement once, then hands control back to the keyboard.
          const padLeft = lx < -DEAD || btn(14);
          const padRight = lx > DEAD || btn(15);
          const padUp = ly < -DEAD || btn(12);
          const padDown = ly > DEAD || btn(13);
          const padMoving = padLeft || padRight || padUp || padDown;
          if (padMoving || padMovedLast) {
            input.left = padLeft;
            input.right = padRight;
            input.up = padUp;
            input.down = padDown;
          }
          padMovedLast = padMoving;

          // Right stick → aim (only while pushed; otherwise mouse aim stands)
          if (Math.hypot(rx, ry) > DEAD) {
            const ang = Math.atan2(ry, rx);
            input.mouseWorld.x = state.player.pos.x + Math.cos(ang) * 300;
            input.mouseWorld.y = state.player.pos.y + Math.sin(ang) * 300;
          }

          // Fire: right trigger (7), right bumper (5), or A (0)
          if (btn(7) || btn(5) || btn(0)) input.shoot = true;
          // Aim: hold left trigger (6) → slow walk + auto-aim lock
          if (btn(6)) input.aim = true;

          // Edge-triggered buttons
          const pressed = (i: number) => btn(i) && !prevPad[i];
          if (pressed(10)) sprintToggle = !sprintToggle; // L3 (left stick click) → toggle sprint
          // X → grenade. A controller has no live cursor, so only allow throwing
          // while aiming (LT) — otherwise it'd land at the player's own feet.
          if (pressed(2) && state.player.hp > 0 && input.aim) {
            const locked = state.aimTargetId != null
              ? state.entities.find((e) => e.id === state.aimTargetId && e.hp > 0)
              : null;
            const target = locked
              ? { ...locked.pos }
              : {
                  x: state.player.pos.x + Math.cos(state.player.angle) * 350,
                  y: state.player.pos.y + Math.sin(state.player.angle) * 350,
                };
            state.entities.push(makeGrenade({ ...state.player.pos }, target));
          }
          if (pressed(4)) { state.activeWeaponSlot = 0; setActiveWeaponSlot(0); } // LB → weapon 1
          if (pressed(1)) {                                                        // B → weapon 2 / interact-cancel
            if (state.player.hp <= 0) doRespawn();
            else { state.activeWeaponSlot = 1; setActiveWeaponSlot(1); }
          }
          if (pressed(3)) doInteract();                       // Y → shop / casino
          if (pressed(8)) state.mapMode = ((state.mapMode + 1) % 3) as 0 | 1 | 2; // Minus/Back → map
          if (pressed(9)) { paused = !paused; setShowPause(paused); if (paused) setShowHelp(false); } // Plus/Start → pause
          if (padMoving || btn(0) || btn(7)) setShowHelp(false);

          for (let i = 0; i < gp.buttons.length; i++) prevPad[i] = btn(i);
        }
      }

      if (!paused) updateGame(state, input, dt);

      // Surface the "press E to shop" prompt when standing next to a trader
      if (state.nearShop !== lastNearShop) {
        lastNearShop = state.nearShop;
        setNearShop(state.nearShop);
        // Auto-close the shop if the player walks away from the trader
        if (!state.nearShop) setShowShop(null);
      }
      // Same for casino tables
      if (state.nearGame !== lastNearGame) {
        lastNearGame = state.nearGame;
        setNearGame(state.nearGame);
        if (!state.nearGame) setShowCasino(null);
      }

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
      window.removeEventListener("gamepadconnected", onPadConnect);
      window.removeEventListener("gamepaddisconnected", onPadDisconnect);
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

  // Pull spend-able state (wallet/ammo/consumables/upgrades) into React mirrors
  const syncShopState = () => {
    const s = stateRef.current;
    if (!s) return;
    setWallet(s.bankedMoney);
    setAmmo(s.ammo);
    setConsumables([...s.consumables]);
    setWeaponUpgrades({
      pistol: { ...s.weaponUpgrades.pistol },
      rifle: { ...s.weaponUpgrades.rifle },
      shotgun: { ...s.weaponUpgrades.shotgun },
    });
    setWeaponSlots([...s.weaponSlots] as [WeaponItem | null, WeaponItem | null]);
    setActiveWeaponSlot(s.activeWeaponSlot);
  };

  // Casino games bet/win against the player's banked caps
  const adjustBalance = (delta: number) => {
    const s = stateRef.current;
    if (!s) return;
    s.bankedMoney = Math.max(0, s.bankedMoney + delta);
    setWallet(s.bankedMoney);
  };

  const buyConsumable = (id: ConsumableId) => {
    const s = stateRef.current;
    if (!s) return;
    const def = CONSUMABLES[id];
    if (s.bankedMoney < def.price) return;
    s.bankedMoney -= def.price;
    const slot = s.consumables.find((c) => c.id === id);
    if (slot) slot.count++;
    else s.consumables.push({ id, count: 1 });
    syncShopState();
  };

  const buyAmmo = (rounds: number, price: number) => {
    const s = stateRef.current;
    if (!s) return;
    if (s.bankedMoney < price) return;
    s.bankedMoney -= price;
    s.ammo += rounds;
    syncShopState();
  };

  const buyUpgrade = (weaponId: WeaponId, kind: "damage" | "mag") => {
    const s = stateRef.current;
    if (!s) return;
    const up = s.weaponUpgrades[weaponId];
    const level = kind === "damage" ? up.damageLevel : up.magLevel;
    if (level >= MAX_UPGRADE_LEVEL) return;
    const cost = upgradeCost(kind === "damage" ? DAMAGE_UPGRADE_BASE : MAG_UPGRADE_BASE, level);
    if (s.bankedMoney < cost) return;
    s.bankedMoney -= cost;
    if (kind === "damage") up.damageLevel++;
    else up.magLevel++;
    syncShopState();
  };

  const useConsumable = (id: ConsumableId) => {
    const s = stateRef.current;
    if (!s) return;
    const slot = s.consumables.find((c) => c.id === id);
    if (!slot || slot.count <= 0) return;
    slot.count--;
    if (slot.count === 0) s.consumables.splice(s.consumables.indexOf(slot), 1);
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + CONSUMABLES[id].heal);
    setConsumables([...s.consumables]);
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
        {padConnected && (
          <p className="font-mono text-[10px] text-green-400">🎮 Controller connected</p>
        )}
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
                      <div className="text-muted-foreground mt-0.5">DMG {effectiveDamage(w, weaponUpgrades[w.id])} · {(1 / w.fireRate).toFixed(1)} rps · MAG {effectiveMag(w, weaponUpgrades[w.id])}</div>
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

          {/* Ammo reserve */}
          <div className="mb-3 flex items-center justify-between rounded border border-border bg-background/40 px-3 py-2 text-xs">
            <span className="tracking-wider text-muted-foreground">AMMO RESERVE</span>
            <span className="text-amber-300">🔸 {ammo} rounds</span>
          </div>

          {/* Medical items (bought from the medic) */}
          <div className="mb-3 rounded border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground mb-2 tracking-wider">MEDICAL</div>
            {consumables.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground">No medical items — buy some at the Medic (E)</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {consumables.map((item) => {
                  const def = CONSUMABLES[item.id];
                  return (
                    <button
                      key={item.id}
                      onClick={() => useConsumable(item.id)}
                      className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <span>{def.icon} {def.name}</span>
                      <span className="text-muted-foreground">×{item.count}</span>
                      <span className="text-green-400">{def.heal >= 9999 ? "FULL" : `+${def.heal} HP`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Food / consumables */}
          <div className="rounded border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground mb-2 tracking-wider">FOOD</div>
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
      {/* "Press E to shop" prompt */}
      {nearShop && !showShop && !showInventory && (
        <div className="pointer-events-none absolute left-1/2 bottom-24 -translate-x-1/2 rounded-md border border-primary bg-card/90 px-4 py-2 font-mono text-sm text-card-foreground shadow-lg backdrop-blur">
          <span className="text-accent">{nearShop === "health" ? "🩺 Medic" : "🔧 Gunsmith"}</span> — press <kbd className="rounded bg-muted px-1 text-primary">E</kbd> to {nearShop === "health" ? "buy meds" : "buy ammo & upgrades"}
        </div>
      )}

      {/* "Press E to play" casino prompt */}
      {nearGame && !showCasino && !showInventory && (
        <div className="pointer-events-none absolute left-1/2 bottom-24 -translate-x-1/2 rounded-md border border-yellow-500 bg-card/90 px-4 py-2 font-mono text-sm text-card-foreground shadow-lg backdrop-blur">
          <span className="text-yellow-400">🎰 {nearGame === "blackjack" ? "Blackjack" : nearGame === "roulette" ? "Roulette" : "Slots"}</span> — press <kbd className="rounded bg-muted px-1 text-primary">E</kbd> to play
        </div>
      )}

      {/* Casino overlay */}
      {showCasino && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-[96vw] max-h-[92vh] overflow-y-auto rounded-lg border border-yellow-700/60 bg-card/97 p-5 font-mono text-card-foreground shadow-2xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold tracking-widest text-yellow-400 uppercase">
              🎰 {showCasino === "blackjack" ? "Blackjack" : showCasino === "roulette" ? "Roulette" : "Slots"}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-amber-300">💰 {wallet} caps</span>
              <button
                onClick={() => setShowCasino(null)}
                className="rounded border border-border bg-background px-2 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Close (E)
              </button>
            </div>
          </div>
          {showCasino === "blackjack" && <Blackjack balance={wallet} adjustBalance={adjustBalance} />}
          {showCasino === "roulette" && <Roulette balance={wallet} adjustBalance={adjustBalance} />}
          {showCasino === "slots" && <Slots balance={wallet} adjustBalance={adjustBalance} />}
          <p className="mt-3 text-center text-[10px] text-muted-foreground">Bets use your banked caps · walk away or press E to leave</p>
        </div>
      )}

      {/* Shop overlay */}
      {showShop && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[540px] max-w-[96vw] rounded-lg border border-border bg-card/97 p-5 font-mono text-card-foreground shadow-2xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-bold tracking-widest text-primary uppercase">
              {showShop === "health" ? "🩺 Medic" : "🔧 Gunsmith"}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-amber-200">🔸 {ammo} ammo</span>
              <span className="text-amber-300">💰 {wallet} caps</span>
            </div>
          </div>
          <p className="mb-4 text-[10px] text-muted-foreground">Spends your banked caps. Bank loot by returning to the spawn town.</p>

          {showShop === "health" && (
            <div className="space-y-2">
              {(Object.values(CONSUMABLES)).map((def) => (
                <div key={def.id} className="flex items-center justify-between rounded border border-border bg-background/50 px-3 py-2 text-xs">
                  <div>
                    <span className="text-base">{def.icon} <span className="text-foreground">{def.name}</span></span>
                    <span className="ml-2 text-green-400">{def.heal >= 9999 ? "Full heal" : `+${def.heal} HP`}</span>
                  </div>
                  <button
                    disabled={wallet < def.price}
                    onClick={() => buyConsumable(def.id)}
                    className="rounded border border-primary bg-primary/10 px-3 py-1 text-primary transition-colors enabled:hover:bg-primary enabled:hover:text-primary-foreground disabled:opacity-40"
                  >
                    Buy · {def.price}💰
                  </button>
                </div>
              ))}
              <p className="pt-1 text-center text-[10px] text-muted-foreground">Use meds from your inventory (TAB) to heal.</p>
            </div>
          )}

          {showShop === "guns" && (
            <div className="space-y-4">
              {/* Ammo */}
              <div>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="tracking-wider text-muted-foreground">AMMO</span>
                  <span className="text-amber-300">Reserve: 🔸 {ammo}</span>
                </div>
                <div className="flex gap-2">
                  {AMMO_PACKS.map((pack) => (
                    <button
                      key={pack.rounds}
                      disabled={wallet < pack.price}
                      onClick={() => buyAmmo(pack.rounds, pack.price)}
                      className="flex-1 rounded border border-primary bg-primary/10 px-3 py-2 text-xs text-primary transition-colors enabled:hover:bg-primary enabled:hover:text-primary-foreground disabled:opacity-40"
                    >
                      {pack.label}<br /><span className="text-[10px]">{pack.price}💰</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Weapon upgrades */}
              <div>
                <div className="mb-2 text-xs tracking-wider text-muted-foreground">WEAPON UPGRADES</div>
                <div className="space-y-2">
                  {(Object.values(WEAPONS)).map((w) => {
                    const up = weaponUpgrades[w.id];
                    const dmgCost = upgradeCost(DAMAGE_UPGRADE_BASE, up.damageLevel);
                    const magCost = upgradeCost(MAG_UPGRADE_BASE, up.magLevel);
                    const dmgMaxed = up.damageLevel >= MAX_UPGRADE_LEVEL;
                    const magMaxed = up.magLevel >= MAX_UPGRADE_LEVEL;
                    return (
                      <div key={w.id} className="rounded border border-border bg-background/50 px-3 py-2 text-xs">
                        <div className="mb-1.5 text-foreground">{w.icon} {w.name}
                          <span className="ml-2 text-muted-foreground">DMG {effectiveDamage(w, up)} · MAG {effectiveMag(w, up)}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            disabled={dmgMaxed || wallet < dmgCost}
                            onClick={() => buyUpgrade(w.id, "damage")}
                            className="flex-1 rounded border border-border px-2 py-1 transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-40"
                          >
                            {dmgMaxed ? "DMG MAX" : `+${DAMAGE_PER_LEVEL} DMG · ${dmgCost}💰`}
                            <span className="ml-1 text-[9px] text-muted-foreground">L{up.damageLevel}/{MAX_UPGRADE_LEVEL}</span>
                          </button>
                          <button
                            disabled={magMaxed || wallet < magCost}
                            onClick={() => buyUpgrade(w.id, "mag")}
                            className="flex-1 rounded border border-border px-2 py-1 transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-40"
                          >
                            {magMaxed ? "MAG MAX" : `+${MAG_PER_LEVEL} MAG · ${magCost}💰`}
                            <span className="ml-1 text-[9px] text-muted-foreground">L{up.magLevel}/{MAX_UPGRADE_LEVEL}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowShop(null)}
            className="mt-4 w-full rounded border border-border bg-background px-4 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Close (E)
          </button>
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
              <div><span className="text-foreground">Shift</span> sprint (toggle)</div>
              <div><span className="text-foreground">Mouse</span> aim</div>
              <div><span className="text-foreground">Right click</span> aim-lock (slow)</div>
              <div><span className="text-foreground">Left click</span> shoot</div>
              <div><span className="text-foreground">1 / 2</span> swap weapon</div>
              <div><span className="text-foreground">3</span> throw grenade</div>
              <div><span className="text-foreground">M</span> map (mini → full → off)</div>
              <div><span className="text-foreground">E</span> shop / casino</div>
              <div><span className="text-foreground">TAB</span> inventory</div>
              <div><span className="text-foreground">R</span> respawn</div>
              {padConnected && (
                <div className="mt-2 border-t border-border pt-2 text-left text-[11px]">
                  <div className="mb-1 text-green-400">🎮 Controller</div>
                  <div>Left stick move · Right stick aim</div>
                  <div>RT/RB/A shoot · LT aim-lock (slow)</div>
                  <div>L3 sprint toggle · X grenade (while aiming)</div>
                  <div>LB/B weapon 1/2 · Y shop/casino</div>
                  <div>− map · + pause</div>
                </div>
              )}
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
