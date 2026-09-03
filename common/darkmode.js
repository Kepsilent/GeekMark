/**
 * 深色模式共享逻辑（popup 和 options 共用）
 * 使用方式：在 HTML 中 <script src="../common/darkmode.js"></script>
 */
function applyDarkMode(mode) {
  const body = document.body
  body.classList.remove('dark-mode', 'light-mode')
  if (mode === 'dark') {
    body.classList.add('dark-mode')
  } else if (mode === 'light') {
    body.classList.add('light-mode')
  }
  // auto 模式由 CSS 的 prefers-color-scheme 媒体查询处理
}
