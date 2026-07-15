import { describe, expect, it } from 'vitest';
import { parseDoc, serializeDoc } from '../src/lib/perspective/io';
import { defaultDoc } from '../src/lib/perspective/scene';

describe('io (json inn/ut)', () => {
	it('round-trip beheld boksar (m/ pitch og grp), kamera og innstillingar', () => {
		const doc = defaultDoc();
		doc.boxes.push({ id: 'a', min: [0, 0, -2000], size: [500, 1750, 300], yaw: 0.5 });
		doc.boxes.push({ id: 'b', min: [0, 900, -2000], size: [80, 420, 80], yaw: 0.5, pitch: 0.7, grp: 'mq:gaande:1750:x1' });
		doc.settings.theme = 'dark';
		doc.settings.locked = true;
		doc.settings.fit = 'inscribe';
		doc.camera.pos = [100, 2200, 3000];
		const back = parseDoc(serializeDoc(doc));
		expect(back).not.toBeNull();
		expect(back!.boxes).toEqual(doc.boxes);
		expect(back!.settings.theme).toBe('dark');
		expect(back!.settings.locked).toBe(true);
		expect(back!.settings.fit).toBe('inscribe');
		expect(back!.camera.pos).toEqual([100, 2200, 3000]);
	});

	it('default er cover og lys modus utan lås', () => {
		const s = defaultDoc().settings;
		expect(s.fit).toBe('cover');
		expect(s.theme).toBe('light');
		expect(s.locked).toBe(false);
	});

	it('v1-dokument migrerer fit → cover; v2/v3 beheld valet', () => {
		const legacy = JSON.stringify({
			version: 1,
			boxes: [{ id: 'a', min: [0, 0, 0], size: [500, 500, 500], yaw: 0 }],
			camera: { pos: [0, 1780, 0] },
			settings: { fit: 'inscribe', theme: 'dark' }
		});
		const doc = parseDoc(legacy);
		expect(doc).not.toBeNull();
		expect(doc!.version).toBe(3);
		expect(doc!.settings.fit).toBe('cover'); // gammal default vart migrert
		expect(doc!.settings.theme).toBe('dark'); // aktive val overlever
		expect(doc!.boxes.length).toBe(1);
		expect(doc!.boxes[0].pitch).toBeUndefined(); // v1/v2-boksar er upitcha

		const kept = parseDoc(JSON.stringify({ version: 2, settings: { fit: 'inscribe' } }));
		expect(kept!.settings.fit).toBe('inscribe'); // v2: inscribe er eit medvite val
	});

	it('avviser feil versjon og ugyldig json; sanerer boksar', () => {
		expect(parseDoc('ikkje json')).toBeNull();
		expect(parseDoc(JSON.stringify({ version: 4 }))).toBeNull();
		const messy = JSON.stringify({
			version: 1,
			boxes: [
				{ id: 'ok', min: [0, 0, 0], size: [100, 100, 100], yaw: 0 },
				{ id: 'ok', min: [0, 0, 0], size: [100, 100, 100], yaw: 0 }, // duplikat-id
				{ id: 'neg', min: [0, 0, 0], size: [-5, 100, 100], yaw: 0 }, // ugyldig storleik
				'søppel'
			],
			camera: { pos: [0, 50, 0], fov: 999 },
			settings: { theme: 'blåbær', locked: 'ja' }
		});
		const doc = parseDoc(messy);
		expect(doc).not.toBeNull();
		expect(doc!.boxes.length).toBe(1);
		expect(doc!.camera.pos[1]).toBe(300); // clampa augehøgd
		expect(doc!.settings.theme).toBe('light'); // ugyldig tema → default
		expect(doc!.settings.locked).toBe(false); // ugyldig lås → default
	});
});
