import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <main className="flex min-h-svh flex-col justify-end gap-4 p-4">
      <h1 className="text-2xl font-medium">Goatside</h1>
      <p className="text-sm text-muted-foreground">
        Type it, track it. The app shell lands in M2.
      </p>
      <Button className="self-start">Get started</Button>
    </main>
  )
}
