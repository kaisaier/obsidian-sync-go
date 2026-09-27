import { strict as assert } from "assert";
import { JSDOM } from "jsdom";
import { copyTextToClipboard } from "../src/clipboard";

describe("clipboard copy", () => {
  it("falls back to a selected textarea when the modern clipboard API rejects", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    let copiedValue = "";
    Object.defineProperty(dom.window.document, "execCommand", {
      value: (command: string) => {
        assert.equal(command, "copy");
        copiedValue = (
          dom.window.document.activeElement as HTMLTextAreaElement
        ).value;
        return true;
      },
    });

    const copied = await copyTextToClipboard("mac-token", {
      clipboard: {
        writeText: async () => {
          throw new DOMException("Not allowed", "NotAllowedError");
        },
      },
      document: dom.window.document,
    });

    assert.equal(copied, true);
    assert.equal(copiedValue, "mac-token");
    assert.equal(dom.window.document.querySelector("textarea"), null);
  });

  it("falls back when navigator.clipboard is unavailable", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    Object.defineProperty(dom.window.document, "execCommand", {
      value: () => true,
    });

    assert.equal(
      await copyTextToClipboard("mac-token", {
        document: dom.window.document,
      }),
      true
    );
  });
});
