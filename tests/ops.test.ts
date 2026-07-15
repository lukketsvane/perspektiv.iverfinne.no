import { describe, expect, it } from 'vitest';
import { applyAction, makeUi } from '../src/lib/ui/ops';
import { defaultDoc } from '../src/lib/perspective/scene';

function rig() {
	let t = 1000;
	const ui = makeUi(defaultDoc(), () => t);
	return { ui, advance: (ms: number) => (t += ms) };
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
