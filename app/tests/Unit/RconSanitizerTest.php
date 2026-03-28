<?php

use App\Services\RconSanitizer;

describe('playerName', function () {
    it('accepts valid player names', function (string $name) {
        expect(RconSanitizer::playerName($name))->toBe($name);
    })->with([
        'simple' => 'Player1',
        'underscore' => 'test_user',
        'single char' => 'a',
        'numbers' => '12345',
        'mixed case' => 'TestPlayer',
        'max length' => str_repeat('a', 50),
    ]);

    it('rejects invalid player names', function (string $name) {
        RconSanitizer::playerName($name);
    })->with([
        'empty' => '',
        'quotes' => 'Player"1',
        'spaces' => 'Player 1',
        'newline' => "Player\n1",
        'carriage return' => "Player\r1",
        'semicolon' => 'Player;1',
        'too long' => str_repeat('a', 51),
        'backslash' => 'Player\\1',
        'dot' => 'Player.1',
        'dash' => 'Player-1',
    ])->throws(InvalidArgumentException::class);
});

describe('message', function () {
    it('passes clean text unchanged', function (string $input) {
        expect(RconSanitizer::message($input))->toBe($input);
    })->with([
        'simple' => 'Hello survivors!',
        'with dash' => 'Backup in progress -- expect a brief lag',
        'with em dash' => "Rolling back in 60s \u{2014} save your progress!",
        'empty' => '',
        'punctuation' => 'Server restarting for updates.',
        'numbers' => 'Rebooting in 30s',
    ]);

    it('strips double quotes', function () {
        expect(RconSanitizer::message('test "message" here'))->toBe('test message here');
    });

    it('strips newlines', function () {
        expect(RconSanitizer::message("line1\nline2"))->toBe('line1line2');
    });

    it('strips carriage returns', function () {
        expect(RconSanitizer::message("line1\r\nline2"))->toBe('line1line2');
    });

    it('strips mixed dangerous characters', function () {
        expect(RconSanitizer::message("test\"\ninjection\r"))->toBe('testinjection');
    });
});

describe('itemId', function () {
    it('accepts valid item IDs', function (string $id) {
        expect(RconSanitizer::itemId($id))->toBe($id);
    })->with([
        'standard' => 'Base.Axe',
        'long' => 'farming.HandShovel',
        'no dot' => 'Axe',
        'numbers' => 'Base.Item123',
        'underscores' => 'Base.My_Item',
    ]);

    it('rejects invalid item IDs', function (string $id) {
        RconSanitizer::itemId($id);
    })->with([
        'empty' => '',
        'quotes' => 'Base.Axe"',
        'semicolon' => 'Base;Axe',
        'spaces' => 'Base Axe',
        'newline' => "Base\nAxe",
    ])->throws(InvalidArgumentException::class);
});

describe('skill', function () {
    it('accepts valid skill names', function (string $skill) {
        expect(RconSanitizer::skill($skill))->toBe($skill);
    })->with([
        'Carpentry',
        'Cooking',
        'LongBlade',
        'Aiming',
    ]);

    it('rejects invalid skill names', function (string $skill) {
        RconSanitizer::skill($skill);
    })->with([
        'empty' => '',
        'spaces' => 'Long Blade',
        'quotes' => 'Skill"name',
        'dots' => 'Skill.name',
        'semicolon' => 'Skill;drop',
    ])->throws(InvalidArgumentException::class);
});

describe('accessLevel', function () {
    it('accepts valid access levels', function (string $level) {
        expect(RconSanitizer::accessLevel($level))->toBe($level);
    })->with(['admin', 'moderator', 'overseer', 'gm', 'observer', 'none']);

    it('rejects invalid access levels', function (string $level) {
        RconSanitizer::accessLevel($level);
    })->with([
        'unknown' => 'superadmin',
        'capitalized' => 'Admin',
        'empty' => '',
    ])->throws(InvalidArgumentException::class);
});
