<?php

namespace App\Services;

class ModManager
{
    public function __construct(
        private readonly ServerIniParser $iniParser,
    ) {}

    /**
     * Get the current mod list parsed from server.ini.
     *
     * @return array<int, array{workshop_id: string, mod_id: string, position: int}>
     */
    public function list(string $iniPath): array
    {
        $config = $this->iniParser->read($iniPath);

        $workshopIds = $this->splitList($config['WorkshopItems'] ?? '');
        $modIds = $this->splitList($config['Mods'] ?? '');

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

        $this->iniParser->write($iniPath, $updates);
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

        $this->iniParser->write($iniPath, $updates);

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

        $this->iniParser->write($iniPath, [
            'WorkshopItems' => implode(';', $workshopIds),
            'Mods' => implode(';', $modIds),
        ]);
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
