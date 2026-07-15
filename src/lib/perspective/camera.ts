// camera.ts — basis-ops og presetar for kameratilstanden (§2, §3)

import { vlen, vnorm, vsub, type CameraState, type ProjName, type V3 } from './projection';

const DEG = Math.PI / 180;

export const EYE_MIN = 300;
export const EYE_MAX = 10000;

// presetar for taltasting på augehøgd (mm)
export const EYE_PRESETS = [300, 1200, 1780, 3500, 8000] as const;

export const FOV_LIMITS: Record<ProjName, [number, number]> = {
	stereo: [20 * DEG, 300 * DEG], // fov < 360; ui-tak 300
	equi: [20 * DEG, 360 * DEG],
	linear: [20 * DEG, 170 * DEG], // fov < 180
	'pano-equi': [60 * DEG, 180 * DEG],
	'pano-cyl': [60 * DEG, 150 * DEG]
};

export const PROJ_ORDER: ProjName[] = ['stereo', 'equi', 'linear'];

export function defaultCamera(): CameraState {
	return { pos: [0, 1780, 4000], yaw: 0, pitch: 0, fov: 220 * DEG, proj: 'stereo' };
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

export function clampCamera(c: CameraState): CameraState {
	c.pos[1] = clamp(c.pos[1], EYE_MIN, EYE_MAX);
	const [lo, hi] = FOV_LIMITS[c.proj];
	c.fov = clamp(c.fov, lo, hi);
	c.pitch = clamp(c.pitch, -Math.PI / 2, Math.PI / 2);
	return c;
}

export function look(c: CameraState, dyaw: number, dpitch: number): CameraState {
	c.yaw += dyaw;
	c.pitch = clamp(c.pitch + dpitch, -Math.PI / 2, Math.PI / 2);
	return c;
}

// gange i golvplanet (mm), skjermrelativt til yaw
export function walk(c: CameraState, forwardMm: number, strafeMm: number): CameraState {
	const s = Math.sin(c.yaw);
	const k = Math.cos(c.yaw);
	c.pos[0] += -s * forwardMm + k * strafeMm;
	c.pos[2] += -k * forwardMm - s * strafeMm;
	return c;
}

export function setEye(c: CameraState, mm: number): CameraState {
	c.pos[1] = clamp(mm, EYE_MIN, EYE_MAX);
	return c;
}

export function setFov(c: CameraState, fov: number): CameraState {
	const [lo, hi] = FOV_LIMITS[c.proj];
	c.fov = clamp(fov, lo, hi);
	return c;
}

export function cycleProj(c: CameraState, order: ProjName[] = PROJ_ORDER): CameraState {
	const i = order.indexOf(c.proj);
	c.proj = order[(i + 1) % order.length];
	return clampCamera(c);
}

// set yaw/pitch slik at fwd peikar mot target
export function lookAt(c: CameraState, target: V3): CameraState {
	const d = vnorm(vsub(target, c.pos));
	c.pitch = Math.asin(clamp(d[1], -1, 1));
	c.yaw = Math.atan2(-d[0], -d[2]);
	return c;
}

// orbit kring target med konstant radius; ser alltid mot target
export function orbit(c: CameraState, target: V3, dyaw: number, dpitch: number): CameraState {
	const u = vsub(c.pos, target);
	const r = vlen(u);
	if (r < 1e-9) return c;
	const elev = Math.asin(clamp(u[1] / r, -1, 1));
	const azim = Math.atan2(u[0], u[2]);
	const e2 = clamp(elev + dpitch, -86 * DEG, 86 * DEG);
	const a2 = azim + dyaw;
	const ce = Math.cos(e2);
	c.pos = [
		target[0] + r * ce * Math.sin(a2),
		target[1] + r * Math.sin(e2),
		target[2] + r * ce * Math.cos(a2)
	];
	return lookAt(c, target);
}
