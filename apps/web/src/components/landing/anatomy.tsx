import { useState } from "react"
import {
  CircleHelpIcon,
  CodeIcon,
  HistoryIcon,
  SparklesIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { DemoCard } from "./ui"

type Source = "code" | "agent" | "memory"

interface Part {
  label: string
  value: string
  source: Source
  /** The agent's confidence, and the bar it has to clear to act alone. */
  confidence?: number
  threshold?: number
  note?: string
}

interface Example {
  line: string
  parts: Part[]
  outcome: { asks: boolean; text: string }
}

/*
 * The thresholds are the app's (packages/ai, resolveLine): a direction is
 * applied at 0.85, a category at 0.6, repeating at 0.8 (0.4 once seen in an
 * earlier month). The confidences are examples of what the model returns.
 */
const EXAMPLES: Example[] = [
  {
    line: "350 lunch yesterday via gcash",
    parts: [
      { label: "Amount", value: "₱350", source: "code" },
      { label: "Date", value: "Yesterday", source: "code" },
      { label: "Account", value: "GCash", source: "code" },
      {
        label: "Money out or in",
        value: "Out",
        source: "agent",
        confidence: 0.98,
        threshold: 0.85,
      },
      {
        label: "Category",
        value: "🍜 Food",
        source: "agent",
        confidence: 0.94,
        threshold: 0.6,
      },
    ],
    outcome: { asks: false, text: "Filed. Nothing to ask." },
  },
  {
    line: "500 from tita",
    parts: [
      { label: "Amount", value: "₱500", source: "code" },
      { label: "Date", value: "Today", source: "code" },
      { label: "Account", value: "GCash (your default)", source: "code" },
      {
        label: "Money out or in",
        value: "In?",
        source: "agent",
        confidence: 0.58,
        threshold: 0.85,
      },
    ],
    outcome: {
      asks: true,
      text: "Saved with its best guess, and asks: ₱500 for “from tita”: was that money out or in?",
    },
  },
  {
    line: "120 kape",
    parts: [
      { label: "Amount", value: "₱120", source: "code" },
      { label: "Date", value: "Today", source: "code" },
      { label: "Account", value: "GCash (your default)", source: "code" },
      {
        label: "Money out, Food",
        value: "From your past entries",
        source: "memory",
        note: "You filed “kape” under Food before, so the model isn't asked at all.",
      },
    ],
    outcome: { asks: false, text: "Filed the way you did last time." },
  },
  {
    line: "89 spotify via bpi card",
    parts: [
      { label: "Amount", value: "₱89", source: "code" },
      { label: "Account", value: "BPI Card", source: "code" },
      {
        label: "Category",
        value: "🔁 Subscriptions",
        source: "agent",
        confidence: 0.97,
        threshold: 0.6,
      },
      {
        label: "Repeats monthly",
        value: "Yes",
        source: "agent",
        confidence: 0.72,
        threshold: 0.4,
        note: "Seen in an earlier month, so the bar is lower.",
      },
    ],
    outcome: {
      asks: false,
      text: "Filed, and counted once a month in your pace.",
    },
  },
]

const SOURCES: Record<Source, { label: string; icon: typeof CodeIcon }> = {
  code: { label: "Read by code", icon: CodeIcon },
  agent: { label: "The agent", icon: SparklesIcon },
  memory: { label: "Your history", icon: HistoryIcon },
}

/** One line, taken apart: what code reads, what the agent judges, and when it asks. */
export function Anatomy() {
  const [index, setIndex] = useState(0)
  const example = EXAMPLES[index]!

  return (
    <DemoCard className="flex flex-col gap-4 p-4 md:p-5">
      <div
        role="tablist"
        aria-label="Example lines"
        className="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-0.5 md:-mx-5 md:px-5"
      >
        {EXAMPLES.map((e, i) => (
          <button
            key={e.line}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 font-mono text-xs whitespace-nowrap transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]",
              i === index
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
            )}
          >
            {e.line}
          </button>
        ))}
      </div>

      <ul
        key={index}
        className="flex flex-col divide-y rounded-2xl border bg-background/50"
      >
        {example.parts.map((part, i) => {
          const Source = SOURCES[part.source]
          const passes =
            part.confidence === undefined ||
            part.confidence >= (part.threshold ?? 0)
          return (
            <li
              key={part.label}
              className="enter-rise flex flex-col gap-2 px-3.5 py-3"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm text-muted-foreground">
                  {part.label}
                </span>
                <span className="text-right font-medium">{part.value}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Source.icon aria-hidden className="size-3.5 shrink-0" />
                <span className="shrink-0">{Source.label}</span>
                {part.confidence !== undefined && (
                  <Confidence
                    value={part.confidence}
                    threshold={part.threshold ?? 0}
                    passes={passes}
                  />
                )}
              </div>
              {part.note && (
                <p className="text-xs text-muted-foreground">{part.note}</p>
              )}
            </li>
          )
        })}
      </ul>

      <p
        key={`outcome-${index}`}
        className={cn(
          "enter-fade flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm",
          example.outcome.asks ? "bg-bronze/12" : "bg-muted"
        )}
      >
        {example.outcome.asks && (
          <CircleHelpIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-bronze"
          />
        )}
        {example.outcome.text}
      </p>
    </DemoCard>
  )
}

/** A confidence bar with a tick where the agent may act on its own. */
function Confidence({
  value,
  threshold,
  passes,
}: {
  value: number
  threshold: number
  passes: boolean
}) {
  return (
    <span className="ml-auto flex min-w-0 items-center gap-2">
      <span className="sr-only">
        Confidence {Math.round(value * 100)}%, needs{" "}
        {Math.round(threshold * 100)}%
      </span>
      <span
        aria-hidden
        className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-28"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            passes ? "bg-foreground/70" : "bg-bronze"
          )}
          style={{ width: `${value * 100}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-background"
          style={{ left: `${threshold * 100}%` }}
        />
      </span>
      <span aria-hidden className="figure w-16 text-right">
        {value.toFixed(2)} {passes ? "≥" : "<"} {threshold}
      </span>
    </span>
  )
}
