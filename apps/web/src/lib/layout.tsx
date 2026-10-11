import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { Wordmark } from "@workspace/ui/components/brand"
import { REPO_URL } from "@/lib/site"

/** Shared by the docs layout: the wordmark home, GitHub, no theme switch (it follows the system). */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Wordmark />, url: "/" },
    githubUrl: REPO_URL,
    themeSwitch: { enabled: false },
  }
}
