<?php

use App\Services\ItemCatalogReader;

beforeEach(function () {
    $this->fixturePath = dirname(__DIR__).'/fixtures/lua-bridge/items_catalog.json';
    $this->reader = new ItemCatalogReader($this->fixturePath);
});

it('reads all items from catalog', function () {
    $items = $this->reader->getAll();

    expect($items)->toBeArray()
        ->and(count($items))->toBe(8);
});

it('returns empty array when catalog file does not exist', function () {
    $reader = new ItemCatalogReader('/nonexistent/path.json');

    expect($reader->getAll())->toBe([]);
});

it('returns empty array for invalid JSON', function () {
    $tmpFile = sys_get_temp_dir().'/invalid-catalog-'.getmypid().'.json';
    file_put_contents($tmpFile, 'not valid json{{{');

    $reader = new ItemCatalogReader($tmpFile);
    expect($reader->getAll())->toBe([]);

    unlink($tmpFile);
});

it('gets a single item by full type', function () {
    $item = $this->reader->getItem('Base.Axe');

    expect($item)->not->toBeNull()
        ->and($item['name'])->toBe('Axe')
        ->and($item['category'])->toBe('Weapon')
        ->and($item['icon_name'])->toBe('Item_Axe');
});

it('returns null for unknown item type', function () {
    expect($this->reader->getItem('Base.NonExistent'))->toBeNull();
});

it('searches items by name (case-insensitive)', function () {
    $results = $this->reader->search('axe');

    expect($results)->toBeArray()
        ->and(count($results))->toBe(1)
        ->and($results[0]['full_type'])->toBe('Base.Axe');
});

it('searches items by full type', function () {
    $results = $this->reader->search('Farming');

    expect($results)->toBeArray()
        ->and(count($results))->toBe(1)
        ->and($results[0]['full_type'])->toBe('Farming.HandShovel');
});

it('returns all items when search query is empty', function () {
    $results = $this->reader->search('');

    expect(count($results))->toBe(8);
});

it('returns empty array when search has no matches', function () {
    $results = $this->reader->search('zzzznonexistent');

    expect($results)->toBe([]);
});

it('searches with multiple matches', function () {
    $results = $this->reader->search('Base.');

    // All 7 Base.* items should match
    expect(count($results))->toBe(7);
});

it('reads catalog metadata', function () {
    $meta = $this->reader->getMeta();

    expect($meta)->not->toBeNull()
        ->and($meta['version'])->toBe(1)
        ->and($meta['item_count'])->toBe(8)
        ->and($meta['timestamp'])->toBe('2026-01-15T14:30:00');
});

it('returns null metadata when catalog does not exist', function () {
    $reader = new ItemCatalogReader('/nonexistent/path.json');

    expect($reader->getMeta())->toBeNull();
});
