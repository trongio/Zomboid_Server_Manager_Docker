--
-- ZM_GameState.lua — Exports PZ game state (time, weather, season, temperature)
-- Writes to Lua/game_state.json every 1 minute via EveryOneMinute hook.
--

require("ZM_JSON")

ZM_GameState = {}

--- Get season name from the game time month.
--- PZ seasons: Spring (Mar-May), Summer (Jun-Aug), Autumn (Sep-Nov), Winter (Dec-Feb)
local function getSeason(month)
    if month >= 3 and month <= 5 then
        return "spring"
    elseif month >= 6 and month <= 8 then
        return "summer"
    elseif month >= 9 and month <= 11 then
        return "autumn"
    else
        return "winter"
    end
end

--- Export current game state to JSON file.
--- @return boolean success
function ZM_GameState.export()
    local gt = getGameTime()
    if not gt then
        print("[ZomboidManager] GameState: getGameTime() unavailable")
        return false
    end

    local year = gt:getYear()
    local month = gt:getMonth() + 1 -- PZ months are 0-based
    local day = gt:getDay() + 1     -- PZ days are 0-based
    local hour = gt:getHour()
    local minute = gt:getMinutes()
    local dayOfYear = gt:getDayOfYear()

    local isNight = gt:getNight() > 0.5

    local state = {
        time = {
            year = year,
            month = month,
            day = day,
            hour = hour,
            minute = minute,
            day_of_year = dayOfYear,
            is_night = isNight,
            formatted = string.format("%02d:%02d", hour, minute),
            date = string.format("%04d-%02d-%02d", year, month, day),
        },
        season = getSeason(month),
    }

    -- Climate data (may not be available during early startup)
    local cm = getClimateManager()
    if cm then
        local temp = cm:getAirTemperatureForCharacter()
        local rain = cm:getRainIntensity()
        local fog = cm:getFogIntensity()
        local wind = cm:getWindIntensity()
        local snow = cm:getSnowIntensity()

        state.weather = {
            temperature = math.floor(temp * 10 + 0.5) / 10, -- round to 1 decimal
            rain_intensity = math.floor(rain * 100 + 0.5) / 100,
            fog_intensity = math.floor(fog * 100 + 0.5) / 100,
            wind_intensity = math.floor(wind * 100 + 0.5) / 100,
            snow_intensity = math.floor(snow * 100 + 0.5) / 100,
            is_raining = rain > 0.1,
            is_foggy = fog > 0.2,
            is_snowing = snow > 0.1,
        }

        -- Determine primary weather condition
        if snow > 0.1 then
            state.weather.condition = "snow"
        elseif rain > 0.5 then
            state.weather.condition = "heavy_rain"
        elseif rain > 0.1 then
            state.weather.condition = "rain"
        elseif fog > 0.3 then
            state.weather.condition = "fog"
        elseif isNight then
            state.weather.condition = "night"
        else
            state.weather.condition = "clear"
        end
    end

    -- Timestamp for staleness detection
    local now = os.time()
    state.exported_at = os.date("!%Y-%m-%dT%H:%M:%SZ", now)

    local ok, jsonStr = pcall(json.encode, state)
    if not ok then
        print("[ZomboidManager] GameState: JSON encode error: " .. tostring(jsonStr))
        return false
    end

    local writer = getFileWriter("game_state.json", true, false)
    if not writer then
        print("[ZomboidManager] GameState: cannot open file writer")
        return false
    end

    writer:write(jsonStr)
    writer:close()

    return true
end
