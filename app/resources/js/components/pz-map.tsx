import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useRef } from 'react';
import type { DziInfo, MapConfig, PlayerMarker } from '@/types/server';

type MarkerAction = 'kick' | 'ban' | 'access' | 'inventory';

export type ZoneOverlay = {
    id: string;
    name: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
};

export type DrawnZone = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

export type EventMarker = {
    id: number;
    x: number;
    y: number;
    type: string;
    player: string;
    target: string | null;
    label: string;
};

type PzMapProps = {
    markers?: PlayerMarker[];
    mapConfig: MapConfig;
    hasTiles: boolean;
    className?: string;
    interactive?: boolean;
    onMarkerClick?: (marker: PlayerMarker) => void;
    onMarkerAction?: (marker: PlayerMarker, action: MarkerAction) => void;
    zones?: ZoneOverlay[];
    drawingMode?: boolean;
    onZoneDrawn?: (zone: DrawnZone) => void;
    selectedZoneId?: string | null;
    onZoneClick?: (zone: ZoneOverlay) => void;
    eventMarkers?: EventMarker[];
    onEventMarkerClick?: (marker: EventMarker) => void;
    onMapReady?: (map: L.Map) => void;
};

const statusColors: Record<PlayerMarker['status'], string> = {
    online: '#22c55e',
    offline: '#9ca3af',
    dead: '#ef4444',
};

const labelColors: Record<PlayerMarker['status'], string> = {
    online: '#4ade80',
    offline: '#d1d5db',
    dead: '#f87171',
};

function createMarkerIcon(status: PlayerMarker['status'], name: string): L.DivIcon {
    const color = statusColors[status];
    const labelColor = labelColors[status];
    return L.divIcon({
        className: 'pz-marker',
        html: `<div style="display:flex;align-items:center;gap:5px;white-space:nowrap;">
            <div style="
                width: 18px;
                height: 18px;
                min-width: 18px;
                border-radius: 50%;
                background: ${color};
                border: 2px solid white;
                box-shadow: 0 1px 4px rgba(0,0,0,0.5);
            "></div>
            <span style="
                font-size: 13px;
                font-weight: 600;
                color: ${labelColor};
                text-shadow: 0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6);
                pointer-events: none;
            ">${name}</span>
        </div>`,
        iconSize: [140, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12],
    });
}

function createPopupHtml(marker: PlayerMarker): string {
    const statusLabel = `<span style="color: ${statusColors[marker.status]}; text-transform: capitalize; font-size: 12px;">${marker.status}</span>`;
    const coords = `<small style="color: #9ca3af;">X: ${marker.x.toFixed(0)}, Y: ${marker.y.toFixed(0)}, Z: ${marker.z}</small>`;

    const btnStyle = 'display:inline-block;padding:3px 8px;font-size:11px;border-radius:4px;cursor:pointer;border:1px solid #374151;background:#1f2937;color:#e5e7eb;margin:2px;';
    const btnDanger = 'display:inline-block;padding:3px 8px;font-size:11px;border-radius:4px;cursor:pointer;border:1px solid #7f1d1d;background:#991b1b;color:#fecaca;margin:2px;';

    const actions = marker.is_online
        ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:2px;">
            <button class="pz-action" data-action="inventory" style="${btnStyle}">Inventory</button>
            <button class="pz-action" data-action="access" style="${btnStyle}">Access</button>
            <button class="pz-action" data-action="kick" style="${btnStyle}">Kick</button>
            <button class="pz-action" data-action="ban" style="${btnDanger}">Ban</button>
          </div>`
        : `<div style="margin-top:6px;">
            <button class="pz-action" data-action="inventory" style="${btnStyle}">Inventory</button>
          </div>`;

    return `<div style="min-width:140px;">
        <strong style="font-size:13px;">${marker.name}</strong><br/>
        ${statusLabel}<br/>${coords}
        ${actions}
    </div>`;
}

/**
 * Create a DZI tile layer.
 * pzmap2dzi outputs tiles as {z}/{x}_{y}.webp (underscore separator).
 */
function createDziTileLayer(templateUrl: string, options: L.TileLayerOptions): L.TileLayer {
    const Layer = L.TileLayer.extend({
        getTileUrl(coords: L.Coords) {
            return templateUrl
                .replace('{z}', String(coords.z))
                .replace('{x}', String(coords.x))
                .replace('{y}', String(coords.y));
        },
    }) as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer;

    return new Layer(templateUrl, options);
}

/**
 * Create a CRS that maps PZ game coordinates (squares) to DZI tile coordinates.
 *
 * Two modes:
 * - Top-view (sqr=1): Simple linear mapping, PZ coords → pixels 1:1
 * - Isometric (sqr=128): Rotated diamond projection (PZ's 2:1 isometric)
 *
 * The projection converts PZ coords to DZI pixel coords at full resolution.
 * The transformation scales by 1/2^maxNativeZoom so Leaflet tile indices
 * match the DZI pyramid at every zoom level.
 */
function createPzCRS(dzi: DziInfo): L.CRS {
    const scale = 1 / Math.pow(2, dzi.maxNativeZoom);

    if (dzi.isometric) {
        // Isometric: PZ (sx, sy) → diamond rotation → DZI pixels
        // px = (sx - sy) * sqr/2 + x0
        // py = (sx + sy) * sqr/4 + y0 + sqr/4
        const halfSqr = dzi.sqr / 2;
        const quarterSqr = dzi.sqr / 4;
        const yOffset = dzi.y0 + quarterSqr;

        const projection = {
            project(latlng: L.LatLng): L.Point {
                const sx = latlng.lng;
                const sy = -latlng.lat;
                return new L.Point(
                    (sx - sy) * halfSqr + dzi.x0,
                    (sx + sy) * quarterSqr + yOffset,
                );
            },
            unproject(point: L.Point): L.LatLng {
                const pxAdj = (point.x - dzi.x0) / halfSqr;
                const pyAdj = (point.y - yOffset) / quarterSqr;
                const sx = (pxAdj + pyAdj) / 2;
                const sy = (pyAdj - pxAdj) / 2;
                return L.latLng(-sy, sx);
            },
            bounds: L.bounds([0, 0], [dzi.width, dzi.height]),
        };

        return L.Util.extend({}, L.CRS, {
            projection,
            transformation: new L.Transformation(scale, 0, scale, 0),
            scale(zoom: number) { return Math.pow(2, zoom); },
            zoom(s: number) { return Math.log(s) / Math.LN2; },
            infinite: false,
        }) as unknown as L.CRS;
    }

    // Top-view: simple linear mapping
    const pixelScale = dzi.sqr * scale;
    return L.Util.extend({}, L.CRS.Simple, {
        transformation: new L.Transformation(
            pixelScale,
            dzi.x0 * scale,
            -pixelScale,
            -dzi.y0 * scale,
        ),
    });
}

/** Convert a Leaflet LatLng to PZ game coordinates. */
function latLngToPz(ll: L.LatLng): { x: number; y: number } {
    return { x: ll.lng, y: -ll.lat };
}

const eventTypeColors: Record<string, string> = {
    pvp_kill: '#ef4444',
    death: '#9ca3af',
    connect: '#22c55e',
    disconnect: '#f59e0b',
};

export default function PzMap({
    markers = [],
    mapConfig,
    hasTiles,
    className = '',
    interactive = true,
    onMarkerClick,
    onMarkerAction,
    zones,
    drawingMode = false,
    onZoneDrawn,
    selectedZoneId,
    onZoneClick,
    eventMarkers,
    onEventMarkerClick,
    onMapReady,
}: PzMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markersLayerRef = useRef<L.LayerGroup | null>(null);
    const zonesLayerRef = useRef<L.LayerGroup | null>(null);
    const eventsLayerRef = useRef<L.LayerGroup | null>(null);
    const drawStateRef = useRef<{
        drawing: boolean;
        startLatLng: L.LatLng | null;
        previewRect: L.Rectangle | null;
    }>({ drawing: false, startLatLng: null, previewRect: null });

    // Stable refs for callbacks so event handlers always see latest values
    const onZoneDrawnRef = useRef(onZoneDrawn);
    onZoneDrawnRef.current = onZoneDrawn;
    const drawingModeRef = useRef(drawingMode);
    drawingModeRef.current = drawingMode;

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const dzi = mapConfig.dzi;
        const crs = dzi ? createPzCRS(dzi) : L.CRS.Simple;
        const maxNativeZoom = dzi?.maxNativeZoom ?? mapConfig.maxZoom;

        const map = L.map(containerRef.current, {
            crs,
            minZoom: mapConfig.minZoom,
            maxZoom: mapConfig.maxZoom,
            zoomControl: interactive,
            dragging: interactive,
            scrollWheelZoom: interactive,
            doubleClickZoom: interactive,
            touchZoom: interactive,
            boxZoom: false, // Disable boxZoom so shift-drag doesn't conflict with drawing
            keyboard: interactive,
            attributionControl: false,
        });

        // PZ coords: Leaflet uses [lat, lng] = [-y, x]
        const center = L.latLng(-mapConfig.center.y, mapConfig.center.x);
        map.setView(center, mapConfig.defaultZoom);

        if (hasTiles && mapConfig.tileUrl && dzi) {
            createDziTileLayer(mapConfig.tileUrl, {
                tileSize: mapConfig.tileSize,
                minZoom: mapConfig.minZoom,
                maxZoom: mapConfig.maxZoom,
                maxNativeZoom,
                noWrap: true,
            }).addTo(map);
        } else if (!hasTiles) {
            addCoordinateGrid(map);
        }

        const markersLayer = L.layerGroup().addTo(map);
        markersLayerRef.current = markersLayer;

        const zonesLayer = L.layerGroup().addTo(map);
        zonesLayerRef.current = zonesLayer;

        const eventsLayer = L.layerGroup().addTo(map);
        eventsLayerRef.current = eventsLayer;

        mapRef.current = map;

        onMapReady?.(map);

        // Drawing event handlers
        map.on('mousedown', (e: L.LeafletMouseEvent) => {
            if (!drawingModeRef.current) return;
            const state = drawStateRef.current;
            state.drawing = true;
            state.startLatLng = e.latlng;
            map.dragging.disable();

            // Create preview rectangle
            state.previewRect = L.rectangle(
                [e.latlng, e.latlng],
                { color: '#22c55e', weight: 2, fillOpacity: 0.15, dashArray: '6 4' },
            ).addTo(map);
        });

        map.on('mousemove', (e: L.LeafletMouseEvent) => {
            const state = drawStateRef.current;
            if (!state.drawing || !state.startLatLng || !state.previewRect) return;
            state.previewRect.setBounds(L.latLngBounds(state.startLatLng, e.latlng));
        });

        map.on('mouseup', (e: L.LeafletMouseEvent) => {
            const state = drawStateRef.current;
            if (!state.drawing || !state.startLatLng) return;

            const start = latLngToPz(state.startLatLng);
            const end = latLngToPz(e.latlng);

            // Clean up preview
            if (state.previewRect) {
                map.removeLayer(state.previewRect);
                state.previewRect = null;
            }
            state.drawing = false;
            state.startLatLng = null;

            if (interactive) {
                map.dragging.enable();
            }

            // Minimum 10-unit size check prevents accidental micro-zones
            const x1 = Math.round(Math.min(start.x, end.x));
            const y1 = Math.round(Math.min(start.y, end.y));
            const x2 = Math.round(Math.max(start.x, end.x));
            const y2 = Math.round(Math.max(start.y, end.y));

            if (x2 - x1 < 10 || y2 - y1 < 10) return;

            onZoneDrawnRef.current?.({ x1, y1, x2, y2 });
        });

        return () => {
            map.remove();
            mapRef.current = null;
            markersLayerRef.current = null;
            zonesLayerRef.current = null;
            eventsLayerRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Update cursor for drawing mode
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.style.cursor = drawingMode ? 'crosshair' : '';
    }, [drawingMode]);

    // Cancel drawing on Escape
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            const state = drawStateRef.current;
            if (state.previewRect && mapRef.current) {
                mapRef.current.removeLayer(state.previewRect);
            }
            state.drawing = false;
            state.startLatLng = null;
            state.previewRect = null;
            if (interactive && mapRef.current) {
                mapRef.current.dragging.enable();
            }
        }
    }, [interactive]);

    useEffect(() => {
        if (drawingMode) {
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }
    }, [drawingMode, handleKeyDown]);

    // Update markers when data changes
    useEffect(() => {
        const layer = markersLayerRef.current;
        if (!layer) return;

        layer.clearLayers();

        markers.forEach((marker) => {
            const label = marker.name && marker.name !== marker.username
                ? `${marker.name} (${marker.username})`
                : marker.username;
            const icon = createMarkerIcon(marker.status, label);
            const popup = L.popup().setContent(createPopupHtml(marker));
            const lMarker = L.marker([-marker.y, marker.x], { icon })
                .bindPopup(popup)
                .addTo(layer);

            lMarker.on('popupopen', () => {
                const container = popup.getElement();
                if (!container) return;
                container.querySelectorAll<HTMLButtonElement>('.pz-action').forEach((btn) => {
                    btn.addEventListener('click', (ev) => {
                        const action = (ev.currentTarget as HTMLButtonElement).dataset.action as MarkerAction;
                        if (action && onMarkerAction) {
                            onMarkerAction(marker, action);
                            lMarker.closePopup();
                        }
                    });
                });
            });

            if (onMarkerClick) {
                lMarker.on('click', () => onMarkerClick(marker));
            }
        });
    }, [markers, onMarkerClick, onMarkerAction]);

    // Update zone overlays
    useEffect(() => {
        const layer = zonesLayerRef.current;
        if (!layer) return;

        layer.clearLayers();
        if (!zones) return;

        zones.forEach((zone) => {
            const bounds = L.latLngBounds(
                L.latLng(-zone.y1, zone.x1),
                L.latLng(-zone.y2, zone.x2),
            );

            const isSelected = selectedZoneId === zone.id;
            const rect = L.rectangle(bounds, {
                color: zone.color,
                weight: isSelected ? 3 : 2,
                fillOpacity: isSelected ? 0.25 : 0.1,
                dashArray: isSelected ? undefined : '8 4',
            }).addTo(layer);

            rect.bindTooltip(zone.name, {
                permanent: true,
                direction: 'center',
                className: 'pz-zone-tooltip',
            });

            if (onZoneClick) {
                rect.on('click', () => onZoneClick(zone));
            }
        });
    }, [zones, selectedZoneId, onZoneClick]);

    // Update event markers
    useEffect(() => {
        const layer = eventsLayerRef.current;
        if (!layer) return;

        layer.clearLayers();
        if (!eventMarkers) return;

        eventMarkers.forEach((em) => {
            const color = eventTypeColors[em.type] ?? '#9ca3af';
            const circle = L.circleMarker([-em.y, em.x], {
                radius: 7,
                color,
                fillColor: color,
                fillOpacity: 0.7,
                weight: 2,
            }).addTo(layer);

            const typeLabel = em.type.replace('_', ' ');
            const targetInfo = em.target ? `<br/><small>Target: ${em.target}</small>` : '';
            circle.bindPopup(
                `<div style="min-width:120px;">
                    <strong>${em.player}</strong><br/>
                    <span style="color:${color};text-transform:capitalize;">${typeLabel}</span>
                    ${targetInfo}<br/>
                    <small style="color:#9ca3af;">X: ${em.x}, Y: ${em.y}</small>
                </div>`,
            );

            if (onEventMarkerClick) {
                circle.on('click', () => onEventMarkerClick(em));
            }
        });
    }, [eventMarkers, onEventMarkerClick]);

    return <div ref={containerRef} className={`isolate h-full w-full ${className}`} />;
}

function addCoordinateGrid(map: L.Map) {
    const gridStyle: L.PolylineOptions = {
        color: '#374151',
        weight: 0.5,
        opacity: 0.5,
    };

    // Draw grid lines every 1000 PZ units
    for (let coord = 0; coord <= 20000; coord += 1000) {
        // Vertical lines (constant x)
        L.polyline(
            [
                [-0, coord],
                [-20000, coord],
            ],
            gridStyle,
        ).addTo(map);

        // Horizontal lines (constant y)
        L.polyline(
            [
                [-coord, 0],
                [-coord, 20000],
            ],
            gridStyle,
        ).addTo(map);
    }

    // Add coordinate labels at grid intersections for key points
    const labelPoints = [5000, 10000, 15000];
    labelPoints.forEach((x) => {
        labelPoints.forEach((y) => {
            L.marker([-y, x], {
                icon: L.divIcon({
                    className: 'pz-grid-label',
                    html: `<span style="
                        font-size: 10px;
                        color: #6b7280;
                        white-space: nowrap;
                        pointer-events: none;
                    ">${x},${y}</span>`,
                    iconSize: [50, 14],
                    iconAnchor: [25, 7],
                }),
                interactive: false,
            }).addTo(map);
        });
    });
}
