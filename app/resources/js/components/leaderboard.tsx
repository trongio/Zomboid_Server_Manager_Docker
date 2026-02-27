import { Clock, Skull, Trophy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Leaderboard as LeaderboardType } from '@/types';

export function Leaderboard({ data }: { data: LeaderboardType }) {
    const hasKills = data.kills.length > 0;
    const hasSurvival = data.survival.length > 0;

    if (!hasKills && !hasSurvival) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Trophy className="size-5" />
                        Leaderboard
                    </CardTitle>
                    <CardDescription>Top players by stats</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">No player stats recorded yet</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Trophy className="size-5" />
                    Leaderboard
                </CardTitle>
                <CardDescription>Top players by stats</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-6 sm:grid-cols-2">
                    {/* Zombie Kills */}
                    <div>
                        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <Skull className="size-3.5" />
                            Zombie Kills
                        </h4>
                        {hasKills ? (
                            <div className="space-y-1.5">
                                {data.kills.map((entry, i) => (
                                    <div
                                        key={entry.username}
                                        className="flex items-center justify-between rounded-md px-2 py-1 text-sm"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                                                {i + 1}
                                            </span>
                                            <span className="font-medium">{entry.username}</span>
                                        </div>
                                        <span className="tabular-nums">
                                            {entry.zombie_kills.toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No data</p>
                        )}
                    </div>

                    {/* Hours Survived */}
                    <div>
                        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <Clock className="size-3.5" />
                            Hours Survived
                        </h4>
                        {hasSurvival ? (
                            <div className="space-y-1.5">
                                {data.survival.map((entry, i) => (
                                    <div
                                        key={entry.username}
                                        className="flex items-center justify-between rounded-md px-2 py-1 text-sm"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                                                {i + 1}
                                            </span>
                                            <span className="font-medium">{entry.username}</span>
                                        </div>
                                        <span className="tabular-nums">
                                            {entry.hours_survived.toLocaleString(undefined, {
                                                maximumFractionDigits: 1,
                                            })}
                                            h
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No data</p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
