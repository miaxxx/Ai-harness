import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { join, resolve } from 'node:path'

export const kernelDir = resolve(process.env.OBIS_E2E_KERNEL_DIR ?? '_compat/obis/10-kernel')
export const kernelPort = Number(process.env.OBIS_E2E_KERNEL_PORT ?? '4317')
export const kernelBaseUrl = `http://127.0.0.1:${kernelPort}`
export const databaseUrl = process.env.OBIS_DATABASE_URL
export const bootstrapToken = 'e2e-bootstrap-token'
export const tenantId = 'e2e-tenant'
export const environmentId = 'prod'
export const userId = 'e2e-user'
export const subject = 'e2e-subject'
export const email = 'e2e@example.test'
export const deviceId = 'e2e-device'
export const sessionId = 'e2e-harness-session'
export const humanGoal = 'Create a governed order for the P0 compatibility test.'

if (!databaseUrl) throw new Error('OBIS_DATABASE_URL is required for the cross-repo E2E suite.')

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function jsonResponse(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function createOidcFixture(): Promise<{
  server: Server
  issuer: string
  audience: string
  idToken(): string
}> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  Object.assign(jwk, { kid: 'e2e-key', use: 'sig', alg: 'RS256' })
  const audience = 'obis-e2e'
  let issuer = ''
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/openid-configuration') return jsonResponse(res, 200, { issuer, jwks_uri: `${issuer}/jwks` })
    if (req.url === '/jwks') return jsonResponse(res, 200, { keys: [jwk] })
    return jsonResponse(res, 404, { error: 'not found' })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('OIDC fixture did not bind a TCP port.')
  issuer = `http://127.0.0.1:${address.port}`
  return {
    server,
    issuer,
    audience,
    idToken() {
      const now = Math.floor(Date.now() / 1000)
      const encodedHeader = b64url({ alg: 'RS256', kid: 'e2e-key', typ: 'JWT' })
      const encodedPayload = b64url({
        iss: issuer, aud: audience, sub: subject, email, email_verified: true,
        name: 'OBIS E2E User', iat: now, exp: now + 300,
      })
      const signingInput = `${encodedHeader}.${encodedPayload}`
      const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
      return `${signingInput}.${signature}`
    },
  }
}

export async function closeOidc(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
}

export async function waitForHealth(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${kernelBaseUrl}/health`)
      if (response.ok) {
        const body = await response.json() as Record<string, unknown>
        assert.equal(body.persistence, 'postgres')
        return
      }
    } catch (error) { lastError = error }
    await new Promise(resolveWait => setTimeout(resolveWait, 150))
  }
  throw new Error(`OBIS Kernel did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export function startKernel(mode: 'legacy' | 'required', oidc?: { issuer: string; audience: string }): ChildProcess {
  const tsx = join(kernelDir, 'node_modules', '.bin', 'tsx')
  const child = spawn(tsx, ['src/server.ts'], {
    cwd: kernelDir,
    env: {
      ...process.env,
      OBIS_DATABASE_URL: databaseUrl,
      OBIS_KERNEL_HOST: '127.0.0.1',
      OBIS_KERNEL_PORT: String(kernelPort),
      OBIS_AUTH_MODE: mode,
      OBIS_BOOTSTRAP_TOKEN: bootstrapToken,
      OBIS_CAPABILITY_LEASE_MODE: mode === 'required' ? 'required' : 'optional',
      OBIS_REQUIRED_HARNESS_CAPABILITIES_JSON: JSON.stringify(['agent', 'tools', 'skills', 'session']),
      ...(oidc ? {
        OBIS_OIDC_PROVIDERS_JSON: JSON.stringify([{
          id: 'e2e', issuer: oidc.issuer, audience: oidc.audience,
          discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        }]),
      } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', chunk => process.stdout.write(`[obis] ${String(chunk)}`))
  child.stderr?.on('data', chunk => process.stderr.write(`[obis] ${String(chunk)}`))
  return child
}

export async function stopKernel(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    new Promise<void>((resolveWait) => setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      resolveWait()
    }, 5_000)),
  ])
}

export async function requestJson<T>(path: string, init: RequestInit = {}, expected: number | number[] = 200): Promise<T> {
  const response = await fetch(`${kernelBaseUrl}${path}`, init)
  const text = await response.text()
  const body = text ? JSON.parse(text) as T : undefined as T
  const accepted = Array.isArray(expected) ? expected : [expected]
  assert.ok(accepted.includes(response.status), `${init.method ?? 'GET'} ${path}: expected ${accepted.join('/')}, got ${response.status}: ${text}`)
  return body
}

const packSource = JSON.stringify({
  specVersion: '1.0', kind: 'ObisPack',
  metadata: { name: 'p0-e2e', namespace: 'test.p0.e2e', version: '1.0.0' },
  definitions: {
    objects: [{ name: 'Order', properties: { amount: { type: 'number' }, status: { type: 'string' } } }],
    policies: [
      { name: 'OwnerActions', effect: 'allow', actions: ['createOrder'], objects: ['Order'], roles: ['owner'] },
      { name: 'OwnerRead', effect: 'allow', queries: ['ListOrders'], objects: ['Order'], roles: ['owner'] },
      { name: 'DeniedRead', effect: 'deny', queries: ['DeniedOrders'], objects: ['Order'], roles: ['owner'] },
    ],
    actions: [{
      name: 'createOrder', target: 'Order',
      input: { amount: { type: 'number', required: true }, status: { type: 'string', required: true } },
      policy: 'OwnerActions', executor: 'obis.object.create', risk: 'low',
    }],
    queries: [
      { name: 'ListOrders', object: 'Order', policy: 'OwnerRead', fields: ['amount', 'status'], defaultLimit: 20, maxLimit: 100 },
      { name: 'DeniedOrders', object: 'Order', policy: 'DeniedRead', fields: ['amount', 'status'], defaultLimit: 20, maxLimit: 100 },
    ],
    skills: [{ name: 'ReviewOrder', description: 'Review an order before a governed action.' }],
  },
})

const packManifest = {
  manifestVersion: '1.0',
  metadata: { name: 'p0-e2e', namespace: 'test.p0.e2e', version: '1.0.0' },
  layer: 'domain',
  compatibility: { kernel: '>=0.1.0', ir: '1.0' },
}

export async function seedEnterprise(): Promise<void> {
  await requestJson('/v1/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: tenantId, name: 'P0 E2E Tenant' }),
  }, [200, 201])
  await requestJson('/v1/environments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: environmentId, tenantId, name: 'Production' }),
  }, [200, 201])
  const compiled = await requestJson<{ ir?: { artifactId?: string }; diagnostics?: unknown[] }>('/v1/packs/compile', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: packSource, manifest: packManifest }),
  })
  assert.equal(compiled.diagnostics?.length ?? 0, 0, `Pack compile diagnostics: ${JSON.stringify(compiled.diagnostics)}`)
  assert.equal(typeof compiled.ir?.artifactId, 'string')
  await requestJson('/v1/deployments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId, environmentId, artifactIds: [compiled.ir!.artifactId] }),
  }, 201)
}
