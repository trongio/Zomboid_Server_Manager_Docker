<?php

namespace App\Services;

class ModManager
{
    /**
     * Mods that must remain installed for the manager to work, keyed by
     * Workshop ID with the corresponding `mod_id` as the value. The
     * proprietary ZomboidManager mod provides the Lua bridge used by
     * inventory, delivery, and player-position features — removing it
     * breaks core functionality, so the API/UI refuse to remove these
     * and write paths re-attach them automatically if they go missing.
     */
    public const PROTECTED_MODS = [
        '3685323705' => 'ZomboidManager',
    ];

    public function __construct(
        private readonly ServerIniParser $iniParser,
        private readonly ConfigStateManager $configState,
    ) {}

    public static function isProtected(string $workshopId): bool
    {
        return array_key_exists($workshopId, self::PROTECTED_MODS);
    }

    public static function isProtectedModId(string $modId): bool
    {
        return in_array($modId, self::PROTECTED_MODS, true);
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
        $current = $this->readCurrentLists($iniPath);

        return $this->pairEntries(
            $current['workshop_ids'],
            $current['mod_ids'],
            $this->readLinks($iniPath),
        );
    }

    /**
     * Pair the two independent INI lists into displayable rows.
     *
     * PZ keeps `Mods=` and `WorkshopItems=` as separate ordered lists: one Workshop
     * item can ship several mod IDs, and a mod can exist without a Workshop item, so
     * the lists routinely differ in length and position N of one has nothing to do
     * with position N of the other. Pairing is therefore driven by `.mod_links.json`
     * (written whenever a mod is added or imported), which records which mod IDs each
     * Workshop item provides.
     *
     * Rows are emitted one per mod ID, in `Mods=` order, carrying the Workshop ID that
     * provides them (empty when unknown). Workshop IDs that no listed mod claims are
     * appended as their own rows so they stay visible and removable.
     *
     * Whatever the link file does not account for is then matched positionally, but only
     * when the leftovers on both sides come out to the same count — the reading that is
     * correct for the common one-mod-per-Workshop-item setup, and the only one available
     * for lists installed before pairings were recorded. Leftovers of differing counts
     * are genuinely ambiguous, so those rows are left unpaired rather than guessed at.
     *
     * @param  list<string>  $workshopIds
     * @param  list<string>  $modIds
     * @param  array<string, list<string>>  $links
     * @return array<int, array{workshop_id: string, mod_id: string, position: int}>
     */
    private function pairEntries(array $workshopIds, array $modIds, array $links): array
    {
        $owner = [];
        $claimed = [];

        foreach ($workshopIds as $workshopId) {
            foreach ($links[$workshopId] ?? [] as $modId) {
                if (in_array($modId, $modIds, true) && ! isset($owner[$modId])) {
                    $owner[$modId] = $workshopId;
                    $claimed[$workshopId] = true;
                }
            }
        }

        $unowned = array_values(array_filter($modIds, fn ($modId) => ! isset($owner[$modId])));
        $unclaimed = array_values(array_filter($workshopIds, fn ($id) => ! isset($claimed[$id])));

        if (count($unowned) === count($unclaimed)) {
            foreach ($unowned as $i => $modId) {
                $owner[$modId] = $unclaimed[$i];
                $claimed[$unclaimed[$i]] = true;
            }
        }

        $mods = [];

        foreach ($modIds as $modId) {
            $mods[] = [
                'workshop_id' => $owner[$modId] ?? '',
                'mod_id' => $modId,
                'position' => count($mods),
            ];
        }

        foreach ($workshopIds as $workshopId) {
            if (isset($claimed[$workshopId])) {
                continue;
            }

            $mods[] = [
                'workshop_id' => $workshopId,
                'mod_id' => '',
                'position' => count($mods),
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
     * A row is only 'active' when BOTH of its identifiers were in the applied
     * snapshot — the mod ID in `Mods=` and the Workshop ID in `WorkshopItems=`.
     * Rows carry only one of the two when the pairing is unknown, so each side is
     * checked independently and an empty identifier is simply not checked; without
     * that, an unpaired row (no Workshop ID) would report 'pending_restart' forever,
     * no matter how many times the server was restarted.
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
        $appliedModIds = $applied !== null
            ? $this->splitList($applied['Mods'])
            : null;

        $pendingRestart = false;

        foreach ($mods as $i => $mod) {
            if (! $serverRunning) {
                $status = 'stopped';
            } elseif ($applied === null) {
                $status = 'active';
            } elseif ($this->isApplied($mod, $appliedWorkshopIds, $appliedModIds)) {
                $status = 'active';
            } else {
                $status = 'pending_restart';
                $pendingRestart = true;
            }

            $mods[$i]['status'] = $status;
        }

        if ($serverRunning && $applied !== null) {
            $intentWorkshopIds = array_filter(array_column($mods, 'workshop_id'));
            $intentModIds = array_filter(array_column($mods, 'mod_id'));

            if (array_diff($appliedWorkshopIds, $intentWorkshopIds) !== []
                || array_diff($appliedModIds, $intentModIds) !== []) {
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
     * Was this row's mod already loaded by the running server?
     *
     * Each identifier is checked only when the row actually carries it, so a row
     * known by mod ID alone is judged on `Mods=` and one known by Workshop ID
     * alone on `WorkshopItems=`.
     *
     * @param  array{workshop_id: string, mod_id: string}  $mod
     * @param  list<string>  $appliedWorkshopIds
     * @param  list<string>  $appliedModIds
     */
    private function isApplied(array $mod, array $appliedWorkshopIds, array $appliedModIds): bool
    {
        if ($mod['workshop_id'] !== '' && ! in_array($mod['workshop_id'], $appliedWorkshopIds, true)) {
            return false;
        }

        if ($mod['mod_id'] !== '' && ! in_array($mod['mod_id'], $appliedModIds, true)) {
            return false;
        }

        return true;
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
        $current = $this->readCurrentLists($iniPath);
        $workshopIds = $current['workshop_ids'];
        $modIds = $current['mod_ids'];

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
            $config = $this->iniParser->read($iniPath);
            $maps = $this->splitList($config['Map'] ?? 'Muldraugh, KY', ';');
            if (! in_array($mapFolder, $maps, true)) {
                $maps[] = $mapFolder;
                $updates['Map'] = implode(';', $maps);
            }
        }

        $this->writeIniAndState($iniPath, $updates);

        $this->recordLinks($iniPath, [$workshopId => [$modId]]);
    }

    /**
     * Remove a mod by workshop ID from both lines.
     *
     * @return array{workshop_id: string, mod_id: string}|null The removed mod, or null if not found.
     */
    public function remove(string $iniPath, string $workshopId, ?string $mapFolder = null): ?array
    {
        return $this->removeEntry($iniPath, $workshopId, null, $mapFolder);
    }

    /**
     * Remove a single list row, identified by its Workshop ID, its mod ID, or both.
     *
     * Rows are not always paired: a Workshop item can be listed with no mod ID of its
     * own, and a mod ID can be listed with no Workshop item behind it, so removal has
     * to work from whichever identifier the row actually carries. Removing by mod ID
     * drops that entry from `Mods=` and drops its Workshop item too, but only once no
     * other installed mod comes from that same Workshop item — otherwise removing one
     * mod of a multi-mod Workshop item would silently break its siblings.
     *
     * @return array{workshop_id: string, mod_id: string}|null The removed row, or null if nothing matched.
     */
    public function removeEntry(string $iniPath, ?string $workshopId, ?string $modId, ?string $mapFolder = null): ?array
    {
        $workshopId = $workshopId !== null ? trim($workshopId) : '';
        $modId = $modId !== null ? trim($modId) : '';

        if ($workshopId === '' && $modId === '') {
            return null;
        }

        $current = $this->readCurrentLists($iniPath);
        $workshopIds = $current['workshop_ids'];
        $modIds = $current['mod_ids'];
        $links = $this->readLinks($iniPath);

        $targetModIds = $this->modIdsToRemove($workshopId, $modId, $workshopIds, $modIds, $links);

        $workshopIndex = $workshopId !== '' ? array_search($workshopId, $workshopIds, true) : false;

        if ($targetModIds === [] && $workshopIndex === false) {
            return null;
        }

        $modIds = array_values(array_filter($modIds, fn ($id) => ! in_array($id, $targetModIds, true)));

        $removedWorkshopId = '';

        if ($workshopId === '' && $modId !== '') {
            $workshopId = $this->ownerOf($modId, $workshopIds, $links);
            $workshopIndex = $workshopId !== '' ? array_search($workshopId, $workshopIds, true) : false;
        }

        if ($workshopIndex !== false) {
            $stillProvided = array_intersect($links[$workshopId] ?? [], $modIds);

            if ($stillProvided === []) {
                array_splice($workshopIds, $workshopIndex, 1);
                $removedWorkshopId = $workshopId;
                unset($links[$workshopId]);
            }
        }

        foreach ($links as $id => $provided) {
            $links[$id] = array_values(array_diff($provided, $targetModIds));
        }

        $updates = [
            'WorkshopItems' => implode(';', $workshopIds),
            'Mods' => implode(';', $modIds),
        ];

        if ($mapFolder !== null) {
            $config = $this->iniParser->read($iniPath);
            $maps = $this->splitList($config['Map'] ?? '', ';');
            $maps = array_filter($maps, fn ($m) => $m !== $mapFolder);
            $updates['Map'] = implode(';', array_values($maps));
        }

        $this->writeIniAndState($iniPath, $updates);

        $this->writeLinks($iniPath, array_filter($links));

        return [
            'workshop_id' => $removedWorkshopId,
            'mod_id' => $targetModIds[0] ?? '',
        ];
    }

    /**
     * Work out which mod IDs a removal should drop.
     *
     * An explicit mod ID removes just that one. A Workshop-ID-only removal takes every
     * installed mod that Workshop item is known to provide, falling back to the
     * positionally paired mod when no link data exists and the two lists line up —
     * the pre-`.mod_links.json` reading, kept so old installs still remove cleanly.
     *
     * @param  list<string>  $workshopIds
     * @param  list<string>  $modIds
     * @param  array<string, list<string>>  $links
     * @return list<string>
     */
    private function modIdsToRemove(string $workshopId, string $modId, array $workshopIds, array $modIds, array $links): array
    {
        if ($modId !== '') {
            return in_array($modId, $modIds, true) ? [$modId] : [];
        }

        $provided = array_values(array_intersect($links[$workshopId] ?? [], $modIds));

        if ($provided !== []) {
            return $provided;
        }

        if ($links !== [] || count($workshopIds) !== count($modIds)) {
            return [];
        }

        $index = array_search($workshopId, $workshopIds, true);

        return $index !== false && isset($modIds[$index]) ? [$modIds[$index]] : [];
    }

    /**
     * Find the installed Workshop item that provides the given mod ID.
     *
     * @param  list<string>  $workshopIds
     * @param  array<string, list<string>>  $links
     */
    private function ownerOf(string $modId, array $workshopIds, array $links): string
    {
        foreach ($workshopIds as $workshopId) {
            if (in_array($modId, $links[$workshopId] ?? [], true)) {
                return $workshopId;
            }
        }

        return '';
    }

    /**
     * Reorder mods by replacing both lines with the given ordered list.
     *
     * Rows may carry only one of the two identifiers (an unpaired mod, or a Workshop
     * item whose mods are unknown), and one Workshop item may appear on several rows,
     * so each line is rebuilt from the row order with blanks and repeats dropped.
     *
     * @param  array<int, array{workshop_id: string, mod_id: string}>  $orderedMods
     */
    public function reorder(string $iniPath, array $orderedMods): void
    {
        $workshopIds = $this->uniqueNonEmpty(array_column($orderedMods, 'workshop_id'));
        $modIds = $this->uniqueNonEmpty(array_column($orderedMods, 'mod_id'));

        $existing = $this->readCurrentLists($iniPath)['workshop_ids'];
        foreach (array_keys(self::PROTECTED_MODS) as $required) {
            // Cast: PHP coerces numeric-string array keys to int; compare as strings.
            $requiredStr = (string) $required;
            if (in_array($requiredStr, $existing, true) && ! in_array($requiredStr, $workshopIds, true)) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'mods' => ["Reorder cannot drop required mod {$requiredStr}."],
                ]);
            }
        }

        $this->writeIniAndState($iniPath, [
            'WorkshopItems' => implode(';', $workshopIds),
            'Mods' => implode(';', $modIds),
        ]);
    }

    /**
     * Merge a pasted modpack into the current config in one write.
     *
     * PZ treats `Mods=`, `WorkshopItems=`, and `Map=` as three INDEPENDENT ordered
     * lists — a single Workshop item can provide several mod IDs, and some mods have
     * no Workshop ID at all, so the counts routinely differ (a 122-item pack can have
     * 265 mods). Each list is therefore merged on its own: new entries are appended in
     * the order given, existing ones are left untouched (never removed), and duplicates
     * are skipped. Map folders are prepended so modded maps sit ahead of the vanilla
     * base map (PZ resolves overlapping cells in list order, vanilla last).
     *
     * Everything is written through `writeIniAndState`, so the merged lists land in
     * `.mod_state` (authoritative across reboots), ZomboidManager is re-attached, and
     * any Map change is persisted to `.config_state`.
     *
     * `$links` records which mod IDs each Workshop item provides. It is persisted
     * for every entry in the payload, including entries that were already installed,
     * so re-pasting a modpack repairs the pairing of a list imported before the link
     * file existed.
     *
     * @param  list<string>  $workshopIds
     * @param  list<string>  $modIds
     * @param  list<string>  $mapFolders
     * @param  array<string, list<string>>  $links
     * @return array{workshop_added: int, mods_added: int, maps_added: int}
     */
    public function bulkImport(string $iniPath, array $workshopIds, array $modIds, array $mapFolders = [], array $links = []): array
    {
        $current = $this->readCurrentLists($iniPath);

        $this->recordLinks($iniPath, $links);

        [$mergedWorkshop, $workshopAdded] = $this->mergeList($current['workshop_ids'], $workshopIds);
        [$mergedMods, $modsAdded] = $this->mergeList($current['mod_ids'], $modIds);

        $updates = [
            'WorkshopItems' => implode(';', $mergedWorkshop),
            'Mods' => implode(';', $mergedMods),
        ];

        $newMapFolders = [];

        if ($mapFolders !== []) {
            $maps = $this->splitList($this->iniParser->read($iniPath)['Map'] ?? 'Muldraugh, KY', ';');
            $mapSet = array_flip($maps);

            foreach ($mapFolders as $folder) {
                $folder = trim((string) $folder);
                if ($folder === '' || isset($mapSet[$folder])) {
                    continue;
                }
                $mapSet[$folder] = true;
                $newMapFolders[] = $folder;
            }

            if ($newMapFolders !== []) {
                $updates['Map'] = implode(';', array_merge($newMapFolders, $maps));
            }
        }

        if ($workshopAdded === 0 && $modsAdded === 0 && $newMapFolders === []) {
            return ['workshop_added' => 0, 'mods_added' => 0, 'maps_added' => 0];
        }

        $this->writeIniAndState($iniPath, $updates);

        return [
            'workshop_added' => $workshopAdded,
            'mods_added' => $modsAdded,
            'maps_added' => count($newMapFolders),
        ];
    }

    /**
     * Append trimmed, non-empty, not-yet-present items to $current, preserving order.
     *
     * @param  list<string>  $current
     * @param  list<string>  $incoming
     * @return array{0: list<string>, 1: int} The merged list and the number added.
     */
    private function mergeList(array $current, array $incoming): array
    {
        $seen = array_flip($current);
        $added = 0;

        foreach ($incoming as $item) {
            $item = trim((string) $item);
            if ($item === '' || isset($seen[$item])) {
                continue;
            }
            $seen[$item] = true;
            $current[] = $item;
            $added++;
        }

        return [$current, $added];
    }

    /**
     * Read the current Workshop/Mods lists used by `add`, `remove`, and `reorder`.
     *
     * Prefers `.mod_state` (the web-UI's source of truth) over the live INI,
     * because PZ rewrites the INI on shutdown and may prune entries it didn't
     * load. Without this preference, an `add()` call performed while the INI
     * was pruned would silently drop every previously-installed mod.
     *
     * @return array{workshop_ids: list<string>, mod_ids: list<string>}
     */
    private function readCurrentLists(string $iniPath): array
    {
        $state = $this->parseStateFile(dirname($iniPath).'/.mod_state');

        if ($state !== null) {
            return [
                'workshop_ids' => $this->splitList($state['WorkshopItems']),
                'mod_ids' => $this->splitList($state['Mods']),
            ];
        }

        $config = $this->iniParser->read($iniPath);

        return [
            'workshop_ids' => $this->splitList($config['WorkshopItems'] ?? ''),
            'mod_ids' => $this->splitList($config['Mods'] ?? ''),
        ];
    }

    /**
     * Re-attach any protected mods that are absent from the given lists.
     * Mutates both arrays in-place. The protected mod is appended at the
     * end so the user's ordering of optional mods is preserved.
     *
     * @param  list<string>  $workshopIds
     * @param  list<string>  $modIds
     */
    private function ensureProtectedMods(array &$workshopIds, array &$modIds): void
    {
        foreach (self::PROTECTED_MODS as $workshopId => $modId) {
            // PHP coerces numeric string array keys to int, so cast back before
            // comparing against the string Workshop IDs we get from splitList.
            // Without the cast, in_array with strict=true treats int 3685323705
            // and "3685323705" as different and appends a duplicate every write.
            $workshopIdStr = (string) $workshopId;
            if (in_array($workshopIdStr, $workshopIds, true)) {
                continue;
            }
            $workshopIds[] = $workshopIdStr;
            $modIds[] = $modId;
        }
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
        if (isset($updates['WorkshopItems']) && isset($updates['Mods'])) {
            $workshopIds = $this->splitList($updates['WorkshopItems']);
            $modIds = $this->splitList($updates['Mods']);
            $this->ensureProtectedMods($workshopIds, $modIds);
            $updates['WorkshopItems'] = implode(';', $workshopIds);
            $updates['Mods'] = implode(';', $modIds);
        }

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

        // Modded maps append their folder to the INI Map= line, but configure-server.sh
        // rewrites Map= from .config_state on every boot. Persist the change there too,
        // otherwise the modded map folder is dropped on the next container restart while
        // the map's mod survives (via .mod_state). Only Map goes through here — Mods and
        // WorkshopItems are restored from .mod_state, not .config_state.
        if (array_key_exists('Map', $updates)) {
            $this->configState->persistSettings(['Map' => $updates['Map']], $iniPath);
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
     * Record which mod IDs each Workshop item provides, merging into what is stored.
     *
     * @param  array<string, list<string>>  $links
     */
    public function recordWorkshopLinks(string $iniPath, array $links): void
    {
        $this->recordLinks($iniPath, $links);
    }

    /**
     * Read the Workshop-item-to-mod-IDs map from `.mod_links.json`.
     *
     * The file only records pairing; the installed lists themselves stay in the INI
     * and `.mod_state`. A missing or malformed file is not an error — pairing simply
     * falls back to positional, exactly as it did before this file existed.
     *
     * @return array<string, list<string>>
     */
    private function readLinks(string $iniPath): array
    {
        $linkFile = dirname($iniPath).'/.mod_links.json';

        if (! is_readable($linkFile)) {
            return [];
        }

        $contents = @file_get_contents($linkFile);

        if ($contents === false) {
            return [];
        }

        $decoded = json_decode($contents, true);

        if (! is_array($decoded)) {
            return [];
        }

        $links = [];

        foreach ($decoded as $workshopId => $modIds) {
            if (! is_array($modIds)) {
                continue;
            }

            $clean = $this->uniqueNonEmpty(array_map(fn ($id) => is_scalar($id) ? (string) $id : '', $modIds));

            if ($clean !== []) {
                $links[(string) $workshopId] = $clean;
            }
        }

        return $links;
    }

    /**
     * Merge new pairings into `.mod_links.json`.
     *
     * @param  array<string, list<string>>  $links
     */
    private function recordLinks(string $iniPath, array $links): void
    {
        if ($links === []) {
            return;
        }

        $merged = $this->readLinks($iniPath);

        foreach ($links as $workshopId => $modIds) {
            $workshopId = trim((string) $workshopId);

            if ($workshopId === '' || ! is_array($modIds)) {
                continue;
            }

            $clean = $this->uniqueNonEmpty(array_map(fn ($id) => is_scalar($id) ? (string) $id : '', $modIds));

            if ($clean !== []) {
                $merged[$workshopId] = $clean;
            }
        }

        $this->writeLinks($iniPath, $merged);
    }

    /**
     * Write `.mod_links.json` atomically.
     *
     * Pairing is a display and bookkeeping aid, never something PZ reads, so a failed
     * write is swallowed: losing it degrades the UI to positional pairing rather than
     * failing the mod change the caller actually asked for.
     *
     * @param  array<string, list<string>>  $links
     */
    private function writeLinks(string $iniPath, array $links): void
    {
        $linkFile = dirname($iniPath).'/.mod_links.json';

        if ($links === []) {
            @unlink($linkFile);

            return;
        }

        $encoded = json_encode($links, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($encoded === false) {
            return;
        }

        $tempFile = @tempnam(dirname($linkFile), '.mod_links.');

        if ($tempFile === false) {
            return;
        }

        if (@file_put_contents($tempFile, $encoded."\n") === false || ! @rename($tempFile, $linkFile)) {
            @unlink($tempFile);

            return;
        }

        @chmod($linkFile, 0644);
    }

    /**
     * @param  array<int, string>  $values
     * @return list<string>
     */
    private function uniqueNonEmpty(array $values): array
    {
        $seen = [];
        $unique = [];

        foreach ($values as $value) {
            $value = trim($value);

            if ($value === '' || isset($seen[$value])) {
                continue;
            }

            $seen[$value] = true;
            $unique[] = $value;
        }

        return $unique;
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
