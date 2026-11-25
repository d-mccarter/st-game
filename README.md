# Starfleet Tactics

Simplified graphical **Starfleet Battles** you can open as a webpage (desktop or iPhone).

**Repo:** https://github.com/d-mccarter/st-game  
**Pages:** https://d-mccarter.github.io/st-game/ (enable Pages once — see below)

## What’s in v1

1. **Setup** — starting points, faction, map type, custom rules, fleet builder  
2. **Isometric board** — diamond-tile map (void / asteroids / nebula)  
3. **Two factions × two ships** — Federation Constitution & Miranda; Klingon D7 & F5  
4. **Tap / click movement** — legal move hexes highlight when your ship is selected; ships glide between hexes and weapons fire with beam/bolt FX  

5. **Ship intel** — hull, shields, weapons; firing arcs drawn on the board  

## How to play

1. Configure the match and spend points on ships → **Engage**  
2. Tap your active ship — cyan hexes show legal moves  
3. Tap a cyan hex to move  
4. Tap a weapon in the side panel to show its firing arc; red hexes are valid targets  
5. Tap an enemy / red hex to fire · press **End** to finish that ship’s activation  

## Local

```bash
npx --yes serve .
```

## Enable GitHub Pages (once)

1. https://github.com/d-mccarter/st-game/settings/pages  
2. **Deploy from a branch** → `main` / `/ (root)` → Save  
