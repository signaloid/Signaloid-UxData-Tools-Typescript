/*
 *	Copyright (c) 2025, Signaloid.
 *
 *	Permission is hereby granted, free of charge, to any person obtaining a copy
 *	of this software and associated documentation files (the "Software"), to deal
 *	in the Software without restriction, including without limitation the rights
 *	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *	copies of the Software, and to permit persons to whom the Software is
 *	furnished to do so, subject to the following conditions:
 *
 *	The above copyright notice and this permission notice shall be included in all
 *	copies or substantial portions of the Software.
 *
 *	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *	SOFTWARE.
 */


import * as struct from './struct';

import { DiracDelta } from './dirac_delta';
import { pairwise_sum } from './summation';


function bytes_tohex(arr: null | Array<number>): string {
	if (arr === null) {
		return '';
	}

	let res = '';
	for (const num of arr) {
		res += num.toString(16).toUpperCase().padStart(2, '0');
	}

	return res;
}

const ASCII_WHITESPACE: string = " \t\n\r\v\f";
const HEX_DIGITS: string = "0123456789ABCDEFabcdef";

function bytes_fromhex(str: string): Array<number> {
	const arr: Array<number> = [];
	let i: number = 0;

	while (i < str.length) {
		if (ASCII_WHITESPACE.includes(str[i])) {
			i += 1;
			continue;
		}

		const pair: string = str.substring(i, i + 2);

		if (
			pair.length !== 2 ||
			!HEX_DIGITS.includes(pair[0]) ||
			!HEX_DIGITS.includes(pair[1])
		) {
			return [];
		}

		const byte: number = Number(`0x${pair}`);

		arr.push(byte);
		i += 2;
	}

	return arr;
}



function float_tostring(value: number): string {
	if (Number.isNaN(value)) {
		return "nan";
	}

	if (!Number.isFinite(value)) {
		return value > 0 ? "inf" : "-inf";
	}

	if (Object.is(value, -0)) {
		return "-0.0";
	}

	const [mantissa, exponent_text]: Array<string> = value.toExponential().split("e");
	const exponent: number = Number(exponent_text);

	/* A Ux string takes the exponent form outside `[1e-4, 1e16)`, JavaScript outside `[1e-7, 1e21)`. */
	if (exponent < -4 || exponent >= 16) {
		const sign: string = exponent < 0 ? "-" : "+";

		return `${mantissa}e${sign}${Math.abs(exponent).toString().padStart(2, "0")}`;
	}

	const fixed: string = String(value);

	return fixed.includes(".") ? fixed : `${fixed}.0`;
}


function float_fromstring(text: string): null | number {
	const trimmed: string = text.trim();
	const lowercase: string = trimmed.toLowerCase();
	const signed: boolean = lowercase.startsWith("-") || lowercase.startsWith("+");
	const magnitude: string = signed ? lowercase.slice(1) : lowercase;

	if (magnitude === "inf" || magnitude === "infinity") {
		return lowercase.startsWith("-")
			? Number.NEGATIVE_INFINITY
			: Number.POSITIVE_INFINITY;
	}

	if (magnitude === "nan") {
		return Number.NaN;
	}

	if (
		magnitude === ""
		|| magnitude.startsWith("0x")
		|| magnitude.startsWith("0b")
		|| magnitude.startsWith("0o")
	) {
		return null;
	}

	const value: number = Number(trimmed);

	return Number.isNaN(value) ? null : value;
}


/*
 * Representation type byte, as carried at offset 11 of the Ux Binary layout.
 * 0x00 is not a core: it is the "not stated" value, for a value assembled in
 * TypeScript rather than read off a core (raw samples, for one). Keeping it as
 * the constructor default matters because `TTR_NATIVE_UR_TYPES` below makes
 * the byte decide how a value is binned, and defaulting to a real core would
 * silently claim a provenance the value does not have.
 */
const UR_TYPE_UNSPECIFIED: number = 0x00;
const UR_TYPE_ATHENS: number = 0x04;
const UR_TYPE_JUPITER: number = 0x06;
const UR_TYPE_ROME: number = 0x07;

/*
 * Cores whose Dirac deltas are a TTR by construction. Their values are binned
 * by the TTR route even when `check_is_full_valid_TTR` says otherwise: curing
 * and zero-mass dropping routinely leave such a value with a non-power-of-2
 * Dirac count, which fails the check without making the value any less
 * TTR-shaped.
 *
 * Every other type is left to `check_is_full_valid_TTR` to route: the TTR
 * binning when the value does happen to be a valid TTR, the non-uniform
 * binning when it does not. That covers `UR_TYPE_UNSPECIFIED` and Jupiter,
 * whose Dirac deltas are particles rather than a TTR.
 */
const TTR_NATIVE_UR_TYPES: ReadonlySet<number> = new Set([UR_TYPE_ATHENS, UR_TYPE_ROME]);


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

/*
 * First byte of the Ux Binary Data format, used to distinguish it from the legacy format
 */
const UX_BINARY_FORMAT_MARKER = 0xF0;

/*
 * The largest values of the unsigned integer fields `export` packs, which
 * `struct.pack` range-checks.
 */
const UINT8_MAX: bigint = 0xFFn;
const UINT64_MAX: bigint = 0xFFFFFFFFFFFFFFFFn;


/* `a - b` is inconsistent on NaN and leaves the array unsorted; `np.sort` puts NaN last. */
function ascending_nan_last(a: number, b: number): number {
	if (Number.isNaN(a)) {
		return Number.isNaN(b) ? 0 : 1;
	}

	if (Number.isNaN(b)) {
		return -1;
	}

	return a < b ? -1 : a > b ? 1 : 0;
}


/**
 * Checks that `value` fits an unsigned integer field of `struct.pack`, which
 * raises where a `DataView` setter would wrap the value silently.
 *
 * @param value The value to pack.
 * @param format The `struct` format string of the field.
 * @param maximum The largest value the field holds.
 *
 * @throws RangeError: When `value` is not an integer in [0, `maximum`], as
 * `struct.pack` raises `struct.error`.
 */
function check_unsigned_field(value: number | bigint, format: string, maximum: bigint): void {
	/* `BigInt` throws a RangeError of its own for a number that is not an integer. */
	const integer: bigint = BigInt(value);
	if (integer < 0n || integer > maximum) {
		throw RangeError(`'${format.slice(-1)}' format requires 0 <= number <= ${maximum}`);
	}
}


class DistributionalValue {
	particle_value: null | number = null;
	UR_type: number = UR_TYPE_UNSPECIFIED;
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

	/**
	 * @param particle_value The particle value. Absent when not given or `null`.
	 * @param UR_type The representation type byte. `UR_TYPE_UNSPECIFIED` when
	 * not given.
	 * @param dirac_deltas The Dirac deltas. Empty when not given or `null`.
	 * @param double_precision Whether the support positions export as doubles,
	 * rather than as single-precision floats.
	 */
	constructor(
		{
			particle_value = null,
			UR_type = UR_TYPE_UNSPECIFIED,
			dirac_deltas = null,
			double_precision = true
		}: {
			particle_value?: null | number,
			UR_type?: number,
			dirac_deltas?: null | Array<DiracDelta>,
			double_precision?: boolean
		} = {}
	) {
		this.particle_value = particle_value;
		this.UR_type = UR_type;
		/* `??` treats `null` as absent, as Python's `is not None` does. */
		this._dirac_deltas = dirac_deltas ?? [];
		this.double_precision = double_precision;
	}

	/**
	 * Constructs a `DistributionalValue` from an array of float samples, each
	 * becoming a Dirac delta of equal mass. Non-finite samples are kept, for
	 * `sort()` to separate into the special-value slots.
	 *
	 * @param samples The float samples, which may contain NaN and +/-Inf.
	 *
	 * @returns The constructed `DistributionalValue`.
	 *
	 * @throws EvalError: When the samples array is empty, or holds a value that
	 * is not a number.
	 */
	static from_samples(samples: ArrayLike<number>): DistributionalValue {
		if (samples.length === 0) {
			throw EvalError("samples array must not be empty.");
		}

		if (!Array.from(samples).every(sample => typeof sample === "number")) {
			throw EvalError("samples contain non numerical values");
		}

		const mass_per_sample: number = 1 / samples.length;
		const dirac_deltas: Array<DiracDelta> = Array.from(
			{ length: samples.length },
			(_, i) => new DiracDelta({ position: samples[i], mass: mass_per_sample })
		);

		return new DistributionalValue({ dirac_deltas });
	}

	/**
	 * Constructs a `DistributionalValue` from weighted samples, normalizing
	 * the masses to sum to 1.
	 *
	 * @param positions The sample positions.
	 * @param masses The unnormalized mass of each position.
	 *
	 * @returns The constructed `DistributionalValue`.
	 *
	 * @throws EvalError: When the inputs are empty, of differing lengths, hold
	 * an entry that is not a number, carry a negative mass, or do not have a
	 * finite and non-zero total mass.
	 */
	static from_weighted_samples(
		positions: ArrayLike<number>,
		masses: ArrayLike<number>
	): DistributionalValue {
		if (positions.length === 0) {
			throw EvalError("positions is empty");
		}

		if (masses.length === 0) {
			throw EvalError("masses is empty");
		}

		if (positions.length !== masses.length) {
			throw EvalError("positions and masses have differing lengths");
		}

		if (!Array.from(positions).every(position => typeof position === "number")) {
			throw EvalError("positions contain non numerical values");
		}

		/* An array, so that input without a length sums to 0 and is rejected, as on main. */
		const mass_values: Array<number> = Array.from(masses);
		if (!mass_values.every(mass => typeof mass === "number")) {
			throw EvalError("masses contain non numerical values");
		}

		for (let i = 0; i < masses.length; i++) {
			if (masses[i] < 0) {
				throw EvalError(`masses must be non-negative (got ${masses[i]})`);
			}
		}

		/* `np.sum` sums pairwise, which rounds differently from a running sum. */
		const total_mass: number = pairwise_sum(mass_values);
		if (!Number.isFinite(total_mass) || total_mass === 0) {
			throw EvalError(
				`sum of masses must be finite and non-zero (got ${total_mass})`
			);
		}

		const dirac_deltas: Array<DiracDelta> = Array.from(
			{ length: positions.length },
			(_, i) => new DiracDelta({
				position: positions[i],
				mass: masses[i] / total_mass
			})
		);

		return new DistributionalValue({ dirac_deltas });
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

		/* Not `slice(0, -3)`: a dropped zero-mass slot would shorten the tail. */
		return this.dirac_deltas.filter(dd => dd.isFinite);
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
	get raw_masses(): Array<bigint> {
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
	 * Zero-mass Dirac deltas carry no probability, so a zero-mass outlier must
	 * not widen the support a quantile is read off.
	 *
	 * @returns The positive-mass positions and masses, sorted by position with
	 * a NaN position last, as `np.argsort` orders them.
	 */
	private _positive_mass_support(): [Array<number>, Array<number>] {
		const support: Array<DiracDelta> = this.dirac_deltas.filter(dd => dd.mass > 0);
		support.sort((a, b) => {
			if (Number.isNaN(a.position)) {
				return Number.isNaN(b.position) ? 0 : 1;
			}

			if (Number.isNaN(b.position)) {
				return -1;
			}

			return DiracDelta.comparator(a, b);
		});

		return [
			Array.from(support, dd => dd.position),
			Array.from(support, dd => dd.mass)
		];
	}

	/* `masses.sum()`: numpy sums pairwise, which rounds differently from a running sum. */
	private _total_mass(): number {
		return pairwise_sum(this.masses);
	}

	/**
	 * The range of the support: the largest positive-mass position minus the
	 * smallest. Like Python's, it calls `sort()` first, which moves any
	 * non-finite Dirac delta into the special-value slots.
	 *
	 * @returns 0.0 for a single Dirac delta. NaN when a NaN-position Dirac
	 * delta has positive mass, +Inf when a +/-Inf-position one does, and NaN
	 * for an empty or all-zero-mass value.
	 */
	get range(): number {
		this.sort();

		if (this.nan_dirac_delta.mass > 0) {
			return Number.NaN;
		}

		if (this.neg_inf_dirac_delta.mass > 0 || this.pos_inf_dirac_delta.mass > 0) {
			return Number.POSITIVE_INFINITY;
		}

		/*
		 * After the special-value returns, only finite Dirac deltas remain. Drop
		 * the zero-mass ones so that they cannot widen the support.
		 */
		const [positions] = this._positive_mass_support();
		if (positions.length === 0) {
			return Number.NaN;
		}

		/* A loop, not `Math.max(...positions)`, which overflows the stack on a long support. */
		let minimum: number = positions[0];
		let maximum: number = positions[0];
		for (const position of positions) {
			minimum = Math.min(minimum, position);
			maximum = Math.max(maximum, position);
		}

		return maximum - minimum;
	}

	/**
	 * The empirical inverse CDF at `t`, as a non-interpolating step lookup.
	 * Returns an actual support position, unlike `inverse_cdf`.
	 *
	 * @param t The quantile parameter, in [0, 1].
	 *
	 * @returns The smallest position whose cumulative normalized mass reaches
	 * `t`. NaN if `t` is NaN or the value has zero total mass.
	 *
	 * @throws EvalError: When `t` is outside [0, 1].
	 */
	public quantile(t: number): number {
		if (Number.isNaN(t)) {
			return Number.NaN;
		}

		if (t < 0.0 || t > 1.0) {
			throw EvalError(`quantile parameter t must be in [0, 1]; got ${t}.`);
		}

		const total_mass: number = this._total_mass();
		if (total_mass === 0.0) {
			return Number.NaN;
		}

		const [positions, masses] = this._positive_mass_support();
		if (positions.length === 0) {
			return Number.NaN;
		}

		let cumulative: number = 0;
		for (let i = 0; i < positions.length; i++) {
			cumulative += masses[i];
			if (cumulative / total_mass >= t) {
				return positions[i];
			}
		}

		return positions[positions.length - 1];
	}

	/**
	 * The median position, which is shorthand for `quantile(0.5)`.
	 *
	 * @returns The median position.
	 */
	get median(): number {
		return this.quantile(0.5);
	}

	/**
	 * The empirical right-continuous step-function CDF at `x`.
	 *
	 * @param x The evaluation point.
	 * @param treat_as_samples When `true`, ignores the masses and treats the
	 * positions as equally-weighted samples.
	 *
	 * @returns The CDF value in [0, 1]. NaN for a NaN input, and for an empty
	 * or all-zero-mass value.
	 */
	public cdf(x: number, { treat_as_samples = false } = {}): number {
		if (Number.isNaN(x)) {
			return Number.NaN;
		}

		if (treat_as_samples) {
			const sample_positions: Array<number> = this.positions.sort(ascending_nan_last);
			if (sample_positions.length === 0) {
				return Number.NaN;
			}

			return sample_positions.filter(position => position <= x).length
				/ sample_positions.length;
		}

		const total_mass: number = this._total_mass();
		if (total_mass === 0.0) {
			return Number.NaN;
		}

		const [positions, masses] = this._positive_mass_support();
		let cumulative: number = 0;
		for (let i = 0; i < positions.length; i++) {
			if (!(positions[i] <= x)) {
				break;
			}

			cumulative += masses[i];
		}

		return cumulative / total_mass;
	}

	/**
	 * The interpolated inverse CDF (quantile function). Unlike `quantile`,
	 * the result is not snapped to a support position.
	 *
	 * @param p The probability level, in [0, 1]. The two branches differ outside
	 * that range: the samples branch rejects such a `p`, while the weighted
	 * branch clamps it to the ends of the support.
	 * @param treat_as_samples When `true`, ignores the masses and treats the
	 * positions as equally-weighted samples.
	 *
	 * @returns The interpolated position. NaN for an empty support, for a NaN `p`
	 * on the weighted branch, and, as `np.quantile` does, for any `p` when
	 * `treat_as_samples` is `true` and a NaN sits anywhere in the positions.
	 *
	 * @throws EvalError: When `treat_as_samples` is `true`, the support is
	 * non-empty, and `p` is NaN or outside [0, 1].
	 */
	public inverse_cdf(p: number, { treat_as_samples = false } = {}): number {
		if (treat_as_samples) {
			const sample_positions: Array<number> = this.positions.sort(ascending_nan_last);
			if (sample_positions.length === 0) {
				return Number.NaN;
			}

			/* `np.quantile` validates its `q`, where the weighted branch's `np.interp` clamps. */
			if (!(p >= 0 && p <= 1)) {
				throw EvalError("Quantiles must be in the range [0, 1]");
			}

			const last: number = sample_positions.length - 1;
			const index: number = p * last;
			const previous: number = Math.floor(index);
			/* `np.quantile`'s `linear` method takes `previous + 1`, clamped to the last index. */
			const next: number = Math.min(previous + 1, last);
			const gamma: number = index - previous;
			const lower: number = sample_positions[previous];
			const upper: number = sample_positions[next];

			/* numpy's `_lerp` switches form at `gamma >= 0.5`. The two differ on an infinite bound. */
			const interpolated: number = gamma >= 0.5
				? upper - (upper - lower) * (1 - gamma)
				: lower + (upper - lower) * gamma;

			/* `np.quantile` sorts NaN last, then overwrites the result with a trailing NaN. */
			return Number.isNaN(sample_positions[last]) ? Number.NaN : interpolated;
		}

		if (Number.isNaN(p)) {
			return Number.NaN;
		}

		const [positions, masses] = this._positive_mass_support();
		if (positions.length === 0) {
			return Number.NaN;
		}

		let total_mass: number = 0;
		const cumulative: Array<number> = masses.map(mass => total_mass += mass);
		for (let i = 0; i < cumulative.length; i++) {
			cumulative[i] /= total_mass;
		}

		/* `np.interp` clamps outside the cumulative mass rather than extrapolating. */
		if (p <= cumulative[0]) {
			return positions[0];
		}

		for (let i = 1; i < cumulative.length; i++) {
			if (p <= cumulative[i]) {
				return positions[i - 1] + (p - cumulative[i - 1]) * (
					positions[i] - positions[i - 1]
				) / (cumulative[i] - cumulative[i - 1]);
			}
		}

		return positions[positions.length - 1];
	}

	/**
	 * The `order`-th raw moment, the sum of `p_i * x_i ** order` over the
	 * positive-mass Dirac deltas, normalized by their total mass. Like
	 * Python's, it calls `sort()` unless `order` is 0.
	 *
	 * @param order The moment order.
	 *
	 * @returns 1.0 for `order` 0 on a value with non-zero total mass. NaN when
	 * a NaN-position Dirac delta has positive mass. +Inf when only +Inf-position
	 * mass is present. For only -Inf-position mass, +Inf for an even `order`
	 * and -Inf for an odd one. For both, +Inf for an even `order` and NaN for an
	 * odd one. NaN for an empty or all-zero-mass value.
	 */
	public raw_moments(order: number): number {
		if (this._total_mass() === 0.0) {
			return Number.NaN;
		}

		if (order === 0) {
			return 1.0;
		}

		this.sort();

		if (this.nan_dirac_delta.mass > 0) {
			return Number.NaN;
		}

		const has_neg_inf: boolean = this.neg_inf_dirac_delta.mass > 0;
		const has_pos_inf: boolean = this.pos_inf_dirac_delta.mass > 0;
		/* `%` keeps the sign in JavaScript, but `-3 % 2` is still non-zero, as Python's parity test needs. */
		const is_even_order: boolean = order % 2 === 0;

		if (has_neg_inf && has_pos_inf) {
			return is_even_order ? Number.POSITIVE_INFINITY : Number.NaN;
		}

		if (has_pos_inf) {
			return Number.POSITIVE_INFINITY;
		}

		if (has_neg_inf) {
			return is_even_order ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
		}

		const [positions, masses] = this._positive_mass_support();
		const total_mass: number = pairwise_sum(masses);
		if (total_mass === 0.0) {
			return Number.NaN;
		}

		return pairwise_sum(masses.map((mass, i) => mass * positions[i] ** order)) / total_mass;
	}

	/**
	 * The `order`-th central moment, the sum of `p_i * (x_i - mean) ** order`
	 * over the positive-mass Dirac deltas, normalized by their total mass. The
	 * mean is that of the positive-mass Dirac deltas, summed as numpy sums it,
	 * not `this.mean`. Like Python's, it calls `sort()` unless `order` is 0.
	 *
	 * @param order The moment order.
	 *
	 * @returns 1.0 for `order` 0 on a value with non-zero total mass, even when
	 * the mean is not finite. NaN when a NaN- or +/-Inf-position Dirac delta has
	 * positive mass, and for an empty or all-zero-mass value.
	 */
	public central_moments(order: number): number {
		if (this._total_mass() === 0.0) {
			return Number.NaN;
		}

		if (order === 0) {
			return 1.0;
		}

		this.sort();

		if (
			this.nan_dirac_delta.mass > 0
			|| this.neg_inf_dirac_delta.mass > 0
			|| this.pos_inf_dirac_delta.mass > 0
		) {
			return Number.NaN;
		}

		const [positions, masses] = this._positive_mass_support();
		const total_mass: number = pairwise_sum(masses);
		if (total_mass === 0.0) {
			return Number.NaN;
		}

		const mean: number = pairwise_sum(masses.map((mass, i) => mass * positions[i])) / total_mass;

		return pairwise_sum(
			masses.map((mass, i) => mass * (positions[i] - mean) ** order)
		) / total_mass;
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
	 *
	 * @throws RangeError: As `export` does.
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
	 *
	 * @throws RangeError: As `export` does.
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
	 * @throws RangeError: When `UR_type` is not an integer in [0, 255], or a
	 * Dirac delta's raw mass does not fit in 64 bits (a mass of 2.0 or more), as
	 * Python's `struct.pack` raises `struct.error` rather than wrap the value.
	 *
	 * Ux String format specification:
	 * 	- Particle value (double in string format)
	 * 	- "Ux"                                              (   2 chars)
	 * 	- Representation type (uint8_t)                     (   2 chars)
	 * 	- Number of samples (uint64_t)                      (  16 chars) (unused)
	 * 	- Mean value of distribution (double)               (  16 chars)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)   (   8 chars)
	 * 	- Pairs of:
	 * 	- Support position (float/double)               (8/16 chars)
	 * 	- Probability mass (uint64_t)                   (  16 chars)
	 *
	 * Ux Binary specification:
	 * 	The Ux Binary Data layout has a 3-byte marker (0xF00000) between
	 * 	the particle value and the representation type. The legacy format
	 * 	does not have this marker. The `export` function always produces the
	 * 	Ux Binary layout and not the legacy. The `parse` function accepts
	 * 	both (see `parse`).
	 * 	For more information see https://docs.signaloid.io/docs/uxhw-api/ux-data-format/
	 *
	 * 	Ux Binary Data Format:
	 * 	- Particle value (double)                           (  8 bytes)
	 * 	- Representation type (uint32_t)                    (  4 bytes)
	 * 	- Number of samples (uint64_t)                      (  8 bytes) (unused)
	 * 	- Mean value of distribution (double)               (  8 bytes)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)   (  4 bytes)
	 * 	- Pairs of:
	 * 		- Support position (float/double)               (4/8 bytes)
	 * 		- Probability mass (uint64_t)                   (  8 bytes)
	 *
	 * 	Legacy format:
	 * 	- Particle value (double)                           (  8 bytes)
	 * 	- Representation type (uint8_t)                     (  1 byte )
	 * 	- Number of samples (uint64_t)                      (  8 bytes) (unused)
	 * 	- Mean value of distribution (double)               (  8 bytes)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)   (  4 bytes)
	 * 	- Pairs of:
	 * 		- Support position (float/double)               (4/8 bytes)
	 * 		- Probability mass (uint64_t)                   (  8 bytes)
	 */
	public export = (to_str: boolean = true): string | Array<number> => {
		/*
		 * Create byte representation. Appended to in place: `concat` copies
		 * the whole buffer each time, which is quadratic in the Dirac count.
		 */
		const buffer: Array<number> = [];
		const append = (bytes: null | Array<number>): void => {
			buffer.push(...(bytes || []));
		};
		let UxString: string = "";

		const fmt = STRUCT_FORMATS[to_str ? "str" : "bytes"];

		if (to_str) {
			/*
			 * Particle value(double in string format)
			 */
			UxString += this.particle_value !== null ? float_tostring(this.particle_value) : "";
			UxString += "Ux";
		} else {
			/*
			 * Particle value (double)                           (8 bytes)
			 */
			const particle_value = this.particle_value !== null ? this.particle_value : 0;
			append(struct.pack(fmt["particle"], [particle_value]));

			/*
			 * Ux Binary Data format specifies:
			 * - start byte (0xF0),
			 * - followed by 2 padding bytes (0x0000).
			 * These are inserted between the particle value and the
			 * representation type.
			 */
			append([UX_BINARY_FORMAT_MARKER, 0x00, 0x00]);
		}

		/*
		 * Representation type (uint8_t)                     (1 byte)
		 * Ux Binary Data always names a core, so an unspecified type is
		 * written as Athens there. A Ux string carries the type as it is.
		 */
		const UR_type: number = (
			!to_str && this.UR_type === UR_TYPE_UNSPECIFIED ? UR_TYPE_ATHENS : this.UR_type
		);
		check_unsigned_field(UR_type, fmt["UR_type"], UINT8_MAX);
		append(struct.pack(fmt["UR_type"], [UR_type]));

		/*
		 * Number of samples (uint64_t)                      (8 bytes)
		 */
		append(struct.pack(fmt["sample_count"], [this.UR_order]));

		/*
		 * Mean value of distribution (double)               (8 bytes)
		 * Mean is always double precision regardless of this.double_precision
		 */
		append(struct.pack(fmt["mean"], [this.mean]));

		/*
		 * Number of non-zero mass Dirac deltas (uint32_t)   (4 bytes)
		 */
		append(struct.pack(fmt["UR_order"], [this.UR_order]));

		/*
		 * Choose the format based on double_precision flag
		 */
		const position_format = fmt[this.double_precision ? "position_double" : "position_single"];

		/*
		 * Pairs of:
		 * - Support position (double or float)              (8 or 4 bytes)
		 * - Probability mass (uint64_t)                     (8 bytes)
		 */
		for (const dd of this.dirac_deltas) {
			/*
			 * Pack the position using either double or float precision
			 */
			append(struct.pack(position_format, [dd.position]));

			/*
			 * Probability mass is always uint64_t. A mass of 2.0 or more does
			 * not fit it.
			 */
			check_unsigned_field(dd.raw_mass, fmt["mass"], UINT64_MAX);
			append(struct.pack(fmt["mass"], [dd.raw_mass]));
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
	 * @param dist The input UxString, bare hex string, or byte array.
	 * @param double_precision The floating point representation precision.
	 * 				- true: double precision
	 * 				- false: single precision
	 * 				- null: retry single precision when the buffer is too short for double
	 *
	 * @returns The constructed `DistributionalValue` or null if parsing fails.
	 * Never logs. Where signaloid-data-toolkit's `bytes.fromhex` raises a
	 * ValueError, this returns null instead: for a bare string with no "Ux"
	 * that is not valid hex, and for an odd number of hex digits after "Ux".
	 *
	 * Ux String format specification:
	 * 	- Particle value (double in string format)
	 * 	- "Ux"                                              (   2 chars)
	 * 	- Representation type (uint8_t)                     (   2 chars)
	 * 	- Number of samples (uint64_t)                      (  16 chars) (unused)
	 * 	- Mean value of distribution (double)               (  16 chars)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)   (   8 chars)
	 * 	- Pairs of:
	 * 	- Support position (float/double)               (8/16 chars)
	 * 	- Probability mass (uint64_t)                   (  16 chars)
	 *
	 * Ux Binary specification:
	 * 	The Ux Binary Data layout has a 3-byte marker (0xF00000) between
	 * 	the particle value and the representation type. The legacy format
	 * 	does not have this marker. The `export` function always produces the
	 * 	Ux Binary layout and not the legacy. The `parse` function accepts
	 * 	both (see `parse`).
	 * 	For more information see https://docs.signaloid.io/docs/uxhw-api/ux-data-format/
	 *
	 * 	Ux Binary Data Format:
	 * 	- Particle value (double)                           (  8 bytes)
	 * 	- Representation type (uint32_t)                    (  4 bytes)
	 * 	- Number of samples (uint64_t)                      (  8 bytes) (unused)
	 * 	- Mean value of distribution (double)               (  8 bytes)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)   (  4 bytes)
	 * 	- Pairs of:
	 * 		- Support position (float/double)               (4/8 bytes)
	 * 		- Probability mass (uint64_t)                   (  8 bytes)
	 *
	 * 	Legacy format:
	 * 	- Particle value (double)                           (  8 bytes)
	 * 	- Representation type (uint8_t)                     (  1 byte )
	 * 	- Number of samples (uint64_t)                      (  8 bytes) (unused)
	 * 	- Mean value of distribution (double)               (  8 bytes)
	 * 	- Number of non-zero mass Dirac deltas (uint32_t)   (  4 bytes)
	 * 	- Pairs of:
	 * 		- Support position (float/double)               (4/8 bytes)
	 * 		- Probability mass (uint64_t)                   (  8 bytes)
	 */
	static parse = (
		dist: string | Array<number>,
		double_precision: null | boolean = null
	): null | DistributionalValue => {
		let buffer: Array<number> = [];
		let offset: number = 0;

		const double_precision_is_known: boolean = double_precision !== null;
		const dist_value: DistributionalValue = new DistributionalValue({
			double_precision: double_precision ?? true
		});

		const read = (format: string, size: number): null | number | bigint => {
			const values: null | Array<number | bigint> = struct.unpack(
				format,
				buffer.slice(offset, offset + size)
			);
			offset += size;

			return values === null ? null : values[0];
		};

		if (typeof (dist) === 'string' && !dist.includes("Ux")) {
			dist = bytes_fromhex(dist);
		}

		let fmt: { [id: string]: string };
		if (typeof (dist) === 'string') {
			/*
			 * Parse Hex string
			 */
			fmt = STRUCT_FORMATS["str"];

			const parts: Array<string> = dist.split("Ux");
			let index: number = 0;

			if (parts.length === 2) {
				if (parts[index] !== "") {
					const particle_value: null | number = float_fromstring(parts[index]);

					if (particle_value === null) {
						return null;
					}

					dist_value.particle_value = particle_value;
				}

				index += 1;
			}

			buffer = bytes_fromhex(parts[index]);
		} else if (dist instanceof Array) {
			/*
			 * Parse byte array
			 */
			fmt = STRUCT_FORMATS["bytes"];

			buffer = dist;

			/*
			 * Need 8 bytes for the particle value plus at least 1 more byte
			 * to detect the layout (see below).
			 */
			if (buffer.length < 9) {
				return null;
			}

			const particle_value: null | number | bigint = read(fmt["particle"], 8);
			if (particle_value === null) {
				return null;
			}

			dist_value.particle_value = Number(particle_value);

			if (buffer[offset] == UX_BINARY_FORMAT_MARKER) {
				/*
				 * If offset has the Ux Binary data format marker then we are not
				 * in the legacy format. Skip the 3-byte marker (0xF00000).
				 */
				offset += 3;
			}
		} else {
			return null;
		}

		/*
		 * Check if the buffer has the minimum required length (in bytes)
		 * Minimum length = 1 (repr) + 8 (samples) + 8 (mean) + 4 (count) = 21
		 */
		const min_length: number = offset + 21;
		if (buffer.length < min_length) {
			return null;
		}

		const UR_type: null | number | bigint = read(fmt["UR_type"], 1);

		/*
		 * Not used, uncomment if needed
		 * number_of_samples = read(fmt["sample_count"], 8);
		 */
		offset += 8;

		const mean: null | number | bigint = read(fmt["mean"], 8);
		const UR_order_raw: null | number | bigint = read(fmt["UR_order"], 4);

		if (UR_type === null || mean === null || UR_order_raw === null) {
			return null;
		}

		dist_value.UR_type = Number(UR_type);
		dist_value.mean = Number(mean);

		const UR_order: number = Number(UR_order_raw);

		/*
		 * Validate UR_order - reasonable upper limit to prevent processing
		 * extremely large inputs that might be malicious
		 */
		if (
			UR_order < 0
			|| UR_order > 10000
		) {
			return null;
		}

		/*
		 * Calculate expected length based on UR_order
		 * 4 or 8 for position + 8 for mass
		 */
		let bytes_per_position: number = dist_value.double_precision ? 8 : 4;
		let expected_length: number = min_length + (UR_order * (bytes_per_position + 8));
		if (buffer.length < expected_length) {
			if (double_precision_is_known) {
				return null;
			}

			dist_value.double_precision = false;
			bytes_per_position = 4;
			expected_length = min_length + (UR_order * (bytes_per_position + 8));
			if (buffer.length < expected_length) {
				return null;
			}
		}

		const position_format: string = fmt[
			dist_value.double_precision ? "position_double" : "position_single"
		];

		for (let i = 0; i < UR_order; i++) {
			const position: null | number | bigint = read(position_format, bytes_per_position);
			const raw_mass: null | number | bigint = read(fmt["mass"], 8);

			if (position === null || raw_mass === null) {
				return null;
			}

			dist_value.dirac_deltas.push(new DiracDelta({
				position: Number(position),
				raw_mass: BigInt(raw_mass)
			}));
		}

		return dist_value;
	}

	/**
	 * Calculates the distance between the mean values of this `DistributionalValue`
	 * and another `DistributionalValue`.
	 *
	 * @param other The other `DistributionalValue`.
	 *
	 * @returns The distance between the mean values. NaN when either mean is
	 * `null`.
	 */
	public mean_distance = (other: DistributionalValue): number => {
		if (this.mean === null || other.mean === null) {
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
	 * by the mean value of the other `DistributionalValue`). NaN when either
	 * mean is `null`, or the other mean is zero.
	 */
	public mean_relative_diff = (other: DistributionalValue): number => {
		/* `=== 0` also matches -0, as Python's `== 0` does. */
		if (this.mean === null || other.mean === null || other.mean === 0) {
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
			return;
		}

		this._dirac_deltas = this._dirac_deltas.filter(dd => dd.mass > 0);
		this._has_no_zero_mass = true;

		/*
		 * Dropping Dirac deltas can change the cached verdicts, so they are
		 * recomputed, where signaloid-data-toolkit keeps them. A sorted value
		 * stays sorted, though, so that verdict stands: resetting it would make
		 * the next `sort()` re-append the zero-mass slots just dropped, growing
		 * `UR_order` and the export back, as signaloid-data-toolkit does not.
		 */
		this._is_finite = null;
		if (this._is_sorted !== true) {
			this._is_sorted = null;
		}
		this._is_cured = null;
		this._is_full_valid_TTR = null;
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
			return null;
		}

		const deltas: Array<DiracDelta> = this.dirac_deltas;
		const length: number = deltas.length;

		/* Identity, not position: only `sort()` leaves the slots themselves in the tail. */
		const has_cured_tail: boolean = (
			length >= 3
			&& deltas[length - 3] === this.nan_dirac_delta
			&& deltas[length - 2] === this.neg_inf_dirac_delta
			&& deltas[length - 1] === this.pos_inf_dirac_delta
		);
		const finite_length: number = has_cured_tail ? length - 3 : length;

		for (let i = 0; i < finite_length; i++) {
			if (!deltas[i].isFinite) {
				return false;
			}

			if (i + 1 < finite_length && deltas[i].gt(deltas[i + 1])) {
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
		if (this._is_sorted) {
			return;
		}

		/* Accumulate into locals: the slots may already be in `dirac_deltas`. */
		let nan_mass: number = 0;
		let neg_inf_mass: number = 0;
		let pos_inf_mass: number = 0;
		const finite_dirac_deltas: Array<DiracDelta> = [];
		for (const dd of this.dirac_deltas) {
			if (dd.isFinite) {
				finite_dirac_deltas.push(dd);
			} else if (isNaN(dd.position)) {
				nan_mass += dd.mass;
			} else if (dd.position === Number.NEGATIVE_INFINITY) {
				neg_inf_mass += dd.mass;
			} else if (dd.position === Number.POSITIVE_INFINITY) {
				pos_inf_mass += dd.mass;
			}
		}

		this.nan_dirac_delta.mass = nan_mass;
		this.neg_inf_dirac_delta.mass = neg_inf_mass;
		this.pos_inf_dirac_delta.mass = pos_inf_mass;

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

		/*
		 * Python's `set()` over the positions keeps every NaN as a distinct
		 * entry, since NaN != NaN, where a JavaScript `Set` collapses them.
		 */
		const positions: Array<number> = this.positions;
		const non_nan_positions: Array<number> = positions.filter(position => !Number.isNaN(position));

		return non_nan_positions.length === new Set(non_nan_positions).size;
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

		/* Read once: the getter filters the whole list on every access. */
		const finite_dirac_deltas: Array<DiracDelta> = this.finite_dirac_deltas;
		if (finite_dirac_deltas.length <= 1) {
			this._is_cured = true;
			return;
		}

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
			for (const dd of finite_dirac_deltas) {
				finite_mass += dd.mass;
				finite_mean += dd.position * dd.mass;
			}
			finite_mean /= finite_mass;
			/*
			 * The threshold is a distance, so it uses the size of the mean. A
			 * negative mean would otherwise give a negative threshold, and
			 * coincident Dirac deltas would never be combined.
			 */
			const mean_threshold: number = Math.abs(finite_mean) * relative_mean_threshold;

			const range_threshold: number = (
				(finite_dirac_deltas[finite_dirac_deltas.length - 1].position - this.dirac_deltas[0].position)
				* relative_range_threshold
			);

			threshold = Math.max(mean_threshold, range_threshold);
		}

		const dirac_deltas = [this.dirac_deltas[0]];
		let index = 0;
		for (let i = 1; i < finite_dirac_deltas.length; i++) {
			const dd: DiracDelta = finite_dirac_deltas[i];
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

		/*
		 * Before the finiteness check, because `is_finite` is `null` for an
		 * empty value.
		 */
		if (this.UR_order === 0) {
			return null;
		}

		/*
		 * A non-finite Dirac delta cannot be part of a TTR, so a value carrying
		 * one is never a full valid TTR, as in signaloid-data-toolkit. Athens
		 * and Rome values still take the TTR route when plotted, via
		 * `TTR_NATIVE_UR_TYPES`.
		 */
		if (!this.is_finite) {
			return false;
		}

		if (this.UR_order === 1) {
			return true;
		}

		/*
		 * Check UR_order is power of 2
		 */
		if ((this.UR_order & (this.UR_order - 1)) !== 0) {
			return false;
		}

		const ttr_order: number = Math.log2(this.UR_order);
		const number_of_boundaries: number = 2 * this.UR_order - 1;
		const boundary_positions: Array<number> = Array(number_of_boundaries).fill(NaN);
		const boundary_probabilities: Array<number> = Array(number_of_boundaries).fill(NaN);

		for (let i = 0, j = 0; i < number_of_boundaries; i += 2, j++) {
			boundary_positions[i] = this.dirac_deltas[j].position;
			boundary_probabilities[i] = this.dirac_deltas[j].mass;
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

	public interpolate(numPoints: number): void {
		this.cure();

		const finite_dirac_deltas = this.finite_dirac_deltas;
		if (finite_dirac_deltas.length <= 1) {
			return;
		}

		function linspace(start: number, end: number, n: number): number[] {
			if (n <= 0) {
				return [];
			}

			if (n === 1) {
				return [(start + end) / 2];
			}

			const diff = end - start;
			const step = diff / (n - 1);
			return Array.from({ length: n }, (_, i) => start + i * step);
		}

		numPoints = Math.floor(numPoints);

		const newSpace = linspace(
			finite_dirac_deltas[0].position,
			finite_dirac_deltas[finite_dirac_deltas.length - 1].position,
			numPoints,
		);

		const new_dirac_deltas: DiracDelta[] = [];
		let lowerBoundIndex = 1;
		for (const newLocation of newSpace) {
			/* Clamped: the last linspace point sits on the last delta, which brackets nothing. */
			while (
				lowerBoundIndex < finite_dirac_deltas.length - 1
				&& finite_dirac_deltas[lowerBoundIndex].position <= newLocation
			) {
				lowerBoundIndex++;
			}

			const lowerDelta = finite_dirac_deltas[lowerBoundIndex - 1];
			const upperDelta = finite_dirac_deltas[lowerBoundIndex];

			const range = upperDelta.position - lowerDelta.position;
			const lowerDeltaContribution =
				range === 0 ? 0.5 : (upperDelta.position - newLocation) / range;
			const upperDeltaContribution =
				range === 0 ? 0.5 : (newLocation - lowerDelta.position) / range;

			const newDeltaWeight = (
				lowerDeltaContribution * lowerDelta.mass
				+ upperDeltaContribution * upperDelta.mass
			);
			new_dirac_deltas.push(new DiracDelta({
				position: newLocation,
				mass: newDeltaWeight
			}));
		}

		if (this.has_special_values) {
			new_dirac_deltas.push(this.nan_dirac_delta);
			new_dirac_deltas.push(this.neg_inf_dirac_delta);
			new_dirac_deltas.push(this.pos_inf_dirac_delta);
		}

		this._dirac_deltas = new_dirac_deltas;
		this._mean = null;
		this._variance = null;
	}

	public normalize_dirac_deltas(): void {
		let total_mass: number = 0;
		for (const dd of this.dirac_deltas) {
			total_mass += dd.mass;
		}

		if (total_mass <= 0 || Number.isNaN(total_mass) || !Number.isFinite(total_mass)) {
			return;
		}

		for (const dd of this.dirac_deltas) {
			dd.mass /= total_mass;
		}
	}
}

export {
	bytes_tohex,
	bytes_fromhex,
	DistributionalValue,
	TTR_NATIVE_UR_TYPES,
	UR_TYPE_ATHENS,
	UR_TYPE_JUPITER,
	UR_TYPE_ROME,
	UR_TYPE_UNSPECIFIED,
};
