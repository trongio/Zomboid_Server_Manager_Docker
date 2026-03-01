<?php

use App\Models\GameEvent;
use App\Services\LogExtenderParser;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->tempDir = sys_get_temp_dir().'/log_extender_test_'.uniqid();
    mkdir($this->tempDir, 0755, true);
});

afterEach(function () {
    // Clean up temp files
    $files = glob($this->tempDir.'/*');
    foreach ($files as $file) {
        unlink($file);
    }
    if (is_dir($this->tempDir)) {
        rmdir($this->tempDir);
    }
});

test('isInstalled returns false when no log files exist', function () {
    $parser = new LogExtenderParser($this->tempDir);

    expect($parser->isInstalled())->toBeFalse();
});

test('isInstalled returns true when player log exists', function () {
    file_put_contents($this->tempDir.'/01-01-26_player.txt', '');

    $parser = new LogExtenderParser($this->tempDir);

    expect($parser->isInstalled())->toBeTrue();
});

test('parseAll returns 0 when logs directory missing', function () {
    $parser = new LogExtenderParser('/nonexistent/path');

    expect($parser->parseAll())->toBe(0);
});

test('parses death events from player log', function () {
    $logContent = <<<'LOG'
[20-01-22 04:31:34.042] 76561190000000000 "Alice" died at 10883,10085,0.
[20-01-22 04:35:00.000] 76561190000000001 "Bob" died at 5000,5000,0.
LOG;

    file_put_contents($this->tempDir.'/01-01-22_player.txt', $logContent);

    $parser = new LogExtenderParser($this->tempDir);
    $count = $parser->parseAll();

    expect($count)->toBe(2);
    expect(GameEvent::count())->toBe(2);

    $event = GameEvent::query()->where('player', 'Alice')->first();
    expect($event)->not->toBeNull()
        ->and($event->event_type)->toBe('death')
        ->and($event->player)->toBe('Alice')
        ->and($event->x)->toBe(10883)
        ->and($event->y)->toBe(10085);

    $bob = GameEvent::query()->where('player', 'Bob')->first();
    expect($bob->x)->toBe(5000)
        ->and($bob->y)->toBe(5000);
});

test('parses connect and disconnect events', function () {
    $logContent = <<<'LOG'
[15-03-22 10:00:00.000] 76561190000000000 "Charlie" connected
[15-03-22 11:30:00.000] 76561190000000000 "Charlie" disconnected
LOG;

    file_put_contents($this->tempDir.'/01-01-22_player.txt', $logContent);

    $parser = new LogExtenderParser($this->tempDir);
    $count = $parser->parseAll();

    expect($count)->toBe(2);

    $events = GameEvent::query()->where('player', 'Charlie')->orderBy('id')->get();
    expect($events)->toHaveCount(2)
        ->and($events[0]->event_type)->toBe('connect')
        ->and($events[1]->event_type)->toBe('disconnect');
});

test('parses PvP events from pvp log', function () {
    $logContent = <<<'LOG'
[20-01-22 04:31:34.042] user Alice (10883,10085,0) hit user Bob (10884,10085,0) with Base.Axe damage 50.0
LOG;

    file_put_contents($this->tempDir.'/01-01-22_pvp.txt', $logContent);

    $parser = new LogExtenderParser($this->tempDir);
    $count = $parser->parseAll();

    expect($count)->toBe(1);

    $event = GameEvent::first();
    expect($event->event_type)->toBe('pvp_kill')
        ->and($event->player)->toBe('Alice')
        ->and($event->target)->toBe('Bob')
        ->and($event->x)->toBe(10883)
        ->and($event->y)->toBe(10085)
        ->and($event->details['weapon'])->toBe('Base.Axe')
        ->and($event->details['victim_x'])->toBe(10884)
        ->and($event->details['victim_y'])->toBe(10085);
});

test('parses crafting events from craft log', function () {
    $logContent = <<<'LOG'
[20-01-22 04:31:34.042] 76561190000000000 "Alice" crafted 2 Base.Plank with recipe "Saw Logs" (10883,10085,0).
LOG;

    file_put_contents($this->tempDir.'/01-01-22_craft.txt', $logContent);

    $parser = new LogExtenderParser($this->tempDir);
    $count = $parser->parseAll();

    expect($count)->toBe(1);

    $event = GameEvent::first();
    expect($event->event_type)->toBe('craft')
        ->and($event->player)->toBe('Alice')
        ->and($event->details['item'])->toBe('Base.Plank')
        ->and($event->details['quantity'])->toBe(2)
        ->and($event->details['recipe'])->toBe('Saw Logs');
});

test('incremental parsing does not re-process old lines', function () {
    $logContent = "[20-01-22 04:31:34.042] 76561190000000000 \"Alice\" died at 10883,10085,0.\n";

    file_put_contents($this->tempDir.'/01-01-22_player.txt', $logContent);

    $parser = new LogExtenderParser($this->tempDir);

    // First parse
    $count1 = $parser->parseAll();
    expect($count1)->toBe(1);

    // Second parse (same content, no new lines)
    $count2 = $parser->parseAll();
    expect($count2)->toBe(0);
    expect(GameEvent::count())->toBe(1);
});

test('skips malformed lines gracefully', function () {
    $logContent = <<<'LOG'
This is not a valid log line
[20-01-22 04:31:34.042] 76561190000000000 "Alice" died at 10883,10085,0.
Another invalid line
LOG;

    file_put_contents($this->tempDir.'/01-01-22_player.txt', $logContent);

    $parser = new LogExtenderParser($this->tempDir);
    $count = $parser->parseAll();

    expect($count)->toBe(1);
    expect(GameEvent::count())->toBe(1);
});
