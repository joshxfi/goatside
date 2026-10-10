import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { getViewer } from "@/server/session"

/** Everything under here requires a signed-in, allowlisted user. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const viewer = await getViewer()
    if (!viewer) throw redirect({ to: "/login" })
    return { viewer }
  },
  component: Outlet,
})
