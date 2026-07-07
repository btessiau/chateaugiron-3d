// Resolve which animation clip on a model to play for a logical state. Models
// from different tools name their clips differently, for example "Walk",
// "Walking", or "CharacterArmature|Walk". Given the clip names a model actually
// has and a list of acceptable aliases, return the real clip name to play, or
// null when none fit. An exact alias wins first. Otherwise a clip whose base
// name, the part after the last "|" or ":", equals an alias without regard to
// case is used, so rigs exported by Blender, Mixamo, or Quaternius all work.
export function resolveClip(available, aliases) {
  for (const a of aliases) {
    if (available.includes(a)) return a;
  }
  const baseName = (n) => n.slice(Math.max(n.lastIndexOf('|'), n.lastIndexOf(':')) + 1);
  const wanted = aliases.map((a) => a.toLowerCase());
  for (const name of available) {
    if (wanted.includes(baseName(name).toLowerCase())) return name;
  }
  return null;
}
