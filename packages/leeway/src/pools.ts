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

        const unreadable = pools.find(pool => !isObject(pool) || !isPortNumber(pool.start) || !isPortNumber(pool.end));

        if (unreadable !== undefined) {
            return `${Pools.textOfUnreadable(unreadable)} is not a pool of ports 1-65535`;
        }

        const readable = pools as Pool[];
        const reversed = readable.find(pool => pool.start > pool.end);

        if (reversed) {
            return `${Pools.textOfPool(reversed)} starts after it ends`;
        }

        const byStart = [...readable].sort((left, right) => left.start - right.start);
        const overlapping = byStart.findIndex((pool, index) => index > 0 && pool.start <= byStart[index - 1]!.end);

        return overlapping === -1
            ? undefined
            : `${Pools.textOfPool(byStart[overlapping - 1]!)} and ${Pools.textOfPool(byStart[overlapping]!)} overlap`;
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
