import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { RefreshCwIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { isStandalone } from "@/lib/offline"

/** How far to pull, in CSS pixels after damping, before letting go refreshes. */
const THRESHOLD = 64
const MAX = 96

/**
 * Pull down at the top of a page to reload its data. Only when installed:
 * a browser tab has its own pull-to-refresh, an installed app has no reload
 * button at all.
 */
export function PullToRefresh() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const refresh = useEffectEvent(() =>
    Promise.all([router.invalidate(), queryClient.invalidateQueries()])
  )

  useEffect(() => {
    if (!isStandalone()) return
    let startY: number | null = null
    let distance = 0

    const start = (event: TouchEvent) => {
      if (busyRef.current || event.touches.length !== 1) return
      if (window.scrollY > 0) return
      const target = event.target as Element | null
      // Drawers, sheets and fields own their own drags.
      if (target?.closest("[role=dialog], input, textarea, [data-no-pull]"))
        return
      startY = event.touches[0]!.clientY
    }
    const move = (event: TouchEvent) => {
      if (startY === null) return
      const dy = event.touches[0]!.clientY - startY
      distance = dy > 0 && window.scrollY <= 0 ? Math.min(dy * 0.5, MAX) : 0
      setPull(distance)
    }
    const end = async () => {
      if (startY === null) return
      startY = null
      const reached = distance >= THRESHOLD
      distance = 0
      if (!reached) return setPull(0)
      busyRef.current = true
      setBusy(true)
      setPull(THRESHOLD)
      try {
        await refresh()
      } finally {
        busyRef.current = false
        setBusy(false)
        setPull(0)
      }
    }

    window.addEventListener("touchstart", start, { passive: true })
    window.addEventListener("touchmove", move, { passive: true })
    window.addEventListener("touchend", end)
    window.addEventListener("touchcancel", end)
    return () => {
      window.removeEventListener("touchstart", start)
      window.removeEventListener("touchmove", move)
      window.removeEventListener("touchend", end)
      window.removeEventListener("touchcancel", end)
    }
  }, [])

  if (pull === 0 && !busy) return null
  const progress = Math.min(1, pull / THRESHOLD)
  return (
    <output
      aria-label={busy ? "Refreshing" : "Pull to refresh"}
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-50 flex justify-center lg:hidden"
      style={{ transform: `translateY(${pull - 40}px)` }}
    >
      <span
        className="flex size-9 items-center justify-center rounded-full border bg-card shadow-sm"
        style={{ opacity: progress }}
      >
        <RefreshCwIcon
          aria-hidden
          className={cn(
            "size-4",
            progress === 1 ? "text-foreground" : "text-muted-foreground",
            busy && "animate-spin motion-reduce:animate-none"
          )}
          style={busy ? undefined : { rotate: `${progress * 270}deg` }}
        />
      </span>
    </output>
  )
}
