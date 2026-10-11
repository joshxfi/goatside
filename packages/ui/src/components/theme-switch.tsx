import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { cn } from "cn"
import { THEMES, type Theme, setTheme, useTheme } from "../lib/theme"

const OPTIONS: Record<Theme, { label: string; icon: typeof SunIcon }> = {
  light: { label: "Light", icon: SunIcon },
  dark: { label: "Dark", icon: MoonIcon },
  system: { label: "System", icon: MonitorIcon },
}

/**
 * Light, dark or system, as three buttons in a pill: one tap, and you see
 * which is on. `labels` adds the words, for settings pages.
 */
export function ThemeSwitch({
  labels = false,
  className,
}: {
  labels?: boolean
  className?: string
}) {
  const theme = useTheme()
  return (
    <fieldset
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border bg-background/50 p-0.5",
        className
      )}
    >
      <legend className="sr-only">Theme</legend>
      {THEMES.map((value) => {
        const { label, icon: Icon } = OPTIONS[value]
        const on = theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            aria-label={labels ? undefined : label}
            title={labels ? undefined : label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              labels ? "px-3 text-sm" : "w-7",
              on && "bg-accent text-foreground"
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {labels && label}
          </button>
        )
      })}
    </fieldset>
  )
}
