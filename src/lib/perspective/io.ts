// io.ts — json inn/ut og localStorage-autolagring med debounce (§6)

import { clampCamera } from './camera';
import { defaultDoc, defaultSettings, type Box, type Doc } from './scene';
import type { ProjName, V3 } from './projection';

export const STORAGE_KEY = 'femtepunkt.doc.v1';
export const AUTOSAVE_DEBOUNCE_MS = 1000;

const PROJ_NAMES: ProjName[] = ['stereo', 'equi', 'linear', 'pano-equi', 'pano-cyl'];

export function serializeDoc(doc: Doc): string {
	return JSON.stringify(doc);
}

function num(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function vec3(v: unknown, fallback: V3): V3 {
	if (!Array.isArray(v) || v.length !== 3) return [...fallback];
	return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])];
}

function sanitizeBox(v: unknown, i: number): Box | null {
	if (typeof v !== 'object' || v === null) return null;
	const o = v as Record<string, unknown>;
	const size = vec3(o.size, [50, 50, 50]);
	if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return null;
	const b: Box = {
		id: typeof o.id === 'string' && o.id !== '' ? o.id : `import${i}`,
		min: vec3(o.min, [0, 0, 0]),
		size,
		yaw: num(o.yaw, 0)
	};
	const pitch = num(o.pitch, 0);
	if (pitch !== 0) b.pitch = pitch;
	if (typeof o.grp === 'string' && o.grp !== '') b.grp = o.grp;
	return b;
}

// tolerant parsing: ukjende felt vert ignorerte, manglande fyller frå default
export function parseDoc(json: string): Doc | null {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof raw !== 'object' || raw === null) return null;
	const o = raw as Record<string, unknown>;
	if (o.version !== 1 && o.version !== 2 && o.version !== 3) return null;
	// v1-dokument er frå før cover vart default; fit der var ikkje eit aktivt val
	const legacy = o.version === 1;

	const base = defaultDoc();
	const boxes: Box[] = [];
	if (Array.isArray(o.boxes)) {
		const seen = new Set<string>();
		for (let i = 0; i < o.boxes.length; i++) {
			const b = sanitizeBox(o.boxes[i], i);
			if (!b || seen.has(b.id)) continue;
			seen.add(b.id);
			boxes.push(b);
		}
	}

	const cam = (typeof o.camera === 'object' && o.camera !== null ? o.camera : {}) as Record<
		string,
		unknown
	>;
	base.camera.pos = vec3(cam.pos, base.camera.pos);
	base.camera.yaw = num(cam.yaw, base.camera.yaw);
	base.camera.pitch = num(cam.pitch, base.camera.pitch);
	base.camera.fov = num(cam.fov, base.camera.fov);
	base.camera.proj = PROJ_NAMES.includes(cam.proj as ProjName)
		? (cam.proj as ProjName)
		: base.camera.proj;
	clampCamera(base.camera);

	const settings = { ...defaultSettings() };
	if (typeof o.settings === 'object' && o.settings !== null) {
		const s = o.settings as Record<string, unknown>;
		for (const k of Object.keys(settings) as Array<keyof typeof settings>) {
			if (k === 'fit') {
				if (s.fit === 'cover' || s.fit === 'inscribe') settings.fit = s.fit;
			} else if (k === 'theme') {
				if (s.theme === 'light' || s.theme === 'dark') settings.theme = s.theme;
			} else if (typeof s[k] === 'boolean') {
				(settings[k] as boolean) = s[k] as boolean;
			}
		}
	}

	if (legacy) settings.fit = 'cover'; // migrasjon: ny default vinn over gammal default

	return { version: 3, boxes, camera: base.camera, settings };
}

export function saveLocal(doc: Doc): void {
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, serializeDoc(doc));
	} catch {
		// full/utilgjengeleg lagring: stille
	}
}

export function loadLocal(): Doc | null {
	try {
		const json = globalThis.localStorage?.getItem(STORAGE_KEY);
		return json ? parseDoc(json) : null;
	} catch {
		return null;
	}
}

export function makeAutosaver(
	get: () => Doc,
	delayMs = AUTOSAVE_DEBOUNCE_MS
): { touch: () => void; flush: () => void; dispose: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		saveLocal(get());
	};
	return {
		touch() {
			if (timer) clearTimeout(timer);
			timer = setTimeout(flush, delayMs);
		},
		flush,
		dispose() {
			if (timer) clearTimeout(timer);
			timer = null;
		}
	};
}
