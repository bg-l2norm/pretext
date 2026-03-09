import { type ChildProcess } from 'node:child_process'
import {
  createBrowserSession,
  ensurePageServer,
  loadHashReport,
  type BrowserKind,
} from './browser-automation.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  width?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: {
    line: number
    oursStart: number
    browserStart: number
    oursEnd: number
    browserEnd: number
    oursContext: string
    browserContext: string
    deltaText: string
    reasonGuess: string
    oursSumWidth: number
    oursDomWidth: number
    oursFullWidth: number
    browserDomWidth: number
    browserFullWidth: number
  } | null
  message?: string
}

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseBrowser(value: string | null): BrowserKind {
  const browser = (value ?? process.env['PROBE_CHECK_BROWSER'] ?? 'chrome').toLowerCase()
  if (browser !== 'chrome' && browser !== 'safari') {
    throw new Error(`Unsupported browser ${browser}; expected chrome or safari`)
  }
  return browser
}

function requireFlag(name: string): string {
  const value = parseStringFlag(name)
  if (value === null || value.length === 0) throw new Error(`Missing --${name}=...`)
  return value
}

function printReport(report: ProbeReport): void {
  if (report.status === 'error') {
    console.log(`error: ${report.message ?? 'unknown error'}`)
    return
  }

  console.log(
    `width ${report.width}: diff ${report.diffPx}px | lines ${report.predictedLineCount}/${report.browserLineCount} | height ${report.predictedHeight}/${report.actualHeight}`,
  )
  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    const mismatch = report.firstBreakMismatch
    console.log(`  break L${mismatch.line}: ${mismatch.reasonGuess}`)
    console.log(`  offsets: ours ${mismatch.oursStart}-${mismatch.oursEnd} | browser ${mismatch.browserStart}-${mismatch.browserEnd}`)
    console.log(`  delta: ${JSON.stringify(mismatch.deltaText)}`)
    console.log(`  ours:    ${mismatch.oursContext}`)
    console.log(`  browser: ${mismatch.browserContext}`)
    console.log(
      `  widths: ours sum/dom/full ${mismatch.oursSumWidth.toFixed(3)}/${mismatch.oursDomWidth.toFixed(3)}/${mismatch.oursFullWidth.toFixed(3)} | browser dom/full ${mismatch.browserDomWidth.toFixed(3)}/${mismatch.browserFullWidth.toFixed(3)}`,
    )
  }
}

const browser = parseBrowser(parseStringFlag('browser'))
const port = parseNumberFlag('port', Number.parseInt(process.env['PROBE_CHECK_PORT'] ?? '3210', 10))
const text = requireFlag('text')
const width = parseNumberFlag('width', 600)
const font = parseStringFlag('font') ?? '18px serif'
const lineHeight = parseNumberFlag('lineHeight', 32)
const dir = parseStringFlag('dir') ?? 'ltr'
const lang = parseStringFlag('lang') ?? (dir === 'rtl' ? 'ar' : 'en')

let serverProcess: ChildProcess | null = null
const session = createBrowserSession(browser)

try {
  const pageServer = await ensurePageServer(port, '/probe', process.cwd())
  serverProcess = pageServer.process
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const url =
    `${pageServer.baseUrl}/probe?text=${encodeURIComponent(text)}` +
    `&width=${width}` +
    `&font=${encodeURIComponent(font)}` +
    `&lineHeight=${lineHeight}` +
    `&dir=${encodeURIComponent(dir)}` +
    `&lang=${encodeURIComponent(lang)}` +
    `&requestId=${encodeURIComponent(requestId)}`
  const report = await loadHashReport<ProbeReport>(session, url, requestId, browser)
  printReport(report)
} finally {
  session.close()
  serverProcess?.kill()
}
