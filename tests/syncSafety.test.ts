import { strict as assert, rejects, throws } from "assert";
import type { Entity } from "../src/baseTypes";
import {
  type RemoteOperationOptions,
  SyncSafetyError,
  assertRemoteListingPlausible,
  checkRemotePassword,
  isTransientRemoteError,
  retryRemoteOperation,
  runRemoteListingPipeline,
  withTimeout,
} from "../src/syncSafety";

const entities = (...keys: string[]): Entity[] =>
  keys.map((key) => ({ key, keyRaw: key, size: 1, sizeRaw: 1 }));

describe("Sync safety", () => {
  it("blocks a suspiciously incomplete remote listing", () => {
    throws(
      () =>
        assertRemoteListingPlausible(
          entities("a.md", "b.md", "c.md", "d.md"),
          entities("a.md", "b.md"),
          "bidirectional",
          50
        ),
      SyncSafetyError
    );
  });

  it("allows non-destructive push-only sync", () => {
    assertRemoteListingPlausible(
      entities("a.md", "b.md"),
      [],
      "incremental_push_only",
      50
    );
  });

  it("supports explicitly disabling the safety threshold", () => {
    assertRemoteListingPlausible(
      entities("a.md", "b.md"),
      [],
      "bidirectional",
      -1
    );
  });

  it("times out a stuck remote operation", async () => {
    await rejects(
      withTimeout(
        () => new Promise<void>(() => undefined),
        5,
        "remote listing"
      ),
      SyncSafetyError
    );
  });

  it("retries transient failures and then succeeds", async () => {
    let calls = 0;
    const result = await retryRemoteOperation(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw { status: 503 };
        }
        return "ok";
      },
      {
        label: "remote listing",
        timeoutMs: 100,
        baseDelayMs: 0,
        sleep: async () => undefined,
      }
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
  });

  it("does not retry authentication or permission failures", async () => {
    let calls = 0;
    await rejects(
      retryRemoteOperation(
        async () => {
          calls += 1;
          throw { status: 401 };
        },
        {
          label: "remote listing",
          timeoutMs: 100,
          sleep: async () => undefined,
        }
      )
    );
    assert.equal(calls, 1);
    assert.equal(isTransientRemoteError({ status: 401 }), false);
  });

  it("keeps password timing separate and allows a remote listing just before its deadline", async () => {
    // Given
    const observed: RemoteOperationOptions[] = [];
    const completedAt: number[] = [];
    const runImmediately = async <T>(
      operation: () => Promise<T>,
      options: RemoteOperationOptions
    ): Promise<T> => {
      observed.push(options);
      completedAt.push(options.timeoutMs - 1);
      return await operation();
    };
    const selectedListingTimeoutMs = 20 * 60 * 1_000;
    const downstream = { local: 0, history: 0, plan: 0, writes: 0 };
    const phases: string[] = [];
    // When
    const password = await checkRemotePassword(
      async () => ({ ok: true, reason: "password_matched" }),
      runImmediately
    );
    const pipeline = await runRemoteListingPipeline({
      listingTimeoutMs: selectedListingTimeoutMs,
      listRemote: async () => {
        phases.push("remote");
        return entities("remote.md");
      },
      listLocal: async () => {
        phases.push("local");
        downstream.local += 1;
        return entities("local.md");
      },
      readHistory: async () => {
        phases.push("history");
        downstream.history += 1;
        return entities("history.md");
      },
      buildPlan: async () => {
        phases.push("plan");
        downstream.plan += 1;
        return ["plan"];
      },
      applyWrites: async () => {
        phases.push("writes");
        downstream.writes += 1;
      },
      runRemoteOperation: runImmediately,
    });
    // Then
    assert.equal(password.ok, true);
    assert.equal(pipeline.outcome, "success");
    assert.deepEqual(downstream, { local: 1, history: 1, plan: 1, writes: 1 });
    assert.deepEqual(phases, ["remote", "local", "history", "plan", "writes"]);
    assert.deepEqual(completedAt, [119_999, selectedListingTimeoutMs - 1]);
    assert.deepEqual(observed, [
      {
        label: "remote password check",
        timeoutMs: 120_000,
      },
      {
        label: "remote listing",
        timeoutMs: selectedListingTimeoutMs,
        attempts: 1,
      },
    ]);
  });

  it("returns failure and blocks production downstream phases after a late remote listing timeout", async () => {
    // Given
    let resolveLate: ((value: Entity[]) => void) | undefined;
    let listingCalls = 0;
    const downstream = { local: 0, history: 0, plan: 0, writes: 0 };
    const lateListing = new Promise<Entity[]>((resolve) => {
      resolveLate = resolve;
    });
    const timeoutRunner = async <T>(
      operation: () => Promise<T>,
      options: RemoteOperationOptions
    ): Promise<T> => {
      void operation();
      throw new SyncSafetyError(
        `${options.label} timed out after ${options.timeoutMs}ms`
      );
    };
    // When
    const result = await runRemoteListingPipeline({
      listingTimeoutMs: 10 * 60 * 1_000,
      listRemote: async () => {
        listingCalls += 1;
        return await lateListing;
      },
      listLocal: async () => {
        downstream.local += 1;
        return entities("local.md");
      },
      readHistory: async () => {
        downstream.history += 1;
        return entities("history.md");
      },
      buildPlan: async () => {
        downstream.plan += 1;
        return ["plan"];
      },
      applyWrites: async () => {
        downstream.writes += 1;
      },
      runRemoteOperation: timeoutRunner,
    });
    if (resolveLate !== undefined) {
      resolveLate(entities("too-late.md"));
    }
    await Promise.resolve();
    // Then
    assert.equal(result.outcome, "failure");
    assert.equal(listingCalls, 1);
    assert.equal(
      isTransientRemoteError(new SyncSafetyError("remote listing timed out")),
      false
    );
    assert.deepEqual(downstream, { local: 0, history: 0, plan: 0, writes: 0 });
  });
});
