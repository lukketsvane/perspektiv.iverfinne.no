// history.ts — kommandostabel med før/etter (AddBox / DeleteBox / UpdateBox) (§6)

import { cloneBox, type Box, type Doc } from './scene';

export type Command =
	| { kind: 'add'; box: Box }
	| { kind: 'delete'; box: Box; index: number }
	| { kind: 'update'; id: string; before: Box; after: Box }
	// heil-scene-byte (preset-lasting): angrast som eitt steg
	| { kind: 'scene'; before: Box[]; after: Box[] }
	// fleire delkommandoar som eitt angre-steg (mannekeng-grupper)
	| { kind: 'batch'; cmds: Command[] };

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
			if (b) copyInto(b, cmd.after);
			break;
		}
		case 'scene':
			doc.boxes = cmd.after.map((b) => cloneBox(b, b.id));
			break;
		case 'batch':
			for (const c of cmd.cmds) applyForward(doc, c);
			break;
	}
}

function copyInto(b: Box, src: Box): void {
	b.min = [...src.min];
	b.size = [...src.size];
	b.yaw = src.yaw;
	if (src.pitch) b.pitch = src.pitch;
	else delete b.pitch;
	if (src.grp) b.grp = src.grp;
	else delete b.grp;
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
			if (b) copyInto(b, cmd.before);
			break;
		}
		case 'scene':
			doc.boxes = cmd.before.map((b) => cloneBox(b, b.id));
			break;
		case 'batch':
			for (let i = cmd.cmds.length - 1; i >= 0; i--) applyBackward(doc, cmd.cmds[i]);
			break;
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
