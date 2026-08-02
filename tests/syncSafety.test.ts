import { strict as assert, rejects, throws } from "assert";
import type { Entity } from "../src/baseTypes";
import {
  SyncSafetyError,
  assertRemoteListingPlausible,
  isTransientRemoteError,
  retryRemoteOperation,
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
});
