import { constants, closeSync, fstatSync, openSync, writeSync } from 'node:fs'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queryCommand } from './process.js'
import type { SessionHookEvent, SessionHookState } from './index.js'

export interface SessionAdapter {
  handle(event: SessionHookEvent): Promise<void>
  close(): Promise<void>
}

type AppState = SessionHookState | 'clear'
export interface AppReport {
  state: AppState
  message?: string
  sequence: string
}
export type AppReporter = (report: AppReport) => Promise<boolean>
const STATES = new Set(['idle', 'working', 'blocked', 'clear'])
const MAX_MESSAGE_BYTES = 4096
const MAX_REPORT_BYTES = 32768

function boundedMessage(message: string | undefined): string | undefined {
  const text = message?.trim()
  if (!text) return undefined
  // Decoding before re-encoding keeps a split multi-byte character valid UTF-8.
  return Buffer.from(text).subarray(0, MAX_MESSAGE_BYTES).toString('utf8')
}

/** OSC 7501 text fields are base64, not shell/terminal-escaped text. */
export function encodeAppReport(report: AppReport): string {
  const fields = [`state=${report.state}`, 'app=evot']
  const message = boundedMessage(report.message)
  if (message) {
    fields.push(`msg=${Buffer.from(message).toString('base64')}`)
  }
  return `\x1b]7501;${fields.join(':')}\x1b\\`
}

export class EvotBridgeAppAdapter implements SessionAdapter {
  private offset = 0n
  private lastReport: string | undefined
  private releaseNeeded = false

  constructor(private readonly report: AppReporter, private readonly sequenceBase: bigint) {}

  async handle(event: SessionHookEvent): Promise<void> {
    switch (event.event) {
      case 'session_started':
        this.lastReport = undefined
        await this.send('idle')
        break
      case 'run_started': await this.send('working', event.message); break
      case 'state_changed': if (event.state) await this.send(event.state, event.message); break
      case 'run_finished': await this.send('idle'); break
      case 'run_failed': await this.send('idle', event.message); break
      case 'session_ended':
        if (event.reason !== 'session_changed') await this.close()
        break
    }
  }

  async close(): Promise<void> {
    if (!this.releaseNeeded) return
    if (await this.send('clear')) this.releaseNeeded = false
  }

  private async send(state: AppState, message?: string): Promise<boolean> {
    const normalized = boundedMessage(message)
    const key = JSON.stringify([state, normalized])
    if (key === this.lastReport) return true
    if (state !== 'clear') this.releaseNeeded = true
    // The same million-entry blocks used by the CLI adapter fence old hooks
    // at the wrapper bridge, including an old hook's delayed clear.
    if (++this.offset >= 1_000_000n) return false
    let success = false
    try {
      success = await this.report({ state, message: normalized, sequence: String(this.sequenceBase + this.offset) })
    } catch { /* Integration failure must never affect evot. */ }
    if (success) this.lastReport = key
    return success
  }
}

/** The wrapper owns the terminal output; detached hooks have neither stdout
 * nor a controlling terminal. Relay small reports over a private local socket.
 */
export async function startAppBridge(write: (text: string) => void): Promise<{
  path: string
  close(): Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'evot-bridge-'))
  const path = process.platform === 'win32'
    ? `\\\\.\\pipe\\evot-bridge-${process.pid}-${crypto.randomUUID()}`
    : join(directory, 'status.sock')
  const clients = new Set<Socket>()
  let latest = 0n
  let reported = false
  let closing = false
  const server = createServer(socket => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(2000, () => socket.destroy())
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      data += chunk
      if (Buffer.byteLength(data) > MAX_REPORT_BYTES) return void socket.destroy()
      const newline = data.indexOf('\n')
      if (newline < 0) return
      // Exactly one bounded report per connection; acknowledgement follows
      // the terminal write so failed writes remain eligible for retry.
      socket.removeAllListeners('data')
      let accepted = false
      try {
        const report = JSON.parse(data.slice(0, newline)) as AppReport
        if (!closing && STATES.has(report.state)
          && typeof report.sequence === 'string' && /^\d{1,19}$/.test(report.sequence)
          && (report.message === undefined || typeof report.message === 'string')) {
          const sequence = BigInt(report.sequence)
          if (sequence > latest && sequence <= 9_223_372_036_854_775_807n) {
            write(encodeAppReport(report))
            latest = sequence
            reported = report.state !== 'clear'
            accepted = true
          }
        }
      } catch { /* Malformed input or a closed terminal is harmless. */ }
      socket.end(accepted ? 'ok' : 'no')
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => { server.off('error', reject); resolve() })
    })
    if (process.platform !== 'win32') await chmod(path, 0o600)
  } catch (error) {
    if (server.listening) server.close()
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  server.on('error', () => {})
  return {
    path,
    async close() {
      closing = true
      // evot need not wait for its hook on shutdown. Clear here too, before
      // returning to the shell, and reject every late hook report.
      if (reported) {
        try { write(encodeAppReport({ state: 'clear', sequence: '0' })) } catch { /* best effort */ }
      }
      for (const client of clients) client.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export function bridgeReporter(path: string, timeout: number): AppReporter {
  return report => new Promise<boolean>(resolve => {
    const socket = createConnection(path)
    let reply = ''
    const finish = (success: boolean) => { socket.destroy(); resolve(success) }
    socket.setTimeout(timeout, () => finish(false))
    socket.on('error', () => finish(false))
    socket.on('close', () => resolve(reply === 'ok'))
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      reply += chunk
      if (reply.length > 2) finish(false)
    })
    socket.on('end', () => finish(reply === 'ok'))
    socket.on('connect', () => socket.write(`${JSON.stringify(report)}\n`))
  })
}

/** Plain evot + EVOT_SESSION_HOOK on POSIX: the detached hook cannot open
 * /dev/tty, but its parent evot still owns the terminal. Never open a regular
 * file or use the hook's discarded stdout as a fallback.
 */
export function parentTerminalReporter(env: NodeJS.ProcessEnv, timeout: number): AppReporter {
  if (process.platform === 'win32') return async () => false
  const tty = queryCommand(['ps', '-p', String(process.ppid), '-o', 'tty='], env, timeout)?.trim()
  const path = tty && /^(?:tty[a-zA-Z0-9]+|pts\/\d+)$/.test(tty) ? `/dev/${tty}` : undefined
  return async report => {
    if (!path) return false
    let fd: number | undefined
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_NOCTTY | constants.O_NONBLOCK)
      if (!fstatSync(fd).isCharacterDevice()) return false
      const bytes = Buffer.from(encodeAppReport(report))
      return writeSync(fd, bytes) === bytes.length
    } catch {
      return false
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
}
