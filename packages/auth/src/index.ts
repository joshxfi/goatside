/**
 * Single-owner auth for a self-hosted Goatside.
 *
 * There is one account, defined by GOATSIDE_USERNAME / GOATSIDE_PASSWORD in
 * env. Signing in issues a cookie `<expiresAtMs>.<signature>`, where the
 * signature is an HMAC over the expiry *and* the current credentials. So:
 * - a forged or edited cookie fails verification,
 * - changing the username, password or SESSION_SECRET signs out every device.
 *
 * Uses Web Crypto, so it runs anywhere (Node, edge, and bundles that reach
 * the browser in dev) without node: imports.
 */

export interface AuthConfig {
  username: string
  password: string
  /** At least 32 random characters. */
  secret: string
}

export const SESSION_COOKIE = "goatside_session"
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const encoder = new TextEncoder()
const keys = new Map<string, Promise<CryptoKey>>()

function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret)
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    keys.set(secret, key)
  }
  return key
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await keyFor(secret),
    encoder.encode(message)
  )
  return new Uint8Array(signature)
}

/** Constant-time comparison of equal-length byte arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** Compares strings in constant time by comparing their HMACs. */
async function safeEqual(
  secret: string,
  a: string,
  b: string
): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac(secret, a), hmac(secret, b)])
  return bytesEqual(ha, hb)
}

/** True if the submitted credentials match the configured account. */
export async function verifyCredentials(
  input: { username: string; password: string },
  config: AuthConfig
): Promise<boolean> {
  // Evaluate both so timing doesn't reveal which one was wrong.
  const [userOk, passOk] = await Promise.all([
    safeEqual(config.secret, `u:${input.username}`, `u:${config.username}`),
    safeEqual(config.secret, `p:${input.password}`, `p:${config.password}`),
  ])
  return userOk && passOk
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function sign(config: AuthConfig, expiresAt: number): Promise<Uint8Array> {
  return hmac(
    config.secret,
    `goatside-session:v1:${expiresAt}:${config.username}:${config.password}`
  )
}

/** A new session token valid until `now + ttl`. */
export async function createSessionToken(
  config: AuthConfig,
  { now = Date.now(), ttl = SESSION_TTL_MS } = {}
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + ttl
  const signature = toBase64Url(await sign(config, expiresAt))
  return { token: `${expiresAt}.${signature}`, expiresAt }
}

/** The token's expiry if it is authentic and unexpired, otherwise null. */
export async function verifySessionToken(
  token: string | undefined,
  config: AuthConfig,
  { now = Date.now() } = {}
): Promise<{ expiresAt: number } | null> {
  if (!token) return null
  const [rawExpiry, signature, ...rest] = token.split(".")
  if (!rawExpiry || !signature || rest.length || !/^\d{13}$/.test(rawExpiry)) {
    return null
  }
  const expiresAt = Number(rawExpiry)
  if (expiresAt <= now) return null
  const expected = encoder.encode(toBase64Url(await sign(config, expiresAt)))
  return bytesEqual(encoder.encode(signature), expected) ? { expiresAt } : null
}
