import { guessTransfer, scanAccounts } from "@workspace/core/accounts"
import type { MonthView } from "@/server/ledger"

/**
 * Where a line will be filed, read the same way the server reads it. The
 * server also asks the model about transfers, so this is a best guess.
 */
export function fileLine(description: string, view: MonthView) {
  const scan = scanAccounts(description, view.accounts)
  const byId = (id: string | null | undefined) =>
    view.accounts.find((a) => a.id === id) ?? null
  const transfer = scan.transferWord
    ? guessTransfer(scan, view.accounts, view.defaultAccountId)
    : null
  const named = byId(
    scan.mentions.find((m) => m.cued)?.accountId ?? scan.mentions[0]?.accountId
  )
  const account = named ?? byId(view.defaultAccountId)
  return {
    description: scan.rest,
    transfer: transfer && {
      from: byId(transfer.from),
      to: byId(transfer.to),
    },
    account: account && {
      id: account.id,
      name: account.name,
      color: account.color,
    },
    named: Boolean(named),
    unknown: scan.mentions.length ? null : scan.unknown,
  }
}
