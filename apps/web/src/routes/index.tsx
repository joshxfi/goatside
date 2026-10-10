import { createFileRoute } from "@tanstack/react-router"
import { buttonVariants } from "@workspace/ui/components/button"

export const Route = createFileRoute("/")({ component: Landing })

function Landing() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 p-4">
      <h1 className="text-4xl font-semibold tracking-tight">Goatside</h1>
      <p className="text-lg text-muted-foreground">
        An open-source, self-hostable finance tracker. Type{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">
          -500 lunch at berto's
        </code>{" "}
        and it organizes itself.
      </p>
      <a
        className={buttonVariants({ className: "self-start" })}
        href="https://github.com/joshxfi/goatside"
      >
        View on GitHub
      </a>
    </main>
  )
}
