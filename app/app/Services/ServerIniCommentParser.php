<?php

namespace App\Services;

/**
 * Parses a live `<NAME>.ini` for the comment-driven metadata PZ writes
 * next to every key:
 *
 *     # First half of the description
 *     # Second half of the description Min: 0 Max: 100 Default: 32
 *     KeyName=value
 *
 * Hint values (`Min:`, `Max:`, `Default:`) can appear on any of the
 * preceding `#` lines and are pulled out. Anything else in the
 * comment block becomes the description. Type is inferred from the
 * raw value (`true|false` -> boolean, digits -> number, comma/
 * semicolon list -> list, else string).
 */
class ServerIniCommentParser
{
    /**
     * @return array<string, array{type: string, description?: string, default?: string|bool|int|float, min?: int|float, max?: int|float, float?: bool}>
     */
    public function parseFile(string $path): array
    {
        if (! is_readable($path)) {
            return [];
        }
        $raw = @file_get_contents($path);
        if (! is_string($raw)) {
            return [];
        }

        return $this->parse($raw);
    }

    /**
     * @return array<string, array{type: string, description?: string, default?: string|bool|int|float, min?: int|float, max?: int|float, float?: bool}>
     */
    public function parse(string $contents): array
    {
        $lines = preg_split("/\r\n|\n|\r/", $contents) ?: [];
        $result = [];
        $pendingComments = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);

            if ($trimmed === '') {
                $pendingComments = [];

                continue;
            }

            if (str_starts_with($trimmed, '#')) {
                $commentBody = ltrim(substr($trimmed, 1));
                if ($commentBody !== '') {
                    $pendingComments[] = $commentBody;
                }

                continue;
            }

            if (! str_contains($trimmed, '=')) {
                $pendingComments = [];

                continue;
            }

            [$key, $value] = explode('=', $trimmed, 2);
            $key = trim($key);
            $value = trim($value);

            if ($key === '' || ! preg_match('/^[A-Za-z][A-Za-z0-9_]*$/', $key)) {
                $pendingComments = [];

                continue;
            }

            $entry = $this->buildEntry($value, $pendingComments);
            $result[$key] = $entry;
            $pendingComments = [];
        }

        return $result;
    }

    /**
     * @param  list<string>  $comments
     * @return array{type: string, description?: string, default?: string|bool|int|float, min?: int|float, max?: int|float, float?: bool}
     */
    private function buildEntry(string $rawValue, array $comments): array
    {
        $entry = ['type' => $this->inferType($rawValue)];

        $hintsPattern = '/\b(Min|Max|Default)\s*:\s*(-?\d+(?:\.\d+)?)/i';
        $descriptionParts = [];
        $sawFloat = false;

        foreach ($comments as $comment) {
            $cleaned = $comment;
            if (preg_match_all($hintsPattern, $comment, $matches, PREG_SET_ORDER)) {
                foreach ($matches as $m) {
                    $hintKey = strtolower($m[1]);
                    $rawNumber = $m[2];
                    if (str_contains($rawNumber, '.')) {
                        $sawFloat = true;
                    }
                    $hintValue = $this->castNumeric($rawNumber);
                    if ($hintKey === 'min') {
                        $entry['min'] = $hintValue;
                    } elseif ($hintKey === 'max') {
                        $entry['max'] = $hintValue;
                    } elseif ($hintKey === 'default') {
                        // Don't override the actual current value; the
                        // catalog `default` is informational only.
                        $entry['default'] = $hintValue;
                    }
                }
                $cleaned = trim(preg_replace($hintsPattern, '', $comment) ?? '');
            }
            if ($cleaned !== '') {
                $descriptionParts[] = $cleaned;
            }
        }

        if ($sawFloat || str_contains($rawValue, '.')) {
            $entry['float'] = true;
        }

        if ($descriptionParts !== []) {
            $entry['description'] = trim(implode(' ', $descriptionParts));
        }

        if (! isset($entry['default'])) {
            $coerced = $this->coerceValue($rawValue, $entry['type']);
            if ($coerced !== null) {
                $entry['default'] = $coerced;
            }
        }

        return $entry;
    }

    private function inferType(string $value): string
    {
        $lower = strtolower($value);
        if ($lower === 'true' || $lower === 'false') {
            return 'boolean';
        }
        if (preg_match('/^-?\d+(\.\d+)?$/', $value) === 1) {
            return 'number';
        }
        if (preg_match('/[;,]/', $value) === 1 && $value !== '') {
            return 'list';
        }

        return 'string';
    }

    private function coerceValue(string $value, string $type): string|bool|int|float|null
    {
        if ($value === '') {
            return null;
        }
        if ($type === 'boolean') {
            return strtolower($value) === 'true';
        }
        if ($type === 'number') {
            if (str_contains($value, '.')) {
                return (float) $value;
            }

            return (int) $value;
        }

        return $value;
    }

    private function castNumeric(string $value): int|float
    {
        if (str_contains($value, '.')) {
            return (float) $value;
        }

        return (int) $value;
    }
}
