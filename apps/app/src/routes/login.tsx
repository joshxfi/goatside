import { useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { signIn } from "@workspace/auth/client"
import { CoinFlip, Wordmark } from "@workspace/ui/components/brand"
import { Button } from "@workspace/ui/components/button"
import { getViewer } from "@/server/session"

const ERRORS: Record<string, string> = {
  not_allowed:
    "That Google account isn’t on this Goatside’s allowlist. Ask the owner to add it to ALLOWED_EMAILS.",
}

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ error: z.string().optional() }),
  beforeLoad: async () => {
    if (await getViewer()) throw redirect({ to: "/" })
  },
  head: () => ({ meta: [{ title: "Sign in · Goatside" }] }),
  component: Login,
})

function Login() {
  const { error } = Route.useSearch()
  const [pending, setPending] = useState(false)

  async function continueWithGoogle() {
    setPending(true)
    const result = await signIn.social({ provider: "google", callbackURL: "/" })
    // On success the browser is already navigating to Google.
    if (result.error) setPending(false)
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <Wordmark className="text-xl" />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <CoinFlip
          toss
          spinning={pending}
          className="size-36 drop-shadow-[0_14px_20px_rgb(0_0_0/0.16)]"
        />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl tracking-tight">
            Steady climbing starts here.
          </h1>
          <p className="text-muted-foreground">
            Sign in to your Goatside to keep tracking.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {ERRORS[error] ?? "Sign-in didn’t work. Please try again."}
          </p>
        )}
        <Button
          size="lg"
          className="h-12 text-base"
          disabled={pending}
          onClick={continueWithGoogle}
        >
          <GoogleIcon />
          {pending ? "Opening Google…" : "Continue with Google"}
        </Button>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path
        fill="#4285F4"
        d="M22.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-7.9Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z"
      />
    </svg>
  )
}
