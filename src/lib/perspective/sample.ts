// sample.ts — adaptiv sampling av kurver til polylinjer i skjerm-px (§2). null importar.
// projektoren vert injisert som funksjon; same kode driv canvas og svg.

type P3 = [number, number, number];
type PP = { x: number; y: number; visible: boolean };

export type Polyline = number[]; // flate par [x0,y0, x1,y1, ...]
export type ProjPointFn = (p: P3) => PP;
export type ProjDirFn = (d: P3) => PP;

export type SampleOpts = {
	eps?: number; // maks kurvefeil, css-px (0.35)
	maxDepth?: number; // maks subdivisjonsdjupn (11)
	boundaryTolPx?: number; // bisseksjon mot θmax (0.1 px)
	nearClipMm?: number; // nærkamera-vakt (1 mm)
	camPos?: P3; // trengst for nærvakta
	maxJumpPx?: number; // brotgrense for diskontinuitet (pano-saum); default av
};

type Opts = {
	eps: number;
	maxDepth: number;
	btol: number;
	nearClip: number;
	camPos: P3 | null;
	maxJump: number;
};

function normOpts(o?: SampleOpts): Opts {
	return {
		eps: o?.eps ?? 0.35,
		maxDepth: o?.maxDepth ?? 11,
		btol: o?.boundaryTolPx ?? 0.1,
		nearClip: o?.nearClipMm ?? 1,
		camPos: o?.camPos ?? null,
		maxJump: o?.maxJumpPx ?? Infinity
	};
}

type Emitter = {
	lines: Polyline[];
	emit(x: number, y: number): void;
	brk(): void;
};

function makeEmitter(): Emitter {
	const lines: Polyline[] = [];
	let cur: Polyline | null = null;
	return {
		lines,
		emit(x, y) {
			if (!cur) {
				cur = [x, y];
				lines.push(cur);
			} else {
				const n = cur.length;
				if (cur[n - 2] !== x || cur[n - 1] !== y) cur.push(x, y);
			}
		},
		brk() {
			cur = null;
		}
	};
}

type Ev = (t: number) => PP;

// binærsøk frå synleg mot usynleg til den synlege enden flyttar seg < btol px
function bisect(ev: Ev, tVis: number, sVis: PP, tInv: number, o: Opts): [number, PP] {
	let lo = tVis;
	let sLo = sVis;
	let hi = tInv;
	for (let i = 0; i < 64; i++) {
		const tm = (lo + hi) / 2;
		const sm = ev(tm);
		if (sm.visible) {
			const moved = Math.hypot(sm.x - sLo.x, sm.y - sLo.y);
			lo = tm;
			sLo = sm;
			if (moved < o.btol && i > 3) break;
		} else {
			hi = tm;
		}
	}
	return [lo, sLo];
}

function subdivide(ev: Ev, t0: number, s0: PP, t1: number, s1: PP, depth: number, em: Emitter, o: Opts): void {
	const v0 = s0.visible;
	const v1 = s1.visible;

	if (v0 && v1) {
		const tm = (t0 + t1) / 2;
		const sm = ev(tm);
		if (sm.visible) {
			const err = Math.hypot(sm.x - (s0.x + s1.x) / 2, sm.y - (s0.y + s1.y) / 2);
			const jump = Math.hypot(s1.x - s0.x, s1.y - s0.y);
			if ((err <= o.eps && jump <= o.maxJump) || depth >= o.maxDepth) {
				if (jump > o.maxJump) {
					// diskontinuitet (t.d. pano-saum): stopp her, start ny line
					em.brk();
					em.emit(s1.x, s1.y);
				} else {
					em.emit(s1.x, s1.y);
				}
				return;
			}
			subdivide(ev, t0, s0, tm, sm, depth + 1, em, o);
			subdivide(ev, tm, sm, t1, s1, depth + 1, em, o);
			return;
		}
		// begge endar synlege, midten utanfor: to randkryssingar
		if (depth >= o.maxDepth) {
			em.emit(s1.x, s1.y);
			return;
		}
		const [ta, sa] = bisect(ev, t0, s0, tm, o);
		const [tb, sb] = bisect(ev, t1, s1, tm, o);
		subdivide(ev, t0, s0, ta, sa, depth + 1, em, o);
		em.brk();
		em.emit(sb.x, sb.y);
		subdivide(ev, tb, sb, t1, s1, depth + 1, em, o);
		return;
	}

	if (v0 && !v1) {
		const [ta, sa] = bisect(ev, t0, s0, t1, o);
		if (depth >= o.maxDepth) {
			em.emit(sa.x, sa.y);
			em.brk();
			return;
		}
		subdivide(ev, t0, s0, ta, sa, depth + 1, em, o);
		em.brk();
		return;
	}

	if (!v0 && v1) {
		const [tb, sb] = bisect(ev, t1, s1, t0, o);
		em.brk();
		em.emit(sb.x, sb.y);
		if (depth >= o.maxDepth) {
			em.emit(s1.x, s1.y);
			return;
		}
		subdivide(ev, tb, sb, t1, s1, depth + 1, em, o);
		return;
	}

	// begge usynlege: sjekk om midten dukkar innanfor
	if (depth >= o.maxDepth) return;
	const tm = (t0 + t1) / 2;
	const sm = ev(tm);
	if (!sm.visible) return; // dropp
	const [ta, sa] = bisect(ev, tm, sm, t0, o);
	const [tb, sb] = bisect(ev, tm, sm, t1, o);
	em.brk();
	em.emit(sa.x, sa.y);
	subdivide(ev, ta, sa, tm, sm, depth + 1, em, o);
	subdivide(ev, tm, sm, tb, sb, depth + 1, em, o);
	em.brk();
}

function sampleCurveInto(ev: Ev, t0: number, t1: number, em: Emitter, o: Opts): void {
	const s0 = ev(t0);
	const s1 = ev(t1);
	if (s0.visible) em.emit(s0.x, s0.y);
	subdivide(ev, t0, s0, t1, s1, 0, em, o);
}

// [t0,t1]-intervall av segmentet som ligg utanfor nærsfæra kring C
function clipNear(A: P3, B: P3, C: P3, r: number): Array<[number, number]> {
	const dx = A[0] - C[0];
	const dy = A[1] - C[1];
	const dz = A[2] - C[2];
	const ex = B[0] - A[0];
	const ey = B[1] - A[1];
	const ez = B[2] - A[2];
	const a = ex * ex + ey * ey + ez * ez;
	const c = dx * dx + dy * dy + dz * dz - r * r;
	if (a === 0) return c > 0 ? [[0, 1]] : [];
	const b = 2 * (dx * ex + dy * ey + dz * ez);
	const disc = b * b - 4 * a * c;
	if (disc <= 0) return [[0, 1]];
	const sq = Math.sqrt(disc);
	const t0 = (-b - sq) / (2 * a);
	const t1 = (-b + sq) / (2 * a);
	if (t1 <= 0 || t0 >= 1) return [[0, 1]];
	const out: Array<[number, number]> = [];
	if (t0 > 0) out.push([0, Math.min(t0, 1)]);
	if (t1 < 1) out.push([Math.max(t1, 0), 1]);
	return out;
}

// verdssegment [A,B] → polylinjer i skjerm-px
export function sampleSegment(proj: ProjPointFn, A: P3, B: P3, opts?: SampleOpts): Polyline[] {
	const o = normOpts(opts);
	const em = makeEmitter();
	const pieces = o.camPos ? clipNear(A, B, o.camPos, o.nearClip) : ([[0, 1]] as Array<[number, number]>);
	const scratch: P3 = [0, 0, 0];
	const ax = A[0];
	const ay = A[1];
	const az = A[2];
	const bx = B[0] - ax;
	const by = B[1] - ay;
	const bz = B[2] - az;
	const ev: Ev = (t) => {
		scratch[0] = ax + bx * t;
		scratch[1] = ay + by * t;
		scratch[2] = az + bz * t;
		return proj(scratch);
	};
	for (const [ta, tb] of pieces) {
		if (tb - ta < 1e-12) continue;
		sampleCurveInto(ev, ta, tb, em, o);
		em.brk();
	}
	return em.lines.filter((l) => l.length >= 4);
}

// lukka storsirkel d(t) = cos t·u + sin t·v (u ⊥ v, einingsvektorar) → polylinjer
export function sampleDirLoop(projDir: ProjDirFn, u: P3, v: P3, opts?: SampleOpts): Polyline[] {
	const o = normOpts(opts);
	const em = makeEmitter();
	const scratch: P3 = [0, 0, 0];
	const ev: Ev = (t) => {
		const ct = Math.cos(t);
		const st = Math.sin(t);
		scratch[0] = ct * u[0] + st * v[0];
		scratch[1] = ct * u[1] + st * v[1];
		scratch[2] = ct * u[2] + st * v[2];
		return projDir(scratch);
	};
	const ARCS = 8;
	for (let k = 0; k < ARCS; k++) {
		sampleCurveInto(ev, (k / ARCS) * 2 * Math.PI, ((k + 1) / ARCS) * 2 * Math.PI, em, o);
	}
	em.brk();
	return em.lines.filter((l) => l.length >= 4);
}

// open boge på storsirkelen, t ∈ [t0, t1]
export function sampleDirArc(
	projDir: ProjDirFn,
	u: P3,
	v: P3,
	t0: number,
	t1: number,
	opts?: SampleOpts
): Polyline[] {
	const o = normOpts(opts);
	const em = makeEmitter();
	const scratch: P3 = [0, 0, 0];
	const ev: Ev = (t) => {
		const ct = Math.cos(t);
		const st = Math.sin(t);
		scratch[0] = ct * u[0] + st * v[0];
		scratch[1] = ct * u[1] + st * v[1];
		scratch[2] = ct * u[2] + st * v[2];
		return projDir(scratch);
	};
	sampleCurveInto(ev, t0, t1, em, o);
	em.brk();
	return em.lines.filter((l) => l.length >= 4);
}
