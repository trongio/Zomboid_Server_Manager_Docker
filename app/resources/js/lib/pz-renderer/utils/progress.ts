/**
 * ProgressAggregator — собирает прогресс из независимых под-задач
 * (atlas DL, cell parse, GPU upload) и эмитит общий 0..1 callback.
 *
 * Каждая фаза имеет вес (например atlas = 0.45, cells = 0.43, etc.);
 * сумма весов = 1.0. Под-фазы рапортуют свой 0..1, агрегатор пересчитывает
 * общий и зовёт onChange.
 *
 * Throttled: эмиссия не чаще `minIntervalMs` (по дефолту 100 ms), чтобы
 * не дёргать React state каждый rAF.
 */

import type { ProgressSnapshot, RendererState } from '../types';

export interface PhaseDescriptor {
    name: string;
    /** Вес 0..1, сумма всех должна быть = 1. */
    weight: number;
    /** UI label, отображаемый когда эта фаза активна. */
    label: string;
}

export class ProgressAggregator {
    private readonly phases: Map<string, PhaseDescriptor> = new Map();
    private readonly phaseValues: Map<string, number> = new Map();
    private currentPhase: string | null = null;
    private state: RendererState = 'idle';
    private lastEmitMs = 0;
    private etaWindow: Array<{ time: number; progress: number }> = [];

    constructor(
        phases: PhaseDescriptor[],
        private readonly onChange: (snapshot: ProgressSnapshot) => void,
        private readonly minIntervalMs = 100,
    ) {
        let totalWeight = 0;
        for (const p of phases) {
            this.phases.set(p.name, p);
            this.phaseValues.set(p.name, 0);
            totalWeight += p.weight;
        }
        // Проверка корректности весов с допуском 1e-3 (плавающая точка).
        if (Math.abs(totalWeight - 1.0) > 1e-3) {
            throw new Error(
                `[progress] phase weights must sum to 1.0, got ${totalWeight}`,
            );
        }
    }

    /** Изменить текущее состояние state machine (idle/loading/ready/...). */
    setState(state: RendererState): void {
        this.state = state;
        this.emit(true);
    }

    /** Начать новую фазу — она становится активной (для UI label). */
    enterPhase(name: string): void {
        if (!this.phases.has(name)) {
            throw new Error(`[progress] unknown phase: ${name}`);
        }
        this.currentPhase = name;
        this.emit(true);
    }

    /** Обновить прогресс конкретной фазы (0..1). */
    setPhaseProgress(name: string, progress: number): void {
        if (!this.phases.has(name)) {
            throw new Error(`[progress] unknown phase: ${name}`);
        }
        this.phaseValues.set(name, Math.max(0, Math.min(1, progress)));
        this.emit(false);
    }

    /** Сообщить о фатальной ошибке. */
    setError(message: string): void {
        this.state = 'error';
        this.emit(true);
        this.onChange({
            state: 'error',
            overall: this.computeOverall(),
            label: 'admin.pz_map.phase.error',
            error: message,
        });
    }

    /** Текущий agreggated прогресс. */
    private computeOverall(): number {
        let sum = 0;
        for (const [name, phase] of this.phases) {
            const value = this.phaseValues.get(name) ?? 0;
            sum += value * phase.weight;
        }
        return sum;
    }

    /** Оценка ETA в секундах на основе rolling window последних 5 секунд. */
    private computeEta(): number | undefined {
        const now = performance.now();
        const progress = this.computeOverall();
        this.etaWindow.push({ time: now, progress });
        // Сохраняем только последние 5 секунд.
        while (
            this.etaWindow.length > 1
            && now - this.etaWindow[0]!.time > 5000
        ) {
            this.etaWindow.shift();
        }
        if (this.etaWindow.length < 2) return undefined;
        const first = this.etaWindow[0]!;
        const last = this.etaWindow[this.etaWindow.length - 1]!;
        const dProgress = last.progress - first.progress;
        const dTime = (last.time - first.time) / 1000;
        if (dProgress <= 0 || dTime <= 0) return undefined;
        const rate = dProgress / dTime; // progress per second
        const remaining = 1 - progress;
        return remaining / rate;
    }

    private emit(force: boolean): void {
        const now = performance.now();
        if (!force && now - this.lastEmitMs < this.minIntervalMs) return;
        this.lastEmitMs = now;

        const overall = this.computeOverall();
        const label = this.currentPhase
            ? this.phases.get(this.currentPhase)!.label
            : '';
        const eta = this.computeEta();

        this.onChange({
            state: this.state,
            overall,
            label,
            details: eta !== undefined ? { etaSeconds: eta } : undefined,
        });
    }
}
