/**
 * Catching the same payment logged twice. Code finds an earlier entry with
 * the same amount around the same day; the decision model judges whether
 * it's really the same payment (coffee two days running isn't).
 */
import { type Experimental_DecisionModel, experimental_decide } from "ai"
import { formatPeso } from "@workspace/core/money"

/** At or above this, the owner is asked whether it's a repeat. */
export const LIKELY_DUPLICATE = 0.7
/** Same text and amount within this many minutes is a repeat without asking a model. */
export const OBVIOUS_WINDOW_MIN = 15

export interface EarlierEntry {
  description: string
  /** Signed centavos. */
  amount: number
  localDate: string
  minutesAgo: number
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

export function obviousDuplicate(
  line: { description: string; amount: number; localDate: string },
  earlier: EarlierEntry
): boolean {
  return (
    normalize(line.description) === normalize(earlier.description) &&
    line.amount === earlier.amount &&
    line.localDate === earlier.localDate &&
    earlier.minutesAgo <= OBVIOUS_WINDOW_MIN
  )
}

const ago = (minutes: number) =>
  minutes < 60
    ? `${Math.max(1, Math.round(minutes))} minutes ago`
    : minutes < 48 * 60
      ? `${Math.round(minutes / 60)} hours ago`
      : `${Math.round(minutes / 1440)} days ago`

/** P(the new line and the earlier entry are one payment logged twice). */
export async function askDuplicate(
  model: Experimental_DecisionModel,
  line: { description: string; amount: number; localDate: string },
  earlier: EarlierEntry,
  { abortSignal }: { abortSignal?: AbortSignal } = {}
): Promise<number> {
  const { answers } = await experimental_decide({
    model,
    state: {
      new_entry: {
        text: line.description || "(no description)",
        amount: formatPeso(line.amount),
        date: line.localDate,
      },
      earlier_entry: {
        text: earlier.description || "(no description)",
        amount: formatPeso(earlier.amount),
        date: earlier.localDate,
      },
      time_between_logging: ago(earlier.minutesAgo).replace(" ago", ""),
    },
    questions: {
      same: {
        type: "boolean",
        instructions:
          "Is the new entry the same single payment as the earlier one, entered a second time by mistake?",
        criteria: {
          true: "One payment logged twice: usually minutes apart, or a bill or subscription that is only paid once",
          false:
            "Two real payments: everyday things bought or ridden again hours later (jeep, grab, coffee, snacks, 7-eleven), or on different days",
        },
      },
    },
    abortSignal,
    maxRetries: 1,
  })
  const same = answers.same
  return same?.type === "boolean" ? same.probability : 0
}
