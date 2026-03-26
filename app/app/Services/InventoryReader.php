<?php

namespace App\Services;

class InventoryReader
{
    private string $inventoryDir;

    private string $exportRequestsPath;

    public function __construct(?string $inventoryDir = null, ?string $exportRequestsPath = null)
    {
        $this->inventoryDir = $inventoryDir ?? config('zomboid.lua_bridge.inventory_dir');
        $this->exportRequestsPath = $exportRequestsPath ?? config('zomboid.lua_bridge.export_requests');
    }

    /**
     * Get a player's inventory from their JSON snapshot.
     *
     * @return array{username: string, timestamp: string, items: array<int, array{full_type: string, name: string, category: string, count: int, condition: float, equipped: bool, container: string}>, weight: float, max_weight: float}|null
     */
    public function getPlayerInventory(string $username): ?array
    {
        $filePath = $this->inventoryDir.'/'.$username.'.json';

        if (! file_exists($filePath)) {
            return null;
        }

        $content = file_get_contents($filePath);
        if ($content === false) {
            return null;
        }

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return $data;
    }

    /**
     * List all players that have inventory snapshots.
     *
     * @return array<int, string>
     */
    public function listPlayers(): array
    {
        if (! is_dir($this->inventoryDir)) {
            return [];
        }

        $files = glob($this->inventoryDir.'/*.json');
        if ($files === false) {
            return [];
        }

        return array_map(
            fn (string $file) => pathinfo($file, PATHINFO_FILENAME),
            $files
        );
    }

    /**
     * Get all player inventories.
     *
     * @return array<string, array{username: string, timestamp: string, items: array, weight: float, max_weight: float}>
     */
    public function getAllInventories(): array
    {
        $inventories = [];

        foreach ($this->listPlayers() as $username) {
            $inventory = $this->getPlayerInventory($username);
            if ($inventory !== null) {
                $inventories[$username] = $inventory;
            }
        }

        return $inventories;
    }

    /**
     * Request the Lua mod to export a player's inventory on-demand.
     * Writes to export_requests.json atomically (temp file + rename).
     */
    public function requestExport(string $username): bool
    {
        $existing = [];

        if (file_exists($this->exportRequestsPath)) {
            $content = file_get_contents($this->exportRequestsPath);
            if ($content !== false) {
                $data = json_decode($content, true);
                if (json_last_error() === JSON_ERROR_NONE && isset($data['usernames'])) {
                    $existing = $data['usernames'];
                }
            }
        }

        if (! in_array($username, $existing, true)) {
            $existing[] = $username;
        }

        $payload = [
            'usernames' => $existing,
            'updated_at' => date('c'),
        ];

        $dir = dirname($this->exportRequestsPath);
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $tmpPath = $this->exportRequestsPath.'.tmp.'.getmypid().'.'.bin2hex(random_bytes(4));
        $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        try {
            if (file_put_contents($tmpPath, $json) === false) {
                return false;
            }

            return rename($tmpPath, $this->exportRequestsPath);
        } catch (\Throwable) {
            @unlink($tmpPath);

            return false;
        }
    }
}
