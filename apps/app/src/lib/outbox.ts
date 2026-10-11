/**
 * Entries typed on this phone that the server hasn't saved yet. Every log
 * goes through here: written to localStorage first, so nothing typed is
 * lost to a dropped connection or a reload, then sent in the order typed.
 * Resending is safe: each entry carries its own id and the server saves an
 * id once. Each also carries when it was typed, so "yesterday" keeps its
 * meaning however late it syncs.
 */
import { useSyncExternalStore } from "react"
import { todayIn } from "@workspace/core/dates"
import { preparse } from "@workspace/core/preparse"
import { fileLine } from "@/lib/file-line"
import { type LedgerTxn, type MonthView, logEntry } from "@/server/ledger"

export interface Pending {
  id: string
  text: string
  /** A quick pick: logged on purpose, so no duplicate check. */
  repeat?: boolean
  /** When it was typed, epoch ms. */
  at: number
  /** Failed sends so far; above 0, the entry is waiting, not just sending. */
  tries: number
  /** Saved as these rows; hidden once they've loaded, then dropped. */
  savedAs?: string[]
}

type Saved = Awaited<ReturnType<typeof logEntry>>
export type Sent =
  | { kind: "saved"; result: Saved }
  /** Kept on the phone until there's a connection. */
  | { kind: "queued" }
  | { kind: "failed"; error: unknown }

const KEY = "goatside:outbox"
const SEND_TIMEOUT_MS = 20_000
const NONE: Pending[] = []

let items: Pending[] = NONE
let loaded = false
const listeners = new Set<() => void>()

function read() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    items = Array.isArray(parsed) ? (parsed as Pending[]) : NONE
  } catch {
    items = NONE
  }
}

function write(next: Pending[]) {
  items = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode or full storage: the entry still sends from memory.
  }
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key !== KEY) return
  read()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (!loaded) {
    loaded = true
    read()
  }
  if (!listeners.size) window.addEventListener("storage", onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener("storage", onStorage)
  }
}

/** Entries waiting on this phone, oldest first. Empty on the server. */
export function usePending(): Pending[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => NONE
  )
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** The browser's guess at whether there's a connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  )
}

/** crypto.randomUUID needs HTTPS; a self-hosted LAN address may not have it. */
function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** No connection, or none worth waiting on, as opposed to a server error. */
function isNetworkError(error: unknown) {
  return (
    !navigator.onLine ||
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  )
}

const remove = (ids: Set<string>) =>
  write(items.filter((item) => !ids.has(item.id)))

const update = (id: string, change: Partial<Pending>) =>
  write(items.map((item) => (item.id === id ? { ...item, ...change } : item)))

/** No connection: everything not yet sent is now waiting. */
const stalled = () =>
  write(
    items.map((item) =>
      item.savedAs || item.tries ? item : { ...item, tries: 1 }
    )
  )

let flushing: Promise<Map<string, Sent>> | null = null

/**
 * Sends what's waiting, oldest first, stopping at the first sign of no
 * connection. A saved entry stays until `refresh` has loaded its rows, and
 * withPending hides it the moment they arrive, so each pending row turns
 * into its saved row in place.
 */
export function flush(
  refresh: () => Promise<unknown>
): Promise<Map<string, Sent>> {
  // One at a time, in order; a log typed mid-flush goes out in the next.
  const run = (flushing ?? Promise.resolve())
    .catch(() => null)
    .then(() => sendAll(refresh))
  flushing = run
  void run.finally(() => {
    if (flushing === run) flushing = null
  })
  return run
}

async function sendAll(refresh: () => Promise<unknown>) {
  // Saved before a reload cut the last flush short: the ledger has them.
  const leftover = items.filter((item) => item.savedAs).map((i) => i.id)
  if (leftover.length) remove(new Set(leftover))
  const sent = new Map<string, Sent>()
  for (const { id } of items) {
    // Looked up each time: it may have been discarded meanwhile.
    const item = items.find((i) => i.id === id)
    if (!item || item.savedAs) continue
    if (!navigator.onLine) {
      stalled()
      break
    }
    try {
      const result = await logEntry({
        data: { text: item.text, repeat: item.repeat, id, at: item.at },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      sent.set(id, { kind: "saved", result })
      update(id, {
        savedAs: result.kind === "log" ? result.transactionIds : [],
      })
    } catch (error) {
      update(id, { tries: item.tries + 1 })
      if (isNetworkError(error)) {
        stalled()
        break
      }
      sent.set(id, { kind: "failed", error })
    }
  }
  const saved = new Set(
    [...sent].filter(([, s]) => s.kind === "saved").map(([id]) => id)
  )
  if (saved.size) {
    await refresh().catch(() => null)
    remove(saved)
  }
  return sent
}

/**
 * Logs `text`: kept on the phone, then sent along with anything older still
 * waiting. A server error on a fresh entry takes it back out, so the
 * composer can return the text to the box.
 */
export async function log(
  text: string,
  { repeat }: { repeat?: boolean },
  refresh: () => Promise<unknown>
): Promise<Sent & { alsoSynced: number }> {
  const item: Pending = { id: newId(), text, repeat, at: Date.now(), tries: 0 }
  write([...items, item])
  const sent = await flush(refresh)
  const alsoSynced = [...sent].filter(
    ([id, s]) => id !== item.id && s.kind === "saved"
  ).length
  const mine = sent.get(item.id) ?? { kind: "queued" as const }
  if (mine.kind === "failed") remove(new Set([item.id]))
  return { ...mine, alsoSynced }
}

/** Takes an entry back before it syncs. */
export function discard(id: string) {
  remove(new Set([id]))
}

const PREFIX = "optimistic:"

/** The outbox entry behind a pending row, if it is one. */
export function pendingOf(txn: LedgerTxn, pending: Pending[]) {
  if (!txn.id.startsWith(PREFIX)) return undefined
  return pending.find((p) => txn.id.startsWith(`${PREFIX}${p.id}:`))
}

/**
 * The month as it will look once everything waiting is saved: each pending
 * entry's lines, read the way the server will read them, at the top of
 * their day. Totals stay as saved; categories come with the server.
 */
export function withPending(view: MonthView, pending: Pending[]): MonthView {
  if (!pending.length) return view
  const rows: LedgerTxn[] = []
  const arrived = new Set(view.transactions.map((t) => t.id))
  for (const item of pending) {
    if (item.savedAs?.some((id) => arrived.has(id))) continue
    const today = todayIn(view.timeZone, new Date(item.at))
    const parsed = preparse(item.text, { today })
    if (parsed.kind !== "log") continue
    parsed.lines.forEach((line, i) => {
      if (!line.localDate.startsWith(view.month)) return
      const filed = fileLine(line.description, view)
      rows.push({
        id: `${PREFIX}${item.id}:${i}`,
        kind: line.direction === "in" ? "income" : "expense",
        amount: line.direction === "in" ? line.share : -line.share,
        localDate: line.localDate,
        description: filed.description,
        split: line.split,
        recurring: false,
        status: "pending",
        createdAt: item.at,
        category: null,
        person: null,
        account: filed.account,
        toAccount: null,
      })
    })
  }
  if (!rows.length) return view
  return {
    ...view,
    transactions: [...rows, ...view.transactions].toSorted(
      (a, b) =>
        b.localDate.localeCompare(a.localDate) || b.createdAt - a.createdAt
    ),
  }
}
