--
-- ZM_ItemCatalog.lua — Exports all registered game items to a JSON catalog
-- Writes to: Lua/items_catalog.json
-- Runs once on server start so the Laravel app has a complete item list for autocomplete.
--

local JSON = require("ZM_JSON")

ZM_ItemCatalog = {}

local LUA_DIR = "Lua"
local CATALOG_FILE = LUA_DIR .. "/items_catalog.json"

--- Get ISO 8601 timestamp using PZ's calendar
local function getTimestamp()
    if getGameTime then
        local gt = getGameTime()
        return string.format("%04d-%02d-%02dT%02d:%02d:%02d",
            gt:getYear(), gt:getMonth() + 1, gt:getDay(),
            gt:getHour(), gt:getMinutes(), 0)
    end
    local cal = Calendar.getInstance()
    return string.format("%04d-%02d-%02dT%02d:%02d:%02d",
        cal:get(Calendar.YEAR), cal:get(Calendar.MONTH) + 1, cal:get(Calendar.DAY_OF_MONTH),
        cal:get(Calendar.HOUR_OF_DAY), cal:get(Calendar.MINUTE), cal:get(Calendar.SECOND))
end

--- Export all registered items from ScriptManager to JSON
function ZM_ItemCatalog.export()
    local scriptManager = ScriptManager.instance
    if not scriptManager then
        print("[ZomboidManager] ERROR: ScriptManager not available")
        return 0
    end

    local allItems = scriptManager:getAllItems()
    if not allItems then
        print("[ZomboidManager] ERROR: getAllItems() returned nil")
        return 0
    end

    local items = {}
    local count = 0

    for i = 0, allItems:size() - 1 do
        local script = allItems:get(i)
        if script then
            local fullType = script:getFullName()
            local name = script:getDisplayName() or script:getName() or "Unknown"
            local category = tostring(script:getDisplayCategory() or "General")

            -- Derive icon name: Base.Axe -> Item_Axe, Farming.HandShovel -> Item_HandShovel
            local itemName = script:getName() or ""
            local iconName = "Item_" .. itemName

            table.insert(items, {
                full_type = fullType or "",
                name = name,
                category = category,
                icon_name = iconName,
            })
            count = count + 1
        end
    end

    local data = {
        version = 1,
        timestamp = getTimestamp(),
        item_count = count,
        items = items,
    }

    local ok, jsonStr = pcall(JSON.encode, data)
    if not ok then
        print("[ZomboidManager] ERROR encoding item catalog: " .. tostring(jsonStr))
        return 0
    end

    local writer = getFileWriter(CATALOG_FILE, true, false)
    if not writer then
        print("[ZomboidManager] ERROR: cannot open file writer for item catalog")
        return 0
    end

    writer:write(jsonStr)
    writer:close()

    return count
end

return ZM_ItemCatalog
