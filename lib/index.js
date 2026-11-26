/**
 * dsh-lm-studio-polish —— 宿主半侧
 *
 * 定位：DSH 负责思考与执行，LM Studio 只负责「说话」。
 *
 * 做法：挂在 `llm/stream` waterfall 上，把主模型输出的文本块按段落切段，
 * 交给本地 LM Studio（OpenAI 兼容端点）做文风转写，再用改写结果填充
 * text-delta 与权威的 block-end。代码块 / 行内代码 / 路径 / URL / 数字
 * 在发送前就被切走，模型看不到，也就改不坏。
 *
 * 失败一律降级：超时、连不上、校验不过、被中止 → 回放原文。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Plugin name (also the settings namespace shown in the sidebar page). */
export const name = 'lm-studio-polish'

/** Host services this plugin needs: the model runtime and an HTTP route for its page. */
export const inject = ['llm', 'webServer']

const API_BASE = '/api/lm-studio-polish/v1'
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CONFIG_FILE = join(HOME, 'lm-studio-polish.json')
const LOG_FILE = join(HOME, 'lm-studio-polish.log')

/** Built-in voice profiles; users may edit or replace them from the sidebar page. */
const BUILTIN_PROFILES = [
  {
    id: 'natural',
    name: '自然口语',
    tone: '像一位耐心的同事在解释，语气平实，不用书面套话，不刻意抒情',
    sentence: '中短句为主，长短交错，避免连续长句',
    banned: '综上所述、需要注意的是、总的来说、本质上、首先其次最后、不难看出、让我们一起',
    extra: '',
  },
  {
    id: 'pro',
    name: '克制专业',
    tone: '技术文档作者：准确、克制，不口语化，也不堆形容词',
    sentence: '中句为主，术语原样保留',
    banned: '超级、非常非常、简直、说白了、其实呢、众所周知',
    extra: '',
  },
  {
    id: 'soft',
    name: '温柔短句',
    tone: '温和、简洁，句子短，少用形容词和惊叹号',
    sentence: '短句为主，一句话说一个意思',
    banned: '必须、显然、毫无疑问、绝对',
    extra: '',
  },
]

/** Default persisted configuration. */
const DEFAULT_CONFIG = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:1234',
  model: '',
  apiKey: '',
  timeoutMs: 30000,
  minChars: 24,
  maxRatio: 1.15,
  wholeBlock: false,
  reasoningEffort: 'none',
  profileId: 'natural',
  profiles: BUILTIN_PROFILES,
}

function log(message) {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // A missing log file must never affect a turn.
  }
}

function loadConfig() {
  let stored = {}
  try {
    if (existsSync(CONFIG_FILE)) stored = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) ?? {}
  } catch (error) {
    log(`read config failed: ${error?.message ?? error}`)
  }
  const merged = { ...DEFAULT_CONFIG, ...stored }
  if (!Array.isArray(merged.profiles) || merged.profiles.length === 0) merged.profiles = BUILTIN_PROFILES
  merged.profiles = merged.profiles
    .filter(profile => profile && typeof profile.id === 'string')
    .map(profile => ({
      id: profile.id,
      name: String(profile.name ?? profile.id),
      tone: String(profile.tone ?? ''),
      sentence: String(profile.sentence ?? ''),
      banned: String(profile.banned ?? ''),
      extra: String(profile.extra ?? ''),
    }))
  if (!merged.profiles.some(profile => profile.id === merged.profileId)) {
    merged.profileId = merged.profiles[0].id
  }
  merged.timeoutMs = clampNumber(merged.timeoutMs, 1000, 300000, DEFAULT_CONFIG.timeoutMs)
  merged.minChars = clampNumber(merged.minChars, 0, 4000, DEFAULT_CONFIG.minChars)
  merged.maxRatio = clampNumber(merged.maxRatio, 1, 3, DEFAULT_CONFIG.maxRatio)
  merged.enabled = merged.enabled !== false
  merged.wholeBlock = merged.wholeBlock === true
  merged.reasoningEffort = EFFORT_VALUES.has(String(merged.reasoningEffort))
    ? String(merged.reasoningEffort)
    : DEFAULT_CONFIG.reasoningEffort
  merged.baseUrl = String(merged.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '')
  merged.model = String(merged.model ?? '')
  merged.apiKey = String(merged.apiKey ?? '')
  return merged
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function saveConfig(config) {
  const text = JSON.stringify(config, null, 2)
  const temporary = `${CONFIG_FILE}.tmp`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, CONFIG_FILE)
}

function profileOf(config) {
  return config.profiles.find(profile => profile.id === config.profileId) ?? config.profiles[0]
}

// ---------------------------------------------------------------------------
// 保真切分：代码块、行内代码、路径、URL、数字，一律不发给模型
// ---------------------------------------------------------------------------

const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s)\]>"'，。；]+|[A-Za-z]:\\[^\s"'`，。；]+|(?<![\w.<>])\/(?:[\w.@+-]+\/)+[\w.@+-]*|\b\d+(?:[.:]\d+)*\b/g

const MARKER_START = '\u27E6'
const MARKER_END = '\u27E7'

/** Reasoning-effort values accepted for the rewrite call; `''` sends no field. */
const EFFORT_VALUES = new Set(['', 'none', 'minimal', 'low', 'medium', 'high'])

function splitProtected(text) {
  const parts = []
  let cursor = 0
  PROTECTED.lastIndex = 0
  let match
  while ((match = PROTECTED.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ kind: 'prose', text: text.slice(cursor, match.index) })
    parts.push({ kind: 'keep', text: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: 'prose', text: text.slice(cursor) })
  return parts
}

function toTemplate(parts) {
  let index = 0
  return parts.map((part) => {
    if (part.kind === 'keep') {
      index += 1
      return `${MARKER_START}${index - 1}${MARKER_END}`
    }
    return part.text
  }).join('')
}

function fromTemplate(output, parts) {
  const kept = parts.filter(part => part.kind === 'keep')
  const found = [...output.matchAll(/\u27E6(\d+)\u27E7/g)]
  if (found.length !== kept.length) return undefined
  for (let i = 0; i < found.length; i += 1) {
    if (Number(found[i][1]) !== i) return undefined
  }
  const pieces = output.split(/\u27E6\d+\u27E7/)
  if (pieces.length !== kept.length + 1) return undefined
  let rebuilt = pieces[0]
  for (let i = 0; i < kept.length; i += 1) rebuilt += kept[i].text + pieces[i + 1]
  return rebuilt
}

function proseLength(parts) {
  return parts.filter(part => part.kind === 'prose').map(part => part.text.trim()).join('').length
}

// ---------------------------------------------------------------------------
// LM Studio 客户端
// ---------------------------------------------------------------------------

let knownModels = []
let downUntil = 0

/** How long a failed rewrite keeps the conversation path quiet. */
const COOLDOWN_MS = 5 * 60 * 1000

/** Render any thrown value as a log line; aborts can carry a non-Error reason. */
function describeError(error) {
  if (typeof error === 'string') return error
  const message = error?.message
  if (typeof message === 'string' && message !== '') return message
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

const stats = {
  polished: 0,
  fallback: 0,
  skipped: 0,
  lastError: '',
  lastAt: 0,
  lastMs: 0,
  lastModel: '',
  lastReason: '',
}

function createGate(limit) {
  let active = 0
  const queue = []
  const release = () => {
    active -= 1
    const next = queue.shift()
    if (next) {
      active += 1
      next.cleanup()
      next.resolve()
    }
  }
  return {
    async enter(signal) {
      if (active < limit) {
        active += 1
        return true
      }
      return await new Promise((resolve) => {
        const waiter = {
          resolve: () => { resolve(true) },
          cleanup: () => { signal?.removeEventListener('abort', onAbort) },
        }
        const onAbort = () => {
          const position = queue.indexOf(waiter)
          if (position >= 0) queue.splice(position, 1)
          waiter.cleanup()
          resolve(false)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        queue.push(waiter)
      })
    },
    leave: release,
  }
}

const gate = createGate(1)

async function listModels(config, signal) {
  const response = await fetch(`${config.baseUrl}/v1/models`, {
    headers: headersFor(config),
    signal: signal ?? AbortSignal.timeout(config.timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
  return rows.map(row => String(row?.id ?? row?.name ?? '')).filter(Boolean)
}

function headersFor(config) {
  const headers = { 'content-type': 'application/json' }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
  return headers
}

async function complete(config, messages, signal, maxTokens, skipEffort = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), config.timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const effort = skipEffort ? '' : config.reasoningEffort
  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: headersFor(config),
      body: JSON.stringify({
        model: config.model || knownModels[0] || '',
        messages,
        temperature: 0.3,
        stream: false,
        max_tokens: maxTokens,
        ...(effort === '' ? {} : { reasoning_effort: effort }),
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // A model or template that rejects the field must not lose the rewrite:
      // retry once without reasoning_effort, then report the original failure.
      if (!skipEffort && effort !== '' && response.status === 400 && /reasoning/i.test(detail)) {
        return await complete(config, messages, signal, maxTokens, true)
      }
      throw new Error(`HTTP ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 240)}`}`)
    }
    const payload = await response.json()
    const choice = payload?.choices?.[0]?.message
    const content = choice?.content
    if (typeof content !== 'string' || content.trim() === '') {
      const reasoning = typeof choice?.reasoning_content === 'string' ? choice.reasoning_content.length : 0
      throw new Error(reasoning > 0 ? 'reasoning-only: 模型只输出了思考内容，没有正文（换一个非思考模型）' : 'empty completion')
    }
    return content
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function buildSystem(config, profile) {
  const lines = [
    '你是一位中文文字编辑，只负责改写表达，不改内容。',
    '硬规则（必须遵守）：',
    '1. 只改表达，不改事实、不改顺序、不改数量与结论；不得增加原文没有的断言；不得删掉原文的信息。',
    `2. 文中形如 ${MARKER_START}0${MARKER_END} 的占位符代表代码、路径、命令、数字或链接，必须原样保留，数量与顺序都不能变。`,
    '3. 不写开场白、不写解释、不写总结，不加标题、不加分点、不加 Markdown 标记。',
    `4. 保持原文语言；长度不超过原文的 ${config.maxRatio} 倍。`,
    '5. 只输出改写后的正文，不要任何其他内容。',
    `文风：${profile.tone}`,
    `句式：${profile.sentence}`,
  ]
  if (profile.banned) lines.push(`禁用词与禁用句式：${profile.banned}`)
  if (profile.extra) lines.push(`追加要求：${profile.extra}`)
  return lines.join('\n')
}

const BANNED_OPENERS = ['好的', '以下是', '这段', '当然', '没问题', '改写后', '润色后', '这是']

function violation(input, output, parts, config, profile) {
  if (!output || output.trim() === '') return 'empty'
  const rebuilt = fromTemplate(output, parts)
  if (rebuilt === undefined) return 'marker'
  const prose = output.replace(/\u27E6\d+\u27E7/g, '')
  // 禁用词与禁用句式按句号、问号（以及换行）分隔；顿号与逗号属于句内成分，不切。
  const banned = profile.banned.split(/[\u3002\uff1f?\n]+/).map(word => word.trim()).filter(Boolean)
  for (const word of banned) {
    if (word.length >= 2 && prose.includes(word)) return `banned:${word}`
  }
  for (const opener of BANNED_OPENERS) {
    if (prose.trimStart().startsWith(opener)) return `opener:${opener}`
  }
  const maxLength = Math.ceil(input.length * config.maxRatio) + 12
  if (rebuilt.length > maxLength) return 'ratio'
  const cjkIn = (input.match(/[\u4e00-\u9fff]/g) ?? []).length
  if (cjkIn >= 12) {
    const cjkOut = (rebuilt.match(/[\u4e00-\u9fff]/g) ?? []).length
    if (cjkOut < cjkIn * 0.6) return 'language'
  }
  return undefined
}

function unwrapFence(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return text
  const lines = trimmed.split('\n')
  if (lines.length < 3) return trimmed
  const last = lines[lines.length - 1].trim()
  if (last !== '```') return trimmed
  return lines.slice(1, -1).join('\n')
}

/**
 * Rewrite one text segment through LM Studio.
 * @param input raw segment text.
 * @param config live configuration.
 * @param signal request cancellation.
 * @returns the text to emit, plus whether it was actually rewritten.
 */
async function polishText(input, config, signal, options = {}) {
  const trimmed = input.trim()
  if (!config.enabled) return { text: input, rewritten: false, reason: 'disabled' }
  if (trimmed.length < config.minChars) return { text: input, rewritten: false, reason: 'short' }
  // A conversation turn respects the cooldown so a broken model cannot stall every
  // reply; an explicit preview from the page always tries.
  if (!options.force && Date.now() < downUntil) return { text: input, rewritten: false, reason: 'down' }

  // Models like to wrap the rewrite in blank lines; keep the segment's own
  // leading/trailing whitespace so paragraph breaks survive.
  const lead = /^\s*/.exec(input)[0]
  const trail = /\s*$/.exec(input)[0]
  const core = input.slice(lead.length, input.length - trail.length)
  if (core === '') return { text: input, rewritten: false, reason: 'protected' }

  const parts = splitProtected(core)
  if (proseLength(parts) < 6) return { text: input, rewritten: false, reason: 'protected' }

  const entered = await gate.enter(signal)
  if (!entered) return { text: input, rewritten: false, reason: 'busy' }
  const startedAt = Date.now()
  try {
    if (!config.model && knownModels.length === 0) {
      try { knownModels = await listModels(config, signal) } catch { /* fall through */ }
    }
    const template = toTemplate(parts)
    const profile = profileOf(config)
    const messages = [
      { role: 'system', content: buildSystem(config, profile) },
      { role: 'user', content: `原文：\n<<<\n${template}\n>>>` },
    ]
    // Headroom matters for thinking models: reasoning tokens are spent before
    // any content arrives, so a tight budget yields an empty rewrite.
    const budget = Math.max(2048, Math.ceil(template.length * 3))
    let output = unwrapFence(await complete(config, messages, signal, budget)).trim()
    let problem = violation(core, output, parts, config, profile)
    if (problem !== undefined) {
      const repair = [
        ...messages,
        { role: 'assistant', content: output },
        {
          role: 'user',
          content: `这版不通过（原因：${problem}）。请重写：占位符 ${MARKER_START}n${MARKER_END} 必须原样按序保留，禁止出现禁用词，禁止开场白，长度不超过原文 ${config.maxRatio} 倍，只输出正文。`,
        },
      ]
      output = unwrapFence(await complete(config, repair, signal, budget)).trim()
      problem = violation(core, output, parts, config, profile)
    }
    if (problem !== undefined) {
      stats.fallback += 1
      stats.lastReason = problem
      stats.lastMs = Date.now() - startedAt
      stats.lastAt = Date.now()
      return { text: input, rewritten: false, reason: problem }
    }
    const rebuilt = lead + fromTemplate(output, parts) + trail
    stats.polished += 1
    stats.lastReason = ''
    stats.lastMs = Date.now() - startedAt
    stats.lastAt = Date.now()
    stats.lastModel = config.model || knownModels[0] || ''
    return { text: rebuilt, rewritten: true, reason: '' }
  } catch (error) {
    const message = describeError(error)
    stats.fallback += 1
    stats.lastError = message
    stats.lastReason = 'error'
    stats.lastAt = Date.now()
    if (/timeout|fetch failed|ECONNREFUSED|abort/i.test(message)) downUntil = Date.now() + COOLDOWN_MS
    log(`polish failed: ${message}`)
    return { text: input, rewritten: false, reason: 'error', error: message }
  } finally {
    gate.leave()
  }
}

// ---------------------------------------------------------------------------
// 流式：段落级渐进
// ---------------------------------------------------------------------------

function segmentCut(text) {
  const fences = (text.match(/```/g) ?? []).length
  const safeEnd = fences % 2 === 1 ? text.lastIndexOf('```') : text.length
  const safe = text.slice(0, safeEnd)
  const paragraph = safe.lastIndexOf('\n\n')
  if (paragraph >= 18) return paragraph + 2
  let cut = -1
  const sentence = /[。！？!?；;]\s*/g
  let match
  while ((match = sentence.exec(safe)) !== null) {
    if (match.index + match[0].length >= 24) cut = match.index + match[0].length
  }
  if (cut > 0) return cut
  if (safe.length >= 900) return 900
  return -1
}

function shouldPolish(options, config) {
  if (!config.enabled) return false
  if (options.purpose !== undefined) return false
  return true
}

async function* polishStream(upstream, options, config) {
  const blocks = new Map()
  let rewrittenAny = false
  const bufferOf = (index) => {
    let state = blocks.get(index)
    if (state === undefined) {
      state = { emitted: '', rest: '' }
      blocks.set(index, state)
    }
    return state
  }

  async function* emitSegment(state, index, signal) {
    const cut = segmentCut(state.rest)
    if (cut <= 0) return
    const segment = state.rest.slice(0, cut)
    state.rest = state.rest.slice(cut)
    if (segment.trim() === '') {
      state.emitted += segment
      yield { type: 'text-delta', index, text: segment }
      return
    }
    const result = await polishText(segment, config, signal)
    if (result.rewritten) rewrittenAny = true
    state.emitted += result.text
    yield { type: 'text-delta', index, text: result.text }
  }

  try {
    for await (const chunk of upstream) {
      if (chunk.type === 'text-delta') {
        const state = bufferOf(chunk.index)
        state.rest += chunk.text
        if (config.wholeBlock) continue
        while (segmentCut(state.rest) > 0) {
          yield* emitSegment(state, chunk.index, options.signal)
        }
        continue
      }
      if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
        const state = bufferOf(chunk.index)
        if (state.rest === '' && state.emitted === '' && typeof chunk.block.text === 'string') {
          // Adapter sent only the finished block; polish it as one segment.
          const result = await polishText(chunk.block.text, config, options.signal)
          if (result.rewritten) rewrittenAny = true
          state.emitted = result.text
          if (result.rewritten) yield { type: 'text-delta', index: chunk.index, text: result.text }
          yield { ...chunk, block: { ...chunk.block, text: state.emitted } }
          continue
        }
        if (state.rest !== '') {
          const result = await polishText(state.rest, config, options.signal)
          if (result.rewritten) rewrittenAny = true
          state.emitted += result.text
          state.rest = ''
          yield { type: 'text-delta', index: chunk.index, text: result.text }
        }
        const finalText = state.emitted !== '' ? state.emitted : chunk.block.text
        yield { ...chunk, block: { ...chunk.block, text: finalText } }
        continue
      }
      if (chunk.type === 'finish') {
        if (rewrittenAny && chunk.replayState !== undefined) {
          const { replayState: _dropped, ...rest } = chunk
          yield rest
        } else {
          yield chunk
        }
        continue
      }
      yield chunk
    }
  } catch (error) {
    // A cancelled or failed attempt keeps whatever it streamed: release buffered
    // text as-is so the interrupted message is not truncated.
    for (const [index, state] of blocks) {
      if (state.rest === '') continue
      const pending = state.rest
      state.rest = ''
      state.emitted += pending
      yield { type: 'text-delta', index, text: pending }
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// HTTP API（侧栏页用自己的权限访问 loopback 路由）
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  const bytes = Buffer.from(text, 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  })
  res.end(bytes)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 512 * 1024) {
        req.destroy()
        resolve({})
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => { resolve({}) })
  })
}

function publicState(config) {
  return {
    ok: true,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeySet: config.apiKey !== '',
    timeoutMs: config.timeoutMs,
    minChars: config.minChars,
    maxRatio: config.maxRatio,
    wholeBlock: config.wholeBlock,
    reasoningEffort: config.reasoningEffort,
    profileId: config.profileId,
    profiles: config.profiles,
    models: knownModels,
    stats,
    cooldownRemainingMs: Math.max(0, downUntil - Date.now()),
    configPath: CONFIG_FILE,
    logPath: LOG_FILE,
  }
}

/** Register the sidebar page's API routes and the stream interceptor. */
export function apply(ctx) {
  const config = loadConfig()
  log(`activated; baseUrl=${config.baseUrl} enabled=${config.enabled}`)

  ctx.on('llm/stream', (options, next) => {
    const upstream = next()
    if (!shouldPolish(options, config)) return upstream
    return polishStream(upstream, options, config)
  })

  void (async () => {
    try {
      knownModels = await listModels(config)
      log(`models: ${knownModels.join(', ')}`)
    } catch (error) {
      log(`initial model probe failed: ${error?.message ?? error}`)
    }
  })()

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_BASE,
    handler: async (req, res) => {
      const path = (req.url ?? '').split('?')[0].slice(API_BASE.length) || '/'
      try {
        if (path === '/state' && req.method === 'GET') {
          return sendJson(res, 200, publicState(config))
        }
        if (path === '/models' && req.method === 'POST') {
          const body = await readBody(req)
          if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') {
            config.baseUrl = body.baseUrl.trim().replace(/\/+$/, '')
          }
          if (typeof body.apiKey === 'string') config.apiKey = body.apiKey
          try {
            knownModels = await listModels(config)
            return sendJson(res, 200, { ok: true, models: knownModels })
          } catch (error) {
            knownModels = []
            return sendJson(res, 200, { ok: false, models: [], error: String(error?.message ?? error) })
          }
        }
        if (path === '/config' && req.method === 'POST') {
          const body = await readBody(req)
          if (typeof body.enabled === 'boolean') config.enabled = body.enabled
          if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') {
            config.baseUrl = body.baseUrl.trim().replace(/\/+$/, '')
          }
          if (typeof body.model === 'string') config.model = body.model
          if (typeof body.apiKey === 'string') config.apiKey = body.apiKey
          if (body.timeoutMs !== undefined) config.timeoutMs = clampNumber(body.timeoutMs, 1000, 300000, config.timeoutMs)
          if (body.minChars !== undefined) config.minChars = clampNumber(body.minChars, 0, 4000, config.minChars)
          if (typeof body.wholeBlock === 'boolean') config.wholeBlock = body.wholeBlock
          if (typeof body.reasoningEffort === 'string' && EFFORT_VALUES.has(body.reasoningEffort)) {
            config.reasoningEffort = body.reasoningEffort
          }
          if (body.maxRatio !== undefined) config.maxRatio = clampNumber(body.maxRatio, 1, 3, config.maxRatio)
          if (typeof body.profileId === 'string' && config.profiles.some(profile => profile.id === body.profileId)) {
            config.profileId = body.profileId
          }
          if (Array.isArray(body.profiles)) {
            const cleaned = body.profiles
              .filter(profile => profile && typeof profile.id === 'string' && profile.id.trim() !== '')
              .map(profile => ({
                id: profile.id.trim(),
                name: String(profile.name ?? profile.id),
                tone: String(profile.tone ?? ''),
                sentence: String(profile.sentence ?? ''),
                banned: String(profile.banned ?? ''),
                extra: String(profile.extra ?? ''),
              }))
            if (cleaned.length > 0) {
              config.profiles = cleaned
              if (!config.profiles.some(profile => profile.id === config.profileId)) {
                config.profileId = config.profiles[0].id
              }
            }
          }
          saveConfig(config)
          return sendJson(res, 200, publicState(config))
        }
        if (path === '/preview' && req.method === 'POST') {
          const body = await readBody(req)
          const text = String(body.text ?? '')
          if (text.trim() === '') return sendJson(res, 200, { ok: false, error: 'empty input' })
          const startedAt = Date.now()
          const result = await polishText(text, config, undefined, { force: true })
          return sendJson(res, 200, {
            ok: true,
            output: result.text,
            rewritten: result.rewritten,
            reason: result.reason,
            error: result.error,
            ms: Date.now() - startedAt,
          })
        }
        return sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        log(`api error: ${error?.message ?? error}`)
        return sendJson(res, 200, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'lm-studio-polish: api route')
}
