<?php

namespace App\Services;

use App\Models\PvpViolation;
use Carbon\Carbon;

class SafeZoneManager
{
    private string $configPath;

    private string $violationsPath;

    public function __construct(
        ?string $configPath = null,
        ?string $violationsPath = null,
    ) {
        $this->configPath = $configPath ?? config('zomboid.lua_bridge.safezone_config');
        $this->violationsPath = $violationsPath ?? config('zomboid.lua_bridge.safezone_violations');
    }

    /**
     * Get the current safe zone configuration.
     *
     * @return array{enabled: bool, zones: array<int, array{id: string, name: string, x1: int, y1: int, x2: int, y2: int}>}
     */
    public function getConfig(): array
    {
        $data = $this->readJsonFile($this->configPath, []);

        return [
            'enabled' => (bool) ($data['enabled'] ?? false),
            'zones' => $data['zones'] ?? [],
        ];
    }

    /**
     * Update the enabled flag for safe zones.
     */
    public function updateConfig(bool $enabled): bool
    {
        $config = $this->getConfig();
        $config['enabled'] = $enabled;

        return $this->writeJsonFileAtomic($this->configPath, $config);
    }

    /**
     * Add a new safe zone.
     *
     * @param  array{id: string, name: string, x1: int, y1: int, x2: int, y2: int}  $zone
     */
    public function addZone(array $zone): bool
    {
        $config = $this->getConfig();
        $config['zones'][] = $zone;

        return $this->writeJsonFileAtomic($this->configPath, $config);
    }

    /**
     * Remove a zone by its ID.
     */
    public function removeZone(string $zoneId): bool
    {
        $config = $this->getConfig();
        $config['zones'] = array_values(array_filter(
            $config['zones'],
            fn (array $zone) => ($zone['id'] ?? '') !== $zoneId,
        ));

        return $this->writeJsonFileAtomic($this->configPath, $config);
    }

    /**
     * Import violations from the Lua JSON file into the database.
     *
     * @return int Number of violations imported
     */
    public function importViolations(): int
    {
        $data = $this->readJsonFile($this->violationsPath, ['violations' => []]);
        $violations = $data['violations'] ?? [];

        if (empty($violations)) {
            return 0;
        }

        $count = 0;
        foreach ($violations as $v) {
            PvpViolation::create([
                'attacker' => $v['attacker'] ?? 'unknown',
                'victim' => $v['victim'] ?? 'unknown',
                'zone_id' => $v['zone_id'] ?? '',
                'zone_name' => $v['zone_name'] ?? 'unknown',
                'attacker_x' => $v['attacker_x'] ?? null,
                'attacker_y' => $v['attacker_y'] ?? null,
                'strike_number' => (int) ($v['strike_number'] ?? 0),
                'status' => 'pending',
                'occurred_at' => isset($v['occurred_at'])
                    ? Carbon::createFromTimestamp($v['occurred_at'])
                    : now(),
            ]);
            $count++;
        }

        // Clear the violations file after import
        $this->writeJsonFileAtomic($this->violationsPath, ['violations' => []]);

        return $count;
    }

    /**
     * Resolve a violation (dismiss or action).
     */
    public function resolveViolation(int $id, string $status, ?string $note, string $resolvedBy): ?PvpViolation
    {
        $violation = PvpViolation::find($id);
        if (! $violation) {
            return null;
        }

        $violation->update([
            'status' => $status,
            'resolution_note' => $note,
            'resolved_by' => $resolvedBy,
            'resolved_at' => now(),
        ]);

        return $violation;
    }

    /**
     * Read and decode a JSON file, returning default on failure.
     */
    private function readJsonFile(string $path, array $default): array
    {
        if (! file_exists($path)) {
            return $default;
        }

        $content = file_get_contents($path);
        if ($content === false) {
            return $default;
        }

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return $default;
        }

        return $data;
    }

    /**
     * Write JSON data atomically using temp file + rename.
     */
    private function writeJsonFileAtomic(string $path, array $data): bool
    {
        $dir = dirname($path);
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $tmpPath = $path.'.tmp.'.getmypid().'.'.bin2hex(random_bytes(4));
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        if (file_put_contents($tmpPath, $json) === false) {
            return false;
        }

        return rename($tmpPath, $path);
    }
}
