import { useState, useMemo, useEffect, useRef } from "react";

// Engine scraped from blackjack-play-demo (src/routes/blackjack.tsx).
// Adapted: removed TanStack route + GameNav, lifted balance to props, and added
// real wagering (deduct on deal/double, pay out on settle) using the player's caps.

type Card = {
  id: string;
  rank: string;
  suit: string;
  value: number;
  dealDelay?: number;
};
type Hand = {
  cards: Card[];
  doubled: boolean;
  faceDownIdx: number | null;
  done: boolean;
  wager: number;
  result?: "win" | "lose" | "push" | "bust" | "blackjack";
};

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [
  { r: "A", v: 11 }, { r: "2", v: 2 }, { r: "3", v: 3 }, { r: "4", v: 4 },
  { r: "5", v: 5 }, { r: "6", v: 6 }, { r: "7", v: 7 }, { r: "8", v: 8 },
  { r: "9", v: 9 }, { r: "10", v: 10 }, { r: "J", v: 10 }, { r: "Q", v: 10 }, { r: "K", v: 10 },
];

const NUM_DECKS = 6;
const RESHUFFLE_THRESHOLD = 20;

function buildShoe(): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (const s of SUITS) {
      for (const { r, v } of RANKS) {
        shoe.push({ id: `${d}-${s}-${r}-${Math.random().toString(36).slice(2, 7)}`, rank: r, suit: s, value: v });
      }
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function score(cards: Card[]) {
  let total = cards.reduce((s, c) => s + c.value, 0);
  let aces = cards.filter((c) => c.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function canSplit(h: Hand) {
  if (h.cards.length !== 2) return false;
  const [a, b] = h.cards;
  return a.rank === b.rank || (a.value === 10 && b.value === 10);
}

type Phase = "betting" | "player" | "dealer" | "done";

function CardView({ card, hidden, flipping }: { card: Card; hidden?: boolean; flipping?: boolean }) {
  const dealStyle = (!flipping && card.dealDelay)
    ? ({ animationDelay: `${card.dealDelay}ms` } as React.CSSProperties)
    : undefined;
  if (hidden) {
    return (
      <div
        className="w-16 h-24 shrink-0 rounded-lg border-2 border-border bg-muted flex items-center justify-center text-2xl text-muted-foreground animate-deal-in shadow-md"
        style={dealStyle}
      >
        🂠
      </div>
    );
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={`w-16 h-24 shrink-0 rounded-lg border-2 border-border bg-card relative shadow-md ${flipping ? "animate-card-flip" : "animate-deal-in"} ${red ? "text-destructive" : "text-foreground"}`}
      style={dealStyle}
    >
      <div className="absolute top-1 left-1.5 leading-none font-semibold">
        <div className="text-sm">{card.rank}</div>
        <div className="text-sm">{card.suit}</div>
      </div>
      <div className="absolute bottom-1 right-1.5 text-xl font-semibold leading-none">
        {card.suit}
      </div>
    </div>
  );
}

export default function Blackjack({ balance, adjustBalance }: { balance: number; adjustBalance: (delta: number) => void }) {
  const [shoe, setShoe] = useState<Card[]>(() => buildShoe());
  const [hands, setHands] = useState<Hand[]>([]);
  const [active, setActive] = useState(0);
  const [dealer, setDealer] = useState<Card[]>([]);
  const [phase, setPhase] = useState<Phase>("betting");
  const [message, setMessage] = useState("Set your bet and deal");
  const [bet, setBet] = useState(10);
  const [reshuffling, setReshuffling] = useState(false);
  const [handSlots, setHandSlots] = useState<[boolean, boolean, boolean]>([true, false, false]);
  const [dealerRevealed, setDealerRevealed] = useState<Set<string>>(new Set());
  const [flippingCards, setFlippingCards] = useState<Set<string>>(new Set());
  const reshuffleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => {
    if (reshuffleTimer.current) clearTimeout(reshuffleTimer.current);
    revealTimers.current.forEach(clearTimeout);
  }, []);

  function scheduleReveal(cardId: string, delay: number) {
    const t = setTimeout(() => {
      setFlippingCards((prev) => new Set([...prev, cardId]));
      setDealerRevealed((prev) => new Set([...prev, cardId]));
    }, delay);
    revealTimers.current.push(t);
  }

  const visibleDealerCards = useMemo(() => dealer.filter((c) => dealerRevealed.has(c.id)), [dealer, dealerRevealed]);
  const dealerScore = useMemo(() => score(visibleDealerCards), [visibleDealerCards]);
  const revealDoubled = phase === "done";

  function drawFromShoe(shoeArr: Card[], delay?: number): [Card, Card[]] {
    const next = [...shoeArr];
    const c = next.pop()!;
    return [{ ...c, dealDelay: delay }, next];
  }

  function doReshuffle(onDone?: () => void) {
    setReshuffling(true);
    reshuffleTimer.current = setTimeout(() => {
      setShoe(buildShoe());
      setReshuffling(false);
      onDone?.();
    }, 900);
  }

  // Pay out a settled hand. win = 2× wager back, blackjack = 2.5×, push = 1× (stake returned).
  function payoutFor(h: Hand): number {
    if (h.result === "blackjack") return Math.round(h.wager * 2.5);
    if (h.result === "win") return h.wager * 2;
    if (h.result === "push") return h.wager;
    return 0;
  }

  function startDealerTurn(currentShoe: Card[], currentHands: Hand[]) {
    setPhase("dealer");
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];

    let d = [...currentShoe];
    const anyAlive = currentHands.some((h) => score(h.cards) <= 21);
    const dl = [...dealer];

    const HOLE_REVEAL_AT = 700;
    const FACE_DOWN_WAIT = 1100;
    const POST_FLIP_GAP = 400;

    scheduleReveal(dl[1].id, HOLE_REVEAL_AT);
    let cursor = HOLE_REVEAL_AT + POST_FLIP_GAP;

    if (anyAlive) {
      while (score(dl) < 17) {
        const dealDelay = cursor;
        const flipAt = dealDelay + FACE_DOWN_WAIT;
        cursor = flipAt + POST_FLIP_GAP;

        const [c, rest] = drawFromShoe(d, dealDelay);
        dl.push(c);
        d = rest;
        scheduleReveal(c.id, flipAt);
      }
    }

    setDealer(dl);
    setShoe(d);

    const ds = score(dl);
    const settled = currentHands.map<Hand>((h) => {
      if (h.result === "blackjack") return h; // natural already settled
      const ps = score(h.cards);
      if (ps > 21) return { ...h, done: true, result: "bust" };
      if (ds > 21 || ps > ds) return { ...h, done: true, result: "win" };
      if (ps === ds) return { ...h, done: true, result: "push" };
      return { ...h, done: true, result: "lose" };
    });

    const totalReturn = settled.reduce((sum, h) => sum + payoutFor(h), 0);

    const wins = settled.filter((h) => h.result === "win" || h.result === "blackjack").length;
    const losses = settled.filter((h) => h.result === "lose" || h.result === "bust").length;
    const pushes = settled.filter((h) => h.result === "push").length;
    let msg = "";
    if (settled.length === 1) {
      const r = settled[0].result!;
      const p = payoutFor(settled[0]);
      msg = r === "win" ? `You win — +${p} caps 🎉`
        : r === "blackjack" ? `Blackjack! +${p} caps 🎉`
        : r === "bust" ? "Bust! Dealer wins"
        : r === "push" ? "Push — stake returned"
        : "Dealer wins";
    } else {
      msg = `Wins: ${wins} · Losses: ${losses} · Pushes: ${pushes} · +${totalReturn} caps`;
    }

    const lastFlipAt = cursor - POST_FLIP_GAP;
    const doneTimer = setTimeout(() => {
      setHands(settled);
      setPhase("done");
      setMessage(msg);
      if (totalReturn > 0) adjustBalance(totalReturn);
      if (d.length <= RESHUFFLE_THRESHOLD) {
        setTimeout(() => doReshuffle(), 600);
      }
    }, lastFlipAt + 600);
    revealTimers.current.push(doneTimer);
  }

  function advanceOrDealer(updatedHands: Hand[], currentShoe: Card[], fromIdx: number) {
    for (let i = fromIdx + 1; i < updatedHands.length; i++) {
      if (!updatedHands[i].done) {
        setActive(i);
        setHands(updatedHands);
        setShoe(currentShoe);
        setMessage(updatedHands.length > 1 ? `Playing hand ${i + 1}` : "Your move");
        return;
      }
    }
    setHands(updatedHands);
    setShoe(currentShoe);
    startDealerTurn(currentShoe, updatedHands);
  }

  function deal() {
    if (reshuffling) return;
    const NUM_HANDS = handSlots.filter(Boolean).length;
    const totalStake = bet * NUM_HANDS;
    if (bet <= 0 || totalStake > balance) {
      setMessage("Not enough caps for that bet");
      return;
    }
    adjustBalance(-totalStake);

    let d = [...shoe];
    const playerCards: Card[][] = Array.from({ length: NUM_HANDS }, () => []);
    const dealerCards: Card[] = [];
    let delay = 0;
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < NUM_HANDS; i++) {
        const [c, rest] = drawFromShoe(d, delay);
        playerCards[i].push(c);
        d = rest;
        delay += 120;
      }
      const [dc, rest] = drawFromShoe(d, delay);
      dealerCards.push(dc);
      d = rest;
      delay += 120;
    }
    const initialHands: Hand[] = playerCards.map((cards) => {
      const isBJ = score(cards) === 21;
      return {
        cards,
        doubled: false,
        faceDownIdx: null,
        done: isBJ,
        wager: bet,
        result: isBJ ? "blackjack" : undefined,
      };
    });
    setShoe(d);
    setDealer(dealerCards);
    setDealerRevealed(new Set([dealerCards[0].id]));
    setFlippingCards(new Set());
    const firstActive = initialHands.findIndex((h) => !h.done);
    setHands(initialHands);
    if (firstActive === -1) {
      setActive(0);
      setTimeout(() => startDealerTurn(d, initialHands), 600);
    } else {
      setActive(firstActive);
      setPhase("player");
      setMessage(NUM_HANDS > 1 ? `Playing hand ${firstActive + 1}` : "Your move");
    }
  }

  function hit() {
    const [c, rest] = drawFromShoe(shoe, 0);
    const updated = hands.map((h, i) => {
      if (i !== active) return h;
      const cards = [...h.cards, c];
      const s = score(cards);
      return { ...h, cards, done: s >= 21 };
    });
    const current = updated[active];
    if (current.done) {
      advanceOrDealer(updated, rest, active);
    } else {
      setHands(updated);
      setShoe(rest);
    }
  }

  function stand() {
    const updated = hands.map((h, i) => (i === active ? { ...h, done: true } : h));
    advanceOrDealer(updated, [...shoe], active);
  }

  function doubleDown() {
    const h = hands[active];
    if (h.cards.length !== 2) return;
    if (h.wager > balance) { setMessage("Not enough caps to double"); return; }
    adjustBalance(-h.wager);
    const [c, rest] = drawFromShoe(shoe, 0);
    const newCards = [...h.cards, c];
    const updated = hands.map((hh, i) =>
      i === active
        ? {
            ...hh,
            cards: newCards,
            doubled: true,
            wager: hh.wager * 2,
            faceDownIdx: null,
            done: true,
          }
        : hh,
    );
    advanceOrDealer(updated, rest, active);
  }

  function split() {
    const h = hands[active];
    if (!canSplit(h)) return;
    if (h.wager > balance) { setMessage("Not enough caps to split"); return; }
    adjustBalance(-h.wager);
    let d = [...shoe];
    const [c1, c2] = h.cards;
    const [na, da] = drawFromShoe(d, 0); d = da;
    const [nb, db] = drawFromShoe(d, 150); d = db;
    const handA: Hand = { cards: [c1, na], doubled: false, faceDownIdx: null, done: false, wager: h.wager };
    const handB: Hand = { cards: [c2, nb], doubled: false, faceDownIdx: null, done: false, wager: h.wager };
    const updated = [...hands];
    updated.splice(active, 1, handA, handB);
    setHands(updated);
    setShoe(d);
  }

  function reset() {
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    setHands([]);
    setDealer([]);
    setDealerRevealed(new Set());
    setFlippingCards(new Set());
    setActive(0);
    setPhase("betting");
    setMessage("Set your bet and deal");
  }

  const currentHand = hands[active];
  const canDouble = phase === "player" && currentHand && currentHand.cards.length === 2;
  const canSplitNow = phase === "player" && currentHand && canSplit(currentHand) && hands.length < 4;
  const numHands = handSlots.filter(Boolean).length;

  const resultColor = (result?: Hand["result"]) => {
    if (!result) return "";
    if (result === "win" || result === "blackjack") return "text-green-400";
    if (result === "bust" || result === "lose") return "text-destructive";
    return "text-muted-foreground";
  };

  return (
    <div>
      <section className="flex flex-col items-center mb-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 self-start">Dealer</h2>
        <div className="flex min-h-24">
          {dealer.length === 0
            ? <div className="w-16 h-24 rounded-lg border-2 border-dashed border-border opacity-30" />
            : dealer.map((c, i) => (
                <div key={c.id} style={{ marginLeft: i === 0 ? 0 : "-2.25rem" }}>
                  <CardView card={c} hidden={!dealerRevealed.has(c.id)} flipping={flippingCards.has(c.id)} />
                </div>
              ))
          }
        </div>
        <div className="mt-1 text-sm tabular-nums text-muted-foreground font-medium">
          {dealer.length === 0 ? "" : dealerScore || ""}
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">You</h2>

        {phase === "betting" && (
          <div className="flex justify-center gap-6">
            {([0, 1, 2] as const).map((i) => (
              <label key={i} className="flex flex-col items-center gap-2 cursor-pointer select-none group">
                <div
                  className={`w-14 h-20 rounded-lg border-2 transition-all flex items-center justify-center text-xl
                    ${handSlots[i]
                      ? "border-primary bg-primary/10 shadow-[0_0_12px_2px] shadow-primary/30"
                      : "border-border bg-muted/30 opacity-50 group-hover:opacity-70"}`}
                >
                  {handSlots[i] ? "✓" : ""}
                </div>
                <input
                  type="checkbox"
                  checked={handSlots[i]}
                  onChange={(e) => {
                    const next: [boolean, boolean, boolean] = [...handSlots] as [boolean, boolean, boolean];
                    next[i] = e.target.checked;
                    if (next.every((v) => !v)) return;
                    setHandSlots(next);
                  }}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            ))}
          </div>
        )}

        {phase !== "betting" && (
          <div className="flex justify-center gap-6 flex-wrap">
            {hands.map((h, i) => {
              const isActive = phase === "player" && i === active;
              return (
                <div key={i} className="flex flex-col items-center">
                  <div className={`relative rounded-xl p-2 transition-all ${isActive ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
                    <div className="flex min-h-24">
                      {h.cards.map((c, idx) => (
                        <div key={c.id} style={{ marginLeft: idx === 0 ? 0 : "-2.25rem" }}>
                          <CardView card={c} hidden={!revealDoubled && h.faceDownIdx === idx} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={`mt-1 text-sm tabular-nums font-semibold ${resultColor(phase === "done" ? h.result : undefined)}`}>
                    {score(h.cards)}
                    {h.result && phase === "done" && (
                      <span className="ml-1 text-xs font-normal">
                        {h.result === "blackjack" ? "BJ!" : h.result === "bust" ? "bust" : h.result === "win" ? "win" : h.result === "push" ? "push" : "lose"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="text-center text-base font-medium min-h-7 mb-3">
        {reshuffling ? "Reshuffling the shoe…" : message}
      </div>

      <div className="flex flex-col items-center gap-3">
        {phase === "betting" && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground">Bet / hand</label>
            <input
              type="number"
              min={1}
              value={bet}
              onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
              className="w-24 px-3 py-1.5 rounded-md border border-border bg-card text-sm"
            />
            <span className="text-xs text-muted-foreground">total {bet * numHands} caps</span>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {phase === "betting" && (
            <button
              onClick={deal}
              disabled={reshuffling || bet * numHands > balance}
              className="px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-40"
            >
              Deal
            </button>
          )}
          {phase === "player" && (
            <>
              <button onClick={hit} className="px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90">Hit</button>
              <button onClick={stand} className="px-6 py-2 rounded-md border border-border bg-card font-medium hover:bg-accent">Stand</button>
              <button onClick={doubleDown} disabled={!canDouble} className="px-6 py-2 rounded-md border border-border bg-card font-medium hover:bg-accent disabled:opacity-40">Double</button>
              <button onClick={split} disabled={!canSplitNow} className="px-6 py-2 rounded-md border border-border bg-card font-medium hover:bg-accent disabled:opacity-40">Split</button>
            </>
          )}
          {phase === "done" && (
            <button onClick={reset} disabled={reshuffling} className="px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-40">New Hand</button>
          )}
        </div>
      </div>
    </div>
  );
}
