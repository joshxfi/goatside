import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { AgentProvider } from "@/components/agent-provider"
import { AppSidebar } from "@/components/app-shell"
import { MotionProvider } from "@/components/motion"
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
  return (
    <MotionProvider>
      <AgentProvider enabled={viewer.ai}>
        <SidebarProvider defaultOpen={viewer.sidebarOpen}>
          <AppSidebar viewer={viewer} />
          <SidebarInset className="min-w-0 bg-background">
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </AgentProvider>
    </MotionProvider>
  )
}
