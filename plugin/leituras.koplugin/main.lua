local _ = require("gettext")
local Dispatcher = require("dispatcher") -- luacheck:ignore
local InfoMessage = require("ui/widget/infomessage")
local logger = require("logger")
local KoInsightUpload = require("upload")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local KoInsightSettings = require("settings")
local KoInsightDbReader = require("db_reader")
local JSON = require("json")

local koinsight = WidgetContainer:extend({
  name = "leituras",
  is_doc_only = false,
})

function koinsight:init()
  self:onDispatcherRegisterActions()
  self.ui.menu:registerToMainMenu(self)
  self.koinsight_settings = KoInsightSettings:new({})
  self:initMenuOrder()
end

function koinsight:addToMainMenu(menu_items)
  menu_items.leituras = {
    text = _("Leituras"),
    sorting_hint = "tools",
    sub_item_table = {
      -- 1) Synchronize data (all books)
      {
        text = _("Synchronize data"),
        callback = function()
          self:performFullSync()
        end,
        separator = true, -- separator line
      },

      -- 2) Sync on suspend
      {
        text = _("Sync on suspend"),
        checked_func = function()
          return self.koinsight_settings:getSyncOnSuspendEnabled()
        end,
        callback = function()
          self.koinsight_settings:toggleSyncOnSuspend()
        end,
      },

      -- 3) Aggressive sync on suspend (auto Wi-Fi)
      {
        text = _("Aggressive sync on suspend (auto Wi-Fi)"),
        checked_func = function()
          return self.koinsight_settings:getAggressiveSuspendEnabled()
        end,
        enabled_func = function()
          return self.koinsight_settings:getSyncOnSuspendEnabled()
        end,
        callback = function()
          self.koinsight_settings:toggleAggressiveSuspend()
        end,
      },

      -- 4) Set suspend connect timeout
      {
        text = _("Set suspend connect timeout…"),
        keep_menu_open = true,
        enabled_func = function()
          return self.koinsight_settings:getSyncOnSuspendEnabled()
        end,
        callback = function()
          self.koinsight_settings:editTimeoutDialog()
        end,
      },

      -- 5) Server URL
      {
        text = _("Set server URL"),
        keep_menu_open = true,
        separator = true, -- separator line *after* this item (before "About")
        callback = function()
          self.koinsight_settings:editServerSettings()
        end,
      },

      -- 6) About Leituras
      {
        text = _("About Leituras"),
        keep_menu_open = true,
        callback = function()
          local const = require("./const")
          UIManager:show(InfoMessage:new({
            text = "Leituras sync plugin, a fork of the KoInsight plugin (MIT).\n\nPlugin version: "
              .. const.VERSION
              .. "\n\nSee https://github.com/SoaresDavidson/leituras.",
          }))
        end,
      },
    },
  }
end

-- Register sync actions to make them available in gestures
function koinsight:onDispatcherRegisterActions()
  Dispatcher:registerAction("leituras_sync", {
    category = "none",
    event = "LeiturasSync",
    title = _("Leituras: Sync all books"),
    general = true,
  })
end

function koinsight:onLeiturasSync()
  self:performFullSync()
end

-- Perform full sync of all books
function koinsight:performFullSync()
  local url = self.koinsight_settings:getServerURL()
  if not url or url == "" then
    UIManager:show(
      InfoMessage:new({ text = _("Leituras server URL is not configured."), timeout = 3 })
    )
    return
  end

  local NetworkMgr = require("ui/network/manager")
  NetworkMgr:runWhenOnline(function()
    local progress_info = InfoMessage:new({ text = _("Syncing reading statistics…") })
    UIManager:show(progress_info)
    -- The sync blocks the UI loop until it returns: paint the message now or it never shows
    UIManager:forceRePaint()

    local ok, synced, message = pcall(KoInsightUpload.syncAllBooks, url)
    UIManager:close(progress_info)

    if not ok then
      logger.err("[Leituras] Full sync failed: " .. tostring(synced))
      UIManager:show(InfoMessage:new({ text = _("Sync failed: ") .. tostring(synced), timeout = 5 }))
    elseif synced then
      UIManager:show(InfoMessage:new({ text = _("Sync complete!"), timeout = 3 }))
    elseif message then
      UIManager:show(InfoMessage:new({ text = message, timeout = 5 }))
    end
  end)
end

-- Sync when device suspends
function koinsight:onSuspend()
  if not self.koinsight_settings:getSyncOnSuspendEnabled() then
    logger.dbg("[Leituras] Sync on suspend is disabled, skipping")
    return
  end

  logger.info("[Leituras] Device suspending - syncing data")

  -- This is the main pathway for suspend sync: if the user enabled aggressive mode,
  -- then do that (enable WiFi then sync then restore original WiFi state), otherwise
  -- do normal sync (assume WiFi is already on and sync).
  if self.koinsight_settings:getAggressiveSuspendEnabled() then
    self:performAggressiveSyncOnSuspend()
  else
    self:performSyncOnSuspend()
  end
end

function koinsight:onPowerOff()
  if not self.koinsight_settings:getSyncOnSuspendEnabled() then
    return
  end

  logger.info("[Leituras] Device powering off - syncing data")

  if self.koinsight_settings:getAggressiveSuspendEnabled() then
    self:performAggressiveSyncOnSuspend()
  else
    self:performSyncOnSuspend()
  end
end

function koinsight:onReboot()
  if not self.koinsight_settings:getSyncOnSuspendEnabled() then
    return
  end

  logger.info("[Leituras] Device rebooting - syncing data")

  if self.koinsight_settings:getAggressiveSuspendEnabled() then
    self:performAggressiveSyncOnSuspend()
  else
    self:performSyncOnSuspend()
  end
end

-- Perform the actual sync with error handling
function koinsight:performSyncOnSuspend()
  -- Check if we have a server URL configured
  local server_url = self.koinsight_settings:getServerURL()
  if not server_url or server_url == "" then
    logger.info("[Leituras] No server URL configured, skipping sync on suspend")
    return
  end

  -- Check WiFi connectivity before attempting sync
  if not self:isWiFiConnected() then
    logger.info("[Leituras] WiFi not connected, skipping sync on suspend")
    return
  end

  -- Perform sync in a protected call to avoid crashing on suspend
  local success, error_msg = pcall(function()
    KoInsightUpload.syncCurrentBook(server_url, true) -- true = silent mode
  end)

  if not success then
    local message = "Error during auto sync: " .. tostring(error_msg)
    logger.err("[Leituras] " .. message)
    UIManager:show(InfoMessage:new({
      text = _(message),
    }))
  else
    logger.info("[Leituras] Suspend sync completed successfully")
  end
end

-- Perform aggressive sync: turn on WiFi if needed, sync, restore WiFi state
function koinsight:performAggressiveSyncOnSuspend()
  -- Check if we have a server URL configured
  local server_url = self.koinsight_settings:getServerURL()
  if not server_url or server_url == "" then
    logger.info("[Leituras] No server URL configured, skipping aggressive sync on suspend")
    return
  end

  local success, error_msg = pcall(function()
    local NetworkMgr = require("ui/network/manager")
    local was_wifi_on = NetworkMgr:isWifiOn()

    logger.info(
      "[Leituras] Starting aggressive sync (WiFi was " .. (was_wifi_on and "on" or "off") .. ")"
    )

    -- Turn on WiFi if it's not already on
    if not was_wifi_on then
      logger.info("[Leituras] Turning on WiFi for sync")
      NetworkMgr:turnOnWifi()

      -- Wait for WiFi to connect with timeout
      local timeout = self.koinsight_settings:getSuspendConnectTimeout()
      local start_time = os.time()
      local connected = false

      while os.time() - start_time < timeout do
        if NetworkMgr:isConnected() then
          connected = true
          logger.info("[Leituras] WiFi connected after " .. (os.time() - start_time) .. " seconds")
          break
        end
        -- Small delay to avoid busy waiting
        os.execute("sleep 0.5")
      end

      if not connected then
        logger.warn("[Leituras] WiFi connection timeout after " .. timeout .. " seconds")
        -- Try to sync anyway, might still work
      end
    end

    -- Perform the actual sync
    logger.info("[Leituras] Performing sync")
    KoInsightUpload.syncCurrentBook(server_url, true) -- true = silent mode

    -- Turn off WiFi if we turned it on
    if not was_wifi_on then
      logger.info("[Leituras] Turning off WiFi after sync")
      NetworkMgr:turnOffWifi()
    end

    logger.info("[Leituras] Aggressive sync completed successfully")
  end)

  if not success then
    local message = "Error during aggressive auto sync: " .. tostring(error_msg)
    logger.err("[Leituras] " .. message)

    -- Try to restore WiFi state in case of error
    pcall(function()
      local NetworkMgr = require("ui/network/manager")
      if NetworkMgr:isWifiOn() then
        logger.info("[Leituras] Cleaning up: turning off WiFi after error")
        NetworkMgr:turnOffWifi()
      end
    end)
  end
end

-- Check if WiFi is connected
function koinsight:isWiFiConnected()
  local success, result = pcall(function()
    local NetworkMgr = require("ui/network/manager")

    -- NetworkMgr handles all the platform-specific logic for us
    -- isWifiOn() returns true on devices without WiFi toggle (like some tablets)
    -- isConnected() checks actual network connectivity
    return NetworkMgr:isWifiOn() and NetworkMgr:isConnected()
  end)

  if not success then
    logger.err("[Leituras] Error checking WiFi status:", result)
    -- If we can't check WiFi status, assume it's not available rather than syncing blind
    return false
  end

  logger.dbg("[Leituras] WiFi status - On:", result and "true" or "false")
  return result
end
function koinsight:initMenuOrder()
  local menu_order_modules = {
    "ui/elements/filemanager_menu_order",
    "ui/elements/reader_menu_order",
  }

  for _, module_name in ipairs(menu_order_modules) do
    local success, menu_order = pcall(require, module_name)
    if success and menu_order and menu_order.tools then
      local pos = 1
      for i, val in ipairs(menu_order.tools) do
        if val == "statistics" then
          pos = i + 1
          break
        end
      end
      table.insert(menu_order.tools, pos, "leituras")
      logger.info("[Leituras] Added to menu order using module: " .. module_name)
    end
  end
end

return koinsight
