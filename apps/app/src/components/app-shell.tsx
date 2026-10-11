import { Link, useLocation, useRouter } from "@tanstack/react-router"
import {
  ArrowLeftIcon,
  ChevronsUpDownIcon,
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
import { cn } from "@workspace/ui/lib/utils"
import { useAgent } from "@/components/agent-provider"
import { clearOfflineCopies } from "@/lib/offline"
import { useShortcut } from "@/lib/use-shortcut"
import { type Viewer, signOut } from "@/server/session"

const PAGES = [
  { to: "/", label: "Overview", icon: LayoutDashboardIcon },
  { to: "/transactions", label: "Transactions", icon: ReceiptTextIcon },
  { to: "/accounts", label: "Accounts", icon: WalletCardsIcon },
  { to: "/people", label: "People", icon: UsersIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const

/** Desktop navigation. Phones use the account menu and the bottom composer. */
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
        <DropdownMenuItem onClick={signOutAndLeave}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
export function PageHeader({
  title,
  viewer,
  back = "/",
  action,
}: {
  title: string
  viewer: Viewer
  back?: string
  /** A page-level button, e.g. "Add account". */
  action?: React.ReactNode
}) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <DesktopSidebarTrigger />
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
        <h1 className="font-display text-3xl leading-none">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {action}
        <AccountMenu viewer={viewer} className="lg:hidden" />
      </div>
    </header>
  )
}

/** Phone account menu: pages, the agent, and sign out. */
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
          {PAGES.map((page) => (
            <DropdownMenuItem
              key={page.to}
              onClick={() => router.navigate({ to: page.to })}
            >
              <page.icon />
              {page.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => ask()}>
            <MessageCircleQuestionMarkIcon />
            Ask Goatside
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOutAndLeave}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
