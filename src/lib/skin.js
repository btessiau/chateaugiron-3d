// Some CC0 rigs ship without textures and set their "Skin" and "Face" materials
// to a near-black or flat white base colour, so bare arms, legs and heads render
// as black silhouettes. Give those materials a natural skin tone instead. Values
// are three.js linear-space RGB in the range 0 to 1, which is what a material
// colour holds. In sRGB this reads as about rgb(176, 137, 113), a warm mid tone.

export const SKIN_LINEAR = { r: 0.45, g: 0.26, b: 0.18 };

// Return the replacement tone for a material name, or null to leave it as is.
// Only skin, face, head and body are treated as skin. Clothing, hair and props
// keep their authored colours.
export function skinToneFor(name) {
  const n = String(name == null ? '' : name)
    .trim()
    .toLowerCase();
  if (n === 'skin' || n === 'face' || n === 'head' || n === 'body') {
    return { r: SKIN_LINEAR.r, g: SKIN_LINEAR.g, b: SKIN_LINEAR.b };
  }
  return null;
}
