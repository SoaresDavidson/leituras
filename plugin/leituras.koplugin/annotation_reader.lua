local DocSettings = require("docsettings")
local logger = require("logger")

local KoInsightAnnotationReader = {}

-- NOTE:
-- This module is used both inside the reader (normal annotation sync)
-- and outside (bulk sync).
-- There is a chance that after rebooting KoReader, the ReaderUI is not
-- yet available, so requiring it can blow up.
-- Therefore we lazy-load ReaderUI behind pcall() the first time we actually need it.
-- This keeps the module safe to require in any context while still allowing us to
-- use the live reader UI when it exists.
local ReaderUI_ok, ReaderUI = nil, nil
local function get_live_ui()
  if ReaderUI_ok == nil then
    ReaderUI_ok, ReaderUI = pcall(require, "apps/reader/readerui")
  end
  return (ReaderUI_ok and ReaderUI and ReaderUI.instance) or nil
end

-- KoReader has this API, ideal for bulk operations
local function open_sidecar_readonly(doc_path)
  local sidecar = DocSettings:findSidecarFile(doc_path)
  if not sidecar then
    return nil
  end
  return DocSettings.openSettingsFile(sidecar)
end

-- Get the currently opened document
function KoInsightAnnotationReader.getCurrentDocument()
  local ui = get_live_ui()

  if ui and ui.document and ui.document.file then
    return ui.document.file
  end

  return nil
end

-- Get the MD5 hash for the currently open document
function KoInsightAnnotationReader.getCurrentBookMd5()
  -- when inside reader
  local ui = get_live_ui()
  if ui and ui.doc_settings then
    return ui.doc_settings:readSetting("partial_md5_checksum")
  end

  -- fallback (if called outside reader, e.g. in bulk operation)
  local current_doc = KoInsightAnnotationReader.getCurrentDocument()
  local ds = current_doc and open_sidecar_readonly(current_doc)
  return ds and ds:readSetting("partial_md5_checksum") or nil
end

-- Get annotations for the currently opened book
function KoInsightAnnotationReader.getCurrentBookAnnotations()
  local ui = get_live_ui()
  local current_doc = KoInsightAnnotationReader.getCurrentDocument()

  if not current_doc then
    logger.dbg("[Leituras] No document currently open")
    return nil
  end

  logger.dbg("[Leituras] Reading annotations for:", current_doc)

  -- Force flush any in-memory changes to disk before reading
  -- Otherwise changes are not reflected
  --
  -- IMPORTANT:
  -- If we are inside the reader, ui.doc_settings is the freshest source (in-memory).
  -- We flush to ensure sidecar on disk is up-to-date for other codepaths.
  if ui and ui.doc_settings then
    logger.dbg("[Leituras] Flushing doc settings to disk")
    ui.doc_settings:flush()
  end

  -- Prefer live doc_settings when inside reader (fresh, no extra sidecar open)
  -- Fall back to read-only sidecar open (outside reader withouth live settings)
  local doc_settings = (ui and ui.doc_settings) or open_sidecar_readonly(current_doc)
  if not doc_settings then
    logger.dbg("[Leituras] No doc settings found for:", current_doc)
    return nil
  end

  local annotations = doc_settings:readSetting("annotations")
  if not annotations then
    logger.dbg("[Leituras] No annotations found in doc settings")
    return nil
  end

  -- Get total pages from the current document
  -- We need this because we store the page number at time of creation of each annotation
  -- But this page number changes after a reflow. By also storing the total page number
  -- at time of creation, we can always calculate the page for any given total page number.
  -- This is similar to how stats are handled.
  local total_pages = nil
  if ui and ui.document then
    total_pages = ui.document:getPageCount()
    logger.dbg("[Leituras] Document has", total_pages, "total pages")
  else
    -- Fallback for outside of reader, where we have no live ui.document
    total_pages = doc_settings:readSetting("doc_pages")
  end

  logger.info("[Leituras] Found", #annotations, "annotations for current book")
  return annotations, total_pages
end

-- Get annotations organized by book md5
function KoInsightAnnotationReader.getAnnotationsByBook()
  local annotations_by_book = {}

  -- Get annotations from currently opened book
  -- Bulk syncing is another code path since we need to open sidecar files for bulk syncing
  local current_annotations, total_pages = KoInsightAnnotationReader.getCurrentBookAnnotations()

  if not current_annotations or #current_annotations == 0 then
    logger.dbg("[Leituras] No annotations to sync")
    return annotations_by_book
  end

  -- Get the MD5 for the currently open book
  local book_md5 = KoInsightAnnotationReader.getCurrentBookMd5()

  if not book_md5 then
    logger.warn("[Leituras] Could not determine MD5 for current book, skipping annotations")
    return annotations_by_book
  end

  -- Clean up annotations for JSON serialization
  local cleaned_annotations =
    KoInsightAnnotationReader.cleanAnnotations(current_annotations, total_pages)

  annotations_by_book[book_md5] = cleaned_annotations
  logger.info("[Leituras] Prepared", #cleaned_annotations, "annotations for book", book_md5)

  return annotations_by_book
end

-- Clean annotations for JSON serialization
-- Removes unnecessary fields and formats data for server
function KoInsightAnnotationReader.cleanAnnotations(annotations, total_pages)
  local cleaned = {}
  for _, annotation in ipairs(annotations) do
    local cleaned_annotation = {
      datetime = annotation.datetime,
      drawer = annotation.drawer,
      color = annotation.color,
      text = annotation.text,
      note = annotation.note,
      chapter = annotation.chapter,
      pageno = annotation.pageno,
      page = annotation.page,
      total_pages = total_pages,
    }

    -- Include optional fields if present
    if annotation.datetime_updated then
      cleaned_annotation.datetime_updated = annotation.datetime_updated
    end
    if annotation.pos0 then
      cleaned_annotation.pos0 = annotation.pos0
    end
    if annotation.pos1 then
      cleaned_annotation.pos1 = annotation.pos1
    end

    table.insert(cleaned, cleaned_annotation)
  end
  return cleaned
end

-- Get annotations for a specific book file path
function KoInsightAnnotationReader.getAnnotationsForBook(file_path)
  if not file_path then
    logger.warn("[Leituras] No file path provided")
    return nil, nil
  end

  logger.dbg("[Leituras] Reading annotations for:", file_path)

  -- Read-only sidecar open: avoids unintended writes during bulk reads
  local doc_settings = open_sidecar_readonly(file_path)
  if not doc_settings then
    logger.dbg("[Leituras] No doc settings found for:", file_path)
    return nil, nil
  end

  local annotations = doc_settings:readSetting("annotations")
  if not annotations or #annotations == 0 then
    logger.dbg("[Leituras] No annotations found in doc settings")
    return nil, nil
  end

  -- Try to get total pages from doc settings (stored per-book)
  local total_pages = doc_settings:readSetting("doc_pages")

  logger.info("[Leituras] Found", #annotations, "annotations for:", file_path)
  return annotations, total_pages
end

-- Get MD5 hash for a book directly from its sidecar file
function KoInsightAnnotationReader.getMd5ForPath(file_path)
  if not file_path then
    return nil
  end

  -- Read-only sidecar open: avoids unintended writes during bulk reads
  local doc_settings = open_sidecar_readonly(file_path)
  if not doc_settings then
    return nil
  end

  -- Read MD5 directly from sidecar file
  local md5 = doc_settings:readSetting("partial_md5_checksum")

  if md5 then
    logger.dbg("[Leituras] Found MD5 in sidecar:", md5)
  else
    logger.warn("[Leituras] No MD5 checksum found in sidecar for:", file_path)
  end

  return md5
end

return KoInsightAnnotationReader
