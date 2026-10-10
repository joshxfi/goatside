import { Link, useRouter } from "@tanstack/react-router"
import {
  ArrowLeftIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
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
import { type Viewer, signOut } from "@/server/session"

const PAGES = [
  { to: "/", label: "Overview", icon: LayoutDashboardIcon },
  { to: "/people", label: "People", icon: UsersIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const

/** Wordmark and page links. Desktop only; phones use the account menu. */
export function AppNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Main"
      className={cn("hidden items-center gap-6 lg:flex", className)}
    >
      <Link to="/" aria-label="Goatside home">
        <Wordmark className="text-xl" />
      </Link>
      <ul className="flex items-center gap-1 text-sm">
        {PAGES.map((page) => (
          <li key={page.to}>
            <Link
              to={page.to}
              activeOptions={{ exact: page.to === "/", includeSearch: false }}
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Header for pages other than the overview: back on phones, nav on desktop. */
export function PageHeader({
  title,
  viewer,
  back = "/",
}: {
  title: string
  viewer: Viewer
  back?: string
}) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <AppNav className="mr-6" />
        <Link
          to={back}
          aria-label="Back"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-lg" }),
            "rounded-full active:scale-[0.97] lg:hidden"
          )}
        >
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-display text-3xl leading-none lg:sr-only">
          {title}
        </h1>
      </div>
      <AccountMenu viewer={viewer} />
    </header>
  )
}

export function AccountMenu({ viewer }: { viewer: Viewer }) {
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
        <DropdownMenuGroup>
          {PAGES.map((page) => (
            <DropdownMenuItem
              key={page.to}
              onClick={() => router.navigate({ to: page.to })}
            >
              <page.icon />
              {page.label}
            </DropdownMenuItem>
          ))}
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
