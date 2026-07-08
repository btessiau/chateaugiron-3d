// Fetch seamless CC0 PBR colour maps for the town materials and drop them in
// public/textures. All sources are CC0 1.0 (no attribution required):
//   - ambientCG   https://docs.ambientcg.com/license/  (zips, we keep _Color)
//   - Poly Haven  https://polyhaven.com/license         (direct jpg files)
// The maps are committed to the repo so the build has no runtime dependency on
// these services (Pages and CI stay offline-safe). Re-run only to refresh.
import { execSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = new URL('../public/textures/', import.meta.url);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ambientCG assets: download the 1K-JPG zip, keep the _Color map only.
const ambient = [
  { id: 'RoofingTiles001', out: 'roof-slate.jpg' }, // Breton grey-blue slate
  { id: 'PavingStones037', out: 'cobblestone.jpg' }, // herringbone old paving
];
// Poly Haven assets: direct 1K diffuse jpg, no zip.
const polyhaven = [
  { slug: 'beige_wall_001', out: 'plaster-wall.jpg' }, // cream rendered wall
  { slug: 'castle_wall_slates', out: 'castle-wall.jpg' }, // keep / chateau stone
];

async function save(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dest, buf);
  return buf.length;
}

for (const a of ambient) {
  const tmp = mkdtempSync(join(tmpdir(), 'acg-'));
  const zip = join(tmp, `${a.id}.zip`);
  const bytes = await save(`https://ambientcg.com/get?file=${a.id}_1K-JPG.zip`, zip);
  execSync(`unzip -o -q ${zip} -d ${tmp}`);
  const color = readdirSync(tmp).find((f) => /_Color\.jpg$/i.test(f));
  if (!color) throw new Error(`No _Color in ${a.id} (${bytes} bytes)`);
  copyFileSync(join(tmp, color), new URL(a.out, OUT));
  console.log(`ambientCG ${a.id} -> ${a.out} (${(bytes / 1e6).toFixed(1)} MB zip)`);
}

for (const p of polyhaven) {
  const url = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${p.slug}/${p.slug}_diff_1k.jpg`;
  const n = await save(url, new URL(p.out, OUT));
  console.log(`PolyHaven ${p.slug} -> ${p.out} (${(n / 1e3).toFixed(0)} KB)`);
}

console.log('Done. Textures in public/textures/.');
