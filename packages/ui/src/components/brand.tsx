import { useEffect, useEffectEvent, useId, useRef, useState } from "react"
import {
  animate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react"
import { cn } from "cn"

/*
 * The Goatside mark: a coin struck with a capital "G". Drawn as one stroke
 * on a 64×64 grid so it scales from favicon to hero and renders the same
 * without any font.
 */

function reedingPath(count: number, r0: number, r1: number) {
  let d = ""
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const [cos, sin] = [Math.cos(a), Math.sin(a)]
    d += `M${(32 + r0 * cos).toFixed(2)} ${(32 + r0 * sin).toFixed(2)}L${(32 + r1 * cos).toFixed(2)} ${(32 + r1 * sin).toFixed(2)}`
  }
  return d
}

// A capital G: the ring opens at the upper right and drops into a short
// stem that turns into the crossbar.
const G_PATH = "M42.03 22.97 A13.5 13.5 0 1 0 43.92 38.34 V32 H34.5"
const REEDING = reedingPath(40, 27, 29.4)
function Glyph({ strokeWidth }: { strokeWidth: number }) {
  return <path d={G_PATH} strokeWidth={strokeWidth} />
}

type SvgProps = Omit<React.ComponentProps<"svg">, "children"> & {
  /** Accessible name. Omit for decorative use. */
  title?: string
}

function a11y(title?: string) {
  return title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const)
}

/** Line-art mark in `currentColor`. Drop the rim below ~20px. */
export function CoinMark({
  rim = true,
  title,
  className,
  ...props
}: SvgProps & { rim?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-8 shrink-0", className)}
      {...a11y(title)}
      {...props}
    >
      {rim && (
        <>
          <circle cx="32" cy="32" r="30.5" strokeWidth="2" />
          <path d={REEDING} strokeWidth="1.2" />
          <circle cx="32" cy="32" r="25" strokeWidth="1.5" />
        </>
      )}
      <Glyph strokeWidth={rim ? 3.4 : 5} />
    </svg>
  )
}

const METALS = {
  gold: {
    hi: "#f6dc8a",
    mid: "#d6a63a",
    lo: "#9a6b17",
    ink: "#5a3d0a",
    edge: "#7d5512",
  },
  silver: {
    hi: "#f4f5f7",
    mid: "#bfc4cb",
    lo: "#80868e",
    ink: "#3b3f45",
    edge: "#6b7078",
  },
} as const

export type Metal = keyof typeof METALS

/** Struck-metal coin in gold or silver. */
export function Coin({
  metal = "gold",
  title,
  className,
  ...props
}: SvgProps & { metal?: Metal }) {
  const id = useId()
  const c = METALS[metal]
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-16 shrink-0", className)}
      {...a11y(title)}
      {...props}
    >
      <defs>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.hi} />
          <stop offset=".45" stopColor={c.mid} />
          <stop offset="1" stopColor={c.lo} />
        </linearGradient>
        <linearGradient id={`${id}-field`} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={c.hi} />
          <stop offset=".5" stopColor={c.mid} />
          <stop offset="1" stopColor={c.lo} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${id}-rim)`} />
      <path
        d={REEDING}
        stroke={c.edge}
        strokeOpacity=".55"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="32" r="25.5" fill={`url(#${id}-field)`} />
      <circle
        cx="32"
        cy="32"
        r="25.5"
        fill="none"
        stroke={c.edge}
        strokeOpacity=".5"
      />
      <g
        stroke={c.ink}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Glyph strokeWidth={3.8} />
      </g>
    </svg>
  )
}

/** Degrees of rotateX that show a face: gold at 0, silver at 180. */
const FACE_ANGLE: Record<Metal, number> = { gold: 0, silver: 180 }

/** The next angle past `from` that shows `side`, after `turns` full turns. */
function landingAngle(from: number, side: Metal, turns: number) {
  const base = from + turns * 360
  const offset = (((FACE_ANGLE[side] - base) % 360) + 360) % 360
  return base + offset
}

/**
 * A two-faced coin, gold on the front and silver on the back, with an edge
 * you see as it turns.
 * - `side`: which face shows.
 * - `toss`: tosses once on mount, landing on `side`.
 * - `tossKey`: tosses again each time it changes, landing on `side`.
 * - `spinning`: flips in place, for loading states.
 * - `tilt`: leans toward the pointer, to invite a click.
 */
export function CoinFlip({
  side = "gold",
  spinning = false,
  toss = false,
  tossKey,
  tilt = false,
  title,
  className,
}: {
  side?: Metal
  spinning?: boolean
  toss?: boolean
  tossKey?: number
  tilt?: boolean
  title?: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const flight = useRef<HTMLDivElement>(null)
  const lean = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const shadow = useRef<HTMLDivElement>(null)
  // Height as a share of the coin's size, rotation in degrees.
  const height = useMotionValue(0)
  const angle = useMotionValue(FACE_ANGLE[side])
  // Only the first render sets the angle; Motion owns it after that.
  const [startAngle] = useState(FACE_ANGLE[side])
  const leanX = useSpring(0, { stiffness: 220, damping: 18 })
  const leanY = useSpring(0, { stiffness: 220, damping: 18 })
  const tossing = useRef(false)

  // Motion values write straight to the DOM: no re-render per frame.
  useEffect(() => {
    const paint = () => {
      const h = height.get()
      if (flight.current)
        flight.current.style.transform = `translateY(${-h * 100}%)`
      if (body.current)
        body.current.style.transform = `rotateX(${angle.get()}deg)`
      if (lean.current)
        lean.current.style.transform = `rotateX(${leanX.get()}deg) rotateY(${leanY.get()}deg)`
      if (shadow.current) {
        // The shadow stays on the ground: smaller and fainter as it rises.
        const k = Math.min(1, h / 1.15)
        shadow.current.style.transform = `scale(${1 - k * 0.45})`
        shadow.current.style.opacity = String(1 - k * 0.6)
      }
    }
    const stops = [height, angle, leanX, leanY].map((v) =>
      v.on("change", paint)
    )
    return () => stops.forEach((stop) => stop())
  }, [height, angle, leanX, leanY])

  const lastKey = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  // Tosses on mount (`toss`) or when `tossKey` changes; a plain `side`
  // change turns the coin over in place.
  const move = useEffectEvent((key: number | undefined, face: Metal) => {
    const onMount = !mounted.current
    const play = onMount ? toss : key !== lastKey.current
    mounted.current = true
    lastKey.current = key
    if (!play || reduce) {
      if (angle.get() % 360 === FACE_ANGLE[face]) return
      const to = landingAngle(angle.get(), face, 0)
      if (reduce) angle.set(to)
      else animate(angle, to, { duration: 0.6, ease: [0.65, 0, 0.35, 1] })
      return
    }
    tossing.current = true
    leanX.set(0)
    leanY.set(0)
    const from = angle.get()
    const to = landingAngle(from, face, 2)
    const AIR = 1.05
    // Up slowing, down speeding up, like a real throw; the spin is even.
    const rise = animate(height, [0, 1.15, 0], {
      duration: AIR,
      times: [0, 0.5, 1],
      ease: [
        [0.33, 0.9, 0.5, 1],
        [0.5, 0, 0.67, 0.1],
      ],
    })
    const spin = animate(angle, [from, to], { duration: AIR, ease: "linear" })
    let landing: ReturnType<typeof animate>[] = []
    void Promise.all([rise, spin]).then(() => {
      // Lands, hops a little and rocks to rest.
      landing = [
        animate(height, [0, 0.08, 0], {
          duration: 0.32,
          ease: ["easeOut", "easeIn"],
        }),
        animate(angle, [to, to - 16, to + 7, to - 2, to], {
          duration: 0.6,
          ease: "easeOut",
        }),
      ]
      void Promise.all(landing).then(() => (tossing.current = false))
    })
    return () => {
      rise.stop()
      spin.stop()
      for (const a of landing) a.stop()
      tossing.current = false
      // Cut short on mount (React's dev double run): toss again next time.
      if (onMount) mounted.current = false
    }
  })
  useEffect(() => move(tossKey, side), [tossKey, side])

  const onPointerMove = (event: React.PointerEvent) => {
    if (!tilt || reduce || tossing.current || event.pointerType !== "mouse")
      return
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    leanX.set(-y * 24)
    leanY.set(x * 24)
  }
  const onPointerLeave = () => {
    leanX.set(0)
    leanY.set(0)
  }

  return (
    <div
      className={cn("coin-stage relative size-16", className)}
      onPointerMove={tilt ? onPointerMove : undefined}
      onPointerLeave={tilt ? onPointerLeave : undefined}
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true })}
    >
      <div ref={shadow} className="coin-shadow" />
      <div ref={flight} className="coin-3d size-full">
        <div ref={lean} className="coin-3d size-full">
          <div
            ref={body}
            className="coin-3d size-full"
            style={{ transform: `rotateX(${startAngle}deg)` }}
          >
            <div
              className={cn("coin-3d size-full", spinning && "coin-spinning")}
            >
              <Coin metal="gold" className="coin-face size-full" />
              <span className="coin-edge" />
              <Coin
                metal="silver"
                className="coin-face coin-face-back size-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mark + name, for headers. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-brand text-2xl leading-none",
        className
      )}
    >
      <CoinMark className="size-[1.25em]" />
      Goatside
    </span>
  )
}
