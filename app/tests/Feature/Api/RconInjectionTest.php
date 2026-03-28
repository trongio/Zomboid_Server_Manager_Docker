<?php

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function injectionApiHeaders(): array
{
    return ['X-API-Key' => 'test-key-12345'];
}

beforeEach(function () {
    config(['zomboid.api_key' => 'test-key-12345']);
});

// ── Route constraint rejects malicious player names ──────────────────

it('rejects player name with quotes via route constraint', function () {
    $this->postJson('/api/players/Player"1/kick', [], injectionApiHeaders())
        ->assertNotFound();
});

it('rejects player name with spaces via route constraint', function () {
    $this->postJson('/api/players/Player%201/kick', [], injectionApiHeaders())
        ->assertNotFound();
});

it('rejects player name with semicolons via route constraint', function () {
    $this->postJson('/api/players/Player;quit/ban', [], injectionApiHeaders())
        ->assertNotFound();
});

it('rejects player name with newline via route constraint', function () {
    $this->postJson('/api/players/Player%0Aquit/kick', [], injectionApiHeaders())
        ->assertNotFound();
});

// ── Form validation rejects dangerous characters ─────────────────────

it('rejects kick reason with double quotes', function () {
    $this->postJson('/api/players/Player1/kick', [
        'reason' => 'test "injection" attempt',
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('reason');
});

it('rejects kick reason with newline', function () {
    $this->postJson('/api/players/Player1/kick', [
        'reason' => "test\ninjection",
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('reason');
});

it('rejects broadcast message with double quotes', function () {
    $this->postJson('/api/server/broadcast', [
        'message' => 'test "injection" here',
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

it('rejects broadcast message with newline', function () {
    $this->postJson('/api/server/broadcast', [
        'message' => "line1\nline2",
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

it('rejects additem item_id with semicolons', function () {
    $this->postJson('/api/players/Player1/additem', [
        'item_id' => 'Base.Axe;quit',
        'count' => 1,
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('item_id');
});

it('rejects additem item_id with quotes', function () {
    $this->postJson('/api/players/Player1/additem', [
        'item_id' => 'Base.Axe"',
        'count' => 1,
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('item_id');
});

it('rejects addxp skill with quotes', function () {
    $this->postJson('/api/players/Player1/addxp', [
        'skill' => 'Cooking"',
        'amount' => 100,
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('skill');
});

it('rejects addxp skill with spaces', function () {
    $this->postJson('/api/players/Player1/addxp', [
        'skill' => 'Long Blade',
        'amount' => 100,
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('skill');
});

it('rejects teleport target_player with quotes', function () {
    $this->postJson('/api/players/Player1/teleport', [
        'target_player' => 'Player"2',
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('target_player');
});

it('rejects ban reason with quotes', function () {
    $this->postJson('/api/players/Player1/ban', [
        'reason' => 'cheating"; quit; "',
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('reason');
});

it('rejects restart message with newlines', function () {
    $this->postJson('/api/server/restart', [
        'countdown' => 60,
        'message' => "Restarting\nquit",
    ], injectionApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});
