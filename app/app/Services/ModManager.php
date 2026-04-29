<?php

namespace App\Services;

class ModManager
{
    /**
     * Workshop IDs of mods that must remain installed for the manager to work.
     * The proprietary ZomboidManager mod provides the Lua bridge used by
     * inventory, delivery, and player-position features — removing it breaks
     * core functionality, so the API/UI refuse to remove these.
     */
    public const PROTECTED_WORKSHOP_IDS = ['3685323705'];

    public function __construct(
        private readonly ServerIniParser $iniParser,
    ) {}

    public static function isProtected(string $workshopId): bool
    {
        return in_array($workshopId, self::PROTECTED_WORKSHOP_IDS, true);
    }

    /**
     * Get the current mod list.
     *
     * Prefers `.mod_state` (the user's intended list, written by add/remove/reorder)
     * over the live INI, because PZ rewrites the INI on shutdown/startup and may
     * leave stale or empty Mods= entries between container restarts. Falls back to
     * the INI when the state file is missing or malformed.
     *
     * @return array<int, array{workshop_id: string, mod_id: string, position: int}>
     */
    public function list(string $iniPath): array
    {
        $state = $this->parseStateFile(dirname($iniPath).'/.mod_state');

        if ($state !== null) {
            $workshopIds = $this->splitList($state['WorkshopItems']);
            $modIds = $this->splitList($state['Mods']);
        } else {
            $config = $this->iniParser->read($iniPath);
            $workshopIds = $this->splitList($config['WorkshopItems'] ?? '');
            $modIds = $this->splitList($config['Mods'] ?? '');
        }

        $mods = [];
        $count = max(count($workshopIds), count($modIds));

        for ($i = 0; $i < $count; $i++) {
            $mods[] = [
                'workshop_id' => $workshopIds[$i] ?? '',
                'mod_id' => $modIds[$i] ?? '',
                'position' => $i,
            ];
        }

        return $mods;
    }

    /**
     * Get the mod list with per-mod load status.
     *
     * Compares `.mod_state` (user intent) against `.mod_state_applied` (the
     * snapshot configure-server.sh wrote when PZ last started) to decide whether
     * each mod is actively running, awaiting a restart, or whether the server is
     * stopped.
     *
     * Statuses:
     *  - 'stopped'         — game server is not running; load state unknown
     *  - 'pending_restart' — mod is in user intent but not in the running config
     *  - 'active'          — mod is in user intent and was applied at last start
     *
     * When `.mod_state_applied` is missing (legacy containers from before this
     * file was written), every mod returned by `list()` is treated as 'active' if
     * the server is running — we can't know what changed since startup without
     * the snapshot.
     *
     * @return array{
     *     mods: array<int, array{workshop_id: string, mod_id: string, position: int, status: string}>,
     *     pending_restart: bool,
     *     server_running: bool,
     *     applied_snapshot_present: bool,
     * }
     */
    public function listWithStatus(string $iniPath, bool $serverRunning): array
    {
        $mods = $this->list($iniPath);
        $applied = $this->parseStateFile(dirname($iniPath).'/.mod_state_applied');
        $appliedWorkshopIds = $applied !== null
            ? $this->splitList($applied['WorkshopItems'])
            : null;

        $pendingRestart = false;

        foreach ($mods as $i => $mod) {
            if (! $serverRunning) {
                $status = 'stopped';
            } elseif ($appliedWorkshopIds === null) {
                $status = 'active';
            } elseif (in_array($mod['workshop_id'], $appliedWorkshopIds, true)) {
                $status = 'active';
            } else {
                $status = 'pending_restart';
                $pendingRestart = true;
            }

            $mods[$i]['status'] = $status;
        }

        if ($serverRunning && $applied !== null) {
            $intentWorkshopIds = array_column($mods, 'workshop_id');
            $removedSinceStart = array_diff($appliedWorkshopIds, $intentWorkshopIds);
            if (! empty($removedSinceStart)) {
                $pendingRestart = true;
            }
        }

        return [
            'mods' => $mods,
            'pending_restart' => $pendingRestart,
            'server_running' => $serverRunning,
            'applied_snapshot_present' => $applied !== null,
        ];
    }

    /**
     * Parse `.mod_state` into its Mods/WorkshopItems values.
     *
     * Returns null when the file is absent, unreadable, or missing either expected
     * line — partial state is rejected so a corrupted file falls back to the INI
     * via the caller, rather than half-trusting it.
     *
     * @return array{Mods: string, WorkshopItems: string}|null
     */
    private function parseStateFile(string $stateFile): ?array
    {
        if (! is_readable($stateFile)) {
            return null;
        }

        $contents = @file_get_contents($stateFile);

        if ($contents === false) {
            return null;
        }

        if (! preg_match('/^Mods=(.*)$/m', $contents, $modsMatch)
            || ! preg_match('/^WorkshopItems=(.*)$/m', $contents, $workshopMatch)) {
            return null;
        }

        return [
            'Mods' => trim($modsMatch[1]),
            'WorkshopItems' => trim($workshopMatch[1]),
        ];
    }

    /**
     * Add a mod to both WorkshopItems and Mods lines.
     */
    public function add(string $iniPath, string $workshopId, string $modId, ?string $mapFolder = null): void
    {
        $config = $this->iniParser->read($iniPath);

        $workshopIds = $this->splitList($config['WorkshopItems'] ?? '');
        $modIds = $this->splitList($config['Mods'] ?? '');

        // Don't add duplicates
        if (in_array($workshopId, $workshopIds, true)) {
            return;
        }

        $workshopIds[] = $workshopId;
        $modIds[] = $modId;

        $updates = [
            'WorkshopItems' => implode(';', $workshopIds),
            'Mods' => implode(';', $modIds),
        ];

        if ($mapFolder !== null) {
            $maps = $this->splitList($config['Map'] ?? 'Muldraugh, KY', ';');
            if (! in_array($mapFolder, $maps, true)) {
                $maps[] = $mapFolder;
                $updates['Map'] = implode(';', $maps);
            }
        }

        $this->writeIniAndState($iniPath, $updates);
    }

    /**
     * Remove a mod by workshop ID from both lines.
     *
     * @return array{workshop_id: string, mod_id: string}|null The removed mod, or null if not found.
     */
    public function remove(string $iniPath, string $workshopId, ?string $mapFolder = null): ?array
    {
        $config = $this->iniParser->read($iniPath);

        $workshopIds = $this->splitList($config['WorkshopItems'] ?? '');
        $modIds = $this->splitList($config['Mods'] ?? '');

        $index = array_search($workshopId, $workshopIds, true);

        if ($index === false) {
            return null;
        }

        $removed = [
            'workshop_id' => $workshopIds[$index],
            'mod_id' => $modIds[$index] ?? '',
        ];

        array_splice($workshopIds, $index, 1);
        array_splice($modIds, $index, 1);

        $updates = [
            'WorkshopItems' => implode(';', $workshopIds),
            'Mods' => implode(';', $modIds),
        ];

        if ($mapFolder !== null) {
            $maps = $this->splitList($config['Map'] ?? '', ';');
            $maps = array_filter($maps, fn ($m) => $m !== $mapFolder);
            $updates['Map'] = implode(';', array_values($maps));
        }

        $this->writeIniAndState($iniPath, $updates);

        return $removed;
    }

    /**
     * Reorder mods by replacing both lines with the given ordered list.
     *
     * @param  array<int, array{workshop_id: string, mod_id: string}>  $orderedMods
     */
    public function reorder(string $iniPath, array $orderedMods): void
    {
        $workshopIds = array_column($orderedMods, 'workshop_id');
        $modIds = array_column($orderedMods, 'mod_id');

        $existing = $this->splitList($this->iniParser->read($iniPath)['WorkshopItems'] ?? '');
        foreach (self::PROTECTED_WORKSHOP_IDS as $required) {
            if (in_array($required, $existing, true) && ! in_array($required, $workshopIds, true)) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'mods' => ["Reorder cannot drop required mod {$required}."],
                ]);
            }
        }

        $this->writeIniAndState($iniPath, [
            'WorkshopItems' => implode(';', $workshopIds),
            'Mods' => implode(';', $modIds),
        ]);
    }

    /**
     * Apply INI updates and write the mod state snapshot atomically. If the
     * state-file write fails, the prior INI content is restored so callers see
     * an all-or-nothing outcome rather than a partially-applied change.
     *
     * @param  array<string, string>  $updates
     */
    private function writeIniAndState(string $iniPath, array $updates): void
    {
        $previousIni = @file_get_contents($iniPath);

        $this->iniParser->write($iniPath, $updates);

        try {
            $this->writeModState($iniPath);
        } catch (\Throwable $e) {
            if ($previousIni !== false) {
                @file_put_contents($iniPath, $previousIni);
            }
            throw $e;
        }
    }

    /**
     * Write a mod state snapshot to the shared volume.
     *
     * This file is read by configure-server.sh on container restart
     * to restore web-UI mod changes that would otherwise be overwritten
     * by the game server image's own configuration logic.
     */
    private function writeModState(string $iniPath): void
    {
        $config = $this->iniParser->read($iniPath);

        $mods = str_replace(["\n", "\r"], '', $config['Mods'] ?? '');
        $workshopItems = str_replace(["\n", "\r"], '', $config['WorkshopItems'] ?? '');

        $stateFile = dirname($iniPath).'/.mod_state';
        $stateDir = dirname($stateFile);
        $contents = "Mods=$mods\nWorkshopItems=$workshopItems\n";
        $tempFile = @tempnam($stateDir, '.mod_state.');

        if ($tempFile === false || dirname($tempFile) !== $stateDir) {
            if ($tempFile !== false) {
                @unlink($tempFile);
            }
            throw new \RuntimeException("Unable to create temporary mod state file in {$stateDir}.");
        }

        try {
            if (@file_put_contents($tempFile, $contents) === false) {
                throw new \RuntimeException("Unable to write temporary mod state file {$tempFile}.");
            }

            if (! @rename($tempFile, $stateFile)) {
                throw new \RuntimeException("Unable to atomically replace mod state file {$stateFile}.");
            }

            @chmod($stateFile, 0644);
        } finally {
            if (is_file($tempFile)) {
                @unlink($tempFile);
            }
        }
    }

    /**
     * @return string[]
     */
    private function splitList(string $value, string $separator = ';'): array
    {
        if ($value === '') {
            return [];
        }

        return array_values(array_filter(
            array_map('trim', explode($separator, $value)),
            fn ($v) => $v !== '',
        ));
    }
}
