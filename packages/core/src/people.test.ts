import { describe, expect, it } from "vitest"
import { nameCandidates } from "./people"

const names = (
  description: string,
  known: Parameters<typeof nameCandidates>[1] = []
) => nameCandidates(description, known).map((c) => c.name)

describe("nameCandidates", () => {
  it("finds names after cue words", () => {
    expect(names("paid by x")).toEqual(["X"])
    expect(names("dinner w/ mara and ben")).toEqual(["Mara", "Ben"])
    expect(names("utang ni ana")).toEqual(["Ana"])
    expect(names("lent carlo for rent")).toEqual(["Carlo"])
    expect(names("pizza with jo, sam & lee")).toEqual(["Jo", "Sam", "Lee"])
  })

  it("keeps titles with the name", () => {
    expect(names("birthday money from tita mel")).toEqual(["Tita Mel"])
    expect(names("bayad kay kuya ben")).toEqual(["Kuya Ben"])
  })

  it("collects places too; the model filters them", () => {
    expect(names("grab to bgc")).toEqual(["Bgc"])
  })

  it("skips words that are never people", () => {
    expect(names("lunch at berto's")).toEqual([])
    expect(names("coffee for me")).toEqual([])
    expect(names("paid by gcash")).toEqual([])
    expect(names("jollibee")).toEqual([])
  })

  it("matches people the owner already has, anywhere in the text", () => {
    const known = [
      { id: "p1", name: "Mara", aliases: ["mars"] },
      { id: "p2", name: "Ben", aliases: [] },
    ]
    expect(nameCandidates("mars paid me back", known)).toEqual([
      { name: "Mara", personId: "p1" },
    ])
    expect(names("dinner w/ joy and ben", known)).toEqual(["Joy", "Ben"])
    expect(nameCandidates("dinner w/ ben and joy", known)).toEqual([
      { name: "Ben", personId: "p2" },
      { name: "Joy", personId: null },
    ])
    // Not inside other words.
    expect(nameCandidates("bento box", known)).toEqual([])
  })

  it("caps the list", () => {
    expect(names("with al and bo and cy and di and ed and fe")).toHaveLength(4)
  })
})
