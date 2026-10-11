/**
 * Opens a statement PDF in the browser and turns its text into positioned
 * lines for `@workspace/core/statement`. The file and its password stay on
 * this device: nothing here talks to the server. pdf.js loads only when
 * someone picks a file.
 */
import { linesFromItems, type StatementLine } from "@workspace/core/statement"

export class PasswordError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? "That password didn't work." : "This file needs a password.")
  }
}

async function loadPdfjs() {
  // The legacy build runs on older phones; the worker keeps parsing off the
  // main thread.
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

/** Every page's text as lines. Throws `PasswordError` when it needs one. */
export async function readPdfLines(
  bytes: Uint8Array,
  password?: string
): Promise<StatementLine[]> {
  const pdfjs = await loadPdfjs()
  let doc
  try {
    doc = await pdfjs.getDocument({
      // pdf.js takes ownership of the buffer it's given.
      data: bytes.slice(),
      password,
      verbosity: 0,
    }).promise
  } catch (error) {
    // pdf.js doesn't export its PasswordException class.
    if (error instanceof Error && error.name === "PasswordException") {
      const { code } = error as Error & { code?: number }
      throw new PasswordError(
        code === pdfjs.PasswordResponses.INCORRECT_PASSWORD
      )
    }
    throw error
  }
  try {
    const lines: StatementLine[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const { items } = await page.getTextContent()
      lines.push(
        ...linesFromItems(
          p,
          items.flatMap((it) =>
            "str" in it
              ? [
                  {
                    str: it.str,
                    x: it.transform[4] as number,
                    y: it.transform[5] as number,
                    width: it.width,
                  },
                ]
              : []
          )
        )
      )
    }
    return lines
  } finally {
    await doc.destroy()
  }
}

/** SHA-256 of the file, hex. Identifies an import without keeping the file. */
export async function fileHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice())
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
