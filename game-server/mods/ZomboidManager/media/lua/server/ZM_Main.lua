--
-- ZM_Main.lua — Entry point for ZomboidManager server-side mod
-- Registers PZ event hooks for inventory export, delivery queue, and position tracking.
--

require("ZM_InventoryExporter")
require("ZM_DeliveryQueue")
require("ZM_PlayerTracker")
require("ZM_ItemCatalog")
require("ZM_GameState")
require("ZM_PlayerStats")

print("[ZomboidManager] Initializing server-side bridge mod...")

--- OnCreatePlayer — triggered when a player connects/spawns
local function onCreatePlayer(playerIndex, player)
    if not player then
        return
    end
    print("[ZomboidManager] Player connected: " .. (player:getUsername() or "unknown"))

    -- Export this player's inventory
    ZM_InventoryExporter.exportPlayer(player)

    -- Process any pending deliveries for this player
    ZM_DeliveryQueue.process()
end

--- EveryTenMinutes — periodic bulk export
local function onEveryTenMinutes()
    local count = ZM_InventoryExporter.exportAll()
    if count > 0 then
        print("[ZomboidManager] Exported " .. count .. " player inventories")
    end

    -- Export player positions
    ZM_PlayerTracker.exportPositions()

    -- Export player stats (kills, hours, skills)
    local statsCount = ZM_PlayerStats.exportAll()
    if statsCount > 0 then
        print("[ZomboidManager] Exported stats for " .. statsCount .. " players")
    end
end

--- EveryOneMinute — check delivery queue + update live positions + game state
local function onEveryOneMinute()
    local processed = ZM_DeliveryQueue.process()
    if processed > 0 then
        print("[ZomboidManager] Processed " .. processed .. " delivery entries")
    end

    -- Export player positions every minute for near-real-time map updates
    ZM_PlayerTracker.exportPositions()

    -- Export game state (time, weather, season)
    ZM_GameState.export()
end

--- OnServerStarted — export item catalog once on server boot
local function onServerStarted()
    local count = ZM_ItemCatalog.export()
    if count > 0 then
        print("[ZomboidManager] Exported item catalog: " .. count .. " items")
    else
        print("[ZomboidManager] WARNING: item catalog export returned 0 items")
    end
end

-- Register event hooks
Events.OnCreatePlayer.Add(onCreatePlayer)
Events.EveryTenMinutes.Add(onEveryTenMinutes)
Events.EveryOneMinute.Add(onEveryOneMinute)
Events.OnServerStarted.Add(onServerStarted)

print("[ZomboidManager] Event hooks registered: OnCreatePlayer, EveryTenMinutes, EveryOneMinute, OnServerStarted, GameState")
