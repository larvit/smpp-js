export type ExpiringGroupsOptions = {
	max: number;
	/** Enforced by weigh() alone; set() never evicts. */
	maxWeight?: number | undefined;
	/** Injected so expiry can be exercised without a wall clock. */
	now?: (() => number) | undefined;
	/** Must call takeExpired(): the timer itself removes nothing. */
	onSweep: () => void;
	timeout: number;
};

type Entry<T> = {
	deadline: number;
	group: T;
	weight: number;
};

/** Enforces neither max nor timeout itself: owners check full and call takeExpired(); only weigh() evicts. */
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

	/** Replacing a key restarts its deadline and zeroes its weight; weigh() it again. */
	set(key: string, group: T): void {
		this.remove(key);
		this.entries.set(key, { deadline: this.now() + this.timeout, group, weight: 0 });

		if (this.sweeper) return;

		this.sweeper = setInterval(() => { this.onSweep(); }, this.timeout);
		this.sweeper.unref();
	}

	delete(key: string): void {
		this.remove(key);
		this.idle();
	}

	/** The returned groups are already removed, and may include key itself. */
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
