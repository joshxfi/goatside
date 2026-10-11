import { useEffect, useState } from "react"

/** Fields that bring up the on-screen keyboard. */
function isTextField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement)
    return true
  if (!(target instanceof HTMLInputElement)) return false
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(target.type)
}

/** Whether a text field has focus, which on a phone means the keyboard is up. */
export function useTyping() {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const update = () => setTyping(isTextField(document.activeElement))
    // focusout fires before the next field gets focus; check once it has.
    const later = () => requestAnimationFrame(update)
    document.addEventListener("focusin", update)
    document.addEventListener("focusout", later)
    return () => {
      document.removeEventListener("focusin", update)
      document.removeEventListener("focusout", later)
    }
  }, [])
  return typing
}
