import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AvatarKind } from "@/game/types";
import catFront from "@/assets/player/front1.png";
import doggoFront from "@/assets/doggo/FrontWalk1.png";

const KILLS_KEY = "ff-total-kills";

export default function Lobby() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<AvatarKind>("cat");
  const totalKills = parseInt(localStorage.getItem(KILLS_KEY) ?? "0");

  const play = () => {
    if (!name.trim()) return;
    navigate("/play", { state: { name: name.trim(), avatar } });
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background font-mono">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card/90 p-8 shadow-2xl">

        <div className="text-center">
          <div className="text-3xl font-bold tracking-widest text-primary">FALLOUT</div>
          <div className="text-3xl font-bold tracking-widest text-accent">FRENZY</div>
          <div className="mt-1 text-xs text-muted-foreground">wasteland survival</div>
        </div>

        <div className="rounded border border-border bg-background/60 py-3 text-center">
          <div className="text-xs text-muted-foreground">LIFETIME KILLS</div>
          <div className="text-3xl font-bold tabular-nums text-primary">{totalKills.toLocaleString()}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">DISPLAY NAME</div>
          <input
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
            placeholder="enter your name..."
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && play()}
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">CHOOSE AVATAR</div>
          <div className="grid grid-cols-2 gap-3">
            {(["cat", "doggo"] as AvatarKind[]).map((av) => (
              <button
                key={av}
                onClick={() => setAvatar(av)}
                className={`flex flex-col items-center gap-2 rounded border px-4 py-4 transition-colors ${
                  avatar === av
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40"
                }`}
              >
                <img
                  src={av === "cat" ? catFront : doggoFront}
                  alt={av}
                  className="h-14 w-14 object-contain"
                  style={{ imageRendering: "pixelated" }}
                />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {av === "cat" ? "CAT" : "DOGGO"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={play}
          disabled={!name.trim()}
          className="w-full rounded border border-primary bg-primary/20 py-3 text-sm font-bold tracking-widest text-primary transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ENTER WASTELAND
        </button>
      </div>
    </div>
  );
}
