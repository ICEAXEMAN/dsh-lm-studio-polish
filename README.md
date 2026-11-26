# dsh-lm-studio-polish

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的「文风润色」插件：**DSH 负责思考与执行，LM Studio 里的本地模型只负责「说话」**。

主力模型照常推理、照常调工具；插件挂在模型流的出口，把最终文本交给本地 LM Studio 改写得更自然，再把改写结果送回同一份输出——界面、会话日志、下一轮上下文拿到的都是同一段文字。

## 特点

- **左栏入口**：侧栏图标「文风润色」→ 主列页面；设置里也有同名分区
- **保真红线**：代码块、行内代码、URL、绝对路径、数字与版本号在发送前就被切走，模型看不到，也就改不坏
- **分段渐进**：按段落润色，段一完成就出字；可切「整段一次」
- **文风档案**：可编辑的语气 / 句式 / 禁用词 / 追加要求，内置三档，随时新建删除
- **思考强度可控**：默认 `reasoning_effort: none`，思考型模型从 96 秒降到 3.5 秒
- **失败即降级**：超时、连不上、占位符丢失、校验不过 → 原样输出原文，绝不阻塞对话

## 安装

1. 打开 DSH → **Plugins** → **Add plugin**
2. 选择本目录（或 clone 后的目录）
3. 启用后刷新页面，左侧栏出现「文风润色」

要求：LM Studio 打开本地服务器（默认 `http://127.0.0.1:1234`），并加载一个模型。

## 配置

页面里可改：地址、API Key、模型（自动列出 `/v1/models`）、思考强度、长度倍率、跳过阈值、超时、整段一次、文风档案。

也可以直接改 `$DSH_HOME/lm-studio-polish.json`：

```json
{
  "enabled": true,
  "baseUrl": "http://127.0.0.1:1234",
  "model": "google/gemma-4-12b",
  "timeoutMs": 180000,
  "minChars": 24,
  "maxRatio": 1.15,
  "wholeBlock": true,
  "reasoningEffort": "none",
  "profileId": "natural",
  "profiles": []
}
```

日志：`$DSH_HOME/lm-studio-polish.log`。

## 实测（RTX 级消费卡，8192 上下文）

| 模型 / 配置 | 12 字改写耗时 | 有正文 |
|---|---|---|
| gemma-4-12b（默认思考） | ~96 秒 | 有 |
| gemma-4-12b + `reasoning_effort: none` | **3.5 秒** | 有 |
| gemma-4-12b + `low` | 28 秒 | 无（被思考吃满） |
| deepseek-r1-0528-qwen3-8b + `medium` | ~24 秒 | 有 |
| qwen3.5-9b（默认思考） | 76 秒 | 无 |

结论：**思考型模型务必把思考强度设成 `none`**；模型不认这个字段时插件会自动去掉重试一次。

## 边界

- 只作用于**当前 profile** 里所有会话（含子代理），会话标题与压缩摘要不润色
- 润色稿会进入会话日志，`fork`、导出、续聊看到的都是改写后的文字
- 只有**全局**开关，暂时没有按会话 / 按项目开关

更多说明见 [docs/DETAIL.md](docs/DETAIL.md)。

## License

MIT
