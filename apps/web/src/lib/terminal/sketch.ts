/**
 * The geometry behind the coming-soon sketches (components/terminal/sketches). Each sketch moves
 * only under the pointer: these turn a pointer position into the drawing's own coordinates and
 * keep each moving part within its range. Nothing here runs on a timer.
 */
import type { Attachment } from 'svelte/attachments';

export interface Point {
	x: number;
	y: number;
}

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** A pointer position on screen, in the units of a drawing `w` by `h` that fills `box`. */
export function toViewBox(
	client: { clientX: number; clientY: number },
	box: Box,
	w: number,
	h: number
): Point {
	return {
		x: Math.round(((client.clientX - box.left) / box.width) * w),
		y: Math.round(((client.clientY - box.top) / box.height) * h)
	};
}

/** The turn from one angle to the next, in radians, taking the short way round (−π to π). */
export function angleStep(from: number, to: number): number {
	let step = to - from;
	while (step > Math.PI) step -= 2 * Math.PI;
	while (step < -Math.PI) step += 2 * Math.PI;
	return step;
}

/** The angle of `point` around `centre`, in radians, 0 pointing right, growing clockwise on screen. */
export function angleAround(point: Point, centre: Point): number {
	return Math.atan2(point.y - centre.y, point.x - centre.x);
}

export interface DragHandlers {
	/** The pointer went down on the drawing. */
	start?: (at: Point) => void;
	/** The pointer moved while down. */
	move: (at: Point) => void;
	/** The pointer was released; `cancelled` when the browser took the gesture instead. */
	end?: (at: Point | null, cancelled: boolean) => void;
}

/**
 * Drag inside an svg whose viewBox is `w` by `h`. The pointer is captured, so a drag that leaves
 * the drawing keeps going until it is released.
 */
export function pointerDrag(
	w: number,
	h: number,
	handlers: DragHandlers
): Attachment<SVGSVGElement> {
	return (svg) => {
		let dragging = false;
		const at = (event: PointerEvent) => toViewBox(event, svg.getBoundingClientRect(), w, h);
		function down(event: PointerEvent) {
			dragging = true;
			svg.setPointerCapture(event.pointerId);
			const point = at(event);
			handlers.start?.(point);
			handlers.move(point);
		}
		function move(event: PointerEvent) {
			if (dragging) handlers.move(at(event));
		}
		function up(event: PointerEvent) {
			if (!dragging) return;
			dragging = false;
			handlers.end?.(at(event), false);
		}
		function cancel() {
			if (!dragging) return;
			dragging = false;
			handlers.end?.(null, true);
		}
		svg.addEventListener('pointerdown', down);
		svg.addEventListener('pointermove', move);
		svg.addEventListener('pointerup', up);
		svg.addEventListener('pointercancel', cancel);
		return () => {
			svg.removeEventListener('pointerdown', down);
			svg.removeEventListener('pointermove', move);
			svg.removeEventListener('pointerup', up);
			svg.removeEventListener('pointercancel', cancel);
		};
	};
}
