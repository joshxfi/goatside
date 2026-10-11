/**
 * Ask-mode eval: real questions through the real agent, tools and approval
 * gate, against a local database seeded with demo data. Approvals are
 * granted automatically and printed, so each scenario runs end to end, and
 * each is checked against the tool calls it should make.
 *
 *   pnpm --filter @workspace/db demo   (into a fresh local database first)
 *   TURSO_DATABASE_URL=http://127.0.0.1:8090 pnpm --filter app eval:ask [name]
 *
 * Refuses anything but a local database: scenarios write to the ledger.
 */
import {
  type ModelMessage,
  type ToolApprovalStatus,
  generateText,
  isStepCount,
} from "ai"
import { and, eq, isNull, like } from "drizzle-orm"
import { type Db, schema } from "@workspace/db"
import { askAgent } from "../src/server/ask.server"
import { serverEnv } from "../src/server/env"
import { getDb } from "../src/server/services"

const url = process.env.TURSO_DATABASE_URL ?? ""
if (!/^(http:\/\/(127\.0\.0\.1|localhost)[:/]|file:)/.test(url)) {
  console.error("Set TURSO_DATABASE_URL to a local demo database.")
  process.exit(1)
}

interface Call {
  /** Tool name; "a|b" accepts either. */
  tool: string
  /** Part of the input. Strings match case-insensitively as substrings. */
  input?: Record<string, unknown>
}

interface Scenario {
  name: string
  /** One or more owner turns, in order. */
  turns: string[]
  /** Calls the scenario should make, in any order. */
  expect?: Call[]
  /** Write tools that must not complete. */
  avoid?: string[]
  /** No tools at all. */
  noTools?: boolean
  /** Looks at the ledger afterwards; returns a problem, or null. */
  check?: (db: Db) => Promise<string | null>
}

const WRITES = [
  "logEntries",
  "recordIou",
  "settleUp",
  "deleteEntries",
  "moveToCategory",
  "moveToAccount",
  "addAccount",
  "setAccountBalance",
]

// Run in order: later scenarios build on what earlier ones recorded.
const SCENARIOS: Scenario[] = [
  {
    name: "who owes me",
    turns: ["who owes me money?"],
    expect: [{ tool: "balances" }],
  },
  {
    name: "one person",
    turns: ["how much does mara owe me?"],
    expect: [{ tool: "balances", input: { person: "mara" } }],
  },
  {
    name: "owe, another language",
    turns: ["magkano utang ko kay ben?"],
    expect: [{ tool: "balances", input: { person: "ben" } }],
  },
  {
    name: "lend new person",
    turns: ["I lent carlo 500 for his grab"],
    expect: [
      {
        tool: "recordIou",
        input: { person: "carlo", type: "lent", amount: 500 },
      },
    ],
  },
  {
    name: "partial repay",
    turns: ["carlo paid me back 200"],
    expect: [
      {
        tool: "settleUp",
        input: { person: "carlo", paidBy: "them", amount: 200 },
      },
    ],
  },
  {
    name: "wrong direction",
    turns: ["I paid carlo back 100"],
    avoid: WRITES,
  },
  { name: "overpaid", turns: ["mara paid me 5000"], avoid: WRITES },
  {
    name: "someone paid for me",
    turns: ["ben paid for my lunch, 350"],
    expect: [
      {
        tool: "recordIou",
        input: { person: "ben", type: "borrowed", amount: 350 },
      },
    ],
  },
  {
    name: "split dinner",
    turns: ["I paid 1200 for dinner with mara and ben, split 3 ways"],
    expect: [{ tool: "logEntries", input: { text: "split 3" } }],
  },
  {
    name: "iou history",
    turns: ["show my IOU history with mara"],
    expect: [{ tool: "balances|iouActivity", input: { person: "mara" } }],
  },
  {
    name: "last repayment",
    turns: ["when did mara last pay me back?"],
    expect: [{ tool: "balances|iouActivity", input: { person: "mara" } }],
  },
  {
    name: "lent this month",
    turns: ["how much have I lent out this month?"],
    expect: [{ tool: "iouActivity" }],
  },
  {
    name: "split with new person",
    turns: ["-600 movie tickets with sam split 2"],
    expect: [{ tool: "logEntries", input: { text: "sam" } }],
  },
  {
    name: "paid on behalf",
    turns: ["carlo sent me 250 through gcash for sam's share"],
    expect: [
      {
        tool: "settleUp",
        input: { person: "sam", paidBy: "them", amount: 250 },
      },
    ],
  },
  {
    name: "i owe",
    turns: ["I owe sam 300 for the concert ticket they bought me"],
    expect: [
      {
        tool: "recordIou",
        input: { person: "sam", type: "borrowed", amount: 300 },
      },
    ],
  },
  {
    name: "lent via account",
    turns: ["paid 900 for ana's ticket using bpi"],
    expect: [
      {
        tool: "recordIou",
        input: { person: "ana", type: "lent", amount: 900, account: "bpi" },
      },
    ],
  },
  {
    name: "repay, another language",
    turns: ["nagbayad si ben ng 300"],
    expect: [
      {
        tool: "settleUp",
        input: { person: "ben", paidBy: "them", amount: 300 },
      },
    ],
  },
  {
    name: "delete a loan",
    turns: ["delete the loan to carlo and his repayment"],
    expect: [{ tool: "deleteEntries" }],
  },
  {
    name: "settle all",
    turns: ["mara paid me back everything"],
    expect: [{ tool: "settleUp", input: { person: "mara", paidBy: "them" } }],
  },
  {
    name: "do I owe",
    turns: ["do I owe anyone?"],
    expect: [{ tool: "balances" }],
  },
  {
    name: "follow-up",
    turns: ["who owes me?", "what's ben's for?", "ok he paid it all"],
    expect: [{ tool: "settleUp", input: { person: "ben", paidBy: "them" } }],
  },
  {
    name: "spend this month",
    turns: ["how much did I spend this month?"],
    expect: [{ tool: "summarize", input: { from: "-10-01" } }],
  },
  {
    name: "compare",
    turns: ["food this month vs last month?"],
    expect: [{ tool: "summarize", input: { category: "food" } }],
  },
  {
    name: "biggest",
    turns: ["what was my biggest expense last month?"],
    expect: [{ tool: "findTransactions", input: { sort: "largest" } }],
  },
  {
    name: "account balance",
    turns: ["how much is in my gcash?"],
    expect: [{ tool: "accounts" }],
  },
  {
    name: "card owed",
    turns: ["how much do I owe on my credit card?"],
    expect: [{ tool: "accounts" }],
  },
  {
    name: "log two",
    turns: ["log 120 coffee and 85 bread this morning"],
    expect: [{ tool: "logEntries", input: { text: "coffee" } }],
  },
  {
    name: "recategorize",
    // The rides are already there; grabfood must stay in Food.
    turns: ["move all grab rides this month to Transport"],
    check: async (db) => {
      const moved = await db
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .innerJoin(
          schema.categories,
          eq(schema.categories.id, schema.transactions.categoryId)
        )
        .where(
          and(
            isNull(schema.transactions.deletedAt),
            like(schema.transactions.description, "grabfood%"),
            eq(schema.categories.name, "Transport")
          )
        )
      return moved.length ? `${moved.length} grabfood entries moved` : null
    },
  },
  {
    name: "off topic",
    turns: ["write me a poem about the sea"],
    noTools: true,
  },
]

const write = (s: string) => process.stdout.write(`${s}\n`)

const fits = (want: unknown, got: unknown): boolean =>
  typeof want === "string" && typeof got === "string"
    ? got.toLowerCase().includes(want.toLowerCase())
    : want === got

function matched(call: Call, made: { tool: string; input: unknown }[]) {
  const names = call.tool.split("|")
  return made.some(
    (m) =>
      names.includes(m.tool) &&
      Object.entries(call.input ?? {}).every(([key, value]) =>
        fits(value, (m.input as Record<string, unknown>)[key])
      )
  )
}

async function run(scenario: Scenario): Promise<string[]> {
  const db = getDb()
  const messages: ModelMessage[] = []
  const made: { tool: string; input: unknown }[] = []
  const done: string[] = []
  write(`\n━━ ${scenario.name}`)
  for (const turn of scenario.turns) {
    write(`  > ${turn}`)
    messages.push({ role: "user", content: turn })
    const agent = await askAgent(db)
    const approvals = Object.fromEntries(
      Object.entries(agent.toolApproval).map(([name, gate]) => [
        name,
        async (input: never) => {
          const status: ToolApprovalStatus = await (
            gate as (i: never) => Promise<ToolApprovalStatus>
          )(input)
          if (status && typeof status === "object") {
            write(`    [${status.type}] ${name}: ${status.reason ?? ""}`)
            // The owner taps Confirm.
            if (status.type === "user-approval")
              return { type: "approved" } as const
          }
          return status
        },
      ])
    )
    const result = await generateText({
      model: serverEnv().CHAT_MODEL,
      system: agent.system,
      tools: agent.tools,
      toolApproval: approvals,
      messages,
      stopWhen: isStepCount(6),
      reasoning: "none",
      maxOutputTokens: 800,
    })
    for (const step of result.steps) {
      for (const call of step.toolCalls) {
        made.push({ tool: call.toolName, input: call.input })
        write(`    → ${call.toolName} ${JSON.stringify(call.input)}`)
      }
      for (const r of step.toolResults) {
        const output = r.output as { done?: boolean } | null
        if (output?.done === true) done.push(r.toolName)
        write(`    ← ${JSON.stringify(r.output).slice(0, 300)}`)
      }
    }
    write(`  < ${result.text.replace(/\n/g, "\n    ")}`)
    messages.push(...result.response.messages)
  }

  const problems: string[] = []
  for (const call of scenario.expect ?? []) {
    if (!matched(call, made))
      problems.push(`expected ${call.tool} ${JSON.stringify(call.input ?? {})}`)
  }
  for (const name of scenario.avoid ?? []) {
    if (done.includes(name)) problems.push(`shouldn't have run ${name}`)
  }
  if (scenario.noTools && made.length)
    problems.push(
      `shouldn't call tools (${made.map((m) => m.tool).join(", ")})`
    )
  const checked = await scenario.check?.(db)
  if (checked) problems.push(checked)
  write(problems.length ? `  ✗ ${problems.join("; ")}` : "  ✓")
  return problems
}

const filter = process.argv[2]?.toLowerCase()
let failed = 0
let ran = 0
for (const scenario of SCENARIOS) {
  if (filter && !scenario.name.includes(filter)) continue
  ran += 1
  const problems = await run(scenario).catch((error: unknown) => [
    error instanceof Error ? error.message : String(error),
  ])
  if (problems.length) failed += 1
}
write(`\n${ran - failed}/${ran} passed`)
process.exitCode = failed ? 1 : 0
