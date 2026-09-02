import type { Live2PetProject, ProjectTarget } from "./app-host";
import { isMappingDestination, type MappingDestination } from "./target-profiles";

export type RecipeSelection = { motionId: string; expressionId: string | null };

function recipeKey(selection: RecipeSelection): string {
  return `${selection.motionId}\u0000${selection.expressionId ?? ""}`;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function createRecipeId(document: Live2PetProject, selection: RecipeSelection): string {
  const prefix = `recipe-${shortHash(recipeKey(selection))}`;
  let candidate = prefix;
  let suffix = 2;
  while (document.recipes.some((recipe) => recipe.id === candidate)) candidate = `${prefix}-${suffix++}`;
  return candidate;
}

function mappingBucket(target: ProjectTarget, destination: MappingDestination): Record<string, string> {
  return destination.target === "clawd" && destination.category === "reactions" ? target.reactions : target.mappings;
}

function cloneTarget(target: ProjectTarget): ProjectTarget {
  return {
    ...target,
    mappings: { ...target.mappings },
    reactions: { ...target.reactions },
    recipeMappings: { ...target.recipeMappings },
    options: { ...target.options },
  };
}

export function assignSelectedRecipe(document: Live2PetProject, destination: MappingDestination, selection: RecipeSelection): Live2PetProject {
  if (!isMappingDestination(destination) || !selection.motionId.trim()) return document;
  const recipes = [...document.recipes];
  let recipe = recipes.find((item) => item.motionId === selection.motionId && item.expressionId === selection.expressionId);
  if (!recipe) {
    recipe = { id: createRecipeId(document, selection), motionId: selection.motionId, expressionId: selection.expressionId };
    recipes.push(recipe);
  }
  const currentTarget = document.targets[destination.target];
  const mapping = `motion:${selection.motionId}`;
  if (mappingBucket(currentTarget, destination)[destination.slot] === mapping && currentTarget.recipeMappings?.[destination.slot] === recipe.id) return document;
  const target = cloneTarget(currentTarget);
  mappingBucket(target, destination)[destination.slot] = mapping;
  target.recipeMappings = { ...target.recipeMappings, [destination.slot]: recipe.id };
  return { ...document, recipes, targets: { ...document.targets, [destination.target]: target } };
}

function referencedRecipeIds(document: Live2PetProject): Set<string> {
  return new Set(Object.values(document.targets).flatMap((target) => Object.values(target.recipeMappings ?? {})).filter(Boolean));
}

export function clearAssignment(document: Live2PetProject, destination: MappingDestination): Live2PetProject {
  if (!isMappingDestination(destination)) return document;
  const currentTarget = document.targets[destination.target];
  if (!Object.hasOwn(mappingBucket(currentTarget, destination), destination.slot) && !Object.hasOwn(currentTarget.recipeMappings ?? {}, destination.slot)) return document;
  const target = cloneTarget(currentTarget);
  delete mappingBucket(target, destination)[destination.slot];
  delete target.recipeMappings?.[destination.slot];
  const next = { ...document, targets: { ...document.targets, [destination.target]: target } };
  const referenced = referencedRecipeIds(next);
  return { ...next, recipes: next.recipes.filter((recipe) => referenced.has(recipe.id)) };
}
