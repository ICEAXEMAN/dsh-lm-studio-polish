/**
 * dsh-lm-studio-polish —— 浏览器半侧（手写 bundle，无需构建工具）
 *
 * 两处入口：
 *   1. 左侧栏图标（sidebar.panellist）→ 主列页面（main，key 与之同名）
 *   2. 设置分区（settings.section）同名页面，方便从设置里直达
 *
 * 与宿主只走同源 HTTP：/api/lm-studio-polish/*
 */
window.__ModuleLoader__.load({
  id: 'dsh-lm-studio-polish',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useMemo = React.useMemo
    var useState = React.useState

    var API = '/api/lm-studio-polish/v1'

    function readJson(res) {
      return res.text().then(function (text) {
        var data = null
        try { data = text === '' ? null : JSON.parse(text) } catch (e) { data = null }
        if (!res.ok) {
          var msg = data && data.error ? data.error : ('HTTP ' + res.status)
          throw new Error(msg)
        }
        return data
      })
    }

    function apiGet(path) {
      return fetch(API + path, { cache: 'no-store' }).then(readJson)
    }

    function apiPost(path, body) {
      return fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(readJson)
    }

    var CSS = [
      '.lsp-root{display:flex;flex-direction:column;gap:14px;padding:18px 20px 32px;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e6);height:100%;overflow:auto;box-sizing:border-box}',
      '.lsp-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.lsp-title{font-size:15px;font-weight:600}',
      '.lsp-sub{font-size:12px;opacity:.6}',
      '.lsp-dot{width:8px;height:8px;border-radius:50%;flex:none}',
      '.lsp-dot.on{background:#3ecf8e}.lsp-dot.off{background:#8a8a8a}.lsp-dot.bad{background:#e0625b}',
      '.lsp-card{border:1px solid rgba(127,127,127,.26);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:rgba(127,127,127,.05)}',
      '.lsp-card h3{margin:0;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}',
      '.lsp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.lsp-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px}',
      '.lsp-field label{font-size:11.5px;opacity:.66}',
      '.lsp-input,.lsp-select,.lsp-area{font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.34);border-radius:8px;padding:6px 9px;outline:none;min-width:0}',
      '.lsp-input:focus,.lsp-select:focus,.lsp-area:focus{border-color:rgba(120,170,255,.8)}',
      '.lsp-select{background:rgba(20,20,20,.35)}',
      '.lsp-area{min-height:70px;resize:vertical;line-height:1.55}',
      '.lsp-btn{padding:6px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.36);background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}',
      '.lsp-btn:hover{background:rgba(127,127,127,.14)}',
      '.lsp-btn.primary{border-color:rgba(120,170,255,.75);background:rgba(120,170,255,.18)}',
      '.lsp-btn.danger{border-color:rgba(255,110,110,.5);color:#ff8f8f}',
      '.lsp-btn:disabled{opacity:.45;cursor:progress}',
      '.lsp-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}',
      '.lsp-note{font-size:11.5px;opacity:.62;line-height:1.5}',
      '.lsp-out{border:1px solid rgba(127,127,127,.22);border-radius:8px;padding:10px;white-space:pre-wrap;line-height:1.6;background:rgba(127,127,127,.06);max-height:280px;overflow:auto}',
      '.lsp-meta{font-size:11.5px;opacity:.62;display:flex;gap:10px;flex-wrap:wrap}',
      '.lsp-bad{color:#ff8f8f}',
      '.lsp-good{color:#3ecf8e}',
      '.lsp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
      '.lsp-stat{font-size:11.5px;opacity:.72}',
    ].join('')

    var REASON_TEXT = {
      short: '太短，跳过',
      protected: '没有可改写的自然语言',
      down: '冷却中',
      busy: '排队超时',
      error: '调用失败',
      ratio: '长度超限',
      marker: '占位符对不上',
      language: '语言被换掉',
      empty: '空返回',
      disabled: '未启用',
    }

    function reasonLabel(reason) {
      if (!reason) return '未改写'
      if (reason.indexOf('banned:') === 0) return '命中禁用词「' + reason.slice(7) + '」'
      if (reason.indexOf('opener:') === 0) return '被禁的开场白「' + reason.slice(7) + '」'
      return REASON_TEXT[reason] || reason
    }

    function Field(props) {
      return h('div', { className: 'lsp-field' },
        h('label', null, props.label),
        props.children,
      )
    }

    function Page() {
      var s = useState(null)
      var data = s[0]
      var setData = s[1]
      var e = useState('')
      var error = e[0]
      var setError = e[1]
      var b = useState(false)
      var busy = b[0]
      var setBusy = b[1]
      var d = useState({ tone: '', sentence: '', banned: '', extra: '', name: '' })
      var draft = d[0]
      var setDraft = d[1]
      var p = useState('')
      var previewInput = p[0]
      var setPreviewInput = p[1]
      var r = useState(null)
      var previewResult = r[0]
      var setPreviewResult = r[1]
      var m = useState('')
      var notice = m[0]
      var setNotice = m[1]

      function applyState(next) {
        setData(next)
        var active = null
        if (next && next.profiles) {
          for (var i = 0; i < next.profiles.length; i += 1) {
            if (next.profiles[i].id === next.profileId) active = next.profiles[i]
          }
          if (active === null) active = next.profiles[0] || null
        }
        if (active) {
          setDraft({ id: active.id, name: active.name, tone: active.tone, sentence: active.sentence, banned: active.banned, extra: active.extra })
        }
      }

      function load() {
        setBusy(true)
        apiGet('/state')
          .then(function (next) { applyState(next); setError('') })
          .catch(function (err) { setError(String(err && err.message ? err.message : err)) })
          .then(function () { setBusy(false) })
      }

      useEffect(function () { load() }, [])

      function save(patch, label) {
        setBusy(true)
        apiPost('/config', patch)
          .then(function (next) { applyState(next); setNotice(label || '已保存'); setError('') })
          .catch(function (err) { setError(String(err && err.message ? err.message : err)) })
          .then(function () { setBusy(false) })
      }

      function probeModels() {
        setBusy(true)
        apiPost('/models', { baseUrl: data ? data.baseUrl : undefined, apiKey: undefined })
          .then(function (result) {
            if (result.ok) {
              setNotice('发现 ' + result.models.length + ' 个模型')
              load()
            } else {
              setError('连不上 LM Studio：' + (result.error || '未知错误'))
            }
          })
          .catch(function (err) { setError(String(err && err.message ? err.message : err)) })
          .then(function () { setBusy(false) })
      }

      function runPreview() {
        if (previewInput.trim() === '') return
        setBusy(true)
        setPreviewResult(null)
        apiPost('/preview', { text: previewInput })
          .then(function (result) { setPreviewResult(result) })
          .catch(function (err) { setError(String(err && err.message ? err.message : err)) })
          .then(function () { setBusy(false) })
      }

      function saveProfile() {
        if (!data) return
        var profiles = data.profiles.map(function (profile) {
          if (profile.id !== draft.id) return profile
          return { id: draft.id, name: draft.name, tone: draft.tone, sentence: draft.sentence, banned: draft.banned, extra: draft.extra }
        })
        save({ profiles: profiles, profileId: draft.id }, '档案已保存')
      }

      function addProfile() {
        if (!data) return
        var base = data.profiles.length + 1
        var id = 'custom-' + base
        var next = data.profiles.concat([{ id: id, name: '新档案 ' + base, tone: '', sentence: '', banned: '', extra: '' }])
        save({ profiles: next, profileId: id }, '已新建档案')
      }

      function removeProfile() {
        if (!data || data.profiles.length <= 1) return
        var next = data.profiles.filter(function (profile) { return profile.id !== draft.id })
        save({ profiles: next, profileId: next[0].id }, '档案已删除')
      }

      if (data === null) {
        return h('div', { className: 'lsp-root' },
          h('div', { className: 'lsp-title' }, 'LM Studio 文风润色'),
          error ? h('div', { className: 'lsp-note lsp-bad' }, error) : h('div', { className: 'lsp-note' }, '正在读取插件状态…'),
        )
      }

      var models = data.models || []
      var statusClass = data.enabled ? (models.length > 0 ? 'on' : 'bad') : 'off'
      var statusText = data.enabled ? (models.length > 0 ? '已连接 · ' + models.length + ' 个模型' : '未探测到 LM Studio') : '已关闭'

      return h('div', { className: 'lsp-root' },
        h('div', { className: 'lsp-head' },
          h('span', { className: 'lsp-title' }, 'LM Studio 文风润色'),
          h('span', { className: 'lsp-dot ' + statusClass }),
          h('span', { className: 'lsp-sub' }, statusText),
          h('span', { style: { flex: 1 } }),
          h('label', { className: 'lsp-switch' },
            h('input', {
              type: 'checkbox',
              checked: data.enabled === true,
              onChange: function (event) { save({ enabled: event.target.checked }, event.target.checked ? '已开启润色' : '已关闭润色') },
            }),
            h('span', null, '启用润色'),
          ),
        ),
        error ? h('div', { className: 'lsp-note lsp-bad' }, error) : null,
        notice ? h('div', { className: 'lsp-note lsp-good' }, notice) : null,
        data.cooldownRemainingMs > 0
          ? h('div', { className: 'lsp-note lsp-bad' },
              '会话润色冷却中（还剩 ' + Math.ceil(data.cooldownRemainingMs / 1000) + ' 秒）：模型上次失败过，这段时间回答不会被润色；下面的「试跑」不受影响。')
          : null,

        h('div', { className: 'lsp-card' },
          h('h3', null, '连接与模型'),
          h('div', { className: 'lsp-row' },
            h(Field, { label: 'LM Studio 地址' },
              h('input', {
                className: 'lsp-input',
                value: data.baseUrl,
                onChange: function (event) { setData(Object.assign({}, data, { baseUrl: event.target.value })) },
                onBlur: function (event) { save({ baseUrl: event.target.value }, '地址已保存') },
              }),
            ),
            h(Field, { label: 'API Key（可留空）' },
              h('input', {
                className: 'lsp-input',
                type: 'password',
                placeholder: data.apiKeySet ? '已设置，留空表示不改' : '可选',
                onChange: function (event) { setDraft(Object.assign({}, draft, { __key: event.target.value })) },
                onBlur: function (event) {
                  if (event.target.value !== '') save({ apiKey: event.target.value }, '密钥已保存')
                },
              }),
            ),
          ),
          h('div', { className: 'lsp-row' },
            h(Field, { label: '使用的模型' },
              h('select', {
                className: 'lsp-select',
                value: data.model || '',
                onChange: function (event) { save({ model: event.target.value }, '模型已切换') },
              },
                h('option', { value: '' }, models.length > 0 ? '（自动：' + models[0] + '）' : '（自动：探测到的第一个）'),
                models.map(function (model) {
                  return h('option', { key: model, value: model }, model)
                }),
              ),
            ),
            h(Field, { label: '手动填模型 id' },
              h('input', {
                className: 'lsp-input',
                value: data.model || '',
                placeholder: '留空 = 自动',
                onChange: function (event) { setData(Object.assign({}, data, { model: event.target.value })) },
                onBlur: function (event) { save({ model: event.target.value }, '模型已保存') },
              }),
            ),
            h('button', { className: 'lsp-btn', disabled: busy, onClick: probeModels }, '刷新模型列表'),
          ),
          h('div', { className: 'lsp-row' },
            h(Field, { label: '思考强度（思考模型务必设 none）' },
              h('select', {
                className: 'lsp-select',
                value: data.reasoningEffort || '',
                onChange: function (event) { save({ reasoningEffort: event.target.value }, '思考强度已保存') },
              },
                h('option', { value: 'none' }, 'none（不思考，最快）'),
                h('option', { value: 'low' }, 'low'),
                h('option', { value: 'medium' }, 'medium'),
                h('option', { value: 'high' }, 'high'),
                h('option', { value: '' }, '不传该字段（交给模型默认）'),
              ),
            ),
          ),
          h('div', { className: 'lsp-note' }, '实测：gemma-4-12b 带思考要 96 秒，设 none 后 3.5 秒；模型不接受该字段时会自动去字段重试一次。'),
          h('div', { className: 'lsp-note' }, '润色在宿主进程里完成，页面只负责读写设置；模型列表来自 LM Studio 的 /v1/models。'),
        ),

        h('div', { className: 'lsp-card' },
          h('h3', null, '文风档案'),
          h('div', { className: 'lsp-row' },
            h(Field, { label: '当前档案' },
              h('select', {
                className: 'lsp-select',
                value: draft.id || '',
                onChange: function (event) {
                  var id = event.target.value
                  var active = null
                  data.profiles.forEach(function (profile) { if (profile.id === id) active = profile })
                  if (active) setDraft({ id: active.id, name: active.name, tone: active.tone, sentence: active.sentence, banned: active.banned, extra: active.extra })
                  save({ profileId: id }, '已切换档案')
                },
              },
                data.profiles.map(function (profile) { return h('option', { key: profile.id, value: profile.id }, profile.name) }),
              ),
            ),
            h('button', { className: 'lsp-btn', disabled: busy, onClick: addProfile }, '新建'),
            h('button', { className: 'lsp-btn danger', disabled: busy || data.profiles.length <= 1, onClick: removeProfile }, '删除'),
            h('button', { className: 'lsp-btn primary', disabled: busy, onClick: saveProfile }, '保存档案'),
          ),
          h(Field, { label: '档案名称' },
            h('input', { className: 'lsp-input', value: draft.name || '', onChange: function (event) { setDraft(Object.assign({}, draft, { name: event.target.value })) } }),
          ),
          h(Field, { label: '文风（像谁在说话）' },
            h('textarea', { className: 'lsp-area', value: draft.tone || '', onChange: function (event) { setDraft(Object.assign({}, draft, { tone: event.target.value })) } }),
          ),
          h(Field, { label: '句式偏好' },
            h('input', { className: 'lsp-input', value: draft.sentence || '', onChange: function (event) { setDraft(Object.assign({}, draft, { sentence: event.target.value })) } }),
          ),
          h(Field, { label: '禁用词 / 禁用句式（用句号或问号分隔）' },
            h('input', { className: 'lsp-input', value: draft.banned || '', onChange: function (event) { setDraft(Object.assign({}, draft, { banned: event.target.value })) } }),
          ),
          h(Field, { label: '追加要求（可选，写不进硬规则之上）' },
            h('textarea', { className: 'lsp-area', value: draft.extra || '', onChange: function (event) { setDraft(Object.assign({}, draft, { extra: event.target.value })) } }),
          ),
          h('div', { className: 'lsp-note' }, '硬规则（只改表达、不改事实、占位符原样、不加标题分点、原语言）在代码里写死，档案改不到它。'),
        ),

        h('div', { className: 'lsp-card' },
          h('h3', null, '节奏与保真'),
          h('div', { className: 'lsp-grid' },
            h(Field, { label: '长度上限（倍率）' },
              h('input', {
                className: 'lsp-input', type: 'number', step: '0.05', min: '1', max: '2',
                value: String(data.maxRatio),
                onChange: function (event) { setData(Object.assign({}, data, { maxRatio: Number(event.target.value) })) },
                onBlur: function (event) { save({ maxRatio: Number(event.target.value) }, '倍率已保存') },
              }),
            ),
            h(Field, { label: '低于多少字跳过' },
              h('input', {
                className: 'lsp-input', type: 'number', step: '1', min: '0', max: '2000',
                value: String(data.minChars),
                onChange: function (event) { setData(Object.assign({}, data, { minChars: Number(event.target.value) })) },
                onBlur: function (event) { save({ minChars: Number(event.target.value) }, '阈值已保存') },
              }),
            ),
            h(Field, { label: '单次超时（毫秒）' },
              h('input', {
                className: 'lsp-input', type: 'number', step: '500', min: '1000', max: '300000',
                value: String(data.timeoutMs),
                onChange: function (event) { setData(Object.assign({}, data, { timeoutMs: Number(event.target.value) })) },
                onBlur: function (event) { save({ timeoutMs: Number(event.target.value) }, '超时已保存') },
              }),
            ),
          ),
          h('div', { className: 'lsp-note' }, '按段落渐进润色：一段落边界出现就润一段，长段落退化成句级切分；代码块未闭合时先攒着，避免把半截代码发出去。'),
          h('label', { className: 'lsp-switch' },
            h('input', {
              type: 'checkbox',
              checked: data.wholeBlock === true,
              onChange: function (event) { save({ wholeBlock: event.target.checked }, event.target.checked ? '改为整段一次' : '改为分段渐进') },
            }),
            h('span', null, '整段一次（本地模型较慢、或模型带思考过程时推荐）'),
          ),
          h('div', { className: 'lsp-note' }, '注意：思考模型（如 deepseek-r1、gemma-4）会先输出一段思考再出正文，单次耗时会明显变长；纯改写任务用非思考的 instruct 小模型更合适。'),
        ),

        h('div', { className: 'lsp-card' },
          h('h3', null, '试跑'),
          h('textarea', {
            className: 'lsp-area',
            placeholder: '粘一段话，用当前档案润一次——不经过会话，不会写进日志。',
            value: previewInput,
            onChange: function (event) { setPreviewInput(event.target.value) },
          }),
          h('div', { className: 'lsp-row' },
            h('button', { className: 'lsp-btn primary', disabled: busy || previewInput.trim() === '', onClick: runPreview }, busy ? '润色中…' : '润色这段'),
            previewResult ? h('span', { className: 'lsp-meta' },
              h('span', null, '耗时 ' + previewResult.ms + ' ms'),
              h('span', { className: previewResult.rewritten ? 'lsp-good' : 'lsp-bad' },
                previewResult.rewritten ? '已改写' : '保留原文（' + reasonLabel(previewResult.reason) + '）'),
            ) : null,
          ),
          previewResult && previewResult.error
            ? h('div', { className: 'lsp-note lsp-bad' }, '失败原因：' + previewResult.error)
            : null,
          previewResult ? h('div', { className: 'lsp-out' }, previewResult.output) : null,
        ),

        h('div', { className: 'lsp-card' },
          h('h3', null, '运行状态'),
          h('div', { className: 'lsp-meta' },
            h('span', null, '已润色段数 ' + (data.stats.polished || 0)),
            h('span', null, '降级 ' + (data.stats.fallback || 0)),
            h('span', null, '最近耗时 ' + (data.stats.lastMs || 0) + ' ms'),
            h('span', null, '最近模型 ' + (data.stats.lastModel || '—')),
          ),
          data.stats.lastReason ? h('div', { className: 'lsp-note' }, '最近降级原因：' + data.stats.lastReason) : null,
          data.stats.lastError ? h('div', { className: 'lsp-note lsp-bad' }, '最近错误：' + data.stats.lastError) : null,
          h('div', { className: 'lsp-note' }, '配置：' + data.configPath),
          h('div', { className: 'lsp-note' }, '日志：' + data.logPath),
        ),
      )
    }

    function Icon(props) {
      var size = props && typeof props.size === 'number' ? props.size : 20
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M4 18.5c3.2-.6 5.4-1.8 7.2-3.9C13.1 12.4 14.2 9.6 15 6.2' }),
        h('path', { d: 'M9.5 19.5c2.6-1.9 4.2-4.4 5.1-7.4' }),
        h('path', { d: 'M16.8 4.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z' }),
      )
    }

    function apply(ctx) {
      ctx.effect(function () {
        var id = 'dsh-lm-studio-polish-styles'
        if (document.getElementById(id) === null) {
          var style = document.createElement('style')
          style.id = id
          style.textContent = CSS
          document.head.appendChild(style)
        }
        return function () {
          var el = document.getElementById(id)
          if (el !== null && el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-lm-studio-polish: styles')

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'lm-studio-polish',
          order: 40,
          label: function () { return '文风润色' },
        }, Icon)
      })

      try {
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: 'lm-studio-polish' }, Page)
        })
      } catch (error) {
        // A refused main panel must not take the sidebar entry down with it.
        console.warn('[lm-studio-polish] main panel registration failed:', error)
      }

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'lm-studio-polish',
          order: 48,
          label: function () { return '文风润色' },
        }, Page)
      })
    }

    module.exports = {
      name: 'lm-studio-polish',
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
