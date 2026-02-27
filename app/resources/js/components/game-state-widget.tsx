import {
    Cloud,
    CloudDrizzle,
    CloudFog,
    CloudRain,
    Flower2,
    Leaf,
    Moon,
    Snowflake,
    Sun,
    Thermometer,
    TreeDeciduous,
} from 'lucide-react';
import type { GameState } from '@/types';

const seasonConfig = {
    spring: { icon: Flower2, label: 'Spring', color: 'text-green-500' },
    summer: { icon: Sun, label: 'Summer', color: 'text-yellow-500' },
    autumn: { icon: Leaf, label: 'Autumn', color: 'text-orange-500' },
    winter: { icon: Snowflake, label: 'Winter', color: 'text-blue-400' },
};

const weatherIcons: Record<string, typeof Sun> = {
    clear: Sun,
    rain: CloudDrizzle,
    heavy_rain: CloudRain,
    fog: CloudFog,
    snow: Snowflake,
    night: Moon,
};

export function GameStateWidget({ gameState }: { gameState: GameState | null }) {
    if (!gameState) {
        return (
            <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3">
                <TreeDeciduous className="size-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Game state unavailable</span>
            </div>
        );
    }

    const { time, season, weather } = gameState;
    const SeasonIcon = seasonConfig[season]?.icon ?? Sun;
    const seasonColor = seasonConfig[season]?.color ?? 'text-muted-foreground';
    const seasonLabel = seasonConfig[season]?.label ?? season;

    const WeatherIcon = weather ? (weatherIcons[weather.condition] ?? Cloud) : Cloud;

    return (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-card px-4 py-3">
            {/* In-game time */}
            <div className="flex items-center gap-2">
                {time.is_night ? (
                    <Moon className="size-4 text-indigo-400" />
                ) : (
                    <Sun className="size-4 text-yellow-500" />
                )}
                <div>
                    <span className="font-semibold tabular-nums">{time.formatted}</span>
                    <span className="ml-1.5 text-sm text-muted-foreground">
                        Day {time.day_of_year}
                    </span>
                </div>
            </div>

            <div className="h-5 w-px bg-border" />

            {/* Season */}
            <div className="flex items-center gap-1.5">
                <SeasonIcon className={`size-4 ${seasonColor}`} />
                <span className="text-sm">{seasonLabel}</span>
            </div>

            {weather && (
                <>
                    <div className="h-5 w-px bg-border" />

                    {/* Weather condition */}
                    <div className="flex items-center gap-1.5">
                        <WeatherIcon className="size-4 text-muted-foreground" />
                        <span className="text-sm capitalize">
                            {weather.condition.replace('_', ' ')}
                        </span>
                    </div>

                    <div className="h-5 w-px bg-border" />

                    {/* Temperature */}
                    <div className="flex items-center gap-1">
                        <Thermometer className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium tabular-nums">
                            {weather.temperature}°C
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}
