/**
 * 设置页面逻辑
 */

/**
 * 发送系统通知（options 页面用）
 */
function notifyOptions(title, message, type = 'info') {
  // 统一通过 background 发送系统通知，避免重复实现
  chrome.runtime.sendMessage({ type: 'notify', title, message, type })
}

document.addEventListener('DOMContentLoaded', async () => {
  // 加载文件夹列表
  const folders = await chrome.runtime.sendMessage({ type: 'getFolders' })
  const select = document.getElementById('localRoot')
  select.innerHTML = ''
  for (const folder of folders) {
    const option = document.createElement('option')
    option.value = folder.id
    option.textContent = '　'.repeat(folder.depth) + (folder.title || '(未命名)')
    select.appendChild(option)
  }

  // 加载已有设置
  const settings = await chrome.runtime.sendMessage({ type: 'getSettings' })
  if (settings) {
    document.getElementById('url').value = settings.url || ''
    document.getElementById('username').value = settings.username || ''
    document.getElementById('password').value = settings.password || ''
    document.getElementById('bookmark_file').value = settings.bookmark_file || 'bookmarks.html'
    document.getElementById('webdav_folder').value = settings.webdav_folder || 'Bookmarks'
    select.value = settings.localRoot || '1'
    document.getElementById('syncInterval').value = settings.syncInterval || 15
    document.getElementById('syncStrategy').value = settings.syncStrategy || 'merge'
    document.getElementById('syncOnStartupEnabled').checked = settings.syncOnStartupEnabled !== false
    document.getElementById('syncIntervalEnabled').checked = settings.syncIntervalEnabled !== false
    document.getElementById('syncOnChangeEnabled').checked = settings.syncOnChangeEnabled !== false
    document.getElementById('includeCredentials').checked = settings.includeCredentials || false
    document.getElementById('encryptionPassphrase').value = settings.encryptionPassphrase || ''
    document.getElementById('failsafeThreshold').value = settings.failsafeThreshold || 50
    document.getElementById('notifyOnSuccess').checked = settings.notifyOnSuccess !== false
    document.getElementById('notifyOnFailure').checked = settings.notifyOnFailure !== false
    document.getElementById('darkMode').value = settings.darkMode || 'auto'
    applyDarkMode(settings.darkMode || 'auto')
    // 如果已有密钥，显示确认密码框并填充
    if (settings.encryptionPassphrase) {
      document.getElementById('confirmPassphraseGroup').style.display = 'block'
      document.getElementById('confirmPassphrase').value = settings.encryptionPassphrase
      updatePassphraseStrength(settings.encryptionPassphrase)
    }
  }

  // 加密密钥输入时显示确认框和强度提示
  document.getElementById('encryptionPassphrase').addEventListener('input', (e) => {
    const val = e.target.value
    const confirmGroup = document.getElementById('confirmPassphraseGroup')
    if (val.length > 0) {
      confirmGroup.style.display = 'block'
    } else {
      confirmGroup.style.display = 'none'
      document.getElementById('confirmPassphrase').value = ''
    }
    updatePassphraseStrength(val)
  })

  // 加载并显示设备ID
  try {
    const deviceId = await chrome.runtime.sendMessage({ type: 'getDeviceId' })
    document.getElementById('deviceIdDisplay').value = deviceId || '未知'
  } catch (e) {
    document.getElementById('deviceIdDisplay').value = '加载失败'
  }
  document.getElementById('copyDeviceIdBtn').addEventListener('click', () => {
    const input = document.getElementById('deviceIdDisplay')
    if (!input.value) {
      showStatus('设备ID尚未加载', 'error')
      return
    }
    input.select()
    document.execCommand('copy')
    // 图标切换：复制图标 → 对勾图标
    const copyIcon = document.getElementById('copyIcon')
    const copiedIcon = document.getElementById('copiedIcon')
    if (copyIcon && copiedIcon) {
      copyIcon.style.display = 'none'
      copiedIcon.style.display = 'block'
      setTimeout(() => {
        copyIcon.style.display = 'block'
        copiedIcon.style.display = 'none'
      }, 1500)
    }
    showStatus('设备ID已复制', 'success')
  })

  // 保存按钮
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const settings = {
      url: document.getElementById('url').value.trim(),
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
      bookmark_file: document.getElementById('bookmark_file').value.trim() || 'bookmarks.html',
      webdav_folder: document.getElementById('webdav_folder').value.trim() || 'Bookmarks',
      localRoot: document.getElementById('localRoot').value,
      syncInterval: parseInt(document.getElementById('syncInterval').value) || 15,
      syncStrategy: document.getElementById('syncStrategy').value,
      syncOnStartupEnabled: document.getElementById('syncOnStartupEnabled').checked,
      syncIntervalEnabled: document.getElementById('syncIntervalEnabled').checked,
      syncOnChangeEnabled: document.getElementById('syncOnChangeEnabled').checked,
      includeCredentials: document.getElementById('includeCredentials').checked,
      encryptionPassphrase: document.getElementById('encryptionPassphrase').value,
      failsafeThreshold: parseInt(document.getElementById('failsafeThreshold').value) || 50,
      notifyOnSuccess: document.getElementById('notifyOnSuccess').checked,
      notifyOnFailure: document.getElementById('notifyOnFailure').checked,
      darkMode: document.getElementById('darkMode').value,
    }

    if (!settings.url || !settings.username || !settings.password) {
      showStatus('请填写完整的服务器信息', 'error')
      return
    }

    // 加密密钥校验
    const passphrase = document.getElementById('encryptionPassphrase').value
    if (passphrase.length > 0) {
      if (passphrase.length < 8) {
        showStatus('加密密钥至少需要 8 位', 'error')
        return
      }
      if (passphrase.length > 16) {
        showStatus('加密密钥最多 16 位', 'error')
        return
      }
      const confirmPass = document.getElementById('confirmPassphrase').value
      if (passphrase !== confirmPass) {
        showStatus('两次输入的加密密钥不一致', 'error')
        return
      }
    }

    // 先保存设置
    await chrome.runtime.sendMessage({ type: 'setSettings', settings })

    // 判断是否首次同步（从未成功同步过）
    const state = await chrome.runtime.sendMessage({ type: 'getState' })
    const isFirstSync = !state || !state.lastSync

    if (!isFirstSync) {
      showStatus('设置已保存', 'success')
      return
    }

    // 首次同步：检测本地和云端书签状态
    showStatus('正在检测本地和云端数据...', 'loading')
    const detect = await chrome.runtime.sendMessage({ type: 'detectFirstSync', settings })

    if (detect.error) {
      showStatus('检测失败：' + detect.error + '。请检查配置后重新保存。', 'error')
      return
    }

    console.log('[首次同步检测]', detect)

    if (detect.localHas && !detect.serverHas) {
      // 本地有、云端无 → 自动上传
      showStatus(`检测到本地有 ${detect.localCount} 个书签、云端为空，正在自动上传到云端...`, 'loading')
      await runFirstSync('local')
    } else if (!detect.localHas && detect.serverHas) {
      // 本地无、云端有 → 自动下载
      showStatus(`检测到云端有 ${detect.serverCount} 个书签、本地为空，正在自动下载到本地...`, 'loading')
      await runFirstSync('server')
    } else if (!detect.localHas && !detect.serverHas) {
      // 两边都无 → 直接合并建立基线
      showStatus('本地和云端均为空，正在建立同步基线...', 'loading')
      await runFirstSync('merge')
    } else {
      // 两边都有 → 弹出选择框
      showStatus('', '')
      showFirstSyncModal(detect)
    }
  })

  // 首次同步模态框：三个选项
  document.getElementById('chooseLocal').addEventListener('click', () => runFirstSync('local'))
  document.getElementById('chooseServer').addEventListener('click', () => runFirstSync('server'))
  document.getElementById('chooseMerge').addEventListener('click', () => runFirstSync('merge'))

  // 123 云盘快速填充
  document.getElementById('fill123Btn').addEventListener('click', () => {
    document.getElementById('url').value = 'https://webdav.123pan.cn/webdav'
    document.getElementById('bookmark_file').value = 'bookmarks.html'
    showStatus('已填充 123 云盘配置，请填写用户名和密码', 'success')
  })

  // 坚果云快速填充
  document.getElementById('fillJianguoyunBtn').addEventListener('click', () => {
    document.getElementById('url').value = 'https://dav.jianguoyun.com/dav/'
    document.getElementById('bookmark_file').value = 'bookmarks.html'
    showStatus('已填充坚果云配置，请填写用户名和密码', 'success')
  })

  // 测试连接按钮
  document.getElementById('testBtn').addEventListener('click', async () => {
    const settings = {
      url: document.getElementById('url').value.trim(),
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
      bookmark_file: document.getElementById('bookmark_file').value.trim() || 'bookmarks.html',
      webdav_folder: document.getElementById('webdav_folder').value.trim() || 'Bookmarks',
      includeCredentials: document.getElementById('includeCredentials').checked,
    }

    if (!settings.url || !settings.username || !settings.password) {
      showStatus('请填写完整的服务器信息（地址、用户名、密码）', 'error')
      return
    }

    // 测试连接，结果在下方提示条显示
    showStatus('正在测试连接...', 'loading')
    try {
      const result = await chrome.runtime.sendMessage({ type: 'testConnection', settings })

      if (result.success) {
        const msg = result.warning ? '连接成功！' + result.warning : '连接成功！'
        showStatus(msg, 'success')
      } else {
        showStatus('连接测试失败：' + (result.error || '未知错误'), 'error')
      }
    } catch (e) {
      showStatus('连接测试异常：' + e.message, 'error')
    }
  })

  // 检查文件夹按钮
  document.getElementById('checkFolderBtn').addEventListener('click', async () => {
    const settings = {
      url: document.getElementById('url').value.trim(),
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
      bookmark_file: document.getElementById('bookmark_file').value.trim() || 'bookmarks.html',
      webdav_folder: document.getElementById('webdav_folder').value.trim() || 'Bookmarks',
      includeCredentials: document.getElementById('includeCredentials').checked,
    }

    if (!settings.url || !settings.username || !settings.password) {
      showStatus('请先填写完整的服务器信息（地址、用户名、密码）', 'error')
      return
    }

    if (!settings.webdav_folder) {
      showStatus('请先填写文件夹名称', 'error')
      return
    }

    // 检查文件夹，结果在下方提示条显示
    showStatus('正在检查文件夹...', 'loading')
    try {
      const result = await chrome.runtime.sendMessage({ type: 'checkFolder', settings })

      if (result.error) {
        showStatus('检查文件夹失败：' + result.error, 'error')
      } else if (result.exists) {
        showStatus(`文件夹「${settings.webdav_folder}」已存在，将直接使用`, 'success')
      } else {
        showStatus(`文件夹「${settings.webdav_folder}」不存在，首次同步时将自动创建`, 'success')
      }
    } catch (e) {
      showStatus('检查文件夹异常：' + e.message, 'error')
    }
  })

  // 加载备份列表和日志
  loadBackups()
  loadSyncLogs()

  // 导出配置
  document.getElementById('exportConfigBtn').addEventListener('click', async () => {
    try {
      const settings = await chrome.runtime.sendMessage({ type: 'getSettings' })
      const exportData = {
        app: 'Webdav-BookmarkSync',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: settings,
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `webdav-bookmarksync-config-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showStatus('配置已导出，请妥善保管文件（包含密码等敏感信息）', 'success')
    } catch (e) {
      showStatus('导出失败：' + e.message, 'error')
    }
  })

  // 导入配置
  document.getElementById('importConfigBtn').addEventListener('click', () => {
    document.getElementById('importConfigFile').click()
  })
  document.getElementById('importConfigFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.settings || !data.settings.url) {
        throw new Error('文件格式不正确，不是有效的配置文件')
      }
      // 确认导入
      if (!confirm(`确定要导入配置吗？当前配置将被覆盖。\n\n服务器：${data.settings.url}\n用户名：${data.settings.username || '(空)'}`)) {
        return
      }
      await chrome.runtime.sendMessage({ type: 'setSettings', settings: data.settings })
      // 重新加载页面显示新配置
      showStatus('配置导入成功，页面即将刷新...', 'success')
      setTimeout(() => location.reload(), 1500)
    } catch (err) {
      showStatus('导入失败：' + err.message, 'error')
    } finally {
      e.target.value = '' // 重置文件输入，允许重复导入同一文件
    }
  })

  // 导出书签（弹窗选择）
  document.getElementById('exportBookmarksBtn').addEventListener('click', () => {
    startExportFlow()
  })

  // 导入书签（弹窗三步：来源→勾选→模式）
  document.getElementById('importBookmarksBtn').addEventListener('click', () => {
    startImportFlow()
  })

  // 一键清空本地书签
  document.getElementById('clearBookmarksBtn').addEventListener('click', () => {
    showClearConfirm()
  })

  // 导入文件选择（隐藏的 input，由导入流程触发）
  document.getElementById('importBookmarksFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const text = await file.text()
      importFlowData.html = text
      importFlowData.sourceName = file.name
      showImportStep2()
    } catch (err) {
      showStatus('读取文件失败：' + err.message, 'error')
    } finally {
      e.target.value = ''
    }
  })

  // 弹窗取消按钮
  document.getElementById('bookmarkModalCancel').addEventListener('click', () => {
    closeBookmarkModal()
  })

  // 弹窗确认按钮（根据当前流程动态处理）
  document.getElementById('bookmarkModalConfirm').addEventListener('click', async () => {
    if (modalCurrentFlow === 'export') {
      doExport()
    } else if (modalCurrentFlow === 'import-step2') {
      // 保存勾选状态，再进入下一步
      await saveImportSelection()
      showImportStep3()
    } else if (modalCurrentFlow === 'import-step3') {
      doImport()
    } else if (modalCurrentFlow === 'clear') {
      doClear()
    } else if (modalCurrentFlow === 'restore') {
      doRestore()
    }
  })
})

// ============================================================
// 书签管理弹窗逻辑
// ============================================================
let modalCurrentFlow = '' // export / import-step1 / import-step2 / import-step3 / clear / restore
let importFlowData = { html: '', sourceName: '', selectedNodes: [], importMode: 'merge' }
let restoreFlowData = { backupIndex: 0 }

/**
 * 显示弹窗
 */
function showBookmarkModal(title, stepText) {
  document.getElementById('bookmarkModalTitle').textContent = title
  document.getElementById('bookmarkModalStep').textContent = stepText || ''
  document.getElementById('bookmarkModal').style.display = 'flex'
}

/**
 * 关闭弹窗
 */
function closeBookmarkModal() {
  document.getElementById('bookmarkModal').style.display = 'none'
  document.getElementById('bookmarkModalContent').innerHTML = ''
  document.getElementById('bookmarkModalInfo').textContent = ''
  modalCurrentFlow = ''
  importFlowData = { html: '', sourceName: '', selectedNodes: [], importMode: 'merge' }
}

/**
 * 渲染书签树（带复选框）
 * @param {Array} nodes - 书签节点数组
 * @param {HTMLElement} container - 容器
 * @param {number} level - 缩进层级
 */
function renderBookmarkTree(nodes, container, level = 0) {
  for (const node of nodes) {
    const isFolder = !node.url
    const itemDiv = document.createElement('div')
    itemDiv.style.cssText = `padding:4px 0;padding-left:${level * 20}px;`

    // 复选框
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.style.cssText = 'margin-right:6px;vertical-align:middle;'
    checkbox.dataset.nodeId = node.id || node.url
    checkbox.dataset.isFolder = isFolder

    // 类型标记（SVG 图标，极客风格）
    const icon = document.createElement('span')
    icon.style.cssText = 'margin-right:6px;display:inline-flex;align-items:center;vertical-align:middle;'
    if (isFolder) {
      icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5z" stroke="#64B5F6" stroke-width="1.2" stroke-linejoin="round" fill="rgba(100,181,246,0.1)"/></svg>'
    } else {
      icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M4 1.5h5.5a2 2 0 0 1 2 2V14.5L8 12l-3.5 2.5V1.5z" stroke="#4CAF50" stroke-width="1.2" stroke-linejoin="round" fill="rgba(76,175,80,0.1)"/></svg>'
    }

    // 标题
    const label = document.createElement('span')
    label.textContent = node.title || (isFolder ? '(无标题文件夹)' : node.url)
    label.style.cssText = `font-size:13px;cursor:pointer;${isFolder ? 'font-weight:500;color:#333;' : 'color:#555;'}`

    // 文件夹可展开/折叠
    if (isFolder && node.children && node.children.length > 0) {
      const toggle = document.createElement('span')
      toggle.style.cssText = 'display:inline-flex;width:20px;align-items:center;justify-content:center;cursor:pointer;color:#999;margin-right:2px;transition:transform 0.2s;'
      toggle.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,9 12,15 18,9"/></svg>'
      toggle.addEventListener('click', () => {
        const childContainer = itemDiv.querySelector('.children')
        if (childContainer) {
          const isHidden = childContainer.style.display === 'none'
          childContainer.style.display = isHidden ? 'block' : 'none'
          toggle.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)'
        }
      })
      itemDiv.appendChild(toggle)
    } else {
      const spacer = document.createElement('span')
      spacer.style.cssText = 'display:inline-block;width:20px;'
      itemDiv.appendChild(spacer)
    }

    itemDiv.appendChild(checkbox)
    itemDiv.appendChild(icon)
    itemDiv.appendChild(label)

    // 复选框联动：勾选文件夹 → 勾选所有子项
    checkbox.addEventListener('change', (e) => {
      const checked = e.target.checked
      // 勾选/取消所有子项
      const childCheckboxes = itemDiv.querySelectorAll('input[type="checkbox"]')
      childCheckboxes.forEach(cb => { cb.checked = checked })
      // 更新父文件夹状态
      updateParentFolderState(checkbox)
      updateSelectedCount()
    })

    container.appendChild(itemDiv)

    // 子节点
    if (isFolder && node.children && node.children.length > 0) {
      const childContainer = document.createElement('div')
      childContainer.className = 'children'
      childContainer.style.cssText = 'margin-left:10px;'
      itemDiv.appendChild(childContainer)
      renderBookmarkTree(node.children, childContainer, level + 1)
    }
  }
}

/**
 * 更新父文件夹的半选状态
 */
function updateParentFolderState(checkbox) {
  // 向上遍历，更新父文件夹状态
  let parent = checkbox.closest('.children')
  while (parent) {
    const parentItem = parent.previousElementSibling || parent.parentElement
    const parentCheckbox = parentItem?.querySelector(':scope > input[type="checkbox"]')
    if (parentCheckbox) {
      const allCheckboxes = parent.querySelectorAll('input[type="checkbox"]')
      const checkedCount = Array.from(allCheckboxes).filter(cb => cb.checked).length
      parentCheckbox.checked = checkedCount === allCheckboxes.length
      parentCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length
    }
    parent = parent.closest('.children')
  }
}

/**
 * 获取勾选的书签节点（递归）
 */
function getCheckedNodes(nodes) {
  const result = []
  for (const node of nodes) {
    const checkbox = document.querySelector(`input[data-node-id="${CSS.escape(node.id || node.url)}"]`)
    if (checkbox && checkbox.checked) {
      result.push(node)
    } else if (node.children) {
      // 部分勾选子节点
      const checkedChildren = getCheckedNodes(node.children)
      if (checkedChildren.length > 0) {
        result.push({ ...node, children: checkedChildren })
      }
    }
  }
  return result
}

/**
 * 更新已选数量显示
 */
function updateSelectedCount() {
  const checkboxes = document.querySelectorAll('#bookmarkModalContent input[type="checkbox"]')
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked && cb.dataset.isFolder === 'false').length
  document.getElementById('bookmarkModalInfo').textContent = `已选 ${checkedCount} 个书签`
}

// ============================================================
// 导出流程
// ============================================================
async function startExportFlow() {
  modalCurrentFlow = 'export'
  showBookmarkModal('导出书签', '')
  const content = document.getElementById('bookmarkModalContent')
  content.innerHTML = '<p style="font-size:13px;color:#999;">加载中...</p>'
  document.getElementById('bookmarkModalConfirm').textContent = '导出'
  document.getElementById('bookmarkModalConfirm').style.display = ''

  try {
    const tree = await chrome.bookmarks.getTree()
    content.innerHTML = ''
    // 全选/取消全选按钮
    const toolbar = document.createElement('div')
    toolbar.style.cssText = 'margin-bottom:10px;display:flex;gap:8px;'
    const selectAllBtn = document.createElement('button')
    selectAllBtn.className = 'btn-secondary'
    selectAllBtn.style.cssText = 'padding:4px 10px;font-size:12px;'
    selectAllBtn.textContent = '全选'
    selectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('#bookmarkModalContent input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.indeterminate = false })
      updateSelectedCount()
    })
    const deselectAllBtn = document.createElement('button')
    deselectAllBtn.className = 'btn-secondary'
    deselectAllBtn.style.cssText = 'padding:4px 10px;font-size:12px;'
    deselectAllBtn.textContent = '取消全选'
    deselectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('#bookmarkModalContent input[type="checkbox"]').forEach(cb => { cb.checked = false; cb.indeterminate = false })
      updateSelectedCount()
    })
    toolbar.appendChild(selectAllBtn)
    toolbar.appendChild(deselectAllBtn)
    content.appendChild(toolbar)

    const treeContainer = document.createElement('div')
    treeContainer.style.cssText = 'max-height:400px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:8px;'
    content.appendChild(treeContainer)
    renderBookmarkTree(tree[0].children || [], treeContainer)
    updateSelectedCount()
  } catch (e) {
    content.innerHTML = `<p style="color:#F44336;">加载失败：${e.message}</p>`
  }
}

async function doExport() {
  try {
    const tree = await chrome.bookmarks.getTree()
    const checkedNodes = getCheckedNodes(tree[0].children || [])
    if (checkedNodes.length === 0) {
      showStatus('请至少选择一个书签或文件夹', 'error')
      return
    }
    // 构建一个虚拟根节点，包含勾选的内容
    const exportTree = [{ id: '0', title: '书签', children: checkedNodes }]
    const html = await chrome.runtime.sendMessage({ type: 'serializeBookmarks', nodes: exportTree })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookmarks-${new Date().toISOString().slice(0, 10)}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    closeBookmarkModal()
    showStatus('书签已导出', 'success')
  } catch (e) {
    showStatus('导出失败：' + e.message, 'error')
  }
}

// ============================================================
// 导入流程（三步：来源→勾选→模式）
// ============================================================
function startImportFlow() {
  modalCurrentFlow = 'import-step1'
  showBookmarkModal('导入书签', '第 1 步 / 共 3 步')
  const content = document.getElementById('bookmarkModalContent')
  document.getElementById('bookmarkModalConfirm').style.display = 'none'
  document.getElementById('bookmarkModalInfo').textContent = ''

  content.innerHTML = `
    <div style="padding:20px 0;">
      <p style="font-size:14px;margin-bottom:16px;color:#333;">选择导入来源：</p>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <button class="btn-secondary" id="importLocalFileBtn" style="padding:12px;text-align:left;border-color:#2196F3;display:flex;align-items:center;gap:10px;">
          <svg viewBox="0 0 16 16" width="20" height="20" fill="none" style="flex-shrink:0;">
            <path d="M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5z" stroke="#2196F3" stroke-width="1.2" stroke-linejoin="round" fill="rgba(33,150,243,0.1)"/>
          </svg>
          <div>
            <div style="font-size:13px;font-weight:500;color:#2196F3;">本地文件</div>
            <div style="font-size:12px;color:#999;margin-top:2px;">从本地 HTML 文件导入</div>
          </div>
        </button>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="importUrlInput" placeholder="输入书签 HTML 直链..." style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:monospace;">
          <button class="btn-secondary" id="importUrlPasteBtn" style="padding:10px 12px;white-space:nowrap;font-size:13px;display:flex;align-items:center;gap:6px;">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <rect x="4" y="2" width="8" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>
              <path d="M5 5H4.5a1.5 1.5 0 0 0-1.5 1.5v7a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 11.5 5H11" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            粘贴
          </button>
          <button class="btn-primary" id="importUrlBtn" style="padding:10px 16px;white-space:nowrap;font-size:13px;">下载导入</button>
        </div>
      </div>
    </div>
  `

  document.getElementById('importLocalFileBtn').addEventListener('click', () => {
    document.getElementById('importBookmarksFile').click()
  })

  document.getElementById('importUrlPasteBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      document.getElementById('importUrlInput').value = text
    } catch (e) {
      showStatus('无法读取剪切板，请手动粘贴', 'error')
    }
  })

  document.getElementById('importUrlBtn').addEventListener('click', async () => {
    const url = document.getElementById('importUrlInput').value.trim()
    if (!url) {
      showStatus('请输入链接', 'error')
      return
    }
    try {
      showStatus('正在下载...', 'loading')
      const response = await fetch(url)
      const text = await response.text()
      importFlowData.html = text
      importFlowData.sourceName = url
      closeBookmarkModal()
      showImportStep2()
      showStatus('下载成功，请选择要导入的书签', 'success')
    } catch (e) {
      showStatus('下载失败：' + e.message, 'error')
    }
  })
}

async function showImportStep2() {
  modalCurrentFlow = 'import-step2'
  showBookmarkModal('导入书签', '第 2 步 / 共 3 步')
  const content = document.getElementById('bookmarkModalContent')
  content.innerHTML = '<p style="font-size:13px;color:#999;">解析中...</p>'
  document.getElementById('bookmarkModalConfirm').textContent = '下一步'
  document.getElementById('bookmarkModalConfirm').style.display = ''

  try {
    // 解析 HTML 为书签树
    const items = await chrome.runtime.sendMessage({ type: 'parseBookmarksHtml', html: importFlowData.html })
    if (!items || items.length === 0) {
      content.innerHTML = '<p style="color:#F44336;">文件中没有找到书签</p>'
      return
    }
    // 按文件夹分组构建树
    const tree = buildTreeFromItems(items)
    content.innerHTML = ''

    // 全选/取消全选
    const toolbar = document.createElement('div')
    toolbar.style.cssText = 'margin-bottom:10px;display:flex;gap:8px;'
    const selectAllBtn = document.createElement('button')
    selectAllBtn.className = 'btn-secondary'
    selectAllBtn.style.cssText = 'padding:4px 10px;font-size:12px;'
    selectAllBtn.textContent = '全选'
    selectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('#bookmarkModalContent input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.indeterminate = false })
      updateSelectedCount()
    })
    const deselectAllBtn = document.createElement('button')
    deselectAllBtn.className = 'btn-secondary'
    deselectAllBtn.style.cssText = 'padding:4px 10px;font-size:12px;'
    deselectAllBtn.textContent = '取消全选'
    deselectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('#bookmarkModalContent input[type="checkbox"]').forEach(cb => { cb.checked = false; cb.indeterminate = false })
      updateSelectedCount()
    })
    toolbar.appendChild(selectAllBtn)
    toolbar.appendChild(deselectAllBtn)
    content.appendChild(toolbar)

    const sourceInfo = document.createElement('p')
    sourceInfo.style.cssText = 'font-size:12px;color:#999;margin-bottom:8px;'
    sourceInfo.textContent = `来源：${importFlowData.sourceName}，共 ${items.length} 个书签`
    content.appendChild(sourceInfo)

    const treeContainer = document.createElement('div')
    treeContainer.style.cssText = 'max-height:350px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:8px;'
    content.appendChild(treeContainer)
    renderBookmarkTree(tree, treeContainer)
    updateSelectedCount()
  } catch (e) {
    content.innerHTML = `<p style="color:#F44336;">解析失败：${e.message}</p>`
  }
}

/**
 * 保存导入勾选状态（step2 确认时调用）
 */
async function saveImportSelection() {
  try {
    const items = await chrome.runtime.sendMessage({ type: 'parseBookmarksHtml', html: importFlowData.html })
    // 遍历树，获取勾选的书签
    const selectedItems = []
    const collectChecked = (nodes, folderPath) => {
      for (const node of nodes) {
        const checkbox = document.querySelector(`input[data-node-id="${CSS.escape(node.id)}"]`)
        const isChecked = checkbox?.checked
        const isIndeterminate = checkbox?.indeterminate
        if (node.url) {
          // 书签
          if (isChecked) {
            selectedItems.push({ title: node.title, url: node.url, folder: folderPath })
          }
        } else {
          // 文件夹
          const newFolderPath = folderPath ? folderPath + '/' + node.title : node.title
          if (isChecked && !isIndeterminate) {
            // 整个文件夹勾选，收集所有子书签
            const collectAll = (children, fp) => {
              for (const child of children) {
                if (child.url) {
                  selectedItems.push({ title: child.title, url: child.url, folder: fp })
                } else if (child.children) {
                  collectAll(child.children, fp ? fp + '/' + child.title : child.title)
                }
              }
            }
            collectAll(node.children || [], newFolderPath)
          } else if (node.children) {
            collectChecked(node.children, newFolderPath)
          }
        }
      }
    }
    // 重新构建树并遍历
    const tree = buildTreeFromItems(items)
    collectChecked(tree, '')
    importFlowData.selectedItems = selectedItems
    importFlowData.selectedCount = selectedItems.length
  } catch (e) {
    console.warn('保存勾选状态失败:', e)
  }
}

function showImportStep3() {
  modalCurrentFlow = 'import-step3'
  showBookmarkModal('导入书签', '第 3 步 / 共 3 步')
  const content = document.getElementById('bookmarkModalContent')
  document.getElementById('bookmarkModalConfirm').textContent = '确认导入'
  document.getElementById('bookmarkModalInfo').textContent = ''

  // 统计勾选数量
  const checkboxes = document.querySelectorAll('#bookmarkModalContent input[type="checkbox"]')
  // 注意：此时内容已经被替换，需要重新获取勾选的节点
  // 我们在 step2 时已经渲染了树，但 step3 替换了内容，所以需要重新解析
  // 简化：在 step2 确认时保存勾选的 items
  // 这里重新解析并获取勾选
  // 和同步文件夹选择用同一个数据源（getFolders），保持一致
  ;(async () => {
    try {
      const folders = await chrome.runtime.sendMessage({ type: 'getFolders' })

      content.innerHTML = `
        <div style="padding:20px 0;">
          <p style="font-size:14px;margin-bottom:12px;font-weight:500;">选择导入模式：</p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
            <label style="display:flex;gap:10px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer;align-items:flex-start;">
              <input type="radio" name="importMode" value="merge" checked style="margin-top:3px;">
              <div>
                <div style="font-size:14px;font-weight:500;">合并式导入</div>
                <div style="font-size:12px;color:#999;margin-top:2px;">保留现有书签，将勾选的书签新增到本地</div>
              </div>
            </label>
            <label style="display:flex;gap:10px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer;align-items:flex-start;">
              <input type="radio" name="importMode" value="overwrite" style="margin-top:3px;">
              <div>
                <div style="font-size:14px;font-weight:500;">覆盖式导入</div>
                <div style="font-size:12px;color:#999;margin-top:2px;">先自动备份 → 清空本地所有书签 → 导入勾选的书签</div>
              </div>
            </label>
          </div>
          <p style="font-size:14px;margin-bottom:12px;font-weight:500;">导入到：</p>
          <div style="margin-bottom:12px;">
            <select id="importTargetFolder" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
              ${folders.map(f => `<option value="${f.id}">${'　'.repeat(f.depth)}${f.title || '(未命名)'}</option>`).join('')}
            </select>
          </div>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:#666;cursor:pointer;margin-bottom:12px;">
            <input type="checkbox" id="importNewFolder">
            <span>新建文件夹（在所选目录下创建）</span>
          </label>
          <div id="importNewFolderInput" style="display:none;margin-bottom:16px;">
            <input type="text" id="importNewFolderName" placeholder="输入新文件夹名称" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
          </div>
          <p style="font-size:12px;color:#999;margin-top:16px;">将导入 ${importFlowData.selectedCount || 0} 个书签</p>
        </div>
      `
      document.getElementById('importNewFolder').addEventListener('change', (e) => {
        document.getElementById('importNewFolderInput').style.display = e.target.checked ? 'block' : 'none'
      })
    } catch (e) {
      content.innerHTML = `<p style="color:#F44336;">加载文件夹列表失败：${e.message}</p>`
    }
  })()
}

async function doImport() {
  try {
    const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge'
    const selectedItems = importFlowData.selectedItems || []
    if (selectedItems.length === 0) {
      showStatus('请至少选择一个书签', 'error')
      return
    }
    // 获取目标文件夹
    const targetFolderId = document.getElementById('importTargetFolder')?.value || '1'
    const newFolderChecked = document.getElementById('importNewFolder')?.checked
    const newFolderName = document.getElementById('importNewFolderName')?.value?.trim()
    if (newFolderChecked && !newFolderName) {
      showStatus('请输入新文件夹名称', 'error')
      return
    }
    const result = await chrome.runtime.sendMessage({
      type: 'importBookmarksItems',
      items: selectedItems,
      mode,
      targetFolderId,
      newFolderName: newFolderChecked ? newFolderName : null,
    })
    if (result && result.success) {
      closeBookmarkModal()
      showStatus(`导入成功，共导入 ${result.count} 个书签`, 'success')
    } else {
      showStatus('导入失败：' + (result?.error || '未知错误'), 'error')
    }
  } catch (e) {
    showStatus('导入失败：' + e.message, 'error')
  }
}

/**
 * 从扁平的 items 数组构建书签树
 */
function buildTreeFromItems(items) {
  const root = []
  const folderMap = new Map() // folderPath -> node

  for (const item of items) {
    const folderPath = item.folder || ''
    if (!folderPath) {
      root.push({ id: 'root-' + item.url, title: item.title, url: item.url })
    } else {
      const parts = folderPath.split('/').filter(p => p.trim())
      let currentPath = ''
      let parentChildren = root
      for (const part of parts) {
        currentPath = currentPath ? currentPath + '/' + part : part
        if (!folderMap.has(currentPath)) {
          const folderNode = { id: 'folder-' + currentPath, title: part, children: [] }
          folderMap.set(currentPath, folderNode)
          parentChildren.push(folderNode)
        }
        parentChildren = folderMap.get(currentPath).children
      }
      parentChildren.push({ id: 'bm-' + item.url, title: item.title, url: item.url })
    }
  }
  return root
}

// ============================================================
// 一键清空本地书签
// ============================================================
function showClearConfirm() {
  modalCurrentFlow = 'clear'
  showBookmarkModal('一键清空本地书签', '')
  const content = document.getElementById('bookmarkModalContent')
  document.getElementById('bookmarkModalConfirm').textContent = '确认清空'
  document.getElementById('bookmarkModalConfirm').style.display = ''
  document.getElementById('bookmarkModalInfo').textContent = ''

  content.innerHTML = `
    <div style="padding:20px 0;text-align:center;">
      <div style="margin-bottom:16px;">
        <svg viewBox="0 0 48 48" width="56" height="56" fill="none">
          <path d="M24 6L4 40h40L24 6z" fill="rgba(244,67,54,0.1)" stroke="#F44336" stroke-width="2.5" stroke-linejoin="round"/>
          <line x1="24" y1="18" x2="24" y2="30" stroke="#F44336" stroke-width="3" stroke-linecap="round"/>
          <circle cx="24" cy="36" r="2" fill="#F44336"/>
        </svg>
      </div>
      <p style="font-size:15px;font-weight:500;margin-bottom:12px;color:#333;">确定要清空所有本地书签吗？</p>
      <p style="font-size:13px;color:#666;line-height:1.8;">
        清空前会自动备份当前书签（保留最近 5 份）<br>
        清空后书签栏和其他书签的所有内容将被删除<br>
        <span style="color:#F44336;font-weight:500;">此操作不可直接撤销，但可从备份恢复</span>
      </p>
    </div>
  `
}

async function doClear() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'clearAllBookmarks' })
    if (result && result.success) {
      closeBookmarkModal()
      showStatus(`已清空本地书签（已备份 ${result.backupCount} 个书签）`, 'success')
    } else {
      showStatus('清空失败：' + (result?.error || '未知错误'), 'error')
    }
  } catch (e) {
    showStatus('清空失败：' + e.message, 'error')
  }
}

// ============================================================
// 首次同步
// ============================================================

/**
 * 显示首次同步方向选择模态框
 */
function showFirstSyncModal(detect) {
  const modal = document.getElementById('firstSyncModal')
  // 更新选项描述，显示具体数量
  const localOption = document.getElementById('chooseLocal')
  localOption.querySelector('.option-desc').textContent =
    `用本地 ${detect.localCount} 个书签替换云端 ${detect.serverCount} 个书签，云端原有内容会被覆盖`
  const serverOption = document.getElementById('chooseServer')
  serverOption.querySelector('.option-desc').textContent =
    `用云端 ${detect.serverCount} 个书签替换本地 ${detect.localCount} 个书签，同步前会自动备份本地书签`
  modal.classList.add('show')
}

/**
 * 执行首次同步
 * @param {string} strategy local/server/merge
 */
async function runFirstSync(strategy) {
  // 关闭模态框
  document.getElementById('firstSyncModal').classList.remove('show')

  const strategyText = {
    local: '本地上传云端',
    server: '云端覆盖本地',
    merge: '双向合并',
  }[strategy]

  showStatus(`正在执行首次同步（${strategyText}），请稍候...`, 'loading')

  try {
    const result = await chrome.runtime.sendMessage({ type: 'firstSync', strategy })

    if (result && result.error) {
      showStatus('首次同步失败：' + result.error + '。请检查配置后重新保存。', 'error')
    } else {
      showStatus(`首次同步成功（${strategyText}）！之后将使用多设备智能同步自动同步。`, 'success')
      // 刷新备份和日志
      loadBackups()
      loadSyncLogs()
    }
  } catch (e) {
    showStatus('首次同步异常：' + e.message, 'error')
  }
}

// ============================================================
// 备份管理
// ============================================================
async function loadBackups() {
  const container = document.getElementById('backupList')
  try {
    const backups = await chrome.runtime.sendMessage({ type: 'getBackups' })
    if (!backups || backups.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:#999;">暂无备份，同步后自动生成</p>'
      return
    }

    let html = ''
    backups.forEach((backup, index) => {
      const date = new Date(backup.timestamp)
      const timeStr = date.toLocaleString('zh-CN')
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
          <div>
            <div style="font-size:13px;color:#333;">${timeStr}</div>
            <div style="font-size:12px;color:#999;">${backup.bookmarkCount} 个书签</div>
          </div>
          <button class="btn-secondary restore-backup-btn" data-index="${index}" style="padding:6px 12px;font-size:12px;">恢复</button>
        </div>
      `
    })
    container.innerHTML = html

    // 绑定恢复按钮事件（MV3 CSP 禁止内联 onclick，必须用 addEventListener）
    container.querySelectorAll('.restore-backup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10)
        restoreBackup(idx)
      })
    })
  } catch (e) {
    container.innerHTML = '<p style="font-size:13px;color:#F44336;">加载失败</p>'
  }
}

// 恢复备份：点击按钮后弹出模态框，复用导入书签的弹窗逻辑（选择模式+目标文件夹）
function restoreBackup(index) {
  showRestoreModal(index)
}

/**
 * 显示恢复备份的模态框（复用导入书签第三步的 UI：选择模式 + 目标文件夹）
 */
function showRestoreModal(backupIndex) {
  modalCurrentFlow = 'restore'
  restoreFlowData.backupIndex = backupIndex
  showBookmarkModal('恢复备份', '')
  const content = document.getElementById('bookmarkModalContent')
  document.getElementById('bookmarkModalConfirm').textContent = '确认恢复'
  document.getElementById('bookmarkModalConfirm').style.display = ''
  document.getElementById('bookmarkModalInfo').textContent = ''

  ;(async () => {
    try {
      const backups = await chrome.runtime.sendMessage({ type: 'getBackups' })
      const backup = backups[backupIndex]
      if (!backup) {
        content.innerHTML = '<p style="color:#F44336;">备份不存在</p>'
        return
      }
      const folders = await chrome.runtime.sendMessage({ type: 'getFolders' })
      const date = new Date(backup.timestamp)
      const timeStr = date.toLocaleString('zh-CN')

      content.innerHTML = `
        <div style="padding:20px 0;">
          <div style="background:#f5f5f5;padding:12px 16px;border-radius:8px;margin-bottom:20px;">
            <div style="font-size:14px;font-weight:500;margin-bottom:6px;">备份信息</div>
            <div style="font-size:13px;color:#666;line-height:1.6;">
              <div>时间：${timeStr}</div>
              <div>书签数量：${backup.bookmarkCount} 个</div>
            </div>
          </div>
          <p style="font-size:14px;margin-bottom:12px;font-weight:500;">选择恢复模式：</p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
            <label style="display:flex;gap:10px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer;align-items:flex-start;">
              <input type="radio" name="restoreMode" value="merge" checked style="margin-top:3px;">
              <div>
                <div style="font-size:14px;font-weight:500;">合并式恢复</div>
                <div style="font-size:12px;color:#999;margin-top:2px;">保留现有书签，将备份中的书签新增到目标文件夹</div>
              </div>
            </label>
            <label style="display:flex;gap:10px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer;align-items:flex-start;">
              <input type="radio" name="restoreMode" value="overwrite" style="margin-top:3px;">
              <div>
                <div style="font-size:14px;font-weight:500;">覆盖式恢复</div>
                <div style="font-size:12px;color:#999;margin-top:2px;">先自动备份 → 清空目标文件夹 → 恢复备份中的书签</div>
              </div>
            </label>
          </div>
          <p style="font-size:14px;margin-bottom:12px;font-weight:500;">恢复到：</p>
          <div style="margin-bottom:12px;">
            <select id="restoreTargetFolder" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
              ${folders.map(f => `<option value="${f.id}">${'　'.repeat(f.depth)}${f.title || '(未命名)'}</option>`).join('')}
            </select>
          </div>
        </div>
      `
    } catch (e) {
      content.innerHTML = `<p style="color:#F44336;">加载失败：${e.message}</p>`
    }
  })()
}

/**
 * 执行恢复备份（复用导入书签的逻辑）
 */
async function doRestore() {
  try {
    const mode = document.querySelector('input[name="restoreMode"]:checked')?.value || 'merge'
    const targetFolderId = document.getElementById('restoreTargetFolder')?.value || '1'
    const backupIndex = restoreFlowData.backupIndex

    const result = await chrome.runtime.sendMessage({
      type: 'restoreBackup',
      index: backupIndex,
      localRoot: targetFolderId,
      mode: mode,
    })

    closeBookmarkModal()
    if (result.error) {
      showStatus('恢复失败：' + result.error, 'error')
    } else {
      showStatus(`恢复成功！共恢复 ${result.imported} 个书签`, 'success')
      loadBackups()
      loadSyncLogs()
    }
  } catch (e) {
    showStatus('恢复失败：' + e.message, 'error')
  }
}

// 暴露到全局，供事件绑定调用
window.restoreBackup = restoreBackup

// ============================================================
// 同步日志
// ============================================================
async function loadSyncLogs() {
  const container = document.getElementById('logList')
  try {
    const logs = await chrome.runtime.sendMessage({ type: 'getSyncLogs' })
    if (!logs || logs.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:#999;">暂无同步记录</p>'
      return
    }

    const strategyNames = {
      merge: '多设备智能同步',
      local: '本地覆盖云端',
      server: '云端覆盖本地',
      '导出书签': '导出书签',
      '合并式导入': '合并式导入',
      '覆盖式导入': '覆盖式导入',
      '一键清空': '一键清空',
    }

    let html = ''
    logs.forEach(log => {
      const date = new Date(log.timestamp)
      const timeStr = date.toLocaleString('zh-CN')
      const statusColor = log.success ? '#4CAF50' : '#F44336'
      const statusText = log.success ? '成功' : '失败'
      const strategy = strategyNames[log.strategy] || log.strategy

      let detail = ''
      if (log.success) {
        if (log.strategy === '导出书签') {
          detail = `导出 ${log.added} 个书签`
        } else if (log.strategy === '合并式导入') {
          detail = `导入 ${log.added} 个书签（保留现有）`
        } else if (log.strategy === '覆盖式导入') {
          detail = `导入 ${log.added} 个书签（已清空并备份）`
        } else if (log.strategy === '一键清空') {
          detail = `清空 ${log.removed} 个书签（已自动备份）`
        } else {
          detail = `新增 ${log.added}，删除 ${log.removed}，冲突 ${log.conflicts}`
        }
      } else {
        detail = log.error || '未知错误'
      }

      html += `
        <div style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:13px;color:${statusColor};font-weight:500;">${statusText}</span>
            <span style="font-size:12px;color:#999;">${strategy}</span>
          </div>
          <div style="font-size:12px;color:#666;margin-bottom:2px;">${timeStr}</div>
          <div style="font-size:12px;color:#999;">${detail}</div>
        </div>
      `
    })
    container.innerHTML = html
  } catch (e) {
    container.innerHTML = '<p style="font-size:13px;color:#F44336;">加载失败</p>'
  }
}

/**
 * 应用深色模式
 */
/**
 * 更新加密密钥强度提示
 */
function updatePassphraseStrength(passphrase) {
  const el = document.getElementById('passphraseStrength')
  if (!passphrase) {
    el.textContent = ''
    return
  }
  let score = 0
  if (passphrase.length >= 8) score++
  if (passphrase.length >= 12) score++
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) score++
  if (/\d/.test(passphrase)) score++
  if (/[^a-zA-Z0-9]/.test(passphrase)) score++

  if (score <= 2) {
    el.textContent = '密钥强度：弱（建议包含大小写字母、数字和符号）'
    el.style.color = '#e74c3c'
  } else if (score <= 3) {
    el.textContent = '密钥强度：中'
    el.style.color = '#f39c12'
  } else {
    el.textContent = '密钥强度：强'
    el.style.color = '#27ae60'
  }
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status')
  statusEl.style.display = '' // 清除之前设置的内联 display:none
  statusEl.textContent = message
  statusEl.className = 'status ' + type

  if (type === 'success') {
    setTimeout(() => {
      statusEl.style.display = 'none'
    }, 3000)
  }
}
