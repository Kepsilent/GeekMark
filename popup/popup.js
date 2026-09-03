/**
 * 弹窗页面逻辑
 */

// 同步状态轮询定时器
let pollTimer = null

document.addEventListener('DOMContentLoaded', async () => {
  // 加载状态
  loadState()

  // 手动刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn')
    btn.classList.add('spinning')
    loadState().finally(() => {
      setTimeout(() => btn.classList.remove('spinning'), 500)
    })
  })

  // 在新标签页打开主界面
  document.getElementById('openTabBtn').addEventListener('click', () => {
    const url = chrome.runtime.getURL('popup/popup.html') + '?inTab=1'
    chrome.tabs.create({ url })
  })

  // 检测是否在标签页中打开（非弹窗），如果是则调整为全宽布局
  const params = new URLSearchParams(window.location.search)
  if (params.get('inTab') === '1') {
    document.body.style.width = '100%'
    document.body.style.maxWidth = '640px'
    document.body.style.margin = '0 auto'
    document.body.style.minHeight = '100vh'
    document.body.style.padding = '24px'
    document.getElementById('openTabBtn').style.display = 'none' // 已经在标签页里，隐藏按钮
  }

  // 监听 storage 变化，后台同步状态更新时自动刷新界面
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    // 同步相关字段变化时自动刷新
    if (changes.lastSync || changes.lastError || changes.lastStats || changes.lastConflicts) {
      loadState()
    }
  })

  // 同步按钮
  document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncBtn')
    btn.disabled = true
    btn.textContent = '同步中...'
    btn.classList.add('syncing')

    try {
      const result = await chrome.runtime.sendMessage({ type: 'sync' })
      if (result && result.error) {
        // 如果是未配置错误，显示配置提示
        if (result.error.includes('尚未配置')) {
          showSetupCard(true)
        }
      }
    } catch (e) {
      console.error('同步请求失败:', e)
      const errorMsgEl = document.getElementById('errorMsg')
      if (errorMsgEl) {
        errorMsgEl.textContent = '通信失败，请刷新重试'
        errorMsgEl.className = 'status-value error'
      }
    } finally {
      btn.disabled = false
      btn.textContent = '立即同步'
      btn.classList.remove('syncing')
      loadState()
    }
  })

  // 高级同步展开/收起
  document.getElementById('advancedToggle').addEventListener('click', () => {
    const panel = document.getElementById('advancedPanel')
    const toggle = document.getElementById('advancedToggle')
    const arrow = toggle.querySelector('.toggle-arrow')
    if (panel.style.display === 'none') {
      panel.style.display = 'block'
      arrow.style.transform = 'rotate(180deg)'
    } else {
      panel.style.display = 'none'
      arrow.style.transform = 'rotate(0deg)'
    }
  })

  // 三种同步策略按钮
  const strategyButtons = [
    { id: 'strategyLocal', strategy: 'local', name: '本地覆盖云端', confirm: '确定要本地覆盖云端吗？本地书签将覆盖云端书签，云端原有内容会被替换。', status: '上传中...' },
    { id: 'strategyServer', strategy: 'server', name: '云端覆盖本地', confirm: '确定要云端覆盖本地吗？云端书签将覆盖本地书签，同步前会自动备份本地书签。', status: '下载中...' },
    { id: 'strategyMerge', strategy: 'merge', name: '多设备智能同步', confirm: null, status: '同步中...' },
  ]
  for (const btn of strategyButtons) {
    document.getElementById(btn.id).addEventListener('click', async () => {
      if (btn.confirm && !confirm(btn.confirm)) return
      await runManualSync(btn.id, btn.status, btn.strategy)
    })
  }

  // 暂停同步开关
  document.getElementById('pauseSync').addEventListener('change', async (e) => {
    const paused = e.target.checked
    try {
      const settings = await chrome.runtime.sendMessage({ type: 'getSettings' })
      settings.syncPaused = paused
      await chrome.runtime.sendMessage({ type: 'setSettings', settings })
      if (paused) {
        updateBadgePaused(true)
      } else {
        updateBadgePaused(false)
      }
      // 先确保 checkbox 状态正确显示
      e.target.checked = paused
      // 加延迟再刷新完整状态，确保 storage 写入完成后读取到最新值
      setTimeout(() => loadState(), 200)
    } catch (err) {
      console.error('切换暂停状态失败:', err)
      e.target.checked = !paused // 恢复
    }
  })

  // 设置链接
  document.getElementById('settingsLink').addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.openOptionsPage()
  })

  // 未配置时的"立即配置"按钮
  document.getElementById('setupBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage()
  })

  // 冲突数字点击展开/收起详情
  document.getElementById('statConflicts').addEventListener('click', () => {
    const detail = document.getElementById('conflictDetail')
    if (detail.classList.contains('show')) {
      detail.classList.remove('show')
    } else {
      detail.classList.add('show')
    }
  })

  // 页面关闭时清理轮询定时器
  window.addEventListener('unload', stopPolling)
})

/**
 * 启动同步状态轮询（同步中时每 1.5 秒查一次，同步完成自动停止）
 */
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'getState' })
      if (state && !state.syncing) {
        // 同步完成，刷新一次并停止轮询
        stopPolling()
        loadState()
      }
    } catch (e) {
      // Service Worker 可能被回收，停止轮询
      stopPolling()
    }
  }, 1500)
}

/**
 * 停止轮询
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * 检查设置是否完整
 */
function isSettingsComplete(settings) {
  return settings && settings.url && settings.username && settings.password
}

/**
 * 执行手动同步（上传/下载）
 */
async function runManualSync(btnId, btnText, strategy) {
  const btn = document.getElementById(btnId)
  const originalHTML = btn.innerHTML
  // 禁用所有策略按钮
  const allBtns = document.querySelectorAll('.strategy-item')
  allBtns.forEach(b => b.disabled = true)
  btn.innerHTML = `<span style="flex:1;text-align:center;font-size:13px;color:#4CAF50;">${btnText}</span>`
  try {
    const result = await chrome.runtime.sendMessage({ type: 'sync', overrideStrategy: strategy })
    if (result && result.error) {
      console.error('同步失败:', result.error)
    }
  } catch (e) {
    console.error('同步请求失败:', e)
  } finally {
    btn.innerHTML = originalHTML
    allBtns.forEach(b => b.disabled = false)
    loadState()
  }
}

/**
 * 显示/隐藏未配置提示卡片
 */
function showSetupCard(show, isFirstTime = false) {
  const setupCard = document.getElementById('setupCard')
  const syncContent = document.getElementById('syncContent')
  const setupTitle = document.getElementById('setupTitle')
  const setupDesc = document.getElementById('setupDesc')
  const refreshBtn = document.getElementById('refreshBtn')

  if (show) {
    setupCard.style.display = 'block'
    syncContent.style.display = 'none'
    refreshBtn.style.display = 'none' // 未配置时没有状态可刷新，隐藏按钮

    if (isFirstTime) {
      setupTitle.textContent = '初次使用，欢迎！'
      setupDesc.textContent = '请先配置 WebDAV 服务器信息（支持 123 云盘、坚果云等），配置完成后即可开始同步书签'
    } else {
      setupTitle.textContent = '尚未配置 WebDAV 服务器'
      setupDesc.textContent = '配置不完整，无法同步。请点击下方按钮完成配置'
    }
  } else {
    setupCard.style.display = 'none'
    syncContent.style.display = 'block'
    refreshBtn.style.display = '' // 恢复显示
  }
}

async function loadState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'getState' })
    if (!state) return

    // 应用深色模式（用共享函数）
    const darkMode = state.settings?.darkMode || 'auto'
    applyDarkMode(darkMode)

    // 检查设置是否完整
    const settingsComplete = isSettingsComplete(state.settings)
    const isFirstTime = !state.lastSync && !settingsComplete

    if (!settingsComplete) {
      showSetupCard(true, isFirstTime)
      return
    }

    // 设置完整，显示同步内容
    showSetupCard(false)

    // 显示暂停状态
    const paused = state.settings && state.settings.syncPaused
    document.getElementById('pauseSync').checked = paused === true
    const syncBtn = document.getElementById('syncBtn')
    if (paused && !state.syncing) {
      syncBtn.textContent = '已暂停，点击手动同步'
    } else if (!state.syncing) {
      syncBtn.textContent = '立即同步'
    }

    const statusEl = document.getElementById('syncStatus')
    const lastSyncEl = document.getElementById('lastSync')
    const errorMsgEl = document.getElementById('errorMsg')

    if (state.syncing) {
      const phaseMap = {
        downloading: '下载中...',
        merging: '合并中...',
        applying: '应用变更中...',
        uploading: '上传中...',
      }
      statusEl.textContent = phaseMap[state.currentPhase] || '同步中...'
      statusEl.className = 'status-value syncing'
      // 同步中：启动轮询，同步完成后自动刷新
      startPolling()
    } else {
      // 不在同步：停止轮询
      stopPolling()
      if (state.lastError && !state.lastError.includes('尚未配置')) {
        statusEl.textContent = '同步失败'
        statusEl.className = 'status-value error'
      } else if (state.lastSync) {
        statusEl.textContent = '已同步'
        statusEl.className = 'status-value success'
      } else {
        statusEl.textContent = '未同步'
        statusEl.className = 'status-value'
      }
    }

    if (state.lastSync) {
      const date = new Date(state.lastSync)
      lastSyncEl.textContent = formatTime(date)
    } else {
      lastSyncEl.textContent = '从未'
    }

    if (state.lastError && !state.lastError.includes('尚未配置')) {
      errorMsgEl.textContent = state.lastError
      errorMsgEl.className = 'status-value error'
    } else {
      errorMsgEl.textContent = '无'
      errorMsgEl.className = 'status-value'
    }

    // 展示同步结果统计
    const statsCard = document.getElementById('statsCard')
    const conflictNumEl = document.getElementById('statConflicts')
    const conflictDetail = document.getElementById('conflictDetail')
    const conflictList = document.getElementById('conflictList')

    if (state.lastStats && state.lastSync) {
      statsCard.style.display = 'block'
      document.getElementById('statAdded').textContent = state.lastStats.added || 0
      document.getElementById('statRemoved').textContent = state.lastStats.removed || 0
      conflictNumEl.textContent = state.lastStats.conflicts || 0

      // 冲突详情：有冲突时数字可点击，点击展开详情
      const conflicts = state.lastConflicts || []
      if (conflicts.length > 0) {
        conflictNumEl.classList.add('clickable')
        conflictNumEl.title = '点击查看冲突详情'

        // 渲染冲突列表
        conflictList.innerHTML = conflicts.map(c => `
          <div class="conflict-item">
            <div class="conflict-url">${escapeHtml(c.url)}</div>
            <div class="conflict-titles">
              <div class="conflict-local">本地：${escapeHtml(c.localTitle)}</div>
              <div class="conflict-server">服务器：${escapeHtml(c.serverTitle)}</div>
            </div>
          </div>
        `).join('')
      } else {
        conflictNumEl.classList.remove('clickable')
        conflictNumEl.title = ''
        conflictList.innerHTML = ''
        conflictDetail.classList.remove('show')
      }
    } else {
      statsCard.style.display = 'none'
      conflictDetail.classList.remove('show')
    }
  } catch (e) {
    console.error('加载状态失败:', e)
  }
}

function formatTime(date) {
  const now = new Date()
  const diff = now - date

  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return Math.floor(diff / 60000) + ' 分钟前'
  } else if (diff < 86400000) {
    return Math.floor(diff / 3600000) + ' 小时前'
  } else {
    return date.toLocaleString('zh-CN')
  }
}

/**
 * HTML 转义，防止 XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
