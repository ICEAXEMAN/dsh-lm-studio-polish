/**
 * 把 B 站插件（dsh-bili-whale）三条工具型补全的超时从默认 30 秒抬到 65 秒，
 * 否则「其他插件的润色预算」再大也活不过它自己的 30 秒。
 *
 *   node tools/patch-bili-timeout.mjs          # 应用（幂等，自动备份 .bak-before-timeout）
 *   node tools/patch-bili-timeout.mjs --revert # 从备份还原
 *
 * 注意：B 站插件更新会覆盖这个改动，更新后重跑一次即可。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const profile = process.env.DSH_PROFILE_DIR ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')
const file = join(profile, 'node_modules', 'dsh-bili-whale', 'lib', 'scheduler.js')
const backup = `${file}.bak-before-timeout`

if (!existsSync(file)) {
  console.error(`找不到 ${file}：确认 B 站插件已安装，或用 DSH_PROFILE_DIR 指定 profile 目录`)
  process.exit(1)
}

if (process.argv.includes('--revert')) {
  if (!existsSync(backup)) {
    console.error(`没有备份 ${backup}`)
    process.exit(1)
  }
  copyFileSync(backup, file)
  console.log('已从备份还原 scheduler.js')
  process.exit(0)
}

let text = readFileSync(file, 'utf8')
const original = text
let patched = 0

const rewrite = (from, to) => {
  if (!text.includes(from)) return
  text = text.split(from).join(to)
  patched += 1
}

rewrite('createHostTextComplete(ctx),run:runBili', 'createHostTextComplete(ctx,{timeoutMs:65000}),run:runBili')
rewrite('createHostTextComplete(ctx),signal:lifecycle.signal,persona:personaBlock', 'createHostTextComplete(ctx,{timeoutMs:65000}),signal:lifecycle.signal,persona:personaBlock')
rewrite('createHostTextComplete(ctx),persona:personaBlock,signal:lifecycle.signal', 'createHostTextComplete(ctx,{timeoutMs:65000}),persona:personaBlock,signal:lifecycle.signal')

if (text === original) {
  console.log('无需修改：三条调用点已经是自定义超时（或已被其他补丁处理）')
  process.exit(0)
}

if (!existsSync(backup)) copyFileSync(file, backup)
writeFileSync(file, text, 'utf8')
console.log(`已修改 ${patched} 处调用点，超时 30000 → 65000`)

const leftovers = [...text.matchAll(/createHostTextComplete\(ctx\)/g)].length
console.log(leftovers === 0 ? '全部调用点已带自定义超时' : `仍有 ${leftovers} 处使用默认超时`)
