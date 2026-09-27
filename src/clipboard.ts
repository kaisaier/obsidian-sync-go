export type ClipboardEnvironment = {
  readonly clipboard?: {
    writeText(text: string): Promise<void>;
  };
  readonly document: Document;
};

export async function copyTextToClipboard(
  text: string,
  environment: ClipboardEnvironment = {
    clipboard: navigator.clipboard,
    document,
  }
): Promise<boolean> {
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(text);
      return true;
    } catch {
      // macOS Electron may reject the async Clipboard API even after a user click.
    }
  }

  const textarea = environment.document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  environment.document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    return environment.document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
