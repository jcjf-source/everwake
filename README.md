# Everwake

A turn-based, hex-grid exploration roguelite for the browser. You set out from a sanctuary into a persistent, seeded world, map it, take risks, and return (or die) wiser.

**Status:** early prototype. The current build generates a seeded terrain map (water, rivers, forests, hills, mountains, and more) with a sanctuary near the centre. Pan by dragging and zoom with the mouse wheel, pinch, or the + / − buttons. You start at the sanctuary. Tap a neighbouring hex to step onto it; tap a farther hex to preview a route (the readout gives its length and terrain cost), then tap it again to travel there one hex at a time. Tap during travel to stop (tap the destination again to resume), or tap another hex to retarget; **Escape** also stops or clears a route. Impassable and cut-off hexes are explained instead. The centre button recentres on you. The **Seed** button shows the world seed and creates a new world from a typed or random seed. The seed is kept in the URL (`?seed=…`), so reloading or sharing the link reopens the same world. Turns, fog of war and everything else are still to come. See [docs/ROADMAP.md](docs/ROADMAP.md) for progress.

## Tech

- Plain HTML, CSS, and JavaScript (ES modules) with Canvas 2D.
- No framework, no build step, no runtime dependencies.
- Static files only, so it can be hosted on GitHub Pages.

## Run locally

ES modules don't load from `file://` URLs, so serve the folder over HTTP.

**With Node.js 18+ (no install step):**

```sh
npm start            # serves on http://localhost:8080/
node tools/serve.mjs 3000   # or choose a port
```

**Any other static server works too**, for example:

```sh
python -m http.server 8080
npx serve .
```

Then open the printed URL in your browser.

## Tests

```sh
npm test
```

This runs the unit tests in `tests/` with Node's built-in test runner (`node --test`). There is nothing to install.

**Browser checks** (need Node 22+ and Google Chrome; set `CHROME_PATH` if Chrome is elsewhere):

```sh
npm run check:browser        # end-to-end check in headless Chrome; pass a folder to save screenshots:
node tools/browser/check-world.mjs shots
npm run perf                 # frame times while dragging; add -- --profile for hot functions
```

Set `VIEWPORT=phone-390` (any viewport-name fragment) to run the check on one viewport. Each script starts its own dev server (port 8137) and a throwaway headless Chrome, then closes only those.

## Deploy to GitHub Pages

The site is the repository root as-is. Every asset path is relative, so it works under a project subpath such as `https://<user>.github.io/everwake/`.

1. Push the repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose your branch (e.g. `main`) and the **`/ (root)`** folder, then **Save**.
5. Wait for the Pages build to finish (see the **Actions** tab), then open the URL shown on the Pages settings screen.

A `.nojekyll` file at the root tells Pages to serve files as they are, without Jekyll processing.

## Project layout

```
index.html            App entry point
favicon.svg
css/main.css          Layout, palette, and responsive styles
src/main.js           Bootstrap: installs error reporting, then loads modules
src/core/             Core services (error panel, seeded PRNG, cosmetic hashes)
src/entities/         Player state
src/systems/          Movement rules and stepwise travel
src/data/             Terrain definitions (gameplay properties)
src/world/            Hex geometry, A* pathfinding, seeds, noise, terrain generation, world + sanctuary, fog of war / map memory
src/render/           Canvas sizing, camera, view transform, terrain, player and route drawing
src/ui/               Pointer input, tap intent, HUD (readout, status, zoom, Coords), seed dialog, Map dialog
tests/                Unit tests (node --test)
tools/serve.mjs       Zero-dependency local dev server
tools/browser/        Headless-Chrome checks and frame-time benchmark (CDP)
docs/                 Design, roadmap, technical notes, task files
```

## Error reporting

Uncaught errors, unhandled promise rejections, and startup and render failures appear in an on-screen panel, which helps on mobile where there's no console. The errors are still logged to the browser console. **Dismiss** clears the panel.

## Documentation

- [Game design](docs/GAME_DESIGN.md)
- [Roadmap](docs/ROADMAP.md)
- [Technical notes](docs/TECHNICAL.md)
- [AI development rules](docs/AI_RULES.md)
- [Changelog](docs/CHANGELOG.md)
