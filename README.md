# Fallout Frenzy

A 2D top-down survival shooter set in a nuclear wasteland. Fight zombies, loot ruins, hunt for food, and survive as long as you can across a procedurally generated 10,000×10,000 world — playable right in your browser.

**[Play now on GitHub Pages](https://bitmousekatze.github.io/fallout-frenzy/)**

---

## Gameplay

- Shoot zombies, dodge hordes, and scavenge ruined cities
- Hunt pigs and cows for food to heal
- Explore a massive procedurally generated map with named ruin areas, road networks, and scattered loot
- No save points — survive as long as you can

## Controls

| Input | Action |
|---|---|
| WASD / Arrow keys | Move |
| Mouse | Aim |
| Click / Space | Shoot |
| TAB | Open inventory |
| F | Eat food (while inventory is open) |
| R | Respawn after death |

---

## Tech Stack

Built entirely with browser-native tech — no game engine.

| Layer | Tool |
|---|---|
| Language | TypeScript 5.8 |
| Framework | React 18 |
| Build | Vite 5 |
| Rendering | Canvas 2D API |
| UI | shadcn/ui + Tailwind CSS |
| Package manager | Bun |

---

## Running Locally

```bash
# Install dependencies
bun install

# Start dev server
bun run dev
# → http://localhost:8080/fallout-frenzy/

# Production build
bun run build

# Run tests
bun run test
```

---

## Project Structure

```
src/
  game/
    types.ts     # Entity interfaces
    world.ts     # Procedural world generation
    update.ts    # Game loop: physics, AI, collisions, spawning
    render.ts    # Canvas rendering pipeline
    sprites.ts   # Sprite asset loader
  components/
    Game.tsx     # Main canvas component + HUD
  pages/
    Index.tsx
  assets/
    player/      # 8-directional walk cycle sprites (32×32)
```

---

## Current State (v0.1)

Core loop is fully playable. What's in:

- Procedural world with roads (Prim's MST + bezier curves) and ruin areas
- Zombie AI with aggro and attack ranges
- Inventory system with food drops and healing
- 8-directional animated player sprite
- Spatial grid collision for performance at scale

What's not in yet:

- Save / load
- Weapon variety
- Progression / leveling
- Sound and music

---

## License

MIT
