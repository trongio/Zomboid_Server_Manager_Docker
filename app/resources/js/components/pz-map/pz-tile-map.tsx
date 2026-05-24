/**
 * Leaflet-based tile map renderer для legacy DZI источников.
 *
 * Использует ту же isometric PZ CRS что и оригинальный pzmap2dzi
 * viewer: PZ game squares (sx, sy) → diamond projection → DZI pixels.
 * Tile URL template формата `{z}/{x}_{y}.jpg` (DZI с подчёркиванием).
 *
 * Кеширование тайлов:
 *  - v41 (projectzomboid.com): браузерный HTTP cache по Cache-Control:
 *    max-age=86400 от Cloudflare.
 *  - v42 (b42map.com через backend-прокси `/admin/map-tiles/external/v42/`):
 *    сервер кеширует тайлы на диск + отдаёт Cache-Control: max-age=2592000.
 *
 * Используем стандартный `<img>`-based TileLayer (а не fetch()/blob), чтоб
 * не упереться в CSP connect-src и не терять session cookie.
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface DziSource {
    /** Template URL `https://host/{z}/{x}_{y}.jpg`. */
    tileUrl: string;
    /** Размер тайла в пикселях. PZ DZI используют 1024. */
    tileSize: number;
    /** Полная ширина DZI пирамиды в пикселях. */
    width: number;
    /** Полная высота DZI пирамиды в пикселях. */
    height: number;
    /** Origin offset карты в DZI пикселях. */
    x0: number;
    y0: number;
    /** Игровых пикселей на game-square (PZ canonical = 128). */
    sqr: number;
    /** Глубина пирамиды (последний z с реальными тайлами). */
    maxNativeZoom: number;
}

interface Props {
    dzi: DziSource;
    className?: string;
}

/**
 * Создаёт CRS отображающий PZ game coords (squares) → DZI pixels.
 * Isometric diamond projection (sqr > 2):
 *   px = (sx - sy) * sqr/2 + x0
 *   py = (sx + sy) * sqr/4 + y0 + sqr/4
 */
function createPzCRS(dzi: DziSource): L.CRS {
    const scale = 1 / Math.pow(2, dzi.maxNativeZoom);
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

function createDziTileLayer(template: string, opts: L.TileLayerOptions): L.TileLayer {
    const Layer = L.TileLayer.extend({
        getTileUrl(coords: L.Coords) {
            return template
                .replace('{z}', String(coords.z))
                .replace('{x}', String(coords.x))
                .replace('{y}', String(coords.y));
        },
    }) as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer;
    return new Layer(template, opts);
}

export function PzTileMap({ dzi, className = '' }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Тайлы существуют по всей пирамиде DZI (0..22), но при низких z
        // только в районе x/y близких к origin, а на высоких — у больших
        // координат. Так что нельзя пробовать тайл (0,0) на z=22 чтобы
        // судить о наличии уровня. maxNativeZoom = dzi.maxNativeZoom (22).
        const minZoom = 12;
        const maxZoom = 22;

        const map = L.map(containerRef.current, {
            crs: createPzCRS(dzi),
            minZoom,
            maxZoom,
            zoomControl: true,
            attributionControl: false,
        });

        createDziTileLayer(dzi.tileUrl, {
            tileSize: dzi.tileSize,
            minZoom,
            maxZoom,
            maxNativeZoom: dzi.maxNativeZoom,
            noWrap: true,
            keepBuffer: 4,
            // b42map.com отдаёт 403 если Referer = http://localhost:8000/...
            // но разрешает запросы БЕЗ Referer. `no-referrer` решает это.
            // projectzomboid.com принимает любой Referer — не вредит.
            referrerPolicy: 'no-referrer',
        }).addTo(map);

        // Auto-fit на всю карту: вычисляем latLng bounds из DZI dimensions.
        // Это работает для любой карты независимо от расположения города.
        const sw = map.unproject([0, dzi.height], dzi.maxNativeZoom);
        const ne = map.unproject([dzi.width, 0], dzi.maxNativeZoom);
        const bounds = L.latLngBounds(sw, ne);
        map.fitBounds(bounds, { animate: false });
        map.setMaxBounds(bounds.pad(0.2));

        mapRef.current = map;
        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, [dzi.tileUrl, dzi.tileSize, dzi.width, dzi.height, dzi.x0, dzi.y0, dzi.sqr, dzi.maxNativeZoom]);

    return <div ref={containerRef} className={`isolate h-full w-full ${className}`} />;
}
