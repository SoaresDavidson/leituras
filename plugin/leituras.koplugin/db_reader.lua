local SQ3 = require("lua-ljsqlite3/init")
local DataStorage = require("datastorage")
local logger = require("logger")

local db_location = DataStorage:getSettingsDir() .. "/statistics.sqlite3"

local KoInsightDbReader = {}

-- md5 and live page count of the currently opened document, or nil outside the reader.
-- The live count is more accurate than the statistics database, which may be stale.
-- The statistics DB keys books by the same partial md5 the sidecar stores.
local function open_document_pages()
  local ok, ReaderUI = pcall(require, "apps/reader/readerui")
  local ui = ok and ReaderUI and ReaderUI.instance
  if not (ui and ui.document and ui.doc_settings) then
    return nil
  end
  return ui.doc_settings:readSetting("partial_md5_checksum"), ui.document:getPageCount()
end

function KoInsightDbReader.bookData()
  local conn = SQ3.open(db_location)
  local result, rows = conn:exec("SELECT * FROM book")
  local books = {}
  local open_md5, open_pages = open_document_pages()

  for i = 1, rows do
    local book_md5 = result[10][i]
    local db_pages = tonumber(result[7][i])

    -- Use the live page count for the opened document, the database value otherwise
    local current_pages = (open_md5 ~= nil and book_md5 == open_md5) and open_pages or nil
    local pages = current_pages or db_pages

    -- Log if we're using live data vs stale database data
    if current_pages and current_pages ~= db_pages then
      logger.info(
        string.format(
          "[Leituras] Using live page count for book %s: %d (DB has: %d)",
          result[2][i],
          current_pages,
          db_pages
        )
      )
    end

    local book = {
      id = tonumber(result[1][i]),
      title = result[2][i],
      authors = result[3][i],
      notes = tonumber(result[4][i]),
      last_open = tonumber(result[5][i]),
      highlights = tonumber(result[6][i]),
      pages = pages, -- Use live count if available, otherwise DB value
      series = result[8][i],
      language = result[9][i],
      md5 = book_md5,
      total_read_time = tonumber(result[11][i]),
      total_read_pages = tonumber(result[12][i]),
    }
    table.insert(books, book)
  end

  conn:close()
  return books
end

local function flush_statistics_to_db()
  local ok, ReaderUI = pcall(require, "apps/reader/readerui")
  if not ok or not ReaderUI or not ReaderUI.instance then return end
  local ui = ReaderUI.instance
  if ui and ui.statistics and ui.statistics.is_doc then
    local ok_flush, err = pcall(function() ui.statistics:insertDB() end)
    if ok_flush then
      logger.info("[Leituras] Flushed statistics to DB before sync")
    else
      logger.warn("[Leituras] Failed to flush statistics to DB: " .. tostring(err))
    end
  end
end

-- book_data: result of bookData(), passed in so callers that also send it read the DB once
function KoInsightDbReader.progressData(book_data)
  flush_statistics_to_db()
  local conn = SQ3.open(db_location)
  local result, rows = conn:exec("SELECT * FROM page_stat_data")
  local results = {}

  book_data = book_data or KoInsightDbReader.bookData()
  local md5_by_id = {}
  for _, book in ipairs(book_data) do
    md5_by_id[book.id] = book.md5
  end

  local device_id = G_reader_settings:readSetting("device_id")

  for i = 1, rows do
    local book_id = tonumber(result[1][i])
    local book_md5 = md5_by_id[book_id]

    if book_md5 == nil then
      logger.warn("[Leituras] Book MD5 not found in book data:" .. book_id)
      goto continue
    end

    table.insert(results, {
      page = tonumber(result[2][i]),
      start_time = tonumber(result[3][i]),
      duration = tonumber(result[4][i]),
      total_pages = tonumber(result[5][i]),
      book_md5 = book_md5,
      device_id = device_id,
    })

    ::continue::
  end

  conn:close()
  return results
end

return KoInsightDbReader
