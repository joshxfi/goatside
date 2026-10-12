import {
  Link,
  useCanGoBack,
  useLocation,
  useRouter,
} from "@tanstack/react-router"
import {
  ArrowLeftIcon,
  ChevronsUpDownIcon,
  CloudOffIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ReceiptTextIcon,
  SettingsIcon,
  MessageCircleQuestionMarkIcon,
  UsersIcon,
  WalletCardsIcon,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { toast } from "@workspace/ui/components/sonner"
import { THEMES, type Theme, setTheme, useTheme } from "@workspace/ui/lib/theme"
import { cn } from "@workspace/ui/lib/utils"
import { useAgent } from "@/components/agent-provider"
import { clearOfflineCopies } from "@/lib/offline"
import { useOnline } from "@/lib/outbox"
import { useShortcut } from "@/lib/use-shortcut"
import { type Viewer, signOut } from "@/server/session"

const PAGES = [
  { to: "/", label: "Overview", icon: LayoutDashboardIcon },
  { to: "/transactions", label: "Transactions", icon: ReceiptTextIcon },
  { to: "/accounts", label: "Accounts", icon: WalletCardsIcon },
  { to: "/people", label: "People", icon: UsersIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const

/** The phone tab bar's pages; Settings sits in the account menu. */
const TABS = PAGES.filter((page) => page.to !== "/settings")

/** Desktop navigation. Phones use the tab bar and the account menu. */
export function AppSidebar({ viewer }: { viewer: Viewer }) {
  const { pathname } = useLocation()
  const { ask } = useAgent()
  const askShortcut = useShortcut("J")
  const active = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          to="/"
          aria-label="Goatside home"
          className="flex h-10 items-center rounded-md px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <Wordmark className="text-xl group-data-[collapsible=icon]:hidden" />
          <CoinMark className="hidden size-6 group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PAGES.map((page) => (
                <SidebarMenuItem key={page.to}>
                  <SidebarMenuButton
                    isActive={active(page.to)}
                    tooltip={page.label}
                    render={<Link to={page.to} />}
                  >
                    <page.icon />
                    <span>{page.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Agent</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Ask Goatside" onClick={() => ask()}>
                  <MessageCircleQuestionMarkIcon />
                  <span>Ask Goatside</span>
                  <kbd className="ml-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                    {askShortcut}
                  </kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu viewer={viewer} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function UserMenu({ viewer }: { viewer: Viewer }) {
  const signOutAndLeave = useSignOut()
  const initial = viewer.username.charAt(0).toUpperCase()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            tooltip={viewer.username}
            className="data-[popup-open]:bg-sidebar-accent"
          />
        }
      >
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg">{initial}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span className="truncate text-sm font-medium">
            {viewer.username}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            Your ledger
          </span>
        </span>
        <ChevronsUpDownIcon className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="min-w-56">
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOutAndLeave}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
}

/** Light, dark or system, in the account menus. Settings has it too. */
function ThemeMenuItems() {
  const theme = useTheme()
  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(value) => setTheme(value as Theme)}
    >
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      {THEMES.map((value) => (
        <DropdownMenuRadioItem key={value} value={value}>
          {THEME_LABELS[value]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** Drops this device's offline copies of the ledger, then signs out. */
function useSignOut() {
  const router = useRouter()
  return async () => {
    // First, so they're gone even if the sign-out request can't get through.
    await clearOfflineCopies()
    try {
      await signOut()
    } catch {
      toast(
        "Couldn't reach Goatside to sign out. Try again once you're online."
      )
      return
    }
    await router.invalidate()
    await router.navigate({ to: "/login" })
  }
}

/** Toggles the sidebar (⌘B). Desktop only. */
export function DesktopSidebarTrigger({ className }: { className?: string }) {
  return (
    <SidebarTrigger className={cn("-ml-1 hidden lg:inline-flex", className)} />
  )
}

/** Header for pages other than the overview. */
const PAGE_WIDTHS = {
  /** Tables and dashboards. */
  wide: "lg:max-w-[90rem]",
  default: "lg:max-w-5xl",
  /** A single list. */
  narrow: "lg:max-w-3xl",
}

/**
 * Every page but the overview: the same gutters and top spacing as the
 * overview, with the header in the same column as the content, so titles,
 * content and header buttons line up from page to page.
 */
export function PageFrame({
  width = "default",
  children,
}: {
  width?: keyof typeof PAGE_WIDTHS
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh w-full flex-col px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[calc(var(--tab-bar,0px)+3rem)] lg:px-8 lg:pt-4 lg:pb-16">
      <div
        className={cn(
          "mx-auto flex w-full max-w-md min-w-0 flex-col gap-6 lg:mx-0",
          PAGE_WIDTHS[width]
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  viewer,
  back,
  action,
}: {
  title: string
  viewer: Viewer
  /** Detail pages: the list a phone's back arrow returns to. */
  back?: string
  /** A page-level button, e.g. "Add account". */
  action?: React.ReactNode
}) {
  return (
    <header className="flex items-center justify-between gap-3 lg:min-h-10">
      <div className="flex items-center gap-2">
        <DesktopSidebarTrigger />
        {back && <BackButton to={back} />}
        <h1 className="font-display text-3xl leading-none">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {action}
        <AskButton />
        <AccountMenu viewer={viewer} className="lg:hidden" />
      </div>
    </header>
  )
}

/**
 * Back to where the owner came from, like a native back button. Opened
 * straight from a link (nothing to go back to), it replaces the page with
 * `to` instead of stacking another entry.
 */
function BackButton({ to }: { to: string }) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    <Link
      to={to}
      replace
      aria-label="Back"
      onClick={(event) => {
        if (!canGoBack) return
        event.preventDefault()
        router.history.back()
      }}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-lg" }),
        "-ml-2 rounded-full active:scale-[0.97] lg:hidden"
      )}
    >
      <ArrowLeftIcon />
    </Link>
  )
}

/**
 * Phone navigation, pinned to the bottom like a native tab bar. Tapping the
 * page you're on scrolls it back to the top. Hidden while typing, so the
 * keyboard and composer get the room.
 */
export function TabBar() {
  const { pathname } = useLocation()
  const online = useOnline()
  return (
    <nav
      aria-label="Pages"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 px-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md select-none in-data-typing:hidden supports-[backdrop-filter]:bg-background/70 lg:hidden"
    >
      {!online && pathname !== "/" && (
        <p className="flex items-center justify-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <CloudOffIcon aria-hidden className="size-3.5" />
          Offline · showing what was last loaded
        </p>
      )}
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {TABS.map((page) => (
          <li key={page.to} className="flex">
            <Link
              to={page.to}
              activeOptions={{ exact: page.to === "/" }}
              onClick={(event) => {
                if (event.currentTarget.dataset.status !== "active") return
                event.preventDefault()
                window.scrollTo({ top: 0, behavior: "smooth" })
              }}
              className="group flex flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground transition-colors [-webkit-touch-callout:none] active:scale-[0.97] data-[status=active]:text-foreground"
            >
              <span className="flex h-8 w-14 items-center justify-center rounded-full transition-colors group-data-[status=active]:bg-accent">
                <page.icon aria-hidden className="size-5" />
              </span>
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Phone shortcut to the agent, so the current chat is one tap away. */
export function AskButton() {
  const { ask } = useAgent()
  return (
    <button
      type="button"
      aria-label="Ask Goatside"
      onClick={() => ask()}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-lg" }),
        "rounded-full active:scale-[0.97] lg:hidden"
      )}
    >
      <MessageCircleQuestionMarkIcon />
    </button>
  )
}

/** Phone account menu: Settings, the agent, and sign out. */
export function AccountMenu({
  viewer,
  className,
}: {
  viewer: Viewer
  className?: string
}) {
  const router = useRouter()
  const signOutAndLeave = useSignOut()
  const { ask } = useAgent()
  const initial = viewer.username.charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        )}
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
          <DropdownMenuItem
            onClick={() => router.navigate({ to: "/settings" })}
          >
            <SettingsIcon />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => ask()}>
            <MessageCircleQuestionMarkIcon />
            Ask Goatside
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOutAndLeave}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
