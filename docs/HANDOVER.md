# 交接手册（给下一个接手的 agent）

> 读者：接手 `dsh-lm-studio-polish` 的 AI 或人类维护者。
> 目标：在 15 分钟内知道这东西为什么这么写、哪里不能碰、怎么验证、下一步做什么。

---

## 1. 一句话

DSH（DeepSeek Harness）的插件：**主力模型照常思考与干活，本地 LM Studio 只负责把「怎么说」重写一遍**。

实现方式只有一个：挂在 `llm/stream` waterfall 上，缓冲文本块 → 分段润色 → 用改写结果填充 `text-delta` 与**权威的** `block-end`。

---

## 2. 运行环境

| 事实 | 值 |
|---|---|
| DSH 版本 | `0.2.2-rc.5`（Desktop，打包在 `app.asar`） |
| profile | `desktop`，目录 `C:\Users\14623\.dsh\profiles\desktop` |
| 插件名 / 包名 | row id `lm-studio-polish`，包名 `dsh-lm-studio-polish` |
| 插件源码（运行用） | `C:\Users\14623\Documents\deepseek-harness\default-workspace\dsh-lm-studio-polish`（profile 里是**链接安装**，改这里立即是运行中的代码，需重载生效） |
| 发布副本 | `C:\Users\14623\Desktop\dsh-lm-studio-polish`（独立 git 仓库） |
| GitHub | https://github.com/ICEAXEMAN/dsh-lm-studio-polish |
| 配置 | `$DSH_HOME/lm-studio-polish.json`（默认 `C:\Users\14623\.dsh\`） |
| 日志 | `$DSH_HOME/lm-studio-polish.log` |
| 本地模型服务 | LM Studio，`http://127.0.0.1:1234`（OpenAI 兼容 `/v1/chat/completions`、`/v1/models`；原生信息 `/api/v0/models`） |

**两份副本必须同步**：改工作区 → 验证 → 复制到桌面 → commit/push。`lib/` 不一致就说明漏同步。

---

## 3. 数据流

```
DSH 主力模型（思考 + 工具调用，完全不动）
  └─ ctx.llm.stream → 'llm/stream' waterfall（本插件）
       ├─ options.purpose !== undefined → 原样放行（标题、压缩摘要…）
       ├─ 文本块：text-delta 累积 → 段落边界（或整段模式）切段
       │    └─ polishText(segment)
       │         ├─ 保护切分：代码/行内码/URL/路径/数字 → ⟦n⟧
       │         ├─ LM Studio /v1/chat/completions（reasoning_effort 可关思考）
       │         ├─ 校验（占位符/长度/禁用词/开场白/语言）→ 失败修复一次 → 再失败降级
       │         └─ 回填占位符，返回改写后的段落
       ├─ block-end(text) → 用累积的 emitted 文本覆盖 block.text（装配器以它为准）
       └─ finish → 若发生改写则丢掉 replayState
浏览器页面 ← /api/lm-studio-polish/v1/*（loopback，无鉴权，仅本机）
```

---

## 4. 文件地图

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Host 全部逻辑：配置读写、LM Studio 客户端、保护切分、校验、流拦截、HTTP API |
| `lib/client.js` | 浏览器半侧（手写 `__ModuleLoader__` bundle，无构建）：主面板、左栏图标、设置分区、页面 |
| `cordis.patch.yml` | 插入一行 `lm-studio-polish` |
| `package.json` | `dsh.bundle.patch` + `dsh.client` + 导出（`./client`、`./icon`、`./locale/*.json`） |
| `docs/DETAIL.md` | 面向用户的说明（插件详情节） |
| `docs/HANDOVER.md` | 本文件 |
| `locale/*.json` | `meta.title` / `meta.description` |
| `icon.svg` | 插件图标 |

---

## 5. 不能破坏的不变量

1. **`block-end` 是权威**。装配器 `BlockAssembler` 用 block-end 的 block 覆盖一切；我们必须在发 `block-end` 前把 `text` 换成「我们实际发出去的文本」。否则 UI 与日志会分叉。
2. **`⟦n⟧` 占位符必须按序、等量、原样**。少一个、换序、模型自作主张翻译占位符，一律降级为原文（`fromTemplate` 返回 undefined → `violation` 报 `marker`）。
3. **门控三档**：`purpose !== undefined` → 放行（旁路请求）；`sessionId !== undefined` → 润色（会话）；两者都没有 → 只有 `polishForeign` 开着才润色（其他插件的工具型补全）。
4. **数据不润色**：`looksLikeData()` 以 `{` `[` `<` 或 json/yaml/csv 围栏开头即判为数据，直接透传且不发请求。B 站插件的 affect/formation/social worker 靠这条活命。
5. **其他插件用更紧的预算**：`foreignTimeoutMs`（默认 20 s，B 站内部 30 s）取 `min(单次超时, foreignTimeoutMs)`；实测超过预算 75% 后自动跳过（`slow-model`），避免每条都白等。
6. **任何失败都要回放原文**，绝不能把半截改写或异常抛给 loop。异常只在 `upstream` 自己抛时向上传播。
7. **`replayState` 必须丢弃**。改写后的块与提供方的块级回放对不上（`assembler.ts` 只校验数量不校验内容）。
8. **`ctx.webServer.register` 必须包在 `ctx.effect` 里**。不包会在插件重载时留下幽灵路由，下一次激活直接报 `duplicate prefix route`（已经踩过，见 §8）。
9. **API 基路径不要再改回 `/api/lm-studio-polish`**：那个前缀在进程里可能还留着旧注册（重启后消失）；当前用 `/api/lm-studio-polish/v1`。
10. **B 站插件的内部超时才是真实上限**。`dsh-bili-whale/lib/scheduler.js` 里 social/affect/diary 三处用 `createHostTextComplete(ctx)`，默认 `timeoutMs = 30000`；不抬它，`foreignTimeoutMs` 设多大都白搭（B 站会先 abort，任务还会记一次失败）。本机已用 `tools/patch-bili-timeout.mjs` 改成 65000 并留了 `.bak-before-timeout` 备份；**B 站插件更新会覆盖，更新后重跑一次**，`--revert` 可还原。
11. **B 站私信的出站润色是独立补丁**：`tools/patch-bili-dm-polish.mjs` 在 `tools/commands/dm.mjs` 的 `MSG` 定稿处插一次 `polishOutgoing()`（POST `/reuse`）。它依赖三件东西：`$DSH_HOME/lm-studio-polish.origin`（插件启动时写下的 API 基址）、`/reuse` 端点、以及 `polishCache`（同一原文只润一次，界面与私信共享同一字符串）。补丁是幂等+带备份的；B 站更新后同样要重跑。
12. **不要把 B 站会话从润色里剔除**（`skipBiliSessions` 保持 false）：剔除后界面显示原文、而私信被 `/reuse` 润过，两边又会分叉。正确组合是「会话照常润色 + 出站复用缓存」。

---

## 6. 配置项

`$DSH_HOME/lm-studio-polish.json`（页面通过 `/config` 写它）：

| 字段 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `enabled` | `true` | bool | 总开关；关闭时 `polishText` 立即返回 |
| `baseUrl` | `http://127.0.0.1:1234` | string | 末尾斜杠会被去掉 |
| `model` | `""` | string | 空 = 自动用 `/v1/models` 第一个 |
| `apiKey` | `""` | string | 非空则加 `Authorization: Bearer` |
| `timeoutMs` | `30000` | 1000–300000 | 单次改写超时（本机现设 180000） |
| `minChars` | `24` | 0–4000 | 低于此长度的段落直接透传 |
| `maxRatio` | `1.15` | 1–3 | 长度上限倍率（校验用） |
| `wholeBlock` | `false` | bool | true = 整段一次（本地模型慢时用，本机为 true） |
| `reasoningEffort` | `none` | `'' / none / minimal / low / medium / high` | 传给 LM Studio；`''` 表示不发该字段 |
| `profileId` | `natural` | 档案 id | 当前文风档案 |
| `profiles` | 三档内置 | array | `{id,name,tone,sentence,banned,extra}` |

**禁用词分隔符**：句号 `。`、问号 `？?`、换行。顿号/逗号**故意不切**（句内成分）。

---

## 7. HTTP API（`/api/lm-studio-polish/v1`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/state` | 全部配置 + `models` + `stats` + `cooldownRemainingMs` + 路径 |
| POST | `/config` | 局部更新，返回新 state；`profiles` 整组替换 |
| POST | `/models` | 探测 LM Studio 模型列表（可带 `baseUrl`/`apiKey`） |
| POST | `/preview` | `{text}` → `{output, rewritten, reason, error, ms}`，**不受冷却限制** |

降级理由码：`disabled / short / down / protected / busy / error / ratio / marker / language / empty / banned:<词> / opener:<词>`。

---

## 8. 已知坑（全是实战踩出来的）

1. **路由要在 `ctx.effect` 内注册**。否则重载 → `duplicate prefix route` → 激活失败。修复方式见上；幽灵路由要重启进程才消失。
2. **冷却会杀死「试跑」的观感**。冷却（5 分钟）原本对所有调用生效，页面点「润色」秒回原文，看起来像坏了。现在 `/preview` 走 `{force:true}` 绕过，页面另显示冷却倒计时。
3. **超时上限曾被硬编码卡在 60000ms**，导致「设了 240 秒却 60 秒就失败」。现在上限 300000。
4. **思考模型吃光 `max_tokens`**：预算必须 `max(2048, len*3)`，否则只有 `reasoning_content`、没有 `content`。
5. **`reasoning_effort: none` 是最大的一处性能拐点**：gemma-4-12b 从 96 秒降到 3.5 秒。模型不认这个字段时（400 + 响应体含 `reasoning`）会**自动去掉字段重试一次**。
6. **模型爱在正文前后加空行**：现在的做法是先切出原文的 lead/trail 空白，再对 core 改写，最后 `lead + 改写 + trail`；模型输出本身先 `.trim()`。不要退回到整体 trim，那会吃掉段落分隔。
7. **PowerShell 5.1 的坑**：`Invoke-WebRequest` 的 `-Body` 传字符串会用 ANSI，中文变 `?`；要么传 `[Text.Encoding]::UTF8.GetBytes($json)`。另外 `Try` 不能当函数名（关键字）。
8. **读 `app.asar` 里的包只能用 Electron-as-node**：`ELECTRON_RUN_AS_NODE=1 "<DSH_NODE_EXECUTABLE>" script.js`；普通 node 读不到 asar。
9. **重载插件**：`plugin_manager set_plugin enabled:false` → `true`，target 用 `include:lm-studio-polish`。客户端 bundle 变更需要刷新页面。

---

## 9. 如何验证（不要只靠肉眼）

### 9.1 假 LM Studio 服务器（`tools/fake-lm.mjs`，不用占真模型）

```js
// 仓库自带 tools/fake-lm.mjs；下面是它的简化版，改逻辑时可直接改那个文件
import { createServer } from 'node:http'
let mode = 'echo' // echo | drops-marker | banned
createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'm' }] }))
    }
    const src = /<<<\n([\s\S]*?)\n>>>/.exec(JSON.parse(body).messages.at(-1).content)?.[1] ?? ''
    let content = src
    if (mode === 'drops-marker') content = src.replace(/\u27E6\d+\u27E7/, '')
    if (mode === 'banned') content = '综上所述，' + src
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
}).listen(0, '127.0.0.1', () => console.log('listening', 0))
```

把 `$DSH_HOME` 指到临时目录、写一份 `lm-studio-polish.json` 指向这个端口，`import` `lib/index.js` 并调 `apply(fakeCtx)`，其中 `fakeCtx = { on(), effect(fn){ const d = fn(); return typeof d === 'function' ? d : () => {} }, webServer: { register() {} } }`，然后喂 chunk：

```js
{ type: 'block-start', index: 0, blockType: 'text' }
{ type: 'text-delta', index: 0, text: '第一段。\n\n' }
{ type: 'text-delta', index: 0, text: '路径是 `C:\\work\\a.js`。\n\n' }
{ type: 'block-end', index: 0, block: { type: 'text', text: '……全文……' } }
{ type: 'finish', reason: { kind: 'stop' }, replayState: { response: {} } }
```

断言清单：
- 请求体里**不含**代码/路径原文，**含** `⟦`
- 最终 `block-end.block.text` 与原文完全一致（echo 模式）
- `drops-marker` / `banned` 模式下最终文本等于原文（降级）
- `purpose: 'session-title'` 时不产生任何请求
- `replayState` 被丢弃

### 9.2 真机

```powershell
# 状态
Invoke-WebRequest 'http://127.0.0.1:64428/api/lm-studio-polish/v1/state' -UseBasicParsing | % Content

# 试跑（注意 UTF-8 字节）
$b = [Text.Encoding]::UTF8.GetBytes((@{ text = '要被润色的一段话' } | ConvertTo-Json -Compress))
Invoke-WebRequest 'http://127.0.0.1:64428/api/lm-studio-polish/v1/preview' -Method POST -Body $b -ContentType 'application/json; charset=utf-8' -UseBasicParsing
```

### 9.3 本机实测（2026-11-26，`gemma-4-12b` / `qwen3.5-9b` / `deepseek-r1-0528-qwen3-8b`）

| 配置 | 12 字改写耗时 | 有正文 |
|---|---|---|
| gemma-4-12b 默认（思考） | ~96 s | 有 |
| gemma-4-12b + `reasoning_effort:none` | **3.5 s** | 有 |
| gemma-4-12b + `low` | 28 s | 无 |
| deepseek-r1-0528-qwen3-8b + `medium` | 24 s（短句）/ 59 s（长句） | 有 |
| qwen3.5-9b 默认 | 76 s | 无 |
| qwen3.5-9b + `none` | 20.8 s | 有 |

---

## 10. 当前线上配置

```json
{
  "enabled": true,
  "model": "deepseek/deepseek-r1-0528-qwen3-8b",
  "reasoningEffort": "medium",
  "timeoutMs": 180000,
  "wholeBlock": true,
  "minChars": 3,
  "maxRatio": 1.15,
  "profileId": "custom-4"
}
```

`custom-4` = 用户自建档案「白纸」，约 370 字：开朗轻快、只叫「你」、句子短、说完就停、不演深沉；禁用项按句号分隔（好的/收到/综上所述/总之/希望对你有帮助/建议您/…）。

> 提醒：`minChars: 3` 会让极短片段也触发一次 20–60 秒的调用，是用户自己调的；若要提速建议改回 24。

---

## 11. 待办（按价值排序）

1. **按会话 / 按项目开关**：目前只有全局开关。`llm/stream` 的 `options.sessionId` 可拿到，做白名单即可。
2. **跳过子代理**：子代理终稿也被润色，多代理任务每条多 20–60 秒。
3. **试跑走真实分段管线**：现在 `/preview` 只跑单段 `polishText`，看不到渐进切段效果。
4. **i18n**：页面文案目前硬编码中文，没有走 `ctx.locale`。
5. **统计持久化**：`stats` 只在内存，重载即清零。
6. **详情页配图**：`docs/DETAIL.md` 尚无预览图（参考 `references/plugin-details.md`）。

---

## 12. 接手检查清单

- [ ] `GET /state` 返回 200，`models` 非空
- [ ] `/preview` 一段中文 → `rewritten: true`
- [ ] `/preview` 一段带 ``` 代码块和 `C:\path` 的文字 → 代码与路径原样
- [ ] 日志无 `duplicate prefix route`
- [ ] `lib/` 两份副本哈希一致
- [ ] 页面：左栏有「文风润色」图标，主面板能改模型并保存

---

## 13. 协作约定（用户偏好）

- 说中文，直接给结论和可执行步骤，不要寒暄、不要请示。
- 改完要真跑一遍再汇报，别只贴代码。
- 数值要给实测（秒数、字节数），不要「大概」。
- 用户会自己在页面里改设置；发现配置被改过是正常的，别覆盖回默认值。
