<?php

namespace App\Services;

/**
 * Extracts machine-readable metadata from `<NAME>_SandboxVars.lua`.
 *
 * PZ regenerates that file on every server start with descriptive comments
 * above each option — including `Min: X Max: Y Default: Z` hint lines and
 * enumerated value labels (`-- 1 = Insane`, `-- 2 = Very High`, ...).
 * Mod-supplied options live inside namespaced sub-tables (`SOTO = { ... }`,
 * `Basement = { ... }` etc.) and follow the same convention.
 *
 * The output catalog is keyed `[group => [optionKey => meta]]` where `group`
 * is the namespace label (`__vanilla__` for top-level options that have no
 * sub-table) and `meta` carries the harvested description / range / enum.
 */
class SandboxVarsCommentParser
{
    /**
     * @return array{
     *     vanilla: array<string, array<string, mixed>>,
     *     mods: array<string, array{label: string, options: array<string, array<string, mixed>>}>,
     * }
     */
    public function parseFile(string $path): array
    {
        if (! is_file($path) || ! is_readable($path)) {
            return ['vanilla' => [], 'mods' => []];
        }

        $contents = @file_get_contents($path);
        if ($contents === false) {
            return ['vanilla' => [], 'mods' => []];
        }

        return $this->parseContent($contents);
    }

    /**
     * @return array{
     *     vanilla: array<string, array<string, mixed>>,
     *     mods: array<string, array{label: string, options: array<string, array<string, mixed>>}>,
     * }
     */
    public function parseContent(string $content): array
    {
        $vanilla = [];
        $mods = [];

        $lines = preg_split('/\r?\n/', $content) ?: [];
        $currentNamespace = null;
        $commentBuffer = [];

        foreach ($lines as $rawLine) {
            $line = trim($rawLine);
            if ($line === '' || str_starts_with($line, 'SandboxVars')) {
                continue;
            }

            // Accumulate descriptive comment lines for the next option.
            if (str_starts_with($line, '--')) {
                $commentBuffer[] = ltrim(substr($line, 2));

                continue;
            }

            // End of mod namespace block: `},`
            if (str_starts_with($line, '}')) {
                $currentNamespace = null;
                $commentBuffer = [];

                continue;
            }

            // Mod namespace open: `SOTO = {` (no value on the right side).
            if (preg_match('/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*$/', $line, $nsMatch)) {
                $currentNamespace = $nsMatch[1];
                if (! isset($mods[$currentNamespace])) {
                    $mods[$currentNamespace] = ['label' => $currentNamespace, 'options' => []];
                }
                $commentBuffer = [];

                continue;
            }

            // Option declaration: `Key = value,` (value is not `{`).
            if (preg_match('/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?),?\s*$/', $line, $optMatch)) {
                [, $key, $rawValue] = $optMatch;
                $rawValue = rtrim($rawValue, ',');
                if (str_ends_with($rawValue, '{')) {
                    // Edge case: `Key = {` matched as option — rewind to namespace handling.
                    $currentNamespace = $key;
                    if (! isset($mods[$currentNamespace])) {
                        $mods[$currentNamespace] = ['label' => $currentNamespace, 'options' => []];
                    }
                    $commentBuffer = [];

                    continue;
                }

                $meta = $this->buildMeta($key, $rawValue, $commentBuffer);
                $commentBuffer = [];

                if ($currentNamespace !== null) {
                    $mods[$currentNamespace]['options'][$key] = $meta;
                } else {
                    $vanilla[$key] = $meta;
                }
            }
        }

        return ['vanilla' => $vanilla, 'mods' => $mods];
    }

    /**
     * @param  list<string>  $commentLines
     * @return array<string, mixed>
     */
    private function buildMeta(string $key, string $rawValue, array $commentLines): array
    {
        $rawValue = trim($rawValue);
        $defaultValue = $this->castValue($rawValue);
        $type = $this->inferType($rawValue);

        $description = [];
        $options = [];
        $min = null;
        $max = null;
        $defaultHint = null;

        foreach ($commentLines as $line) {
            $trimmed = trim($line);

            // Enum / choice marker: "1 = Insane", "2 = Very High", "-1 = Disabled"
            if (preg_match('/^(-?\d+)\s*=\s*(.+)$/', $trimmed, $enumMatch)) {
                $options[] = [
                    'value' => (int) $enumMatch[1],
                    'label' => trim($enumMatch[2]),
                ];

                continue;
            }

            // Range hint: "Min: 0 Max: 100 Default: 20" or "Min: 0 Max: 100"
            if (preg_match('/Min\s*:\s*(-?\d+(?:\.\d+)?).*?Max\s*:\s*(-?\d+(?:\.\d+)?)/i', $trimmed, $rangeMatch)) {
                $min = $this->numericCast($rangeMatch[1]);
                $max = $this->numericCast($rangeMatch[2]);
                $cleaned = preg_replace('/Min\s*:\s*-?\d+(?:\.\d+)?\s*Max\s*:\s*-?\d+(?:\.\d+)?\s*(?:Default\s*[:=]\s*\S+)?/i', '', $trimmed) ?? $trimmed;
                $cleaned = trim((string) $cleaned);
                if ($cleaned !== '') {
                    $description[] = $cleaned;
                }

                continue;
            }

            // Default hint: "Default = Normal" or "Default: 7" (no Min/Max)
            if (preg_match('/^Default\s*[:=]\s*(.+)$/i', $trimmed, $defMatch)) {
                $defaultHint = trim($defMatch[1]);

                continue;
            }
            if (preg_match('/(.+?)\s+Default\s*[:=]\s*(.+)$/i', $trimmed, $defMatch)) {
                $description[] = trim($defMatch[1]);
                $defaultHint = trim($defMatch[2]);

                continue;
            }

            $description[] = $trimmed;
        }

        $description = array_values(array_filter($description, fn ($s) => $s !== ''));

        $meta = [
            'type' => count($options) > 1 ? 'enum' : $type,
            'default' => $defaultValue,
        ];

        if ($description !== []) {
            $meta['description'] = implode(' ', $description);
        }
        if ($min !== null && $max !== null) {
            $meta['min'] = $min;
            $meta['max'] = $max;
            // If both Min/Max found, force numeric type even when default was 0/1.
            $meta['type'] = 'number';
        }
        if ($options !== []) {
            $meta['options'] = $options;
        }
        if ($defaultHint !== null) {
            $meta['default_label'] = $defaultHint;
        }

        // Suppress redundant keys.
        unset($key);

        return $meta;
    }

    private function inferType(string $rawValue): string
    {
        $v = strtolower(trim($rawValue));
        if ($v === 'true' || $v === 'false') {
            return 'boolean';
        }
        if (is_numeric($rawValue)) {
            return 'number';
        }

        return 'string';
    }

    private function castValue(string $rawValue): bool|int|float|string
    {
        $v = trim($rawValue);
        if (strcasecmp($v, 'true') === 0) {
            return true;
        }
        if (strcasecmp($v, 'false') === 0) {
            return false;
        }
        if (preg_match('/^-?\d+$/', $v)) {
            return (int) $v;
        }
        if (preg_match('/^-?\d+\.\d+$/', $v)) {
            return (float) $v;
        }
        // Strip surrounding quotes if present.
        if (preg_match('/^"(.*)"$/', $v, $m) || preg_match("/^'(.*)'$/", $v, $m)) {
            return $m[1];
        }

        return $v;
    }

    private function numericCast(string $v): int|float
    {
        return str_contains($v, '.') ? (float) $v : (int) $v;
    }
}
