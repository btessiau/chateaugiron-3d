// Pure helpers for interpreting OpenStreetMap tags and geometry.
// Shared by the data fetch script and the renderer, and unit tested to 100%.

export const TAG_KEYS = [
  'building',
  'building:levels',
  'building:part',
  'height',
  'min_height',
  'roof:shape',
  'roof:height',
  'roof:levels',
  'roof:colour',
  'highway',
  'natural',
  'water',
  'waterway',
  'landuse',
  'leisure',
  'name',
  'layer',
  'bridge',
  'tunnel',
  'amenity',
  'historic',
];

const GREEN_LANDUSE = [
  'grass',
  'forest',
  'meadow',
  'recreation_ground',
  'village_green',
  'cemetery',
  'orchard',
  'farmland',
  'farmyard',
];
const GREEN_LEISURE = [
  'park',
  'garden',
  'pitch',
  'playground',
  'golf_course',
  'common',
  'nature_reserve',
];
const GREEN_NATURAL = ['wood', 'scrub', 'grassland'];

export function parseMeters(value) {
  if (value == null) return null;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function buildingHeight(tags) {
  let h = parseMeters(tags.height);
  if (h == null) {
    const levels = parseFloat(tags['building:levels']);
    if (!Number.isNaN(levels)) h = levels * 3.1 + 0.6;
  }
  if (h == null) h = 7.5;
  return Math.max(2.5, h);
}

export function baseHeight(tags) {
  const b = parseMeters(tags.min_height);
  return b == null ? 0 : b;
}

export function classify(tags) {
  if (tags.building && tags.building !== 'no') return 'building';
  if (tags['building:part'] && tags['building:part'] !== 'no') return 'building';
  if (tags.highway) return 'road';
  if (tags.natural === 'water' || tags.water || tags.waterway === 'riverbank') return 'water';
  if (
    GREEN_NATURAL.includes(tags.natural) ||
    GREEN_LANDUSE.includes(tags.landuse) ||
    GREEN_LEISURE.includes(tags.leisure)
  ) {
    return 'green';
  }
  return null;
}

export function trimTags(tags) {
  const out = {};
  for (const k of TAG_KEYS) {
    if (tags[k] != null) out[k] = tags[k];
  }
  return out;
}
