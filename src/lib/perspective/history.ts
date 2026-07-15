// history.ts — kommandostabel med før/etter (AddBox / DeleteBox / UpdateBox) (§6)

import { cloneBox, type Box, type Doc } from './scene';

export type Command =
	| { kind: 'add'; box: Box }
	| { kind: 'delete'; box: Box; index: number }
	| { kind: 'update'; id: string; before: Box; after: Box };

export type History = { undoStack: Command[]; redoStack: Command[]; limit: number };

export function makeHistory(limit = 200): History {
	return { undoStack: [], redoStack: [], limit };
}

// registrer ein kommando som ALT er utført på dokumentet
export function pushCmd(h: History, cmd: Command): void {
	h.undoStack.push(cmd);
	h.redoStack.length = 0;
	if (h.undoStack.length > h.limit) h.undoStack.shift();
}

function applyForward(doc: Doc, cmd: Command): void {
	switch (cmd.kind) {
		case 'add':
			doc.boxes.push(cloneBox(cmd.box, cmd.box.id));
			break;
		case 'delete':
			doc.boxes = doc.boxes.filter((b) => b.id !== cmd.box.id);
			break;
		case 'update': {
			const b = doc.boxes.find((x) => x.id === cmd.id);
			if (b) {
				b.min = [...cmd.after.min];
				b.size = [...cmd.after.size];
				b.yaw = cmd.after.yaw;
			}
			break;
		}
	}
}

function applyBackward(doc: Doc, cmd: Command): void {
	switch (cmd.kind) {
		case 'add':
			doc.boxes = doc.boxes.filter((b) => b.id !== cmd.box.id);
			break;
		case 'delete': {
			const i = Math.min(cmd.index, doc.boxes.length);
			doc.boxes.splice(i, 0, cloneBox(cmd.box, cmd.box.id));
			break;
		}
		case 'update': {
			const b = doc.boxes.find((x) => x.id === cmd.id);
			if (b) {
				b.min = [...cmd.before.min];
				b.size = [...cmd.before.size];
				b.yaw = cmd.before.yaw;
			}
			break;
		}
	}
}

export function undo(h: History, doc: Doc): boolean {
	const cmd = h.undoStack.pop();
	if (!cmd) return false;
	applyBackward(doc, cmd);
	h.redoStack.push(cmd);
	return true;
}

export function redo(h: History, doc: Doc): boolean {
	const cmd = h.redoStack.pop();
	if (!cmd) return false;
	applyForward(doc, cmd);
	h.undoStack.push(cmd);
	return true;
}
