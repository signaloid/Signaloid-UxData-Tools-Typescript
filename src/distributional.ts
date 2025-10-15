/*
 *   Copyright(c) 2025, Signaloid.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to
 *   deal in the Software without restriction, including without limitation the
 *   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 *   sell copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *   DEALINGS IN THE SOFTWARE.
 */


import * as struct from './struct';

import { DiracDelta } from './dirac_delta';


function bytes_tohex(arr: null | Array<number>): string {
	if (arr === null) {
		console.warn("Empty array.");
		return '';
	}

	let res = '';
	for (const num of arr) {
		res += num.toString(16).toUpperCase().padStart(2, '0');
	}

	return res;
}

function bytes_fromhex(str: string): Array<number> {
	if (str.length % 2 !== 0) {
		console.warn("Hex string length not multiple of 2, i.e. not byte addressable.");
		return [];
	}

	const arr: Array<number> = [];
	for (let i = 0; i < str.length; i += 2) {
		const hex = str.substring(i, i + 2);
		const byte = parseInt(hex, 16);
		arr.push(byte);
	}

	return arr;
}


/*
 * The format strings used with struct.pack & struct.unpack for parsing and
 * dumping `DistributionalValue` data.
 */
const STRUCT_FORMATS: { [id: string]: { [id: string]: string }; } = {
	"str": {
		"particle": "",
		"UR_type": ">B",
		"sample_count": ">Q",
		"mean": ">d",
		"UR_order": ">I",
		"position_single": ">f",
		"position_double": ">d",
		"mass": ">Q",
	},
	"bytes": {
		"particle": "<d",
		"UR_type": "<B",
		"sample_count": "<Q",
		"mean": "<d",
		"UR_order": "<I",
		"position_single": "<f",
		"position_double": "<d",
		"mass": "<Q",
	}
};


class DistributionalValue {
	particle_value: null | number = null;
	UR_type: null | number = null;
	private _dirac_deltas: Array<DiracDelta> = [];
	double_precision: boolean = true;
	/*
	 * properties
	 */
	private _mean: null | number = null;
	private _variance: null | number = null;

	nan_dirac_delta: DiracDelta = new DiracDelta({ position: Number.NaN, mass: Number.NaN })
	neg_inf_dirac_delta: DiracDelta = new DiracDelta({ position: Number.NEGATIVE_INFINITY, mass: Number.NaN })
	pos_inf_dirac_delta: DiracDelta = new DiracDelta({ position: Number.POSITIVE_INFINITY, mass: Number.NaN })

	private _has_no_zero_mass: null | boolean = null;
	private _is_finite: null | boolean = null;
	private _is_sorted: null | boolean = null;
	private _is_cured: null | boolean = null;
	private _is_full_valid_TTR: null | boolean = null;

	constructor(
		{
			particle_value = null,
			UR_type = null,
			dirac_deltas = [],
			double_precision = true
		}: {
			particle_value?: null | number,
			UR_type?: null | number,
			dirac_deltas?: Array<DiracDelta>,
			double_precision?: boolean
		}
	) {
		this.particle_value = particle_value;
		this.UR_type = UR_type;
		this._dirac_deltas = dirac_deltas;
		this.double_precision = double_precision;
	}

	/**
	 * The list of all the Dirac Deltas of the DistributionalValue.
	 *
	 * @returns The list of the Dirac Deltas.
	 */
	get dirac_deltas(): Array<DiracDelta> {
		return this._dirac_deltas;
	}

	/**
	 * The list of all the finite Dirac Deltas of the DistributionalValue.
	 *
	 * @returns The list of the finite Dirac Deltas.
	 */
	get finite_dirac_deltas(): Array<DiracDelta> {
		this.sort();
		if (this.has_special_values) {
			return this.dirac_deltas.slice(0, -3);
		}

		return this.dirac_deltas;
	}

	/**
	 * The list af all the Dirac Delta positions.
	 *
	 * @returns The list of all the Dirac Delta positions.
	 */
	get positions(): Array<number> {
		return Array.from(this.dirac_deltas, dd => dd.position);
	}

	/**
	 * The list af all the Dirac Delta floating-point masses.
	 *
	 * @returns The list of all the Dirac Delta floating-point masses.
	 */
	get masses(): Array<number> {
		return Array.from(this.dirac_deltas, dd => dd.mass);
	}

	/**
	 * The list af all the Dirac Delta fixed-point masses.
	 *
	 * @returns The list of all the Dirac Delta fixed-point masses.
	 */
	get raw_masses(): Array<number> {
		return Array.from(this.dirac_deltas, dd => dd.raw_mass);
	}

	/**
	 * The mean position of all the Dirac Deltas.
	 *
	 * @returns The mean position of all the Dirac Deltas.
	 */
	get mean(): null | number {
		if (this._mean === null) {
			this.calculate_mean();
		}

		return this._mean;
	}

	/**
	 * Sets the mean position of all the Dirac Deltas explicitly (it does
	 * not interfere with the Dirac Deltas list).
	 *
	 * @param mean The mean value to use.
	 */
	set mean(mean: null | number) {
		this._mean = mean;
	}

	/**
	 * Calculated the mean position of all the Dirac Deltas based on the
	 * Dirac Deltas list.
	 *
	 * @returns The calculated mean position of all the Dirac Deltas.
	 */
	public calculate_mean(): number {
		if (this.nan_dirac_delta.mass > 0) {
			this._mean = Number.NaN;
		} else if (this.neg_inf_dirac_delta.mass > 0 && this.pos_inf_dirac_delta.mass > 0) {
			this._mean = Number.NaN;
		} else if (this.neg_inf_dirac_delta.mass > 0) {
			this._mean = Number.NEGATIVE_INFINITY;
		} else if (this.pos_inf_dirac_delta.mass > 0) {
			this._mean = Number.POSITIVE_INFINITY;
		} else {
			let total_mass: number = 0;
			let total_weighted_position: number = 0;
			for (const dd of this.dirac_deltas) {
				total_weighted_position += dd.position * dd.mass;
				total_mass += dd.mass;
			}

			this._mean = total_weighted_position / total_mass;
		}

		return this._mean;
	}

	/**
	 * The number of non-zero mass Dirac Deltas.
	 *
	 * @returns The number of non-zero mass Dirac Deltas.
	 */
	get UR_order(): number {
		return this.dirac_deltas.length;
	}

	/**
	 * The positional variance of all the Dirac Deltas.
	 *
	 * @returns The positional variance of all the Dirac Deltas.
	 */
	get variance(): null | number {
		if (this._variance === null) {
			this.calculate_variance();
		}

		return this._variance;
	}

	/**
	 * Calculates the positional variance of all the Dirac Deltas.
	 *
	 * @returns The calculated positional variance of all the Dirac Deltas.
	 */
	public calculate_variance(): null | number {
		/*
		 * Calculate weighted sample variance
		 */
		if (this.mean === null || this.UR_order == 0 || !Number.isFinite(this.mean)) {
			this._variance = null;
		} else {
			let total_mass: number = 0;
			let total_weighted_squared_diffs: number = 0;
			for (const dd of this.dirac_deltas) {
				total_weighted_squared_diffs += (
					((dd.position - this.mean) ** 2)
					* dd.mass
				);
				total_mass += dd.mass;
			}

			this._variance = total_weighted_squared_diffs / total_mass;
		}

		return this._variance;
	}

	/**
	 * Property that identifies if there are non-zero mass Dirac Deltas,
	 * with non-finite position, i.e. `NaN`, `-Inf`, `Inf`.
	 *
	 * @returns `True` if there are non-zero mass, non-finite position Dirac Deltas,
	 * `False` otherwise.
	 */
	get has_special_values(): boolean {
		return Boolean(
			this.nan_dirac_delta.mass > 0
			|| this.neg_inf_dirac_delta.mass > 0
			|| this.pos_inf_dirac_delta.mass > 0
		);
	}

	/**
	 * Constructs the representation type for the`DistributionalValue`.
	 *
	 * @returns The representation type for the`DistributionalValue`.
	 */
	public __repr__ = (): string => {
		return `${this.UR_type}-${this.UR_order}`;
	}

	/**
	 * Constructs the Ux string with particle value for the`DistributionalValue`.
	 *
	 * @returns: UxString: The Ux string with particle value for the`DistributionalValue`.
	 */
	public toString = (): string => {
		const result = this.export(true);
		return typeof (result) === 'string' ? result : "";
	}

	/**
	 * Constructs the byte array for the `DistributionalValue`.
	 * Uses either single or double precision for support positions based on this.double_precision.
	 *
	 * @returns: The byte array for the `DistributionalValue`.
	 */
	public toBytes = (): Array<number> => {
		const result = this.export(false);
		return result instanceof Array ? result : [];
	}

	/**
	 * Constructs the Ux string/Ux bytes with particle value for the `DistributionalValue`.
	 *
	 * @param: to_str: Weather to export a Ux string or a Ux bytes
	 * 		- True: Export a Ux string
	 * 		- False: Export a Ux bytes
	 *
	 * @returns: The Ux string or the Ux bytes with particle value for the `DistributionalValue`.
	 *
	 * Ux-string format specification:
	 * 	- Particle value (double in string format)
	 * 	- "Ux"							(   2 chars)
	 * 	- Representation type (uint8_t)				(   2 chars)
	 * 	- Number of samples (uint64_t)				(  16 chars) (unused)
	 * 	- Mean value of distribution (double)			(  16 chars)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)	(   8 chars)
	 * 	- Pairs of:
	 * 		- Support position (float/double)		(8/16 chars)
	 * 		- Probability mass (uint64_t)			(  16 chars)
	 *
	 * Ux-bytes specification:
	 * 	- Particle value (double)				(  8 bytes)
	 * 	- Representation type (uint8_t)				(  1 byte )
	 * 	- Number of samples (uint64_t)				(  8 bytes) (unused)
	 * 	- Mean value of distribution (double)			(  8 bytes)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)	(  4 bytes)
	 * 	- Pairs of:
	 * 		- Support position (float/double)		(4/8 bytes)
	 * 		- Probability mass (uint64_t)			(  8 bytes)
	 */
	public export = (to_str: boolean = true): string | Array<number> => {
		/*
		 * Create byte representation
		 */
		let buffer: Array<number> = [];
		let UxString: string = "";

		const fmt = STRUCT_FORMATS[to_str ? "str" : "bytes"];

		if (to_str) {
			/*
			 * Particle value(double in string format)
			 */
			UxString += this.particle_value !== null ? this.particle_value.toString().toLowerCase() : "";
			UxString += "Ux";
		} else {
			/*
			 * Particle value (double)                           (8 bytes)
			 */
			const particle_value = this.particle_value !== null ? this.particle_value : 0;
			buffer = buffer.concat(struct.pack(fmt["particle"], [particle_value]) || []);
		}

		/*
		 * Representation type (uint8_t)                     (1 byte)
		 */
		//@ts-ignore
		buffer = buffer.concat(struct.pack(fmt["UR_type"], [this.UR_type]) || []);

		/*
		 * Number of samples (uint64_t)                      (8 bytes)
		 */
		buffer = buffer.concat(struct.pack(fmt["sample_count"], [this.positions.length]) || []);

		/*
		 * Mean value of distribution (double)               (8 bytes)
		 * Mean is always double precision regardless of this.double_precision
		 */
		buffer = buffer.concat(struct.pack(fmt["mean"], [this.mean]) || []);

		/*
		 * Number of non-zero mass Dirac deltas (uint32_t)   (4 bytes)
		 */
		buffer = buffer.concat(struct.pack(fmt["UR_order"], [this.UR_order]) || []);

		/*
		 * Choose the format based on double_precision flag
		 */
		const position_format = fmt[this.double_precision ? "position_double" : "position_single"];

		/*
		 * Pairs of:
		 * - Support position (double or float)              (8 or 4 bytes)
		 * - Probability mass (uint64_t)                     (8 bytes)
		 */
		for (const i in this.positions) {
			/*
			 * Pack the position using either double or float precision
			 */
			buffer = buffer.concat(struct.pack(position_format, [this.positions[i]]) || []);

			/*
			 * Probability mass is always uint64_t
			 */
			buffer = buffer.concat(struct.pack(fmt["mass"], [this.raw_masses[i]]) || []);
		}

		if (to_str) {
			return UxString + bytes_tohex(buffer);
		}

		return buffer;
	}

	/**
	 * Constructs a `DistributionalValue` after parsing an input that can be
	 * a UxString or a byte array.
	 *
	 * @param dist The input UxString or byte array.
	 * @param double_precision The floating point representation precision.
	 * 				- true: double precision
	 * 				- false: single precision
	 *
	 * @returns The constructed `DistributionalValue` or null if parsing fails.
	 *
	 * Ux-string format specification:
	 * 	- Particle value (double in string format)
	 * 	- "Ux"							(   2 chars)
	 * 	- Representation type (uint8_t)				(   2 chars)
	 * 	- Number of samples (uint64_t)				(  16 chars) (unused)
	 * 	- Mean value of distribution (double)			(  16 chars)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)	(   8 chars)
	 * 	- Pairs of:
	 * 		- Support position (float/double)		(8/16 chars)
	 * 		- Probability mass (uint64_t)			(  16 chars)
	 *
	 * Ux-bytes specification:
	 * 	- Particle value (double)				(  8 bytes)
	 * 	- Representation type (uint8_t)				(  1 byte )
	 * 	- Number of samples (uint64_t)				(  8 bytes) (unused)
	 * 	- Mean value of distribution (double)			(  8 bytes)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)	(  4 bytes)
	 * 	- Pairs of:
	 * 		- Support position (float/double)		(4/8 bytes)
	 * 		- Probability mass (uint64_t)			(  8 bytes)
	 */
	static parse = (
		dist: string | Array<number>,
		double_precision: boolean = true
	): null | DistributionalValue => {
		let buffer: Array<number>;
		let offset: number = 0;
		const dist_value: DistributionalValue = new DistributionalValue({ double_precision });

		let fmt: { [id: string]: string };
		if (typeof (dist) === 'string') {
			/*
			 * Parse Hex string
			 */
			fmt = STRUCT_FORMATS["str"];

			/*
			 * Define the regex pattern to match an optional floating-point or integer number,
			 * followed by 'Ux', and then hexadecimal characters
			 */
			const pattern = new RegExp(/^([-+]?\d*\.?\d+|nan|[-+]?inf)?Ux([0-9A-Fa-f]+)$/);

			/*
			* Match the pattern
			*/
			const match = dist.match(pattern);

			if (match === null) {
				console.warn("Faulty Ux-string format.");
				return null;
			}

			dist_value.particle_value = match[1] !== null ? parseFloat(match[1]) : null;

			buffer = bytes_fromhex(match[2]);
		} else if (dist instanceof Array) {
			/*
			 * Parse byte array
			 */
			fmt = STRUCT_FORMATS["bytes"];

			buffer = dist;
			dist_value.particle_value = (struct.unpack(fmt["particle"], buffer.slice(offset, offset + 8)) || [null])[0];
			offset += 8;
		} else {
			console.error("Unsupported input.", typeof (dist));
			return null;
		}

		/*
		 * Check if the buffer has the minimum required length (in bytes)
		 * Minimum length = 1 (repr) + 8 (samples) + 8 (mean) + 4 (count) = 21
		 */
		const min_length: number = offset + 21;
		if (buffer.length < min_length) {
			console.warn("Input data do not include the mandatory fields.");
			return null;
		}

		dist_value.UR_type = (struct.unpack(fmt["UR_type"], buffer.slice(offset, offset + 1)) || [0])[0];
		offset += 1;

		/*
		 * Not used, uncomment if needed
		 * number_of_samples = (struct.unpack(fmt["sample_count"], buffer.slice(offset, offset + 8)) || [0])[0];
		 */
		offset += 8;

		dist_value.mean = (struct.unpack(fmt["mean"], buffer.slice(offset, offset + 8)) || [0])[0];
		offset += 8;

		const UR_order = (struct.unpack(fmt["UR_order"], buffer.slice(offset, offset + 4)) || [0])[0];
		offset += 4;

		/*
		 * Validate UR_order - reasonable upper limit to prevent processing
		 * extremely large inputs that might be malicious
		 */
		if (
			UR_order === null
			|| UR_order < 0
			|| UR_order > 10000
		) {
			console.warn("UR order out of normal bounds:", UR_order);
			return null;
		}

		/*
		 * Calculate expected length based on UR_order
		 * 4 or 8 for position + 8 for mass
		 */
		const bytes_per_position: number = double_precision ? 8 : 4;
		const bytes_per_dirac_delta: number = bytes_per_position + 8;
		const expected_length: number = min_length + (UR_order * bytes_per_dirac_delta);
		if (buffer.length < expected_length) {
			console.warn("Not enough data to read for UR order of:", UR_order);
			return null;
		}

		const position_format: string = fmt[double_precision ? "position_double" : "position_single"];

		for (let i = 0; i < UR_order; i++) {
			const support_position_bytes: Array<number> = buffer.slice(offset, offset + bytes_per_position);
			offset += bytes_per_position;
			const position: number = (struct.unpack(position_format, support_position_bytes) || [0])[0];

			const mass_bytes: Array<number> = buffer.slice(offset, offset + 8);
			offset += 8;
			const raw_mass: number = (struct.unpack(fmt["mass"], mass_bytes) || [0])[0];

			dist_value.dirac_deltas.push(new DiracDelta({ position, raw_mass }));
		}

		return dist_value;
	}

	/**
	 * Calculates the distance between the mean values of this `DistributionalValue`
	 * and another `DistributionalValue`.
	 *
	 * @param other The other `DistributionalValue`.
	 *
	 * @returns The distance between the mean values.
	 */
	public mean_distance = (other: DistributionalValue): number => {
		if (this.mean === null || other.mean === null) {
			console.warn(`No valid mean values. this.mean=${this.mean}, other.mean=${other.mean}`);
			return Number.NaN;
		}

		return Math.abs(this.mean - other.mean);
	}

	/**
	 * Calculates the relative difference between the mean values of
	 * this `DistributionalValue` and another `DistributionalValue`.
	 *
	 * @param other The other `DistributionalValue`.
	 *
	 * @returns The relative difference between the mean values (normalized
	 * by the mean value of the other `DistributionalValue`).
	 */
	public mean_relative_diff = (other: DistributionalValue): number => {
		if (this.mean === null || other.mean === null) {
			console.warn(`No valid mean values. this.mean=${this.mean}, other.mean=${other.mean}`);
			return Number.NaN;
		}

		return Math.abs((this.mean - other.mean) / other.mean);
	}

	/**
	 * The property that no Dirac delta of the `DistributionalValue` has a
	 * zero mass.
	 *
	 * @returns `true` if `DistributionalValue` has a zero mass Dirac delta, `false` else.
	 */
	get has_no_zero_mass(): null | boolean {
		if (this._has_no_zero_mass === null) {
			this._has_no_zero_mass = this.check_has_no_zero_mass();
		}

		return this._has_no_zero_mass;
	}

	/**
	 * Checks the property that no Dirac delta of the `DistributionalValue`
	 * has a zero mass.
	 *
	 * @returns `true` if `DistributionalValue` has a zero mass Dirac delta, `false` else.
	 */
	public check_has_no_zero_mass = (): null | boolean => {
		if (this.UR_order === 0) {
			console.warn("No Dirac Deltas found.");
			return null;
		}

		for (const dd of this.dirac_deltas) {
			if (dd.mass === 0) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Drops (removes) the Dirac deltas of the `DistributionalValue` that
	 * has a zero mass.
	 */
	public drop_zero_mass_positions = (): void => {
		if (this._has_no_zero_mass) {
			return;
		}

		if (this.UR_order === 0) {
			console.warn("No Dirac Deltas found.");
			return;
		}

		this._dirac_deltas = this._dirac_deltas.filter(dd => dd.mass > 0);
		this._has_no_zero_mass = true;
	}

	/**
	 * The property that all Dirac deltas of the `DistributionalValue` have
	 * finite positions, i.e., no NaN, -Inf, or Inf values.
	 *
	 * @returns `true` if `DistributionalValue` has a Dirac delta with
	 * non-finite position, `false` else.
	 */
	get is_finite(): null | boolean {
		if (this._is_finite === null) {
			this._is_finite = this.check_is_finite();
		}

		return this._is_finite;
	}

	/**
	 * Checks the property that all Dirac deltas of the `DistributionalValue`
	 * have finite positions, i.e., no NaN, -Inf, or Inf values.
	 *
	 * @returns `null` if `DistributionalValue` has no Dirac deltas. Else,
	 * `true` if `DistributionalValue` has a Dirac delta with non-finite
	 * position, `false` else.
	 */
	public check_is_finite = (): null | boolean => {
		if (this.UR_order === 0) {
			console.warn("No Dirac Deltas found.");
			return null;
		}

		for (const dd of this.dirac_deltas) {
			if (!dd.isFinite) {
				return false;
			}
		}

		return true;
	}

	/**
	 * The property that the Dirac deltas of the `DistributionalValue` are sorted
	 * according to their positions. The NaN, -Inf, and Inf positional values
	 * are cured and sorted to the end in the order [NaN, -Inf, Inf].
	 *
	 * @returns `true` if the Dirac deltas of the `DistributionalValue` are
	 * sorted according to their positions, `false` else.
	 */
	get is_sorted(): null | boolean {
		if (this._is_sorted === null) {
			this._is_sorted = this.check_is_sorted();
		}

		return this._is_sorted;
	}

	/**
	 * Checks The property that the Dirac deltas of the `DistributionalValue` are
	 * sorted according to their positions. The NaN, -Inf, and Inf positional values
	 * are cured and sorted to the end in the order [NaN, -Inf, Inf].
	 *
	 * @returns `null` if the `DistributionalValue` has no Dirac deltas. Else, `true` if
	 * the Dirac deltas of the `DistributionalValue` are sorted according to
	 * their positions, `false` else.
	 */
	public check_is_sorted = (): null | boolean => {
		if (this.UR_order === 0) {
			console.warn("No Dirac Deltas found.");
			return null;
		}

		if (this.UR_order === 1) {
			return true;
		}

		for (let i = 0; i < this.UR_order - 1; i++) {
			if (!Number.isFinite(this.dirac_deltas[i])) {
				return false;
			}

			if (this.dirac_deltas[i].gt(this.dirac_deltas[i + 1])) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Sorts the positions and the masses of a `DistributionalValue` according to
	 * the positions. Also, cures multiple entries for NaN, -Inf, and Inf and
	 * places them at the end of positions and masses with the order [NaN, -Inf, Inf].
	 */
	public sort = (): void => {
		if (this.is_sorted) {
			return;
		}

		this.nan_dirac_delta.mass = 0;
		this.neg_inf_dirac_delta.mass = 0;
		this.pos_inf_dirac_delta.mass = 0;
		const finite_dirac_deltas: Array<DiracDelta> = [];
		for (const dd of this.dirac_deltas) {
			if (Number.isFinite(dd.position)) {
				finite_dirac_deltas.push(dd);
			} else if (isNaN(dd.position)) {
				this.nan_dirac_delta.mass += dd.mass;
			} else if (dd.position === Number.NEGATIVE_INFINITY) {
				this.neg_inf_dirac_delta.mass += dd.mass;
			} else if (dd.position === Number.POSITIVE_INFINITY) {
				this.pos_inf_dirac_delta.mass += dd.mass;
			}
		}

		this._dirac_deltas = finite_dirac_deltas;
		this._dirac_deltas.sort(DiracDelta.comparator);

		if (this.has_special_values) {
			this.dirac_deltas.push(this.nan_dirac_delta);
			this.dirac_deltas.push(this.neg_inf_dirac_delta);
			this.dirac_deltas.push(this.pos_inf_dirac_delta);
		}

		this._is_sorted = true;
	}

	/**
	 * The property that no two Dirac deltas of the `DistributionalValue` have
	 * the same positional value, including NaN, -Inf, and Inf.
	 *
	 * @returns `true` if no two Dirac deltas of the `DistributionalValue`
	 * have the same positional value, including NaN, -Inf, and Inf, `false` else.
	 */
	get is_cured(): null | boolean {
		if (this._is_cured === null) {
			this._is_cured = this.check_is_cured();
		}

		return this._is_cured;
	}

	/**
	 * Checks the property that no two Dirac deltas of the `DistributionalValue` have
	 * the same positional value, including NaN, -Inf, and Inf.
	 *
	 * @returns `null` if the `DistributionalValue` has no Dirac deltas.
	 * Else, `true` if no two Dirac deltas of the `DistributionalValue`
	 * have the same positional value, including NaN, -Inf, and Inf, `false` else.
	 */
	public check_is_cured = (): null | boolean => {
		if (this.UR_order === 0) {
			return null;
		}

		return this.UR_order == new Set(this.positions).size;
	}

	/**
	 * Cures the positions and masses of the `DistributionalVariable` from
	 * multiple entries of the same positional value, including NaN, -Inf,
	 * and Inf.
	 */
	public cure = (): void => {
		if (this._is_cured) {
			return;
		}

		this.combine_dirac_deltas(0, 0);
	}

	/**
	 * Combine Dirac deltas with same, very-close-relative-to-range
	 * very-close-relative-to-mean-value positions.
	 *
	 * @param relative_mean_threshold The threshold multiplier for the relative
	 * mean.
	 * @param relative_range_threshold The threshold multiplier for the relative
	 * range.
	 */
	public combine_dirac_deltas(
		relative_mean_threshold: number = 1e-14,
		relative_range_threshold: number = 1e-12,
	): void {
		this.sort();

		let threshold: number = 0.0;
		if (relative_mean_threshold > 0 && relative_range_threshold > 0) {
			/*
			 * Calculate the mean value of finite part
			 */
			let finite_mass: number = 0.0;
			let finite_mean: number = 0.0;

			/*
			 * Last three positions are for non-finite values
			 */
			for (const dd of this.finite_dirac_deltas) {
				finite_mass += dd.mass;
				finite_mean += dd.position * dd.mass;
			}
			finite_mean /= finite_mass;
			const mean_threshold: number = finite_mean * relative_mean_threshold;

			const range_threshold: number = (
				(this.finite_dirac_deltas[this.finite_dirac_deltas.length - 1].position - this.dirac_deltas[0].position)
				* relative_range_threshold
			);

			threshold = Math.max(mean_threshold, range_threshold);
		}

		const dirac_deltas = [this.dirac_deltas[0]];
		let index = 0;
		for (const dd of this.finite_dirac_deltas.slice(1)) {
			if (dirac_deltas[index].similar(dd, threshold)) {
				dirac_deltas[index] = dirac_deltas[index].add(dd);
				continue;
			}

			dirac_deltas.push(new DiracDelta({
				position: dd.position,
				raw_mass: dd.raw_mass
			}));

			index++;
		}

		this._dirac_deltas = dirac_deltas;

		if (this.has_special_values) {
			this.dirac_deltas.push(this.nan_dirac_delta);
			this.dirac_deltas.push(this.neg_inf_dirac_delta);
			this.dirac_deltas.push(this.pos_inf_dirac_delta);
		}

		this._is_cured = true;
	}

	/**
	 * The property that the Dirac deltas of the `DistributionalValue` form
	 * a full valid TTR. "Full" means that there are 2^n Dirac deltas (after
	 * dropping zero mass Dirac deltas and curing to combine same position
	 * Dirac deltas). "Valid" means that there is a distribution whose TTR
	 * exactly contains the Dirac deltas of the `DistributionalValue`.
	 *
	 * @returns `true` if the Dirac deltas of the `DistributionalValue`
	 * form a full and valid TTR, `false` else.
	 */
	get is_full_valid_TTR(): null | boolean {
		if (this._is_full_valid_TTR === null) {
			this._is_full_valid_TTR = this.check_is_full_valid_TTR();
		}

		return this._is_full_valid_TTR;
	}

	/**
	 * Checks the property that the Dirac deltas of the `DistributionalValue`
	 * form a full and valid TTR. "Full" means that there are 2^n Dirac deltas
	 * (after dropping zero mass Dirac deltas and curing to combine same position
	 * Dirac deltas). "Valid" means that there is a distribution whose TTR
	 * exactly contains the Dirac deltas of the `DistributionalValue`.
	 *
	 * @returns `null` if the `DistributionalValue` has no Dirac deltas.
	 * Else, `true` if the Dirac deltas of the `DistributionalValue` form a
	 * full and valid TTR, `false` else.
	 */
	public check_is_full_valid_TTR = (): null | boolean => {
		this.drop_zero_mass_positions();
		this.cure();

		if (!this.is_finite) {
			return false;
		}

		if (this.UR_order === 0) {
			console.warn("No Dirac Deltas found.");
			return null;
		}

		if (this.UR_order === 1) {
			return true;
		}

		/*
		 * Check UR_order is power of 2
		 */
		//@ts-ignore
		if (this.UR_order & (this.UR_order - 1) !== 0) {
			return false;
		}

		const ttr_order: number = Math.log2(this.UR_order)
		if (ttr_order % 1 !== 0) {
			return false;
		}

		const number_of_boundaries: number = 2 * this.UR_order - 1
		const boundary_positions = Array(number_of_boundaries).fill(NaN);
		const boundary_probabilities = Array(number_of_boundaries).fill(NaN);

		for (let i = 0, j = 0; i < number_of_boundaries; i += 2, j++) {
			boundary_positions[i] = this.positions[j];
			boundary_probabilities[i] = this.masses[j];
		}

		for (let n = 0; n < ttr_order; n++) {
			const step: number = 2 ** n;
			for (let i = 2 ** (n + 1) - 1; i < number_of_boundaries; i += 2 ** (n + 2)) {
				boundary_probabilities[i] = (
					boundary_probabilities[i - step] + boundary_probabilities[i + step]
				);
				boundary_positions[i] = (
					boundary_probabilities[i - step] * boundary_positions[i - step]
					+ boundary_probabilities[i + step] * boundary_positions[i + step]
				) / boundary_probabilities[i];
			}
		}

		return boundary_positions
			.every((val, i, arr) => i === 0 || arr[i - 1] < val);
	}
}

export {
	bytes_tohex,
	bytes_fromhex,
	DistributionalValue,
};
