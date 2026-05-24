import { createContext, useContext, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type TabsContextValue = {
    value: string;
    onValueChange: (v: string) => void;
    name: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
    const ctx = useContext(TabsContext);
    if (!ctx) throw new Error('Tabs subcomponents must be rendered inside <Tabs>');
    return ctx;
}

export function Tabs({
    value,
    defaultValue,
    onValueChange,
    className,
    children,
}: {
    value?: string;
    defaultValue?: string;
    onValueChange?: (v: string) => void;
    className?: string;
    children: ReactNode;
}) {
    const [internal, setInternal] = useState(defaultValue ?? '');
    const controlled = value !== undefined;
    const current = controlled ? (value as string) : internal;
    const setCurrent = (v: string) => {
        if (!controlled) setInternal(v);
        onValueChange?.(v);
    };
    const name = useId();

    return (
        <TabsContext.Provider value={{ value: current, onValueChange: setCurrent, name }}>
            <div className={className} data-slot="tabs">{children}</div>
        </TabsContext.Provider>
    );
}

export function TabsList({
    className,
    children,
}: {
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            role="tablist"
            className={cn(
                'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
                className,
            )}
        >
            {children}
        </div>
    );
}

export function TabsTrigger({
    value,
    className,
    children,
    disabled,
}: {
    value: string;
    className?: string;
    children: ReactNode;
    disabled?: boolean;
}) {
    const ctx = useTabs();
    const active = ctx.value === value;
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            disabled={disabled}
            onClick={() => ctx.onValueChange(value)}
            className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:pointer-events-none disabled:opacity-50',
                active && 'bg-background text-foreground shadow-sm',
                className,
            )}
        >
            {children}
        </button>
    );
}

export function TabsContent({
    value,
    className,
    children,
}: {
    value: string;
    className?: string;
    children: ReactNode;
}) {
    const ctx = useTabs();
    if (ctx.value !== value) return null;
    return (
        <div role="tabpanel" data-state="active" className={cn('mt-2', className)}>
            {children}
        </div>
    );
}
