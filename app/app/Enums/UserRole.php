<?php

namespace App\Enums;

enum UserRole: string
{
    case SuperAdmin = 'super_admin';
    case Admin = 'admin';
    case Moderator = 'moderator';
    case Player = 'player';

    /**
     * Map a Project Zomboid in-game access level to the equivalent web role.
     *
     * PZ exposes six access levels (admin, moderator, overseer, gm, observer,
     * none). The web dashboard only distinguishes admin, moderator, and player,
     * so the elevated staff levels collapse onto Moderator and 'none' maps to
     * the regular Player role.
     */
    public static function fromPzAccessLevel(string $level): self
    {
        return match ($level) {
            'admin' => self::Admin,
            'moderator', 'overseer', 'gm', 'observer' => self::Moderator,
            default => self::Player,
        };
    }
}
