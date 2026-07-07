import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const USER_AGENT = 'chateaugiron-3d/1.0 (educational)';
const API = 'https://commons.wikimedia.org/w/api.php';
const OUT_DIR = 'public/textures/landmarks';
const MANIFEST_PATH = 'public/data/landmarks-photos.json';
const SLEEP_MS = 1500;
const THUMB_WIDTH = 1920;

const picks = {
  chateau_exterior: [
    ['chateau_facade_01.jpg', 'File:Façade avant château - Ville de Châteaugiron.JPG'],
    ['chateau_facade_02.jpg', 'File:Château de Châteaugiron - 10.jpg'],
    ['chateau_facade_03.jpg', 'File:Châteaugiron (35) Château Donjon.JPG'],
  ],
  church_exterior: [
    ['church_exterior_01.jpg', 'File:Église de Chateaugiron illuminée.jpg'],
    ['church_exterior_02.jpg', 'File:Châteaugiron église.jpg'],
    ['church_exterior_03.jpg', 'File:Eglise de Châteaugiron.JPG'],
  ],
  church_interior: [
    [
      'church_interior_nave_01.jpg',
      'File:Châteaugiron (35) Église Sainte-Marie-Madeleine - Intérieur - 03.jpg',
    ],
    [
      'church_interior_altar_01.jpg',
      'File:Châteaugiron (35) Église Sainte-Marie-Madeleine - Intérieur - Maître-autel - 01.jpg',
    ],
    [
      'church_interior_organ_01.jpg',
      'File:Châteaugiron (35) Église Sainte-Marie-Madeleine - Intérieur - Orgue.jpg',
    ],
  ],
  oldtown_facade: [
    ['oldtown_facade_01.jpg', 'File:Châteaugiron (35) Maison du chêne vert.jpg'],
    ['oldtown_facade_02.jpg', 'File:Maison en colombage à chateaugiron.JPG'],
    ['oldtown_facade_03.jpg', 'File:Châteaugiron (35) Vieille maison rue du porche.jpg'],
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function htmlToText(value = '') {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceUrl(title) {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_')).replace('%3A', ':')}`;
}

function imageUrlAndSize(info) {
  return {
    url: info.thumburl || info.url,
    w: info.thumbwidth || info.width,
    h: info.thumbheight || info.height,
  };
}

function isAllowedLicense(name = '') {
  const license = name.toLowerCase();
  if (!license) return false;
  if (
    license.includes('fair use') ||
    license.includes('non-free') ||
    license.includes('all rights reserved')
  )
    return false;
  return (
    license.includes('public domain') ||
    license === 'pd' ||
    license.startsWith('cc0') ||
    license.startsWith('cc by') ||
    license.startsWith('cc-by')
  );
}

async function api(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ ...params, format: 'json' });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        if (attempt === 5) throw new Error(`API returned non JSON: ${text.slice(0, 120)}`);
      }
    } else if (attempt === 5 || response.status !== 429) {
      throw new Error(`API request failed ${response.status}: ${url}`);
    }
    await sleep(SLEEP_MS * attempt * 2);
  }
  throw new Error(`API request failed: ${url}`);
}

async function imageInfo(title) {
  const json = await api({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: String(THUMB_WIDTH),
  });
  const page = Object.values(json.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`No imageinfo for ${title}`);
  return info;
}

function validateImage(buffer, filename) {
  if (buffer.length <= 10 * 1024)
    throw new Error(`${filename} is too small: ${buffer.length} bytes`);
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const ext = extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    if (!isJpeg) throw new Error(`${filename} is not a JPEG`);
    return;
  }
  if (ext === '.png') {
    if (!isPng) throw new Error(`${filename} is not a PNG`);
    return;
  }
  if (!isJpeg && !isPng) throw new Error(`${filename} is not a JPEG or PNG`);
}

async function download(url, filename) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      validateImage(buffer, filename);
      await writeFile(join(OUT_DIR, filename), buffer);
      return;
    }
    if (attempt === 5 || response.status !== 429)
      throw new Error(`Download failed ${response.status}: ${url}`);
    await sleep(SLEEP_MS * attempt * 2);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(
    basename(MANIFEST_PATH) === MANIFEST_PATH
      ? '.'
      : MANIFEST_PATH.slice(0, MANIFEST_PATH.lastIndexOf('/')),
    { recursive: true },
  );

  const manifest = {};
  for (const [category, files] of Object.entries(picks)) {
    manifest[category] = [];
    for (const [filename, title] of files) {
      await sleep(SLEEP_MS);
      const info = await imageInfo(title);
      const metadata = info.extmetadata ?? {};
      const license = htmlToText(metadata.LicenseShortName?.value);
      if (!isAllowedLicense(license))
        throw new Error(`Rejected ${title}, unsupported license: ${license || 'missing'}`);

      const image = imageUrlAndSize(info);
      await sleep(SLEEP_MS);
      await download(image.url, filename);

      manifest[category].push({
        file: `textures/landmarks/${filename}`,
        w: image.w,
        h: image.h,
        license,
        author: htmlToText(metadata.Artist?.value) || 'Unknown',
        source: sourceUrl(title),
        licenseUrl: htmlToText(metadata.LicenseUrl?.value),
      });
      console.log(`${category}: ${filename} <- ${title}`);
    }
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
