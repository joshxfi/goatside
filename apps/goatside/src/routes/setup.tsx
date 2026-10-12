import { useEffect, useState } from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { Wordmark } from "@workspace/ui/components/brand"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { type SetupProblem, getSetupProblem } from "@/server/setup"

const DOCS = "https://goatside.joshxfi.com/docs/self-hosting"
/** How often to look again while a migration may still be running in CI. */
const RECHECK_MS = 15_000

/** Where a deploy that can't run yet explains why. Gone once it can. */
export const Route = createFileRoute("/setup")({
  beforeLoad: async () => {
    const problem = await getSetupProblem()
    if (!problem) throw redirect({ to: "/" })
    return { problem }
  },
  head: () => ({ meta: [{ title: "Finish setting up · Goatside" }] }),
  component: Setup,
})

function Setup() {
  const { problem } = Route.useRouteContext()
  const router = useRouter()
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    // Reruns beforeLoad, which leaves for the app once the problem is gone.
    await router.invalidate()
    setChecking(false)
  }

  // GitHub Actions can still be migrating after Vercel deploys, so this one
  // usually fixes itself.
  useEffect(() => {
    if (problem.kind !== "migrations") return
    const timer = setInterval(() => void router.invalidate(), RECHECK_MS)
    return () => clearInterval(timer)
  }, [problem.kind, router])

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <Wordmark className="text-xl" />

      <div className="flex flex-1 flex-col justify-center gap-4 py-12">
        <h1 className="font-display text-4xl tracking-tight">
          Goatside isn't ready yet.
        </h1>
        <Explanation problem={problem} />
      </div>

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          className="h-12 text-base"
          disabled={checking}
          onClick={() => void check()}
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
        <a
          href={docsFor(problem)}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({
            variant: "ghost",
            size: "lg",
            className: "h-12 text-base",
          })}
        >
          Open the guide
        </a>
      </div>
    </main>
  )
}

function Explanation({ problem }: { problem: SetupProblem }) {
  switch (problem.kind) {
    case "env":
      return (
        <>
          <p className="text-muted-foreground">
            Fix these in your Vercel project under Settings → Environment
            Variables, then redeploy. Changes reach only new deployments.
          </p>
          <ul className="flex flex-col gap-2">
            {problem.variables.map((variable) => (
              <li
                key={variable.name}
                className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm"
              >
                <code className="font-medium">{variable.name}</code>
                <span className="text-muted-foreground">
                  {variable.problem}
                </span>
              </li>
            ))}
          </ul>
        </>
      )
    case "database":
      return (
        <p className="text-muted-foreground">
          It can't open its database. Check <code>TURSO_DATABASE_URL</code> and{" "}
          <code>TURSO_AUTH_TOKEN</code> in your Vercel project, then redeploy.
          The function logs have the exact error.
        </p>
      )
    case "migrations":
      return problem.fresh ? (
        <p className="text-muted-foreground">
          The database has no tables yet. Run the migrations, then check again.
        </p>
      ) : (
        <p className="text-muted-foreground">
          This version needs{" "}
          {problem.pending === 1
            ? "a database migration"
            : `${problem.pending} database migrations`}{" "}
          that haven't run yet. If GitHub Actions runs your migrations, it's
          probably still working, and this page checks again every 15 seconds.
          Otherwise, run them yourself.
        </p>
      )
  }
}

function docsFor(problem: SetupProblem) {
  switch (problem.kind) {
    case "env":
      return `${DOCS}/environment`
    case "database":
      return `${DOCS}#add-the-database`
    case "migrations":
      return problem.fresh
        ? `${DOCS}#set-up-the-tables`
        : `${DOCS}/database#migrations`
  }
}
