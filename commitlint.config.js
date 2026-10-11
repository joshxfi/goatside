// Every commit that lands on main feeds the changelog (release-please), so
// each one is a Conventional Commit: `type(scope): subject`, lowercase.
export default {
  extends: ["@commitlint/config-conventional"],
}
