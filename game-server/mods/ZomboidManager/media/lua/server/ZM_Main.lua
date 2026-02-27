--
-- ZM_Main.lua — Entry point for ZomboidManager server-side mod
-- Registers PZ event hooks for inventory export, delivery queue, and position tracking.
--

require("ZM_InventoryExporter")
require("ZM_DeliveryQueue")
require("ZM_PlayerTracker")
require("ZM_ItemCatalog")

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
end

--- EveryOneMinute — check delivery queue + update live positions
local function onEveryOneMinute()
    local processed = ZM_DeliveryQueue.process()
    if processed > 0 then
        print("[ZomboidManager] Processed " .. processed .. " delivery entries")
    end

    -- Export player positions every minute for near-real-time map updates
    ZM_PlayerTracker.exportPositions()
end

--- OnServerStarted — export item catalog once on server boot
local function onServerStarted()
    local count = ZM_ItemCatalog.export()
    print("[ZomboidManager] Exported item catalog: " .. count .. " items")
end

-- Register event hooks
Events.OnCreatePlayer.Add(onCreatePlayer)
Events.EveryTenMinutes.Add(onEveryTenMinutes)
Events.EveryOneMinute.Add(onEveryOneMinute)
Events.OnServerStarted.Add(onServerStarted)

print("[ZomboidManager] Event hooks registered: OnCreatePlayer, EveryTenMinutes, EveryOneMinute, OnServerStarted")
