/**
 * i18n 国际化工具函数
 * 在页面加载时调用 applyI18n()，自动替换所有带 data-i18n 属性的元素文本
 * 支持 data-i18n（文本内容）、data-i18n-placeholder（placeholder）、data-i18n-title（title）
 */

function applyI18n() {
  // 替换元素文本内容
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    const message = chrome.i18n.getMessage(key)
    if (message) {
      el.textContent = message
    }
  })

  // 替换 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')
    const message = chrome.i18n.getMessage(key)
    if (message) {
      el.setAttribute('placeholder', message)
    }
  })

  // 替换 title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')
    const message = chrome.i18n.getMessage(key)
    if (message) {
      el.setAttribute('title', message)
    }
  })
}

/**
 * 获取翻译文本（JS 中动态使用）
 */
function t(key) {
  return chrome.i18n.getMessage(key) || key
}
