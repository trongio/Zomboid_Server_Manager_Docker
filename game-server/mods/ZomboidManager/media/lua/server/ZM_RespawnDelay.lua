--
-- ZM_RespawnDelay.lua — Configurable respawn cooldown enforced server-side.
-- Uses file-based IPC: reads config from Laravel, writes death records, processes resets.
--

local JSON = require("ZM_JSON")

ZM_RespawnDelay = {}

local LUA_DIR = "Lua"
local CONFIG_FILE = LUA_DIR .. "/respawn_config.json"
local DEATHS_FILE = LUA_DIR .. "/respawn_deaths.json"
local RESETS_FILE = LUA_DIR .. "/respawn_resets.json"

-- In-memory state
local config = { enabled = false, delay_minutes = 60 }
local deathRecords = {} -- { username = epoch_timestamp }

--- Read a JSON file and return parsed data or nil
local function readJsonFile(path)
    local reader = getFileReader(path, false)
    if not reader then
        return nil
    end

    local lines = {}
    local line = reader:readLine()
    while line ~= nil do
        table.insert(lines, line)
        line = reader:readLine()
    end
    reader:close()

    local content = table.concat(lines, "")
    if content == "" then
        return nil
    end

    local ok, data = pcall(JSON.decode, content)
    if not ok then
        print("[ZomboidManager] ERROR parsing " .. path .. ": " .. tostring(data))
        return nil
    end

    return data
end

--- Write data to a JSON file
local function writeJsonFile(path, data)
    local ok, jsonStr = pcall(JSON.encode, data)
    if not ok then
        print("[ZomboidManager] ERROR encoding " .. path .. ": " .. tostring(jsonStr))
        return false
    end

    local writer = getFileWriter(path, true, false)
    if not writer then
        print("[ZomboidManager] ERROR: cannot write " .. path)
        return false
    end

    writer:write(jsonStr)
    writer:close()
    return true
end

--- Persist death records to disk
local function saveDeathRecords()
    writeJsonFile(DEATHS_FILE, { deaths = deathRecords })
end

--- Load config from respawn_config.json
local function loadConfig()
    local data = readJsonFile(CONFIG_FILE)
    if data then
        if data.enabled ~= nil then
            config.enabled = data.enabled
        end
        if data.delay_minutes ~= nil then
            config.delay_minutes = tonumber(data.delay_minutes) or 60
        end
    end
end

--- Process reset requests from Laravel
local function processResets()
    local data = readJsonFile(RESETS_FILE)
    if not data or not data.resets then
        return
    end

    local count = 0
    for _, username in ipairs(data.resets) do
        if deathRecords[username] then
            deathRecords[username] = nil
            count = count + 1
        end
    end

    if count > 0 then
        saveDeathRecords()
        print("[ZomboidManager] RespawnDelay: reset " .. count .. " player timer(s)")
    end

    -- Clear the resets file after processing
    writeJsonFile(RESETS_FILE, { resets = {} })
end

--- Clean up expired death records
local function cleanExpired()
    local now = os.time()
    local delaySeconds = config.delay_minutes * 60
    local cleaned = 0

    for username, deathTime in pairs(deathRecords) do
        if (now - deathTime) >= delaySeconds then
            deathRecords[username] = nil
            cleaned = cleaned + 1
        end
    end

    if cleaned > 0 then
        saveDeathRecords()
    end
end

--- Called when a player dies
function ZM_RespawnDelay.onPlayerDeath(player)
    if not player then
        return
    end
    if not config.enabled then
        return
    end

    local username = player:getUsername()
    if not username then
        return
    end

    deathRecords[username] = os.time()
    saveDeathRecords()
    print("[ZomboidManager] RespawnDelay: recorded death for " .. username)
end

--- Called when a player creates a new character (OnCreatePlayer).
--- Returns true if the player was kicked (caller should return early).
function ZM_RespawnDelay.checkRespawnCooldown(player)
    if not player then
        return false
    end
    if not config.enabled then
        return false
    end

    local username = player:getUsername()
    if not username then
        return false
    end

    local deathTime = deathRecords[username]
    if not deathTime then
        return false
    end

    local now = os.time()
    local delaySeconds = config.delay_minutes * 60
    local elapsed = now - deathTime
    local remaining = delaySeconds - elapsed

    if remaining <= 0 then
        -- Cooldown expired, clean up and allow
        deathRecords[username] = nil
        saveDeathRecords()
        return false
    end

    -- Cooldown active — disconnect the player
    local remainingMinutes = math.ceil(remaining / 60)
    local message = "Respawn cooldown: " .. remainingMinutes .. " minute(s) remaining"

    local ok, err = pcall(function()
        player:getNetworkCharacterAI():setConnectionState("fully-connected")
    end)

    local kickOk, kickErr = pcall(function()
        local connection = player:getNetworkCharacterAI()
        if connection and connection.disconnect then
            connection:disconnect(message)
        else
            -- Fallback: use server command to kick
            if ServerAPI and ServerAPI.kick then
                ServerAPI.kick(username, message)
            end
        end
    end)

    if not kickOk then
        print("[ZomboidManager] RespawnDelay: failed to disconnect " .. username .. ": " .. tostring(kickErr))
    else
        print("[ZomboidManager] RespawnDelay: kicked " .. username .. " (" .. remainingMinutes .. " min remaining)")
    end

    return true
end

--- Called every minute: reload config, process resets, clean expired entries
function ZM_RespawnDelay.tick()
    loadConfig()
    processResets()

    if config.enabled then
        cleanExpired()
    end
end

--- Called on server start: load config and persisted death records
function ZM_RespawnDelay.init()
    loadConfig()

    local data = readJsonFile(DEATHS_FILE)
    if data and data.deaths then
        deathRecords = data.deaths
        local count = 0
        for _ in pairs(deathRecords) do
            count = count + 1
        end
        print("[ZomboidManager] RespawnDelay: loaded " .. count .. " death record(s)")
    end

    print("[ZomboidManager] RespawnDelay: initialized (enabled=" .. tostring(config.enabled) .. ", delay=" .. config.delay_minutes .. "min)")
end

return ZM_RespawnDelay
