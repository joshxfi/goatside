import { useEffect, useState } from "react"
import { useReducedMotion, useSpring } from "motion/react"

/**
 * A card that leans toward the mouse, with a soft light where the pointer
 * is: it reads as something you can pick up. Mouse only (touch has no
 * hover), off with reduced motion. Springs write CSS variables, so there's
 * no re-render per frame; style the card with the `tilt` class. Returns a
 * callback ref for the card.
 */
export function useTilt<T extends HTMLElement>({ max = 6 } = {}) {
  const [el, setEl] = useState<T | null>(null)
  const reduce = useReducedMotion()
  const spring = { stiffness: 260, damping: 24 }
  const rotateX = useSpring(0, spring)
  const rotateY = useSpring(0, spring)
  const glow = useSpring(0, spring)

  useEffect(() => {
    if (!el || reduce) return
    const set = (name: string, value: string) =>
      el.style.setProperty(name, value)
    const stops = [
      rotateX.on("change", (v) => set("--tilt-x", `${v}deg`)),
      rotateY.on("change", (v) => set("--tilt-y", `${v}deg`)),
      glow.on("change", (v) => set("--tilt-glow", String(v))),
    ]
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return
      const box = el.getBoundingClientRect()
      const x = (event.clientX - box.left) / box.width
      const y = (event.clientY - box.top) / box.height
      rotateX.set((0.5 - y) * max * 2)
      rotateY.set((x - 0.5) * max * 2)
      glow.set(1)
      set("--tilt-px", `${x * 100}%`)
      set("--tilt-py", `${y * 100}%`)
    }
    const leave = () => {
      rotateX.set(0)
      rotateY.set(0)
      glow.set(0)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerleave", leave)
    return () => {
      for (const stop of stops) stop()
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerleave", leave)
    }
  }, [el, reduce, max, rotateX, rotateY, glow])

  return setEl
}
