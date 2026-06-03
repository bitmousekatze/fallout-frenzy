import { useState } from "react";

// Scraped from blackjack-play-demo (src/routes/slots.tsx), adapted to bet the
// player's banked caps instead of a local balance.

const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
const PAYOUTS: Record<string, number> = {
  "🍒": 5, "🍋": 8, "🔔": 12, "⭐": 20, "💎": 50, "7️⃣": 100,
};

export default function Slots({ balance, adjustBalance }: { balance: number; adjustBalance: (delta: number) => void }) {
  const [reels, setReels] = useState<string[]>(["🍒", "🍋", "🔔"]);
  const [bet, setBet] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [message, setMessage] = useState("Pull the lever!");

  function spin() {
    if (spinning || bet > balance || bet <= 0) return;
    setSpinning(true);
    adjustBalance(-bet);
    setMessage("Spinning...");

    let ticks = 0;
    const interval = setInterval(() => {
      setReels([
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      ]);
      ticks++;
      if (ticks > 15) {
        clearInterval(interval);
        const final = [
          SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        ];
        setReels(final);
        const [a, b, c] = final;
        if (a === b && b === c) {
          const win = bet * PAYOUTS[a];
          adjustBalance(win);
          setMessage(`Triple ${a}! You win ${win} caps!`);
        } else if (a === b || b === c || a === c) {
          const win = bet * 2;
          adjustBalance(win);
          setMessage(`Pair! You win ${win} caps`);
        } else {
          setMessage("No match — try again");
        }
        setSpinning(false);
      }
    }, 80);
  }

  return (
    <div>
      <div className="rounded-xl border-4 border-border bg-card p-6 mb-6">
        <div className="grid grid-cols-3 gap-3">
          {reels.map((s, i) => (
            <div
              key={i}
              className={`aspect-square rounded-lg bg-muted flex items-center justify-center text-6xl ${spinning ? "animate-pulse" : ""}`}
            >
              {s}
            </div>
          ))}
        </div>
      </div>

      <div className="text-center text-lg font-medium mb-6 min-h-7">{message}</div>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-muted-foreground">Bet</label>
        <input
          type="number"
          min={1}
          max={balance}
          value={bet}
          onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
          disabled={spinning}
          className="w-24 px-3 py-1.5 rounded-md border border-border bg-card text-sm"
        />
        <button
          onClick={spin}
          disabled={spinning || bet > balance}
          className="flex-1 py-3 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          {spinning ? "Spinning..." : "Spin"}
        </button>
      </div>

      <div className="text-xs text-muted-foreground">
        <div className="font-medium mb-1">Payouts (per 1 cap bet)</div>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(PAYOUTS).map(([s, p]) => (
            <div key={s}>{s}{s}{s} — {p}x</div>
          ))}
          <div className="col-span-3">Any pair — 2x</div>
        </div>
      </div>
    </div>
  );
}
