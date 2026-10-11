/**
 * Motion, used sparingly: rows that grow in and collapse out, cards that
 * leave before the next arrives, and figures that count to a new value.
 * Plain arrivals use the CSS .enter-rise / .enter-fade classes instead.
 * Nothing here runs on first paint, and reduced motion keeps only fades.
 */
import { useLayoutEffect, useRef } from "react"
import { LazyMotion, MotionConfig, useReducedMotion } from "motion/react"
import * as m from "motion/react-m"
import { formatPeso } from "@workspace/core/money"

export { AnimatePresence } from "motion/react"
export { m }

/** The --ease-out curve from globals.css. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

const features = () => import("./motion-features").then((mod) => mod.default)

/** Nothing animates on first paint, so the animation code can load after it. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={features} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: 0.2, ease: EASE_OUT }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}

/**
 * A list item (or block) that grows in and collapses out, so what's around
 * it slides instead of jumping. Use inside <AnimatePresence initial={false}>.
 * Give it no padding or margin: those can't collapse; put them inside.
 */
export function CollapseItem({
  as = "li",
  className,
  children,
}: {
  as?: "li" | "div"
  className?: string
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement | null>(null)
  // Clip only while moving, so focus rings show the rest of the time.
  const clip = (on: boolean) => {
    if (ref.current) ref.current.style.overflow = on ? "hidden" : ""
  }
  // The same values either way, so the server's HTML (which can't know
  // the preference) matches; reduced motion just snaps the height.
  const snap = reduce ? { height: { duration: 0 } } : {}
  const props = {
    className,
    initial: { opacity: 0, height: 0 },
    animate: {
      opacity: 1,
      height: "auto",
      transition: { duration: 0.25, ...snap },
    },
    exit: { opacity: 0, height: 0, transition: { duration: 0.2, ...snap } },
    onAnimationStart: () => clip(true),
    onAnimationComplete: () => clip(false),
    children,
  }
  return as === "div" ? (
    <m.div ref={(el) => void (ref.current = el)} {...props} />
  ) : (
    <m.li ref={(el) => void (ref.current = el)} {...props} />
  )
}

const COUNT_MS = 450

/**
 * A money figure that counts to its new value when it changes, e.g. after
 * logging. First paint shows the value as is. Mid-count it moves in whole
 * pesos, so no decimals flicker by.
 */
export function Figure({
  value,
  sign = false,
}: {
  /** Centavos. */
  value: number
  /** Show + on positive amounts. */
  sign?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  const reduce = useReducedMotion()

  useLayoutEffect(() => {
    const from = shown.current
    // React's own text node, so React's later updates still land on it.
    const node = ref.current?.firstChild
    if (from === value || !(node instanceof Text) || reduce) {
      shown.current = value
      return
    }
    const show = (centavos: number) => {
      shown.current = centavos
      node.data = formatPeso(centavos, { sign })
    }
    show(from)
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      // A frame can be stamped before `start`; never count backwards.
      const t = Math.min(1, Math.max(0, (now - start) / COUNT_MS))
      if (t === 1) return show(value)
      const eased = 1 - (1 - t) ** 4
      show(Math.round((from + (value - from) * eased) / 100) * 100)
      frame = requestAnimationFrame(tick)
    })
    // Interrupted, the next count starts from what's on screen.
    return () => cancelAnimationFrame(frame)
  }, [value, sign, reduce])

  return <span ref={ref}>{formatPeso(value, { sign })}</span>
}
