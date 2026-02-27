--
-- ZM_PlayerStats.lua — Exports player stats (kills, hours survived, skills, profession)
-- Writes to Lua/player_stats.json every 10 minutes via EveryTenMinutes hook.
--

local JSON = require("ZM_JSON")

ZM_PlayerStats = {}

local STATS_FILE = "Lua/player_stats.json"

--- Get ISO 8601 timestamp
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

--- Collect all perk levels for a player
local function getSkills(player)
    local skills = {}
    local xp = player:getXp()
    if not xp then
        return skills
    end

    -- Iterate known PZ perks
    local perkList = PerkFactory.PerkList
    if perkList then
        for i = 0, perkList:size() - 1 do
            local perk = perkList:get(i)
            if perk then
                local name = perk:getName() or tostring(perk)
                local level = xp:getLevel(perk)
                if level and level > 0 then
                    skills[name] = level
                end
            end
        end
    end

    return skills
end

--- Get the player's profession
local function getProfession(player)
    local desc = player:getDescriptor()
    if not desc then
        return nil
    end

    local prof = desc:getProfession()
    if prof and prof ~= "" then
        return prof
    end

    return nil
end

--- Export stats for all online players
--- @return number count of players exported
function ZM_PlayerStats.exportAll()
    local onlinePlayers = getOnlinePlayers()
    if not onlinePlayers then
        return 0
    end

    local playerStats = {}
    for i = 0, onlinePlayers:size() - 1 do
        local player = onlinePlayers:get(i)
        if player then
            local username = player:getUsername() or "unknown"

            local zombieKills = 0
            if player.getZombieKills then
                zombieKills = player:getZombieKills() or 0
            end

            local hoursSurvived = 0
            if player.getHoursSurvived then
                hoursSurvived = math.floor((player:getHoursSurvived() or 0) * 10 + 0.5) / 10
            end

            local entry = {
                username = username,
                zombie_kills = zombieKills,
                hours_survived = hoursSurvived,
                profession = getProfession(player),
                skills = getSkills(player),
                is_dead = player:isDead() or false,
            }

            table.insert(playerStats, entry)
        end
    end

    local data = {
        timestamp = getTimestamp(),
        player_count = #playerStats,
        players = playerStats,
    }

    local ok, jsonStr = pcall(JSON.encode, data)
    if not ok then
        print("[ZomboidManager] ERROR encoding player stats: " .. tostring(jsonStr))
        return 0
    end

    local writer = getFileWriter(STATS_FILE, true, false)
    if not writer then
        print("[ZomboidManager] ERROR: cannot write player stats")
        return 0
    end

    writer:write(jsonStr)
    writer:close()

    return #playerStats
end

return ZM_PlayerStats
