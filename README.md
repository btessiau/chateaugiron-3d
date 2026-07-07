# Châteaugiron 3D

Walk the real town of [Châteaugiron](https://en.wikipedia.org/wiki/Ch%C3%A2teaugiron) (Brittany, France) at true 1:1 scale, in your browser. This is **V0**: the whole historic core built automatically from free OpenStreetMap data and rendered with three.js.

![Châteaugiron skyline rendered in the browser](docs/preview.png)

**Live demo:** https://btessiau.github.io/chateaugiron-3d/

## What V0 does

- Loads real map data around the medieval château (5,000+ buildings, roads, the étang, green spaces).
- Extrudes every building to its real height (from OSM `height` or `building:levels`).
- Projects everything to metres on a plane centred on the château, so distances are real 1:1.
- Lets you walk it in first person with sun, shadows, sky and fog.

Everything renders from one committed data file, so it runs offline after `npm install`.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL, click **Enter Châteaugiron**, then:

| Key             | Action            |
| --------------- | ----------------- |
| `W` `A` `S` `D` | Move              |
| Mouse           | Look              |
| `Shift`         | Run               |
| `Esc`           | Release the mouse |

To rebuild the map data (for example a larger radius):

```bash
npm run fetch-data 2500   # radius in metres around the château
```

## How it works

```
OpenStreetMap (Overpass API)
        |  scripts/fetch-osm.mjs   (uses src/lib/osm.js)
        v
public/data/chateaugiron.json   (buildings, roads, water, green)
        |  src/lib/geo.js       lon/lat  ->  metres (1:1)
        |  src/lib/geometry.js  road ribbons, ring + bounds maths
        |  src/lib/spawn.js     pick an open spawn point
        |  src/render/world.js  extrude buildings, water, greens (three.js)
        |  src/render/controls.js  first-person walk
        v
   three.js scene in the browser (src/main.js)
```

- `scripts/fetch-osm.mjs` queries the Overpass API and writes a trimmed JSON.
- `src/lib/` holds all pure maths, with no three.js, unit tested to 100%.
  - `geo.js` converts longitude and latitude to local metres, +X east, +Z north.
  - `osm.js` reads OSM tags (building height, feature class).
  - `geometry.js` builds road ribbons and footprint bounds.
  - `spawn.js` picks an open spot to start.
- `src/render/` holds the three.js glue: mesh building and the walk controller.
- `src/main.js` sets up the renderer, sun, shadows, sky, the HUD and the loop.

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

## Scope and roadmap

V0 is the fast, free base layer. The town stays complete and playable while fidelity rises layer by layer. All sources are free and open.

- **A. Engineering foundation (done):** ESLint, Prettier, Vitest at 100% on `src/lib`, Husky pre-commit, CI, GitHub Pages deploy.
- **B. Terrain relief:** real elevation from the [IGN Géoplateforme altimetry API](https://geoservices.ign.fr) (RGE ALTI / LiDAR HD, Etalab licence), draping ground and buildings onto real height.
- **C. Building realism:** pitched roofs, facade textures with window rows, roof materials. Tiling CC0 PBR from [ambientCG](https://ambientcg.com); real roofs from [IGN ortho](https://geoservices.ign.fr) aerial imagery.
- **D. Nature and materials:** instanced trees, sky dome, water shader, tone mapping.
- **E. Character and third person:** rigged glTF avatar with a first and third person toggle.
- **F. Collision and physics:** capsule collision against buildings, ground clamp, jump.
- **G. Interiors:** OSM indoor data where present, plus authored interiors for the château, church and mairie. Landmark reference photos from [Wikimedia Commons](https://commons.wikimedia.org) and street level imagery from [Panoramax](https://panoramax.fr) (open, CC-BY-SA / Etalab).
- **H. Game polish:** minimap, day cycle, loading screen, performance work.
- **I. Final:** validate the live Pages URL and write the report.

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
