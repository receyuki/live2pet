import clawdProfile from "@live2pet/clawd-target/profile";
import codexPetProfile from "@live2pet/codex-target/profile";

export type MappingDestination =
  | { target: "clawd"; category: "states" | "reactions"; slot: string }
  | { target: "codex-pet"; category: "rows"; slot: string };

export function isMappingDestination(destination: MappingDestination): boolean {
  if (destination.target === "clawd") {
    return destination.category === "states"
      ? clawdProfile.states.all.includes(destination.slot)
      : clawdProfile.reactions.includes(destination.slot);
  }
  return destination.category === "rows" && codexPetProfile.rowIds.includes(destination.slot);
}

export { clawdProfile, codexPetProfile };
export const CLAWD_PROFILE = clawdProfile;
export const CODEX_PROFILE = codexPetProfile;
