import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AvatarKind } from "@/game/types";
import { loginAccount, createAccount, type Account } from "@/lib/accounts";
import catFront from "@/assets/player/front1.png";
import doggoFront from "@/assets/doggo/FrontWalk1.png";

type Mode = "login" | "register";

export default function Lobby() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<AvatarKind>("cat");
  const [error, setError] = useState("");
  const [account, setAccount] = useState<Account | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
  };

  const handleLogin = () => {
    setError("");
    const result = loginAccount(username.trim(), password);
    if ("error" in result) { setError(result.error); return; }
    setAccount(result);
  };

  const handleRegister = () => {
    setError("");
    const result = createAccount(username.trim(), password, displayName.trim() || username.trim());
    if ("error" in result) { setError(result.error); return; }
    setAccount(result);
    setMode("login");
  };

  const play = () => {
    if (!account) return;
    localStorage.setItem("ff-session", JSON.stringify({ username: account.username, avatar }));
    navigate("/play", { state: { account, avatar } });
  };

  if (account) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background font-mono">
        <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card/90 p-8 shadow-2xl">
          <div className="text-center">
            <div className="text-3xl font-bold tracking-widest text-primary">FALLOUT</div>
            <div className="text-3xl font-bold tracking-widest text-accent">FRENZY</div>
          </div>

          <div className="rounded border border-border bg-background/60 p-4 space-y-2">
            <div className="text-center text-sm font-bold text-primary tracking-wider">{account.displayName}</div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs text-muted-foreground">
              <div>
                <div className="text-2xl font-bold tabular-nums text-foreground">{account.kills.toLocaleString()}</div>
                <div>KILLS</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums text-yellow-400">${account.money.toLocaleString()}</div>
                <div>Cash</div>
              </div>
            </div>
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
            className="w-full rounded border border-primary bg-primary/20 py-3 text-sm font-bold tracking-widest text-primary transition-colors hover:bg-primary/30"
          >
            ENTER WASTELAND
          </button>
          <button
            onClick={() => setAccount(null)}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            switch account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background font-mono">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card/90 p-8 shadow-2xl">
        <div className="text-center">
          <div className="text-3xl font-bold tracking-widest text-primary">FALLOUT</div>
          <div className="text-3xl font-bold tracking-widest text-accent">FRENZY</div>
          <div className="mt-1 text-xs text-muted-foreground">wasteland survival</div>
        </div>

        <div className="flex rounded border border-border overflow-hidden text-xs font-bold tracking-wider">
          <button
            onClick={() => switchMode("login")}
            className={`flex-1 py-2 transition-colors ${mode === "login" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            LOGIN
          </button>
          <button
            onClick={() => switchMode("register")}
            className={`flex-1 py-2 transition-colors ${mode === "register" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            REGISTER
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">USERNAME</div>
            <input
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
              placeholder="username..."
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? handleLogin() : handleRegister())}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">PASSWORD</div>
            <input
              type="password"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
              placeholder="password..."
              maxLength={64}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? handleLogin() : handleRegister())}
            />
          </div>
          {mode === "register" && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">DISPLAY NAME <span className="text-muted-foreground/50">(optional)</span></div>
              <input
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
                placeholder="shown to other players..."
                maxLength={16}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="rounded border border-accent/50 bg-accent/10 px-3 py-2 text-xs text-accent text-center">
            {error}
          </div>
        )}

        <button
          onClick={mode === "login" ? handleLogin : handleRegister}
          disabled={!username.trim() || !password}
          className="w-full rounded border border-primary bg-primary/20 py-3 text-sm font-bold tracking-widest text-primary transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mode === "login" ? "LOGIN" : "CREATE ACCOUNT"}
        </button>
      </div>
    </div>
  );
}
