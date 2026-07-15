import { describe, expect, it } from 'vitest';
import { applyAction, makeUi } from '../src/lib/ui/ops';
import { defaultDoc } from '../src/lib/perspective/scene';
import { makeFrame } from '../src/lib/perspective/projection';

function rig() {
	let t = 1000;
	const ui = makeUi(defaultDoc(), () => t);
	return { ui, advance: (ms: number) => (t += ms) };
}

// ramme så peikar-/stempelhandlingar har unproject å arbeide med
function withFrame(ui: ReturnType<typeof makeUi>) {
	ui.frame = makeFrame(ui.doc.camera, { w: 1200, h: 800, fit: ui.doc.settings.fit });
}

describe('referanselås (v1.2)', () => {
	it('låst: redigering og kamera vert blokkerte, med hud-melding', () => {
		const { ui } = rig();
		ui.doc.settings.locked = true;
		const eye0 = ui.doc.camera.pos[1];

		applyAction(ui, { t: 'select', id: 'x' });
		expect(ui.selection).toBeNull();

		applyAction(ui, { t: 'eye-set', m: 3.5 });
		expect(ui.doc.camera.pos[1]).toBe(eye0);

		applyAction(ui, { t: 'look', dx: 40, dy: 0 });
		expect(ui.doc.camera.yaw).toBe(0);

		applyAction(ui, { t: 'preset-load', name: 'folkemengd' });
		expect(ui.doc.boxes.length).toBe(0);

		expect(ui.hudText).toContain('låst');
	});

	it('lås-toggle og tema-toggle verkar òg medan låst', () => {
		const { ui } = rig();
		ui.doc.settings.locked = true;
		applyAction(ui, { t: 'theme-toggle' });
		expect(ui.doc.settings.theme).toBe('dark');
		applyAction(ui, { t: 'lock-toggle' });
		expect(ui.doc.settings.locked).toBe(false);
		// opna: vanlege handlingar verkar att
		applyAction(ui, { t: 'select', id: 'x' });
		expect(ui.selection).toBe('x');
		applyAction(ui, { t: 'eye-set', m: 1.78 });
		expect(ui.doc.camera.pos[1]).toBe(1780);
	});
});

describe('meter-semantikk i ops', () => {
	it('eye-set tolkar meter og clampar i mm', () => {
		const { ui } = rig();
		applyAction(ui, { t: 'eye-set', m: 1.78 });
		expect(ui.doc.camera.pos[1]).toBe(1780);
		applyAction(ui, { t: 'eye-set', m: 99 });
		expect(ui.doc.camera.pos[1]).toBe(10000); // EYE_MAX
		applyAction(ui, { t: 'eye-set', m: 0.01 });
		expect(ui.doc.camera.pos[1]).toBe(300); // EYE_MIN
	});
});

describe('tema', () => {
	it('theme-toggle flippar og set dirty (canvas må teiknast om)', () => {
		const { ui } = rig();
		ui.dirty = false;
		applyAction(ui, { t: 'theme-toggle' });
		expect(ui.doc.settings.theme).toBe('dark');
		expect(ui.dirty).toBe(true);
		applyAction(ui, { t: 'theme-toggle' });
		expect(ui.doc.settings.theme).toBe('light');
	});
});

describe('mannekeng i ops (v2.1)', () => {
	it('figure-stamp set inn 16-delars gruppe; f byter positur; slett fjernar alt; angre gjenopprettar', () => {
		const { ui } = rig();
		withFrame(ui);
		applyAction(ui, { t: 'figure-stamp', x: 600, y: 560 });
		expect(ui.doc.boxes.length).toBe(16);
		const grp0 = ui.doc.boxes[0].grp!;
		expect(grp0.startsWith('mq:staande:')).toBe(true);
		expect(ui.selection).toBe(ui.doc.boxes[0].id);

		// f: positur-syklus staande → gaande, framleis 16 delar, same uid
		applyAction(ui, { t: 'figure-key' });
		expect(ui.doc.boxes.length).toBe(16);
		const grp1 = ui.doc.boxes[0].grp!;
		expect(grp1.startsWith('mq:gaande:')).toBe(true);
		expect(grp1.split(':')[3]).toBe(grp0.split(':')[3]);

		// angre positur-byte → staande att; angre stempel → tomt
		applyAction(ui, { t: 'undo' });
		expect(ui.doc.boxes[0].grp).toBe(grp0);
		expect(ui.doc.boxes.length).toBe(16);
		applyAction(ui, { t: 'undo' });
		expect(ui.doc.boxes.length).toBe(0);
		applyAction(ui, { t: 'redo' });
		expect(ui.doc.boxes.length).toBe(16);

		// slett: heile gruppa forsvinn som eitt steg; angre hentar alt attende
		applyAction(ui, { t: 'select', id: ui.doc.boxes[5].id });
		applyAction(ui, { t: 'delete-selected' });
		expect(ui.doc.boxes.length).toBe(0);
		applyAction(ui, { t: 'undo' });
		expect(ui.doc.boxes.length).toBe(16);
	});

	it('flytt på gruppemedlem flytter heile mannekengen', () => {
		const { ui } = rig();
		withFrame(ui);
		applyAction(ui, { t: 'figure-stamp', x: 600, y: 560 });
		const before = ui.doc.boxes.map((b) => [...b.min] as [number, number, number]);
		const grabbed = ui.doc.boxes[3];
		applyAction(ui, { t: 'move-start', id: grabbed.id, x: 600, y: 560, duplicate: false });
		applyAction(ui, { t: 'move-update', x: 660, y: 560 });
		applyAction(ui, { t: 'move-commit' });
		const dx = ui.doc.boxes[3].min[0] - before[3][0];
		const dz = ui.doc.boxes[3].min[2] - before[3][2];
		expect(Math.hypot(dx, dz)).toBeGreaterThan(1);
		for (let i = 0; i < ui.doc.boxes.length; i++) {
			expect(ui.doc.boxes[i].min[0] - before[i][0]).toBeCloseTo(dx, 6);
			expect(ui.doc.boxes[i].min[2] - before[i][2]).toBeCloseTo(dz, 6);
			expect(ui.doc.boxes[i].min[1]).toBeCloseTo(before[i][1], 6); // y uendra
		}
		// angre flyttinga (batch): alle attende
		applyAction(ui, { t: 'undo' });
		for (let i = 0; i < ui.doc.boxes.length; i++) {
			expect(ui.doc.boxes[i].min[0]).toBeCloseTo(before[i][0], 6);
		}
	});
});
