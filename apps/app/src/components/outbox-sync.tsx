import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@workspace/ui/components/sonner"
import { flush, useOnline, usePending } from "@/lib/outbox"

const RETRY_MS = 30_000

/**
 * Sends entries that waited on this phone: when the connection returns,
 * when the app comes back to the foreground, and every half minute while
 * any are left. Lives in the app layout, so it runs on every page.
 */
export function OutboxSync() {
  const queryClient = useQueryClient()
  const online = useOnline()
  const waiting = usePending().filter((p) => !p.savedAs).length
  // Entries already reported as failing; once each is enough.
  const warned = useRef(new Set<string>())

  useEffect(() => {
    if (!online || !waiting) return
    let stopped = false
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["ledger"] })

    async function run() {
      const sent = await flush(refresh)
      if (stopped) return
      const saved = [...sent.values()].filter((s) => s.kind === "saved").length
      if (saved) {
        toast(
          `Synced ${saved} ${saved === 1 ? "entry" : "entries"} logged offline.`
        )
      }
      const failed = [...sent]
        .filter(([, s]) => s.kind === "failed")
        .map(([id]) => id)
      if (failed.some((id) => !warned.current.has(id))) {
        for (const id of failed) warned.current.add(id)
        toast.error("Couldn't sync everything yet.", {
          description: "It's safe on this phone. Goatside will keep trying.",
          id: "outbox-failed",
        })
      }
    }

    void run()
    const timer = setInterval(() => void run(), RETRY_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void run()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [online, waiting, queryClient])

  return null
}
