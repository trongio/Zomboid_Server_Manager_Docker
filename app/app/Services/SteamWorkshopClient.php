<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Thin client for the public Steam Workshop endpoint
 * `ISteamRemoteStorage/GetPublishedFileDetails`, which does not require
 * an API key. Used by the mod admin UI to derive the PZ `mod_id` from
 * a Workshop file ID by parsing the conventional `Mod ID:` lines that
 * PZ modders put in their description.
 */
class SteamWorkshopClient
{
    private const ENDPOINT = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';

    private const CACHE_TTL_SECONDS = 600;

    public function __construct(private readonly int $timeoutSeconds = 10) {}

    /**
     * Fetch and parse Workshop metadata for a single published file ID.
     *
     * @return array{
     *     workshop_id: string,
     *     title: string,
     *     description: string,
     *     preview_url: ?string,
     *     mod_ids: list<string>,
     *     map_folders: list<string>,
     * }|null  Null when Steam returns a non-success status or the file is missing.
     */
    public function getDetails(string $workshopId): ?array
    {
        $workshopId = trim($workshopId);
        if ($workshopId === '' || ! ctype_digit($workshopId)) {
            return null;
        }

        return Cache::remember(
            "steam_workshop:details:{$workshopId}",
            self::CACHE_TTL_SECONDS,
            fn () => $this->fetchAndParse($workshopId),
        );
    }

    /**
     * @return array{
     *     workshop_id: string,
     *     title: string,
     *     description: string,
     *     preview_url: ?string,
     *     mod_ids: list<string>,
     *     map_folders: list<string>,
     * }|null
     */
    private function fetchAndParse(string $workshopId): ?array
    {
        $response = Http::timeout($this->timeoutSeconds)
            ->asForm()
            ->post(self::ENDPOINT, [
                'itemcount' => 1,
                'publishedfileids[0]' => $workshopId,
            ]);

        if (! $response->successful()) {
            return null;
        }

        $file = $response->json('response.publishedfiledetails.0');
        if (! is_array($file)) {
            return null;
        }

        if (($file['result'] ?? 0) !== 1) {
            return null;
        }

        $title = (string) ($file['title'] ?? '');
        $description = (string) ($file['description'] ?? '');

        return [
            'workshop_id' => $workshopId,
            'title' => $title,
            'description' => $description,
            'preview_url' => isset($file['preview_url']) ? (string) $file['preview_url'] : null,
            'mod_ids' => $this->extractMatches('/Mod\s*ID\s*:\s*([\w.\-]+)/i', $description),
            'map_folders' => $this->extractMatches('/Map\s*Folder\s*:\s*([\w.\-]+)/i', $description),
        ];
    }

    /**
     * Pull unique capture-group-1 matches in the order they appear.
     *
     * @return list<string>
     */
    private function extractMatches(string $pattern, string $haystack): array
    {
        if (! preg_match_all($pattern, $haystack, $matches)) {
            return [];
        }

        return array_values(array_unique(array_map('trim', $matches[1])));
    }
}
