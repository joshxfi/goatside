import { useId } from "react"
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

/**
 * A two-faced coin: gold on the front, silver on the back.
 * - `spinning`: continuous spin, for loading states.
 * - `side`: which face shows; changing it flips the coin.
 * - `toss`: plays a one-time toss on mount that lands on `side`.
 */
export function CoinFlip({
  side = "gold",
  spinning = false,
  toss = false,
  title,
  className,
}: {
  side?: Metal
  spinning?: boolean
  toss?: boolean
  title?: string
  className?: string
}) {
  return (
    <div
      className={cn("coin-stage size-16", className)}
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true })}
    >
      <div className={cn("coin-toss", toss && "coin-toss-once")}>
        <div
          className={cn("coin-flip", spinning && "coin-spinning")}
          data-side={side}
        >
          <Coin metal="gold" className="coin-face size-full" />
          <Coin metal="silver" className="coin-face coin-face-back size-full" />
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
