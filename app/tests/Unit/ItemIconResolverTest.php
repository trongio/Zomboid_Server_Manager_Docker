<?php

use App\Services\ItemIconResolver;

beforeEach(function () {
    $this->iconsDir = sys_get_temp_dir().'/pz-test-icons-'.getmypid();
    if (! is_dir($this->iconsDir)) {
        mkdir($this->iconsDir, 0755, true);
    }

    $this->resolver = new ItemIconResolver($this->iconsDir);
});

afterEach(function () {
    // Clean up temp icon files
    if (is_dir($this->iconsDir)) {
        array_map('unlink', glob($this->iconsDir.'/*'));
        rmdir($this->iconsDir);
    }
});

it('converts base item type to correct icon filename', function () {
    expect($this->resolver->toIconFilename('Base.Axe'))->toBe('Item_Axe.png');
});

it('converts module item type to correct icon filename', function () {
    expect($this->resolver->toIconFilename('Farming.HandShovel'))->toBe('Item_HandShovel.png');
});

it('handles item type without module prefix', function () {
    expect($this->resolver->toIconFilename('Axe'))->toBe('Item_Axe.png');
});

it('resolves to icon path when file exists', function () {
    // Create a fake icon file
    file_put_contents($this->iconsDir.'/Item_Axe.png', 'fake-png');

    expect($this->resolver->resolve('Base.Axe'))->toBe('/images/items/Item_Axe.png');
});

it('resolves to placeholder when icon file does not exist', function () {
    expect($this->resolver->resolve('Base.Axe'))->toBe('/images/items/placeholder.svg');
});

it('resolves unknown item to placeholder', function () {
    expect($this->resolver->resolve('Unknown.ModdedItem'))->toBe('/images/items/placeholder.svg');
});

it('reports icon existence correctly', function () {
    expect($this->resolver->hasIcon('Base.Axe'))->toBeFalse();

    file_put_contents($this->iconsDir.'/Item_Axe.png', 'fake-png');

    expect($this->resolver->hasIcon('Base.Axe'))->toBeTrue();
});

it('handles complex item names with multiple dots', function () {
    // Only splits on first dot
    expect($this->resolver->toIconFilename('Base.Axe.Special'))->toBe('Item_Axe.Special.png');
});
