# ChatFree 架构文档

## 概述

ChatFree 是一个 Chrome 浏览器扩展（Manifest V3），将 DeepSeek、ChatGPT、豆包等 AI 聊天平台嵌入到统一的独立页面中。用户通过扩展图标打开独立页面，在插件自带的输入框中输入问题，消息被转发到嵌入的 iframe 中的目标平台，目标平台的回复直接在 iframe 中渲染。

核心架构思想：**Embed-only + Site Adapter（可替换站点适配器）**。不解析、不重新渲染 AI 回复——目标平台在 iframe 中完整运行，处理所有登录、对话、渲染逻辑。

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│  index.html (独立页面，chrome-extension://)           │
│  ┌──────────────────────────────────────────────┐   │
│  │  app.js (主控)                                │   │
│  │    ├─ 加载 input-area.js (输入区域模块)        │   │
│  │    ├─ 加载 sync-embed.js (embed 模块)         │   │
│  │    ├─ 管理 UI 状态 (status, input, debug)     │   │
│  │    └─ 通过 postMessage 与 iframe 内通信        │   │
│  └───────────┬──────────────────────────────────┘   │
│              │                                       │
│  ┌───────────▼──────────────────────────────────┐   │
│  │  input-area.js (输入区域)                      │   │
│  │  ┌─────────────────────────────────────────┐  │   │
│  │  │  input-layout (左右分栏)                  │  │   │
│  │  │  ├─ preset-panel.js ← 左侧：规则预设      │  │   │
│  │  │  └─ input-main       ← 右侧：输入框+按钮   │  │   │
│  │  └─────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
│                 │ postMessage                        │
│  ┌──────────────▼───────────────────────────────┐   │
│  │  <iframe> chat.deepseek.com/#chatfree-embed   │   │
│  │  ┌─────────────────────────────────────────┐  │   │
│  │  │ content-core.js (共享基础设施)            │  │   │
│  │  │   ├─ 检测 embed 模式 (window.name/hash)  │  │   │
│  │  │   ├─ 隐藏目标平台原生输入框                │  │   │
│  │  │   ├─ 接收转发消息 → 填入目标输入框 → 发送  │  │   │
│  │  │   └─ 拦截 SSE 流 (fetch wrapper)          │  │   │
│  │  ├─────────────────────────────────────────┤  │   │
│  │  │ site-deepseek.js (站点适配器)             │  │   │
│  │  │   ├─ 输入框选择器                         │  │   │
│  │  │   ├─ 输入容器查找 (隐藏整个底部栏)         │  │   │
│  │  │   ├─ SSE URL 匹配                        │  │   │
│  │  │   └─ SSE 数据提取                         │  │   │
│  │  └─────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  background.js (Service Worker)                      │
│    ├─ 登录状态检测 (cookie 检查)                      │
│    ├─ Ping 诊断 (注入 content script 到已有 tab)       │
│    └─ debug 消息转发                                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  rules_headers.json (declarativeNetRequest)           │
│    └─ 移除 X-Frame-Options + CSP，允许 iframe 嵌入    │
└─────────────────────────────────────────────────────┘
```

## 文件结构

```
ChatFree/
├── index.html              # 独立页面 UI
├── app.js                  # 主控逻辑：模块加载、状态管理、debug 面板
├── app.css                 # 全部样式
├── background.js           # Service Worker：登录检测、消息路由
├── manifest.json           # Manifest V3 配置
├── rules_headers.json      # 移除 embed 阻止头
├── content_deepseek.js     # DeepSeek 站点最后一公里（当前为占位）
├── content_doubao.js       # 豆包站点最后一公里（当前为占位）
├── content_chatgpt.js      # ChatGPT 完整内容脚本（未迁移到新架构）
├── data/
│   └── 定制规则.json          # 预设规则种子数据（启动时 fetch 加载）
├── modules/
│   ├── sync-embed.js       # Embed 同步模块 —— iframe 生命周期管理
│   ├── input-area.js       # 输入区域模块 —— 左右分栏布局、发送组合
│   ├── preset-panel.js     # 规则预设面板 —— 可选规则、本地持久化
│   ├── content-core.js     # 共享内容脚本基础设施
│   ├── site-deepseek.js    # DeepSeek 站点适配器
│   └── site-doubao.js      # 豆包 站点适配器
└── icons/                  # 扩展图标
```

## 核心模块

### 1. app.js — 主控逻辑

**职责**：页面初始化、模块加载/卸载、后端切换、UI 状态管理、debug 日志面板。

关键状态（`state` 对象，与模块共享）：
- `backend`: 当前后端 (`deepseek` | `chatgpt` | `doubao`)
- `loggedIn`: 登录状态
- `requestId`: 请求计数器

关键流程：
1. `DOMContentLoaded` → `checkLoginStatus()` → `loadModule()`
2. `loadModule()`: 停止旧模块 → 创建 `EmbedSyncModule` → 调用 `init()`
3. 后端切换: `onBackendChange()` → 重置状态 → `checkLoginStatus()` → `loadModule()`

### 2. input-area.js — 输入区域模块

**职责**：管理输入区域的完整 UI 和交互。创建左右分栏布局，左侧嵌入规则预设面板，右侧保持原有的输入框 + 按钮。组合预设规则和用户输入文本，提供给同步模块发送。

**接口**：`createInputAreaModule({ container, state, utils })` → `{ init, getComposedText, clear, setEnabled, onSend, onSync, onTest, dom }`

**左右分栏布局** (`buildUI`):
- `#input-layout`: flex 容器，水平排列
- `#preset-panel`（左栏）: 宽度 210px，嵌入 `preset-panel.js` 模块
- `#input-main`（右栏）: flex:1，包含 textarea + 按钮组

**组合发送** (`getComposedText`):
- 获取左侧预设面板中所有启用规则的文本，用 `\n` 连接
- 获取右侧 textarea 中的用户输入
- 若有启用规则，组合为 `{规则文本}\n\n{用户输入}`；否则直接使用用户输入
- 此组合逻辑使用户可预先选中规则（如"直接回答，不寒暄"），自动附加到每次发送中

**事件代理**：
- `onSend(cb)`: 发送回调，cb 接收组合后的文本
- `onSync(cb)`: 重载 iframe 回调
- `onTest(cb)`: 测试连接回调
- 内部处理 Enter 键发送（不组合 Shift+Enter）

**DOM 引用暴露** (`dom` 对象):
- `inputEl`, `sendBtn`, `testBtn`, `syncBtn`: 供 sync-embed.js 控制启用/禁用状态

### 3. preset-panel.js — 规则预设面板

**职责**：管理预设规则（Rules）的独立模块。用户可创建、编辑、删除规则，勾选启用的规则文本会自动附加到发送消息前。支持从本地 JSON 文件批量导入。

**接口**：`createPresetPanel({ container })` → `{ getActiveRulesText, onChange, getPresets }`

**数据模型**：纯内存，浏览器内置能力。
1. **启动**：`fetch(data/定制规则.json)` → 内存 → 渲染 UI
2. **编辑**：`<dialog>` 弹窗（名称 + 文本表单）→ 修改内存 → 重新渲染
3. **关闭**：`beforeunload` 检测修改 → 自动触发下载 `定制规则.json` + 浏览器"离开?"对话框
4. **用户替换** `data/定制规则.json` → 重启生效

> **说明**：Chrome 扩展无法运行时写入安装目录。用 `<dialog>`（浏览器内置）代替 `prompt()`，用 `beforeunload` 自动下载代替手动 💾 按钮。数据流：`文件 → fetch → 内存 → dialog 编辑 → beforeunload 下载 → 用户替换文件`。

**默认规则**：`data/定制规则.json` 内置 12 个规则作为起点：
| 规则 | 说明 |
|------|------|
| Skip pleasantries | 直接给出答案，不要寒暄客套 |
| 直击要点 | 先核心答案，再细节补充 |
| 简洁回答 | 一段话讲清楚，避免冗长 |
| 逐步推理 | 复杂问题先分析再给出方案 |
| 中文优先 | 使用中文回答 |
| 避免过度设计 | 保持简单，不过度抽象 |
| 代码最佳实践 | 注重可读性、可维护性 |
| 错误处理 | 边界条件检查 |
| 安全编码 | 避免 XSS/SQL/命令注入 |
| 使用最新 API | 避免已弃用方法 |
| 代码格式 | 语言标记 + 一致缩进 |
| 提供示例 | 具体代码而非抽象描述 |

**UI 交互**：
- 每条规则显示 checkbox + 标签名 + 灰色规则文本预览
- 新增/编辑：弹出浏览器内置 `<dialog>`，含名称 input + 文本 textarea，保存/取消按钮
- hover 时显示 ✎ 编辑按钮
- 右键 → `confirm()` 确认删除
- 关闭页签时 `beforeunload` 检测修改 → 自动下载 `定制规则.json` 文件

### 4. sync-embed.js — Embed 同步模块

**职责**：管理 iframe 完整生命周期，通过 `postMessage` 与 iframe 内的 content script 通信。

**接口**：`createEmbedSyncModule({ state, dom, utils })` → `{ init, sync, send, stop }`

**iframe 创建** (`createIframe`):
- 设置 `src` 为 `{backend_url}#chatfree-embed`，`name` 为 `chatfree_embed_v1`
- 创建后 **移除容器的 `hidden` class**，使 embed 区域可见
- 监听 `load` 事件 → 1500ms 后 ping content script 确认 readiness

**消息协议**（`postMessage` 双向通信）：

| 方向 | type | 说明 |
|------|------|------|
| 父→子 | `chatfree-forward-input` | 转发用户输入 |
| 父→子 | `chatfree-ping` | 探测 content script 是否就绪 |
| 子→父 | `chatfree-ready` | content script 就绪，输入已隐藏 |
| 子→父 | `chatfree-sent` | 消息已发送到目标平台 |
| 子→父 | `chatfree-error` | 发送失败 |
| 子→父 | `chatfree-log-msg` | 调试日志转发 |
| 子→父 | `chatfree-response-start` | SSE 流开始 |
| 子→父 | `chatfree-response-done` | SSE 流结束 |

**iframe 销毁** (`stop`):
- 移除 iframe DOM 元素，重置 `_ready`
- **添加容器的 `hidden` class**，隐藏 embed 区域

**visibility 管理（Bug 修复点）**:
- 原 `app.js` 在 `loadModule()` 中直接控制 `embedArea.classList.remove('hidden')`，重构去掉 text-sync 分支时被误删
- 修复方案：将 visibility 控制移入模块内部，`createIframe()` 显示，`stop()` 隐藏，与 iframe 生命周期自洽

### 5. content-core.js — 共享内容脚本基础设施

**职责**：所有站点共用的通用逻辑，通过站点适配器 (`window.__ChatFreeSiteAdapter`) 获取站点差异。

加载顺序（manifest 中声明）：
```
1. modules/site-{name}.js  → 设置 window.__ChatFreeSiteAdapter
2. modules/content-core.js  → 读取适配器，启动 embed 模式
3. content_deepseek.js      → 站点特定最后一公里 (可选)
```

**embed 检测**：通过 `window.name === 'chatfree_embed_v1'` 或 `location.hash` 包含 `chatfree-embed` 或 `document.referrer` 以 `chrome-extension://` 开头来判断是否在 embed 模式。

**输入隐藏** (`hideNativeInput`):
- 使用适配器的 `findInputContainer()` 定位要隐藏的元素
- 将元素移到屏幕外 (`position:fixed; left:-9999px; top:-9999px`)
- 保留了 SPA 页面导航后的重新隐藏观察器 (`MutationObserver`)

**消息转发** (`doChatViaDOM`):
- 接收来自父页面的 `chatfree-forward-input` 消息
- 通过原生 setter 填入文本 (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set`)
- 多策略尝试发送: Enter → 附近按钮 → SVG 按钮 → Ctrl+Enter → 底部按钮 → 最后扫描
- 发送前安装 SSE 拦截器

**SSE 拦截** (`installSSEInterceptor`):
- 包装 `window.fetch`，拦截匹配的 SSE 请求
- 使用 `ReadableStream` reader 逐块读取
- 800ms 静默超时自动完成
- 向父页面报告 `response-start` / `response-done`

### 6. site-deepseek.js — DeepSeek 站点适配器

**职责**：提供 DeepSeek (chat.deepseek.com) 的所有站点特定行为。

**输入选择器**（按优先级）：
1. `textarea[placeholder*="消息"]`
2. `textarea[placeholder*="问题"]`
3. `textarea[placeholder*="message"]`
4. `#chat-input`
5. `[role="textbox"]`
6. `textarea` (通用 fallback)

**输入容器查找** (`findInputContainer`)（Bug 修复点）：
三级查找策略，修复重构回归 —— 原实现被误简化为只隐藏 textarea 自身：

1. **struct(ds-buttons)**: 向上遍历 DOM，找包含 DeepSeek 设计系统按钮（`.ds-toggle-button`、`.ds-icon-button`、`.ds-atom-button`）的祖先容器，直接隐藏整个底部工具栏
2. **geo(bottom)**: 几何 fallback —— 容器底部在视口底部 30px 以内且高度 < 视口 50%
3. **null**: fallback 到隐藏 textarea 自身

**SSE 匹配**：URL 包含 `/chat/completion`

**SSE 提取**：解析 `{ o: "APPEND", v: [...] }` 格式，过滤 `type: "RESPONSE"` 的片段

### 7. site-doubao.js — 豆包站点适配器

与 DeepSeek 适配器接口相同，差异点：
- `needsVisibleInput: true` — trySend 需要输入框可见才能通过几何找到发送按钮
- SSE URL 匹配更宽泛 (`/api/`, `/chat/`, `/stream`, `doubao`, `ark`)
- SSE 提取支持多种格式（DeepSeek 式、OpenAI 式、通用字段）
- 输入容器查找当前为 `textarea(self)`，仅隐藏 textarea 自身

### 8. background.js — Service Worker

**职责**：
- `chrome.action.onClicked` → 打开独立页面 (`index.html`)
- `checkLogin` → 检查目标域名的 cookie 判断登录状态
- `ping` → 向已打开的 tab 发送 ping 消息，必要时注入 content script
- debug 消息转发到 app 页面

## 数据流

### 用户发送消息的完整链路

```
1. 用户在插件输入框输入文本，按 Enter 或点 Send
        │
2. input-area.js: getComposedText()
   → 获取启用规则文本 + 用户输入文本 → 组合
        │
3. app.js: syncModule.send(composedText)
        │
4. sync-embed.js: iframe.contentWindow.postMessage({
        type: 'chatfree-forward-input', text: composedText })
        │
5. content-core.js: 'message' listener 接收
        │
6. findInput() → 找到目标平台输入框
   fillInput() → 通过原生 setter 填入文本
   trySend() → 多策略触发发送
        │
7. 目标平台处理请求，发起 SSE 请求
        │
8. installSSEInterceptor 的 fetch wrapper 拦截 SSE
   processSSEStream → 逐块读取 → 报告 response-start/done
        │
9. sync-embed.js 接收 postMessage，更新 UI 状态
```

### 登录检测链路

```
1. app.js 启动 → checkLoginStatus()
        │
2. chrome.runtime.sendMessage({ action: 'checkLogin', backend })
        │
3. background.js: chrome.cookies.getAll({ domain })
   → 检查 session token cookie 是否存在
        │
4. 返回 { loggedIn: true/false }
```

### Debug 日志链路

```
content-core.js (iframe内)
  → postMessage({ type: 'chatfree-log-msg' })
    → sync-embed.js (父页面)
      → appendDebug('cs', msg)
        → 渲染到 debug panel + 写入 localStorage

background.js
  → chrome.runtime.sendMessage({ type: 'debug' })
    → app.js chrome.runtime.onMessage
      → appendDebug('bg', msg)
        → 渲染到 debug panel + 写入 localStorage

app.js 内部
  → appendDebug('app', msg)
    → 直接渲染到 debug panel + 写入 localStorage
```

**localStorage 持久化** (`app.js`):

- **Key**: `chatfree_app_log`
- **最大条目**: 500 条（滚动缓冲区，超出自动截断旧条目）
- **格式**: JSON 数组，每项 `{ t: timestamp, s: source, m: message, l?: level }`
  - `t`: Unix 毫秒时间戳
  - `s`: 来源标识 (`"app"` | `"bg"` | `"cs"`)
  - `m`: 日志文本
  - `l`: 日志级别（`"err"` 等，可选）
- **写入时机**: 每次 `appendDebug()` 调用时同步写入
- **清除时机**: 用户点击 Clear 按钮时同时清除 DOM 和 localStorage
- **恢复**: 页面加载时 (`DOMContentLoaded`) 自动从 localStorage 恢复到 debug 面板

外部程序可直接读取 `localStorage.getItem('chatfree_app_log')` 获取调试日志，无需访问 DOM。

## 关键设计决策

1. **Embed > 解析**：不提取和重新渲染 AI 回复，让目标平台在 iframe 中完整运行。避免处理 markdown 渲染、代码高亮、流式更新等复杂逻辑。

2. **站点适配器模式**：每个站点通过 `window.__ChatFreeSiteAdapter` 暴露差异化配置（选择器、SSE 格式），共享的 `content-core.js` 消费这些配置。新增站点只需创建一个新的适配器文件。

3. **postMessage 桥接**：父页面和 iframe 之间的通信通过 `postMessage`，支持跨域 iframe。消息通过 `event.source` 校验来源。

4. **fetch 拦截而非 DOM 监听**：SSE 检测通过包装 `window.fetch` 实现，而不是监听 DOM 变化。这种方式不依赖 DOM 结构，更可靠。

5. **原生 value setter 填入文本**：使用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` 而非直接赋值，确保 React/Vue 等框架能正确响应输入变化。

6. **输入区域模块化 + 规则预设**：输入区域独立为 `input-area.js` 模块，内部采用左右分栏布局。左侧 `preset-panel.js` 管理可切换的预设规则，右侧保持原有输入功能。发送时自动将启用规则文本前置到用户输入前，实现 AI 输出规范化（如跳过客套话、统一代码风格），避免手动重复输入。规则支持用户增删改和文件批量导入，数据通过 localStorage 持久化。

## 扩展加载规则

manifest.json 中声明了 content scripts 的注入规则：

```json
{
  "matches": ["https://chat.deepseek.com/*"],
  "js": ["modules/site-deepseek.js", "modules/content-core.js", "content_deepseek.js"],
  "run_at": "document_idle",
  "all_frames": true
}
```

`all_frames: true` 确保在 iframe 内也注入，使 embed 模式工作。加载顺序保证适配器先于基础设施设置。

`rules_headers.json` 通过 `declarativeNetRequest` 移除目标站点的 `X-Frame-Options` 和 `Content-Security-Policy` 响应头，解除 iframe 嵌入限制。
