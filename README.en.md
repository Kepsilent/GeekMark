<div align="center">

<img src="icons/icon128.png" alt="GeekMark" width="80" height="80">

# GeekMark (极客云签)

**Chrome extension for intelligent multi-device bookmark sync via WebDAV**

[中文](README.md) | English

[![version](https://img.shields.io/badge/version-1.0.4-green)](https://github.com/Kepsilent/GeekMark/releases)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Chrome%20MV3-orange)]()
[![webdav](https://img.shields.io/badge/WebDAV-123Pan%20%7C%20Jianguoyun-brightgreen)]()

Specially adapted for Chinese WebDAV services like 123 Pan and Jianguoyun. Refactored and streamlined from [Floccus](https://github.com/floccusaddon/floccus) (MIT).

[Features](#-features) · [Installation](#-installation) · [Configuration](#-configuration) · [FAQ](#-faq) · [Privacy](#-privacy)

</div>

---

## ✨ Features

### 🔄 Core Sync

- **Multi-device intelligent sync** (default): Change-log based smart sync, tracks bookmark add/delete/move/rename, merges by timestamp, supports simultaneous use across devices
- **Three sync strategies**: Multi-device intelligent sync / Local overwrites cloud / Cloud overwrites local
- **Multiple triggers**: Browser startup, scheduled sync (default 15 min), auto-sync on bookmark change (3s debounce, batch delete extends to 10s), manual sync
- **Change log**: `changes.json` records 7 change types (bookmark delete/move/rename + folder create/delete/rename/move), keeps up to 1000 entries or 90 days
- **Conflict detection**: Automatically identifies bidirectional changes to same URL or folder, later timestamp wins, view conflict details in popup
- **Smart first-sync guide**: Auto-detects local and cloud data state, auto-selects direction when only one side has data, prompts for choice when both have data

### 🔒 Data Security

- **Auto backup before sync**: Keeps last 5 local bookmark backups, one-click restore (modal with mode + target folder selection)
- **Operation log**: Records last 50 operations (sync/import/export/clear), view details
- **Integrity check**: Validates downloaded file integrity, refuses to overwrite local with corrupted files
- **Circuit breaker**: Auto-aborts when single sync deletes more than threshold (default 50%), prevents data loss
- **Content hash skip**: Skips upload when content unchanged, saves bandwidth and reduces rate limiting
- **End-to-end encryption**: Optional AES-256-GCM encryption for bookmark files (PBKDF2 key derivation), cloud only stores ciphertext, key stays local only, 8-16 chars
- **Auto retry on failure**: Exponential backoff retry up to 3 times (2s/5s/10s) on network errors / 5xx / rate limiting
- **Sync lock + queue**: Changes triggered during sync are queued, avoids concurrent conflicts

### 📚 Bookmark Management

- **Selective export**: Modal shows local bookmark tree, check bookmarks/folders to export, generates HTML file
- **Selective import**: Three-step modal (select source → check bookmarks → select mode and target), supports local file and direct URL import
- **Import modes**: Merge import (keep existing) / Overwrite import (backup first → clear → import)
- **Import target**: Choose to import to bookmarks bar / other bookmarks / any existing folder, or create new folder
- **One-click clear**: Auto backup then clear all local bookmarks, restorable from backup
- **URL import**: Supports pasting bookmark HTML direct link for download and import

### 🎨 User Experience

- **Desktop notifications**: Independent toggles for sync success/failure notifications
- **Config export/import**: One-click export config JSON, easy backup and migration
- **WebDAV folder isolation**: Bookmark files stored in `Bookmarks` folder (customizable name), auto-created, duplicate name check
- **Test connection**: Read-only probe, no file creation, verifies server reachability and auth, result shown in status bar below
- **Mobile adaptation**: [Quetta](https://quettabrowser.com/) browser recommended first (supports Chrome extensions, excellent experience), also compatible with Kiwi and other mobile browsers, responsive popup and settings layout
- **Dark mode**: Follow system or manual toggle (auto/light/dark)
- **Open in new tab**: Popup can be opened full-width in a new tab
- **Pause sync**: One-click pause auto-sync, manual sync still works
- **Device ID**: Unique UUID per device, used for device identification in change logs, one-click copy

### 🌐 Compatibility

- **123 Pan special adaptation**: Uses only GET + PUT, compatible with servers that don't support MOVE
- **Jianguoyun adaptation**: One-click fill server address
- **Chinese username support**: Basic Auth uses UTF-8 encoding, compatible with Chinese accounts
- **Pure frontend architecture**: No self-hosted backend, data only stored locally and on user's own WebDAV server

---

## 🚀 Installation

### 💻 Desktop (Chrome / Edge)

1. Go to [GitHub Releases](https://github.com/Kepsilent/GeekMark/releases) and download the latest `GeekMark-vx.x.x.zip`
2. Extract to any folder
3. Open Chrome / Edge, enter `chrome://extensions/` in address bar
4. Enable「Developer mode」in top right
5. Click「Load unpacked」, select the extracted folder
6. Extension loaded successfully, click toolbar icon to configure

### 📱 Mobile (Android)

**Recommended browser: [Quetta](https://quettabrowser.com/)** (supports Chrome extensions, excellent experience)

Also supports Kiwi Browser and other Android browsers that support Chrome MV3 extensions.

**Method 1: CRX file (recommended)**

1. Go to [GitHub Releases](https://github.com/Kepsilent/GeekMark/releases) and download the latest `GeekMark-vx.x.x.crx`
2. Open [Quetta](https://quettabrowser.com/) browser, enter `chrome://extensions/`
3. Enable「Developer mode」
4. Click「Load packed extension」(or「+ Install from .crx/.zip」), select the downloaded .crx file
5. Extension loaded successfully

**Method 2: ZIP archive**

1. Go to [GitHub Releases](https://github.com/Kepsilent/GeekMark/releases) and download the latest `GeekMark-vx.x.x.zip`
2. Extract to a phone folder
3. Open [Quetta](https://quettabrowser.com/) browser, enter `chrome://extensions/`
4. Enable「Developer mode」
5. Click「Load unpacked」, select the extracted folder
6. Extension loaded successfully

> Both methods work. CRX is more convenient (single file), ZIP is more universal.

---

## ⚙️ Configuration

### 123 Pan

1. Log in to [123 Pan web](https://www.123pan.com/)
2. Go to「Settings」→「WebDAV」, enable WebDAV service
3. Note down server address, username, password (authorization code)
4. Open extension settings, click「Fill 123 Pan」button to auto-fill URL
5. Fill in username and password
6. WebDAV folder name defaults to `Bookmarks`, customizable (bookmark files and change logs stored in this folder)
7. Click「Save config and start sync」, first sync auto-detects data state and guides

> 123 Pan WebDAV address format: `https://webdav.123pan.cn/webdav`

### Jianguoyun

1. Log in to [Jianguoyun web](https://www.jianguoyun.com/)
2. Click avatar top right →「Account Info」→「Security Options」
3. Add app in「Third-party App Management」, get password (authorization code)
4. Open extension settings, click「Fill Jianguoyun」button to auto-fill URL
5. Username is Jianguoyun login email, password is the generated authorization code
6. WebDAV folder name defaults to `Bookmarks`, customizable
7. Click「Save config and start sync」

> Jianguoyun WebDAV address format: `https://dav.jianguoyun.com/dav/`

---

## 🔄 Sync Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| **Multi-device intelligent sync** (default) | Download cloud changes → Full merge new bookmarks → Apply cloud changes (by timestamp) → Merge change logs → Upload | Daily multi-device sync, recommended |
| **Local overwrites cloud** | Directly upload local bookmarks to cloud, no download or merge | Local is latest, want to force overwrite cloud |
| **Cloud overwrites local** | Download cloud bookmarks → Clear local → Import cloud bookmarks, no upload | Cloud is latest, want to force overwrite local |

### How Multi-device Intelligent Sync Works

1. **Change tracking**: When local bookmarks are deleted, moved, renamed, or folder operations occur, recorded to local change log (`pendingChanges`)
2. **Sync flow**:
   - Download cloud `changes.json` and `bookmarks.html`
   - Full merge: bookmarks in local but not cloud are uploaded, bookmarks in cloud but not local are downloaded (new bookmarks don't record change log)
   - Conflict detection: bidirectional changes to same URL or folder, later timestamp wins
   - Apply cloud changes: apply cloud delete/move/rename in timestamp order
   - Merge change logs: local and cloud changes deduplicated by UUID, merge-sorted, expired entries cleaned
   - Upload: upload `bookmarks.html` and merged `changes.json`
3. **Cleanup policy**: Change log keeps up to 1000 entries or 90 days, local synced records older than 7 days auto-cleaned
4. **Performance optimization**: Merge-sort O(n) replaces full sort O(n log n), pre-filter expired data

### About End-to-end Encryption

- After setting 8-16 char key, bookmark files and change logs are encrypted with AES-256-GCM before upload
- Key derived via PBKDF2 (100000 iterations, SHA-256)
- Encrypted file format: `WBE1:` + base64(salt16bytes + iv12bytes + ciphertext)
- **All devices must use the exact same key**, otherwise cannot decrypt files synced by other devices
- Key only stored locally, never uploaded to any server
- Forgotten key cannot recover encrypted data, please keep it safe

---

## 📁 Project Structure

```
GeekMark/
├── manifest.json              # MV3 extension config
├── background.js              # Background Service Worker, core sync logic
├── privacy.md                 # Privacy policy
├── README.md                  # Chinese docs
├── README.en.md               # English docs
├── adapters/
│   └── webdav.js              # WebDAV adapter (GET download / PUT upload / encryption)
├── serializers/
│   └── html.js                # Bookmark tree ↔ Netscape HTML serialization (regex, MV3 compatible)
├── common/
│   └── darkmode.js            # Shared dark mode logic (popup and options)
├── popup/                     # Toolbar popup (status + manual sync + advanced sync + conflict details)
│   ├── popup.html
│   └── popup.js
├── options/                   # Settings page (server config + sync strategy + bookmark management + backup + logs)
│   ├── options.html
│   └── options.js
└── icons/                     # Extension icons + notification icons + SVG source files
```

---

## 🛠 Tech Stack

- **Chrome Extension Manifest V3 (MV3)**
- **Service Worker** as background script
- **Native HTML/CSS/JavaScript** (zero dependencies, no framework)
- **Web Crypto API** (AES-256-GCM encryption / PBKDF2 key derivation / SHA-256 hash)
- **Fetch API** (WebDAV communication)
- **chrome.bookmarks / chrome.alarms / chrome.storage / chrome.notifications API**

### Technologies Not Used

- **No DOMParser**: Not available in MV3 Service Worker environment, uses regex + folder stack to parse HTML instead
- **No third-party libraries**: Zero dependencies, pure native implementation
- **No IndexedDB**: All data stored with chrome.storage.local

---

## ❓ FAQ

### Q: Bookmarks duplicated after multi-device sync?

A: Multi-device intelligent sync uses URL normalization for deduplication (lowercase domain, remove default port, trailing slash, parameter sorting). New bookmarks go through full merge, normally no duplication. If you find duplicates, check if tracking parameters (like `utm_source`) in URLs differ. You can clean bookmarks first then sync.

### Q: Bookmarks came back after quickly deleting many?

A: Fixed. When deleting a folder, all bookmarks inside are recursively recorded as deleted. Batch delete (≥10 in 5s) auto-extends debounce to 10s. Sync lock + queue ensures changes are fully uploaded before sync starts.

### Q: Will modifying bookmarks during sync cause loss?

A: No. Uses operation ID whitelist mechanism, only ignores change events generated by sync operations themselves. User modifications during sync are normally recorded and synced.

### Q: Forgot encryption key?

A: Cannot recover. End-to-end encryption key only stored locally, no backdoor. If you forget the key, you can only clear cloud encrypted files and re-sync (unencrypted local bookmarks are unaffected). All devices must use the same key.

### Q: Bookmarks in subfolders didn't sync?

A: Please make sure extension is latest version. Multi-device intelligent sync supports folder-level changes (create/delete/rename/move), nested folders sync completely.

### Q: 123 Pan test connection succeeds but sync fails?

A: 123 Pan free version has traffic and request rate limits. If bookmark file is large, upload may fail. Try reducing bookmark count or retry later. Extension has auto-retry mechanism (up to 3 times, exponential backoff).

### Q: Where is password stored? Is it safe?

A: Password stored in `chrome.storage.local`, only on current device. Chrome encrypts stored data. If concerned, only use on trusted devices.

### Q: Supports Firefox / Edge?

A: This extension uses Chrome Extension MV3 API. Edge browser can load and use directly. Firefox needs adaptation to its MV3 implementation, not tested yet. Mobile recommended Quetta browser, also supports Kiwi Browser etc.

### Q: Does this extension collect my data?

A: No. All data (bookmarks, config, keys) only stored on local device and your own WebDAV server. Extension doesn't connect to any third-party server, doesn't send any telemetry. See [privacy policy](privacy.md).

---

## 🔒 Privacy

This extension takes user privacy very seriously. See [privacy.md](privacy.md) for detailed privacy policy.

**Core principles**:
- Collects no user data
- Connects to no third-party servers
- Sends no telemetry
- All data only stored on local device and user's own WebDAV server
- End-to-end encryption optional, key only stored locally

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this repo
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 🙏 Acknowledgments

- Sync trigger logic and WebDAV/HTML adapters adapted from [Floccus](https://github.com/floccusaddon/floccus) (MIT License)
- Thanks to all contributors of the Floccus project

---

## 📄 License

MIT License

Copyright (c) 2026 Kepsilent

---

<div align="center">

If this project helps you, welcome to give a ⭐ Star to support!

</div>
