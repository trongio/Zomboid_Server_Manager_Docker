<?php

namespace App\Services;

class ConfigImporter
{
    /**
     * Keys that cannot be imported for server.ini.
     * RCON settings would break connectivity if changed without .env update.
     * Mods/WorkshopItems are managed via ModManager to maintain paired-list integrity.
     *
     * @var array<string, string>
     */
    private const SKIPPED_SERVER_KEYS = [
        'RCONPort' => 'Managed via environment variables',
        'RCONPassword' => 'Managed via environment variables',
        'Mods' => 'Managed on the Mods page',
        'WorkshopItems' => 'Managed on the Mods page',
    ];

    public function __construct(
        private readonly ServerIniParser $iniParser,
        private readonly SandboxLuaParser $luaParser,
    ) {}

    /**
     * Parse imported content and diff against current config.
     *
     * @return array{changed: array<string, array{current: string, new: string}>, added: array<string, string>, skipped: array<string, array{value: string, reason: string}>, unchanged: int}
     */
    public function preview(string $type, string $content): array
    {
        $imported = $this->parse($type, $content);
        $current = $this->readCurrent($type);

        $changed = [];
        $added = [];
        $skipped = [];
        $unchanged = 0;

        $skipKeys = $type === 'server' ? self::SKIPPED_SERVER_KEYS : [];

        foreach ($imported as $key => $newValue) {
            $newValueStr = (string) $newValue;

            if (isset($skipKeys[$key])) {
                $skipped[$key] = [
                    'value' => $newValueStr,
                    'reason' => $skipKeys[$key],
                ];

                continue;
            }

            if (! array_key_exists($key, $current)) {
                $added[$key] = $newValueStr;

                continue;
            }

            if ((string) $current[$key] !== $newValueStr) {
                $changed[$key] = [
                    'current' => (string) $current[$key],
                    'new' => $newValueStr,
                ];

                continue;
            }

            $unchanged++;
        }

        return [
            'changed' => $changed,
            'added' => $added,
            'skipped' => $skipped,
            'unchanged' => $unchanged,
        ];
    }

    /**
     * Apply imported settings through the existing write pipeline.
     *
     * @param  array<string, string>  $settings
     * @return string[]  Updated field keys
     */
    public function apply(string $type, array $settings): array
    {
        if ($type === 'server') {
            $path = config('zomboid.paths.server_ini');
            $this->iniParser->write($path, $settings);
        } else {
            $path = config('zomboid.paths.sandbox_lua');
            $this->luaParser->write($path, $settings);
        }

        return array_keys($settings);
    }

    /**
     * @return array<string, mixed>
     */
    private function parse(string $type, string $content): array
    {
        if ($type === 'server') {
            return $this->iniParser->parseContent($content);
        }

        return $this->flattenSandbox($this->luaParser->parseContent($content));
    }

    /**
     * @return array<string, mixed>
     */
    private function readCurrent(string $type): array
    {
        if ($type === 'server') {
            return $this->iniParser->read(config('zomboid.paths.server_ini'));
        }

        return $this->flattenSandbox($this->luaParser->read(config('zomboid.paths.sandbox_lua')));
    }

    /**
     * Flatten nested sandbox config to dot-notation for comparison.
     *
     * @param  array<string, mixed>  $data
     * @param  string  $prefix
     * @return array<string, string>
     */
    private function flattenSandbox(array $data, string $prefix = ''): array
    {
        $flat = [];

        foreach ($data as $key => $value) {
            $fullKey = $prefix !== '' ? "$prefix.$key" : $key;

            if (is_array($value)) {
                $flat = array_merge($flat, $this->flattenSandbox($value, $fullKey));
            } else {
                $flat[$fullKey] = (string) $value;
            }
        }

        return $flat;
    }
}
