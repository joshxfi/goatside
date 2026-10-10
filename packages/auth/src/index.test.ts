import { describe, expect, it } from "vitest"
import {
  SESSION_TTL_MS,
  createDeviceToken,
  createSessionToken,
  verifyCredentials,
  verifyDeviceToken,
  verifySessionToken,
} from "./index"

const config = {
  username: "josh",
  password: "correct horse battery staple",
  secret: "a".repeat(32),
}
const now = Date.UTC(2026, 9, 10)

describe("verifyCredentials", () => {
  it("accepts the configured account", async () => {
    expect(
      await verifyCredentials(
        { username: "josh", password: config.password },
        config
      )
    ).toBe(true)
  })

  it.each([
    ["wrong password", "josh", "nope"],
    ["wrong username", "joss", config.password],
    ["both wrong", "x", "y"],
    ["empty", "", ""],
    ["password prefix", "josh", "correct horse"],
  ])("rejects %s", async (_, username, password) => {
    expect(await verifyCredentials({ username, password }, config)).toBe(false)
  })
})

describe("session tokens", () => {
  it("round-trips", async () => {
    const { token, expiresAt } = await createSessionToken(config, { now })
    expect(expiresAt).toBe(now + SESSION_TTL_MS)
    expect(await verifySessionToken(token, config, { now })).toEqual({
      expiresAt,
    })
  })

  it("expires", async () => {
    const { token, expiresAt } = await createSessionToken(config, { now })
    expect(
      await verifySessionToken(token, config, { now: expiresAt })
    ).toBeNull()
  })

  it("rejects an extended expiry", async () => {
    const { token } = await createSessionToken(config, { now })
    const [, signature] = token.split(".")
    const forged = `${now + SESSION_TTL_MS * 10}.${signature}`
    expect(await verifySessionToken(forged, config, { now })).toBeNull()
  })

  it("is revoked by changing the password, username or secret", async () => {
    const { token } = await createSessionToken(config, { now })
    expect(
      await verifySessionToken(
        token,
        { ...config, password: "new password!!" },
        { now }
      )
    ).toBeNull()
    expect(
      await verifySessionToken(token, { ...config, username: "other" }, { now })
    ).toBeNull()
    expect(
      await verifySessionToken(
        token,
        { ...config, secret: "b".repeat(32) },
        { now }
      )
    ).toBeNull()
  })

  it.each([undefined, "", "garbage", "123.abc", `${now}`, `${now + 1000}.x.y`])(
    "rejects malformed token %j",
    async (token) => {
      expect(await verifySessionToken(token, config, { now })).toBeNull()
    }
  )
})

describe("device tokens", () => {
  it("round-trips and is unique", async () => {
    const a = await createDeviceToken(config.secret)
    const b = await createDeviceToken(config.secret)
    expect(a.id).not.toBe(b.id)
    expect(await verifyDeviceToken(a.token, config.secret)).toBe(a.id)
  })

  it("rejects forged, foreign or malformed tokens", async () => {
    const { id, token } = await createDeviceToken(config.secret)
    const [, signature] = token.split(".")
    expect(await verifyDeviceToken(token, "b".repeat(32))).toBeNull()
    expect(
      await verifyDeviceToken(`${"A".repeat(22)}.${signature}`, config.secret)
    ).toBeNull()
    for (const bad of [undefined, "", id, `${id}.`, `${token}.x`]) {
      expect(await verifyDeviceToken(bad, config.secret)).toBeNull()
    }
  })
})
