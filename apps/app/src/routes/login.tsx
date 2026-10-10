import { useState } from "react"
import { createCsrfMiddleware } from "@tanstack/react-start"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { CoinFlip, Wordmark } from "@workspace/ui/components/brand"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { attemptSignIn, clientIp, getViewer } from "@/server/session"

const ERRORS = {
  invalid: "Wrong username or password.",
  throttled: "Too many attempts. Wait 15 minutes and try again.",
} as const

function seeOther(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location })
  for (const cookie of cookies) headers.append("Set-Cookie", cookie)
  return new Response(null, { status: 303, headers })
}

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    error: z.enum(["invalid", "throttled"]).optional().catch(undefined),
  }),
  beforeLoad: async () => {
    if (await getViewer()) throw redirect({ to: "/" })
  },
  // A plain form POST: works before hydration, and credentials never touch a URL.
  server: {
    // Only the form POST needs an origin check; page loads are plain GETs.
    middleware: [
      createCsrfMiddleware({
        filter: ({ request }) => request.method === "POST",
      }),
    ],
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData()
        const result = await attemptSignIn(
          {
            username: String(form.get("username") ?? "").slice(0, 200),
            password: String(form.get("password") ?? "").slice(0, 500),
          },
          clientIp()
        )
        if (!result.ok) return seeOther(`/login?error=${result.error}`)
        return seeOther("/", result.cookies)
      },
    },
  },
  head: () => ({ meta: [{ title: "Sign in · Goatside" }] }),
  component: Login,
})

function Login() {
  const { error } = Route.useSearch()
  const [pending, setPending] = useState(false)

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <Wordmark className="text-xl" />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <CoinFlip
          toss
          spinning={pending}
          className="size-32 drop-shadow-[0_14px_20px_rgb(0_0_0/0.16)]"
        />
        <h1 className="text-3xl font-semibold tracking-tight">
          Steady climbing starts here.
        </h1>
      </div>

      <form
        method="post"
        action="/login"
        className="flex flex-col gap-3"
        onSubmit={() => setPending(true)}
      >
        <label htmlFor="username" className="sr-only">
          Username
        </label>
        <Input
          id="username"
          name="username"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          className="h-12 text-base"
        />
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          required
          className="h-12 text-base"
        />
        {error && !pending && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {ERRORS[error]}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="mt-1 h-12 text-base"
          disabled={pending}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  )
}
