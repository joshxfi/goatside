import { createServerFn } from "@tanstack/react-start"
import { checkSetup } from "./setup.server"

export type { SetupProblem } from "./setup.server"

/**
 * What's stopping this deploy from running, or null. No `authMiddleware`:
 * signing in needs the env and the database, so the owner can't be signed
 * in to see it. It names variables and counts migrations, never values.
 */
export const getSetupProblem = createServerFn().handler(() => checkSetup())
