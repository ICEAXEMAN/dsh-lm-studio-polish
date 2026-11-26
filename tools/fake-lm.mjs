/**
 * 假 LM Studio：不占用真模型就能验证插件的整条管线。
 *
 *   node tools/fake-lm.mjs            # 打印端口后常驻
 *   MODE=drops-marker node tools/fake-lm.mjs
 *
 * MODE:
 *   echo          原样回显模板（验证占位符还原与长度校验）
 *   drops-marker  故意丢掉一个占位符（验证降级）
 *   banned        加一句禁用词（验证禁用词校验）
 *   slow          延迟 3 秒（验证超时降级）
 */
import { createServer } from 'node:http'

const mode = process.env.MODE ?? 'echo'
const delay = mode === 'slow' ? 3000 : 0

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
      return
    }
    const source = /<<<\n([\s\S]*?)\n>>>/.exec(JSON.parse(body).messages.at(-1).content)?.[1] ?? ''
    let content = source
    if (mode === 'drops-marker') content = source.replace(/\u27E6\d+\u27E7/, '')
    if (mode === 'banned') content = '综上所述，' + source
    const reply = () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    }
    if (delay > 0) setTimeout(reply, delay)
    else reply()
  })
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`fake LM Studio (${mode}) listening on http://127.0.0.1:${port}`)
  console.log(`把 lm-studio-polish.json 的 baseUrl 指过去即可；Ctrl+C 结束。`)
})
