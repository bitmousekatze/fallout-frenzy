import { useState, useRef } from "react";

// Scraped from blackjack-play-demo (src/routes/roulette.tsx). Adapted: lifted
// balance to props, dropped the fullscreen fireworks canvas, and implemented the
// `toggleBet` helper the original referenced but never defined.

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

function colorOf(n: number): "green" | "red" | "black" {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

type BetKey = string;

function betLabel(key: BetKey): string {
  if (key.startsWith("n:")) return `#${key.slice(2)}`;
  const labels: Record<string, string> = {
    red: "Red", black: "Black", even: "Even", odd: "Odd",
    low: "1–18", high: "19–36",
    "dozen:1": "1st 12", "dozen:2": "2nd 12", "dozen:3": "3rd 12",
    "col:1": "Col 1", "col:2": "Col 2", "col:3": "Col 3",
  };
  return labels[key] ?? key;
}

function betPayout(key: BetKey): number {
  if (key.startsWith("n:")) return 35;
  if (key.startsWith("dozen:") || key.startsWith("col:")) return 2;
  return 1;
}

function betWins(key: BetKey, result: number): boolean {
  if (result === 0) return key === "n:0";
  if (key.startsWith("n:")) return key === `n:${result}`;
  switch (key) {
    case "red": return colorOf(result) === "red";
    case "black": return colorOf(result) === "black";
    case "even": return result % 2 === 0;
    case "odd": return result % 2 === 1;
    case "low": return result >= 1 && result <= 18;
    case "high": return result >= 19 && result <= 36;
    case "dozen:1": return result >= 1 && result <= 12;
    case "dozen:2": return result >= 13 && result <= 24;
    case "dozen:3": return result >= 25 && result <= 36;
    case "col:1": return result % 3 === 1;
    case "col:2": return result % 3 === 2;
    case "col:3": return result % 3 === 0;
    default: return false;
  }
}

const CX = 140, CY = 140, OUTER_R = 134, INNER_R = 50, N = 37;

function sectorPath(i: number): string {
  const toRad = (deg: number) => (deg - 90) * Math.PI / 180;
  const s = toRad(i * 360 / N);
  const e = toRad((i + 1) * 360 / N);
  const x1 = CX + OUTER_R * Math.cos(s), y1 = CY + OUTER_R * Math.sin(s);
  const x2 = CX + OUTER_R * Math.cos(e), y2 = CY + OUTER_R * Math.sin(e);
  const ix1 = CX + INNER_R * Math.cos(s), iy1 = CY + INNER_R * Math.sin(s);
  const ix2 = CX + INNER_R * Math.cos(e), iy2 = CY + INNER_R * Math.sin(e);
  return `M ${ix1} ${iy1} L ${x1} ${y1} A ${OUTER_R} ${OUTER_R} 0 0 1 ${x2} ${y2} L ${ix2} ${iy2} A ${INNER_R} ${INNER_R} 0 0 0 ${ix1} ${iy1} Z`;
}

const SECTORS = WHEEL_ORDER.map((num, i) => {
  const midDeg = (i + 0.5) * 360 / N - 90;
  const midRad = midDeg * Math.PI / 180;
  const textR = (OUTER_R + INNER_R) / 2;
  return {
    num,
    path: sectorPath(i),
    color: num === 0 ? "#16a34a" : RED_NUMBERS.has(num) ? "#dc2626" : "#18181b",
    tx: CX + textR * Math.cos(midRad),
    ty: CY + textR * Math.sin(midRad),
    textAngle: (i + 0.5) * 360 / N,
  };
});

function RouletteWheel({ spinning, rotation, onTransitionEnd }: { spinning: boolean; rotation: number; onTransitionEnd: () => void }) {
  return (
    <div className="relative flex items-center justify-center">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 text-yellow-400 text-xl leading-none" style={{ marginTop: 2 }}>▼</div>
      <div
        style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none" }}
        onTransitionEnd={onTransitionEnd}
      >
        <svg width="280" height="280" viewBox="0 0 280 280">
          <circle cx={CX} cy={CY} r={OUTER_R + 4} fill="#b8960c" />
          <circle cx={CX} cy={CY} r={OUTER_R + 2} fill="#1c3a25" />
          {SECTORS.map((s) => (
            <g key={`${s.num}-${s.path}`}>
              <path d={s.path} fill={s.color} stroke="#d4af37" strokeWidth="1.2" />
              <text x={s.tx} y={s.ty} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="8" fontWeight="bold" transform={`rotate(${s.textAngle}, ${s.tx}, ${s.ty})`}>{s.num}</text>
            </g>
          ))}
          <circle cx={CX} cy={CY} r={INNER_R + 1} fill="#1c3a25" stroke="#d4af37" strokeWidth="2" />
          <circle cx={CX} cy={CY} r={INNER_R - 4} fill="#15803d" />
          <circle cx={CX} cy={CY} r={18} fill="#d4af37" />
          <circle cx={CX} cy={CY} r={7} fill="#18181b" />
        </svg>
      </div>
    </div>
  );
}

const TABLE_ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];

const CHIPS = [5, 10, 25, 50, 100] as const;

export default function Roulette({ balance, adjustBalance }: { balance: number; adjustBalance: (delta: number) => void }) {
  const [chipAmount, setChipAmount] = useState(10);
  const [bets, setBets] = useState<Map<BetKey, number>>(new Map());
  const [result, setResult] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [message, setMessage] = useState("Place bets, then spin!");
  const [wheelRotation, setWheelRotation] = useState(0);
  const pendingResult = useRef<number | null>(null);
  const pendingBets = useRef<Map<BetKey, number>>(new Map());

  const totalBet = Array.from(bets.values()).reduce((a, b) => a + b, 0);

  function placeBet(key: BetKey) {
    if (spinning) return;
    if (chipAmount <= 0 || chipAmount > balance - totalBet) return;
    setBets((prev) => {
      const next = new Map(prev);
      next.set(key, (next.get(key) ?? 0) + chipAmount);
      return next;
    });
  }

  // The demo referenced toggleBet without defining it: click removes the whole
  // stake on a zone if present, otherwise drops a chip.
  function toggleBet(key: BetKey) {
    if (spinning) return;
    if (bets.has(key)) {
      setBets((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } else {
      placeBet(key);
    }
  }

  function spin() {
    if (bets.size === 0 || spinning || totalBet > balance) return;
    adjustBalance(-totalBet);
    setSpinning(true);
    setResult(null);
    setMessage("No more bets…");

    const finalResult = Math.floor(Math.random() * 37);
    pendingResult.current = finalResult;
    pendingBets.current = new Map(bets);

    const resultIdx = WHEEL_ORDER.indexOf(finalResult);
    const pocketCenter = (resultIdx + 0.5) * 360 / N;
    const spins = 5 + Math.floor(Math.random() * 3);
    const targetOffset = (360 - (pocketCenter % 360) + 360) % 360;
    setWheelRotation((prev) => prev + spins * 360 + targetOffset);
  }

  function handleTransitionEnd() {
    if (!spinning) return;
    const finalResult = pendingResult.current!;
    const finalBets = pendingBets.current;

    setResult(finalResult);
    setSpinning(false);

    let winnings = 0;
    const winLabels: string[] = [];
    finalBets.forEach((amount, key) => {
      if (betWins(key, finalResult)) {
        winnings += amount * (betPayout(key) + 1);
        winLabels.push(`${betLabel(key)} (+${amount * betPayout(key)})`);
      }
    });

    if (winnings > 0) adjustBalance(winnings);

    const c = colorOf(finalResult);
    const cLabel = c === "red" ? "Red" : c === "black" ? "Black" : "Green";
    setMessage(winnings > 0 ? `${finalResult} ${cLabel} — ${winLabels.join(" · ")}` : `${finalResult} ${cLabel} — no win`);
    setBets(new Map());
  }

  const hasBet = (key: BetKey) => bets.has(key);
  const isResult = (n: number) => result === n;

  function numCellClass(n: number): string {
    const c = colorOf(n);
    const base = c === "red" ? "bg-red-600 hover:bg-red-500" : "bg-zinc-900 border border-zinc-700 hover:bg-zinc-800";
    const chip = hasBet(`n:${n}`) ? "ring-2 ring-yellow-300" : "";
    const win = isResult(n) ? "ring-4 ring-yellow-400 scale-110 z-10" : "";
    return `${base} ${chip} ${win} relative flex items-center justify-center text-white text-[10px] font-bold rounded cursor-pointer transition-all select-none h-8 flex-1`;
  }

  function outsideClass(key: BetKey, extra = ""): string {
    const chip = hasBet(key) ? "ring-2 ring-yellow-300" : "";
    return `${extra} ${chip} border border-emerald-500 text-white text-[10px] font-semibold cursor-pointer hover:brightness-110 transition-all select-none flex items-center justify-center py-1.5 rounded flex-1`;
  }

  const resultColor = result !== null ? colorOf(result) : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-col items-center gap-2">
        <RouletteWheel spinning={spinning} rotation={wheelRotation} onTransitionEnd={handleTransitionEnd} />
        {result !== null && (
          <div className={`text-2xl font-black px-5 py-1.5 rounded-xl shadow-lg ${
            resultColor === "red" ? "bg-red-600 text-white"
            : resultColor === "black" ? "bg-zinc-900 text-white border border-zinc-600"
            : "bg-emerald-600 text-white"}`}>
            {result}
          </div>
        )}
        <div className="text-xs text-center text-muted-foreground min-h-8 max-w-[340px]">{message}</div>
      </div>

      <div className="w-full space-y-3">
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-xs text-muted-foreground shrink-0">Chip:</span>
          {CHIPS.map((v) => (
            <button
              key={v}
              onClick={() => setChipAmount(v)}
              className={`w-9 h-9 rounded-full border-2 text-[10px] font-bold transition-all ${
                chipAmount === v
                  ? "border-yellow-400 bg-yellow-400/20 text-yellow-400 shadow-[0_0_10px_2px] shadow-yellow-400/30"
                  : "border-border bg-card text-foreground hover:border-yellow-400/50"}`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="bg-emerald-900 rounded-xl p-2 border-2 border-yellow-800 shadow-2xl">
          <div className="flex gap-1">
            <button
              onClick={() => placeBet("n:0")}
              className={`shrink-0 w-8 rounded text-white text-xs font-bold bg-emerald-600 hover:bg-emerald-500 transition-all select-none flex items-center justify-center
                ${hasBet("n:0") ? "ring-2 ring-yellow-300" : ""} ${isResult(0) ? "ring-4 ring-yellow-400" : ""}`}
              style={{ writingMode: "vertical-rl", height: "104px" }}
            >
              0
            </button>
            <div className="flex-1 flex flex-col gap-1">
              {TABLE_ROWS.map((row, ri) => (
                <div key={ri} className="flex gap-1">
                  {row.map((n) => (
                    <button key={n} onClick={() => placeBet(`n:${n}`)} className={numCellClass(n)}>
                      {n}
                      {hasBet(`n:${n}`) && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-yellow-400 text-black text-[8px] font-black flex items-center justify-center leading-none">
                          {bets.get(`n:${n}`)! >= 100 ? "C" : bets.get(`n:${n}`)}
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    onClick={() => toggleBet(`col:${3 - ri}`)}
                    className={`shrink-0 w-10 rounded text-white text-[10px] font-semibold bg-emerald-700 border border-emerald-500 hover:brightness-110 transition-all select-none flex items-center justify-center
                      ${hasBet(`col:${3 - ri}`) ? "ring-2 ring-yellow-300" : ""}`}
                  >
                    2:1
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-1 mt-1 ml-9">
            {(["dozen:1", "dozen:2", "dozen:3"] as const).map((key, i) => (
              <button key={key} onClick={() => toggleBet(key)} className={outsideClass(key, "bg-emerald-700")}>
                {["1st 12", "2nd 12", "3rd 12"][i]}
              </button>
            ))}
            <div className="w-10 shrink-0" />
          </div>

          <div className="flex gap-1 mt-1 ml-9">
            {(["low", "even", "red", "black", "odd", "high"] as const).map((key) => {
              const colors: Record<string, string> = { red: "bg-red-600", black: "bg-zinc-900 border-zinc-600" };
              const labels: Record<string, string> = { low: "1–18", even: "Even", red: "Red", black: "Black", odd: "Odd", high: "19–36" };
              return (
                <button key={key} onClick={() => toggleBet(key)} className={outsideClass(key, colors[key] ?? "bg-emerald-700")}>
                  {labels[key]}
                </button>
              );
            })}
            <div className="w-10 shrink-0" />
          </div>

          {bets.size > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from(bets.entries()).map(([key, amt]) => (
                <button
                  key={key}
                  onClick={() => toggleBet(key)}
                  className="px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300 text-[10px] font-semibold border border-yellow-400/40 hover:bg-red-900/30 hover:border-red-400/40 hover:text-red-300 transition-colors"
                  title="Click to remove"
                >
                  {betLabel(key)} {amt} ×
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => !spinning && setBets(new Map())}
            disabled={spinning || bets.size === 0}
            className="px-3 py-2 rounded-md border border-border bg-card font-medium text-xs disabled:opacity-40 hover:bg-muted transition-colors"
          >
            Clear
          </button>
          <button
            onClick={spin}
            disabled={spinning || bets.size === 0}
            className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {spinning ? "Spinning…" : `Spin${totalBet > 0 ? ` — ${totalBet} caps` : ""}`}
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground">Straight <strong>35:1</strong> · Dozen/Column <strong>2:1</strong> · Red/Black/Even/Odd/Half <strong>1:1</strong></p>
      </div>
    </div>
  );
}
