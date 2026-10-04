local _ = require("gettext")
local callApi = require("call_api")
local InfoMessage = require("ui/widget/infomessage")
local JSON = require("json")
local KoInsightDbReader = require("db_reader")
local KoInsightAnnotationReader = require("annotation_reader")
local logger = require("logger")
local UIManager = require("ui/uimanager")
local const = require("./const")
local Device = require("device")

local API_UPLOAD_LOCATION = "/api/plugin/import"
local API_DEVICE_LOCATION = "/api/plugin/device"

local KoInsightUpload = {}

local function get_headers(body)
  local headers = {
    ["Content-Type"] = "application/json",
    ["Content-Length"] = tostring(#body),
  }
  return headers
end

local function render_response_message(response, prefix, default_text)
  local text = prefix .. " " .. default_text
  if response ~= nil and response["message"] ~= nil then
    logger.dbg("[Leituras] API message received: ", JSON.encode(response))
    text = prefix .. " " .. response["message"]
  end

  UIManager:show(InfoMessage:new({
    text = _(text),
  }))
end

local function send_device_data(server_url, silent)
  local url = server_url .. API_DEVICE_LOCATION
  local body = {
    id = G_reader_settings:readSetting("device_id"),
    model = Device.model,
    version = const.VERSION,
  }
  body = JSON.encode(body)

  local ok, response = callApi("POST", url, get_headers(body), body)

  if ok ~= true and not silent then
    render_response_message(response, "Error:", "Unable to register device.")
  end
  return ok, response
end

local function send_statistics_data(server_url, silent)
  local url = server_url .. API_UPLOAD_LOCATION

  -- Get annotations from currently opened book
  local annotations = KoInsightAnnotationReader.getAnnotationsByBook()

  local annotation_count = 0
  for _, book_annotations in pairs(annotations) do
    annotation_count = annotation_count + #book_annotations
  end

  if annotation_count > 0 then
    logger.info("[Leituras] Syncing", annotation_count, "annotations")
  end

  local books = KoInsightDbReader.bookData()
  local body = {
    stats = KoInsightDbReader.progressData(books),
    books = books,
    annotations = annotations,
    version = const.VERSION,
  }

  body = JSON.encode(body)

  local ok, response = callApi("POST", url, get_headers(body), body)

  if not silent then
    if ok then
      render_response_message(response, "Success:", "Data uploaded.")
    else
      render_response_message(response, "Error:", "Data upload failed.")
    end
  end
  return ok, response
end

-- Sync current book only (stats + current book annotations)
function KoInsightUpload.syncCurrentBook(server_url, silent)
  if silent == nil then
    silent = false
  end
  if server_url == nil or server_url == "" then
    UIManager:show(InfoMessage:new({
      text = _("Please configure the server URL first."),
    }))
    return
  end

  send_device_data(server_url, silent)
  send_statistics_data(server_url, silent)
end

-- Sync the whole statistics DB (all books' stats and metadata).
-- The server ignores annotations, so there is no per-book request: each one would
-- block the UI for nothing.
-- Returns true, or false and a message for the user (nil when callApi already showed one).
function KoInsightUpload.syncAllBooks(server_url)
  if server_url == nil or server_url == "" then
    return false, _("Please configure the server URL first.")
  end

  local function failure(err)
    if err == "network_error" then
      return false, _("Could not reach the Leituras server at") .. " " .. server_url
    end
    return false, nil -- callApi showed the server error
  end

  -- Stop at the first failure instead of waiting for every request to time out
  local ok, err = send_device_data(server_url, true) -- silent
  if not ok then
    return failure(err)
  end

  ok, err = send_statistics_data(server_url, true) -- silent
  if not ok then
    return failure(err)
  end
  return true
end

return KoInsightUpload
