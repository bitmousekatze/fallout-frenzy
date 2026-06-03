import { Entity } from "./types";
import { dist } from "./world";

interface PrmptedWindow extends Window {
  prmpted?: { unlock: (id: string) => void };
}

const w = window as PrmptedWindow;

function unlock(id: string) {
  if (unlocked.has(id)) return;
  unlocked.add(id);
  try { w.prmpted?.unlock(id); } catch (_) { /* iframe gone, ignore */ }
}

const unlocked = new Set<string>();

const KILL_TIERS: Array<[number, string]> = [
  [1, "first_kill"],
  [10, "kills_10"],
  [50, "kills_50"],
  [100, "kills_100"],
  [1_000, "kills_1k"],
  [10_000, "kills_10k"],
  [1_000_000, "kills_1m"],
];

const CASH_TIERS: Array<[number, string]> = [
  [1, "cash_1"],
  [100, "cash_100"],
  [1_000, "cash_1k"],
  [10_000, "cash_10k"],
  [1_000_000, "cash_1m"],
];

const CASINO_TIME_TIERS: Array<[number, string]> = [
  [60, "casino_1min"],
  [600, "casino_10min"],
  [3600, "casino_1hr"],
  [36_000, "casino_10hr"],
  [57_600, "casino_16hr"],
  [86_400, "casino_24hr"],
];

const STATION_INTERACT_RADIUS = 90;
const CASINO_DETECT_RADIUS = 250;

let prevKills = 0;
let totalCashEarned = 0;
let prevMoney = 0;
let prevBanked = 0;
let casinoSeconds = 0;

export interface AchievementTickInput {
  entities: Entity[];
  playerPos: { x: number; y: number };
  kills: number;
  money: number;        // currently carried cash
  bankedMoney: number;  // banked cash
}

export function tickAchievements(s: AchievementTickInput, dt: number) {
  // Kills: monotonic in state.kills
  if (s.kills > prevKills) {
    for (const [n, id] of KILL_TIERS) if (s.kills >= n) unlock(id);
    prevKills = s.kills;
  }

  // Cash earned cumulatively: money rises when picked up; on bank, money drops to 0 and banked rises.
  // We track positive deltas on (money + banked).
  const wallet = s.money + s.bankedMoney;
  const prevWallet = prevMoney + prevBanked;
  if (wallet > prevWallet) totalCashEarned += wallet - prevWallet;
  prevMoney = s.money;
  prevBanked = s.bankedMoney;
  for (const [n, id] of CASH_TIERS) if (totalCashEarned >= n) unlock(id);

  // Proximity-based station "use" + casino time
  let inCasino = false;
  for (const e of s.entities) {
    if (e.kind === "trader" && dist(e.pos, s.playerPos) < STATION_INTERACT_RADIUS) {
      if (e.traderType === "health") unlock("use_health_station");
      else if (e.traderType === "guns") unlock("use_guns_ammo_station");
    } else if (e.kind === "gambling" && dist(e.pos, s.playerPos) < CASINO_DETECT_RADIUS) {
      inCasino = true;
    }
  }
  if (inCasino) {
    casinoSeconds += dt;
    for (const [n, id] of CASINO_TIME_TIERS) if (casinoSeconds >= n) unlock(id);
  }
}

export function onGamblingWin() { unlock("gambling_win"); }
export function onGamblingLose() { unlock("gambling_lose"); }
