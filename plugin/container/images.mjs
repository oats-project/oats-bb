// The images of a run prove what their names say only if two scenes of different states never
// produce the same image (the UX standard, section 5). → the groups of files in `directory` that are
// byte for byte the same image, each a sorted list of names; a group of one is no group.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function sameImages(directory) {
  const byHash = new Map();
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".png")).sort()) {
    const hash = createHash("sha256").update(readFileSync(join(directory, name))).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), name]);
  }
  return [...byHash.values()].filter((names) => names.length > 1);
}
