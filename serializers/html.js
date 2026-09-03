/**
 * HTML 序列化器
 * 浏览器书签 ↔ Netscape Bookmarks HTML 格式
 * 完整保留文件夹结构和书签顺序
 *
 * 改编自 Floccus 的 Html.ts (MIT License)
 * Copyright (c) Floccus 贡献者
 *
 * 注意：不使用 DOMParser，因为 MV3 Service Worker 环境中没有该 API
 * 使用正则 + 文件夹栈解析，兼容标准 Netscape 书签格式
 */

const DOCTYPE = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n'

class HtmlSerializer {
  /**
   * 将浏览器书签树序列化为 HTML 字符串
   * @param {Array} bookmarkTree - chrome.bookmarks.getTree() 返回的树
   * @returns {string} HTML 文本
   */
  serialize(bookmarkTree) {
    const root = bookmarkTree[0]
    return DOCTYPE + '<DL><p>\n' + this._serializeFolder(root, '') + '</DL><p>\n'
  }

  _serializeFolder(folder, indent) {
    const children = folder.children || []
    return children.map(child => {
      if (child.url) {
        // 书签
        return `${indent}<DT><A HREF="${this._escapeHtml(child.url)}">${this._escapeHtml(child.title)}</A>\n`
      } else {
        // 文件夹
        const nextIndent = indent + '    '
        return (
          `${indent}<DT><H3>${this._escapeHtml(child.title)}</H3>\n` +
          `${indent}<DL><p>\n` +
          this._serializeFolder(child, nextIndent) +
          `${indent}</DL><p>\n`
        )
      }
    }).join('')
  }

  _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * 校验下载的书签文件是否完整、格式是否正常
   * 防止服务器文件损坏/截断时用坏数据覆盖本地
   * @param {string} html - 下载的 HTML 文本
   * @returns {{valid: boolean, reason: string}}
   */
  validate(html) {
    // 1. 空内容检查
    if (!html || typeof html !== 'string' || html.trim().length === 0) {
      return { valid: false, reason: '文件内容为空' }
    }

    // 2. 内容过短检查（正常书签文件至少有 DOCTYPE + DL 结构，通常 > 50 字节）
    if (html.trim().length < 30) {
      return { valid: false, reason: '文件内容过短，可能已损坏' }
    }

    // 3. 基本格式检查：Netscape 书签格式必须包含 <DL> 标签
    //    （即使是空书签文件也会有 <DL><p></DL><p> 结构）
    if (!/<DL\b/i.test(html)) {
      return { valid: false, reason: '文件缺少 <DL> 标签，不是有效的书签格式' }
    }

    // 4. 检查是否有明显的损坏特征（如截断在标签中间、二进制乱码占比过高）
    //    统计可打印 ASCII + 中文等正常字符比例，乱码过多视为损坏
    const totalChars = html.length
    let normalChars = 0
    for (let i = 0; i < totalChars; i++) {
      const code = html.charCodeAt(i)
      // 可打印 ASCII (32-126)、换行/制表、中文范围 (0x4E00-0x9FFF)、常见扩展
      if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9 ||
          (code >= 0x4E00 && code <= 0x9FFF) ||
          (code >= 0x3000 && code <= 0x303F) || // 中文标点
          (code >= 0xFF00 && code <= 0xFFEF)) { // 全角字符
        normalChars++
      }
    }
    const normalRatio = normalChars / totalChars
    if (normalRatio < 0.7) {
      return { valid: false, reason: `文件包含过多异常字符（正常字符占比 ${(normalRatio * 100).toFixed(0)}%），可能已损坏或为二进制文件` }
    }

    // 5. 尝试解析，检查是否能正常解析（不抛异常即格式正确）
    //    空书签文件（只有 DL 结构，无书签无文件夹）是合法的，不校验失败
    try {
      this.deserialize(html)
    } catch (e) {
      return { valid: false, reason: '解析失败：' + e.message }
    }

    return { valid: true, reason: '' }
  }

  /**
   * 将 HTML 字符串解析为书签数组
   * 使用正则 + 文件夹栈解析，不依赖 DOMParser（Service Worker 中不可用）
   * @param {string} html - HTML 文本
   * @returns {Array} 扁平化的书签数组，每个元素包含 {title, url, folder}
   */
  deserialize(html) {
    const items = []
    const folderStack = [] // 文件夹路径栈，遇到 H3 入栈，遇到 </DL> 出栈

    // 去掉 DOCTYPE 和 HTML 注释
    let content = html.replace(/<!DOCTYPE[^>]*>/gi, '')
    content = content.replace(/<!--[\s\S]*?-->/g, '')

    // 按顺序匹配 <DL>、</DL>、<DT>...</DT> 三种 token
    // <DT> 的内容匹配到下一个 DT/DL 标签为止
    const tokenRegex = /<(\/?DL)\b[^>]*>|<DT\b[^>]*>([\s\S]*?)(?=<(?:DT|\/?DL)\b|$)/gi
    let match

    while ((match = tokenRegex.exec(content)) !== null) {
      if (match[1]) {
        // 是 <DL> 或 </DL>
        if (match[1].toUpperCase() === '/DL') {
          // 离开当前文件夹，出栈
          if (folderStack.length > 0) {
            folderStack.pop()
          }
        }
        // <DL> 不做操作——文件夹名已在遇到 <DT><H3> 时入栈
      } else if (match[2]) {
        // 是 <DT> 块，判断是文件夹还是书签
        const dtContent = match[2]

        // 检查是否是文件夹（包含 H3）
        const h3Match = dtContent.match(/<H3\b[^>]*>([\s\S]*?)<\/H3>/i)
        if (h3Match) {
          const folderName = this._unescapeHtml(h3Match[1].trim())
          if (folderName) {
            folderStack.push(folderName)
          }
          continue
        }

        // 是书签（包含 A 标签，提取 HREF 和文本）
        const aMatch = dtContent.match(/<A\b[^>]*\bHREF\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/A>/i)
        if (aMatch) {
          const url = this._unescapeHtml(aMatch[1].trim())
          const title = this._unescapeHtml(aMatch[2].trim())
          if (url && title) {
            items.push({
              title,
              url,
              folder: folderStack.join('/'),
            })
          }
        }
      }
    }

    return items
  }

  _unescapeHtml(str) {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  }
}

export default new HtmlSerializer()
