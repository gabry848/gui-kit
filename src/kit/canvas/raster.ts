// An RGBA pixel buffer with the few drawing primitives the canvas needs.

export type RGB = readonly [number, number, number];

export class Raster {
	readonly data: Uint8ClampedArray;

	constructor(
		readonly width: number,
		readonly height: number,
		readonly background: RGB,
	) {
		this.data = new Uint8ClampedArray(width * height * 4);
		this.clear();
	}

	clear() {
		const [r, g, b] = this.background;
		for (let index = 0; index < this.data.length; index += 4) {
			this.data[index] = r;
			this.data[index + 1] = g;
			this.data[index + 2] = b;
			this.data[index + 3] = 255;
		}
	}

	get(x: number, y: number): RGB {
		const index = (y * this.width + x) * 4;
		return [this.data[index]!, this.data[index + 1]!, this.data[index + 2]!];
	}

	isBackground(x: number, y: number): boolean {
		const index = (y * this.width + x) * 4;
		const [r, g, b] = this.background;
		return this.data[index] === r && this.data[index + 1] === g && this.data[index + 2] === b;
	}

	plot(x: number, y: number, color: RGB) {
		x = Math.round(x);
		y = Math.round(y);
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return;
		}
		const index = (y * this.width + x) * 4;
		this.data[index] = color[0];
		this.data[index + 1] = color[1];
		this.data[index + 2] = color[2];
	}

	/** A filled disc, used as the brush of every stroke. */
	dot(cx: number, cy: number, radius: number, color: RGB) {
		if (radius < 0.75) {
			this.plot(cx, cy, color);
			return;
		}
		const r2 = radius * radius;
		for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
			for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
				if (dx * dx + dy * dy <= r2) {
					this.plot(cx + dx, cy + dy, color);
				}
			}
		}
	}

	line(x0: number, y0: number, x1: number, y1: number, radius: number, color: RGB) {
		const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
		for (let step = 0; step <= steps; step++) {
			const t = step / steps;
			this.dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
		}
	}

	rect(x0: number, y0: number, x1: number, y1: number, radius: number, color: RGB) {
		this.line(x0, y0, x1, y0, radius, color);
		this.line(x1, y0, x1, y1, radius, color);
		this.line(x1, y1, x0, y1, radius, color);
		this.line(x0, y1, x0, y0, radius, color);
	}

	ellipse(x0: number, y0: number, x1: number, y1: number, radius: number, color: RGB) {
		const cx = (x0 + x1) / 2;
		const cy = (y0 + y1) / 2;
		const rx = Math.abs(x1 - x0) / 2;
		const ry = Math.abs(y1 - y0) / 2;
		const steps = Math.max(16, Math.ceil(2 * Math.PI * Math.max(rx, ry)));
		let previous: [number, number] | undefined;
		for (let step = 0; step <= steps; step++) {
			const angle = (step / steps) * 2 * Math.PI;
			const point: [number, number] = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
			if (previous) {
				this.line(previous[0], previous[1], point[0], point[1], radius, color);
			}
			previous = point;
		}
	}
}
