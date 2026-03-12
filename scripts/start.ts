import { execFileSync, spawn } from 'node:child_process'

const PORT = 3000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getListeningPids(port: number): number[] {
  try {
    const output = execFileSync(
      'lsof',
      ['-tiTCP:' + String(port), '-sTCP:LISTEN'],
      { encoding: 'utf8' },
    ).trim()

    if (output === '') return []

    const pids = output
      .split('\n')
      .map(line => Number.parseInt(line, 10))
      .filter(pid => Number.isFinite(pid))

    return [...new Set(pids)]
  } catch {
    return []
  }
}

function tryKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Ignore races where the process exited between lsof and kill.
  }
}

async function freePort(port: number): Promise<void> {
  let pids = getListeningPids(port)
  if (pids.length === 0) return

  console.log(`Freeing port ${port}: terminating ${pids.join(', ')}`)
  for (const pid of pids) {
    tryKill(pid, 'SIGTERM')
  }

  for (let i = 0; i < 20; i++) {
    await sleep(100)
    pids = getListeningPids(port)
    if (pids.length === 0) return
  }

  console.log(`Port ${port} still busy: killing ${pids.join(', ')}`)
  for (const pid of pids) {
    tryKill(pid, 'SIGKILL')
  }

  for (let i = 0; i < 20; i++) {
    await sleep(100)
    pids = getListeningPids(port)
    if (pids.length === 0) return
  }

  throw new Error(`Failed to free port ${port}; still listening: ${pids.join(', ')}`)
}

async function main(): Promise<void> {
  await freePort(PORT)

  const child = spawn('/bin/zsh', ['-lc', `bun --watch --no-clear-screen --port=${PORT} pages/*.html`], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
