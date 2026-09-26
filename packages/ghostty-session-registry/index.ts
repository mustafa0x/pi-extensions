import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

const configured_agent_dir = process.env.PI_CODING_AGENT_DIR
const agent_dir = configured_agent_dir?.startsWith('~/')
  ? join(homedir(), configured_agent_dir.slice(2))
  : configured_agent_dir ?? join(homedir(), '.pi', 'agent')
const runtime_path = join(agent_dir, 'session-runtime', `${process.pid}.json`)

function remove_record() {
  try {
    unlinkSync(runtime_path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function write_record(ctx: ExtensionContext, thinking_level: string) {
  const session_file = ctx.sessionManager.getSessionFile()
  if (!session_file) {
    remove_record()
    return
  }

  const temporary_path = `${runtime_path}.tmp`
  mkdirSync(dirname(runtime_path), { recursive: true })
  writeFileSync(temporary_path, `${JSON.stringify({
    pid: process.pid,
    session_id: ctx.sessionManager.getSessionId(),
    session_file,
    cwd: ctx.cwd,
    updated_at: new Date().toISOString(),
    thinking_level,
  })}\n`)
  renameSync(temporary_path, runtime_path)
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => write_record(ctx, pi.getThinkingLevel()))
  pi.on('thinking_level_select', (_event, ctx) => write_record(ctx, pi.getThinkingLevel()))
  pi.on('session_shutdown', () => remove_record())
}
