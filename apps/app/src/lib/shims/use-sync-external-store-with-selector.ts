/* oxlint-disable -- a port of React's own implementation, kept as is */
/**
 * Stands in for `use-sync-external-store/shim/with-selector` (see the alias
 * in vite.config.ts and ./use-sync-external-store.ts for why). A direct ESM
 * port of React's implementation, on React's built-in hook.
 */
import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react"

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean
): Selection {
  const instRef = useRef<{ hasValue: boolean; value: Selection } | null>(null)
  if (instRef.current === null) {
    instRef.current = { hasValue: false, value: undefined as Selection }
  }
  const inst = instRef.current

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false
    let memoizedSnapshot: Snapshot
    let memoizedSelection: Selection
    const memoizedSelector = (nextSnapshot: Snapshot) => {
      if (!hasMemo) {
        hasMemo = true
        memoizedSnapshot = nextSnapshot
        const nextSelection = selector(nextSnapshot)
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection
            return currentSelection
          }
        }
        memoizedSelection = nextSelection
        return nextSelection
      }
      const prevSelection = memoizedSelection
      if (Object.is(memoizedSnapshot, nextSnapshot)) return prevSelection
      const nextSelection = selector(nextSnapshot)
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot
        return prevSelection
      }
      memoizedSnapshot = nextSnapshot
      memoizedSelection = nextSelection
      return nextSelection
    }
    const serverSnapshot = getServerSnapshot ?? null
    return [
      () => memoizedSelector(getSnapshot()),
      serverSnapshot === null
        ? undefined
        : () => memoizedSelector(serverSnapshot()),
    ]
  }, [getSnapshot, getServerSnapshot, selector, isEqual])

  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection
  )
  useEffect(() => {
    inst.hasValue = true
    inst.value = value
  }, [value])
  useDebugValue(value)
  return value
}
