import { router } from '@inertiajs/react';
import { Ban, ShieldCheck, TimerReset, UserX } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { fetchAction } from '@/lib/fetch-action';

type Props = {
    kickTarget: string | null;
    banTarget: string | null;
    accessTarget: string | null;
    resetTimerTarget?: string | null;
    onCloseKick: () => void;
    onCloseBan: () => void;
    onCloseAccess: () => void;
    onCloseResetTimer?: () => void;
    reloadOnly: string[];
};

export default function PlayerActionDialogs({
    kickTarget,
    banTarget,
    accessTarget,
    resetTimerTarget = null,
    onCloseKick,
    onCloseBan,
    onCloseAccess,
    onCloseResetTimer,
    reloadOnly,
}: Props) {
    const [reason, setReason] = useState('');
    const [accessLevel, setAccessLevel] = useState('none');
    const [loading, setLoading] = useState(false);

    async function handleAction(url: string, data: Record<string, unknown>, onDone: () => void) {
        setLoading(true);
        await fetchAction(url, { data });
        setLoading(false);
        onDone();
        router.reload({ only: reloadOnly });
    }

    return (
        <>
            {/* Kick Dialog */}
            <Dialog open={kickTarget !== null} onOpenChange={() => onCloseKick()}>
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
                        <Button variant="outline" onClick={onCloseKick}>Cancel</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${kickTarget}/kick`, { reason }, onCloseKick)
                            }
                        >
                            <UserX className="mr-1.5 size-3.5" />
                            Kick Player
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Ban Dialog */}
            <Dialog open={banTarget !== null} onOpenChange={() => onCloseBan()}>
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
                        <Button variant="outline" onClick={onCloseBan}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${banTarget}/ban`, { reason }, onCloseBan)
                            }
                        >
                            <Ban className="mr-1.5 size-3.5" />
                            Ban Player
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Access Level Dialog */}
            <Dialog open={accessTarget !== null} onOpenChange={() => onCloseAccess()}>
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
                        <Button variant="outline" onClick={onCloseAccess}>Cancel</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(
                                    `/admin/players/${accessTarget}/access`,
                                    { level: accessLevel },
                                    onCloseAccess,
                                )
                            }
                        >
                            <ShieldCheck className="mr-1.5 size-3.5" />
                            Set Access
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset Respawn Timer Dialog */}
            {onCloseResetTimer && (
                <Dialog open={resetTimerTarget !== null} onOpenChange={() => onCloseResetTimer()}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Reset Respawn Timer for {resetTimerTarget}</DialogTitle>
                            <DialogDescription>
                                This will clear the respawn cooldown, allowing the player to rejoin immediately.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={onCloseResetTimer}>Cancel</Button>
                            <Button
                                disabled={loading}
                                onClick={() =>
                                    handleAction(
                                        `/admin/respawn-delay/${resetTimerTarget}/reset`,
                                        {},
                                        onCloseResetTimer,
                                    )
                                }
                            >
                                <TimerReset className="mr-1.5 size-3.5" />
                                Reset Timer
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
