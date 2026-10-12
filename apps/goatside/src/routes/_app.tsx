import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { setCurrency } from "@workspace/core/money"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { AgentProvider } from "@/components/agent-provider"
import { AppSidebar, TabBar } from "@/components/app-shell"
import { MotionProvider } from "@/components/motion"
import { OutboxSync } from "@/components/outbox-sync"
import { PullToRefresh } from "@/components/pull-to-refresh"
import { useTyping } from "@/lib/use-typing"
import { getViewer } from "@/server/session"

/** Everything under here requires a signed-in, allowlisted user. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const viewer = await getViewer()
    if (!viewer) throw redirect({ to: "/login" })
    return { viewer }
  },
  component: AppLayout,
})

/** Sidebar on desktop; on phones the sidebar stays closed and pages stand alone. */
function AppLayout() {
  const { viewer } = Route.useRouteContext()
  const typing = useTyping()
  // Before anything below renders an amount. Changing the currency remounts
  // the tree (the key), so nothing keeps an amount formatted the old way.
  setCurrency(viewer.currency)
  return (
    <MotionProvider key={viewer.currency}>
      <OutboxSync />
      <PullToRefresh />
      <AgentProvider enabled={viewer.ai}>
        <SidebarProvider
          defaultOpen={viewer.sidebarOpen}
          data-typing={typing || undefined}
          // The phone tab bar's height, so pages and the composer clear it.
          className="[--tab-bar:calc(4rem+env(safe-area-inset-bottom))] data-typing:[--tab-bar:0px] lg:[--tab-bar:0px]"
        >
          <AppSidebar viewer={viewer} />
          <SidebarInset className="min-w-0 bg-background">
            <Outlet />
            <TabBar />
          </SidebarInset>
        </SidebarProvider>
      </AgentProvider>
    </MotionProvider>
  )
}
