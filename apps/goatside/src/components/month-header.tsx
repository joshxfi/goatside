import { Link } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { addMonths } from "@workspace/core/dates"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { monthName } from "@/lib/format"
import type { Viewer } from "@/server/session"
import { AccountMenu, DesktopSidebarTrigger } from "./app-shell"

export function MonthHeader({
  month,
  today,
  viewer,
  children,
}: {
  month: string
  today: string
  viewer: Viewer
  /** Desktop: the composer bar, between the month and the edge. */
  children?: React.ReactNode
}) {
  const current = today.slice(0, 7)
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  const toSearch = (m: string) => ({ m: m === current ? undefined : m })
  const navButton = cn(
    buttonVariants({ variant: "ghost", size: "icon-lg" }),
    "rounded-full active:scale-[0.97]"
  )

  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <DesktopSidebarTrigger className="mr-2" />
        <Link
          to="/"
          search={toSearch(prev)}
          className={navButton}
          aria-label="Previous month"
        >
          <ChevronLeftIcon />
        </Link>
        <h1 className="min-w-0 text-center">
          <span className="font-display text-3xl leading-none">
            {monthName(month)}
          </span>
          {month.slice(0, 4) !== today.slice(0, 4) && (
            <span className="ml-1.5 text-sm text-muted-foreground">
              {month.slice(0, 4)}
            </span>
          )}
        </h1>
        {month < current ? (
          <Link
            to="/"
            search={toSearch(next)}
            className={navButton}
            aria-label="Next month"
          >
            <ChevronRightIcon />
          </Link>
        ) : (
          <span
            className={cn(navButton, "pointer-events-none opacity-30")}
            aria-hidden
          >
            <ChevronRightIcon />
          </span>
        )}
      </div>
      {children}
      <AccountMenu viewer={viewer} className="lg:hidden" />
    </header>
  )
}
