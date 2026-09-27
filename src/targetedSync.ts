import type { DecisionTypeForMixedEntity, MixedEntity } from "./baseTypes";

export type TargetedPushSide = "local" | "remote";
export type TargetedPushChoice = "newest" | "force-local" | "cancel";

export type TargetedPushConflict = {
  readonly localMtime: number | undefined;
  readonly remoteMtime: number | undefined;
  readonly recommendedSide: TargetedPushSide;
};

export type TargetedSyncRequest = {
  readonly path: string;
  readonly resolveConflict: (
    conflict: TargetedPushConflict
  ) => Promise<TargetedPushChoice>;
};

export class TargetedSyncPathError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`The selected file is not eligible for sync: ${path}`);
    this.name = "TargetedSyncPathError";
    this.path = path;
  }
}

const REMOTE_DECISIONS = new Set<DecisionTypeForMixedEntity>([
  "remote_is_modified_then_pull",
  "remote_is_created_then_pull",
  "conflict_created_then_keep_remote",
  "conflict_modified_then_keep_remote",
]);

const CONFLICT_DECISIONS = new Set<DecisionTypeForMixedEntity>([
  "conflict_created_then_keep_local",
  "conflict_created_then_keep_remote",
  "conflict_created_then_smart_conflict",
  "conflict_created_then_do_nothing",
  "conflict_modified_then_keep_local",
  "conflict_modified_then_keep_remote",
  "conflict_modified_then_smart_conflict",
]);

const REMOTE_FOLDER_CREATION_DECISIONS = new Set<DecisionTypeForMixedEntity>([
  "folder_existed_local_then_also_create_remote",
  "folder_to_be_created",
]);

const getEntityMtime = (entity: MixedEntity["local"]): number | undefined => {
  if (entity === undefined) return undefined;
  return entity.mtimeCli ?? entity.mtimeSvr;
};

export const selectTargetedSyncPlan = (
  plan: Readonly<Record<string, MixedEntity>>,
  targetPath: string
): Record<string, MixedEntity> => {
  const result: Record<string, MixedEntity> = {};
  for (const [key, value] of Object.entries(plan)) {
    const isTarget = key === targetPath;
    const isParentFolder =
      key.endsWith("/") &&
      targetPath.startsWith(key) &&
      value.decision !== undefined &&
      REMOTE_FOLDER_CREATION_DECISIONS.has(value.decision);
    if (isTarget || isParentFolder) result[key] = value;
  }
  return result;
};

export const getTargetedPushConflict = (
  target: MixedEntity
): TargetedPushConflict | undefined => {
  const decision = target.decision;
  if (
    decision === undefined ||
    (!REMOTE_DECISIONS.has(decision) && !CONFLICT_DECISIONS.has(decision))
  ) {
    return undefined;
  }

  const localMtime = getEntityMtime(target.local);
  const remoteMtime = getEntityMtime(target.remote);
  return {
    localMtime,
    remoteMtime,
    recommendedSide:
      (localMtime ?? 0) >= (remoteMtime ?? 0) ? "local" : "remote",
  };
};

export const applyTargetedPushChoice = (
  target: MixedEntity,
  choice: Exclude<TargetedPushChoice, "cancel">
): MixedEntity => {
  if (choice === "newest") return target;

  const isCreatedConflict = target.decision?.includes("conflict_created");
  return {
    ...target,
    decision: isCreatedConflict
      ? "conflict_created_then_keep_local"
      : "conflict_modified_then_keep_local",
    conflictAction: "keep_newer",
    change: true,
  };
};

export const prepareTargetedSyncPlan = async (
  plan: Readonly<Record<string, MixedEntity>>,
  request: TargetedSyncRequest
): Promise<Record<string, MixedEntity>> => {
  const selected = selectTargetedSyncPlan(plan, request.path);
  const target = selected[request.path];
  if (target === undefined) throw new TargetedSyncPathError(request.path);

  const conflict = getTargetedPushConflict(target);
  if (conflict === undefined) return selected;

  const choice = await request.resolveConflict(conflict);
  if (choice === "cancel") return {};
  selected[request.path] = applyTargetedPushChoice(target, choice);
  return selected;
};
