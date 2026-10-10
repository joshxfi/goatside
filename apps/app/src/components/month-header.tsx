import { Link, useRouter } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon } from "lucide-react"
import { addMonths } from "@workspace/core/dates"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { CoinMark, Wordmark } from "@workspace/ui/components/brand"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { monthName } from "@/lib/format"
import { type Viewer, signOut } from "@/server/session"

export function MonthHeader({
  month,
  today,
  viewer,
}: {
  month: string
  today: string
  viewer: Viewer
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
        <Wordmark className="mr-6 hidden text-xl lg:inline-flex" />
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
      <AccountMenu viewer={viewer} />
    </header>
  )
}

function AccountMenu({ viewer }: { viewer: Viewer }) {
  const router = useRouter()
  const initial = viewer.username.charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Account"
      >
        <Avatar className="size-9">
          <AvatarFallback>
            {initial || <CoinMark rim={false} className="size-4" />}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span className="font-normal">Signed in as</span>
            <span className="text-foreground">{viewer.username}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut()
            await router.invalidate()
            await router.navigate({ to: "/login" })
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
