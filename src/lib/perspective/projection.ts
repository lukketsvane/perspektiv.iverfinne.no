// projection.ts — rein projeksjonskjerne (§2). null importar.
// alle lengder i mm, vinklar i radianar. verdsaksar: +y opp, golv i y=0.

export type V3 = [number, number, number];

export type ProjName = 'stereo' | 'equi' | 'linear' | 'pano-equi' | 'pano-cyl';

export type CameraState = {
	pos: V3;
	yaw: number; // ψ kring +y; ψ=0 ser mot −z
	pitch: number; // τ, positiv opp
	fov: number; // radianar
	proj: ProjName;
};

export type ViewSize = { w: number; h: number; fit?: 'inscribe' | 'cover' };

export type Projected = { x: number; y: number; visible: boolean };

export type Frame = {
	pos: V3;
	right: V3;
	up: V3;
	fwd: V3;
	proj: ProjName;
	thetaMax: number;
	R: number;
	cx: number;
	cy: number;
	w: number;
	h: number;
	pitch: number; // pano treng τ som elevasjonsoffset
	// pano: px per radian horisontalt/vertikalt
	kh: number;
	kv: number;
};

// ---- vektorhjelparar (eksporterte for resten av lib-en) ----

export function vadd(a: V3, b: V3): V3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function vsub(a: V3, b: V3): V3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function vscale(a: V3, s: number): V3 {
	return [a[0] * s, a[1] * s, a[2] * s];
}
export function vdot(a: V3, b: V3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function vcross(a: V3, b: V3): V3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function vlen(a: V3): number {
	return Math.hypot(a[0], a[1], a[2]);
}
export function vnorm(a: V3): V3 {
	const l = vlen(a);
	return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export function vlerp(a: V3, b: V3, t: number): V3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
// rotasjon kring +y: rotY(α)·(1,0,0) = (cosα, 0, −sinα)
export function rotY(p: V3, a: number): V3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

// ---- ramme ----

const VIS_EPS = 1e-12;

export function isPano(proj: ProjName): boolean {
	return proj === 'pano-equi' || proj === 'pano-cyl';
}

export function makeFrame(cam: CameraState, view: ViewSize): Frame {
	const sy = Math.sin(cam.yaw);
	const cyaw = Math.cos(cam.yaw);
	const st = Math.sin(cam.pitch);
	const ct = Math.cos(cam.pitch);
	const pano = isPano(cam.proj);
	// pano: yaw-basis åleine; pitch vert vertikal skrolling (elevasjonsoffset)
	const fwd: V3 = pano ? [-sy, 0, -cyaw] : [-sy * ct, st, -cyaw * ct];
	const right: V3 = [cyaw, 0, -sy];
	const up: V3 = vcross(right, fwd);
	const thetaMax = cam.fov / 2;
	const R = view.fit === 'cover' ? 0.5 * Math.hypot(view.w, view.h) : 0.485 * Math.min(view.w, view.h);
	// pano-stripe: full breidd = 360°; vertikal halvhøgd = θmax (equi) i elevasjon
	const kh = view.w / (2 * Math.PI);
	const kv = view.h / 2 / Math.max(0.087, Math.min(thetaMax, Math.PI / 2));
	return {
		pos: [cam.pos[0], cam.pos[1], cam.pos[2]],
		right,
		up,
		fwd,
		proj: cam.proj,
		thetaMax,
		R,
		cx: view.w / 2,
		cy: view.h / 2,
		w: view.w,
		h: view.h,
		pitch: cam.pitch,
		kh,
		kv
	};
}

// ---- radiale mappingar (§2) ----

function mapTheta(proj: ProjName, theta: number, thetaMax: number): number {
	switch (proj) {
		case 'stereo':
			return Math.tan(theta / 2) / Math.tan(thetaMax / 2);
		case 'equi':
			return theta / thetaMax;
		case 'linear':
			return Math.tan(theta) / Math.tan(thetaMax);
		default:
			return theta / thetaMax;
	}
}

function mapInv(proj: ProjName, rn: number, thetaMax: number): number {
	switch (proj) {
		case 'stereo':
			return 2 * Math.atan(rn * Math.tan(thetaMax / 2));
		case 'equi':
			return rn * thetaMax;
		case 'linear':
			return Math.atan(rn * Math.tan(thetaMax));
		default:
			return rn * thetaMax;
	}
}

// ---- projeksjon ----

export function projectDir(f: Frame, d: V3): Projected {
	const xp = d[0] * f.right[0] + d[1] * f.right[1] + d[2] * f.right[2];
	const yp = d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2];
	const zp = d[0] * f.fwd[0] + d[1] * f.fwd[1] + d[2] * f.fwd[2];

	if (isPano(f.proj)) {
		// asimut kring yaw-aksen, elevasjon mot +y; pitch skrollar vertikalt
		const az = Math.atan2(xp, zp);
		const el = Math.atan2(yp, Math.hypot(xp, zp)) - f.pitch;
		let v: number;
		const half = f.h / 2 / f.kv; // synleg halv-elevasjon
		if (f.proj === 'pano-cyl') {
			if (Math.abs(el) > 1.48) return { x: 0, y: 0, visible: false }; // ~85°
			v = Math.tan(el);
			if (Math.abs(v) > Math.tan(Math.min(half, 1.48))) return { x: 0, y: 0, visible: false };
			return { x: f.cx + f.kh * az, y: f.cy - f.kv * v, visible: true };
		}
		if (Math.abs(el) > half + VIS_EPS || Math.abs(el) > Math.PI / 2)
			return { x: 0, y: 0, visible: false };
		return { x: f.cx + f.kh * az, y: f.cy - f.kv * el, visible: true };
	}

	const rxy = Math.hypot(xp, yp);
	const theta = Math.atan2(rxy, zp); // stabil ved θ≈0 og θ≈π
	if (theta > f.thetaMax * (1 + VIS_EPS) + VIS_EPS) return { x: 0, y: 0, visible: false };
	const rn = mapTheta(f.proj, theta, f.thetaMax);
	const inv = rxy > 0 ? 1 / rxy : 0;
	const cphi = rxy > 0 ? xp * inv : 1;
	const sphi = rxy > 0 ? yp * inv : 0;
	return { x: f.cx + f.R * rn * cphi, y: f.cy - f.R * rn * sphi, visible: true };
}

const SCRATCH_DIR: V3 = [0, 0, 0];

export function project(f: Frame, p: V3): Projected {
	const dx = p[0] - f.pos[0];
	const dy = p[1] - f.pos[1];
	const dz = p[2] - f.pos[2];
	const l = Math.hypot(dx, dy, dz);
	if (l === 0) return { x: 0, y: 0, visible: false };
	SCRATCH_DIR[0] = dx / l;
	SCRATCH_DIR[1] = dy / l;
	SCRATCH_DIR[2] = dz / l;
	return projectDir(f, SCRATCH_DIR);
}

// skjermpunkt → verdsretning (einingsvektor); ray = (C, d)
export function unproject(f: Frame, sx: number, sy: number): V3 {
	if (isPano(f.proj)) {
		const az = (sx - f.cx) / f.kh;
		const raw = (f.cy - sy) / f.kv;
		const el = (f.proj === 'pano-cyl' ? Math.atan(raw) : raw) + f.pitch;
		const ce = Math.cos(el);
		const dc: V3 = [Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce];
		return vnorm([
			dc[0] * f.right[0] + dc[1] * f.up[0] + dc[2] * f.fwd[0],
			dc[0] * f.right[1] + dc[1] * f.up[1] + dc[2] * f.fwd[1],
			dc[0] * f.right[2] + dc[1] * f.up[2] + dc[2] * f.fwd[2]
		]);
	}
	const u = (sx - f.cx) / f.R;
	const v = (f.cy - sy) / f.R;
	const rn = Math.hypot(u, v);
	const phi = Math.atan2(v, u);
	const theta = mapInv(f.proj, rn, f.thetaMax);
	const st = Math.sin(theta);
	const dc: V3 = [st * Math.cos(phi), st * Math.sin(phi), Math.cos(theta)];
	return vnorm([
		dc[0] * f.right[0] + dc[1] * f.up[0] + dc[2] * f.fwd[0],
		dc[0] * f.right[1] + dc[1] * f.up[1] + dc[2] * f.fwd[1],
		dc[0] * f.right[2] + dc[1] * f.up[2] + dc[2] * f.fwd[2]
	]);
}
