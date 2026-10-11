import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  CloudOffIcon,
  CodeIcon,
  DatabaseIcon,
  HistoryIcon,
  KeyboardIcon,
  PencilLineIcon,
  MessageCircleQuestionMarkIcon,
  SendIcon,
  ShieldCheckIcon,
  TableIcon,
  type LucideIcon,
} from "lucide-react"
import {
  CoinFlip,
  CoinMark,
  Wordmark,
  type Metal,
} from "@workspace/ui/components/brand"
import { buttonVariants } from "@workspace/ui/components/button"
import { ThemeSwitch } from "@workspace/ui/components/theme-switch"
import { cn } from "@workspace/ui/lib/utils"
import { AccountsDemo } from "@/components/landing/accounts-demo"
import { Anatomy } from "@/components/landing/anatomy"
import { AskDemo } from "@/components/landing/ask-demo"
import { ImportDemo } from "@/components/landing/import-demo"
import { DashboardPreview } from "@/components/landing/dashboard-preview"
import { LiveComposer } from "@/components/landing/live-composer"
import { PeopleDemo } from "@/components/landing/people-demo"
import { DemoNote, SectionHeading } from "@/components/landing/ui"
import {
  AUTHOR,
  REPO_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  absolute,
} from "@/lib/site"

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [{ property: "og:url", content: absolute("/") }],
    links: [{ rel: "canonical", href: absolute("/") }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(STRUCTURED_DATA),
      },
    ],
  }),
})

/** What search engines read about the project: an app, free, MIT licensed. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: absolute("/"),
  image: absolute("/og.png"),
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  isAccessibleForFree: true,
  license: "https://opensource.org/licenses/MIT",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
  sameAs: [REPO_URL],
}

const ctaClass = "h-11 px-5 text-base"

function Landing() {
  return (
    <div className="flex min-h-svh flex-col">
      <Nav />
      <main className="reveal-sections mx-auto flex w-full max-w-6xl flex-1 flex-col gap-28 px-4 pt-8 pb-28 md:gap-40 md:px-6 md:pt-16">
        <Hero />
        <HowItFiles />
        <Dashboard />
        <People />
        <Accounts />
        <Statements />
        <Ask />
        <Yours />
        <Deploy />
      </main>
      <Footer />
    </div>
  )
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-transparent bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
        <Link to="/" aria-label="Goatside home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-sm text-muted-foreground">
          <a
            href="#how"
            className="hidden transition-colors hover:text-foreground md:inline"
          >
            How it works
          </a>
          <a
            href="#dashboard"
            className="hidden transition-colors hover:text-foreground md:inline"
          >
            Dashboard
          </a>
          <a
            href="#ask"
            className="hidden transition-colors hover:text-foreground md:inline"
          >
            Agent
          </a>
          <Link
            to="/docs/$"
            className="transition-colors hover:text-foreground"
          >
            Docs
          </Link>
          <a
            href={REPO_URL}
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <ThemeSwitch />
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      <div className="flex flex-col gap-6">
        <span className="flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground">
          <CoinMark className="size-4.5" />
          Open source and self-hosted
        </span>
        <h1 className="font-display text-5xl leading-[1.02] tracking-tight text-balance md:text-7xl">
          <span className="block">Type what you spent.</span>
          <span className="block text-muted-foreground">It files itself.</span>
        </h1>
        <p className="max-w-lg text-lg text-pretty text-muted-foreground">
          Goatside is a personal finance tracker you host yourself. Its agent
          picks the category, the account and who owes whom, and asks when it
          isn't sure. Your month shows up as charts by category and by day.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/docs/$"
            params={{ _splat: "self-hosting" }}
            className={cn(buttonVariants({ size: "lg" }), ctaClass)}
          >
            Deploy your own
          </Link>
          <Link
            to="/docs/$"
            className={cn(
              buttonVariants({ size: "lg", variant: "ghost" }),
              ctaClass
            )}
          >
            Read the docs
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Runs on the free tiers of Vercel and Turso. AI for a month of entries
          should cost well under a dollar.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <LiveComposer />
        <DemoNote>
          Try it. This is Goatside's own parser, running in your browser. It
          reads amounts, dates, splits, accounts and transfers exactly as the
          app does. Categories here come from a short word list. Your own
          instance asks the agent.
        </DemoNote>
      </div>
    </section>
  )
}

function HowItFiles() {
  return (
    <section
      className="grid scroll-mt-24 items-start gap-10 lg:grid-cols-2 lg:gap-16"
      id="how"
    >
      <div className="flex flex-col gap-8 lg:sticky lg:top-28">
        <SectionHeading
          kicker="How it files a line"
          title="Code reads the numbers. The agent reads the meaning."
        >
          <p>
            Plain code parses the amount, date, split and account, so no model
            can change a number you typed. The agent judges the rest and gives
            each call a confidence. Below the bar, it asks you instead of
            guessing.
          </p>
        </SectionHeading>
        <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Point icon={CodeIcon} title="Amounts stay as typed">
            Parsed by code, never by a model.
          </Point>
          <Point
            icon={MessageCircleQuestionMarkIcon}
            title="Asks when it isn't sure"
          >
            One tap confirms or fixes its guess.
          </Point>
          <Point icon={HistoryIcon} title="Learns from your fixes">
            Every answer becomes an example for next time.
          </Point>
        </ul>
      </div>
      <div className="min-w-0">
        <Anatomy />
      </div>
    </section>
  )
}

function Dashboard() {
  return (
    <section className="flex scroll-mt-24 flex-col gap-10" id="dashboard">
      <SectionHeading
        kicker="On a wide screen"
        title="Your month, readable at a glance."
      >
        <p>
          Your pace against last month with a projection to month end, spending
          by category, a calendar of daily spending, and six months of trend.
          Hover any chart for the numbers.
        </p>
      </SectionHeading>
      <div className="flex flex-col gap-3">
        <DashboardPreview />
        <DemoNote>
          Sample months. Bills that repeat count once in the projection.
          Everyday spending runs at its daily rate.
        </DemoNote>
      </div>
      <ul className="grid gap-6 sm:grid-cols-3">
        <Point icon={TableIcon} title="The full ledger">
          Search, filter and sort every entry. Re-file a batch at once, or
          export what you filtered as a CSV.
        </Point>
        <Point icon={PencilLineIcon} title="Edit anything by hand">
          Amount, type, category, account, who it was split with. Every fix
          teaches the agent.
        </Point>
        <Point icon={KeyboardIcon} title="Keyboard first">
          <Kbd>⌘</Kbd> <Kbd>K</Kbd> to log from anywhere, <Kbd>⌘</Kbd>{" "}
          <Kbd>J</Kbd> to ask.
        </Point>
      </ul>
    </section>
  )
}

function People() {
  return (
    <section
      className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16"
      id="people"
    >
      <SectionHeading
        kicker="People and IOUs"
        title="Splits and IOUs, kept straight."
      >
        <p>
          Mention someone and Goatside keeps track of what's owed. Split a bill
          and only your share counts as spending. Settle up in one tap, or let
          the agent draft a friendly reminder.
        </p>
        <Lines
          lines={[
            "1000 lent nini",
            "+500 daniel paid me back",
            "350 lunch, daniel paid",
          ]}
        />
      </SectionHeading>
      <div className="min-w-0">
        <PeopleDemo />
      </div>
    </section>
  )
}

function Accounts() {
  return (
    <section
      className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16"
      id="accounts"
    >
      <div className="lg:order-2">
        <SectionHeading
          kicker="Accounts and transfers"
          title="Balances for every bank, wallet and card."
        >
          <p>
            Banks, e-wallets, credit cards and cash, each with its balance. Say
            where you paid from and Goatside files it there. Cash-ins, ATM
            withdrawals and card payments are transfers, so they never count as
            spending. Fell behind? Import the account's statement.
          </p>
          <Lines
            lines={["200 taxi via gcash", "1500 groceries using bpi card"]}
          />
        </SectionHeading>
      </div>
      <div className="min-w-0">
        <AccountsDemo />
      </div>
    </section>
  )
}

function Statements() {
  return (
    <section
      className="grid scroll-mt-24 items-start gap-10 lg:grid-cols-2 lg:gap-16"
      id="statements"
    >
      <SectionHeading
        kicker="Statements"
        title="Catch up from your bank's statement."
      >
        <p>
          Pick the PDF or CSV your bank or card sends you. Goatside reads it on
          your device, checks every row against the statement's own balances,
          and links the entries you already typed instead of adding them again.
        </p>
        <p className="mt-3">
          Nothing is saved until you review it, and undo takes the whole import
          back.
        </p>
      </SectionHeading>
      <div className="flex min-w-0 flex-col gap-3">
        <ImportDemo />
        <DemoNote>
          A scripted preview with made-up rows. In the app, the file and its
          password never leave your device.
        </DemoNote>
      </div>
    </section>
  )
}

function Ask() {
  return (
    <section
      className="grid scroll-mt-24 items-start gap-10 lg:grid-cols-2 lg:gap-16"
      id="ask"
    >
      <SectionHeading
        className="lg:order-2"
        kicker="Ask Goatside"
        title="Ask in your own words. Nothing changes until you say so."
      >
        <p>
          Answers come from your ledger through read-only lookups, never from a
          guess. Ask it to re-file, log or delete entries and it shows you
          exactly which ones will change first. You can undo every change.
        </p>
      </SectionHeading>
      <div className="flex min-w-0 flex-col gap-3">
        <AskDemo />
        <DemoNote>
          A scripted preview of the agent, on the sample month.
        </DemoNote>
      </div>
    </section>
  )
}

function Yours() {
  return (
    <section className="flex flex-col gap-10" id="yours">
      <SectionHeading
        kicker="Privacy"
        title="Your ledger stays in your own database."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        <Tile icon={DatabaseIcon} title="Your database">
          Your ledger lives in your own Turso database. There's no Goatside
          server, no account with us and no analytics. The code is open, so you
          can read every line.
        </Tile>
        <Tile icon={SendIcon} title="What leaves, and where">
          Entry text goes to TypeSafe's Jev, which files it, and your questions
          go to DeepSeek, both through your own AI Gateway. Swap either model
          with one variable. Bank statements are read on your device, and only
          their rows are saved.
        </Tile>
        <Tile icon={CloudOffIcon} title="Works offline">
          Install it on your phone. Entries typed with no signal wait on your
          phone and sync on their own when you're back online.
          <span className="mt-3 flex items-center gap-1.5 text-xs text-bronze">
            <CloudOffIcon aria-hidden className="size-3" />
            Waiting to sync · 180 iced coffee
          </span>
        </Tile>
        <Tile icon={ShieldCheckIcon} title="Works without AI">
          No AI configured? Entries still save, and lines without a sign still
          get an "in or out?" card. You can file everything by hand.
        </Tile>
      </ul>
    </section>
  )
}

function Deploy() {
  const [side, setSide] = useState<Metal>("gold")
  const [tosses, setTosses] = useState(0)

  return (
    <section className="flex flex-col items-center gap-10 rounded-[2rem] border bg-card px-5 py-14 text-center md:px-10 md:py-20">
      <button
        type="button"
        onClick={() => {
          // A fair toss: either face, whatever showed before.
          setSide(Math.random() < 0.5 ? "gold" : "silver")
          setTosses((n) => n + 1)
        }}
        className="rounded-full transition-transform duration-150 ease-out outline-none focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-[0.97]"
        aria-label="Flip the coin"
      >
        <CoinFlip
          side={side}
          tossKey={tosses || undefined}
          tilt
          className="size-28 md:size-36"
        />
      </button>
      <div className="flex max-w-xl flex-col gap-3">
        <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-balance md:text-6xl">
          Your own Goatside in about 15 minutes.
        </h2>
        <p className="text-pretty text-muted-foreground md:text-lg">
          Fork the repo, create a Turso database, and import it into Vercel. The
          guide covers every step.
        </p>
      </div>
      <ol className="grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
        {[
          ["Fork", "Your own copy of the code. Updating is a git pull."],
          ["Turso", "One free database for your ledger."],
          [
            "Vercel",
            "Import your fork with Root Directory apps/app and add five variables.",
          ],
        ].map(([title, text], i) => (
          <li
            key={title}
            className="flex flex-col gap-1 rounded-2xl border bg-background/50 p-4"
          >
            <span className="figure text-sm text-muted-foreground">
              {i + 1}
            </span>
            <span className="font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">{text}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          to="/docs/$"
          params={{ _splat: "self-hosting" }}
          className={cn(buttonVariants({ size: "lg" }), ctaClass)}
        >
          Follow the guide
        </Link>
        <a
          href={REPO_URL}
          className={cn(
            buttonVariants({ size: "lg", variant: "ghost" }),
            ctaClass
          )}
        >
          View on GitHub
        </a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
        <p className="flex items-center gap-2">
          <CoinMark className="size-5 shrink-0" />
          <span>
            Open source under the{" "}
            <a
              href={`${REPO_URL}/blob/main/LICENSE`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              MIT license
            </a>
            .{" "}
            <span className="whitespace-nowrap">
              Built by{" "}
              <a
                href={AUTHOR.url}
                rel="author"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {AUTHOR.name}
              </a>
              .
            </span>
          </span>
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/docs/$" className="hover:text-foreground">
            Docs
          </Link>
          <Link
            to="/docs/$"
            params={{ _splat: "self-hosting" }}
            className="hover:text-foreground"
          >
            Self-hosting
          </Link>
          <a href={REPO_URL} className="hover:text-foreground">
            GitHub
          </a>
          <a href="/llms.txt" className="hover:text-foreground">
            llms.txt
          </a>
        </nav>
      </div>
    </footer>
  )
}

function Point({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-card">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-pretty text-muted-foreground">
          {children}
        </span>
      </span>
    </li>
  )
}

function Tile({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-3 rounded-3xl border bg-card p-5 md:p-6">
      <Icon aria-hidden className="size-5 text-muted-foreground" />
      <span className="font-display text-2xl leading-tight">{title}</span>
      <span className="flex flex-col text-pretty text-muted-foreground">
        {children}
      </span>
    </li>
  )
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-5 flex flex-wrap gap-1.5">
      {lines.map((line) => (
        <li key={line}>
          <code className="rounded-lg border bg-card px-2.5 py-1 font-mono text-sm text-foreground">
            {line}
          </code>
        </li>
      ))}
    </ul>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-card px-1 font-sans text-xs text-foreground">
      {children}
    </kbd>
  )
}
