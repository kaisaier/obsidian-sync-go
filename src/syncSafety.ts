import type { Entity, SyncDirectionType } from "./baseTypes";

export class SyncSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncSafetyError";
  }
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENETDOWN",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

export const REMOTE_PASSWORD_CHECK_TIMEOUT_MS = 120_000;

export type RemoteOperationOptions = {
  readonly label: string;
  readonly timeoutMs: number;
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
};

export type RemoteOperationRunner = <T>(
  operation: () => Promise<T>,
  options: RemoteOperationOptions
) => Promise<T>;

export function isTransientRemoteError(error: unknown) {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
    error?: unknown;
  };
  const status = candidate.status ?? candidate.statusCode;
  if (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 599)
  ) {
    return true;
  }
  if (status === 409) {
    return JSON.stringify(candidate.error ?? candidate.message ?? "").includes(
      "too_many_write_operations"
    );
  }
  return candidate.code !== undefined && TRANSIENT_CODES.has(candidate.code);
}

export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SyncSafetyError(`${label} timed out after ${timeoutMs}ms`)
            ),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function retryRemoteOperation<T>(
  operation: () => Promise<T>,
  options: RemoteOperationOptions
) {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout(operation, options.timeoutMs, options.label);
    } catch (error) {
      if (attempt === attempts || !isTransientRemoteError(error)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new SyncSafetyError(`${options.label} exhausted all retry attempts`);
}

export async function checkRemotePassword<
  T extends { readonly ok: boolean; readonly reason: string },
>(
  operation: () => Promise<T>,
  runRemoteOperation: RemoteOperationRunner = retryRemoteOperation
): Promise<T> {
  return await runRemoteOperation(operation, {
    label: "remote password check",
    timeoutMs: REMOTE_PASSWORD_CHECK_TIMEOUT_MS,
  });
}

export async function listRemoteWithDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  runRemoteOperation: RemoteOperationRunner = retryRemoteOperation
): Promise<T> {
  // The deadline stops this sync pipeline; provider I/O may settle later without universal cancellation.
  return await runRemoteOperation(operation, {
    label: "remote listing",
    timeoutMs,
    attempts: 1,
  });
}

export type RemoteListingPipelineOptions<TRemote, TLocal, THistory, TPlan> = {
  readonly listingTimeoutMs: number;
  readonly listRemote: () => Promise<TRemote>;
  readonly listLocal: (remote: TRemote) => Promise<TLocal>;
  readonly readHistory: (remote: TRemote, local: TLocal) => Promise<THistory>;
  readonly buildPlan: (
    remote: TRemote,
    local: TLocal,
    history: THistory
  ) => Promise<TPlan>;
  readonly applyWrites: (plan: TPlan) => Promise<void>;
  readonly runRemoteOperation?: RemoteOperationRunner;
};

export type RemoteListingPipelineOutcome =
  | { readonly outcome: "success" }
  | { readonly outcome: "failure"; readonly error: SyncSafetyError };

export async function runRemoteListingPipeline<
  TRemote,
  TLocal,
  THistory,
  TPlan,
>(
  options: RemoteListingPipelineOptions<TRemote, TLocal, THistory, TPlan>
): Promise<RemoteListingPipelineOutcome> {
  try {
    const remote = await listRemoteWithDeadline(
      options.listRemote,
      options.listingTimeoutMs,
      options.runRemoteOperation
    );
    const local = await options.listLocal(remote);
    const history = await options.readHistory(remote, local);
    const plan = await options.buildPlan(remote, local, history);
    await options.applyWrites(plan);
    return { outcome: "success" };
  } catch (error) {
    if (error instanceof SyncSafetyError) {
      return { outcome: "failure", error };
    }
    throw error;
  }
}

export function assertRemoteListingPlausible(
  previous: readonly Entity[],
  remote: readonly Entity[],
  syncDirection: SyncDirectionType,
  protectModifyPercentage: number
) {
  if (
    protectModifyPercentage < 0 ||
    syncDirection === "incremental_push_only" ||
    syncDirection === "incremental_push_and_delete_only" ||
    previous.length === 0
  ) {
    return;
  }

  const previousKeys = new Set(
    previous.map((entity) => entity.key).filter((key): key is string => !!key)
  );
  const remoteKeys = new Set(
    remote.map((entity) => entity.key).filter((key): key is string => !!key)
  );
  let missing = 0;
  for (const key of previousKeys) {
    if (!remoteKeys.has(key)) {
      missing += 1;
    }
  }

  if (
    previousKeys.size > 0 &&
    missing * 100 >= previousKeys.size * protectModifyPercentage
  ) {
    throw new SyncSafetyError(
      `remote listing is missing ${missing}/${previousKeys.size} previously synced items; ` +
        "refusing to generate destructive operations"
    );
  }
}
