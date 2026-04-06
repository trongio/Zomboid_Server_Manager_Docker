import { router } from '@inertiajs/react';
import { Ban, KeyRound, ShieldCheck, TimerReset, UserX } from 'lucide-react';
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
import { useTranslation } from '@/hooks/use-translation';
import { fetchAction } from '@/lib/fetch-action';

type Props = {
    kickTarget: string | null;
    banTarget: string | null;
    accessTarget: string | null;
    passwordTarget?: string | null;
    resetTimerTarget?: string | null;
    onCloseKick: () => void;
    onCloseBan: () => void;
    onCloseAccess: () => void;
    onClosePassword?: () => void;
    onCloseResetTimer?: () => void;
    reloadOnly: string[];
};

export default function PlayerActionDialogs({
    kickTarget,
    banTarget,
    accessTarget,
    passwordTarget = null,
    resetTimerTarget = null,
    onCloseKick,
    onCloseBan,
    onCloseAccess,
    onClosePassword,
    onCloseResetTimer,
    reloadOnly,
}: Props) {
    const { t } = useTranslation();
    const [reason, setReason] = useState('');
    const [accessLevel, setAccessLevel] = useState('none');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
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
                        <DialogTitle>{t('admin.player_dialogs.kick_title', { player: kickTarget ?? '' })}</DialogTitle>
                        <DialogDescription>{t('admin.player_dialogs.kick_description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="kick-reason">{t('admin.player_dialogs.kick_reason_label')}</Label>
                        <Input
                            id="kick-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('admin.player_dialogs.kick_reason_placeholder')}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={onCloseKick}>{t('common.cancel')}</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${kickTarget}/kick`, { reason }, onCloseKick)
                            }
                        >
                            <UserX className="mr-1.5 size-3.5" />
                            {t('admin.player_dialogs.kick_confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Ban Dialog */}
            <Dialog open={banTarget !== null} onOpenChange={() => onCloseBan()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.player_dialogs.ban_title', { player: banTarget ?? '' })}</DialogTitle>
                        <DialogDescription>{t('admin.player_dialogs.ban_description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="ban-reason">{t('admin.player_dialogs.ban_reason_label')}</Label>
                        <Input
                            id="ban-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('admin.player_dialogs.ban_reason_placeholder')}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={onCloseBan}>{t('common.cancel')}</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${banTarget}/ban`, { reason }, onCloseBan)
                            }
                        >
                            <Ban className="mr-1.5 size-3.5" />
                            {t('admin.player_dialogs.ban_confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Access Level Dialog */}
            <Dialog open={accessTarget !== null} onOpenChange={() => onCloseAccess()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.player_dialogs.access_title', { player: accessTarget ?? '' })}</DialogTitle>
                        <DialogDescription>{t('admin.player_dialogs.access_description')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label>{t('admin.player_dialogs.access_label')}</Label>
                        <Select value={accessLevel} onValueChange={setAccessLevel}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="admin">{t('admin.player_dialogs.access_admin')}</SelectItem>
                                <SelectItem value="moderator">{t('admin.player_dialogs.access_moderator')}</SelectItem>
                                <SelectItem value="overseer">{t('admin.player_dialogs.access_overseer')}</SelectItem>
                                <SelectItem value="gm">{t('admin.player_dialogs.access_gm')}</SelectItem>
                                <SelectItem value="observer">{t('admin.player_dialogs.access_observer')}</SelectItem>
                                <SelectItem value="none">{t('admin.player_dialogs.access_none')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={onCloseAccess}>{t('common.cancel')}</Button>
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
                            {t('admin.player_dialogs.access_confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Set Password Dialog */}
            {onClosePassword && (
                <Dialog
                    open={passwordTarget !== null}
                    onOpenChange={() => {
                        setPassword('');
                        setPasswordConfirmation('');
                        onClosePassword();
                    }}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('admin.player_dialogs.password_title', { player: passwordTarget ?? '' })}</DialogTitle>
                            <DialogDescription>
                                {t('admin.player_dialogs.password_description')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="new-password">{t('admin.player_dialogs.new_password_label')}</Label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t('admin.player_dialogs.new_password_placeholder')}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-password">{t('admin.player_dialogs.confirm_password_label')}</Label>
                                <Input
                                    id="confirm-password"
                                    type="password"
                                    value={passwordConfirmation}
                                    onChange={(e) => setPasswordConfirmation(e.target.value)}
                                    placeholder={t('admin.player_dialogs.confirm_password_placeholder')}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setPassword('');
                                    setPasswordConfirmation('');
                                    onClosePassword();
                                }}
                            >
                                {t('common.cancel')}
                            </Button>
                            <Button
                                disabled={loading || !password}
                                onClick={() => {
                                    handleAction(
                                        `/admin/players/${passwordTarget}/password`,
                                        { password, password_confirmation: passwordConfirmation },
                                        () => {
                                            setPassword('');
                                            setPasswordConfirmation('');
                                            onClosePassword();
                                        },
                                    );
                                }}
                            >
                                <KeyRound className="mr-1.5 size-3.5" />
                                {t('admin.player_dialogs.password_confirm')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* Reset Respawn Timer Dialog */}
            {onCloseResetTimer && (
                <Dialog open={resetTimerTarget !== null} onOpenChange={() => onCloseResetTimer()}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('admin.player_dialogs.reset_timer_title', { player: resetTimerTarget ?? '' })}</DialogTitle>
                            <DialogDescription>
                                {t('admin.player_dialogs.reset_timer_description')}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={onCloseResetTimer}>{t('common.cancel')}</Button>
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
                                {t('admin.player_dialogs.reset_timer_confirm')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
