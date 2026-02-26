import { Head, router, usePoll } from '@inertiajs/react';
import { Ban, Circle, ShieldCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { BreadcrumbItem } from '@/types';

type Player = { name: string };

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Players', href: '/admin/players' },
];

export default function Players({ players }: { players: Player[] }) {
    const [kickTarget, setKickTarget] = useState<string | null>(null);
    const [banTarget, setBanTarget] = useState<string | null>(null);
    const [accessTarget, setAccessTarget] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [accessLevel, setAccessLevel] = useState('none');
    const [loading, setLoading] = useState(false);

    usePoll(5000, { only: ['players'] });

    function handleAction(url: string, data: Record<string, unknown>, onDone: () => void) {
        setLoading(true);
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '',
            },
            body: JSON.stringify(data),
        }).finally(() => {
            setLoading(false);
            onDone();
            router.reload({ only: ['players'] });
        });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Players" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Player Management</h1>
                        <p className="text-muted-foreground">
                            {players.length} player{players.length !== 1 ? 's' : ''} online
                        </p>
                    </div>
                    <Badge variant="outline" className="text-sm">
                        <Circle className="mr-1.5 size-2 fill-green-500 text-green-500" />
                        Live
                    </Badge>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Online Players</CardTitle>
                        <CardDescription>Manage connected players via RCON commands</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {players.length > 0 ? (
                            <div className="space-y-2">
                                {players.map((player) => (
                                    <div
                                        key={player.name}
                                        className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <Circle className="size-2 fill-green-500 text-green-500" />
                                            <span className="font-medium">{player.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setAccessTarget(player.name)}
                                            >
                                                <ShieldCheck className="mr-1.5 size-3.5" />
                                                Access
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setReason('');
                                                    setKickTarget(player.name);
                                                }}
                                            >
                                                <UserX className="mr-1.5 size-3.5" />
                                                Kick
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => {
                                                    setReason('');
                                                    setBanTarget(player.name);
                                                }}
                                            >
                                                <Ban className="mr-1.5 size-3.5" />
                                                Ban
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">
                                No players online
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Kick Dialog */}
            <Dialog open={kickTarget !== null} onOpenChange={() => setKickTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Kick {kickTarget}</DialogTitle>
                        <DialogDescription>This player will be disconnected from the server.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="kick-reason">Reason (optional)</Label>
                        <Input
                            id="kick-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Reason for kick..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setKickTarget(null)}>Cancel</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${kickTarget}/kick`, { reason }, () => setKickTarget(null))
                            }
                        >
                            Kick Player
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Ban Dialog */}
            <Dialog open={banTarget !== null} onOpenChange={() => setBanTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Ban {banTarget}</DialogTitle>
                        <DialogDescription>This player will be permanently banned from the server.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="ban-reason">Reason (optional)</Label>
                        <Input
                            id="ban-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Reason for ban..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBanTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${banTarget}/ban`, { reason }, () => setBanTarget(null))
                            }
                        >
                            Ban Player
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Access Level Dialog */}
            <Dialog open={accessTarget !== null} onOpenChange={() => setAccessTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Set Access Level for {accessTarget}</DialogTitle>
                        <DialogDescription>Change the player's server access level.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label>Access Level</Label>
                        <Select value={accessLevel} onValueChange={setAccessLevel}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="moderator">Moderator</SelectItem>
                                <SelectItem value="overseer">Overseer</SelectItem>
                                <SelectItem value="gm">GM</SelectItem>
                                <SelectItem value="observer">Observer</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAccessTarget(null)}>Cancel</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(
                                    `/admin/players/${accessTarget}/access`,
                                    { level: accessLevel },
                                    () => setAccessTarget(null),
                                )
                            }
                        >
                            Set Access
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
