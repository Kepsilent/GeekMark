/**
 * 后台服务脚本
 * 负责：同步触发 + 同步逻辑
 *
 * 同步触发逻辑改编自 Floccus 的 BrowserController.js (MIT License)
 * Copyright (c) Floccus 贡献者
 */

import WebDavAdapter from './adapters/webdav.js'
import htmlSerializer from './serializers/html.js'

// ============================================================
// 常量
// ============================================================
const INACTIVITY_TIMEOUT = 3 * 1000  // 防抖 3 秒
const DEFAULT_SYNC_INTERVAL = 15      // 默认同步间隔 15 分钟
const ALARM_NAME = 'bookmark-sync'
const DEBOUNCE_ALARM = 'bookmark-sync-debounce'  // 防抖兜底闹钟，防止 Service Worker 被回收后定时器丢失
const CHANGE_LOG_FILE = 'changes.json'  // 多设备变更日志文件名
const MAX_CHANGE_LOG_ENTRIES = 1000    // 变更日志最大保留条数
const CHANGE_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000  // 变更日志保留90天
const CONCURRENT_CHANGES = 5  // 应用变更时的并发数

// ============================================================
// 状态管理
// ============================================================
let recentRemovalTimestamps = [] // 最近删除事件的时间戳，用于批量删除检测
let syncQueued = false // 同步队列标记：同步中又触发同步时，等当前完成后再执行一次
const operatingIds = new Set() // 正在被同步操作修改的书签ID白名单：在里面的变更是同步产生的，忽略；不在里面的是用户修改，记录

/**
 * 标记书签ID正在被同步操作修改（加入白名单，变更事件将被忽略）
 */
function markOperating(id) {
  if (id) operatingIds.add(id)
}

/**
 * 取消标记书签ID（从白名单移除）
 */
function unmarkOperating(id) {
  if (id) operatingIds.delete(id)
}

/**
 * 递归标记文件夹及其所有子节点（用于删除文件夹时，忽略里面所有书签的删除事件）
 */
function markOperatingTree(node) {
  if (!node) return
  markOperating(node.id)
  if (node.children) {
    node.children.forEach(markOperatingTree)
  }
}

/**
 * 延迟取消标记（用于新增书签，created事件是异步触发的）
 */
function unmarkOperatingDelayed(id, delay = 1500) {
  setTimeout(() => unmarkOperating(id), delay)
}
let syncState = {
  syncing: false,
  currentPhase: '', // 当前同步阶段：downloading/merging/applying/uploading/done
  lastSync: null,
  lastError: null,
  lastStats: null, // {added, removed, conflicts}
  lastConflicts: null, // [{url, localTitle, serverTitle}] 最近一次同步的冲突详情
  lastUploadHash: null, // 上次成功上传的书签内容 hash，用于跳过无变化上传
}

/**
 * 从 chrome.storage.local 加载持久化的同步状态
 * （syncing 不持久化，Service Worker 重启后同步必然已结束）
 */
async function loadSyncState() {
  try {
    const stored = await chrome.storage.local.get(['lastSync', 'lastError', 'lastStats', 'lastConflicts', 'lastUploadHash'])
    if (stored.lastSync) syncState.lastSync = stored.lastSync
    if (stored.lastError) syncState.lastError = stored.lastError
    if (stored.lastStats) syncState.lastStats = stored.lastStats
    if (stored.lastConflicts) syncState.lastConflicts = stored.lastConflicts
    if (stored.lastUploadHash) syncState.lastUploadHash = stored.lastUploadHash
  } catch (e) {
    console.warn('[Webdav-BookmarkSync] 加载同步状态失败:', e)
  }
}

/**
 * 将 lastSync / lastError / lastStats 持久化到 storage
 */
async function saveSyncState() {
  try {
    await chrome.storage.local.set({
      lastSync: syncState.lastSync,
      lastError: syncState.lastError,
      lastStats: syncState.lastStats,
      lastConflicts: syncState.lastConflicts,
      lastUploadHash: syncState.lastUploadHash,
    })
  } catch (e) {
    console.warn('[Webdav-BookmarkSync] 保存同步状态失败:', e)
  }
}

// Service Worker 启动时恢复上次同步状态
loadSyncState()

// ============================================================
// 设备ID（每台设备唯一不变，用于变更日志标识）
// ============================================================
let deviceIdCache = null

async function getDeviceId() {
  if (deviceIdCache) return deviceIdCache
  try {
    const stored = await chrome.storage.local.get('deviceId')
    if (stored.deviceId) {
      deviceIdCache = stored.deviceId
      return deviceIdCache
    }
    // 生成 UUID v4
    deviceIdCache = crypto.randomUUID()
    await chrome.storage.local.set({ deviceId: deviceIdCache })
    console.log('[极客云签] 生成新设备ID:', deviceIdCache)
    return deviceIdCache
  } catch (e) {
    console.warn('[极客云签] 获取设备ID失败:', e)
    return 'unknown-device'
  }
}

// ============================================================
// 本地变更记录（pendingChanges）
// 记录用户在本设备做的书签/文件夹变更，同步成功后标记为已同步
// ============================================================
let pendingChangesCache = null

async function loadPendingChanges() {
  if (pendingChangesCache) return pendingChangesCache
  try {
    const stored = await chrome.storage.local.get('pendingChanges')
    pendingChangesCache = stored.pendingChanges || []
  } catch (e) {
    console.warn('[极客云签] 加载本地变更记录失败:', e)
    pendingChangesCache = []
  }
  return pendingChangesCache
}

async function savePendingChanges() {
  try {
    await chrome.storage.local.set({ pendingChanges: pendingChangesCache || [] })
  } catch (e) {
    console.warn('[极客云签] 保存本地变更记录失败:', e)
  }
}

/**
 * 添加一条本地变更记录
 */
async function addPendingChange(type, payload) {
  await loadPendingChanges()
  const deviceId = await getDeviceId()
  const change = {
    id: crypto.randomUUID(),
    type: type,
    payload: payload,
    timestamp: Date.now(),
    deviceId: deviceId,
    synced: false,
  }
  pendingChangesCache.push(change)
  await savePendingChanges()
  console.log(`[极客云签] 记录变更: ${type}`, payload)
  return change
}

/**
 * 获取所有未同步的本地变更
 */
async function getUnsyncedChanges() {
  await loadPendingChanges()
  return pendingChangesCache.filter(c => !c.synced)
}

/**
 * 标记指定ID的变更为已同步
 */
async function markChangesSynced(ids) {
  await loadPendingChanges()
  const idSet = new Set(ids)
  pendingChangesCache = pendingChangesCache.map(c =>
    idSet.has(c.id) ? { ...c, synced: true } : c
  )
  // 清理已同步超过7天的本地记录（云端已保存，本地不需要长期存）
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  pendingChangesCache = pendingChangesCache.filter(c => !c.synced || c.timestamp > sevenDaysAgo)
  await savePendingChanges()
}

// 防止并发同步
let syncLock = false

// ============================================================
// 存储（带缓存）
// ============================================================
let settingsCache = null
let settingsCacheTime = 0
const SETTINGS_CACHE_TTL = 5000 // 5 秒缓存

async function getSettings() {
  const now = Date.now()
  if (settingsCache && (now - settingsCacheTime) < SETTINGS_CACHE_TTL) {
    return settingsCache
  }
  const defaults = {
    url: '',
    username: '',
    password: '',
    bookmark_file: 'bookmarks.html',
    webdav_folder: 'Bookmarks',  // WebDAV 目录下的文件夹名称
    localRoot: '1',  // 默认"书签栏"文件夹
    syncInterval: DEFAULT_SYNC_INTERVAL,
    syncOnStartupEnabled: true,
    syncIntervalEnabled: true,
    syncOnChangeEnabled: true,
    includeCredentials: false,
    syncStrategy: 'merge',  // merge: 多设备智能同步 / local: 本地覆盖云端 / server: 云端覆盖本地
    failsafeThreshold: 50,  // 熔断阈值（百分比），本次删除超过此比例则中止同步，防止数据丢失
    encryptionPassphrase: '',  // 端到端加密密钥，为空表示不加密
    notifyOnSuccess: true,   // 同步成功时通知（默认开）
    notifyOnFailure: true,   // 同步失败时通知（默认开）
    syncPaused: false,       // 暂停同步：开启后定时/启动/变更同步都暂停，手动同步仍可用
    darkMode: 'auto',        // 深色模式：auto=跟随系统 / light=浅色 / dark=深色
  }
  const stored = await chrome.storage.sync.get(defaults)
  settingsCache = { ...defaults, ...stored }
  settingsCacheTime = now
  return settingsCache
}

async function setSettings(settings) {
  await chrome.storage.sync.set(settings)
  // 直接更新缓存，确保后续读取是最新值（避免清除缓存后立即读取到旧值）
  settingsCache = { ...(settingsCache || {}), ...settings }
  settingsCacheTime = Date.now()
  // 暂停状态变化时更新 badge
  if (settings.syncPaused === true) {
    updateBadge('paused')
  } else if (settings.syncPaused === false) {
    // 恢复时根据最近同步状态更新 badge
    if (syncState.lastError) {
      updateBadge('error')
    } else {
      updateBadge('allgood')
    }
  }
}

// ============================================================
// 同步调度（防抖，改编自 Floccus）
// ============================================================
let syncTimeout = null

function scheduleSync(wait = true, customDelay = null) {
  // 暂停同步时，所有自动同步都跳过（手动同步仍可通过消息直接调用 syncAccount）
  if (settingsCache && settingsCache.syncPaused) {
    console.log('[极客云签] 同步已暂停，跳过自动同步')
    return
  }
  // 同步锁：如果正在同步，标记需要再同步一次（等当前完成后执行）
  if (syncState.syncing && wait) {
    syncQueued = true
    console.log('[极客云签] 同步进行中，已排队等待下次同步')
    return
  }
  if (wait) {
    if (syncTimeout) {
      clearTimeout(syncTimeout)
    }
    // 批量删除检测：最近5秒内删除超过10个，延长防抖到10秒
    const now = Date.now()
    recentRemovalTimestamps = recentRemovalTimestamps.filter(t => now - t < 5000)
    let delay = customDelay || INACTIVITY_TIMEOUT
    if (recentRemovalTimestamps.length >= 10) {
      delay = 10 * 1000 // 批量删除，延长到10秒
      console.log(`[极客云签] 检测到批量删除（${recentRemovalTimestamps.length}个），防抖延长到10秒`)
    }
    syncTimeout = setTimeout(() => scheduleSync(false), delay)
    // 兜底：创建 1 分钟后的一次性 alarm
    // MV3 Service Worker 可能被回收，setTimeout 会丢失，alarm 能唤醒 Service Worker 确保同步执行
    try {
      chrome.alarms.create(DEBOUNCE_ALARM, { delayInMinutes: 1 })
    } catch (e) {
      console.warn('[极客云签] 创建兜底 alarm 失败:', e)
    }
    return
  }
  // 防抖到期，清除兜底 alarm，执行同步
  try {
    chrome.alarms.clear(DEBOUNCE_ALARM)
  } catch (e) {}
  syncAccount()
}

// ============================================================
// 核心同步逻辑
// ============================================================
/**
 * 执行同步
 * @param {string|null} overrideStrategy 临时覆盖同步策略（用于首次同步），不修改已保存的设置
 */
async function syncAccount(overrideStrategy = null) {
  // 防止并发
  if (syncLock) {
    console.log('[Webdav-BookmarkSync] 正在同步中，跳过')
    return
  }

  const settings = await getSettings()

  if (!settings.url || !settings.username || !settings.password) {
    console.log('[Webdav-BookmarkSync] 设置不完整，跳过同步')
    syncState.lastError = '尚未配置 WebDAV 服务器，请先完成设置'
    await saveSyncState()
    return
  }

  syncLock = true
  syncState.syncing = true
  syncState.lastError = null
  updateBadge('syncing')

  try {
    const adapter = new WebDavAdapter(settings)

    // 1. 获取选中的书签文件夹
    const allTree = await chrome.bookmarks.getTree()
    const selectedFolder = findFolderById(allTree, settings.localRoot)

    if (!selectedFolder) {
      throw new Error('找不到选中的书签文件夹，请重新选择')
    }

    // 确保 WebDAV 文件夹存在（不存在则创建）
    await adapter.createFolder()

    // 同步前收集本地书签信息（用于统计）
    const localMap = collectBookmarkInfo(selectedFolder)
    console.log(`[Webdav-BookmarkSync] 本地书签数量：${localMap.size}`)

    let mergeStats = { added: 0, removed: 0, conflicts: 0 }
    const strategy = overrideStrategy || settings.syncStrategy || 'merge'
    if (overrideStrategy) {
      console.log(`[Webdav-BookmarkSync] 首次同步，临时使用策略：${strategy}`)
    }

    if (strategy === 'local') {
      // ============================================================
      // 策略：本地覆盖云端 — 直接上传，不下载不合并
      // ============================================================
      console.log('[极客云签] 策略：本地覆盖云端')
      const html = htmlSerializer.serialize([selectedFolder])
      const contentHash = await computeContentHash(html)
      if (contentHash && contentHash === syncState.lastUploadHash) {
        console.log('[Webdav-BookmarkSync] 书签内容无变化，跳过上传')
      } else {
        await adapter.uploadFile(html)
        syncState.lastUploadHash = contentHash
      }
      // 统计：本地书签全部上传
      mergeStats.added = localMap.size
    } else if (strategy === 'server') {
      // ============================================================
      // 策略：云端覆盖本地 — 下载 → 清空本地 → 导入，不上传
      // ============================================================
      console.log('[极客云签] 策略：云端覆盖本地')
      const serverHtml = await adapter.downloadFile()

      if (serverHtml) {
        // 完整性校验：防止服务器文件损坏时覆盖本地
        const validation = htmlSerializer.validate(serverHtml)
        if (!validation.valid) {
          throw new Error(`服务器书签文件完整性校验失败：${validation.reason}。为保护本地数据，已中止覆盖。请检查服务器文件是否正常。`)
        }

        await backupBookmarks(selectedFolder)
        const serverItems = htmlSerializer.deserialize(serverHtml)

        // 清空本地选中文件夹下的所有内容
        const children = await chrome.bookmarks.getChildren(selectedFolder.id)
        for (const child of children) {
          await chrome.bookmarks.removeTree(child.id)
        }

        // 导入服务器书签
        let imported = 0
        for (const item of serverItems) {
          let parentId = selectedFolder.id
          if (item.folder) {
            const folderNames = item.folder.split('/').filter(n => n.trim())
            parentId = await ensureFolderExists(selectedFolder.id, folderNames)
          }
          try {
            await chrome.bookmarks.create({
              parentId,
              title: item.title,
              url: item.url,
            })
            imported++
          } catch (e) {
            console.warn(`[Webdav-BookmarkSync] 导入书签失败: ${item.title}`, e)
          }
        }
        mergeStats.added = imported
        console.log(`[Webdav-BookmarkSync] 从服务器导入 ${imported} 个书签`)
      } else {
        console.log('[Webdav-BookmarkSync] 服务器上没有书签文件，跳过')
      }
    } else {
      // ============================================================
      // 策略：多设备智能同步（默认）— 基于变更日志的多设备同步
      // 流程：下载 → 全量合并新增 → 应用云端变更 → 合并变更日志 → 上传
      // ============================================================
      console.log('[极客云签] 策略：多设备智能同步')
      syncState.currentPhase = 'downloading'

      // 1. 下载书签文件 + 变更日志
      const serverHtml = await adapter.downloadFile()
      let serverChangeLog = null
      try {
        serverChangeLog = await adapter.downloadChangeLog()
      } catch (e) {
        console.warn('[极客云签] 下载变更日志失败，将创建新的变更日志:', e.message)
      }
      const serverChanges = (serverChangeLog && serverChangeLog.changes) || []
      console.log(`[极客云签] 服务器书签: ${serverHtml ? '有' : '无'}，变更记录: ${serverChanges.length} 条`)

      // 2. 完整性校验 + 备份
      let serverMap = new Map()
      if (serverHtml) {
        const validation = htmlSerializer.validate(serverHtml)
        if (!validation.valid) {
          throw new Error(`服务器书签文件完整性校验失败：${validation.reason}。为保护本地数据，已中止同步。`)
        }
        await backupBookmarks(selectedFolder)
        const serverItems = htmlSerializer.deserialize(serverHtml)
        serverMap = collectServerBookmarkInfo(serverItems)
      }

      // 3. 预构建本地书签 Map（P0性能优化）
      syncState.currentPhase = 'merging'
      const localBookmarkMap = buildLocalBookmarkMap(selectedFolder)
      console.log(`[极客云签] 本地书签 Map 构建完成: ${localBookmarkMap.size} 个`)

      // 统计预计算：本地独有 / 服务器独有（用于最终同步统计）
      let localOnlyCount = 0
      let serverOnlyCount = 0
      for (const [normUrl] of localBookmarkMap) {
        if (!serverMap.has(normUrl)) localOnlyCount++
      }
      for (const [normUrl] of serverMap) {
        if (!localBookmarkMap.has(normUrl)) serverOnlyCount++
      }

      // 4. 获取本地未同步的变更（用于方案C：不把已删的加回来）
      const unsyncedChanges = await getUnsyncedChanges()
      const deletedUrls = new Set(
        unsyncedChanges
          .filter(c => c.type === 'delete')
          .map(c => normalizeUrl(c.payload.url))
      )

      // 5. 全量合并新增书签（方案C：本地删除了的不加回来）
      let addedCount = 0
      if (serverHtml) {
        const serverItems = htmlSerializer.deserialize(serverHtml)
        // 按文件夹分组
        const folderMap = new Map()
        for (const item of serverItems) {
          const normUrl = normalizeUrl(item.url)
          // 方案C：本地删除了的书签，不加回来
          if (deletedUrls.has(normUrl)) continue
          // 本地已有的，不重复添加
          if (localBookmarkMap.has(normUrl)) continue
          const folderPath = item.folder || ''
          if (!folderMap.has(folderPath)) folderMap.set(folderPath, [])
          folderMap.get(folderPath).push(item)
        }
        // 并发添加（限制并发数）
        const createTasks = []
        for (const [folderPath, items] of folderMap) {
          for (const item of items) {
            createTasks.push(async () => {
              try {
                let parentId = selectedFolder.id
                if (folderPath) {
                  const folderNames = folderPath.split('/').filter(n => n.trim())
                  parentId = await ensureFolderExists(selectedFolder.id, folderNames)
                }
                const newNode = await chrome.bookmarks.create({
                  parentId,
                  title: item.title,
                  url: item.url,
                })
                localBookmarkMap.set(normalizeUrl(item.url), { node: newNode, folderPath })
                addedCount++
              } catch (e) {
                console.warn(`[极客云签] 添加书签失败: ${item.title}`, e.message)
              }
            })
          }
        }
        // 并发执行（限制5个并发）
        for (let i = 0; i < createTasks.length; i += 5) {
          await Promise.all(createTasks.slice(i, i + 5).map(fn => fn()))
        }
      }
      console.log(`[极客云签] 全量合并新增: ${addedCount} 个`)

      // 6. 比对变更日志，找出云端独有的变更（需要应用到本地）
      syncState.currentPhase = 'applying'
      const localChangeIds = new Set(unsyncedChanges.map(c => c.id))
      // 已同步的本地变更ID也需要排除（pendingChanges里synced=true的）
      const allLocalChanges = await loadPendingChanges()
      for (const c of allLocalChanges) {
        localChangeIds.add(c.id)
      }
      const cloudOnlyChanges = serverChanges.filter(c => !localChangeIds.has(c.id))
      console.log(`[极客云签] 云端独有变更: ${cloudOnlyChanges.length} 条`)

      // 7. 冲突检测 + 应用云端变更（并发3-5，同URL/同文件夹路径串行）
      let conflictCount = 0
      const conflictList = []
      // 检测冲突：同一URL（书签）或同一文件夹路径（文件夹），本地和云端都有变更
      const localChangeUrls = new Map()
      const localChangeFolders = new Map() // folderPath -> change
      for (const c of unsyncedChanges) {
        if (c.payload.url) {
          const normUrl = normalizeUrl(c.payload.url)
          if (!localChangeUrls.has(normUrl)) {
            localChangeUrls.set(normUrl, c)
          }
        }
        // 文件夹级别变更：用 oldFolderPath 或 folderPath 作为冲突检测键
        const folderKey = c.payload.oldFolderPath || c.payload.folderPath
        if (folderKey && (c.type === 'folder_rename' || c.type === 'folder_move' || c.type === 'folder_delete' || c.type === 'folder_create')) {
          if (!localChangeFolders.has(folderKey)) {
            localChangeFolders.set(folderKey, c)
          }
        }
      }
      const changesToApply = []
      for (const c of cloudOnlyChanges) {
        if (c.payload.url) {
          // 书签级别冲突检测
          const normUrl = normalizeUrl(c.payload.url)
          const localChange = localChangeUrls.get(normUrl)
          if (localChange) {
            // 冲突：比较时间戳，晚的覆盖早的
            conflictCount++
            conflictList.push({
              url: c.payload.url,
              localTitle: localChange.payload.newTitle || localChange.payload.title || '(本地变更)',
              serverTitle: c.payload.newTitle || c.payload.title || '(云端变更)',
            })
            if (c.timestamp > localChange.timestamp) {
              // 云端更晚，应用云端变更
              changesToApply.push(c)
            }
            // 本地更晚，跳过云端变更（本地的会上传到服务器）
          } else {
            changesToApply.push(c)
          }
        } else {
          // 文件夹级别冲突检测
          const folderKey = c.payload.oldFolderPath || c.payload.folderPath
          const localChange = folderKey ? localChangeFolders.get(folderKey) : null
          if (localChange) {
            // 文件夹冲突：比较时间戳，晚的覆盖早的
            conflictCount++
            conflictList.push({
              url: `(文件夹) ${folderKey}`,
              localTitle: `本地${localChange.type.replace('folder_', '')}`,
              serverTitle: `云端${c.type.replace('folder_', '')}`,
            })
            if (c.timestamp > localChange.timestamp) {
              // 云端更晚，应用云端变更
              changesToApply.push(c)
            }
            // 本地更晚，跳过云端变更
          } else {
            changesToApply.push(c)
          }
        }
      }
      console.log(`[极客云签] 冲突: ${conflictCount} 个，待应用变更: ${changesToApply.length} 条`)

      // 并发应用变更
      const applyResults = await applyChangesConcurrently(changesToApply, localBookmarkMap, selectedFolder.id)
      console.log(`[极客云签] 变更应用结果: 成功 ${applyResults.success}，失败 ${applyResults.failed}`)

      // 保存冲突详情
      syncState.lastConflicts = conflictList

      // 8. 生成最新书签快照
      syncState.currentPhase = 'uploading'
      const updatedTree = await chrome.bookmarks.getTree()
      const updatedFolder = findFolderById(updatedTree, settings.localRoot)
      const html = htmlSerializer.serialize([updatedFolder])

      // 9. 合并变更日志（Set去重，排序，清理）
      const allLocalChangesForMerge = allLocalChanges.map(c => ({
        id: c.id,
        type: c.type,
        payload: c.payload,
        timestamp: c.timestamp,
        deviceId: c.deviceId,
      }))
      const mergedChanges = mergeChangeLogs(allLocalChangesForMerge, serverChanges)
      const cleanedChanges = cleanupChangeLog(mergedChanges)
      const newChangeLog = {
        version: 1,
        lastUpdated: Date.now(),
        changes: cleanedChanges,
      }
      console.log(`[极客云签] 变更日志合并: ${mergedChanges.length} → ${cleanedChanges.length} 条（清理后）`)

      // 10. 上传书签 + 变更日志（内容无变化则跳过书签上传）
      const contentHash = await computeContentHash(html)
      if (contentHash && contentHash === syncState.lastUploadHash) {
        console.log('[极客云签] 书签内容无变化，跳过上传')
      } else {
        await adapter.uploadFile(html)
        syncState.lastUploadHash = contentHash
      }
      await adapter.uploadChangeLog(newChangeLog)

      // 11. 标记本地变更为已同步
      const syncedIds = unsyncedChanges.map(c => c.id)
      await markChangesSynced(syncedIds)

      // 统计：新增 = 本地独有(上传到服务器) + 服务器独有下载到本地(addedCount)
      // 删除 = 本地删除同步到服务器 + 服务器删除同步到本地
      // 本地删除同步到服务器 = serverOnlyCount 中被 deletedUrls 排除的数量
      let localDeletedCount = 0
      for (const normUrl of serverMap.keys()) {
        if (!localBookmarkMap.has(normUrl) && deletedUrls.has(normUrl)) {
          localDeletedCount++
        }
      }
      // 服务器删除同步到本地 = changesToApply 中 type=delete 的数量
      const serverDeletedCount = changesToApply.filter(c => c.type === 'delete').length

      mergeStats.added = localOnlyCount + addedCount
      mergeStats.removed = localDeletedCount + serverDeletedCount
      mergeStats.conflicts = conflictCount
      console.log(`[极客云签] 统计：新增 ${mergeStats.added}（本地上传${localOnlyCount}+服务器下载${addedCount}），删除 ${mergeStats.removed}（本地删${localDeletedCount}+服务器删${serverDeletedCount}），冲突 ${conflictCount}`)
    }

    // 6. 更新状态
    syncState.lastSync = Date.now()
    syncState.lastError = null
    syncState.lastStats = mergeStats
    await saveSyncState()
    await addSyncLog({
      timestamp: Date.now(),
      success: true,
      strategy: strategy,
      added: mergeStats.added,
      removed: mergeStats.removed,
      conflicts: mergeStats.conflicts,
      error: null,
    })
    console.log(`[Webdav-BookmarkSync] 同步成功：新增 ${mergeStats.added}，删除 ${mergeStats.removed}，冲突 ${mergeStats.conflicts}`)
    updateBadge('allgood')
    // 同步成功通知
    if (settings.notifyOnSuccess) {
      sendNotification('书签同步成功', `新增 ${mergeStats.added}，删除 ${mergeStats.removed}，冲突 ${mergeStats.conflicts}`)
    }
  } catch (error) {
    console.error('[Webdav-BookmarkSync] 同步失败:', error.message)
    syncState.lastError = error.message
    await saveSyncState()
    await addSyncLog({
      timestamp: Date.now(),
      success: false,
      strategy: settings.syncStrategy || 'merge',
      added: 0,
      removed: 0,
      conflicts: 0,
      error: error.message,
    })
    updateBadge('error')
    // 同步失败通知
    if (settings.notifyOnFailure) {
      sendNotification('书签同步失败', error.message, 'error')
    }
  } finally {
    syncState.syncing = false
    syncLock = false
    // 如果同步期间有新的变更触发了同步，等当前完成后再执行一次
    if (syncQueued) {
      syncQueued = false
      console.log('[极客云签] 检测到排队同步，立即执行下一次同步')
      setTimeout(() => syncAccount(), 1000) // 延迟1秒，避免连续同步
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 规范化 URL，用于去重比较
 * - 域名转小写
 * - 去掉默认端口（80/443）
 * - 路径去掉末尾斜杠（根路径保留 /）
 * - 查询参数按 key 排序
 * - 去掉 hash
 */
function normalizeUrl(urlStr) {
  try {
    const url = new URL(urlStr)

    // 域名转小写
    url.hostname = url.hostname.toLowerCase()

    // 去掉默认端口
    if ((url.protocol === 'http:' && url.port === '80') ||
        (url.protocol === 'https:' && url.port === '443')) {
      url.port = ''
    }

    // 路径去掉末尾斜杠（根路径除外）
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }

    // 查询参数排序
    const params = Array.from(url.searchParams.entries())
    params.sort((a, b) => a[0].localeCompare(b[0]))
    url.search = ''
    for (const [key, value] of params) {
      url.searchParams.append(key, value)
    }

    // 去掉 hash
    url.hash = ''

    return url.toString()
  } catch (e) {
    return urlStr
  }
}

/**
 * 根据 ID 在书签树中查找文件夹
 */
function findFolderById(tree, id) {
  function search(nodes) {
    for (const node of nodes) {
      if (node.id === id) return node
      if (node.children) {
        const found = search(node.children)
        if (found) return found
      }
    }
    return null
  }
  return search(tree)
}

/**
 * 熔断检查（Failsafe）：防止单次同步删除过多数据
 * 参考 Floccus 的 failsafe 机制，当本次删除超过阈值比例时中止同步
 * @param {number} localTotal - 本地书签总数
 * @param {number} serverTotal - 服务器书签总数
 * @param {number} localToRemove - 本次要删除的本地书签数
 * @param {number} serverToRemove - 本次要删除的服务器书签数
 * @param {number} threshold - 阈值百分比（默认50）
 * @returns {{blocked: boolean, reason: string}}
 */
function checkFailsafe(localTotal, serverTotal, localToRemove, serverToRemove, threshold = 50) {
  // 总数为 0 时不检查（没有数据可丢）
  if (localTotal > 0 && localToRemove > 0) {
    const ratio = (localToRemove / localTotal) * 100
    if (ratio > threshold) {
      return {
        blocked: true,
        reason: `熔断保护：本次同步将删除本地 ${localToRemove}/${localTotal} 个书签（${ratio.toFixed(0)}%），超过阈值 ${threshold}%。为防止数据丢失，已中止同步。请确认操作后可在设置中调低阈值或临时关闭熔断。`
      }
    }
  }
  if (serverTotal > 0 && serverToRemove > 0) {
    const ratio = (serverToRemove / serverTotal) * 100
    if (ratio > threshold) {
      return {
        blocked: true,
        reason: `熔断保护：本次同步将删除服务器 ${serverToRemove}/${serverTotal} 个书签（${ratio.toFixed(0)}%），超过阈值 ${threshold}%。为防止数据丢失，已中止同步。请确认操作后可在设置中调低阈值或临时关闭熔断。`
      }
    }
  }
  return { blocked: false, reason: '' }
}

// ============================================================
// 多设备智能同步 - 辅助函数
// ============================================================

/**
 * 预构建本地书签 Map（P0性能优化：避免重复调用 chrome.bookmarks.search）
 * 返回 Map<normalizedUrl, {node, folderPath}>
 */
function buildLocalBookmarkMap(rootNode) {
  const map = new Map()
  function traverse(node, folderPath) {
    if (node.url) {
      const normUrl = normalizeUrl(node.url)
      if (!map.has(normUrl)) {
        map.set(normUrl, { node, folderPath })
      }
    }
    if (node.children) {
      const currentPath = node.title ? (folderPath ? folderPath + '/' + node.title : node.title) : folderPath
      for (const child of node.children) {
        traverse(child, currentPath)
      }
    }
  }
  traverse(rootNode, '')
  return map
}

/**
 * 应用一条变更到本地书签
 * 返回 {success, conflict}
 */
async function applyChangeToLocal(change, localMap, rootId) {
  const { type, payload } = change
  try {
    switch (type) {
      case 'delete': {
        const normUrl = normalizeUrl(payload.url)
        const entry = localMap.get(normUrl)
        if (entry) {
          markOperating(entry.node.id)
          try {
            await chrome.bookmarks.remove(entry.node.id)
          } finally {
            unmarkOperating(entry.node.id)
          }
          localMap.delete(normUrl)
          return { success: true }
        }
        return { success: true } // 本地已经没有了，算成功
      }
      case 'rename': {
        const normUrl = normalizeUrl(payload.url)
        const entry = localMap.get(normUrl)
        if (entry) {
          markOperating(entry.node.id)
          try {
            await chrome.bookmarks.update(entry.node.id, { title: payload.newTitle })
          } finally {
            unmarkOperating(entry.node.id)
          }
          entry.node.title = payload.newTitle
          return { success: true }
        }
        return { success: false, reason: '本地不存在该书签' }
      }
      case 'move': {
        const normUrl = normalizeUrl(payload.url)
        const entry = localMap.get(normUrl)
        if (entry) {
          let parentId = rootId
          if (payload.newFolder) {
            const folderNames = payload.newFolder.split('/').filter(n => n.trim())
            parentId = await ensureFolderExists(rootId, folderNames)
          }
          markOperating(entry.node.id)
          try {
            await chrome.bookmarks.move(entry.node.id, { parentId })
          } finally {
            unmarkOperating(entry.node.id)
          }
          entry.folderPath = payload.newFolder
          return { success: true }
        }
        return { success: false, reason: '本地不存在该书签' }
      }
      case 'folder_create': {
        if (payload.folderPath) {
          const folderNames = payload.folderPath.split('/').filter(n => n.trim())
          await ensureFolderExists(rootId, folderNames)
          return { success: true }
        }
        return { success: false, reason: '文件夹路径为空' }
      }
      case 'folder_delete': {
        // 找到对应文件夹并删除
        const tree = await chrome.bookmarks.getTree()
        const folder = findFolderByPath(tree, payload.folderPath)
        if (folder) {
          // 递归标记文件夹及其所有子节点，忽略删除事件
          markOperatingTree(folder)
          try {
            await chrome.bookmarks.removeTree(folder.id)
          } finally {
            // 延迟取消标记，因为删除事件是异步触发的
            setTimeout(() => {
              const unmarkTree = (n) => {
                unmarkOperating(n.id)
                if (n.children) n.children.forEach(unmarkTree)
              }
              unmarkTree(folder)
            }, 1500)
          }
          return { success: true }
        }
        return { success: true } // 本地已经没有了，算成功
      }
      case 'folder_rename': {
        const tree = await chrome.bookmarks.getTree()
        const folder = findFolderByPath(tree, payload.oldFolderPath)
        if (folder) {
          markOperating(folder.id)
          try {
            await chrome.bookmarks.update(folder.id, { title: payload.newTitle })
          } finally {
            unmarkOperating(folder.id)
          }
          return { success: true }
        }
        return { success: false, reason: '本地不存在该文件夹' }
      }
      case 'folder_move': {
        const tree = await chrome.bookmarks.getTree()
        const folder = findFolderByPath(tree, payload.oldFolderPath)
        if (folder) {
          const newParentPath = payload.newFolderPath.substring(0, payload.newFolderPath.lastIndexOf('/'))
          let parentId = rootId
          if (newParentPath) {
            const folderNames = newParentPath.split('/').filter(n => n.trim())
            parentId = await ensureFolderExists(rootId, folderNames)
          }
          markOperating(folder.id)
          try {
            await chrome.bookmarks.move(folder.id, { parentId })
          } finally {
            unmarkOperating(folder.id)
          }
          return { success: true }
        }
        return { success: false, reason: '本地不存在该文件夹' }
      }
      default:
        return { success: false, reason: '未知变更类型: ' + type }
    }
  } catch (e) {
    console.warn(`[极客云签] 应用变更失败 ${type}:`, e.message)
    return { success: false, reason: e.message }
  }
}

/**
 * 并发应用变更（P1性能优化：3-5并发，同URL串行）
 */
async function applyChangesConcurrently(changes, localMap, rootId) {
  const results = { success: 0, failed: 0, conflicts: 0 }
  if (changes.length === 0) return results

  // 按 URL 分组，同 URL 的变更串行（避免竞争），不同 URL 并发
  const urlGroups = new Map()
  const noUrlChanges = []
  for (const change of changes) {
    const key = change.payload.url || change.payload.folderPath || change.payload.oldFolderPath || '__nogroup__'
    if (!urlGroups.has(key)) urlGroups.set(key, [])
    urlGroups.get(key).push(change)
  }

  // 每个组内按时间戳排序串行执行
  const groupTasks = Array.from(urlGroups.values()).map(async (group) => {
    group.sort((a, b) => a.timestamp - b.timestamp)
    for (const change of group) {
      const result = await applyChangeToLocal(change, localMap, rootId)
      if (result.success) results.success++
      else results.failed++
    }
  })

  // 并发执行所有组（限制并发数）
  const concurrency = CONCURRENT_CHANGES
  for (let i = 0; i < groupTasks.length; i += concurrency) {
    const batch = groupTasks.slice(i, i + concurrency)
    await Promise.all(batch)
  }

  return results
}

/**
 * 合并变更日志（P3性能优化：Set 按 UUID 去重，O(n)）
 */
function mergeChangeLogs(localChanges, serverChanges) {
  // 性能优化：两边都已按时间戳排序，使用归并合并 O(n)，替代全量排序 O(n log n)
  const idSet = new Set()
  const merged = []
  let i = 0, j = 0

  // 先过滤掉90天前的过期数据（减少处理量）
  const cutoff = Date.now() - CHANGE_LOG_RETENTION_MS
  const validLocal = localChanges.filter(c => c.timestamp > cutoff)
  const validServer = serverChanges.filter(c => c.timestamp > cutoff)

  // 归并：按时间戳顺序合并，同时去重
  while (i < validServer.length && j < validLocal.length) {
    if (validServer[i].timestamp <= validLocal[j].timestamp) {
      if (!idSet.has(validServer[i].id)) {
        idSet.add(validServer[i].id)
        merged.push(validServer[i])
      }
      i++
    } else {
      if (!idSet.has(validLocal[j].id)) {
        idSet.add(validLocal[j].id)
        merged.push(validLocal[j])
      }
      j++
    }
  }
  // 处理剩余的服务器变更
  while (i < validServer.length) {
    if (!idSet.has(validServer[i].id)) {
      idSet.add(validServer[i].id)
      merged.push(validServer[i])
    }
    i++
  }
  // 处理剩余的本地变更
  while (j < validLocal.length) {
    if (!idSet.has(validLocal[j].id)) {
      idSet.add(validLocal[j].id)
      merged.push(validLocal[j])
    }
    j++
  }
  return merged
}

/**
 * 清理变更日志（保留最近1000条或90天内的）
 * 性能优化：假设输入已按时间戳排序，直接截取，不需要再次过滤
 */
function cleanupChangeLog(changes) {
  // 输入已按时间戳排序（归并合并的结果），直接截取最近的 MAX_CHANGE_LOG_ENTRIES 条
  if (changes.length > MAX_CHANGE_LOG_ENTRIES) {
    return changes.slice(changes.length - MAX_CHANGE_LOG_ENTRIES)
  }
  return changes
}

/**
 * 根据路径查找文件夹节点
 */
function findFolderByPath(tree, folderPath) {
  if (!folderPath) return null
  const names = folderPath.split('/').filter(n => n.trim())
  function find(nodes, index) {
    for (const node of nodes) {
      if (node.title === names[index]) {
        if (index === names.length - 1) return node
        if (node.children) return find(node.children, index + 1)
      }
    }
    return null
  }
  return find(tree, 0)
}

/**
 * 发送桌面通知（不支持时静默降级）
 */
async function sendNotification(title, message, type = 'success') {
  try {
    if (!chrome.notifications || !chrome.notifications.create) {
      return // 环境不支持通知（如部分移动端浏览器），静默跳过
    }
    const iconUrl = type === 'error'
      ? chrome.runtime.getURL('icons/notify_error.png')
      : chrome.runtime.getURL('icons/notify_success.png')
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: iconUrl,
      title: title,
      message: message,
      priority: type === 'error' ? 2 : 0,
    })
  } catch (e) {
    console.warn('[Webdav-BookmarkSync] 发送通知失败:', e.message)
  }
}

/**
 * 计算字符串内容的 SHA-256 hash（十六进制字符串）
 * 用于对比书签内容是否变化，无变化时跳过上传
 */
async function computeContentHash(content) {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch (e) {
    console.warn('[Webdav-BookmarkSync] hash 计算失败，跳过优化:', e)
    return null
  }
}

/**
 * 收集书签树中所有书签的规范化 URL 和标题
 * 返回 Map: normalizedUrl -> title
 */
function collectBookmarkInfo(node) {
  // 先把书签树展平成扁平数组，再复用 collectServerBookmarkInfo
  const items = []
  const traverse = (n) => {
    if (n.url) items.push(n)
    if (n.children) n.children.forEach(traverse)
  }
  traverse(node)
  return collectServerBookmarkInfo(items)
}

/**
 * 从序列化后的书签列表中收集 URL 和标题（核心函数，collectBookmarkInfo 也复用此函数）
 * 返回 Map: normalizedUrl -> title
 */
function collectServerBookmarkInfo(items) {
  const map = new Map()
  for (const item of items) {
    if (item.url) {
      const normUrl = normalizeUrl(item.url)
      if (!map.has(normUrl)) {
        map.set(normUrl, item.title)
      }
    }
  }
  return map
}

/**
 * 获取所有文件夹列表（用于设置页面选择）
 */
function getAllFolders(tree) {
  const folders = []
  function traverse(node, depth) {
    if (!node.url) {
      // 是文件夹
      folders.push({
        id: node.id,
        title: node.title,
        depth,
      })
      if (node.children) {
        for (const child of node.children) {
          traverse(child, depth + 1)
        }
      }
    }
  }
  for (const node of tree) {
    traverse(node, 0)
  }
  return folders
}

// ============================================================
// 书签合并策略（双向合并去重）
// ============================================================
async function mergeBookmarks(selectedFolder, serverItems, settings) {
  const stats = { added: 0, removed: 0, conflicts: 0 }

  // 如果开启了"同步时删除"，以本地书签为准，不合并服务器内容
  // 本地删除的书签会在后续上传全量覆盖后自动从服务器删除
  // 注意：此模式下服务器新增的书签不会自动同步到本地
  if (settings.syncDeleteEnabled) {
    console.log('[Webdav-BookmarkSync] 同步删除已开启，以本地书签为准，跳过合并')
    return stats
  }

  // 获取选中文件夹下所有已存在的书签 URL（规范化后用于去重）
  // 同时记录本地书签标题，用于冲突检测
  const existingUrls = new Set()
  const localBookmarkMap = new Map() // normalizedUrl -> title

  function collectUrls(node) {
    if (node.url) {
      const normUrl = normalizeUrl(node.url)
      existingUrls.add(normUrl)
      if (!localBookmarkMap.has(normUrl)) {
        localBookmarkMap.set(normUrl, node.title)
      }
    }
    if (node.children) {
      for (const child of node.children) {
        collectUrls(child)
      }
    }
  }
  collectUrls(selectedFolder)

  // 找出服务器有但本地没有的书签（用规范化 URL 比较）
  const toAdd = serverItems.filter(item => !existingUrls.has(normalizeUrl(item.url)))

  // 冲突检测：两边都有但标题不同（默认策略：本地优先，仅计数）
  for (const item of serverItems) {
    const normUrl = normalizeUrl(item.url)
    if (existingUrls.has(normUrl)) {
      const localTitle = localBookmarkMap.get(normUrl)
      if (localTitle && localTitle !== item.title) {
        stats.conflicts++
      }
    }
  }

  if (toAdd.length === 0 && !settings.syncDeleteEnabled) {
    return stats
  }

  console.log(`[Webdav-BookmarkSync] 合并 ${toAdd.length} 个书签到本地，冲突 ${stats.conflicts} 个`)

  // 按文件夹分组
  const folderMap = new Map()
  for (const item of toAdd) {
    const folderPath = item.folder || ''
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, [])
    }
    folderMap.get(folderPath).push(item)
  }

  // 在选中文件夹下创建子文件夹并添加书签
  for (const [folderPath, items] of folderMap) {
    let parentId = selectedFolder.id

    // 如果指定了文件夹路径，创建/查找对应文件夹
    if (folderPath) {
      const folderNames = folderPath.split('/').filter(name => name.trim())
      if (folderNames.length > 0) {
        parentId = await ensureFolderExists(selectedFolder.id, folderNames)
      }
    }

    // 添加书签
    for (const item of items) {
      try {
        const newNode = await chrome.bookmarks.create({
          parentId,
          title: item.title,
          url: item.url,
        })
        // 标记新书签ID，忽略 created 事件（同步产生的新增，不是用户操作）
        markOperating(newNode.id)
        unmarkOperatingDelayed(newNode.id)
        stats.added++
      } catch (e) {
        console.warn(`[Webdav-BookmarkSync] 添加书签失败: ${item.title}`, e)
      }
    }
  }

  // 同步删除：删除本地有但服务器没有的书签
  // 安全保护：只有当服务器有书签时才执行删除（避免首次同步误删）
  if (settings.syncDeleteEnabled && serverItems.length > 0) {
    const serverUrls = new Set(serverItems.map(item => normalizeUrl(item.url)))
    const toRemove = []

    function findRemovable(node) {
      if (node.url && !serverUrls.has(normalizeUrl(node.url))) {
        toRemove.push(node)
      }
      if (node.children) {
        for (const child of node.children) {
          findRemovable(child)
        }
      }
    }
    findRemovable(selectedFolder)

    if (toRemove.length > 0) {
      console.log(`[Webdav-BookmarkSync] 同步删除 ${toRemove.length} 个书签`)
      for (const node of toRemove) {
        try {
          markOperating(node.id)
          try {
            await chrome.bookmarks.remove(node.id)
          } finally {
            unmarkOperating(node.id)
          }
          stats.removed++
        } catch (e) {
          console.warn(`[Webdav-BookmarkSync] 删除书签失败: ${node.title}`, e)
        }
      }
      // 清理同步删除后留下的空文件夹
      await cleanupEmptyFolders(selectedFolder.id, selectedFolder.id)
    }
  }

  return stats
}

/**
 * 确保文件夹路径存在，不存在则创建
 */
async function ensureFolderExists(parentId, folderNames) {
  let currentParentId = parentId

  for (const name of folderNames) {
    // 查找是否已存在
    const children = await chrome.bookmarks.getChildren(currentParentId)
    const existing = children.find(c => !c.url && c.title === name)

    if (existing) {
      currentParentId = existing.id
    } else {
      // 创建文件夹
      const folder = await chrome.bookmarks.create({
        parentId: currentParentId,
        title: name,
      })
      // 标记新文件夹ID，忽略 created 事件（同步产生的，不是用户操作）
      markOperating(folder.id)
      unmarkOperatingDelayed(folder.id)
      currentParentId = folder.id
    }
  }

  return currentParentId
}

/**
 * 轮询确认书签栏和其他书签已清空（覆盖式导入/一键清空后使用）
 * 最多等待10秒，每200ms检查一次
 */
async function waitForBookmarksCleared() {
  const maxAttempts = 50 // 最多10秒
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const tree = await chrome.bookmarks.getTree()
      let allEmpty = true
      for (const root of tree[0].children || []) {
        if (root.id === '1' || root.id === '2') {
          const children = await chrome.bookmarks.getChildren(root.id)
          if (children.length > 0) {
            allEmpty = false
            break
          }
        }
      }
      if (allEmpty) {
        console.log(`[极客云签] 书签已清空确认（尝试 ${i + 1} 次）`)
        return true
      }
    } catch (e) {
      console.warn('[极客云签] 检查清空状态失败:', e.message)
    }
    await new Promise(r => setTimeout(r, 200))
  }
  console.warn('[极客云签] 等待书签清空超时，继续执行')
  return false
}

/**
 * 统计书签树中的书签数量（递归）
 */
function countBookmarksInTree(nodes) {
  let count = 0
  const traverse = (list) => {
    for (const n of list) {
      if (n.url) count++
      if (n.children) traverse(n.children)
    }
  }
  traverse(nodes)
  return count
}

/**
 * 清空所有书签（保留书签栏和其他书签两个根文件夹）
 */
async function clearAllBookmarksInternal() {
  const tree = await chrome.bookmarks.getTree()
  const root = tree[0]
  for (const child of root.children || []) {
    const grandChildren = child.children || []
    for (const gc of grandChildren) {
      try { await chrome.bookmarks.removeTree(gc.id) } catch (e) {}
    }
  }
  await waitForBookmarksCleared()
}

/**
 * 备份并清空所有书签（覆盖式导入/一键清空共用）
 */
async function backupAndClearAll() {
  const tree = await chrome.bookmarks.getTree()
  await backupBookmarks(tree[0])
  console.log('[极客云签] 已备份全部书签')
  await clearAllBookmarksInternal()
  console.log('[极客云签] 已清空本地书签')
}

/**
 * 通用导入书签函数（importBookmarksHtml 和 importBookmarksItems 共用）
 * @param {Array} items - 书签列表 [{title, url, folder}]
 * @param {string} mode - 'merge' | 'overwrite'
 * @param {string} targetFolderId - 目标文件夹ID（默认'1'书签栏）
 * @param {string|null} newFolderName - 新建文件夹名（可选）
 * @returns {Promise<{success: boolean, count: number, mode: string, error?: string}>}
 */
async function importBookmarksInternal(items, mode, targetFolderId = '1', newFolderName = null) {
  try {
    // 确定基础父文件夹ID
    let baseParentId = targetFolderId
    if (newFolderName) {
      const newFolder = await chrome.bookmarks.create({
        parentId: targetFolderId,
        title: newFolderName,
      })
      markOperating(newFolder.id)
      unmarkOperatingDelayed(newFolder.id)
      baseParentId = newFolder.id
    }

    if (mode === 'overwrite') {
      await backupAndClearAll()
    }

    let count = 0
    for (const item of items) {
      try {
        let parentId = baseParentId
        if (item.folder) {
          const folderNames = item.folder.split('/').filter(n => n.trim())
          parentId = await ensureFolderExists(baseParentId, folderNames)
        }
        const newNode = await chrome.bookmarks.create({
          parentId,
          title: item.title,
          url: item.url,
        })
        markOperating(newNode.id)
        unmarkOperatingDelayed(newNode.id)
        count++
      } catch (e) {
        console.warn('[极客云签] 导入书签失败:', item.title, e.message)
      }
    }

    // 记录操作日志
    await addSyncLog({
      timestamp: Date.now(),
      success: true,
      strategy: mode === 'overwrite' ? '覆盖式导入' : '合并式导入',
      added: count,
      removed: mode === 'overwrite' ? -1 : 0,
      conflicts: 0,
      error: null,
    })

    return { success: true, count, mode }
  } catch (e) {
    return { success: false, count: 0, mode, error: e.message }
  }
}

/**
 * 递归清理空文件夹（同步后调用，保持书签树整洁）
 * @returns {boolean} 是否删除了当前文件夹
 */
async function cleanupEmptyFolders(folderId, rootId) {
  if (folderId === rootId) return false // 根文件夹不删除
  // 先递归清理子文件夹
  const children = await chrome.bookmarks.getChildren(folderId)
  for (const child of children) {
    if (!child.url) {
      await cleanupEmptyFolders(child.id, rootId)
    }
  }

  // 重新获取子节点，判断是否为空
  const remaining = await chrome.bookmarks.getChildren(folderId)
  if (remaining.length === 0) {
    try {
      await chrome.bookmarks.removeTree(folderId)
      return true
    } catch (e) {
      console.warn(`[Webdav-BookmarkSync] 删除空文件夹失败: ${folderId}`, e)
    }
  }
  return false
}

// ============================================================
// 书签备份（同步前自动备份，保留最近 5 份）
// ============================================================
const MAX_BACKUPS = 5

async function backupBookmarks(selectedFolder) {
  try {
    const html = htmlSerializer.serialize([selectedFolder])

    // 统计书签数量
    let bookmarkCount = 0
    function count(node) {
      if (node.url) bookmarkCount++
      if (node.children) {
        for (const child of node.children) count(child)
      }
    }
    count(selectedFolder)

    const backup = {
      timestamp: Date.now(),
      html,
      bookmarkCount,
    }

    const stored = await chrome.storage.local.get('backups')
    const backups = stored.backups || []

    backups.unshift(backup)
    if (backups.length > MAX_BACKUPS) {
      backups.length = MAX_BACKUPS
    }

    await chrome.storage.local.set({ backups })
    console.log(`[Webdav-BookmarkSync] 已自动备份 ${bookmarkCount} 个书签`)
    return backup
  } catch (e) {
    console.warn('[Webdav-BookmarkSync] 备份失败:', e)
    return null
  }
}

/**
 * 获取备份列表
 */
async function getBackups() {
  const stored = await chrome.storage.local.get('backups')
  return stored.backups || []
}

/**
 * 从备份恢复书签（复用导入书签的逻辑，支持合并/覆盖两种模式）
 * @param {number} backupIndex - 备份索引
 * @param {string} localRoot - 目标文件夹 ID
 * @param {string} mode - 恢复模式：merge=合并式恢复 / overwrite=覆盖式恢复
 */
async function restoreFromBackup(backupIndex, localRoot, mode = 'overwrite') {
  const backups = await getBackups()
  const backup = backups[backupIndex]
  if (!backup) {
    throw new Error('备份不存在')
  }

  const allTree = await chrome.bookmarks.getTree()
  const selectedFolder = findFolderById(allTree, localRoot)
  if (!selectedFolder) {
    throw new Error('找不到选中的书签文件夹')
  }

  // 解析备份 HTML
  const items = htmlSerializer.deserialize(backup.html)

  if (mode === 'overwrite') {
    // 覆盖式恢复：先自动备份当前书签，再清空目标文件夹，然后导入
    await backupBookmarks(selectedFolder)
    const children = await chrome.bookmarks.getChildren(selectedFolder.id)
    for (const child of children) {
      await chrome.bookmarks.removeTree(child.id)
    }
  }

  // 复用导入书签的通用函数
  const result = await importBookmarksInternal(items, 'merge', selectedFolder.id, null)

  console.log(`[极客云签] 从备份恢复了 ${result.imported} 个书签（模式：${mode}）`)
  return { imported: result.imported }
}

// ============================================================
// 同步日志（保留最近 50 条）
// ============================================================
const MAX_LOGS = 50

async function addSyncLog(entry) {
  try {
    const stored = await chrome.storage.local.get('syncLogs')
    const logs = stored.syncLogs || []
    logs.unshift(entry)
    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS
    }
    await chrome.storage.local.set({ syncLogs: logs })
  } catch (e) {
    console.warn('[Webdav-BookmarkSync] 写入同步日志失败:', e)
  }
}

/**
 * 记录导出书签操作日志
 */
async function logExport(count) {
  await addSyncLog({
    timestamp: Date.now(),
    success: true,
    strategy: '导出书签',
    added: count,
    removed: 0,
    conflicts: 0,
    error: null,
  })
}

/**
 * 记录一键清空操作日志
 */
async function logClear(removedCount) {
  await addSyncLog({
    timestamp: Date.now(),
    success: true,
    strategy: '一键清空',
    added: 0,
    removed: removedCount,
    conflicts: 0,
    error: null,
  })
}

async function getSyncLogs() {
  const stored = await chrome.storage.local.get('syncLogs')
  return stored.syncLogs || []
}

// ============================================================
// 状态徽章
// ============================================================
async function updateBadge(status) {
  const badgeColors = {
    allgood: '#4CAF50',
    syncing: '#2196F3',
    error: '#F44336',
    disabled: '#9E9E9E',
    paused: '#FF9800',
  }

  const badgeText = {
    allgood: '✓',
    syncing: '↻',
    error: '!',
    disabled: '-',
    paused: 'P',
  }

  try {
    await chrome.action.setBadgeText({ text: badgeText[status] || '' })
    await chrome.action.setBadgeBackgroundColor({ color: badgeColors[status] || '#9E9E9E' })
  } catch (e) {
    // 某些浏览器可能不支持
  }
}

// ============================================================
// 事件监听（改编自 Floccus BrowserController.js）
// ============================================================

// 浏览器启动同步
chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings()
  if (settings.syncOnStartupEnabled) {
    console.log('[Webdav-BookmarkSync] 浏览器启动，触发同步')
    scheduleSync()
  }
})

// 扩展安装/更新时初始化
chrome.runtime.onInstalled.addListener(async () => {
  // 创建定时同步 alarm
  const settings = await getSettings()
  if (settings.syncIntervalEnabled) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: settings.syncInterval,
    })
  }
  updateBadge('allgood')
})

// 定时同步 + 防抖兜底同步
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const settings = await getSettings()
    if (settings.syncIntervalEnabled) {
      console.log('[Webdav-BookmarkSync] 定时同步触发')
      scheduleSync()
    }
  } else if (alarm.name === DEBOUNCE_ALARM) {
    // 防抖兜底：Service Worker 被回收后 setTimeout 丢失，由 alarm 唤醒执行同步
    console.log('[Webdav-BookmarkSync] 防抖兜底同步触发')
    syncAccount()
  }
})

// ============================================================
// 书签变更记录（7种变更类型：书签 delete/move/rename + 文件夹 folder_create/folder_delete/folder_rename/folder_move）
// ============================================================

/**
 * 获取文件夹路径（从 parentId 转成 "父/子" 格式）
 */
async function getFolderPath(parentId) {
  try {
    const tree = await chrome.bookmarks.getTree()
    const path = []
    function find(node, targetId, currentPath) {
      if (node.id === targetId) {
        path.push(...currentPath)
        return true
      }
      if (node.children) {
        for (const child of node.children) {
          if (find(child, targetId, [...currentPath, node.title])) return true
        }
      }
      return false
    }
    for (const root of tree) {
      if (find(root, parentId, [])) break
    }
    return path.filter(p => p).join('/')
  } catch (e) {
    console.warn('[极客云签] 获取文件夹路径失败:', e)
    return ''
  }
}

/**
 * 判断节点是书签还是文件夹（有 url 是书签，无 url 是文件夹）
 */
function isBookmark(node) {
  return node && node.url !== undefined
}

// 书签变更同步（防抖处理 + 变更记录）
async function onBookmarkChange(localId, details) {
  // 检查是否是同步操作产生的变更（在白名单里），是则忽略避免循环；不在白名单里是用户操作，记录
  let changeId = localId
  if (details.type === 'removed' && details.removeInfo?.node?.id) {
    changeId = details.removeInfo.node.id
  }
  if (operatingIds.has(changeId)) {
    return // 同步产生的变更，忽略
  }

  try {
    // 记录变更
    switch (details.type) {
      case 'created': {
        const node = details.bookmark
        if (!isBookmark(node)) {
          // 文件夹新增 → 记录 folder_create
          const parentPath = await getFolderPath(node.parentId)
          await addPendingChange('folder_create', {
            folderPath: parentPath ? parentPath + '/' + node.title : node.title,
            title: node.title,
          })
        }
        // 书签新增不记录（全量合并处理）
        break
      }
      case 'removed': {
        const node = details.removeInfo.node
        // 记录删除时间戳，用于批量删除检测
        recentRemovalTimestamps.push(Date.now())
        if (isBookmark(node)) {
          // 书签删除 → 记录 delete
          await addPendingChange('delete', {
            url: node.url,
            title: node.title,
          })
        } else {
          // 文件夹删除 → 记录 folder_delete + 递归记录里面所有书签的 delete
          const parentPath = await getFolderPath(details.removeInfo.parentId)
          await addPendingChange('folder_delete', {
            folderPath: parentPath ? parentPath + '/' + node.title : node.title,
            title: node.title,
          })
          // 递归收集文件夹里所有书签并记录删除（核心修复：防止越删越多）
          const bookmarksToDelete = []
          const collectBookmarks = (n) => {
            if (isBookmark(n)) {
              bookmarksToDelete.push({ url: n.url, title: n.title })
            } else if (n.children) {
              n.children.forEach(collectBookmarks)
            }
          }
          if (node.children) {
            node.children.forEach(collectBookmarks)
          }
          // 批量记录删除
          for (const bm of bookmarksToDelete) {
            await addPendingChange('delete', bm)
          }
          console.log(`[极客云签] 文件夹删除，递归记录 ${bookmarksToDelete.length} 个书签删除`)
        }
        break
      }
      case 'changed': {
        if (details.changeInfo.title) {
          // 标题变化 → 需要获取节点判断是书签还是文件夹
          const nodes = await chrome.bookmarks.get(localId)
          const node = nodes[0]
          if (isBookmark(node)) {
            // 书签更名 → 记录 rename
            await addPendingChange('rename', {
              url: node.url,
              oldTitle: details.changeInfo.title, // 注意：changeInfo.title 是新标题
              newTitle: node.title,
            })
          } else {
            // 文件夹更名 → 记录 folder_rename
            const parentPath = await getFolderPath(node.parentId)
            await addPendingChange('folder_rename', {
              oldFolderPath: parentPath ? parentPath + '/' + details.changeInfo.title : details.changeInfo.title,
              newFolderPath: parentPath ? parentPath + '/' + node.title : node.title,
              oldTitle: details.changeInfo.title,
              newTitle: node.title,
            })
          }
        }
        break
      }
      case 'moved': {
        const nodes = await chrome.bookmarks.get(localId)
        const node = nodes[0]
        const oldPath = await getFolderPath(details.moveInfo.oldParentId)
        const newPath = await getFolderPath(details.moveInfo.newParentId)
        if (isBookmark(node)) {
          // 书签移动 → 记录 move
          await addPendingChange('move', {
            url: node.url,
            title: node.title,
            oldFolder: oldPath,
            newFolder: newPath,
          })
        } else {
          // 文件夹移动 → 记录 folder_move
          await addPendingChange('folder_move', {
            oldFolderPath: oldPath ? oldPath + '/' + node.title : node.title,
            newFolderPath: newPath ? newPath + '/' + node.title : node.title,
            title: node.title,
          })
        }
        break
      }
    }
  } catch (e) {
    console.warn('[极客云签] 记录变更失败:', e)
  }

  // 触发同步（防抖）
  getSettings().then(settings => {
    if (settings.syncOnChangeEnabled) {
      scheduleSync()
    }
  })
}

chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  onBookmarkChange(id, { type: 'created', bookmark })
})

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  onBookmarkChange(id, { type: 'removed', removeInfo })
})

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  onBookmarkChange(id, { type: 'changed', changeInfo })
})

chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
  onBookmarkChange(id, { type: 'moved', moveInfo })
})

// ============================================================
// 消息通信（popup/options 页面调用）
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'sync':
      syncAccount().then(() => {
        sendResponse({ success: !syncState.lastError, error: syncState.lastError })
      })
      return true // 保持消息通道开启

    case 'getState':
      getSettings().then(settings => {
        sendResponse({
          ...syncState,
          settings,
        })
      })
      return true // 保持消息通道开启

    case 'getSettings':
      getSettings().then(sendResponse)
      return true

    case 'getDeviceId':
      getDeviceId().then(sendResponse)
      return true

    case 'setSettings':
      setSettings(message.settings).then(async () => {
        // 更新 alarm
        await chrome.alarms.clear(ALARM_NAME)
        if (message.settings.syncIntervalEnabled) {
          chrome.alarms.create(ALARM_NAME, {
            periodInMinutes: message.settings.syncInterval,
          })
        }
        sendResponse({ success: true })
      })
      return true

    case 'testConnection':
      testConnection(message.settings).then(sendResponse)
      return true

    case 'checkFolder':
      checkFolder(message.settings).then(sendResponse)
      return true

    case 'detectFirstSync':
      detectFirstSync(message.settings).then(sendResponse)
      return true

    case 'firstSync':
      // 首次同步，使用用户选择的或自动检测的策略
      syncAccount(message.strategy).then(() => {
        sendResponse({ success: !syncState.lastError, error: syncState.lastError })
      })
      return true

    case 'getFolders':
      chrome.bookmarks.getTree().then(tree => {
        sendResponse(getAllFolders(tree))
      })
      return true

    case 'serializeBookmarks':
      // 序列化当前全部书签为 HTML
      ;(async () => {
        try {
          const tree = message.nodes || await chrome.bookmarks.getTree()
          const html = htmlSerializer.serialize(tree)
          // 统计书签数量（用通用函数）
          const count = countBookmarksInTree(tree)
          // 记录操作日志
          await logExport(count)
          sendResponse(html)
        } catch (e) {
          sendResponse({ error: e.message })
        }
      })()
      return true

    case 'parseBookmarksHtml':
      // 解析 HTML 为扁平的 items 数组（用于选择性导入）
      try {
        const items = htmlSerializer.deserialize(message.html)
        sendResponse(items)
      } catch (e) {
        sendResponse({ error: e.message })
      }
      return true

    case 'importBookmarksHtml':
      // 从 HTML 导入书签到本地（调用通用导入函数）
      ;(async () => {
        try {
          const mode = message.mode || 'merge'
          const items = htmlSerializer.deserialize(message.html)
          const result = await importBookmarksInternal(items, mode, '1', null)
          sendResponse(result)
        } catch (e) {
          sendResponse({ success: false, error: e.message })
        }
      })()
      return true

    case 'importBookmarksItems':
      // 从 items 数组导入书签到本地（选择性导入，调用通用导入函数）
      ;(async () => {
        try {
          const mode = message.mode || 'merge'
          const items = message.items || []
          const targetFolderId = message.targetFolderId || '1'
          const newFolderName = message.newFolderName || null
          const result = await importBookmarksInternal(items, mode, targetFolderId, newFolderName)
          sendResponse(result)
        } catch (e) {
          sendResponse({ success: false, error: e.message })
        }
      })()
      return true

    case 'clearAllBookmarks':
      // 一键清空本地书签（先备份，调用通用函数）
      ;(async () => {
        try {
          const tree = await chrome.bookmarks.getTree()
          const bookmarkCount = countBookmarksInTree(tree[0].children || [])
          await backupAndClearAll()
          // 记录操作日志
          await logClear(bookmarkCount)
          sendResponse({ success: true, backupCount: bookmarkCount })
        } catch (e) {
          sendResponse({ success: false, error: e.message })
        }
      })()
      return true

    case 'getBackups':
      getBackups().then(sendResponse)
      return true

    case 'restoreBackup':
      restoreFromBackup(message.index, message.localRoot, message.mode || 'overwrite').then(sendResponse).catch(e => {
        sendResponse({ error: e.message })
      })
      return true

    case 'getSyncLogs':
      getSyncLogs().then(sendResponse)
      return true

    case 'notify':
      // 统一通知入口（options/popup 页面发消息过来，由 background 发送系统通知）
      sendNotification(message.title, message.message, message.type || 'info')
      sendResponse({ success: true })
      return true
  }
})

// ============================================================
// 测试连接
// ============================================================
async function testConnection(settings) {
  try {
    const adapter = new WebDavAdapter(settings)
    return await adapter.testConnection()
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 检查文件夹是否存在（只检查，不创建）
 */
async function checkFolder(settings) {
  try {
    const adapter = new WebDavAdapter(settings)
    return await adapter.checkFolderExists()
  } catch (e) {
    return { exists: false, error: e.message }
  }
}

/**
 * 首次同步前检测本地和云端书签状态
 * @returns {Promise<{localHas:boolean, localCount:number, serverHas:boolean, serverCount:number, error?:string}>}
 */
async function detectFirstSync(settings) {
  const result = {
    localHas: false,
    localCount: 0,
    serverHas: false,
    serverCount: 0,
  }

  try {
    // 1. 检测本地书签
    const allTree = await chrome.bookmarks.getTree()
    const selectedFolder = findFolderById(allTree, settings.localRoot)
    if (!selectedFolder) {
      return { ...result, error: '找不到选中的书签文件夹，请重新选择' }
    }
    const localMap = collectBookmarkInfo(selectedFolder)
    result.localCount = localMap.size
    result.localHas = localMap.size > 0

    // 2. 检测云端书签
    const adapter = new WebDavAdapter(settings)
    // 先确保文件夹存在（检测时创建，避免文件路径不存在导致误判）
    await adapter.createFolder()
    const serverHtml = await adapter.downloadFile()
    if (serverHtml) {
      const serverItems = htmlSerializer.deserialize(serverHtml)
      result.serverCount = serverItems.length
      result.serverHas = serverItems.length > 0
    }

    return result
  } catch (e) {
    return { ...result, error: e.message }
  }
}
