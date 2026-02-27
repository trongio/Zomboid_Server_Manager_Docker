# Plan: Phase 20 — Admin Inventory Management

## Context
**Issue**: Phase 20
**Title**: Admin Inventory Management
**Branch**: `phase-20-inventory-management` (to be created)
**Created**: 2026-02-27

## Issue Description / Specification
View and manage player inventories with item icons via the Lua bridge.

**Item icon pipeline:**
- Download PZ item icons (PNGs) from PZwiki or extract from game files
- Store in `public/images/items/`
- Mapping: `Base.Axe` → `Item_Axe.png`, `Base.Pistol` → `Item_Pistol.png`
- Fallback placeholder icon for unknown/modded items

**Admin Inventory page (`/admin/players/{username}/inventory`):**
- Read inventory from `/pz-data/Lua/inventory/<username>.json` (written by Lua bridge)
- Display items in a grid with item icons
- Item details: name, type, category, condition bar, count
- **Give item:** Searchable item selector with icons + autocomplete → writes to `delivery_queue.json` → delivered on next player login or periodic tick
- **Remove item:** Click item in inventory → confirm → writes remove action to `delivery_queue.json`
- **Delivery status:** Show pending/delivered/failed status for queued actions
- Works for offline players: actions queue up, delivered when player next logs in
- All actions audit-logged

**Laravel services:**
- `InventoryReader` — reads inventory snapshot JSON files (already exists from Phase 18)
- `DeliveryQueueManager` — writes give/remove actions to `delivery_queue.json`, reads results (already exists from Phase 18)
- `ItemIconResolver` — maps item type to icon path with fallback (NEW)

## Technical Discovery

### Existing Services (Phase 18 — reusable as-is)
- `app/Services/InventoryReader.php` — `getPlayerInventory(username)`, `listPlayers()`, `getAllInventories()`
- `app/Services/DeliveryQueueManager.php` — `giveItem()`, `removeItem()`, `readQueue()`, `readResults()`, `cleanupQueue()`, `cleanupResults()`
- Test fixtures at `tests/fixtures/lua-bridge/inventory/TestPlayer.json` and `delivery_queue.json`, `delivery_results.json`
- Unit tests: `InventoryReaderTest.php` (8 tests), `DeliveryQueueManagerTest.php` (15 tests)

### Lua Mod (Phase 18)
- `game-server/mods/ZomboidManager/media/lua/server/ZM_Main.lua` — entry point, event hooks
- `ZM_InventoryExporter.lua` — exports per-player inventory to `Lua/inventory/{username}.json`
- `ZM_DeliveryQueue.lua` — processes delivery queue every 1 minute
- Item catalog export needs a new Lua module (`ZM_ItemCatalog.lua`)

### Inventory Snapshot Format
```json
{
  "username": "TestPlayer",
  "timestamp": "2026-01-15T14:30:00",
  "items": [
    {
      "full_type": "Base.Axe",
      "name": "Axe",
      "category": "Weapon",
      "count": 1,
      "condition": 0.85,
      "equipped": true,
      "container": "inventory"
    }
  ],
  "weight": 5.2,
  "max_weight": 15.0
}
```

### Delivery Queue Entry Format
```json
{
  "id": "uuid",
  "action": "give|remove",
  "username": "PlayerName",
  "item_type": "Base.Axe",
  "count": 1,
  "status": "pending",
  "created_at": "ISO8601"
}
```

### Admin Page Patterns
- Controllers: `app/Http/Controllers/Admin/` with DI, try-catch for offline handling, `Inertia::render()` for pages, `JsonResponse` for actions
- Routes: `routes/web.php` inside `['auth', 'verified', 'admin']` middleware group, `admin.` name prefix
- React pages: `resources/js/pages/admin/`, use `usePoll(5000)`, fetch+CSRF for actions, `router.reload()` after mutations
- Sidebar: `resources/js/components/app-sidebar.tsx` — `adminNavItems` array with lucide icons
- Types: `resources/js/types/server.ts`
- Audit: `AuditLogger::log(actor, action, target, details, ip)` on every mutation

### PZwiki Item Icons
- URL pattern: `https://pzwiki.net/w/images/thumb/{hash}/{hash}/Item_{ItemName}.png/32px-Item_{ItemName}.png`
- Alternative: `https://pzwiki.net/wiki/Special:FilePath/Item_{ItemName}.png` (redirects to full image)
- Mapping rule: `Base.Axe` → strip `Base.` prefix → `Item_Axe.png`
- Module items (e.g., `Farming.HandShovel`) → `Item_HandShovel.png`
- ~4,276 unique item icons available

### Config Paths
- Lua bridge: `config('zomboid.lua_bridge.path')` → `/lua-bridge`
- Inventory dir: `config('zomboid.lua_bridge.inventory_dir')` → `/lua-bridge/inventory`
- Icons will live at `public/images/items/` (web-accessible)

## Decisions

**Locked** (non-negotiable — each maps to at least one action point):
- [L1] Use artisan command to download PZwiki icons → Phase 1, step 3
- [L2] Use Lua mod export for item catalog (auto-sync with game version + mods) → Phase 1, steps 1-2
- [L3] Include Phase 0 for UI/UX design exploration → Phase 0
- [L4] Inventory page at `/admin/players/{username}/inventory` (per-player sub-page) → Phase 2, step 2
- [L5] Give/remove actions use existing DeliveryQueueManager (file-based queue) → Phase 2, step 1
- [L6] All inventory actions audit-logged → Phase 2, step 1

**Deferred** (out of scope — must NOT have action points):
- [D1] Bulk item operations (give to all players) — add in Phase 21 polish if needed
- [D2] Item icon upload/override for modded items — manual icon management later
- [D3] Inventory history/diff tracking — would need DB storage, out of scope

**Discretion** (AI decides during implementation):
- [X1] Whether to add a link from the Players list page or from a dedicated sidebar entry (or both)
- [X2] Grid layout sizing (32px vs 48px icons, columns per row)
- [X3] Whether delivery status shows inline or in a separate tab/section
- [X4] Condition bar styling (color gradient, width)

## Design Decisions

### Selected Layout: Visual Grid (Option A)
- **Stats row** at top: 3 small cards showing total items, weight (current/max), category count
- **Inventory Card** in the middle: filter input + sort dropdown, then responsive item grid
- **Delivery Status Card** at bottom: list of pending/delivered/failed queue entries

### Item Card Style: Compact Card
- 48px item icon on the left, name + category badge on the right
- Condition bar below (colored gradient: green >60%, yellow 30-60%, red <30%)
- Equipped indicator (sword icon) and container name
- Remove button appears on hover (ghost button with Trash2 icon)
- **Grid**: `grid-cols-2` mobile, `sm:grid-cols-3` tablet, `lg:grid-cols-4` desktop

### Give Item Dialog: Combobox Search
- Standard shadcn Dialog with DialogHeader/Footer
- Searchable combobox: type to filter item catalog, results show icon + display name + full_type
- Count input (number, min 1, max 100)
- Cancel + Give Item buttons in footer

### Remove Item Dialog: Simple Confirmation
- Click remove on item card → confirmation Dialog
- Shows item icon, name, full_type
- Count selector (defaults to 1, max = item count in inventory)
- Cancel + Remove Item (destructive variant) buttons

### Delivery Status Panel
- Collapsible card, shows count badge in header
- Each entry: status dot (yellow=pending, green=delivered, red=failed), item name, count, action type, relative timestamp
- Auto-refreshes with page polling

### Component Inventory
**New components** (to create):
- `ItemIcon` — renders item icon img with fallback to placeholder SVG
- `ConditionBar` — colored progress bar (green/yellow/red gradient)
- `GiveItemDialog` — searchable combobox + count input dialog
- `RemoveItemDialog` — confirmation dialog with item details
- `DeliveryStatusPanel` — collapsible list of delivery queue entries

**Reused shadcn/ui components**:
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
- `Badge` (category badges, status badges)
- `Button` (actions, variants: default, outline, ghost, destructive)
- `Dialog`, `DialogHeader`, `DialogTitle`, `DialogContent`, `DialogFooter`
- `Input` (filter, count)
- `Label`
- `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` (sort dropdown)
- `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` (delivery panel)

**Reused patterns**:
- `usePoll(5000)` for live inventory + delivery updates
- fetch + CSRF + `router.reload()` for mutations
- Breadcrumbs: Dashboard → Players → {username} Inventory
- Empty state: centered muted text when no inventory snapshot

**Icons** (from lucide-react):
- `Backpack` — inventory page sidebar/link icon
- `Trash2` — remove item button
- `Plus` — give item button
- `Search` — filter input icon
- `ChevronDown` — collapsible trigger
- `Circle` — status dots
- `Swords` or `Shield` — equipped indicator
- `Package` — container indicator

## Phase 0: UI/UX Design
**Type**: design
### Requirements
- Explore existing admin page components for reuse
- Design the inventory grid, give/remove dialogs, and delivery status panel
- Ensure consistency with existing admin pages (players, mods, config)
### Action Points
- [x] Scan codebase for existing UI components, patterns, spacing, icons
- [x] Generate 5+ distinct mockup variations for the inventory page layout
- [x] Present mockups to user for selection
- [x] Document selected design approach with rationale
- [x] Create component inventory (new vs reused)
### Must-Haves
**Truths**:
- [x] User has reviewed and selected a design direction
**Artifacts**:
- [x] Design Decisions section populated in this plan file
**Links**:
- [x] Existing shadcn/ui components identified for reuse are verified to exist
### Acceptance Criteria
- [x] User has explicitly chosen a mockup direction
- [x] Component inventory distinguishes new components from reused ones
- [x] Design aligns with existing admin app look and feel
### Work Log
- User selected: Visual Grid layout (Option A), Compact cards (Option A), Combobox search dialog (Option A)
- Scanned all admin pages: players, mods, backups, config, player-map
- Verified 26 shadcn/ui components available for reuse
- Documented 5 new components to create, 12 shadcn components to reuse

## Phase 1: Item Catalog & Icon Pipeline
### Requirements
Add a new Lua module that exports all registered game items to a JSON catalog on server startup. Create the `ItemIconResolver` Laravel service that maps item types to icon paths. Build an artisan command to download PZwiki item icons.
### Action Points
- [ ] Create `ZM_ItemCatalog.lua` — iterates `ScriptManager.getAllItems()`, writes `Lua/items_catalog.json` with `full_type`, `name`, `category`, `icon_name` per item
- [ ] Register catalog export in `ZM_Main.lua` — call on `OnGameBoot` or `OnServerStarted` event
- [ ] Create `ItemCatalogReader` service — reads `items_catalog.json` from lua bridge path, provides `getAll()`, `search(query)`, `getItem(fullType)` methods
- [ ] Add `items_catalog` path to `config/zomboid.php` lua_bridge section
- [ ] Create `ItemIconResolver` service — maps `Base.Axe` → `/images/items/Item_Axe.png`, with fallback to placeholder SVG
- [ ] Create `zomboid:download-item-icons` artisan command — downloads PNGs from PZwiki `Special:FilePath/Item_{name}.png` into `public/images/items/`
- [ ] Create placeholder item icon SVG at `public/images/items/placeholder.svg`
- [ ] Write unit tests for `ItemIconResolver` (mapping, fallback)
- [ ] Write unit tests for `ItemCatalogReader` (parsing, search, missing file)
### Must-Haves
**Truths**:
- [ ] `ItemIconResolver` resolves known item types to correct icon paths
- [ ] `ItemIconResolver` returns placeholder path for unknown/modded items
- [ ] `ItemCatalogReader` reads and parses the catalog JSON correctly
- [ ] `ItemCatalogReader::search()` filters items by name/type substring
- [ ] Artisan command downloads icons without errors (tested with mock HTTP)
**Artifacts**:
- [ ] `game-server/mods/ZomboidManager/media/lua/server/ZM_ItemCatalog.lua`
- [ ] `app/Services/ItemCatalogReader.php`
- [ ] `app/Services/ItemIconResolver.php`
- [ ] `app/Console/Commands/DownloadItemIcons.php`
- [ ] `public/images/items/placeholder.svg`
- [ ] `tests/Unit/ItemIconResolverTest.php`
- [ ] `tests/Unit/ItemCatalogReaderTest.php`
- [ ] `tests/fixtures/lua-bridge/items_catalog.json`
**Links**:
- [ ] `ZM_Main.lua` requires and calls `ZM_ItemCatalog`
- [ ] `ItemCatalogReader` reads from `config('zomboid.lua_bridge.items_catalog')`
- [ ] `ItemIconResolver` checks `public_path('images/items/')` for icon files
### Acceptance Criteria
- [ ] `ItemIconResolver::resolve('Base.Axe')` returns `/images/items/Item_Axe.png`
- [ ] `ItemIconResolver::resolve('Unknown.Item')` returns `/images/items/placeholder.svg`
- [ ] `ItemCatalogReader::search('axe')` returns matching items from catalog
- [ ] `ZM_ItemCatalog.lua` exports valid JSON with all ScriptManager items
- [ ] All new unit tests pass
### Test Cases
- ItemIconResolver: known base item → correct path, unknown item → placeholder, module item (e.g., `Farming.HandShovel`) → correct path
- ItemCatalogReader: valid catalog → parsed correctly, missing file → empty array, search with multiple matches, search with no matches
- DownloadItemIcons: mock HTTP responses, skip existing files, handle 404s gracefully
### Work Log

## Phase 2: Inventory Admin Controller & Routes
### Requirements
Create the admin inventory controller with endpoints for viewing player inventory, giving items, removing items, and checking delivery status. Wire up routes, form requests, and audit logging.
### Action Points
- [ ] Create `InventoryController` in `app/Http/Controllers/Admin/` with DI for `InventoryReader`, `DeliveryQueueManager`, `ItemIconResolver`, `ItemCatalogReader`, `AuditLogger`
- [ ] Implement `show(string $username)` — reads inventory snapshot, resolves icons, returns Inertia page with inventory data + item catalog + delivery status
- [ ] Implement `giveItem(Request $request, string $username)` — validates item_type + count, calls `DeliveryQueueManager::giveItem()`, audit logs, returns JSON
- [ ] Implement `removeItem(Request $request, string $username)` — validates item_type + count, calls `DeliveryQueueManager::removeItem()`, audit logs, returns JSON
- [ ] Implement `deliveryStatus(string $username)` — reads queue + results filtered by username, returns JSON
- [ ] Create `GiveItemRequest` form request with validation rules (`item_type` required string, `count` required integer min:1 max:100)
- [ ] Create `RemoveItemRequest` form request
- [ ] Add routes to `routes/web.php` under admin prefix: GET `players/{username}/inventory`, POST `players/{username}/inventory/give`, POST `players/{username}/inventory/remove`, GET `players/{username}/inventory/status`
- [ ] Add link from players list page to each player's inventory page
- [ ] Write feature tests for all inventory endpoints (view, give, remove, status)
### Must-Haves
**Truths**:
- [ ] Admin can view any player's inventory at `/admin/players/{username}/inventory`
- [ ] Give/remove actions write correct entries to delivery queue JSON
- [ ] All mutations are audit-logged with actor, action, target, details
- [ ] Controller returns graceful response when inventory snapshot doesn't exist
- [ ] Validation rejects invalid item types and counts
**Artifacts**:
- [ ] `app/Http/Controllers/Admin/InventoryController.php`
- [ ] `app/Http/Requests/Admin/GiveItemRequest.php`
- [ ] `app/Http/Requests/Admin/RemoveItemRequest.php`
- [ ] `tests/Feature/AdminInventoryTest.php`
**Links**:
- [ ] Routes registered in `routes/web.php` under admin middleware group
- [ ] Controller injects `InventoryReader`, `DeliveryQueueManager`, `ItemIconResolver`, `ItemCatalogReader`, `AuditLogger`
- [ ] Players list page links to `admin.players.inventory` route
### Acceptance Criteria
- [ ] `GET /admin/players/TestPlayer/inventory` returns 200 with Inertia component
- [ ] `POST /admin/players/TestPlayer/inventory/give` with `{item_type: "Base.Axe", count: 1}` creates queue entry and returns 201
- [ ] `POST /admin/players/TestPlayer/inventory/remove` with `{item_type: "Base.Axe", count: 1}` creates queue entry and returns 201
- [ ] `GET /admin/players/TestPlayer/inventory/status` returns delivery queue + results for that player
- [ ] All actions audit-logged
- [ ] All feature tests pass
### Test Cases
- View inventory: player with snapshot → 200 with items, player without snapshot → 200 with empty items
- Give item: valid request → 201 + queue entry, invalid item_type → 422, missing count → 422, unauthenticated → 302
- Remove item: valid request → 201, invalid → 422
- Delivery status: pending entries shown, delivered results shown, mixed statuses
- Audit: give and remove both create audit log entries
### Work Log

## Phase 3: React Inventory Page & Components
### Requirements
Build the React inventory page with item grid, give/remove dialogs, delivery status panel, and searchable item selector with autocomplete. Follow existing admin page patterns.
### Action Points
- [ ] Add TypeScript types to `resources/js/types/server.ts`: `InventoryItem`, `InventorySnapshot`, `DeliveryEntry`, `DeliveryResult`, `ItemCatalogEntry`
- [ ] Create inventory page component at `resources/js/pages/admin/player-inventory.tsx` with item grid, condition bars, category badges, equipped indicators
- [ ] Create `GiveItemDialog` component with searchable item selector, icon preview, count input, submit button
- [ ] Create `RemoveItemDialog` component with item details, count selector, confirmation
- [ ] Create `DeliveryStatusPanel` component showing pending/delivered/failed entries with timestamps
- [ ] Create `ItemIcon` component that renders icon with fallback placeholder
- [ ] Create `ConditionBar` component (colored progress bar: green→yellow→red based on condition value)
- [ ] Add `usePoll(5000)` for live inventory + delivery status updates
- [ ] Wire give/remove actions via fetch + CSRF + `router.reload()`
- [ ] Add inventory link to player rows on the players list page (Backpack icon)
- [ ] Run `vendor/bin/pint --dirty --format agent` on all modified PHP files
- [ ] Run Wayfinder generation if using Wayfinder routes
### Must-Haves
**Truths**:
- [ ] Inventory grid displays all items from snapshot with icons, names, categories
- [ ] Condition bar visually represents item condition (0-100%)
- [ ] Give dialog shows searchable item catalog with icon previews
- [ ] Remove dialog confirms the action before submitting
- [ ] Delivery status panel shows real-time status of queued actions
- [ ] Page works for players with no inventory snapshot (empty state)
- [ ] Page polls every 5 seconds for updates
**Artifacts**:
- [ ] `resources/js/pages/admin/player-inventory.tsx`
- [ ] Updated `resources/js/types/server.ts` with inventory types
- [ ] Updated `resources/js/pages/admin/players.tsx` with inventory link per player
**Links**:
- [ ] Inventory page receives props from `InventoryController::show()`
- [ ] Give/remove actions POST to controller endpoints
- [ ] `ItemIcon` component uses `ItemIconResolver` paths from backend props
- [ ] Player list page links to inventory page via Inertia `<Link>`
### Acceptance Criteria
- [ ] Inventory grid renders items in a responsive grid layout
- [ ] Each item shows: icon, name, category badge, condition bar, equipped indicator, container name
- [ ] Give dialog: type to search → results filter → select item → set count → submit → success
- [ ] Remove dialog: click item → confirm dialog → submit → success
- [ ] Delivery status shows pending (yellow), delivered (green), failed (red) badges
- [ ] Empty state shows message when player has no inventory
- [ ] All interactions feel responsive (loading states, disabled buttons during submit)
### Test Cases
- Rendering: items display correctly, empty state for no items, condition bars at various levels
- Give flow: search filters catalog, selecting item populates form, submission sends POST
- Remove flow: clicking item opens dialog, confirmation sends POST
- Delivery status: pending/delivered/failed badges render correctly
### Work Log

## Phase 4: Fix Issues
{empty — populated by /z-review}

## Phase 5: Documentation
{references /z-docs-update skill}

## Disregarded Issues
{populated by /z-plan --verify and /z-review}