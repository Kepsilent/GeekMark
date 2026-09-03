/**
 * WebDAV 适配器
 * 只使用 GET + PUT，不使用 MOVE，兼容 123 云盘等不支持 MOVE 的服务器
 *
 * 改编自 Floccus 的 WebDav.ts (MIT License)
 * 删除了 MOVE、DELETE、锁文件、缓存树等逻辑
 *
 * 注意：在 MV3 Service Worker 中，只要声明了 host_permissions，
 * fetch 请求就不受 CORS 限制，可直接访问 WebDAV 服务器。
 */

const CHANGE_LOG_FILE = 'changes.json'

export default class WebDavAdapter {
  constructor(server) {
    this.server = server
  }

  /**
   * 检测是否为 123 云盘
   */
  is123Pan() {
    try {
      const url = new URL(this.server.url)
      return url.hostname.includes('123pan') || url.hostname.includes('123pan.cn')
    } catch (e) {
      return false
    }
  }

  /**
   * 解析基础 URL（getFolderURL/getBookmarkURL/getChangeLogURL 共用）
   * @returns {{parsed: URL, pathParts: string[], lastPart: string, hasFileName: boolean, folderName: string}}
   */
  _parseBaseURL() {
    const input = this.server.url.trim()
    try {
      const parsed = new URL(input)
      parsed.search = ''
      parsed.hash = ''
      const pathParts = parsed.pathname.split('/').filter(p => p)
      const lastPart = pathParts[pathParts.length - 1]
      const hasFileName = !!(lastPart && lastPart.includes('.'))
      const folderName = encodeURIComponent(this.server.webdav_folder || 'Bookmarks')
      return { parsed, pathParts, lastPart, hasFileName, folderName }
    } catch (e) {
      throw new Error('无效的 URL: ' + input)
    }
  }

  /**
   * 获取 WebDAV 文件夹 URL（书签文件所在的目录）
   * 自动在用户配置的目录下创建以插件名命名的子文件夹
   */
  getFolderURL() {
    const { parsed, pathParts, hasFileName, folderName } = this._parseBaseURL()

    // 如果 URL 已包含文件名，去掉文件名部分
    if (hasFileName) {
      pathParts.pop()
      parsed.pathname = '/' + pathParts.join('/')
    }

    // 确保末尾有 /
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/'
    }

    return parsed.toString() + folderName + '/'
  }

  /**
   * 获取完整的书签文件 URL
   * 自动检测用户输入的 URL 是否已包含文件名，避免重复拼接
   * 新配置会在目录下创建 插件名/bookmarks.html
   */
  getBookmarkURL() {
    const { parsed, hasFileName, folderName } = this._parseBaseURL()

    // 如果最后一段包含 "."，认为是文件名（如 bookmarks.html），直接返回（兼容旧配置）
    if (hasFileName) {
      return parsed.toString()
    }

    // 否则是目录路径，拼接 文件夹名/文件名
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/'
    }
    return parsed.toString() + folderName + '/' + this.server.bookmark_file
  }

  /**
   * 获取变更日志文件的完整 URL（changes.json）
   */
  getChangeLogURL() {
    const { parsed, hasFileName, folderName } = this._parseBaseURL()

    // 如果最后一段包含 "."，认为是文件名，替换为 changes.json
    if (hasFileName) {
      parsed.pathname = parsed.pathname.substring(0, parsed.pathname.lastIndexOf('/') + 1) + CHANGE_LOG_FILE
      return parsed.toString()
    }
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/'
    }
    return parsed.toString() + folderName + '/' + CHANGE_LOG_FILE
  }

  /**
   * 检查文件夹是否存在（只检查，不创建）
   * @returns {Promise<{exists: boolean, error?: string}>}
   */
  async checkFolderExists() {
    const folderUrl = this.getFolderURL()
    const authHeader = this.getAuthHeader()
    const credentials = this.server.includeCredentials ? 'include' : 'omit'

    const fetchWithTimeout = async (opts) => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      try {
        return await fetch(folderUrl, { ...opts, signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }
    }

    try {
      const res = await fetchWithTimeout({
        method: 'PROPFIND',
        headers: {
          'Authorization': authHeader,
          'Depth': '0',
        },
        credentials,
      })

      if (res.status === 200 || res.status === 207) {
        return { exists: true }
      }
      if (res.status === 404) {
        return { exists: false }
      }
      if (res.status === 401 || res.status === 403) {
        return { exists: false, error: '认证失败，请检查用户名和密码' }
      }
      return { exists: false, error: `检查失败，HTTP ${res.status}` }
    } catch (e) {
      if (e.name === 'AbortError') {
        return { exists: false, error: '检查超时（15秒）' }
      }
      return { exists: false, error: e.message }
    }
  }

  /**
   * 创建 WebDAV 文件夹（如果不存在）
   * 使用 MKCOL 方法，兼容标准 WebDAV 服务器
   */
  async createFolder() {
    const folderUrl = this.getFolderURL()
    const authHeader = this.getAuthHeader()
    const credentials = this.server.includeCredentials ? 'include' : 'omit'

    const fetchWithTimeout = async (opts) => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      try {
        return await fetch(folderUrl, { ...opts, signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }
    }

    try {
      // 先检查文件夹是否存在（PROPFIND）
      let res = await fetchWithTimeout({
        method: 'PROPFIND',
        headers: {
          'Authorization': authHeader,
          'Depth': '0',
        },
        credentials,
      })

      if (res.status === 200 || res.status === 207) {
        console.log('[Webdav-BookmarkSync] 文件夹已存在，跳过创建')
        return true
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error('认证失败，请检查用户名和密码')
      }

      // 404 或其他状态，尝试创建
      console.log(`[Webdav-BookmarkSync] 文件夹不存在（HTTP ${res.status}），尝试创建`)

      // 创建文件夹（MKCOL）
      res = await fetchWithTimeout({
        method: 'MKCOL',
        headers: {
          'Authorization': authHeader,
        },
        credentials,
      })

      if (res.status === 201) {
        console.log('[Webdav-BookmarkSync] 文件夹创建成功')
        return true
      }

      if (res.status === 405) {
        // 某些服务器不支持 MKCOL，但文件夹可能已存在或由服务器自动创建
        console.log('[Webdav-BookmarkSync] 服务器不支持 MKCOL，假设文件夹已存在')
        return true
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error('认证失败，请检查用户名和密码')
      }

      if (res.status >= 300) {
        throw new Error(`创建文件夹失败，HTTP ${res.status}`)
      }

      return true
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('创建文件夹超时（15秒），请检查网络连接')
      }
      throw e
    }
  }

  /**
   * 标准化 URL，确保末尾有 /（仅用于目录路径）
   * @deprecated 已合并到 getBookmarkURL，保留用于兼容
   */
  normalizeServerURL(input) {
    let serverURL
    try {
      serverURL = new URL(input)
    } catch (e) {
      throw new Error('无效的 URL: ' + input)
    }
    if (!serverURL.pathname) serverURL.pathname = ''
    serverURL.search = ''
    serverURL.hash = ''
    const output = serverURL.toString()
    return output + (output[output.length - 1] !== '/' ? '/' : '')
  }

  /**
   * 生成 Basic Auth 认证头（UTF-8 安全，支持中文用户名/密码）
   */
  getAuthHeader() {
    const raw = this.server.username + ':' + this.server.password
    // 使用 UTF-8 编码后再 Base64，避免 btoa 对非 ASCII 字符抛异常
    const bytes = new TextEncoder().encode(raw)
    let binary = ''
    for (const b of bytes) {
      binary += String.fromCharCode(b)
    }
    const authString = btoa(binary)
    return 'Basic ' + authString
  }

  /**
   * 发送 WebDAV 请求
   * 30 秒超时，遇到网络错误/5xx/429/超时时自动指数退避重试（最多3次）
   */
  async sendRequest(method, body = null) {
    const url = this.getBookmarkURL()
    const headers = {
      'Authorization': this.getAuthHeader(),
    }

    if (method === 'PUT') {
      headers['Content-Type'] = 'text/html; charset=utf-8'
    }

    const options = {
      method,
      headers,
      credentials: this.server.includeCredentials ? 'include' : 'omit',
    }

    if (body !== null) {
      options.body = body
    }

    // 指数退避间隔（毫秒）：第1次重试等2s，第2次5s，第3次10s
    const retryDelays = [2000, 5000, 10000]
    const maxRetries = 3
    let lastError = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      options.signal = controller.signal

      try {
        const res = await fetch(url, options)

        if (method === 'HEAD') {
          clearTimeout(timeoutId)
          return { status: res.status, ok: res.ok }
        }

        const text = await res.text()
        clearTimeout(timeoutId)

        // 判断是否需要重试：5xx 服务器错误、429 限流
        const shouldRetry = res.status >= 500 || res.status === 429

        if (shouldRetry && attempt < maxRetries) {
          console.log(`[Webdav-BookmarkSync] 请求返回 HTTP ${res.status}，第 ${attempt + 1} 次重试，等待 ${retryDelays[attempt] / 1000}s...`)
          await this._sleep(retryDelays[attempt])
          continue
        }

        return { status: res.status, ok: res.ok, text }
      } catch (e) {
        clearTimeout(timeoutId)
        lastError = e

        // 网络错误或超时，重试
        const isNetworkError = e.name === 'AbortError' || e.name === 'TypeError' || e.message.includes('Failed to fetch') || e.message.includes('NetworkError')

        if (isNetworkError && attempt < maxRetries) {
          const errorType = e.name === 'AbortError' ? '超时' : '网络错误'
          console.log(`[Webdav-BookmarkSync] 请求${errorType}，第 ${attempt + 1} 次重试，等待 ${retryDelays[attempt] / 1000}s...`)
          await this._sleep(retryDelays[attempt])
          continue
        }

        // 不重试的错误，直接抛出
        if (e.name === 'AbortError') {
          throw new Error('请求超时（30秒），请检查网络连接或 WebDAV 服务器状态')
        }
        throw e
      }
    }

    // 所有重试都失败
    if (lastError && lastError.name === 'AbortError') {
      throw new Error('请求超时（30秒），重试3次后仍失败，请检查网络连接或 WebDAV 服务器状态')
    }
    throw lastError || new Error('请求失败')
  }

  /**
   * 休眠指定毫秒数
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * GET 下载书签文件
   * @returns {string|null} HTML 文本内容，文件不存在返回 null
   */
  async downloadFile() {
    const result = await this.sendRequest('GET')

    if (result.status === 401 || result.status === 403) {
      throw new Error('认证失败，请检查用户名和密码')
    }

    if (result.status === 404) {
      // 文件不存在，返回空（首次同步）
      return null
    }

    if (result.status >= 300) {
      throw new Error(this._getErrorMessage(result.status, '下载'))
    }

    // 端到端加密：如果内容是加密的，用密钥解密
    if (this._isEncrypted(result.text)) {
      if (!this.server.encryptionPassphrase) {
        throw new Error('服务器上的书签文件已加密，但未设置加密密钥。请在设置中填写加密密钥后再同步。')
      }
      try {
        return await this._decryptContent(result.text, this.server.encryptionPassphrase)
      } catch (e) {
        throw new Error('解密失败：密钥可能不正确。请检查加密密钥是否正确。')
      }
    }

    return result.text
  }

  /**
   * PUT 上传书签文件
   * @param {string} content HTML 文本内容
   */
  async uploadFile(content) {
    // 端到端加密：如果设置了密钥，加密后再上传
    let uploadContent = content
    if (this.server.encryptionPassphrase) {
      uploadContent = await this._encryptContent(content, this.server.encryptionPassphrase)
    }

    const result = await this.sendRequest('PUT', uploadContent)

    if (result.status === 401 || result.status === 403) {
      throw new Error('认证失败，请检查用户名和密码')
    }

    if (result.status === 404) {
      throw new Error('目录不存在，请检查 WebDAV URL 和文件路径是否正确')
    }

    if (result.status === 409) {
      throw new Error('上传冲突，请检查目录是否存在')
    }

    if (result.status === 500) {
      if (this.is123Pan()) {
        throw new Error('123 云盘服务器内部错误：可能是文件过大或服务器临时故障，请稍后重试')
      }
      throw new Error('服务器内部错误，请稍后重试')
    }

    if (result.status >= 300) {
      throw new Error(this._getErrorMessage(result.status, '上传'))
    }

    return true
  }

  /**
   * 下载变更日志（changes.json）
   * @returns {Promise<object|null>} 变更日志对象，不存在则返回 null
   */
  async downloadChangeLog() {
    const url = this.getChangeLogURL()
    const authHeader = this.getAuthHeader()
    const credentials = this.server.includeCredentials ? 'include' : 'omit'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': authHeader },
        credentials,
        signal: controller.signal,
      })
      if (res.status === 404) return null
      if (res.status >= 300) {
        throw new Error(this._getErrorMessage(res.status, '下载变更日志'))
      }
      const text = await res.text()
      // 如果加密了，先解密
      if (this._isEncrypted(text)) {
        if (!this.server.encryptionPassphrase) {
          throw new Error('检测到加密的变更日志，但未设置加密密钥，请在设置中填写密钥')
        }
        const decrypted = await this._decryptContent(text)
        return JSON.parse(decrypted)
      }
      return JSON.parse(text)
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('下载变更日志超时')
      throw e
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 上传变更日志（changes.json）
   * @param {object} changeLog - 变更日志对象
   */
  async uploadChangeLog(changeLog) {
    const url = this.getChangeLogURL()
    const authHeader = this.getAuthHeader()
    const credentials = this.server.includeCredentials ? 'include' : 'omit'

    let content = JSON.stringify(changeLog, null, 2)
    // 如果设了加密密钥，加密后上传
    if (this.server.encryptionPassphrase) {
      content = await this._encryptContent(content)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: content,
        credentials,
        signal: controller.signal,
      })
      if (res.status >= 300) {
        throw new Error(this._getErrorMessage(res.status, '上传变更日志'))
      }
      return true
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('上传变更日志超时')
      throw e
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 测试连接是否可用（只探测，不创建任何东西）
   *
   * 测试逻辑：
   * 1. 用 PROPFIND 方法探测用户配置的 WebDAV 根目录 URL
   * 2. 根据 HTTP 状态码判断连接状态：
   *    - 200/207：服务器可达、认证通过、目录存在 → 连接成功
   *    - 404：服务器可达、认证通过，但目录不存在 → 连接成功但提示检查路径
   *    - 401/403：认证失败
   *    - 405/501：服务器不支持 WebDAV 方法
   *    - 其他 4xx/5xx：对应错误
   * 3. 全程只读，不创建文件夹、不上传文件
   */
  async testConnection() {
    try {
      // 探测用户配置的根目录 URL（不是书签文件 URL，也不是文件夹 URL）
      const input = this.server.url.trim()
      let testUrl
      try {
        const parsed = new URL(input)
        parsed.search = ''
        parsed.hash = ''
        testUrl = parsed.toString()
      } catch (e) {
        return { success: false, error: '无效的 URL 格式' }
      }

      const authHeader = this.getAuthHeader()
      const credentials = this.server.includeCredentials ? 'include' : 'omit'

      // 带超时的 fetch 辅助
      const fetchWithTimeout = async (opts) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        try {
          return await fetch(testUrl, { ...opts, signal: controller.signal })
        } finally {
          clearTimeout(timeoutId)
        }
      }

      // 先尝试 PROPFIND（WebDAV 标准方法，检测目录是否存在）
      let res = await fetchWithTimeout({
        method: 'PROPFIND',
        headers: {
          'Authorization': authHeader,
          'Depth': '0',
        },
        credentials,
      })

      // 某些服务器不支持 PROPFIND，退回 OPTIONS
      if (res.status === 405 || res.status === 501) {
        res = await fetchWithTimeout({
          method: 'OPTIONS',
          headers: {
            'Authorization': authHeader,
          },
          credentials,
        })
      }

      // 200/207 = 成功（目录存在）
      if (res.status === 200 || res.status === 207) {
        return { success: true, warning: '连接成功，服务器可达且认证通过' }
      }
      // 401/403 = 认证失败
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: '认证失败，请检查用户名和密码' }
      }
      // 404 = 服务器可达、认证通过，但目录不存在
      if (res.status === 404) {
        return { success: true, warning: '连接成功，但配置的目录不存在，请检查 WebDAV URL 路径是否正确（同步时会自动创建文件夹）' }
      }
      // 405/501 = 服务器不支持 WebDAV 方法
      if (res.status === 405 || res.status === 501) {
        return { success: false, error: '服务器不支持 WebDAV 方法，请确认 URL 是否正确' }
      }
      // 409 = 冲突，通常是父目录不存在
      if (res.status === 409) {
        return { success: false, error: '父目录不存在，请检查 WebDAV URL 中的路径是否正确' }
      }
      // 其他 4xx
      if (res.status >= 400 && res.status < 500) {
        return { success: false, error: `请求失败，HTTP ${res.status}` }
      }
      // 5xx = 服务器错误
      return { success: false, error: `服务器错误，HTTP ${res.status}，请稍后重试` }
    } catch (e) {
      if (e.name === 'AbortError') {
        return { success: false, error: '连接超时（15秒），请检查网络连接或 WebDAV 服务器状态' }
      }
      return { success: false, error: e.message }
    }
  }

  /**
   * 获取友好的错误信息
   */
  _getErrorMessage(status, action) {
    const messages = {
      400: `${action}失败：请求格式错误`,
      401: `${action}失败：认证失败，请检查用户名和密码`,
      403: `${action}失败：权限不足`,
      404: `${action}失败：文件不存在`,
      405: `${action}失败：服务器不支持此方法`,
      409: `${action}失败：资源冲突`,
      411: `${action}失败：需要 Content-Length`,
      412: `${action}失败：前置条件失败`,
      413: `${action}失败：文件过大`,
      423: `${action}失败：资源被锁定`,
      500: `${action}失败：服务器内部错误`,
      501: `${action}失败：服务器未实现此功能`,
      502: `${action}失败：网关错误`,
      503: `${action}失败：服务器暂不可用`,
      507: `${action}失败：服务器存储空间不足`,
    }
    return messages[status] || `${action}失败，HTTP 状态码: ${status}`
  }

  // ============================================================
  // 端到端加密（PBKDF2 + AES-GCM）
  // 加密文件格式：WBE1:<base64(salt(16字节) + iv(12字节) + ciphertext)>
  // ============================================================

  static ENCRYPTION_MAGIC = 'WBE1:'

  /**
   * 检查内容是否是加密文件
   */
  _isEncrypted(content) {
    return typeof content === 'string' && content.startsWith(WebDavAdapter.ENCRYPTION_MAGIC)
  }

  /**
   * 用 PBKDF2 从密码派生 AES-GCM 密钥
   */
  async _deriveKey(passphrase, salt) {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    )
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  /**
   * 加密内容
   * @returns {string} WBE1:<base64(salt + iv + ciphertext)>
   */
  async _encryptContent(content, passphrase) {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await this._deriveKey(passphrase, salt)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(content)
    )

    // 拼接 salt + iv + ciphertext
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
    combined.set(salt, 0)
    combined.set(iv, salt.length)
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

    // 转 base64
    const base64 = this._uint8ToBase64(combined)
    return WebDavAdapter.ENCRYPTION_MAGIC + base64
  }

  /**
   * 解密内容
   * @param {string} encrypted WBE1:<base64(salt + iv + ciphertext)>
   * @returns {string} 原文
   */
  async _decryptContent(encrypted, passphrase) {
    const base64 = encrypted.slice(WebDavAdapter.ENCRYPTION_MAGIC.length)
    const combined = this._base64ToUint8(base64)

    const salt = combined.slice(0, 16)
    const iv = combined.slice(16, 28)
    const ciphertext = combined.slice(28)

    const key = await this._deriveKey(passphrase, salt)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    )

    const decoder = new TextDecoder()
    return decoder.decode(plaintext)
  }

  /**
   * Uint8Array 转 base64
   */
  _uint8ToBase64(bytes) {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * base64 转 Uint8Array
   */
  _base64ToUint8(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}
