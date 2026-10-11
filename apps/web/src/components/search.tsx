import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search"
import { useDocsSearch } from "fumadocs-core/search/client"
import { staticClient } from "fumadocs-core/search/client/orama-static"

/** Searches the index prerendered at /api/search, in the browser. */
export function DocsSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient(),
  })

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== "empty" ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  )
}
