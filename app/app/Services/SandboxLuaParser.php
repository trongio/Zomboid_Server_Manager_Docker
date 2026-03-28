<?php

namespace App\Services;

class SandboxLuaParser
{
    /**
     * Parse a PZ SandboxVars.lua file into a nested array.
     *
     * @return array<string, mixed>
     */
    public function read(string $path): array
    {
        if (! is_file($path)) {
            return [];
        }

        $content = file_get_contents($path);

        if ($content === false) {
            return [];
        }

        return $this->parseTable($content);
    }

    /**
     * Write a nested array back to a PZ SandboxVars.lua file.
     * Only updates keys that exist in $updates, preserving all other lines.
     *
     * @param  array<string, mixed>  $updates  Flat or dot-notation keys (e.g., ['ZombieLore.Speed' => 3])
     */
    public function write(string $path, array $updates): void
    {
        if (! is_file($path)) {
            throw new \RuntimeException("Sandbox file not found: {$path}");
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES);

        if ($lines === false) {
            throw new \RuntimeException("Failed to read sandbox file: {$path}");
        }

        // Expand dot-notation keys into nested array
        $nested = $this->expandDotNotation($updates);

        $newLines = $this->updateLines($lines, $nested, null);

        $result = file_put_contents($path, implode("\n", $newLines)."\n");

        if ($result === false) {
            throw new \RuntimeException("Failed to write sandbox file: {$path}");
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function parseTable(string $content): array
    {
        $data = [];
        $lines = explode("\n", $content);

        $stack = [&$data];
        $keyStack = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);

            // Skip empty lines, comments, and the outer wrapper
            if ($trimmed === '' || str_starts_with($trimmed, '--')) {
                continue;
            }

            // Opening: "SandboxVars = {" or "KeyName = {"
            if (preg_match('/^(\w+)\s*=\s*\{/', $trimmed, $m)) {
                $key = $m[1];

                // Skip the root "SandboxVars" wrapper
                if ($key === 'SandboxVars' && $stack === [&$data]) {
                    continue;
                }

                $stack[count($stack) - 1][$key] = [];
                $stack[] = &$stack[count($stack) - 1][$key];
                $keyStack[] = $key;

                continue;
            }

            // Closing brace: "}" or "},"
            if (preg_match('/^\},?$/', $trimmed)) {
                if (count($stack) > 1) {
                    array_pop($stack);
                    array_pop($keyStack);
                }

                continue;
            }

            // Key-value: "Speed = 2," or "XpMultiplier = 1.0,"
            if (preg_match('/^(\w+)\s*=\s*(.+?),?\s*(--.*)?$/', $trimmed, $m)) {
                $key = $m[1];
                $rawValue = trim($m[2]);

                $stack[count($stack) - 1][$key] = $this->parseValue($rawValue);
            }
        }

        return $data;
    }

    private function parseValue(string $value): int|float|bool|string
    {
        // Remove trailing comma
        $value = rtrim($value, ',');

        if ($value === 'true') {
            return true;
        }

        if ($value === 'false') {
            return false;
        }

        // Quoted string
        if (preg_match('/^"(.*)"$/', $value, $m)) {
            return $m[1];
        }

        // Float (contains dot)
        if (is_numeric($value) && str_contains($value, '.')) {
            return (float) $value;
        }

        // Integer
        if (is_numeric($value)) {
            return (int) $value;
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $dotArray
     * @return array<string, mixed>
     */
    private function expandDotNotation(array $dotArray): array
    {
        $result = [];

        foreach ($dotArray as $key => $value) {
            $keys = explode('.', $key);
            $current = &$result;

            foreach ($keys as $k) {
                if (! isset($current[$k])) {
                    $current[$k] = [];
                }
                $current = &$current[$k];
            }

            $current = $value;
        }

        return $result;
    }

    /**
     * @param  string[]  $lines
     * @param  array<string, mixed>  $updates
     * @return string[]
     */
    private function updateLines(array $lines, array $updates, ?string $currentSection): array
    {
        $newLines = [];

        for ($i = 0; $i < count($lines); $i++) {
            $line = $lines[$i];
            $trimmed = trim($line);

            // Check for sub-table opening: "KeyName = {"
            if (preg_match('/^(\s*)(\w+)\s*=\s*\{/', $line, $m)) {
                $indent = $m[1];
                $key = $m[2];

                if ($key !== 'SandboxVars' && isset($updates[$key]) && is_array($updates[$key])) {
                    // Process sub-table lines with nested updates
                    $newLines[] = $line;
                    $i++;
                    $depth = 1;
                    $subLines = [];

                    while ($i < count($lines) && $depth > 0) {
                        $subTrimmed = trim($lines[$i]);
                        if (str_contains($subTrimmed, '{')) {
                            $depth++;
                        }
                        if (preg_match('/^\},?$/', $subTrimmed)) {
                            $depth--;
                        }

                        if ($depth > 0) {
                            $subLines[] = $lines[$i];
                        } else {
                            // Process collected sub-lines with the sub-updates
                            $processed = $this->updateLines($subLines, $updates[$key], $key);
                            $newLines = array_merge($newLines, $processed);
                            $newLines[] = $lines[$i]; // closing brace
                        }

                        $i++;
                    }

                    $i--; // compensate for outer loop increment

                    continue;
                }

                $newLines[] = $line;

                continue;
            }

            // Key-value line: "    Speed = 2,"
            if (preg_match('/^(\s*)(\w+)\s*=\s*(.+?)(,?)\s*(--.*)?$/', $line, $m)) {
                $indent = $m[1];
                $key = $m[2];
                $comma = $m[4];
                $comment = $m[5] ?? '';

                if ($key !== 'SandboxVars' && array_key_exists($key, $updates) && ! is_array($updates[$key])) {
                    $formattedValue = $this->formatValue($updates[$key]);
                    $commentPart = $comment !== '' ? " {$comment}" : '';
                    $newLines[] = "{$indent}{$key} = {$formattedValue}{$comma}{$commentPart}";

                    continue;
                }
            }

            $newLines[] = $line;
        }

        return $newLines;
    }

    private function formatValue(int|float|bool|string $value): string
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if (is_float($value)) {
            return rtrim(rtrim(number_format($value, 10, '.', ''), '0'), '.');
        }

        if (is_int($value)) {
            return (string) $value;
        }

        // Handle boolean strings from form input
        if ($value === 'true' || $value === 'false') {
            return $value;
        }

        // Handle numeric strings from form input — write as unquoted numbers
        if (is_numeric($value)) {
            if (str_contains($value, '.')) {
                return rtrim(rtrim(number_format((float) $value, 10, '.', ''), '0'), '.');
            }

            return $value;
        }

        // Defense-in-depth: escape backslashes first, then double quotes
        $escaped = str_replace('\\', '\\\\', $value);
        $escaped = str_replace('"', '\\"', $escaped);

        return "\"{$escaped}\"";
    }
}
