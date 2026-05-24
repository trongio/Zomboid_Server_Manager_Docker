/**
 * BACKWARD-COMPAT SHIM для старого `<PzMap />` API.
 *
 * После полного rewrite рендерера (Phase 1 архитектуры) этот файл
 * остаётся как тонкая обёртка над `<PzMapView />` (новая структура
 * `components/pz-map/`). Принимает старые props (markers, zones,
 * drawingMode, eventMarkers) и игнорирует их — Phase 4+ восстановит
 * этот функционал в новой архитектуре.
 *
 * Цель: компиляция страниц `player-map.tsx`, `safe-zones.tsx`,
 * `moderation.tsx`, `portal.tsx` не ломается. Они продолжают рендерить
 * базовую WebGL карту, но без markers/zones overlays. Эти возможности
 * вернутся в Phase 4 без изменения вызывающих pages.
 */

import L from 'leaflet';

import { PzMapView, type PzMapDisplayMode } from './pz-map/pz-map-view';
import type { MapConfig, PlayerMarker } from '@/types/server';

export type { PzMapDisplayMode };

type MarkerAction = 'kick' | 'ban' | 'access' | 'inventory';

export interface ZoneOverlay {
    id: string;
    name: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
}

export interface DrawnZone {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface EventMarker {
    id: number;
    x: number;
    y: number;
    type: string;
    player: string;
    target: string | null;
    label: string;
}

interface PzMapProps {
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
    displayMode?: PzMapDisplayMode;
}

export default function PzMap({ className, displayMode }: PzMapProps) {
    // Phase 1: рендерим базовую WebGL карту с debug viewer.
    // Markers, zones, drawing — вернутся в Phase 4 (Leaflet интеграция).
    return <PzMapView className={className} displayMode={displayMode} />;
}
