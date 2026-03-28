<?php

declare(strict_types=1);

namespace App\Services;

use InvalidArgumentException;

class RconSanitizer
{
    private const PLAYER_NAME_PATTERN = '/^[a-zA-Z0-9_]{1,50}$/';

    private const ITEM_ID_PATTERN = '/^[a-zA-Z0-9_.]{1,100}$/';

    private const SKILL_PATTERN = '/^[a-zA-Z0-9]{1,50}$/';

    private const VALID_ACCESS_LEVELS = [
        'admin',
        'moderator',
        'overseer',
        'gm',
        'observer',
        'none',
    ];

    /**
     * Validate and return a player name safe for RCON commands.
     *
     * @throws InvalidArgumentException
     */
    public static function playerName(string $name): string
    {
        if (! preg_match(self::PLAYER_NAME_PATTERN, $name)) {
            throw new InvalidArgumentException("Invalid player name: contains disallowed characters or exceeds length limit.");
        }

        return $name;
    }

    /**
     * Sanitize a free-text message for RCON commands by stripping dangerous characters.
     * Removes double quotes and newlines that could break RCON command boundaries.
     */
    public static function message(string $message): string
    {
        return str_replace(['"', "\n", "\r"], '', $message);
    }

    /**
     * Validate and return an item ID safe for RCON commands.
     *
     * @throws InvalidArgumentException
     */
    public static function itemId(string $itemId): string
    {
        if (! preg_match(self::ITEM_ID_PATTERN, $itemId)) {
            throw new InvalidArgumentException("Invalid item ID: must contain only alphanumeric characters, dots, and underscores.");
        }

        return $itemId;
    }

    /**
     * Validate and return a skill name safe for RCON commands.
     *
     * @throws InvalidArgumentException
     */
    public static function skill(string $skill): string
    {
        if (! preg_match(self::SKILL_PATTERN, $skill)) {
            throw new InvalidArgumentException("Invalid skill name: must contain only alphanumeric characters.");
        }

        return $skill;
    }

    /**
     * Validate and return an access level safe for RCON commands.
     *
     * @throws InvalidArgumentException
     */
    public static function accessLevel(string $level): string
    {
        if (! in_array($level, self::VALID_ACCESS_LEVELS, true)) {
            throw new InvalidArgumentException("Invalid access level: must be one of ".implode(', ', self::VALID_ACCESS_LEVELS).'.');
        }

        return $level;
    }
}
