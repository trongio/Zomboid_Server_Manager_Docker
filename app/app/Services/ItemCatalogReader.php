<?php

namespace App\Services;

class ItemCatalogReader
{
    private string $catalogPath;

    public function __construct(?string $catalogPath = null)
    {
        $this->catalogPath = $catalogPath ?? config('zomboid.lua_bridge.items_catalog');
    }

    /**
     * Get all items from the catalog.
     *
     * @return array<int, array{full_type: string, name: string, category: string, icon_name: string}>
     */
    public function getAll(): array
    {
        $data = $this->readCatalog();

        return $data['items'] ?? [];
    }

    /**
     * Get a single item by its full type (e.g., "Base.Axe").
     *
     * @return array{full_type: string, name: string, category: string, icon_name: string}|null
     */
    public function getItem(string $fullType): ?array
    {
        foreach ($this->getAll() as $item) {
            if ($item['full_type'] === $fullType) {
                return $item;
            }
        }

        return null;
    }

    /**
     * Search items by name or full_type substring (case-insensitive).
     *
     * @return array<int, array{full_type: string, name: string, category: string, icon_name: string}>
     */
    public function search(string $query): array
    {
        if ($query === '') {
            return $this->getAll();
        }

        $query = mb_strtolower($query);

        return array_values(array_filter(
            $this->getAll(),
            fn (array $item) => str_contains(mb_strtolower($item['name']), $query)
                || str_contains(mb_strtolower($item['full_type']), $query)
        ));
    }

    /**
     * Get the catalog metadata (version, timestamp, item_count).
     *
     * @return array{version: int, timestamp: string, item_count: int}|null
     */
    public function getMeta(): ?array
    {
        $data = $this->readCatalog();
        if ($data === null) {
            return null;
        }

        return [
            'version' => $data['version'] ?? 0,
            'timestamp' => $data['timestamp'] ?? '',
            'item_count' => $data['item_count'] ?? 0,
        ];
    }

    /**
     * Read and decode the catalog JSON file.
     */
    private function readCatalog(): ?array
    {
        if (! file_exists($this->catalogPath)) {
            return null;
        }

        $content = file_get_contents($this->catalogPath);
        if ($content === false) {
            return null;
        }

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return $data;
    }
}
