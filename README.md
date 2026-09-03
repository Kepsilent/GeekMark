<div align="center">

<img src="icons/icon128.png" alt="极客云签" width="80" height="80">

# 极客云签 (GeekMark)

**通过 WebDAV 多设备智能同步浏览器书签的 Chrome 扩展**

[English](README.en.md) | 中文

[![version](https://img.shields.io/badge/version-1.0.4-green)](https://github.com/Kepsilent/GeekMark/releases)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Chrome%20MV3-orange)]()
[![webdav](https://img.shields.io/badge/WebDAV-123%E4%BA%91%E7%9B%98%20%7C%20%E5%9D%9A%E6%9E%9C%E4%BA%91-brightgreen)]()

专门适配 123 云盘、坚果云等国内 WebDAV 服务，基于 [Floccus](https://github.com/floccusaddon/floccus) (MIT) 精简重构。

[功能特性](#-功能特性) · [安装方法](#-安装方法) · [配置教程](#-配置教程) · [常见问题](#-常见问题) · [隐私政策](#-隐私政策)

</div>

---

## ✨ 功能特性

### 🔄 核心同步

- **多设备智能同步**（默认）：基于变更日志的智能同步，记录书签的增删改移，按时间戳合并，支持多设备同时使用
- **三种同步策略**：多设备智能同步 / 本地覆盖云端 / 云端覆盖本地
- **多种触发方式**：浏览器启动、定时同步（默认15分钟）、书签变更自动同步（防抖3秒，批量删除自动延长到10秒）、手动同步
- **变更日志**：`changes.json` 记录7种变更（书签删除/移动/重命名 + 文件夹创建/删除/重命名/移动），最多保留1000条或90天
- **冲突检测**：自动识别同一 URL 或同一文件夹的双向变更，按时间戳晚的覆盖早的，可在弹窗中查看冲突详情
- **首次同步智能引导**：自动检测本地和云端数据状态，单边有数据时自动选择方向，两边都有时弹出选择

### 🔒 数据安全

- **同步前自动备份**：保留最近 5 份本地书签备份，可一键恢复（弹窗选择模式+目标文件夹）
- **操作日志**：记录最近 50 次操作（同步/导入/导出/清空），可查看详情
- **完整性校验**：下载文件完整性校验，损坏文件拒绝覆盖本地
- **熔断保护**：单次删除超过阈值（默认50%）自动中止，防止数据丢失
- **内容哈希跳过**：内容无变化时跳过上传，省流量降限流
- **端到端加密**：可选 AES-256-GCM 加密书签文件（PBKDF2 派生密钥），云端只存密文，密钥仅保存在本地，8-16位
- **失败自动重试**：网络错误/5xx/限流时指数退避重试最多 3 次（2s/5s/10s）
- **同步锁+排队**：同步中触发的变更排队等待，避免并发冲突

### 📚 书签管理

- **选择性导出**：弹窗展示本地书签树，勾选要导出的书签/文件夹，生成 HTML 文件
- **选择性导入**：三步弹窗（选择来源→勾选书签→选择模式和目标位置），支持本地文件和网络直链导入
- **导入模式**：合并式导入（保留现有）/ 覆盖式导入（先备份→清空→导入）
- **导入目标位置**：可选择导入到书签栏/其他书签/任意已有文件夹，或新建文件夹
- **一键清空**：自动备份后清空本地所有书签，可从备份恢复
- **链接导入**：支持粘贴书签 HTML 直链下载导入

### 🎨 用户体验

- **桌面通知**：同步成功/失败可独立开关通知
- **配置导出/导入**：一键导出配置 JSON，方便备份和迁移
- **WebDAV 文件夹隔离**：书签文件存放在 `Bookmarks` 文件夹中（可自定义名称），自动创建，检查重名
- **测试连接**：只读探测，不创建文件，验证服务器可达性和认证，结果在页面下方提示条显示
- **移动端适配**：首推 [Quetta](https://quettabrowser.com/) 浏览器（支持 Chrome 扩展，体验优秀），也兼容 Kiwi 等其他移动端浏览器，弹窗和设置页面响应式布局
- **深色模式**：跟随系统或手动切换（自动/浅色/深色）
- **新标签页打开**：popup 可在新标签页中全宽打开
- **暂停同步**：一键暂停自动同步，手动同步仍可触发
- **设备ID**：每设备唯一 UUID，用于变更日志的设备标识，可一键复制

### 🌐 兼容性

- **123 云盘专项适配**：仅使用 GET + PUT，兼容不支持 MOVE 的服务器
- **坚果云适配**：一键填充服务器地址
- **中文用户名支持**：Basic Auth 使用 UTF-8 编码，兼容中文账号
- **纯前端架构**：无自建后端，数据仅存储在本地和用户自己的 WebDAV 服务器

---

## 🚀 安装方法

### 💻 电脑版（Chrome / Edge）

1. 前往 [GitHub Releases](https://github.com/Kepsilent/GeekMark/releases) 下载最新版本的 `GeekMark-vx.x.x.zip` 压缩包
2. 解压到任意文件夹
3. 打开 Chrome / Edge，地址栏输入 `chrome://extensions/`
4. 右上角开启「开发者模式」
5. 点击「加载已解压的扩展程序」，选择解压后的文件夹
6. 扩展加载成功，点击工具栏图标开始配置

### 📱 手机版（Android）

**首推浏览器：[Quetta](https://quettabrowser.com/)**（支持 Chrome 扩展，体验优秀）

也支持 Kiwi Browser 等其他支持 Chrome MV3 扩展的安卓浏览器。

**安装方式一：CRX 文件（推荐）**

1. 前往 [GitHub Releases](https://github.com/Kepsilent/GeekMark/releases) 下载最新版本的 `GeekMark-vx.x.x.crx` 文件
2. 打开 [Quetta](https://quettabrowser.com/) 浏览器，地址栏输入 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已打包的扩展程序」（或「+ 从 .crx/.zip 安装」），选择下载的 .crx 文件
5. 扩展加载成功

**安装方式二：ZIP 压缩包**

1. 前往 [GitHub Releases](https://github.com/Kepsilent/GeekMark/releases) 下载最新版本的 `GeekMark-vx.x.x.zip` 压缩包
2. 解压到手机文件夹
3. 打开 [Quetta](https://quettabrowser.com/) 浏览器，地址栏输入 `chrome://extensions/`
4. 开启「开发者模式」
5. 点击「加载已解压的扩展程序」，选择解压后的文件夹
6. 扩展加载成功

> 两种方式都可以，CRX 文件更方便（单个文件），ZIP 压缩包更通用。

---

## ⚙️ 配置教程

### 123 云盘

1. 登录 [123 云盘网页版](https://www.123pan.com/)
2. 进入「设置」→「WebDAV」，开启 WebDAV 服务
3. 记下服务器地址、用户名、密码（授权码）
4. 打开本扩展的设置页面，点击「填充 123 云盘」按钮自动填入 URL
5. 填写用户名和密码
6. WebDAV 文件夹名称默认 `Bookmarks`，可自定义（书签文件和变更日志会存放在此文件夹内）
7. 点击「保存配置并开始同步」，首次同步会自动检测数据状态并引导

> 123 云盘 WebDAV 地址格式：`https://webdav.123pan.cn/webdav`

### 坚果云

1. 登录 [坚果云网页版](https://www.jianguoyun.com/)
2. 点击右上角头像 →「账户信息」→「安全选项」
3. 在「第三方应用管理」中添加应用，获取密码（授权码）
4. 打开本扩展的设置页面，点击「填充坚果云」按钮自动填入 URL
5. 用户名填坚果云登录邮箱，密码填刚才生成的授权码
6. WebDAV 文件夹名称默认 `Bookmarks`，可自定义
7. 点击「保存配置并开始同步」

> 坚果云 WebDAV 地址格式：`https://dav.jianguoyun.com/dav/`

---

## 🔄 同步策略说明

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| **多设备智能同步**（默认） | 下载云端变更 → 全量合并新增书签 → 应用云端变更（按时间戳）→ 合并变更日志 → 上传 | 多设备日常同步，推荐使用 |
| **本地覆盖云端** | 直接上传本地书签到云端，不下载不合并 | 本地是最新的，想强制覆盖云端 |
| **云端覆盖本地** | 下载云端书签 → 清空本地 → 导入云端书签，不上传 | 云端是最新的，想强制覆盖本地 |

### 多设备智能同步原理

1. **变更记录**：本地书签发生删除、移动、重命名、文件夹操作时，记录到本地变更日志（`pendingChanges`）
2. **同步流程**：
   - 下载云端 `changes.json` 和 `bookmarks.html`
   - 全量合并：本地有云端没有的书签上传，云端有本地没有的下载（新增不记录变更日志）
   - 冲突检测：同一 URL 或文件夹的双向变更，按时间戳晚的覆盖早的
   - 应用云端变更：按时间戳顺序应用云端的删除/移动/重命名
   - 合并变更日志：本地和云端变更按 UUID 去重，归并排序，清理过期
   - 上传：上传 `bookmarks.html` 和合并后的 `changes.json`
3. **清理策略**：变更日志最多保留1000条或90天，本地已同步超过7天的记录自动清理
4. **性能优化**：归并合并 O(n) 替代全量排序 O(n log n)，提前过滤过期数据

### 关于端到端加密

- 设置8-16位密钥后，书签文件和变更日志上传前会用 AES-256-GCM 加密
- 密钥通过 PBKDF2（100000次迭代，SHA-256）派生
- 加密文件格式：`WBE1:` + base64(salt16字节 + iv12字节 + ciphertext)
- **多设备必须使用完全相同的密钥**，否则无法解密对方同步的文件
- 密钥仅保存在本地，不会上传到任何服务器
- 忘记密钥无法恢复加密数据，请妥善保管

---

## 📁 项目结构

```
GeekMark/
├── manifest.json              # MV3 扩展配置
├── background.js              # 后台 Service Worker，核心同步逻辑
├── privacy.md                 # 隐私政策
├── README.md                  # 本文档
├── adapters/
│   └── webdav.js              # WebDAV 适配器（GET 下载 / PUT 上传 / 加解密）
├── serializers/
│   └── html.js                # 书签树 ↔ Netscape HTML 格式序列化（正则解析，兼容MV3）
├── common/
│   └── darkmode.js            # 深色模式共享逻辑（popup 和 options 共用）
├── popup/                     # 工具栏弹窗（状态展示 + 手动同步 + 高级同步 + 冲突详情）
│   ├── popup.html
│   └── popup.js
├── options/                   # 设置页面（服务器配置 + 同步策略 + 书签管理 + 备份 + 日志）
│   ├── options.html
│   └── options.js
└── icons/                     # 扩展图标 + 通知图标 + SVG 源文件
```

---

## 🛠 技术栈

- **Chrome Extension Manifest V3 (MV3)**
- **Service Worker** 作为后台脚本
- **原生 HTML/CSS/JavaScript**（零依赖，无框架）
- **Web Crypto API**（AES-256-GCM 加密 / PBKDF2 密钥派生 / SHA-256 哈希）
- **Fetch API**（WebDAV 通信）
- **chrome.bookmarks / chrome.alarms / chrome.storage / chrome.notifications API**

### 不使用的技术

- **不使用 DOMParser**：MV3 Service Worker 环境中不可用，改用正则 + 文件夹栈解析 HTML
- **不使用第三方库**：零依赖，纯原生实现
- **不使用 IndexedDB**：所有数据用 chrome.storage.local 存储

---

## ❓ 常见问题

### Q: 多设备同步后书签重复了怎么办？

A: 多设备智能同步使用 URL 规范化去重（域名小写、去掉默认端口、末尾斜杠、参数排序），新增书签走全量合并，正常情况下不会重复。如果发现重复，请检查是否是 URL 中的追踪参数（如 `utm_source`）不同导致的，可以先清理书签再同步。

### Q: 快速删除大量书签后，书签又回来了？

A: 已修复。删除文件夹时会递归记录里面所有书签的删除，批量删除（5秒内≥10个）自动延长防抖到10秒，同步锁+排队机制确保变更完整上传后才开始同步。

### Q: 同步中修改书签会丢失吗？

A: 不会。使用操作ID白名单机制，只忽略同步操作本身产生的变更事件，用户在同步过程中的修改会被正常记录和同步。

### Q: 加密密钥忘记了怎么办？

A: 无法恢复。端到端加密的密钥仅保存在本地，没有后门。如果忘记密钥，只能清空云端加密文件后重新同步（未加密的本地书签不受影响）。多设备请务必使用相同密钥。

### Q: 子文件夹里的书签没有同步过来？

A: 请确认扩展版本是最新的。多设备智能同步支持文件夹级别的变更（创建/删除/重命名/移动），嵌套文件夹会完整同步。

### Q: 123 云盘测试连接成功但同步失败？

A: 123 云盘免费版有流量和请求频率限制，如果书签文件较大可能上传失败。可以尝试减少书签数量，或稍后重试。扩展有自动重试机制（最多3次，指数退避）。

### Q: 密码存在哪里？安全吗？

A: 密码存储在 `chrome.storage.local` 中，仅保存在当前设备。Chrome 对存储数据有加密保护。如果担心安全，可以只在受信任的设备上使用。

### Q: 支持 Firefox / Edge 吗？

A: 本扩展使用 Chrome Extension MV3 API，Edge 浏览器可以直接加载使用。Firefox 需要适配其 MV3 实现，暂未测试。移动端首推 [Quetta](https://quettabrowser.com/) 浏览器，也支持 Kiwi Browser 等。

### Q: 这个扩展收集我的数据吗？

A: 不收集。所有数据（书签、配置、密钥）仅保存在本地设备和你自己的 WebDAV 服务器上，扩展不连接任何第三方服务器，不发送任何遥测数据。详见[隐私政策](privacy.md)。

---

## 🔒 隐私政策

本扩展非常重视用户隐私。详细隐私政策请查看 [privacy.md](privacy.md)。

**核心原则**：
- 不收集任何用户数据
- 不连接任何第三方服务器
- 不发送任何遥测信息
- 所有数据仅存储在本地设备和用户自己的 WebDAV 服务器上
- 端到端加密可选，密钥仅保存在本地

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

---

## 🙏 致谢

- 同步触发逻辑和 WebDAV/HTML 适配器改编自 [Floccus](https://github.com/floccusaddon/floccus) (MIT License)
- 感谢 Floccus 项目的所有贡献者

---

## 📄 许可证

MIT License

Copyright (c) 2026 Kepsilent

---

<div align="center">

如果这个项目对你有帮助，欢迎给个 ⭐ Star 支持一下！

</div>
