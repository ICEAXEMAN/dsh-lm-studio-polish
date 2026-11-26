/**
 * 让 B 站私信正文在发送前经过 DSH 的本地润色（与界面文本同一版）。
 *
 *   node tools/patch-bili-dm-polish.mjs            # 应用（幂等，备份 .bak-before-polish）
 *   node tools/patch-bili-dm-polish.mjs --revert   # 还原
 *
 * 做的事：把 `const MSG = ...` 改成 `let MSG = ...` 并紧跟一次 polishOutgoing()，
 * 该函数读 `$DSH_HOME/lm-studio-polish.origin`，POST `/reuse`：
 * 命中润色缓存就用界面已经显示的那版，未命中就当场润一次并写回缓存。
 * dry 打印、真正发送、会话显示因此是同一段文字。
 *
 * B 站插件更新会覆盖，更新后重跑一次。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const profile = process.env.DSH_PROFILE_DIR ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')
const file = join(profile, 'node_modules', 'dsh-bili-whale', 'tools', 'commands', 'dm.mjs')
const backup = `${file}.bak-before-polish`

if (!existsSync(file)) {
  console.error(`找不到 ${file}`)
  process.exit(1)
}

if (process.argv.includes('--revert')) {
  if (!existsSync(backup)) {
    console.error(`没有备份 ${backup}`)
    process.exit(1)
  }
  copyFileSync(backup, file)
  console.log('已从备份还原 dm.mjs')
  process.exit(0)
}

let text = readFileSync(file, 'utf8')
if (text.includes('polishOutgoing')) {
  console.log('已打过补丁，无需修改')
  process.exit(0)
}

const anchor = "const MSG = String(opt.msg ?? '').trim()"
if (!text.includes(anchor)) {
  console.error('找不到 MSG 定义，补丁失败')
  process.exit(1)
}

const helper = `
// 出站润色：正文交给 DSH 的本地润色插件（同一份档案、同一份缓存）。
async function polishOutgoing(text) {
  const raw = String(text ?? '')
  if (raw.trim() === '') return text
  try {
    const fsMod = await import('node:fs')
    const osMod = await import('node:os')
    const pathMod = await import('node:path')
    let base = process.env.LM_STUDIO_POLISH_URL || ''
    if (!base) {
      const home = process.env.DSH_HOME || pathMod.join(osMod.homedir(), '.dsh')
      try { base = fsMod.readFileSync(pathMod.join(home, 'lm-studio-polish.origin'), 'utf8').trim() } catch { base = '' }
    }
    if (!base) base = 'http://127.0.0.1:64428/api/lm-studio-polish/v1'
    const res = await fetch(base + '/reuse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: raw }),
      signal: AbortSignal.timeout(150000),
    })
    if (!res.ok) return text
    const data = await res.json()
    if (!data || !data.ok || typeof data.output !== 'string' || data.output.trim() === '') return text
    return data.output
  } catch {
    return text
  }
}

`

text = text.replace(anchor, `let MSG = String(opt.msg ?? '').trim()
// 定稿即润色：dry 打印的、真正发出的、会话里显示的，是同一段文字。
if (MSG) MSG = await polishOutgoing(MSG)`)

const firstImportEnd = text.indexOf('\n', text.indexOf('import '))
text = text.slice(0, firstImportEnd + 1) + helper + text.slice(firstImportEnd + 1)

if (!existsSync(backup)) copyFileSync(file, backup)
writeFileSync(file, text, 'utf8')
console.log('补丁已应用：MSG 定稿后先润色再打印/发送')
