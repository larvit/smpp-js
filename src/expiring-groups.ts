export type ExpiringGroupsOptions = {
	max: number;
	/** What the groups may weigh together before weigh() evicts the oldest. */
	maxWeight?: number | undefined;
	/** Injected so expiry can be exercised without a wall clock. */
	now?: (() => number) | undefined;
	/** Runs on the sweeper's own timer; the owner reports whatever it takes out. */
	onSweep: () => void;
	timeout: number;
};

type Entry<T> = {
	deadline: number;
	group: T;
	weight: number;
};

/**
 * A capped store of groups that expire. Nothing is dropped silently: the owner takes the expired
 * and the evicted out itself, so the accounting and the log line stay where the group is understood.
 */
export class ExpiringGroups<T> {
	private readonly entries = new Map<string, Entry<T>>();
	private readonly max: number;
	private readonly maxWeight: number;
	private readonly now: () => number;
	private readonly onSweep: () => void;
	private readonly timeout: number;
	private sweeper: NodeJS.Timeout | undefined;
	private total = 0;

	constructor(options: ExpiringGroupsOptions) {
		this.max = options.max;
		this.maxWeight = options.maxWeight ?? Infinity;
		this.now = options.now ?? Date.now;
		this.onSweep = options.onSweep;
		this.timeout = options.timeout;
	}

	get full(): boolean {
		return this.entries.size >= this.max;
	}

	get size(): number {
		return this.entries.size;
	}

	get weight(): number {
		return this.total;
	}

	get(key: string): T | undefined {
		return this.entries.get(key)?.group;
	}

	/** Starts the group's deadline, and the sweeper if this is the only group held. */
	set(key: string, group: T, weight = 0): void {
		this.remove(key);
		this.entries.set(key, { deadline: this.now() + this.timeout, group, weight });
		this.total += weight;

		if (this.sweeper) return;

		this.sweeper = setInterval(() => { this.onSweep(); }, this.timeout);
		this.sweeper.unref();
	}

	delete(key: string): void {
		this.remove(key);
		this.idle();
	}

	/** Records what a group weighs now, and hands over the oldest groups evicted to bring the total under maxWeight. */
	weigh(key: string, weight: number): [string, T][] {
		const entry = this.entries.get(key);
		const taken: [string, T][] = [];

		if (entry) {
			this.total += weight - entry.weight;
			entry.weight = weight;
		}

		while (this.total > this.maxWeight) {
			const oldest = this.takeOldest();

			if (!oldest) break;

			taken.push(oldest);
		}

		return taken;
	}

	/** Removes every group and hands them over, so an owner that must account for them can. */
	takeAll(): [string, T][] {
		const taken: [string, T][] = [];

		for (const [key, entry] of this.entries) {
			taken.push([key, entry.group]);
		}

		this.entries.clear();
		this.total = 0;
		this.idle();

		return taken;
	}

	/** Removes every group past its deadline and hands them over. */
	takeExpired(): [string, T][] {
		const now = this.now();
		const taken: [string, T][] = [];

		for (const [key, entry] of this.entries) {
			if (entry.deadline > now) continue;

			taken.push([key, entry.group]);
			this.remove(key);
		}

		this.idle();

		return taken;
	}

	/** Removes the group held longest and hands it over. Undefined means there was none. */
	takeOldest(): [string, T] | undefined {
		const oldest = this.entries.entries().next();

		if (oldest.done) return undefined;

		const [key, entry] = oldest.value;

		this.delete(key);

		return [key, entry.group];
	}

	private remove(key: string): void {
		const entry = this.entries.get(key);

		if (!entry) return;

		this.entries.delete(key);
		this.total -= entry.weight;
	}

	private idle(): void {
		if (!this.sweeper || this.entries.size > 0) return;

		clearInterval(this.sweeper);
		this.sweeper = undefined;
	}
}
