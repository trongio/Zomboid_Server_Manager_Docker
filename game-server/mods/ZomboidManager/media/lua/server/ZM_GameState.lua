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
        return false
    end

    local ok1, year = pcall(function() return gt:getYear() end)
    local ok2, month = pcall(function() return gt:getMonth() end)
    local ok3, day = pcall(function() return gt:getDay() end)
    local ok4, hour = pcall(function() return gt:getHour() end)
    local ok5, minute = pcall(function() return gt:getMinutes() end)

    if not ok1 then year = 0 end
    if ok2 then month = month + 1 else month = 1 end
    if ok3 then day = day + 1 else day = 1 end
    if not ok4 then hour = 0 end
    if not ok5 then minute = 0 end

    local isNight = false
    local okN, nightVal = pcall(function() return gt:getNight() end)
    if okN and nightVal then isNight = nightVal > 0.5 end

    -- Calculate day of year from month and day
    local daysInMonth = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
    local dayOfYear = 0
    for i = 1, month - 1 do
        dayOfYear = dayOfYear + (daysInMonth[i] or 30)
    end
    dayOfYear = dayOfYear + day

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
    local okCM, cm = pcall(getClimateManager)
    if okCM and cm then
        local okTemp, temp = pcall(function() return cm:getTemperature() end)
        local okRain, rain = pcall(function() return cm:getRainIntensity() end)
        local okFog, fog = pcall(function() return cm:getFogIntensity() end)
        local okWind, wind = pcall(function() return cm:getWindIntensity() end)
        local okSnow, snow = pcall(function() return cm:getSnowIntensity() end)

        if not okTemp then temp = 0 end
        if not okRain then rain = 0 end
        if not okFog then fog = 0 end
        if not okWind then wind = 0 end
        if not okSnow then snow = 0 end

        state.weather = {
            temperature = math.floor(temp * 10 + 0.5) / 10,
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

    local okT, now = pcall(os.time)
    if okT then
        state.exported_at = os.date("!%Y-%m-%dT%H:%M:%SZ", now)
    else
        state.exported_at = "unknown"
    end

    local encOk, jsonStr = pcall(json.encode, state)
    if not encOk then
        print("[ZomboidManager] GameState: JSON encode error: " .. tostring(jsonStr))
        return false
    end

    local writer = getFileWriter("game_state.json", true, false)
    if not writer then
        return false
    end

    writer:write(jsonStr)
    writer:close()
    return true
end
