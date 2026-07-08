# Châteaugiron 3D

[![CI](https://github.com/btessiau/chateaugiron-3d/actions/workflows/ci.yml/badge.svg)](https://github.com/btessiau/chateaugiron-3d/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/btessiau/chateaugiron-3d/actions/workflows/deploy.yml/badge.svg)](https://github.com/btessiau/chateaugiron-3d/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Walk the real town of [Châteaugiron](https://en.wikipedia.org/wiki/Ch%C3%A2teaugiron) (Brittany, France) at true 1:1 scale, in your browser. The whole historic core is built automatically from free open data and rendered with three.js: real terrain relief, real slate and granite textures, pitched roofs, a walkable character in first or third person, and two landmarks you can step inside.

![Châteaugiron skyline rendered in the browser](docs/preview.png)

**Live demo:** https://btessiau.github.io/chateaugiron-3d/

## What it does

- Builds the medieval core from real map data: 5,000+ buildings, roads, the étang, green spaces, each building at its real height and position, projected to metres so distances are true 1:1.
- Drapes everything over real ground relief from IGN elevation, so the streets rise and fall the way the real town does.
- Skins the world with real CC0 photo textures: slate roofs, granite castle walls, cobblestone lanes, plus a real aerial photo on the ground.
- Gives buildings pitched slate roofs, stone chimneys, and lit windows, with a Breton palette.
- Lets you walk it in first or third person with a real human character, run, jump, sun, shadows, sky and reflective water.
- Two landmarks are enterable: the church of Sainte-Marie-Madeleine (stone nave, pews, altar, stained glass) and the château keep (spiral stair, arrow slits). Both hold real photos from Wikimedia Commons.
- Fills the streets with life: trees, grass, townsfolk, parked cars, street lamps, birds, and an ambient sound bed.
- Shows real street photographs in place (press `P`) from Panoramax, plus a minimap and compass.

Everything renders from committed data files, so it runs offline after `npm install`.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL, click **Enter Châteaugiron**, then:

| Key             | Action               |
| --------------- | -------------------- |
| `W` `A` `S` `D` | Move                 |
| Mouse           | Look                 |
| `Shift`         | Run                  |
| `Space`         | Jump                 |
| `V`             | First / third person |
| `P`             | Real photo here      |
| `M`             | Sound on / off       |
| `Esc`           | Release the mouse    |

To rebuild the map data (for example a larger radius):

```bash
npm run fetch-data 2500   # radius in metres around the château
```

## How it works

```
OpenStreetMap (Overpass)          IGN Géoplateforme (elevation, ortho)
        |  scripts/fetch-osm.mjs           |  scripts/fetch-elevation.mjs
        v                                  v
   public/data/*.json               heightfield + aerial photo
        |
        |  src/lib/*   pure maths, no three.js, unit tested to 100%
        |     geo.js        lon/lat  ->  metres (1:1)
        |     osm.js        tags, building height, feature class
        |     geometry.js   road ribbons, rings, bounds, doorways
        |     terrain.js    smooth heightfield sampling
        |     roof.js       oriented pitched roof from a footprint
        |     camera.js     first / third person camera maths
        |     collision.js  circle vs building push-out
        |     scatter.js    tree and grass placement
        |     sun.js  landmark.js  minimap.js  chimney.js  streetlamps.js  skin.js ...
        v
   src/render/*   three.js mesh building, player, HUD
        v
   three.js scene in the browser (src/main.js)
```

- `scripts/` fetches and trims the open data into committed JSON, so the app runs offline.
- `src/lib/` holds all pure, deterministic maths, with no three.js, unit tested to 100%.
- `src/render/` holds the three.js glue: world building, the character and the walk controller.
- `src/main.js` sets up the renderer, sun, shadows, sky, water, the HUD and the loop.

## Engineering

Quality is enforced, not optional.

- **100% unit coverage** on all pure logic in `src/lib/` (Vitest + v8), gated in CI and in the pre-commit hook. The three.js render layer is not unit tested; it is verified by a headless Chrome smoke render (`scripts/smoke.mjs`) that loads the built app, checks the scene builds with zero runtime errors, and writes the screenshot in this README.
- **Lint and format** with ESLint and Prettier, enforced in CI and pre-commit.
- **Pre-commit** runs lint-staged then the full coverage gate (Husky).
- **CI** runs lint, format check, coverage and build on every push and pull request.
- **Deploy** to GitHub Pages happens automatically on every push to `main`.

```bash
npm run check      # lint + format check + 100% coverage
npm run build      # production build
# then, with a preview server running (npm run preview) in another shell:
npm run smoke      # headless render check (needs Chrome + puppeteer-core)
```

## How it was built, layer by layer

The town stays complete and playable while fidelity rises layer by layer. Every layer is unit tested where it is pure logic, screenshot verified where it is rendering, then committed and auto-deployed. All sources are free and open.

- **A. Engineering foundation:** ESLint, Prettier, Vitest at 100% on `src/lib`, Husky pre-commit, CI, GitHub Pages deploy.
- **B. Terrain relief:** real elevation from the [IGN Géoplateforme altimetry API](https://geoservices.ign.fr) (RGE ALTI / LiDAR HD, Etalab licence), draping ground, buildings and roads onto real height.
- **C. Building realism:** pitched slate roofs, stone chimneys, a facade window shader, and a real [IGN ortho](https://geoservices.ign.fr) aerial photo on the ground.
- **D. Nature and materials:** instanced billboard trees, grass ground cover, a physical sky and sun, reflective water, tone mapping and fog.
- **E. Character and third person:** a CC0 rigged human (Quaternius) with idle, walk and run, and a first or third person toggle.
- **F. Collision and physics:** circle against building collision on a spatial grid, ground clamp to the terrain, jump.
- **G. Interiors:** authored interiors for the church and the château keep, with real landmark photos from [Wikimedia Commons](https://commons.wikimedia.org) and street level imagery from [Panoramax](https://panoramax.fr) (open, CC-BY-SA / Etalab).
- **H. Game polish:** minimap and compass, street lamps, parked cars, townsfolk, birds, an ambient sound bed, and real CC0 PBR textures (slate, granite, cobblestone) from [ambientCG](https://ambientcg.com) and [Poly Haven](https://polyhaven.com).
- **I. Live:** the Pages URL is headless rendered and checked for zero runtime errors on every deploy.

### The realism ceiling, honestly

This is as real as free data allows, not a survey grade digital twin. The ground is a free aerial photo at about 0.85 m per pixel, so away from the paved focal points it is soft up close. Building fronts are extruded from footprints, so they are flat boxes with textured walls, not modelled facades. There is no free source of straight on photos for every house, so real photos appear where they exist (the two landmarks, a few frontages, the street level markers), not on every wall.

## Data and licence

- Map data © OpenStreetMap contributors, licensed under the [ODbL](https://www.openstreetmap.org/copyright). The file in `public/data/` is derived from OpenStreetMap.
- Elevation and ortho imagery from IGN Géoplateforme, French open data (Etalab / Licence Ouverte).
- Tiling material textures from ambientCG, released under CC0.
- Street level and landmark photos from Panoramax and Wikimedia Commons, under CC-BY-SA or Etalab, attributed in-app.
- Code is released under the MIT licence. See `LICENSE`.

## Stack

- [three.js](https://threejs.org) for rendering
- [Vite](https://vitejs.dev) for the dev server and build
- [OpenStreetMap](https://www.openstreetmap.org) via the [Overpass API](https://overpass-api.de) for data
