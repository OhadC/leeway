export type Pool = {
    start: number;
    end: number;
};

export class Pools {
    static readonly DEFAULT: Pool[] = [{ start: 21000, end: 29999 }];

    static ofTexts(texts: readonly string[]): Pool[] {
        const pools = texts.map(Pools.ofText);
        const problem = Pools.problem(pools);

        if (problem) {
            throw new Error(`leeway: ${problem}`);
        }

        return pools;
    }

    static problem(pools: unknown): string | undefined {
        if (!Array.isArray(pools) || pools.length === 0) {
            return "at least one pool is needed, written start-end";
        }

        const readable = pools.flatMap(pool => Pools.readable(pool) ?? []);

        if (readable.length < pools.length) {
            return Pools.rejection(pools.find(pool => !Pools.readable(pool)));
        }

        const byStart = readable.sort((left, right) => left.start - right.start);
        const overlapping = byStart.findIndex((pool, index) => index > 0 && pool.start <= byStart[index - 1]!.end);

        return overlapping === -1
            ? undefined
            : `${Pools.textOfPool(byStart[overlapping - 1]!)} and ${Pools.textOfPool(byStart[overlapping]!)} overlap`;
    }

    static readable(value: unknown): Pool | undefined {
        if (!isObject(value)) {
            return undefined;
        }

        const { start, end } = value;

        return isPortNumber(start) && isPortNumber(end) && start <= end ? { start, end } : undefined;
    }

    static holds(pools: Pool[], start: number, end = start): boolean {
        return pools.some(pool => pool.start <= start && end <= pool.end);
    }

    static text(pools: Pool[]): string {
        return pools.map(Pools.textOfPool).join(", ");
    }

    static render(pools: Pool[]): string {
        const marker = Pools.text(pools) === Pools.text(Pools.DEFAULT) ? " (the default pool)" : "";

        return pools.map(pool => `${Pools.textOfPool(pool)}${marker}\n`).join("");
    }

    private static ofText(text: string): Pool {
        const match = /^(\d+)-(\d+)$/.exec(text);

        if (!match) {
            throw new Error(`leeway: ${text} is not a pool; write it start-end, like 21000-29999`);
        }

        return { start: Number(match[1]), end: Number(match[2]) };
    }

    private static textOfPool({ start, end }: Pool): string {
        return `${start}-${end}`;
    }

    private static rejection(value: unknown): string {
        const reversed = isObject(value) && Pools.readable({ start: value.end, end: value.start }) !== undefined;

        return `${Pools.textOfUnreadable(value)} ${reversed ? "starts after it ends" : "is not a pool of ports 1-65535"}`;
    }

    private static textOfUnreadable(value: unknown): string {
        return isObject(value) && typeof value.start === "number" && typeof value.end === "number"
            ? Pools.textOfPool({ start: value.start, end: value.end })
            : JSON.stringify(value);
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPortNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}
