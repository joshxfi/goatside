/**
 * Pieces of the app's UI, rebuilt for the landing page's demos: a feed row,
 * a question card's buttons, and the page's section headings.
 */
import type { ComponentProps, ReactNode } from "react"
import { ArrowLeftRightIcon } from "lucide-react"
import { CoinMark } from "@workspace/ui/components/brand"
import { cn } from "@workspace/ui/lib/utils"
import { addDays } from "@workspace/core/dates"
import { formatPeso } from "@workspace/core/money"
import type { DemoRow } from "@/lib/demo/file-line"

const weekdayDate = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

/** "Today", "Yesterday", or "Sat, Oct 3". */
export function dayLabel(date: string, today: string) {
  if (date === today) return "Today"
  if (date === addDays(today, -1)) return "Yesterday"
  return weekdayDate.format(new Date(`${date}T00:00:00Z`))
}

export function SectionHeading({
  id,
  kicker,
  title,
  children,
  className,
}: {
  id?: string
  kicker: string
  title: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex max-w-xl flex-col gap-3", className)}>
      <p className="text-sm text-muted-foreground">{kicker}</p>
      <h2
        id={id}
        className="font-display text-4xl leading-[1.05] tracking-tight text-balance md:text-5xl"
      >
        {title}
      </h2>
      {children && (
        <div className="text-pretty text-muted-foreground md:text-lg">
          {children}
        </div>
      )}
    </div>
  )
}

/** A transaction as the app's feed shows it. */
export function FeedRow({
  row,
  today,
  className,
}: {
  row: DemoRow
  today: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-lg"
      >
        {row.icon === "transfer" ? (
          <ArrowLeftRightIcon className="size-4 text-muted-foreground" />
        ) : row.icon === "iou" ? (
          "🤝"
        ) : row.icon === "coin" ? (
          <CoinMark rim={false} className="size-5 text-muted-foreground" />
        ) : (
          row.icon
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{row.title}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {row.check && (
            <span className="flex items-center gap-1 text-bronze">
              <span aria-hidden className="size-1.5 rounded-full bg-bronze" />
              Check ·
            </span>
          )}
          <span className="truncate">
            {row.detail}
            {row.date !== today && ` · ${dayLabel(row.date, today)}`}
          </span>
        </span>
      </span>
      <span
        className={cn(
          "figure shrink-0 font-display text-xl",
          row.tone === "in" && "text-income-foreground",
          row.tone === "out" && "text-expense-foreground",
          row.tone === "quiet" && "text-muted-foreground"
        )}
      >
        {row.icon === "transfer"
          ? formatPeso(Math.abs(row.amount))
          : formatPeso(row.amount, { sign: row.amount > 0 })}
      </span>
    </div>
  )
}

/** A question card's answer, as in the app. */
export function AnswerButton({
  guess,
  tone,
  className,
  ...props
}: ComponentProps<"button"> & {
  guess?: boolean
  tone?: "income" | "expense"
}) {
  return (
    <button
      type="button"
      aria-pressed={guess ? true : undefined}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-muted",
        guess && "border-foreground/40 bg-muted",
        tone === "income" && "text-income-foreground",
        tone === "expense" && "text-expense-foreground",
        className
      )}
      {...props}
    />
  )
}

/** The frame the demos sit in: a card like the app's panels. */
export function DemoCard({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/4%),0_12px_32px_-12px_oklch(0_0_0/12%)] dark:shadow-none",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Small print under a demo saying what's real and what's made up. */
export function DemoNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-pretty text-muted-foreground">{children}</p>
}
