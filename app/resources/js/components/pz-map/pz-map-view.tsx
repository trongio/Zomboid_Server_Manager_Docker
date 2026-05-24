/**
 * <PzMapView /> — root React-компонент новой архитектуры рендера карты.
 *
 * Phase 1-3: создаёт canvas, монтирует PzMapRenderer, рисует
 * progress overlay во время preload. После ready — debug viewer с
 * двумя режимами:
 *   - 'atlas': пролистывание atlas pages (Phase 1)
 *   - 'cell':  рендеринг одной cell во весь canvas (Phase 3)
 *
 * Phase 4+ добавит Leaflet интеграцию для полного map view.
 */

import { BarChart3, Layers, Settings } from 'lucide-react';
import type { SaveOverlayMode } from '@/lib/pz-renderer/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AtlasMissingPanel } from './atlas-missing-panel';
import { PzMapError } from './pz-map-error';
import { PzMapPreloader } from './pz-map-preloader';
import { PzTileMap, type DziSource } from './pz-tile-map';
import { SaveFilterControls } from './save-filter-controls';
import { useMapRenderer } from '@/hooks/use-map-renderer';
import { useTranslation } from '@/hooks/use-translation';
import type { PzMapRenderer } from '@/lib/pz-renderer';

/** Источники карты на выбор пользователя. */
export type PzMapDisplayMode = 'v41' | 'v42' | 'webgl';

export const PZ_MAP_DISPLAY_MODES: ReadonlyArray<PzMapDisplayMode> = ['v41', 'v42', 'webgl'];

/**
 * Configurations DZI пирамид. Параметры взяты прямо с серверов:
 *  - v41: legacy proxy_dzi из app/config/zomboid.php
 *    (https://map.projectzomboid.com/maps/SurvivalB417812L0).
 *  - v42: b42map.com/map_data/base/map_info.json.
 */
const TILE_SOURCES: Record<Exclude<PzMapDisplayMode, 'webgl'>, DziSource> = {
    v41: {
        tileUrl: 'https://map.projectzomboid.com/maps/SurvivalB417812L0/map_files/{z}/{x}_{y}.jpg',
        tileSize: 1024,
        width: 2285184,
        height: 990400,
        x0: 1017856,
        y0: -152032,
        sqr: 128,
        maxNativeZoom: 22,
    },
    v42: {
        tileUrl: 'https://b42map.com/map_data/base/layer0_files/{z}/{x}_{y}.jpg',
        tileSize: 1024,
        width: 2314432,
        height: 1019072,
        x0: 1036288,
        y0: -139296,
        sqr: 128,
        maxNativeZoom: 22,
    },
};

export interface PzMapViewProps {
    className?: string;
    atlasBaseUrl?: string;
    cellsBaseUrl?: string;
    /** Управляемый извне режим отображения (v41 / v42 / WebGL). */
    displayMode?: PzMapDisplayMode;
}

type DebugMode = 'atlas' | 'cell';

export function PzMapView({
    className = '',
    atlasBaseUrl,
    cellsBaseUrl,
    displayMode = 'webgl',
}: PzMapViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { t } = useTranslation();
    const [showControls, setShowControls] = useState(false);
    const [showStats, setShowStats] = useState(false);
    const [saveOverlayMode, setSaveOverlayMode] = useState<SaveOverlayMode>('overlay');
    const handleAtlasInstalled = useCallback(() => window.location.reload(), []);
    const { renderer, progress, error, isReady, cancel } = useMapRenderer({
        canvasRef,
        atlasBaseUrl,
        cellsBaseUrl,
        enabled: displayMode === 'webgl',
    });

    const [mode, setMode] = useState<DebugMode>('cell');
    const [atlasLod, setAtlasLod] = useState(0);
    const [atlasPage, setAtlasPage] = useState(0);
    const [atlasBrightness, setAtlasBrightness] = useState(1.0);

    const [cellX, setCellX] = useState(0);
    const [cellY, setCellY] = useState(0);
    const [cellLod, setCellLod] = useState(0);
    const [isometric, setIsometric] = useState(true);
    const [sqr, setSqr] = useState(16);
    const [pps, setPps] = useState(1.0);
    const [maxFloor, setMaxFloor] = useState(0);
    const [floorHeightPx, setFloorHeightPx] = useState(192);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [autoTuning, setAutoTuning] = useState(true);
    const [manualCellStride, setManualCellStride] = useState(1);
    const [manualSquareStride, setManualSquareStride] = useState(1);

    // Stride-bucket packing использует только power-of-2 (K=0..6 →
    // stride 1, 2, 4, 8). Non-power-of-2 значения дают gaps между
    // tiles: при stride=3 worker берёт каждый 4-й (ближайший pow2),
    // sprite scale=3, gap = 4-3=1 square. Snap to floor power-of-2.
    // Max stride = 8 (укладывается в "максимум 12" constraint).
    const snapStridePow2 = (v: number): number => {
        if (v <= 1) return 1;
        if (v >= 12) return 8;
        return 2 ** Math.floor(Math.log2(v));
    };

    // Auto LOD / stride на основании pps. Hysteresis: запоминаем
    // предыдущий level и переключаемся только если ушло за ±0.35
    // от boundary (≈3 wheel ticks).
    const tuningLevelRef = useRef(0);
    const tuning = useMemo(() => {
        // Auto-LOD: только адаптирует LOD атласа по pps. squareStride
        // всегда 1 в auto mode — Phase 5 instance-driven bump делает
        // реальный stride change. Эти два механизма раньше конфликтовали:
        // tuning table делал stride change слишком рано, а Phase 5 bump
        // (когда срабатывал) делал его правильно.
        const TABLE: Array<{ cellStride: number; squareStride: number; lod: number }> = [
            { cellStride: 1, squareStride: 1, lod: 0 },   // 0: pps ≥ 1.0
            { cellStride: 1, squareStride: 1, lod: 0 },   // 1: pps ≥ 0.5
            { cellStride: 1, squareStride: 1, lod: 0 },   // 2: pps ≥ 0.25
            { cellStride: 1, squareStride: 1, lod: 1 },   // 3: pps ≥ 0.125
            { cellStride: 1, squareStride: 1, lod: 2 },   // 4: pps ≥ 0.0625
            { cellStride: 1, squareStride: 1, lod: 3 },   // 5: pps ≥ 0.03
            { cellStride: 1, squareStride: 1, lod: 3 },   // 6: pps ≥ 0.015
            { cellStride: 1, squareStride: 1, lod: 3 },   // 7: pps < 0.015
        ];
        if (!autoTuning) {
            return {
                cellStride: manualCellStride,
                squareStride: snapStridePow2(manualSquareStride),
                lod: cellLod,
                level: -1,
            };
        }
        const exact = -Math.log2(Math.max(0.001, pps));
        let level = tuningLevelRef.current;
        while (exact > level + 0.35 && level < TABLE.length - 1) level++;
        while (exact < level - 0.35 && level > 0) level--;
        tuningLevelRef.current = level;
        return { ...TABLE[level]!, level };
    }, [autoTuning, pps, manualCellStride, manualSquareStride, cellLod]);

    // Сбрасываем pan при смене cell — иначе пользователь оказывается
    // глубоко в неотрендеренной зоне.
    useEffect(() => {
        setPanX(0);
        setPanY(0);
    }, [cellX, cellY]);

    // Mouse drag для pan. pps определяет soft canvas→native px ratio.
    const dragRef = useRef<{
        active: boolean;
        lastX: number;
        lastY: number;
    }>({ active: false, lastX: 0, lastY: 0 });
    const ppsRef = useRef(pps);
    ppsRef.current = pps;

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
        if (e.button !== 0) return;
        dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    };
    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
        if (!dragRef.current.active) return;
        const dx = e.clientX - dragRef.current.lastX;
        const dy = e.clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        const p = ppsRef.current || 1;
        setPanX((prev) => prev - dx / p);
        setPanY((prev) => prev - dy / p);
    };
    const handleMouseUp = (): void => {
        dragRef.current.active = false;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    };

    // Wheel zoom через native listener с { passive: false } чтобы
    // preventDefault не блокировался браузером.
    const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
    wheelHandlerRef.current = (e: WheelEvent): void => {
        if (mode !== 'cell') return;
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const baseFactor = e.ctrlKey ? 2.0 : 1.4;
        const factor = e.deltaY < 0 ? baseFactor : 1 / baseFactor;
        const oldPps = pps;
        const newPps = Math.max(0.001, Math.min(8, oldPps * factor));
        if (newPps === oldPps) return;
        const dPan = 1 / oldPps - 1 / newPps;
        setPanX((px) => px + mx * dPan);
        setPanY((py) => py + my * dPan);
        setPps(newPps);
    };
    useEffect(() => {
        if (displayMode !== 'webgl') return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handler = (e: WheelEvent): void => wheelHandlerRef.current?.(e);
        canvas.addEventListener('wheel', handler, { passive: false });
        return () => canvas.removeEventListener('wheel', handler);
    }, [displayMode]);

    // При смене mode/values — push в renderer.
    useEffect(() => {
        if (!renderer || !isReady) return;
        renderer.setDebugView({
            mode,
            lod: mode === 'atlas' ? atlasLod : tuning.lod,
            page: atlasPage,
            brightness: atlasBrightness,
            cellX,
            cellY,
            isometric,
            sqr,
            pps,
            maxFloor,
            floorHeightPx,
            panX,
            panY,
            cellStride: tuning.cellStride,
            squareStride: tuning.squareStride,
        });
    }, [
        renderer,
        isReady,
        mode,
        atlasLod,
        atlasPage,
        atlasBrightness,
        cellX,
        cellY,
        isometric,
        sqr,
        pps,
        maxFloor,
        floorHeightPx,
        panX,
        panY,
        tuning.lod,
        tuning.cellStride,
        tuning.squareStride,
    ]);

    const showPreloader = !isReady && !error;
    const lodCount = renderer?.getLodCount() ?? 1;
    const pageCount = renderer?.getPageCount() ?? 1;
    const cellRange = renderer?.getCellRange();
    const entryCount = renderer?.getCellEntryCount(cellX, cellY) ?? 0;

    /**
     * Сканирует grid от текущей позиции и находит ближайшую non-empty
     * cell. Полезно когда (0,0) попало в пустую область карты.
     */
    const findNonEmpty = (): void => {
        if (!renderer || !cellRange) return;
        for (let dy = 0; dy <= cellRange.maxY - cellRange.minY; dy++) {
            for (let dx = 0; dx <= cellRange.maxX - cellRange.minX; dx++) {
                const tx = cellRange.minX + dx;
                const ty = cellRange.minY + dy;
                if (renderer.getCellEntryCount(tx, ty) > 0) {
                    setCellX(tx);
                    setCellY(ty);
                    return;
                }
            }
        }
    };

    /**
     * Auto-jump: при первом переключении в cell mode — центрируем
     * camera на середину карты + auto-fit pps на всю карту целиком.
     * Пользователь сразу видит всю карту, может zoom-in куда хочется.
     */
    const autoJumpedRef = useRef(false);
    useEffect(() => {
        if (!isReady || mode !== 'cell' || autoJumpedRef.current) return;
        if (!renderer || !cellRange) return;
        const center = renderer.computeMapCenter();
        if (center) {
            setCellX(center.cellX);
            setCellY(center.cellY);
        }
        const fitPps = renderer.computeAutoFitMapPps();
        if (fitPps > 0) setPps(Math.max(0.001, Math.min(8, fitPps)));
        autoJumpedRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady, mode, renderer, cellRange]);

    /** Debug fragment mode (0 normal, 1 magenta, 2 UV gradient). */
    const [fragDebug, setFragDebug] = useState(0);
    useEffect(() => {
        if (!renderer || !isReady) return;
        renderer.setDebugView({ fragDebug });
    }, [renderer, isReady, fragDebug]);

    const isWebgl = displayMode === 'webgl';
    const tileSrc = isWebgl ? null : TILE_SOURCES[displayMode];
    const showWebglUi = isWebgl && isReady;

    return (
        <div className={`relative isolate h-full w-full ${className}`}>
            {isWebgl ? (
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 h-full w-full"
                    style={{ cursor: mode === 'cell' ? 'grab' : 'default' }}
                    onMouseDown={mode === 'cell' ? handleMouseDown : undefined}
                    onMouseMove={mode === 'cell' ? handleMouseMove : undefined}
                    onMouseUp={mode === 'cell' ? handleMouseUp : undefined}
                    onMouseLeave={mode === 'cell' ? handleMouseUp : undefined}
                />
            ) : tileSrc ? (
                <PzTileMap
                    key={displayMode}
                    dzi={tileSrc}
                    className="absolute inset-0"
                />
            ) : null}
            {isWebgl && showPreloader && <PzMapPreloader progress={progress} onCancel={cancel} />}
            {isWebgl && error && (
                /atlas-not-built|manifest\.json|sprites\.json|HTTP 404|HTTP 503/i.test(error.message)
                    ? <AtlasMissingPanel onInstalled={handleAtlasInstalled} />
                    : <PzMapError error={error} />
            )}
            <div className="absolute left-3 top-3 z-[900] flex max-h-[calc(100vh-1.5rem)] flex-col gap-2">
                {showWebglUi && (
                    <>
                    {/* Toggle bar */}
                    <div className="flex gap-1">
                        <button
                            type="button"
                            onClick={() => setShowControls((v) => !v)}
                            title={t('admin.pz_map.toggle_controls')}
                            className={`rounded border p-2 transition ${
                                showControls
                                    ? 'border-emerald-600 bg-emerald-700/30 text-emerald-300'
                                    : 'border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:bg-zinc-800'
                            }`}
                        >
                            <Settings className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowStats((v) => !v)}
                            title={t('admin.pz_map.toggle_stats')}
                            className={`rounded border p-2 transition ${
                                showStats
                                    ? 'border-cyan-600 bg-cyan-700/30 text-cyan-300'
                                    : 'border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:bg-zinc-800'
                            }`}
                        >
                            <BarChart3 className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const next: SaveOverlayMode
                                    = saveOverlayMode === 'off'
                                        ? 'overlay'
                                        : saveOverlayMode === 'overlay'
                                            ? 'highlight'
                                            : 'off';
                                setSaveOverlayMode(next);
                                renderer?.setSaveOverlayMode(next);
                            }}
                            title={`Save overlay: ${saveOverlayMode}`}
                            className={`rounded border p-2 transition ${
                                saveOverlayMode === 'off'
                                    ? 'border-zinc-700 bg-zinc-900/80 text-zinc-500 hover:bg-zinc-800'
                                    : saveOverlayMode === 'overlay'
                                        ? 'border-purple-600 bg-purple-700/30 text-purple-300'
                                        : 'border-amber-500 bg-amber-700/30 text-amber-200'
                            }`}
                        >
                            <Layers className="h-4 w-4" />
                        </button>
                    </div>
                    {showControls && (
                        <div className="overflow-y-auto">
                            <DebugControls
                        mode={mode}
                        setMode={setMode}
                        atlasLod={atlasLod}
                        setAtlasLod={setAtlasLod}
                        atlasPage={atlasPage}
                        setAtlasPage={setAtlasPage}
                        atlasBrightness={atlasBrightness}
                        setAtlasBrightness={setAtlasBrightness}
                        cellX={cellX}
                        setCellX={setCellX}
                        cellY={cellY}
                        setCellY={setCellY}
                        cellLod={cellLod}
                        setCellLod={setCellLod}
                        isometric={isometric}
                        setIsometric={setIsometric}
                        sqr={sqr}
                        setSqr={setSqr}
                        pps={pps}
                        setPps={setPps}
                        maxFloor={maxFloor}
                        setMaxFloor={setMaxFloor}
                        floorHeightPx={floorHeightPx}
                        setFloorHeightPx={setFloorHeightPx}
                        panX={panX}
                        panY={panY}
                        resetPan={() => {
                            setPanX(0);
                            setPanY(0);
                        }}
                        autoTuning={autoTuning}
                        setAutoTuning={setAutoTuning}
                        tuning={tuning}
                        manualCellStride={manualCellStride}
                        setManualCellStride={setManualCellStride}
                        manualSquareStride={manualSquareStride}
                        setManualSquareStride={setManualSquareStride}
                        lodCount={lodCount}
                        pageCount={pageCount}
                        cellRange={cellRange}
                        entryCount={entryCount}
                        findNonEmpty={findNonEmpty}
                        fragDebug={fragDebug}
                        setFragDebug={setFragDebug}
                            />
                        </div>
                    )}
                    {showStats && <CellStatsHud renderer={renderer} />}
                    {showControls && <SaveFilterControls />}
                    </>
                )}
            </div>
        </div>
    );
}

interface DebugControlsProps {
    mode: DebugMode;
    setMode: (m: DebugMode) => void;
    atlasLod: number;
    setAtlasLod: (v: number) => void;
    atlasPage: number;
    setAtlasPage: (v: number) => void;
    atlasBrightness: number;
    setAtlasBrightness: (v: number) => void;
    cellX: number;
    setCellX: (v: number) => void;
    cellY: number;
    setCellY: (v: number) => void;
    cellLod: number;
    setCellLod: (v: number) => void;
    isometric: boolean;
    setIsometric: (v: boolean) => void;
    sqr: number;
    setSqr: (v: number) => void;
    pps: number;
    setPps: (v: number) => void;
    maxFloor: number;
    setMaxFloor: (v: number) => void;
    floorHeightPx: number;
    setFloorHeightPx: (v: number) => void;
    panX: number;
    panY: number;
    resetPan: () => void;
    autoTuning: boolean;
    setAutoTuning: (v: boolean) => void;
    tuning: { cellStride: number; squareStride: number; lod: number; level: number };
    manualCellStride: number;
    setManualCellStride: (v: number) => void;
    manualSquareStride: number;
    setManualSquareStride: (v: number) => void;
    lodCount: number;
    pageCount: number;
    cellRange: { minX: number; maxX: number; minY: number; maxY: number } | null | undefined;
    entryCount: number;
    findNonEmpty: () => void;
    fragDebug: number;
    setFragDebug: (v: number) => void;
}

function DebugControls(p: DebugControlsProps) {
    const { t } = useTranslation();
    return (
        <div className="w-80 space-y-3 rounded-md border border-zinc-700 bg-zinc-900/90 p-3 text-xs text-zinc-200 backdrop-blur">
            {p.mode === 'cell' && (
                <>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                        <span>
                            {t('admin.pz_map.sprite_entries')}:{' '}
                            <span className="font-mono text-emerald-400">
                                {p.entryCount.toLocaleString()}
                            </span>
                        </span>
                        <button
                            onClick={() => p.findNonEmpty()}
                            className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-600"
                        >
                            {t('admin.pz_map.find_non_empty')}
                        </button>
                    </div>
                    {p.entryCount === 0 && (
                        <p className="text-[10px] text-amber-400">
                            {t('admin.pz_map.cell_empty')}
                        </p>
                    )}
                    <div className="space-y-1 border-t border-zinc-800 pt-2">
                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={p.autoTuning}
                                onChange={(e) => p.setAutoTuning(e.target.checked)}
                            />
                            <span>{t('admin.pz_map.auto_lod_stride')}</span>
                        </label>
                        {p.autoTuning ? (
                            <div className="flex justify-between font-mono text-[10px] text-zinc-400">
                                <span>
                                    {t('admin.pz_map.level')}{' '}
                                    <span className="text-cyan-400">{p.tuning.level}</span>
                                </span>
                                <span>
                                    cs<span className="text-emerald-400">{p.tuning.cellStride}</span>{' '}
                                    ss<span className="text-emerald-400">{p.tuning.squareStride}</span>{' '}
                                    lod<span className="text-emerald-400">{p.tuning.lod}</span>
                                </span>
                            </div>
                        ) : (
                            <>
                                <Slider
                                    label={t('admin.pz_map.cell_lod')}
                                    value={p.cellLod}
                                    min={0}
                                    max={p.lodCount - 1}
                                    onChange={p.setCellLod}
                                />
                                <Slider
                                    label={t('admin.pz_map.square_stride')}
                                    value={p.manualSquareStride}
                                    min={1}
                                    max={12}
                                    step={1}
                                    onChange={p.setManualSquareStride}
                                    valueFmt={(v) => {
                                        const eff
                                            = v <= 1 ? 1
                                                : v >= 12 ? 8
                                                    : 2 ** Math.floor(Math.log2(v));
                                        return `${v} → eff ${eff}`;
                                    }}
                                />
                            </>
                        )}
                    </div>
                    <Slider
                        label={t('admin.pz_map.sqr')}
                        value={p.sqr}
                        min={8}
                        max={256}
                        step={8}
                        onChange={p.setSqr}
                    />
                    <Slider
                        label={t('admin.pz_map.zoom')}
                        value={p.pps}
                        min={0.001}
                        max={8}
                        step={0.001}
                        onChange={p.setPps}
                        valueFmt={(v) =>
                            v >= 0.1 ? `${v.toFixed(1)}×` : `${v.toFixed(3)}×`
                        }
                    />
                    <div className="space-y-1 border-t border-zinc-800 pt-2">
                        <Slider
                            label={t('admin.pz_map.max_floor')}
                            value={p.maxFloor}
                            min={0}
                            max={3}
                            step={1}
                            onChange={p.setMaxFloor}
                            valueFmt={(v) =>
                                v === 0 ? t('admin.pz_map.ground_only') : `0..${v}`
                            }
                        />
                    </div>
                    <div className="space-y-1 border-t border-zinc-800 pt-2">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                            <span>
                                {t('admin.pz_map.pan_label')}:{' '}
                                <span className="font-mono text-cyan-400">
                                    {Math.round(p.panX)}, {Math.round(p.panY)}
                                </span>
                            </span>
                            <button
                                onClick={p.resetPan}
                                className="rounded bg-cyan-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-cyan-600"
                            >
                                {t('admin.pz_map.reset_pan')}
                            </button>
                        </div>
                        <p className="text-[9px] text-zinc-500">
                            {t('admin.pz_map.pan_hint')}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}

function ModeButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition ${
                active
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
        >
            {children}
        </button>
    );
}

interface SliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (v: number) => void;
    valueFmt?: (v: number) => string;
}

function Slider({
    label,
    value,
    min,
    max,
    step = 1,
    onChange,
    valueFmt,
}: SliderProps) {
    return (
        <label className="block space-y-1">
            <span className="flex justify-between font-mono">
                <span>{label}</span>
                <span className="text-emerald-400">
                    {valueFmt ? valueFmt(value) : value}
                </span>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full"
            />
        </label>
    );
}

/**
 * Cell coord widget: slider + numeric input в одной строке. Позволяет
 * быстро таскать слайдером для разведки или впечатать точный coord.
 */
interface CellCoordRowProps {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
}

function CellCoordRow({ label, value, min, max, onChange }: CellCoordRowProps) {
    const clamp = (v: number): number => Math.max(min, Math.min(max, v | 0));
    return (
        <label className="block space-y-1">
            <span className="flex justify-between font-mono">
                <span>{label}</span>
                <span className="text-zinc-500">
                    [{min}..{max}]
                </span>
            </span>
            <div className="flex gap-2">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={value}
                    onChange={(e) => onChange(clamp(Number(e.target.value)))}
                    className="flex-1"
                />
                <input
                    type="number"
                    min={min}
                    max={max}
                    step={1}
                    value={value}
                    onChange={(e) => onChange(clamp(Number(e.target.value)))}
                    className="w-16 rounded bg-zinc-800 px-1 py-0.5 text-right font-mono text-emerald-400"
                />
            </div>
        </label>
    );
}

function CellStatsHud({ renderer }: { renderer: PzMapRenderer | null }) {
    const { t } = useTranslation();
    const stats = renderer?.getCellStats();
    const texInfo = renderer?.getCellTextureInfo();
    const [drawnCells, setDrawnCells] = useState(0);
    const [drawnInstances, setDrawnInstances] = useState(0);
    const [renderK, setRenderK] = useState(0);
    const [fps, setFps] = useState(0);
    const [saveSnapshot, setSaveSnapshot] = useState<ReturnType<PzMapRenderer['getSaveStats']> | null>(null);
    const [drawnSaveCells, setDrawnSaveCells] = useState(0);
    useEffect(() => {
        if (!renderer) return;
        // FPS counter через rAF: накапливаем frames за 0.5s.
        let frames = 0;
        let lastT = performance.now();
        let raf = 0;
        const tick = (): void => {
            frames++;
            const now = performance.now();
            if (now - lastT >= 500) {
                setFps(Math.round((frames * 1000) / (now - lastT)));
                frames = 0;
                lastT = now;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const id = setInterval(() => {
            setDrawnCells(renderer.getLastDrawnCellsCount());
            setDrawnInstances(renderer.getLastDrawnInstanceCount());
            setRenderK(renderer.getLastRenderK());
            setSaveSnapshot(renderer.getSaveStats());
            setDrawnSaveCells(renderer.getLastDrawnSaveCells());
        }, 500);
        return () => {
            cancelAnimationFrame(raf);
            clearInterval(id);
        };
    }, [renderer]);
    if (!stats || !texInfo) return null;

    // Phase 5.6: compact 1-texel format — 4 bytes per entry (было 8 в legacy 2-texel).
    const mbAtlas = (texInfo.totalEntries * 4) / (1024 * 1024);
    const cacheRatio = stats.bytesFromCache
        / Math.max(1, stats.bytesFromCache + stats.bytesFromNetwork);
    const fpsColor = fps >= 50 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-red-400';

    return (
        <div className="w-72 space-y-1 rounded-md border border-zinc-700 bg-zinc-900/90 p-3 font-mono text-[10px] text-zinc-300 backdrop-blur">
            <p className="text-[10px] uppercase tracking-wider text-emerald-400">
                {t('admin.pz_map.phase_label')}
            </p>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.fps')}</span>
                <span className={fpsColor}>{fps}</span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.cells_in_viewport')}</span>
                <span className="text-cyan-400">
                    {drawnCells} / {drawnInstances.toLocaleString()}
                </span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.render_k')}</span>
                <span className="text-amber-400">
                    {renderK} (2^{renderK} = {1 << renderK})
                </span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.cells_parsed')}</span>
                <span>
                    {stats.parsedCells} / {stats.totalCells}
                </span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.cells_skipped')}</span>
                <span>{stats.skippedCells}</span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.sprite_entries')}</span>
                <span>{texInfo.totalEntries.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.atlas_size')}</span>
                <span>{mbAtlas.toFixed(1)} MB</span>
            </div>
            <div className="flex justify-between">
                <span>{t('admin.pz_map.idb_cache_hit')}</span>
                <span>{(cacheRatio * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between text-zinc-500">
                <span>{t('admin.pz_map.origin')}</span>
                <span>
                    ({texInfo.originCellX}, {texInfo.originCellY})
                </span>
            </div>
            <div className="flex justify-between text-zinc-500">
                <span>{t('admin.pz_map.grid')}</span>
                <span>
                    {texInfo.indexGridWidth} × {texInfo.indexGridHeight}
                </span>
            </div>
            {saveSnapshot && (
                <>
                    <p className="mt-2 text-[10px] uppercase tracking-wider text-purple-400">
                        Save overlay
                    </p>
                    <div className="flex justify-between">
                        <span>Mode</span>
                        <span className="text-purple-300">{saveSnapshot.mode}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Save slots loaded</span>
                        <span>
                            {saveSnapshot.stats?.loadedSlots ?? 0}
                            {' / drawn '}
                            {drawnSaveCells}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span>Max loaded floor</span>
                        <span>{saveSnapshot.stats?.loadedMaxLayer ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Skipped</span>
                        <span>{saveSnapshot.stats?.skippedSlots ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>PZ version</span>
                        <span>B{saveSnapshot.stats?.saveVersion ?? '?'}</span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                        <span>Last update</span>
                        <span>
                            {saveSnapshot.lastUpdateAt
                                ? `${Math.round((Date.now() - saveSnapshot.lastUpdateAt) / 1000)}s ago`
                                : '—'}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}
