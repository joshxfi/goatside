import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { CoinFlip, Wordmark, type Metal } from "@workspace/ui/components/brand"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export const Route = createFileRoute("/")({ component: Landing })

const REPO_URL = "https://github.com/joshxfi/goatside"

const EXAMPLES = [
  {
    input: "180 iced coffee",
    direction: "out",
    amount: "−₱180",
    tags: ["Food", "Today"],
  },
  {
    input: "+18000 client payment",
    direction: "in",
    amount: "+₱18,000",
    tags: ["Freelance"],
  },
  {
    input: "-2400 dinner with sam and jo split 3",
    direction: "out",
    amount: "−₱800",
    tags: ["Food", "Sam owes ₱800", "Jo owes ₱800"],
  },
] as const

function Landing() {
  const [side, setSide] = useState<Metal>("gold")

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col px-4">
      <header className="flex items-center justify-between py-5">
        <Wordmark />
        <a
          href={REPO_URL}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          GitHub
        </a>
      </header>

      <main className="flex flex-1 flex-col gap-24 pt-10 pb-24 md:pt-20">
        <section className="grid items-center gap-12 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-6">
            <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-balance md:text-7xl">
              Which side of the coin are you on?
            </h1>
            <p className="max-w-md text-lg text-pretty text-muted-foreground">
              Goatside is an open-source, personal finance tracker that you host
              yourself. Type what happened in plain words, and its AI agent
              files it into a month you can actually read.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href={REPO_URL}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 px-5 text-base"
                )}
              >
                Deploy your own
              </a>
              <a
                href="#how"
                className={cn(
                  buttonVariants({ size: "lg", variant: "ghost" }),
                  "h-11 px-5 text-base"
                )}
              >
                See how it works
              </a>
            </div>
          </div>

          <div className="flex flex-col items-center gap-6">
            <button
              type="button"
              onClick={() => setSide((s) => (s === "gold" ? "silver" : "gold"))}
              className="rounded-full transition-transform duration-150 ease-out outline-none focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-[0.97]"
              aria-label="Flip the coin"
            >
              <CoinFlip
                side={side}
                toss
                className="size-48 drop-shadow-[0_18px_24px_rgb(0_0_0/0.18)] md:size-60"
              />
            </button>
          </div>
        </section>

        <section id="how" className="flex scroll-mt-8 flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-4xl font-semibold tracking-tight">
              One line in. A whole ledger out.
            </h2>
            <p className="max-w-lg text-muted-foreground">
              Your amount is read exactly as typed. The AI only adds meaning:
              category, place, people, date. It learns from every fix you make.
            </p>
          </div>
          <ul className="grid gap-3 md:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <li
                key={ex.input}
                className="flex flex-col gap-4 rounded-2xl border bg-card p-4"
              >
                <code className="rounded-lg bg-muted px-3 py-2 font-mono text-sm">
                  {ex.input}
                </code>
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {ex.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span
                    className={cn(
                      "figure shrink-0 text-2xl leading-none font-semibold whitespace-nowrap",
                      ex.direction === "in"
                        ? "text-income-foreground"
                        : "text-expense-foreground"
                    )}
                  >
                    {ex.amount}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-4xl font-semibold tracking-tight">
              Your GOAT days, on record.
            </h2>
            <p className="text-muted-foreground">
              Lowest-spend week of all time. Longest streak under budget. Best
              savings month. Goatside keeps score so steady climbing is
              something you can see.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="text-4xl font-semibold tracking-tight">
              Built for one person: you.
            </h2>
            <p className="text-muted-foreground">
              There’s no Goatside service to sign up for. You deploy your own
              copy to Vercel with a Turso database and an AI Gateway key, and it
              only lets you in. Your ledger lives in your own database.
            </p>
          </div>
        </section>
      </main>

      <footer className="flex items-center justify-between border-t py-6 text-sm text-muted-foreground">
        <span>Open source. Self-hosted. Steady climbing.</span>
        <a href={REPO_URL} className="hover:text-foreground">
          GitHub
        </a>
      </footer>
    </div>
  )
}
