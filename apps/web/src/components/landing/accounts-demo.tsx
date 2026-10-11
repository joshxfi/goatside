import { useEffect, useEffectEvent, useRef, useState } from "react"
import { animate, useReducedMotion } from "motion/react"
import {
  ArrowLeftRightIcon,
  BanknoteIcon,
  CreditCardIcon,
  LandmarkIcon,
  type LucideIcon,
  SmartphoneIcon,
} from "lucide-react"
import { Coin } from "@workspace/ui/components/brand"
import { useTilt } from "@workspace/ui/hooks/use-tilt"
import { cn } from "@workspace/ui/lib/utils"
import { cardBackground } from "@workspace/ui/lib/account-colors"
import { ACCOUNT_KIND_LABELS, type AccountKind } from "@workspace/core/accounts"
import { formatMoney } from "@workspace/core/money"
import { DEMO_ACCOUNTS, fileText } from "@/lib/demo/file-line"
import { TODAY } from "@/lib/demo/sample-months"
import type { DemoRow } from "@/lib/demo/file-line"
import { DemoCard, FeedRow } from "./ui"

const ICONS: Record<AccountKind, LucideIcon> = {
  bank: LandmarkIcon,
  ewallet: SmartphoneIcon,
  credit_card: CreditCardIcon,
  cash: BanknoteIcon,
}

const START: Record<string, number> = {
  gcash: 820000,
  bpi: 4850000,
  "bpi-card": -1268000,
  cash: 150000,
}
const CARD_LIMIT = 6000000

/** Each line filed once, by the same code as the hero's composer. */
const TRANSFERS = [
  "1000 cash in gcash from bpi",
  "3000 atm",
  "5000 pay bpi card from bpi",
].flatMap((line) => {
  const filed = fileText(line, TODAY)
  const row = filed.kind === "log" ? filed.rows[0] : undefined
  if (!row || row.icon !== "transfer") return []
  const [fromName, toName] = row.detail.split(" → ")
  const from = DEMO_ACCOUNTS.find((a) => a.name === fromName)?.id
  const to = DEMO_ACCOUNTS.find((a) => a.name === toName)?.id
  return from && to ? [{ line, row, from, to }] : []
})

/**
 * Accounts as the app draws them. Logging a transfer moves money between
 * two cards and leaves spending alone.
 */
export function AccountsDemo() {
  const reduce = useReducedMotion()
  // What each account holds now; the cards catch up when the coin lands.
  const [balances, setBalances] = useState(START)
  const [shown, setShown] = useState(START)
  const [moved, setMoved] = useState<{ from: string; to: string } | null>(null)
  const [rows, setRows] = useState<DemoRow[]>([])
  const [flights, setFlights] = useState<Flight[]>([])
  const stage = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())

  function land(transfer: (typeof TRANSFERS)[number]) {
    const { row, from, to } = transfer
    setShown((all) => ({
      ...all,
      [from]: (all[from] ?? 0) - row.amount,
      [to]: (all[to] ?? 0) + row.amount,
    }))
    setMoved({ from, to })
  }

  function log(transfer: (typeof TRANSFERS)[number]) {
    const { row, from, to } = transfer
    setBalances((all) => ({
      ...all,
      [from]: (all[from] ?? 0) - row.amount,
      [to]: (all[to] ?? 0) + row.amount,
    }))
    setRows((all) =>
      [{ ...row, id: `${row.id}-${all.length}-${Date.now()}` }, ...all].slice(
        0,
        3
      )
    )
    const box = stage.current?.getBoundingClientRect()
    const a = cards.current.get(from)?.getBoundingClientRect()
    const b = cards.current.get(to)?.getBoundingClientRect()
    if (reduce || !box || !a || !b) return land(transfer)
    // A coin carries the money from one card to the other.
    const center = (r: DOMRect) => ({
      x: r.left + r.width / 2 - box.left,
      y: r.top + r.height / 2 - box.top,
    })
    setFlights((all) => [
      ...all,
      {
        id: Date.now() + Math.random(),
        from: center(a),
        to: center(b),
        onLand: () => land(transfer),
      },
    ])
  }

  const total = Object.entries(shown).reduce((sum, [, b]) => sum + b, 0)

  return (
    <DemoCard className="flex flex-col gap-4 p-4 md:p-5">
      <div ref={stage} className="relative grid grid-cols-2 gap-2.5">
        {DEMO_ACCOUNTS.map((account) => (
          <DemoAccount
            key={account.id}
            account={account}
            balance={shown[account.id] ?? 0}
            active={moved?.from === account.id || moved?.to === account.id}
            cardRef={(el) => {
              if (el) cards.current.set(account.id, el)
              else cards.current.delete(account.id)
            }}
          />
        ))}
        {flights.map((flight) => (
          <FlyingCoin
            key={flight.id}
            flight={flight}
            onDone={() =>
              setFlights((all) => all.filter((f) => f.id !== flight.id))
            }
          />
        ))}
      </div>

      <div className="flex flex-col gap-1 px-1">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Net across accounts</span>
          <span className="figure font-display text-2xl">
            <CountUp value={total} />
          </span>
        </div>
        {moved && (
          <p className="enter-fade text-xs text-muted-foreground">
            A transfer moves money between your own accounts. Your net and your
            spending stay the same.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="px-1 text-sm text-muted-foreground">
          Log a transfer
        </span>
        <div className="flex flex-wrap gap-1.5">
          {TRANSFERS.map((transfer) => (
            <button
              key={transfer.line}
              type="button"
              // Only what the account has, and never more than a card owes.
              disabled={
                (balances[transfer.from] ?? 0) < transfer.row.amount ||
                (transfer.to === "bpi-card" &&
                  -(balances[transfer.to] ?? 0) < transfer.row.amount)
              }
              onClick={() => log(transfer)}
              className="flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 font-mono text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground"
            >
              <ArrowLeftRightIcon aria-hidden className="size-3" />
              {transfer.line}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col border-t pt-1">
          {rows.map((row) => (
            <li key={row.id} className="enter-rise">
              <FeedRow row={row} today={TODAY} />
            </li>
          ))}
        </ul>
      )}
    </DemoCard>
  )
}

type DemoAccountRow = (typeof DEMO_ACCOUNTS)[number]

function DemoAccount({
  account,
  balance,
  active,
  cardRef,
}: {
  account: DemoAccountRow
  balance: number
  active: boolean
  cardRef: (el: HTMLElement | null) => void
}) {
  const tilt = useTilt<HTMLDivElement>()
  const card = account.kind === "credit_card"
  const Icon = ICONS[account.kind]
  return (
    <div
      ref={(el) => {
        tilt(el)
        cardRef(el)
      }}
      className={cn(
        "tilt relative flex aspect-[1.7] flex-col justify-between overflow-hidden rounded-2xl p-3.5 text-white shadow-sm ring-1 ring-black/5 transition-[scale] duration-200 ease-out ring-inset",
        active && "scale-[1.02]"
      )}
      style={{ background: cardBackground(account.color) }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs text-white/75">
          <Icon aria-hidden className="size-3.5" />
          {ACCOUNT_KIND_LABELS[account.kind]}
        </span>
        <span className="font-medium">{account.name}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="figure font-display text-2xl leading-none md:text-3xl">
          <CountUp value={card ? -balance : balance} />
          {card && (
            <span className="ml-1 font-sans text-xs text-white/70">owed</span>
          )}
        </span>
        {card && (
          <span className="h-1 overflow-hidden rounded-full bg-white/20">
            <span
              className="block h-full rounded-full bg-white/80 transition-[width] duration-500 ease-out"
              style={{ width: `${(-balance / CARD_LIMIT) * 100}%` }}
            />
          </span>
        )}
      </div>
    </div>
  )
}

interface Flight {
  id: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  onLand: () => void
}

/** A coin tossed from one card to another, landing as the money arrives. */
function FlyingCoin({
  flight,
  onDone,
}: {
  flight: Flight
  onDone: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const finish = useEffectEvent(() => {
    flight.onLand()
    onDone()
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { from, to } = flight
    const peak = Math.min(from.y, to.y) - 56
    const run = animate(
      el,
      {
        x: [from.x, to.x],
        y: [from.y, peak, to.y],
        rotateY: [0, 720],
        transformPerspective: 400,
        scale: [0.5, 1.15, 0.7],
        opacity: [0, 1, 1, 0],
      },
      {
        duration: 0.75,
        ease: [0.45, 0, 0.55, 1],
        y: { duration: 0.75, times: [0, 0.45, 1], ease: ["easeOut", "easeIn"] },
        opacity: { duration: 0.75, times: [0, 0.12, 0.85, 1] },
      }
    )
    // A flight cut short (unmounted) must not land the money twice.
    let live = true
    void run.then(() => live && finish())
    return () => {
      live = false
      run.stop()
    }
  }, [flight])
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-10 -mt-5 -ml-5 size-10 opacity-0 transform-3d"
    >
      {/* Gold up front, silver behind, as on the big coin. */}
      <Coin
        metal="gold"
        className="absolute inset-0 size-full drop-shadow-md backface-hidden"
      />
      <Coin
        metal="silver"
        className="absolute inset-0 size-full rotate-y-180 drop-shadow-md backface-hidden"
      />
    </div>
  )
}

/** A figure that counts to its new value, so the change reads as a change. */
function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  const reduce = useReducedMotion()
  useEffect(() => {
    const from = shown.current
    shown.current = value
    const el = ref.current
    if (!el || from === value) return
    if (reduce) {
      el.textContent = formatMoney(value)
      return
    }
    const run = animate(from, value, {
      duration: 0.5,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => {
        el.textContent = formatMoney(Math.round(v / 100) * 100)
      },
      onComplete: () => {
        el.textContent = formatMoney(value)
      },
    })
    return () => run.stop()
  }, [value, reduce])
  return <span ref={ref}>{formatMoney(value)}</span>
}
