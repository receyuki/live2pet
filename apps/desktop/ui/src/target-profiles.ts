import * as clawdProfileModule from "@live2pet/clawd-target/profile";
import * as codexPetProfileModule from "@live2pet/codex-target/profile";

type BrowserTargetProfiles = {
  clawd?: typeof clawdProfileModule.default;
  codexPet?: typeof codexPetProfileModule.default;
};

const browserProfiles = (globalThis as typeof globalThis & { Live2PetTargetProfiles?: BrowserTargetProfiles }).Live2PetTargetProfiles;
const clawdProfile = clawdProfileModule.default ?? browserProfiles?.clawd;
const codexPetProfile = codexPetProfileModule.default ?? browserProfiles?.codexPet;

if (!clawdProfile || !codexPetProfile) throw new Error("Live2Pet target profiles are unavailable.");

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
