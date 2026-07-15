import { describe, expect, it } from 'vitest';
import { makeHistory, pushCmd, redo, undo, type Command } from '../src/lib/perspective/history';
import { cloneBox, defaultDoc, type Box, type Doc } from '../src/lib/perspective/scene';

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function mkBox(id: string, r: () => number): Box {
	return {
		id,
		min: [Math.round(r() * 100) * 50, 0, Math.round(r() * 100) * 50],
		size: [50 + Math.round(r() * 20) * 50, 50 + Math.round(r() * 40) * 50, 50 + Math.round(r() * 20) * 50],
		yaw: (Math.round(r() * 12) * 15 * Math.PI) / 180
	};
}

// utfør ein tilfeldig op på dokumentet OG registrer kommandoen (som appen gjer)
function randomOp(doc: Doc, h: ReturnType<typeof makeHistory>, r: () => number, n: number): void {
	const kind = doc.boxes.length === 0 ? 0 : Math.floor(r() * 3);
	if (kind === 0) {
		const box = mkBox(`b${n}`, r);
		doc.boxes.push(cloneBox(box, box.id));
		pushCmd(h, { kind: 'add', box });
	} else if (kind === 1) {
		const i = Math.floor(r() * doc.boxes.length);
		const box = cloneBox(doc.boxes[i], doc.boxes[i].id);
		doc.boxes.splice(i, 1);
		pushCmd(h, { kind: 'delete', box, index: i });
	} else {
		const i = Math.floor(r() * doc.boxes.length);
		const b = doc.boxes[i];
		const before = cloneBox(b, b.id);
		b.min[0] += Math.round(r() * 10) * 50;
		b.size[1] = 50 + Math.round(r() * 30) * 50;
		b.yaw = (Math.round(r() * 24) * 15 * Math.PI) / 180;
		pushCmd(h, { kind: 'update', id: b.id, before, after: cloneBox(b, b.id) });
	}
}

describe('history (§9.7)', () => {
	it('20 tilfeldige ops fram/attende gjev identisk doc-json', () => {
		const r = rng(99);
		const doc = defaultDoc();
		const h = makeHistory();
		const snapshots: string[] = [JSON.stringify(doc)];
		for (let i = 0; i < 20; i++) {
			randomOp(doc, h, r, i);
			snapshots.push(JSON.stringify(doc));
		}
		// attende til start
		for (let i = 20; i > 0; i--) {
			expect(undo(h, doc)).toBe(true);
			expect(JSON.stringify(doc)).toBe(snapshots[i - 1]);
		}
		expect(undo(h, doc)).toBe(false);
		// fram att til slutt
		for (let i = 1; i <= 20; i++) {
			expect(redo(h, doc)).toBe(true);
			expect(JSON.stringify(doc)).toBe(snapshots[i]);
		}
		expect(redo(h, doc)).toBe(false);
	});

	it('ny kommando tømer redo-stabelen', () => {
		const doc = defaultDoc();
		const h = makeHistory();
		const box = mkBox('a', rng(1));
		doc.boxes.push(cloneBox(box, box.id));
		pushCmd(h, { kind: 'add', box });
		undo(h, doc);
		expect(h.redoStack.length).toBe(1);
		const b2 = mkBox('b', rng(2));
		doc.boxes.push(cloneBox(b2, b2.id));
		pushCmd(h, { kind: 'add', box: b2 } as Command);
		expect(h.redoStack.length).toBe(0);
	});
});
