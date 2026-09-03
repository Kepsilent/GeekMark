/**
 * i18n 国际化工具函数
 * 支持跟随浏览器语言和手动切换语言
 */

let currentLocale = null // 当前语言：null=跟随浏览器，'zh_CN'，'en'
let messagesCache = {} // 翻译缓存：{ locale: { key: message } }
let messagesLoaded = false // 翻译是否已加载

/**
 * 获取当前生效的语言代码
 */
function getCurrentLocale() {
  if (currentLocale) return currentLocale
  // 跟随浏览器语言
  const uiLang = chrome.i18n.getUILanguage()
  if (uiLang.startsWith('zh')) return 'zh_CN'
  return 'en'
}

/**
 * 加载指定语言的 messages.json
 */
async function loadMessages(locale) {
  if (messagesCache[locale]) return messagesCache[locale]
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`)
    const response = await fetch(url)
    const data = await response.json()
    // 转换为 { key: message } 格式
    const messages = {}
    for (const key in data) {
      messages[key] = data[key].message
    }
    messagesCache[locale] = messages
    return messages
  } catch (e) {
    console.warn('加载翻译文件失败:', locale, e)
    return {}
  }
}

/**
 * 初始化 i18n，加载用户设置的语言
 */
async function initI18n() {
  try {
    const result = await chrome.storage.local.get('language')
    currentLocale = result.language || null // null=跟随浏览器
  } catch (e) {
    currentLocale = null
  }
  // 预加载当前语言和浏览器语言的翻译（用于快速切换）
  const locale = getCurrentLocale()
  await loadMessages(locale)
  messagesLoaded = true
}

/**
 * 获取翻译文本
 */
function t(key) {
  const locale = getCurrentLocale()
  const messages = messagesCache[locale]
  if (messages && messages[key]) return messages[key]
  // 回退到 chrome.i18n.getMessage
  const fallback = chrome.i18n.getMessage(key)
  if (fallback) return fallback
  return key
}

/**
 * 应用 i18n 翻译到页面元素
 * 在页面加载时调用，自动替换所有带 data-i18n 属性的元素文本
 * 支持 data-i18n（文本内容）、data-i18n-placeholder（placeholder）、data-i18n-title（title）
 */
function applyI18n() {
  // 替换元素文本内容
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    const message = t(key)
    if (message && message !== key) {
      el.textContent = message
    }
  })

  // 替换 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')
    const message = t(key)
    if (message && message !== key) {
      el.setAttribute('placeholder', message)
    }
  })

  // 替换 title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')
    const message = t(key)
    if (message && message !== key) {
      el.setAttribute('title', message)
    }
  })
}

/**
 * 设置语言（手动切换）
 * @param {string|null} locale - 'zh_CN' / 'en' / null(跟随系统)
 */
async function setLanguage(locale) {
  currentLocale = locale
  if (locale) {
    await chrome.storage.local.set({ language: locale })
  } else {
    await chrome.storage.local.remove('language')
  }
  // 加载新语言的翻译
  await loadMessages(getCurrentLocale())
  // 重新应用翻译
  applyI18n()
}
