# 极客云签 (GeekMark) 项目文档

> 最后更新：2026-09-03
> 版本：1.0.4

## 目录

1. [项目概述](#1-项目概述)
2. [项目结构](#2-项目结构)
3. [技术栈](#3-技术栈)
4. [核心功能](#4-核心功能)
5. [数据存储](#5-数据存储)
6. [同步逻辑](#6-同步逻辑)
7. [WebDAV 后端](#7-webdav-后端)
8. [文件格式](#8-文件格式)
9. [配置项](#9-配置项)
10. [消息通信](#10-消息通信)
11. [安全机制](#11-安全机制)
12. [移动端适配](#12-移动端适配)
13. [已知限制](#13-已知限制)
14. [开发指南](#14-开发指南)
15. [更新日志](#15-更新日志)

---

## 1. 项目概述

### 1.1 项目定位

极客云签 (GeekMark) 是一个 Chrome MV3 浏览器扩展，通过 WebDAV 协议实现多设备智能同步浏览器书签。专门适配 123 云盘、坚果云等国内 WebDAV 服务。

### 1.2 架构特点

- **纯前端架构**：项目本身只有前端代码（Chrome 扩展），没有自建后端服务器
- **第三方后端承载**：书签数据存储在用户自己的 WebDAV 服务器（如 123 云盘、坚果云）上，扩展只负责读写
- **数据主权**：所有数据（书签、配置、加密密钥）仅保存在用户本地设备和用户自己的 WebDAV 服务器上，不经过任何第三方服务器
- **无遥测**：不收集任何用户数据，不发送任何遥测信息

### 1.3 基于 Floccus 精简

项目基于 [Floccus](https://github.com/floccusaddon/floccus) (MIT License) 精简重构：
- 去掉了复杂的多后端支持（只保留 WebDAV）
- 去掉了 Nextcloud、WebDAV+、本地文件等后端
- 去掉了 MOVE、DELETE、锁文件、缓存树等复杂逻辑
- 只使用 GET + PUT 两个 HTTP 方法，兼容不支持 MOVE 的服务器（如 123 云盘）
- 新增了多设备智能同步、端到端加密、变更日志等原创功能

---

## 2. 项目结构

```
GeekMark/
├── manifest.json              # MV3 扩展配置文件
├── background.js              # 后台 Service Worker，核心同步逻辑（约 71KB）
├── privacy.md                 # 隐私政策（Markdown 格式，内置在扩展中）
├── README.md                  # 用户使用文档
├── PROJECT.md                 # 本文档（项目开发文档）
│
├── adapters/
│   └── webdav.js              # WebDAV 适配器（GET 下载 / PUT 上传 / 加解密）（约 23KB）
│
├── serializers/
│   └── html.js                # 书签树 ↔ Netscape HTML 格式序列化（正则解析，兼容 MV3）
│
├── common/
│   └── darkmode.js            # 深色模式共享逻辑（popup 和 options 共用）
│
├── popup/                     # 工具栏弹窗
│   ├── popup.html             # 弹窗页面（状态展示 + 手动同步 + 高级同步 + 冲突详情）
│   └── popup.js               # 弹窗逻辑
│
├── options/                   # 设置页面
│   ├── options.html           # 设置页面（服务器配置 + 同步策略 + 书签管理 + 备份 + 日志 + 隐私政策）
│   └── options.js             # 设置逻辑
│
└── icons/                     # 图标资源
    ├── icon16.png             # 扩展图标 16x16
    ├── icon32.png             # 扩展图标 32x32
    ├── icon48.png             # 扩展图标 48x48
    ├── icon128.png            # 扩展图标 128x128
    ├── notify_success.png     # 通知图标（成功）
    ├── notify_error.png       # 通知图标（失败）
    ├── icon_main.svg          # SVG 源文件：主图标
    ├── icon_upload.svg        # SVG 源文件：上传
    ├── icon_download.svg      # SVG 源文件：下载
    ├── icon_sync.svg          # SVG 源文件：同步
    ├── icon_success.svg       # SVG 源文件：成功
    ├── icon_error.svg         # SVG 源文件：失败
    ├── icon_folder.svg        # SVG 源文件：文件夹
    └── icon_bookmark.svg      # SVG 源文件：书签
```

### 2.1 文件职责说明

| 文件 | 职责 | 关键内容 |
|------|------|----------|
| manifest.json | 扩展配置 | MV3 声明、权限、入口页面 |
| background.js | 核心逻辑 | 同步引擎、变更管理、冲突检测、备份恢复、消息路由 |
| webdav.js | WebDAV 通信 | URL 构建、文件上传下载、加解密、重试机制 |
| html.js | 序列化 | 书签树 ↔ HTML 转换、完整性校验 |
| darkmode.js | 共享工具 | 深色模式切换（popup/options 共用） |
| popup.html/js | 弹窗 UI | 快速状态查看、手动同步、高级同步 |
| options.html/js | 设置 UI | 完整配置、书签管理、备份、日志、隐私政策 |

---

## 3. 技术栈

### 3.1 扩展框架

- **Chrome Extension Manifest V3 (MV3)**
- **Service Worker** 作为后台脚本（`background.js`，`type: module`）
- **chrome.bookmarks API**：书签的增删改查
- **chrome.alarms API**：定时同步（替代 setTimeout，避免 Service Worker 回收）
- **chrome.storage API**：本地数据存储（`chrome.storage.local`）
- **chrome.notifications API**：系统通知
- **chrome.runtime API**：消息通信（popup/options ↔ background）

### 3.2 前端技术

- 原生 HTML/CSS/JavaScript（无框架依赖）
- ES Modules（`import`/`export`）
- Web Crypto API（加密/解密/哈希）
- Fetch API（WebDAV 通信）

### 3.3 数据格式

- **书签文件**：Netscape Bookmarks HTML 格式（标准浏览器书签导出格式）
- **变更日志**：JSON 格式
- **配置**：JSON 格式（存储在 chrome.storage.local）
- **加密文件**：自定义二进制格式（Base64 编码）

### 3.4 不使用的技术

- **不使用 DOMParser**：MV3 Service Worker 环境中不可用，改用正则 + 文件夹栈解析 HTML
- **不使用第三方库**：零依赖，纯原生实现
- **不使用 IndexedDB**：所有数据用 chrome.storage.local 存储

---

## 4. 核心功能

### 4.1 三种同步策略

| 策略 | 标识 | 行为 | 适用场景 |
|------|------|------|----------|
| 多设备智能同步 | `merge` | 下载云端变更 → 全量合并新增 → 应用云端变更 → 合并变更日志 → 上传 | 多设备日常同步（默认推荐） |
| 本地覆盖云端 | `local` | 直接上传本地书签到云端，不下载不合并 | 本地是最新的，强制覆盖云端 |
| 云端覆盖本地 | `server` | 下载云端书签 → 清空本地 → 导入云端书签，不上传 | 云端是最新的，强制覆盖本地 |

### 4.2 多种触发方式

| 触发方式 | 开关配置项 | 默认值 | 说明 |
|----------|-----------|--------|------|
| 浏览器启动时同步 | `syncOnStartupEnabled` | 开启 | 浏览器启动后自动同步一次 |
| 定时同步 | `syncIntervalEnabled` | 开启 | 每隔指定分钟数自动同步 |
| 同步间隔（分钟） | `syncInterval` | 15 | 定时同步的间隔时间 |
| 书签变更时同步 | `syncOnChangeEnabled` | 开启 | 检测到书签变更后防抖同步 |
| 手动同步 | - | - | popup 页面点击"立即同步"按钮 |

### 4.3 防抖机制

- 默认防抖时间：**3 秒**（`INACTIVITY_TIMEOUT = 3000ms`）
- 批量删除检测：最近 5 秒内删除 ≥ 10 个书签时，自动延长防抖到 **10 秒**
- 实现方式：`chrome.alarms` 兜底（Service Worker 回收后 setTimeout 会丢失，用 alarms 确保同步不丢失）

### 4.4 多设备智能同步

基于变更日志的智能同步，核心设计：

1. **变更记录**：本地书签发生删除、移动、重命名、文件夹操作时，记录到本地变更日志（`pendingChanges`）
2. **新增不记录**：新增书签走全量合并，不记录变更日志（用户确认的设计决策）
3. **7 种变更类型**：
   - 书签级：`delete`（删除）、`move`（移动）、`rename`（重命名）
   - 文件夹级：`folder_create`（创建）、`folder_delete`（删除）、`folder_rename`（重命名）、`folder_move`（移动）
4. **冲突处理**：同一 URL 或文件夹的双向变更，按时间戳晚的覆盖早的，时间相同本地优先，不弹框
5. **流程顺序**：先全量合并新增，再应用云端变更
6. **方案C**：全量合并新增时检查本地 pendingChanges 中的 delete 记录，本地已删除的书签不加回来

### 4.5 书签管理

| 功能 | 说明 |
|------|------|
| 选择性导出 | 弹窗展示本地书签树，勾选要导出的书签/文件夹，生成 HTML 文件 |
| 选择性导入 | 三步弹窗：选择来源（本地文件/网络直链）→ 勾选书签 → 选择模式和目标位置 |
| 导入模式 | 合并式导入（保留现有）/ 覆盖式导入（先备份→清空→导入） |
| 导入目标位置 | 可选择导入到书签栏/其他书签/任意已有文件夹，或新建文件夹 |
| 一键清空 | 自动备份后清空本地所有书签，可从备份恢复 |
| 链接导入 | 支持粘贴书签 HTML 直链下载导入 |

### 4.6 备份与恢复

- 同步前自动备份本地书签
- 保留最近 **5 份**备份（`MAX_BACKUPS = 5`）
- 覆盖式导入和一键清空时也会自动备份
- 备份存储在 `chrome.storage.local`
- 设置页面可查看备份列表、恢复指定备份

### 4.7 操作日志

- 记录最近 **50 条**操作（`MAX_LOGS = 50`）
- 记录类型：同步（成功/失败）、导出书签、合并式导入、覆盖式导入、一键清空
- 每条日志包含：时间、成功/失败、策略、新增数、删除数、冲突数、错误信息
- 设置页面可查看完整日志列表

### 4.8 冲突检测与详情

- 自动识别同一 URL 标题不同的冲突
- 自动识别同一文件夹的双向变更冲突
- 冲突处理：按时间戳晚的覆盖早的
- popup 页面可查看冲突详情（冲突的 URL、本地标题、云端标题）

### 4.9 首次同步智能引导

- 自动检测本地和云端数据状态
- 本地有、云端无 → 自动上传
- 本地无、云端有 → 自动下载
- 两边都无 → 直接建立同步基线
- 两边都有 → 弹出选择框（本地上传/云端下载/双向合并）

### 4.10 WebDAV 文件夹管理

- 书签文件存放在用户指定的文件夹中（默认 `Bookmarks`）
- 可自定义文件夹名称
- 首次同步时自动创建文件夹
- 检查文件夹是否存在（只读探测，不创建）
- 文件夹名称重复检查

### 4.11 测试连接

- 只读探测，不创建文件
- 验证服务器可达性和认证
- 结果以系统通知形式提示（连接测试成功/连接测试失败）

### 4.12 暂停同步

- 一键暂停自动同步（启动/定时/变更触发都暂停）
- 手动同步仍可触发
- popup 页面显示暂停状态（badge 显示 "P"）

### 4.13 新标签页打开

- popup 可在新标签页中全宽打开
- 点击 popup 标题栏的外部链接图标即可

### 4.14 深色模式

- 三种模式：自动（跟随系统）/ 浅色 / 深色
- popup 和 options 都适配
- 共享逻辑在 `common/darkmode.js`

### 4.15 设备 ID

- 每设备唯一 UUID v4（`crypto.randomUUID()`）
- 存储在 `chrome.storage.local` 的 `deviceId`
- 用于变更日志的设备标识
- 设置页面可查看和复制设备 ID

---

## 5. 数据存储

### 5.1 存储位置

所有数据存储在 `chrome.storage.local`（仅当前设备，不同步到 Chrome 账号）。

### 5.2 存储键列表

| 键名 | 类型 | 说明 |
|------|------|------|
| `settings` | Object | 用户配置（服务器地址、用户名、密码、同步策略等） |
| `syncState` | Object | 同步状态（lastSync、lastError、syncing、currentPhase 等） |
| `pendingChanges` | Array | 本地未同步的变更记录 |
| `deviceId` | string | 当前设备的唯一 UUID |
| `backups` | Array | 本地书签备份列表（最多 5 份） |
| `syncLogs` | Array | 操作日志列表（最多 50 条） |

### 5.3 不使用 chrome.storage.sync

密码和配置只存储在 `chrome.storage.local`，不随 Chrome 账号同步。原因：
- 密码安全：避免密码通过 Google 服务器同步
- 多设备独立：每台设备可以有独立的配置
- 避免冲突：多设备同时修改配置可能导致冲突

---

## 6. 同步逻辑

### 6.1 多设备智能同步流程（merge 策略）

```
1. 下载云端 bookmarks.html 和 changes.json
2. 全量合并新增书签
   - 本地有云端没有的 → 标记为待上传
   - 云端有本地没有的 → 检查本地 delete 记录，未删除则添加到本地
   - URL 规范化去重
3. 冲突检测
   - 同一 URL 标题不同 → 记录冲突，按时间戳处理
   - 同一文件夹双向变更 → 记录冲突，按时间戳处理
4. 应用云端变更（按时间戳顺序）
   - delete：删除本地书签
   - move：移动本地书签
   - rename：重命名本地书签
   - folder_create/delete/rename/move：文件夹操作
   - 并发数：5（CONCURRENT_CHANGES）
5. 合并变更日志
   - 本地 pendingChanges + 云端 changes.json
   - 按 UUID 去重（O(n)）
   - 归并排序（O(n)，两边都已按时间戳排序）
   - 清理：最多 1000 条，保留 90 天
6. 上传
   - 上传 bookmarks.html（内容无变化则跳过）
   - 上传 changes.json
   - 都上传成功才标记本地变更为已同步
```

### 6.2 同步阶段标识

`syncState.currentPhase` 记录当前同步阶段，popup 页面显示：

| 阶段 | 标识 | 显示文字 |
|------|------|----------|
| 下载中 | `downloading` | 下载中... |
| 合并中 | `merging` | 合并中... |
| 应用变更中 | `applying` | 应用变更中... |
| 上传中 | `uploading` | 上传中... |
| 完成 | `done` | 同步完成 |

### 6.3 同步锁与排队

- `syncState.syncing`：同步锁，防止并发同步
- `syncQueued`：排队标记，同步中触发的变更排队等待
- 当前同步完成后，如果有排队标记，延迟 1 秒再执行一次同步

### 6.4 操作 ID 白名单

区分"同步产生的变更"和"用户产生的变更"：

- `operatingIds` Set：记录正在被同步操作修改的书签 ID
- 同步操作（删除/移动/重命名/创建）前后更新白名单
- `onBookmarkChange` 检查变更 ID 是否在白名单里
  - 在 → 同步产生的，忽略，不记录变更日志
  - 不在 → 用户操作，记录变更日志并触发同步
- 新增书签后延迟 1.5 秒取消标记（等待 created 事件触发完）

### 6.5 本地覆盖云端（local 策略）

- 直接上传本地书签到云端
- 不下载、不合并
- 上传 bookmarks.html 和 changes.json（空或本地变更）

### 6.6 云端覆盖本地（server 策略）

- 下载云端 bookmarks.html
- 备份本地书签
- 清空本地所有书签
- 导入云端书签到本地
- 不上传

---

## 7. WebDAV 后端

### 7.1 后端架构

项目本身没有自建后端服务器，所有书签数据存储在用户自己的 WebDAV 服务器上。扩展通过 WebDAV 协议（HTTP GET/PUT）直接读写用户的 WebDAV 服务器。

```
┌─────────────┐   HTTP GET/PUT    ┌─────────────────┐
│  Chrome 扩展 │ ◄──────────────► │  WebDAV 服务器   │
│ (background) │                    │ (123云盘/坚果云) │
└─────────────┘                    └─────────────────┘
     │                                    │
     │ chrome.storage.local               │ 书签文件存储
     ▼                                    ▼
┌─────────────┐                    ┌─────────────────┐
│  本地存储    │                    │  Bookmarks/      │
│ (配置/备份)  │                    │  ├ bookmarks.html│
└─────────────┘                    │  └ changes.json  │
                                    └─────────────────┘
```

### 7.2 支持的 WebDAV 服务

| 服务 | WebDAV 地址 | 特点 |
|------|-------------|------|
| 123 云盘 | `https://webdav.123pan.cn/webdav` | 不支持 MOVE，只用 GET/PUT；免费版有流量和频率限制 |
| 坚果云 | `https://dav.jianguoyun.com/dav/` | 标准 WebDAV，支持所有方法 |
| 其他标准 WebDAV | 用户自定义 | 只要支持 GET/PUT 即可 |

### 7.3 服务器端文件路径

用户配置的 WebDAV 根目录下，自动创建 `Bookmarks` 文件夹（可自定义名称），里面存放两个文件：

```
WebDAV 根目录/
└── Bookmarks/                    # 用户可自定义文件夹名（默认 Bookmarks）
    ├── bookmarks.html            # 书签文件（Netscape HTML 格式，可加密）
    └── changes.json              # 变更日志（JSON 格式，可加密）
```

**完整 URL 示例（123 云盘）**：
- 书签文件：`https://webdav.123pan.cn/webdav/Bookmarks/bookmarks.html`
- 变更日志：`https://webdav.123pan.cn/webdav/Bookmarks/changes.json`

### 7.4 HTTP 方法

| 方法 | 用途 | 说明 |
|------|------|------|
| GET | 下载文件 | 下载 bookmarks.html 和 changes.json |
| PUT | 上传文件 | 上传 bookmarks.html 和 changes.json（覆盖写入） |
| PROPFIND | 测试连接/检查文件夹 | 只读探测，验证服务器可达性和文件夹是否存在 |

**不使用的方法**：MOVE、DELETE、MKCOL、LOCK、UNLOCK（123 云盘不支持 MOVE，所以全部用 PUT 覆盖写入）

### 7.5 认证方式

- HTTP Basic Auth
- 用户名和密码（授权码）由用户在设置页面配置
- 中文用户名支持：使用 UTF-8 编码（`btoa(unescape(encodeURIComponent(credentials)))`）

### 7.6 重试机制

- 最多重试 **3 次**
- 指数退避：2000ms → 5000ms → 10000ms
- 重试条件：网络错误、超时、5xx、429（限流）
- 不重试：4xx（认证错误、找不到等）

### 7.7 超时保护

- 单次请求超时：**30 秒**
- 使用 `AbortController` 实现超时中断

---

## 8. 文件格式

### 8.1 书签文件（bookmarks.html）

**格式**：Netscape Bookmarks HTML 格式（标准浏览器书签导出格式）

**示例**：
```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>书签栏</H3>
    <DL><p>
        <DT><A HREF="https://www.example.com">示例网站</A>
        <DT><H3>工作</H3>
        <DL><p>
            <DT><A HREF="https://docs.example.com">文档</A>
        </DL><p>
    </DL><p>
</DL><p>
```

**解析方式**：正则 + 文件夹栈（不使用 DOMParser，MV3 Service Worker 中不可用）

**完整性校验**：
1. 空内容检查
2. 内容过短检查（< 30 字节）
3. 基本格式检查（必须包含 `<DL>` 标签）
4. 异常字符占比检查（正常字符占比 < 70% 视为损坏）
5. 解析结果合理性检查

### 8.2 变更日志（changes.json）

**格式**：JSON 数组，每个元素是一条变更记录

**单条变更记录结构**：
```json
{
  "id": "uuid-v4-唯一标识",
  "type": "delete | move | rename | folder_create | folder_delete | folder_rename | folder_move",
  "payload": {
    "url": "https://www.example.com",
    "title": "书签标题",
    "oldFolderPath": "旧文件夹路径",
    "newFolderPath": "新文件夹路径",
    "folderPath": "文件夹路径"
  },
  "timestamp": 1693728000000,
  "deviceId": "当前设备的UUID"
}
```

**变更类型说明**：

| 类型 | payload 字段 | 说明 |
|------|-------------|------|
| `delete` | `url`, `title` | 书签被删除 |
| `move` | `url`, `title`, `oldFolderPath`, `newFolderPath` | 书签被移动 |
| `rename` | `url`, `title` | 书签被重命名 |
| `folder_create` | `folderPath` | 文件夹被创建 |
| `folder_delete` | `folderPath` | 文件夹被删除（含里面所有书签） |
| `folder_rename` | `oldFolderPath`, `newFolderPath` | 文件夹被重命名 |
| `folder_move` | `oldFolderPath`, `newFolderPath` | 文件夹被移动 |

**清理策略**：
- 最多保留 **1000 条**（`MAX_CHANGE_LOG_ENTRIES = 1000`）
- 保留最近 **90 天**（`CHANGE_LOG_RETENTION_MS = 90天`）
- 本地已同步超过 7 天的记录自动清理

### 8.3 本地待同步变更（pendingChanges）

存储在 `chrome.storage.local`，结构和 changes.json 相同，但多一个 `synced` 字段：

```json
{
  "id": "uuid-v4",
  "type": "delete",
  "payload": { "...": "..." },
  "timestamp": 1693728000000,
  "deviceId": "设备UUID",
  "synced": false
}
```

- `synced: false`：未同步，下次同步时上传
- `synced: true`：已同步，保留 7 天后自动清理

### 8.4 加密文件格式

当用户设置了加密密钥时，上传的 bookmarks.html 和 changes.json 会被加密。

**文件格式**：
```
WBE1:<base64(salt(16字节) + iv(12字节) + ciphertext)>
```

**字段说明**：

| 字段 | 长度 | 说明 |
|------|------|------|
| 魔数 | 5 字节 | `WBE1:`（固定前缀，用于识别加密文件） |
| salt | 16 字节 | PBKDF2 盐值，随机生成 |
| iv | 12 字节 | AES-GCM 初始化向量，随机生成 |
| ciphertext | 可变 | AES-256-GCM 加密后的密文（含认证标签） |

**加密参数**：
- 密钥派生：PBKDF2，100000 次迭代，SHA-256
- 加密算法：AES-256-GCM
- 密钥长度：256 位
- 密钥来源：用户设置的 8-16 位加密密钥

**多设备要求**：所有设备必须使用完全相同的加密密钥，否则无法解密对方同步的文件。

---

## 9. 配置项

所有配置存储在 `chrome.storage.local` 的 `settings` 对象中。

### 9.1 服务器配置

| 配置项 | 键名 | 类型 | 默认值 | 说明 |
|--------|------|------|--------|------|
| 服务器地址 | `url` | string | `''` | WebDAV 服务器 URL |
| 用户名 | `username` | string | `''` | WebDAV 用户名 |
| 密码 | `password` | string | `''` | WebDAV 密码/授权码 |
| 书签文件名 | `bookmark_file` | string | `bookmarks.html` | 书签文件名称 |
| WebDAV 文件夹名 | `webdav_folder` | string | `Bookmarks` | 服务器端文件夹名称 |
| 要同步的书签文件夹 | `localRoot` | string | `'1'` | 本地要同步的根文件夹 ID（1=书签栏，2=其他书签） |
| 包含凭证 | `includeCredentials` | boolean | `false` | fetch 请求是否包含凭证 |

### 9.2 同步配置

| 配置项 | 键名 | 类型 | 默认值 | 说明 |
|--------|------|------|--------|------|
| 同步策略 | `syncStrategy` | string | `merge` | merge/local/server |
| 启动时同步 | `syncOnStartupEnabled` | boolean | `true` | 浏览器启动时自动同步 |
| 定时同步 | `syncIntervalEnabled` | boolean | `true` | 启用定时同步 |
| 同步间隔（分钟） | `syncInterval` | number | `15` | 定时同步间隔 |
| 变更时同步 | `syncOnChangeEnabled` | boolean | `true` | 书签变更时自动同步 |

### 9.3 高级设置

| 配置项 | 键名 | 类型 | 默认值 | 说明 |
|--------|------|------|--------|------|
| 加密密钥 | `encryptionPassphrase` | string | `''` | 空表示不加密，8-16位 |
| 熔断阈值（%） | `failsafeThreshold` | number | `50` | 单次删除超过此比例自动中止 |
| 同步成功通知 | `notifyOnSuccess` | boolean | `true` | 同步成功时发送系统通知 |
| 同步失败通知 | `notifyOnFailure` | boolean | `true` | 同步失败时发送系统通知 |
| 深色模式 | `darkMode` | string | `auto` | auto/light/dark |

### 9.4 同步状态（syncState）

| 字段 | 类型 | 说明 |
|------|------|------|
| `lastSync` | number | 上次同步时间戳（null 表示从未同步） |
| `lastError` | string | 上次同步错误信息 |
| `syncing` | boolean | 是否正在同步 |
| `currentPhase` | string | 当前同步阶段（downloading/merging/applying/uploading/done） |
| `lastStats` | Object | 上次同步统计（added/removed/conflicts） |
| `paused` | boolean | 是否暂停同步 |
| `conflicts` | Array | 冲突详情列表 |

---

## 10. 消息通信

popup 和 options 页面通过 `chrome.runtime.sendMessage` 与 background 通信。

### 10.1 消息类型列表

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `sync` | popup/options → background | 触发手动同步 |
| `getState` | popup/options → background | 获取同步状态 |
| `getSettings` | popup/options → background | 获取配置 |
| `setSettings` | popup/options → background | 保存配置 |
| `getDeviceId` | popup/options → background | 获取设备 ID |
| `testConnection` | popup/options → background | 测试 WebDAV 连接 |
| `checkFolder` | popup/options → background | 检查文件夹是否存在 |
| `detectFirstSync` | popup/options → background | 检测首次同步状态 |
| `firstSync` | popup/options → background | 执行首次同步 |
| `getFolders` | popup/options → background | 获取本地书签文件夹列表 |
| `serializeBookmarks` | popup/options → background | 序列化本地书签为 HTML |
| `parseBookmarksHtml` | popup/options → background | 解析 HTML 为书签数组 |
| `importBookmarksHtml` | popup/options → background | 从 HTML 导入书签 |
| `importBookmarksItems` | popup/options → background | 从书签数组导入（支持目标文件夹） |
| `clearAllBookmarks` | popup/options → background | 一键清空本地书签（先备份） |
| `getBackups` | popup/options → background | 获取备份列表 |
| `restoreBackup` | popup/options → background | 恢复指定备份 |
| `getSyncLogs` | popup/options → background | 获取操作日志 |
| `notify` | popup/options → background | 发送系统通知（统一通知入口） |

### 10.2 通信模式

- **请求-响应模式**：发送消息后等待 `sendResponse` 返回结果
- **异步处理**：耗时操作（同步、导入、备份）在 background 中异步执行，完成后通过 `sendResponse` 返回
- **长时操作**：`firstSync` 等操作返回 `true` 保持消息通道开放，异步完成后调用 `sendResponse`

---

## 11. 安全机制

### 11.1 端到端加密

- 可选 AES-256-GCM 加密书签文件和变更日志
- 密钥通过 PBKDF2（100000 次迭代，SHA-256）从用户密码派生
- 密钥仅保存在本地，不上传任何服务器
- 加密文件格式：`WBE1:` + base64(salt + iv + ciphertext)
- 多设备必须使用相同密钥
- 密钥限制：8-16 位，需确认密码，有强度提示

### 11.2 熔断保护

- 单次同步删除超过阈值（默认 50%）自动中止
- 防止因服务器文件损坏或配置错误导致大量书签被误删
- 阈值可配置（10%-100%）

### 11.3 自动备份

- 同步前自动备份本地书签
- 覆盖式导入和一键清空时也自动备份
- 保留最近 5 份备份
- 可随时从备份恢复

### 11.4 完整性校验

- 下载的书签文件进行完整性校验
- 校验项：空内容、过短、格式错误、异常字符占比、解析结果合理性
- 损坏文件拒绝覆盖本地

### 11.5 内容哈希跳过上传

- 上传前计算内容 SHA-256 哈希
- 与上次上传的哈希对比，无变化则跳过上传
- 节省流量，降低服务器限流风险

### 11.6 密码存储

- 密码存储在 `chrome.storage.local`（仅当前设备）
- 不随 Chrome 账号同步
- Chrome 对存储数据有加密保护

### 11.7 权限最小化

| 权限 | 用途 |
|------|------|
| `bookmarks` | 书签的增删改查 |
| `alarms` | 定时同步（替代 setTimeout） |
| `storage` | 本地配置和数据存储 |
| `notifications` | 同步结果系统通知 |
| `<all_urls>` | 访问用户配置的任意 WebDAV 服务器 |

---

## 12. 移动端适配

### 12.1 支持的移动端浏览器

| 浏览器 | 平台 | 扩展支持 |
|--------|------|----------|
| Kiwi Browser | Android | 支持 Chrome MV3 扩展 |
| 其他支持扩展的移动端浏览器 | Android | 理论支持，未测试 |

### 12.2 适配措施

- **响应式布局**：popup 和 options 页面使用媒体查询适配小屏幕
- **触摸友好**：按钮和交互元素尺寸适合触摸操作
- **字体大小**：移动端适当增大字体
- **弹窗宽度**：popup 在移动端自适应屏幕宽度
- **设置页面**：options 页面在移动端可滚动，表单元素全宽

### 12.3 移动端安装方式

1. 在 Kiwi Browser 中打开 `kiwi://extensions`
2. 开启开发者模式
3. 点击 `+ (from .zip/.crx/.user.js...)`
4. 选择扩展的 .zip 或 .crx 文件
5. 安装完成后在浏览器菜单中找到扩展图标

---

## 13. 已知限制

### 13.1 技术限制

1. **MV3 Service Worker 回收**：Service Worker 空闲时会被浏览器回收，`setTimeout` 会丢失，需用 `chrome.alarms` 兜底
2. **DOMParser 不可用**：Service Worker 环境中没有 DOMParser，必须用正则解析 HTML
3. **无后台持续运行**：MV3 不支持持久后台脚本，所有任务需事件驱动或 alarms 触发
4. **123 云盘限制**：免费版有流量和请求频率限制，大文件可能上传失败
5. **WebDAV 兼容性**：只使用 GET/PUT/PROPFIND，不支持 MOVE/DELETE，某些高级 WebDAV 功能不可用

### 13.2 功能限制

1. **新增书签不记录变更日志**：新增走全量合并，极端情况下多设备同时新增同一 URL 可能重复（URL 规范化去重可处理大部分情况）
2. **冲突不弹框**：冲突按时间戳自动处理，不弹框让用户选择，用户可能不知道发生了冲突
3. **单账号配置**：只支持一个 WebDAV 账号，不支持多账号切换
4. **无增量上传**：书签文件全量上传，不支持增量（但有哈希跳过无变化上传）
5. **变更日志上限**：最多 1000 条，超过后旧变更会被清理（90天内的保留）

### 13.3 加密限制

1. **密钥无法恢复**：忘记加密密钥无法恢复加密数据
2. **多设备密钥必须一致**：密钥不同步，需用户手动在每台设备设置相同密钥
3. **无密钥轮换**：不支持修改加密密钥（修改后旧文件无法解密）
4. **性能影响**：加密/解密会增加同步时间（PBKDF2 100000 次迭代约需 100-300ms）

---

## 14. 开发指南

### 14.1 开发环境

- 无需构建工具，纯原生 JavaScript
- 支持 ES Modules（`import`/`export`）
- 推荐使用 VS Code 开发

### 14.2 本地调试

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目根目录
4. 修改代码后点击扩展卡片上的「刷新」按钮重新加载
5. 点击「Service Worker」链接打开后台脚本的 DevTools 查看日志

### 14.3 代码规范

- **函数命名**：camelCase，动词开头（`getXxx`/`setXxx`/`syncXxx`）
- **常量命名**：UPPER_SNAKE_CASE（`MAX_BACKUPS`/`ALARM_NAME`）
- **注释**：关键函数必须有 JSDoc 注释，说明参数、返回值、用途
- **错误处理**：异步操作必须有 try/catch，错误要记录日志
- **不使用第三方库**：零依赖，纯原生实现

### 14.4 关键文件修改注意事项

1. **background.js**：修改后必须刷新扩展，Service Worker 才会重新加载
2. **webdav.js**：WebDAV 通信逻辑，修改后需测试上传下载
3. **html.js**：序列化逻辑，修改后需测试书签导入导出
4. **manifest.json**：修改权限或入口后需重新加载扩展
5. **通用函数**：新增通用函数时注意不要破坏现有函数的闭合大括号

### 14.5 常见开发错误

1. **函数闭合大括号丢失**：插入新函数时不小心删掉了现有函数的闭合大括号，导致后续函数被嵌套，运行时异常但语法检查通过
2. **onMessage 非 async 回调中用 await**：会导致 "Unexpected reserved word" 语法错误，Service Worker 注册失败
3. **DOMParser 在 Service Worker 中不可用**：必须用正则解析
4. **setTimeout 在 Service Worker 中不可靠**：必须用 chrome.alarms 兜底
5. **chrome.storage.sync 不存密码**：密码只存 chrome.storage.local

### 14.6 打包发布

#### 方法一：打包成 .crx（带签名）

```bash
chrome.exe --pack-extension=D:\path\to\GeekMark --pack-extension-key=D:\path\to\GeekMark.pem
```

- 第一次打包会自动生成 .pem 密钥文件
- 后续打包用同一个密钥保持扩展 ID 不变
- 生成的 .crx 可直接拖入 Chrome 安装

#### 方法二：打包成 .zip（最简单）

- 直接压缩项目根目录为 .zip
- Kiwi 等移动端浏览器支持从 .zip 安装
- 桌面 Chrome 需解压后用"加载已解压的扩展程序"

### 14.7 文档维护

- 每次修改功能后，必须更新本文档（PROJECT.md）
- 更新位置：第 15 章「更新日志」新增一条记录
- 如果修改了配置项、文件格式、消息类型等，必须同步更新对应章节
- 用户使用文档（README.md）也需同步更新

---

## 15. 更新日志

### 2026-09-03 v1.0.4

**UI 优化**

- **设备ID复制按钮改成 SVG 图标**：从文字"复制"改成 SVG 复制图标（两个重叠的矩形），按钮宽度从约 60px 缩小到 32px，竖版时设备ID输入框有足够空间显示完整的 36 位 UUID。
- **复制反馈优化**：点击复制后，图标短暂变成绿色对勾（1.5秒），同时下方提示条显示"设备ID已复制"。
- **按钮加 title 提示**：`title="复制设备ID"`，鼠标悬停/长按显示提示。

---

### 2026-09-03 v1.0.3

**功能优化**

- **恢复备份改用弹窗交互**：从 `confirm`/`alert` 改为复用导入书签的模态框逻辑，点击恢复按钮后弹出模态框，显示备份信息（时间、书签数量），可选择恢复模式（合并式恢复/覆盖式恢复）和目标文件夹，确认后执行恢复。
- **恢复备份支持两种模式**：合并式恢复（保留现有书签，新增备份中的书签）、覆盖式恢复（先自动备份 → 清空目标文件夹 → 恢复备份中的书签）。
- **恢复备份复用导入逻辑**：`restoreFromBackup` 函数内部调用 `importBookmarksInternal` 通用导入函数，不再重复实现导入逻辑。

---

### 2026-09-03 v1.0.2

**Bug 修复**

- **修复暂停同步开关勾选状态不显示**：点击暂停开关后，设置保存成功但 checkbox 勾选状态没有立即更新，需要手动刷新 popup 才能显示打勾。根因是时序问题：`setSettings` 清除缓存后立即调用 `loadState()`，`getState` 读取到旧值。修复：① popup 端保存后先直接设置 `e.target.checked = paused` 确保显示正确，再加 200ms 延迟调用 `loadState()`；② background 端 `setSettings` 改为直接更新缓存（`settingsCache = {...settingsCache, ...settings}`）而不是清除缓存，确保后续读取是最新值。

---

### 2026-09-03 v1.0.1

**Bug 修复与布局优化**

- **修复备份恢复按钮点击无反应**：MV3 扩展的 CSP 禁止内联 `onclick` 脚本，导致备份管理的"恢复"按钮点击后无任何反应。改用 `data-index` 属性 + `addEventListener` 事件委托绑定事件，恢复功能正常工作。
- **测试连接按钮位置调整**：从操作按钮区域移到服务器设置卡片内部，与"检查文件夹"按钮并排（WebDAV 文件夹名称输入框右侧）。
- **提示条位置调整**：从操作按钮区域下方移到服务器设置卡片最底部（发送 cookies 复选框下方），测试连接和检查文件夹的结果都显示在此处。
- **操作按钮区域简化**：去掉测试连接按钮，只保留"保存配置并开始同步"按钮。

---

### 2026-09-03 v1.0.0

**初始版本**

- 基于 Floccus (MIT) 精简重构，只保留 WebDAV 后端
- 三种同步策略：多设备智能同步 / 本地覆盖云端 / 云端覆盖本地
- 多设备智能同步：基于变更日志（changes.json），7 种变更类型，按时间戳冲突处理
- 多种触发方式：启动/定时/变更/手动
- 端到端加密：AES-256-GCM + PBKDF2，用户自设密钥（8-16位）
- 书签管理：选择性导入导出、覆盖/合并模式、目标文件夹选择、一键清空
- 自动备份：保留最近 5 份，可恢复
- 操作日志：保留最近 50 条
- 冲突检测与详情展示
- 首次同步智能引导
- WebDAV 文件夹自动创建+自定义+检查
- 测试连接（只读探测）
- 暂停同步、新标签页打开、深色模式
- 设备 ID（UUID v4）
- 移动端适配（Kiwi Browser）
- 123 云盘/坚果云专项适配
- 系统通知（成功/失败独立开关）
- 熔断保护、完整性校验、内容哈希跳过上传
- 自动重试（3次指数退避）
- 代码精简：通用函数抽取（导入/清空/备份/统计/通知/URL构建/深色模式）

---

## 附录 A：快速参考

### A.1 关键常量

| 常量 | 值 | 位置 |
|------|-----|------|
| `INACTIVITY_TIMEOUT` | 3000ms | background.js |
| `ALARM_NAME` | `bookmark-sync` | background.js |
| `MAX_CHANGE_LOG_ENTRIES` | 1000 | background.js |
| `CHANGE_LOG_RETENTION_MS` | 90天 | background.js |
| `CONCURRENT_CHANGES` | 5 | background.js |
| `MAX_BACKUPS` | 5 | background.js |
| `MAX_LOGS` | 50 | background.js |
| `CHANGE_LOG_FILE` | `changes.json` | webdav.js |
| `ENCRYPTION_MAGIC` | `WBE1:` | webdav.js |
| `PBKDF2_ITERATIONS` | 100000 | webdav.js |

### A.2 服务器端文件

| 文件 | 格式 | 可加密 | 说明 |
|------|------|--------|------|
| `Bookmarks/bookmarks.html` | Netscape HTML | 是 | 书签文件 |
| `Bookmarks/changes.json` | JSON | 是 | 变更日志 |

### A.3 本地存储键

| 键 | 说明 |
|----|------|
| `settings` | 用户配置 |
| `syncState` | 同步状态 |
| `pendingChanges` | 待同步变更 |
| `deviceId` | 设备 UUID |
| `backups` | 备份列表 |
| `syncLogs` | 操作日志 |

---

**文档结束**

> 本文档随项目功能更新而更新。每次修改后请在「更新日志」章节新增记录。
