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


import { DiracDelta } from './dirac_delta';
import { DistributionalValue, TTR_NATIVE_UR_TYPES } from './distributional';
import { pairwise_sum } from './summation';


/** Every power of 2 a request can ask for, from the TTR floor up to `MAX_BINS`. */
type PlottingResolution = 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024;


class PlotData {
	/** Maximum number of bins for plotting. */
	static MAX_BINS: number = 1024;

	/**
	 * Closest an internal bin boundary of a non-uniform binning may sit to the
	 * Dirac delta it is placed against, as a fraction of the interval between
	 * that Dirac delta and its neighbour. Only keeps the extremal bins from
	 * collapsing to zero width, so it is deliberately tiny: see
	 * `create_non_uniform_binning`.
	 */
	static MIN_INTERIOR_WEIGHT: number = 1e-6;

	dist: DistributionalValue;
	plotting_resolution: null | number = null;
	plotting_ttr_order: null | number = null;
	_positions: Array<number> = [];
	_masses: Array<number> = [];
	_widths: Array<number> = [];
	_max_value: null | number = null;

	constructor(
		dist: DistributionalValue,
		plotting_resolution?: PlottingResolution
	) {
		if (dist.mean === null || dist.UR_order == 0) {
			throw EvalError("Failed to load data");
		}

		this.dist = dist;
		if (plotting_resolution !== undefined) {
			this.plotting_resolution = plotting_resolution;
		}

		this._construct_plot_data();
	}

	/**
	 * Resolves the plotting resolution to (N*2) where N is the machine
	 * representation, capped at `MAX_BINS`.
	 *
	 * @throws EvalError: When the resolution is not a power of 2.
	 */
	private static _resolve_plotting_resolution(
		UR_order: number,
		requested: null | number
	): PlottingResolution {
		const machine_representation: number = 2 ** Math.floor(Math.log2(UR_order));
		const plotting_resolution: number = Math.floor(
			requested === null ?
				Math.min(machine_representation * 2, PlotData.MAX_BINS) :
				Math.min(machine_representation * 2, requested, PlotData.MAX_BINS)
		);

		/* Below 2 and for NaN there is no TTR order `bin_pdf_to_ttr` bottoms out on. */
		if (
			!(plotting_resolution >= 2)
			|| plotting_resolution > 2 ** Math.floor(Math.log2(plotting_resolution))
		) {
			throw EvalError(
				"plot_histogram_dirac_deltas: plotting_resolution must be a power of 2!"
			);
		}

		/* The guard above leaves only powers of 2 in [2, `MAX_BINS`]. */
		return plotting_resolution as PlottingResolution;
	}

	/**
	 * Constructs a `PlotData` from an array of float samples. Each sample is
	 * an equal-mass Dirac delta of a `DistributionalValue` with an unspecified
	 * representation type, which then takes the ordinary binning route, as
	 * signaloid-data-toolkit's `PlotData.from_samples` does.
	 *
	 * @param samples The float samples, which may contain NaN and +/-Inf.
	 * @param plotting_resolution The plotting resolution, a power of 2. Samples
	 * take the non-uniform binning, so the plot has at most half this many
	 * bins. Determined from the data when not given.
	 *
	 * @returns The constructed `PlotData`.
	 *
	 * @throws EvalError: When the samples array is empty, or the resolution is
	 * not a power of 2.
	 */
	static from_samples(
		samples: ArrayLike<number>,
		plotting_resolution?: PlottingResolution
	): PlotData {
		return new PlotData(DistributionalValue.from_samples(samples), plotting_resolution);
	}

	/**
	 * The boundary positions list.
	 *
	 * @returns The boundary positions list.
	 */
	get positions(): Array<number> {
		return this._positions;
	}

	/**
	 * Sets the boundary positions list, resetting the widths to avoid faulty
	 * values.
	 *
	 * @param positions The boundary positions list to use
	 */
	set positions(positions: Array<number>) {
		this._positions = positions;
		this._widths = [];
	}

	/**
	 * The bin heights list.
	 *
	 * @returns The bin heights list.
	 */
	get masses(): Array<number> {
		return this._masses;
	}

	/**
	 * Sets the bin heights list, resetting the max value to avoid faulty value.
	 *
	 * @param masses The bin heights list to use.
	 */
	set masses(masses: Array<number>) {
		this._masses = masses;
		this._max_value = null;
	}

	/**
	 * The minimum position.
	 *
	 * @returns The minimum position.
	 */
	get min_range(): number {
		if (this.positions.length == 1) {
			return this.positions[0] - 0.5;
		}

		return this.positions[0];
	}

	/**
	 * The maximum position.
	 *
	 * @returns The maximum position.
	 */
	get max_range(): number {
		if (this.positions.length == 1) {
			return this.positions[this.positions.length - 1] + 0.5;
		}

		return this.positions[this.positions.length - 1];
	}

	/**
	 * The total range of positions, i.e. the width between the minimum and
	 * maximum position.
	 *
	 * @returns The total range of positions.
	 */
	get total_range(): number {
		if (this.positions.length == 1) {
			return 1.0;
		}

		return this.positions[this.positions.length - 1] - this.positions[0];
	}

	/**
	 * The maximum bin height.
	 *
	 * @returns The maximum bin height.
	 *
	 * @throws EvalError: When there are no bins, as Python's `max` raises on
	 * an empty sequence.
	 */
	get max_value(): number {
		if (this._max_value === null) {
			if (this._masses.length === 0) {
				throw EvalError("max_value: there are no bin heights.");
			}

			this._max_value = this._masses.reduce(
				(maximum, mass) => (mass > maximum ? mass : maximum)
			);
		}

		return this._max_value;
	}

	/**
	 * The widths list between each pair of positions.
	 *
	 * @returns The widths list.
	 */
	get widths(): Array<number> {
		if (this._widths.length === 0) {
			const positions = this.positions;
			this._widths = [];
			for (let i = 0; i < positions.length - 1; i++) {
				this._widths.push(positions[i + 1] - positions[i]);
			}
		}

		return this._widths
	}

	/**
	 *
	 * If `use_ttr_binning` is true:
	 * Determines the internal boundary positions (and probabilities) using the
	 * TTR binning method.
	 * If `use_ttr_binning` is false:
	 * Determines the internal boundary positions (and probabilities) by only
	 * looking at the adjacent Dirac deltas.
	 *
	 * Args:
	 * 	finite_sorted_dirac_deltas: The input Dirac deltas with finite and
	 * 		sorted positions. At least two are required, since the extremal
	 * 		boundaries are placed relative to an adjacent Dirac delta.
	 * 	exponent: The TTR order, i.e., the base-2 logarithm of the number of
	 * 		Dirac deltas in the TTR. The number of bins in the output binning
	 * 		is twice the number of Dirac deltas in the TTR.
	 * 	use_ttr_binning: Flag specifying whether to use the TTR binning method.
	 * Returns:
	 * 	(boundary_positions, boundary_probabilities): The internal boundary positions
	 * 		and boundary probabilities that are intermediaries to get a binning.
	 * Throws:
	 * 	EvalError: When given fewer than two Dirac deltas.
	 */
	private static _determine_boundary_positions(
		finite_sorted_dirac_deltas: Array<DiracDelta>,
		exponent: number,
		use_ttr_binning: boolean
	): [Array<number>, Array<number>] {
		const number_of_finite_dirac_deltas: number = finite_sorted_dirac_deltas.length;
		if (number_of_finite_dirac_deltas < 2) {
			throw EvalError(
				"plot_histogram_dirac_deltas: _determine_boundary_positions requires "
				+ `at least two Dirac deltas, got ${number_of_finite_dirac_deltas}`
			);
		}

		const number_of_boundaries: number = 2 * number_of_finite_dirac_deltas + 1;
		const boundary_positions: Array<number> = Array(number_of_boundaries).fill(Number.NaN);
		const boundary_probabilities: Array<number> = Array(number_of_boundaries).fill(Number.NaN);
		for (const [i, dd] of finite_sorted_dirac_deltas.entries()) {
			boundary_positions[i * 2 + 1] = dd.position;
			boundary_probabilities[i * 2 + 1] = dd.mass;
		}

		if (!use_ttr_binning) {
			/*
			 * Determine the 'NaN'-valued boundary points from adjacent Dirac deltas.
			 */
			for (let i = 2; i < number_of_boundaries - 1; i += 2) {
				if (isNaN(boundary_positions[i])) {
					boundary_positions[i] = (
						boundary_probabilities[i - 1] * boundary_positions[i - 1]
						+ boundary_probabilities[i + 1] * boundary_positions[i + 1]
					) / (boundary_probabilities[i - 1] + boundary_probabilities[i + 1]);
				}
			}

			return [boundary_positions, boundary_probabilities];
		}

		/*
		 * First handle internal boundary positions.
		 */
		for (let n = 0; n < exponent; n++) {
			const step: number = 2 ** n;
			for (let i = 2 ** (n + 1); i < number_of_boundaries - 1; i += 2 ** (n + 2)) {
				boundary_probabilities[i] = (
					boundary_probabilities[i - step]
					+ boundary_probabilities[i + step]
				);
				boundary_positions[i] = (
					boundary_probabilities[i - step] * boundary_positions[i - step]
					+ boundary_probabilities[i + step] * boundary_positions[i + step]
				) / boundary_probabilities[i];
			}
		}

		/*
		 * Above process might not produce a strictly increasing sequence of
		 * positions if not a valid TTR, and it will leave 'NaN'-valued
		 * boundary points if the number of Dirac deltas is not a power of 2.
		 * Handle both cases by sweeping over the boundary positions.
		 */
		for (let i = 2; i < number_of_boundaries - 1; i += 2) {
			if (
				isNaN(boundary_positions[i])
				|| boundary_positions[i] <= boundary_positions[i - 1]
				|| boundary_positions[i] >= boundary_positions[i + 1]
			) {
				boundary_positions[i] = (
					boundary_probabilities[i - 1] * boundary_positions[i - 1]
					+ boundary_probabilities[i + 1] * boundary_positions[i + 1]
				) / (boundary_probabilities[i - 1] + boundary_probabilities[i + 1]);
			}
		}

		return [boundary_positions, boundary_probabilities];
	}

	/**
	 *
	 * Checking if (d/dx)^2 = 0 boundary condition has a solution.
	 * If not, falling back to the boundary condition d/dx = 0.
	 *
	 * Args:
	 * 	finite_sorted_dirac_deltas: The input Dirac deltas with finite and
	 * 		sorted positions.
	 * 	boundary_positions: The internal boundary positions that are
	 * 		intermediaries to get a binning.
	 * 	boundary_probabilities: The internal boundary probabilities that are
	 * 		intermediaries to get a binning.
	 * 	bin_widths: The internal bin widths that are intermediaries to get
	 * 		a binning.
	 * 	bin_heights:The internal bin heights that are intermediaries to get
	 * 		a binning.
	 * 	left: The position to which to do the handling.
	 * Returns:
	 * 	(boundary_positions, bin_widths, bin_heights): The boundary positions,
	 * 		bin widths, and bin heights that describe the output binning.
	 */
	private static _handle_extremal_bins(
		finite_sorted_dirac_deltas: Array<DiracDelta>,
		boundary_positions: Array<number>,
		boundary_probabilities: Array<number>,
		bin_widths: Array<number>,
		bin_heights: Array<number>,
		left: boolean = true,
	): [Array<number>, Array<number>, Array<number>] {
		let w0: number | null = null;
		let det: number = Number.NaN;
		if (finite_sorted_dirac_deltas.length >= 6) {
			const p0: number = boundary_probabilities[left ? 1 : boundary_probabilities.length - 2];
			const w1: number = bin_widths[left ? 1 : bin_widths.length - 2];
			const w2: number = bin_widths[left ? 2 : bin_widths.length - 3];
			const d2: number = bin_heights[left ? 2 : bin_heights.length - 3];
			const a: number = d2 * w1 - p0;
			const b: number = a * w1 - p0 * w2;
			const c: number = p0 * w1 * (w1 + w2);
			det = b * b - 4 * a * c;

			if (det >= 0) {
				/*
				 * There are real roots. Pick the smallest positive root if there is one.
				 */
				const root1 = (-b + Math.sqrt(det)) / (2 * a);
				const root2 = (-b - Math.sqrt(det)) / (2 * a);

				/*
				 * Python's builtin `max` keeps its first argument unless the
				 * second compares greater, so a NaN second root is dropped,
				 * where `Math.max` would propagate it.
				 */
				if (root1 > 0 && root2 > 0) {
					w0 = Math.min(root1, root2);
				} else if (root1 > 0 || root2 > 0) {
					w0 = root2 > root1 ? root2 : root1;
				}
			}
		}

		if (w0 === null || !isFinite(det) || isNaN(det)) {
			/*
			 * The boundary condition d/dx = 0.
			 */
			boundary_positions[left ? 0 : boundary_positions.length - 1] = (
				boundary_positions[left ? 1 : boundary_positions.length - 2]
				+ (left ? -1 : 1) * (
					boundary_positions[left ? 2 : boundary_positions.length - 2]
					- boundary_positions[left ? 1 : boundary_positions.length - 3]
				)
			);
		} else {
			/*
			 * The boundary condition (d/dx)^2 = 0.
			 */
			boundary_positions[left ? 0 : boundary_positions.length - 1] = (
				boundary_positions[left ? 1 : boundary_positions.length - 2]
				+ (left ? -1 : 1) * w0
			);
		}

		bin_widths[left ? 0 : bin_widths.length - 1] = (
			boundary_positions[left ? 1 : boundary_positions.length - 1]
			- boundary_positions[left ? 0 : boundary_positions.length - 2]
		);
		const averageHeight: number = (
			finite_sorted_dirac_deltas[left ? 0 : finite_sorted_dirac_deltas.length - 1].mass
			/ (bin_widths[left ? 0 : bin_widths.length - 1] + bin_widths[left ? 1 : bin_widths.length - 2])
		);
		bin_heights[left ? 0 : bin_heights.length - 1] = (
			averageHeight * bin_widths[left ? 1 : bin_widths.length - 2]
			/ bin_widths[left ? 0 : bin_widths.length - 1]
		);
		bin_heights[left ? 1 : bin_heights.length - 2] = (
			averageHeight * bin_widths[left ? 0 : bin_widths.length - 1]
			/ bin_widths[left ? 1 : bin_widths.length - 2]
		);

		return [boundary_positions, bin_widths, bin_heights];
	}

	/**
	 *
	 * Finds the binning for the given finite and sorted Dirac deltas and the
	 * calculated internal boundary positions and probabilities.
	 *
	 * Args:
	 * 	finite_sorted_dirac_deltas: The input Dirac deltas with finite and
	 * 		sorted positions.
	 * 	boundary_positions: The internal boundary positions that are
	 * 		intermediaries to get a binning.
	 * 	boundary_probabilities: The internal boundary probabilities that are
	 * 		intermediaries to get a binning.
	 * Returns:
	 * 	(boundary_positions, bin_widths, bin_heights): The boundary positions,
	 * 		bin widths, and bin heights that describe the output binning.
	 */
	private static _get_binning(
		finite_sorted_dirac_deltas: Array<DiracDelta>,
		boundary_positions: Array<number>,
		boundary_probabilities: Array<number>
	): [Array<number>, Array<number>, Array<number>] {
		const number_of_finite_dirac_deltas: number = finite_sorted_dirac_deltas.length;

		/*
		 * Initialize the binning and populate it for the internal bins.
		 */
		const numberOfBins: number = 2 * number_of_finite_dirac_deltas;
		let bin_widths: Array<number> = Array(numberOfBins).fill(Number.NaN);
		let bin_heights: Array<number> = Array(numberOfBins).fill(Number.NaN);
		for (let i = 1; i < numberOfBins - 1; i++) {
			bin_widths[i] = boundary_positions[i + 1] - boundary_positions[i];
		}

		for (let i = 1; i < number_of_finite_dirac_deltas - 1; i++) {
			const averageHeight: number = finite_sorted_dirac_deltas[i].mass / (
				bin_widths[2 * i] + bin_widths[2 * i + 1]
			);
			bin_heights[2 * i] = (
				averageHeight * bin_widths[2 * i + 1] / bin_widths[2 * i]
			);
			bin_heights[2 * i + 1] = (
				averageHeight * bin_widths[2 * i] / bin_widths[2 * i + 1]
			);
		}

		[boundary_positions, bin_widths, bin_heights] = PlotData._handle_extremal_bins(
			finite_sorted_dirac_deltas,
			boundary_positions,
			boundary_probabilities,
			bin_widths,
			bin_heights,
			true,
		);
		[boundary_positions, bin_widths, bin_heights] = PlotData._handle_extremal_bins(
			finite_sorted_dirac_deltas,
			boundary_positions,
			boundary_probabilities,
			bin_widths,
			bin_heights,
			false,
		);

		return [boundary_positions, bin_widths, bin_heights];
	}

	/**
	 *
	 * - If `use_ttr_binning` is true:
	 * 	Creates a binning using the TTR binning method. The TTR binning method
	 * 	creates the unique binning (up to extremal bins determined by the imposed
	 * 	boundary conditions) such that the TTR of the binning exactly coincides
	 * 	with the input Dirac deltas. Requires the input Dirac deltas to form
	 * 	a valid TTR.
	 * - If `use_ttr_binning` is false:
	 * 	Creates a binning without requiring the valid TTR property, where the
	 * 	internal bin boundaries are determined only by adjacent Dirac deltas and
	 * 	the average of two bins surrounding a Dirac delta is the Dirac delta itself.
	 *
	 * Args:
	 * 	finite_sorted_dirac_deltas: The input Dirac deltas with finite
	 * 		and sorted positions. At least two are required.
	 * 	exponent: The TTR order, i.e., the base-2 logarithm of the number of
	 * 		Dirac deltas in the TTR. The number of bins in the output binning
	 * 		is twice the number of Dirac deltas in the TTR.
	 * 	use_ttr_binning: Flag specifying whether to use the TTR binning method.
	 * Returns:
	 * 	(boundary_positions, bin_widths, bin_heights): The boundary positions,
	 * 		bin widths, and bin heights that describe the output binning.
	 * Throws:
	 * 	EvalError: When given fewer than two Dirac deltas. Both bins that
	 * 		surround a lone Dirac delta would be bounded on the outside by a
	 * 		boundary placed relative to a Dirac delta that does not exist, so
	 * 		the binning has no widths. Callers plot a lone Dirac delta as a
	 * 		Dirac delta instead, which is what `_construct_plot_data` does.
	 */
	static create_binning(
		finite_sorted_dirac_deltas: Array<DiracDelta>,
		exponent: number,
		use_ttr_binning: boolean
	): [Array<number>, Array<number>, Array<number>] {
		if (finite_sorted_dirac_deltas.length < 2) {
			throw EvalError(
				"plot_histogram_dirac_deltas: create_binning requires at least two "
				+ `Dirac deltas, got ${finite_sorted_dirac_deltas.length}`
			);
		}

		let boundary_positions: Array<number>;
		let boundary_probabilities: Array<number>;
		let bin_widths: Array<number>;
		let bin_heights: Array<number>;
		[boundary_positions, boundary_probabilities] = PlotData._determine_boundary_positions(
			finite_sorted_dirac_deltas, exponent, use_ttr_binning
		);

		[boundary_positions, bin_widths, bin_heights] = PlotData._get_binning(
			finite_sorted_dirac_deltas, boundary_positions, boundary_probabilities
		);

		return [boundary_positions, bin_widths, bin_heights];
	}

	/**
	 *
	 * Places one bin boundary between each pair of adjacent Dirac deltas, at the
	 * fraction `interior_weight` of the way from the left to the right Dirac delta.
	 * The two extremal boundaries are mirror images of their inner neighbours
	 * about the extremal Dirac deltas, which is the (d/dx) = 0 boundary condition.
	 *
	 * Args:
	 * 	positions: Strictly increasing Dirac delta positions. At least two are
	 * 		required, since every boundary is placed relative to an adjacent
	 * 		Dirac delta.
	 * 	interior_weight: Position of an internal boundary within the interval
	 * 		between two adjacent Dirac deltas. `0.5` places it at the midpoint.
	 * Returns:
	 * 	boundary_positions: The (N + 1) boundary positions of the N cells.
	 * Throws:
	 * 	EvalError: When given fewer than two positions.
	 */
	private static _cell_boundary_positions(
		positions: Array<number>,
		interior_weight: number
	): Array<number> {
		const number_of_cells: number = positions.length;
		if (number_of_cells < 2) {
			throw EvalError(
				"plot_histogram_dirac_deltas: _cell_boundary_positions requires at "
				+ `least two positions, got ${number_of_cells}`
			);
		}

		const boundary_positions: Array<number> = Array(number_of_cells + 1).fill(Number.NaN);
		for (let i = 1; i < number_of_cells; i++) {
			boundary_positions[i] = (
				(1 - interior_weight) * positions[i - 1] + interior_weight * positions[i]
			);
		}
		boundary_positions[0] = 2 * positions[0] - boundary_positions[1];
		boundary_positions[number_of_cells] = (
			2 * positions[number_of_cells - 1] - boundary_positions[number_of_cells - 1]
		);

		return boundary_positions;
	}

	/**
	 * Finds the first cell that does not hold its Dirac delta strictly inside
	 * it, i.e., whose bin is empty or inverted, or has a boundary on or past its
	 * Dirac delta. Boundaries that are valid in exact arithmetic can still
	 * collapse a cell once they are rounded.
	 *
	 * @param boundary_positions The (N + 1) boundary positions of the N cells.
	 * @param positions The N Dirac delta positions, one per cell.
	 *
	 * @returns The index of the first such cell, or `null` when every cell
	 * holds its Dirac delta.
	 */
	private static _first_collapsed_cell(
		boundary_positions: Array<number>,
		positions: Array<number>
	): null | number {
		for (let i = 0; i < positions.length; i++) {
			if (!(boundary_positions[i] < positions[i] && positions[i] < boundary_positions[i + 1])) {
				return i;
			}
		}

		return null;
	}

	/**
	 * Merges the Dirac delta at `index` with its nearest neighbour, the one
	 * across the smaller gap and the lower one on a tie. The merge keeps the
	 * mass and the mean of the two.
	 *
	 * @param dirac_deltas Dirac deltas with strictly increasing positions, at
	 * least two.
	 * @param index The index of the Dirac delta to merge.
	 *
	 * @returns The Dirac deltas with the two merged into one.
	 */
	private static _merge_into_nearest_neighbour(
		dirac_deltas: Array<DiracDelta>,
		index: number
	): Array<DiracDelta> {
		let neighbour: number;
		if (index === 0) {
			neighbour = 1;
		} else if (index === dirac_deltas.length - 1) {
			neighbour = index - 1;
		} else {
			const gap_below: number = dirac_deltas[index].position - dirac_deltas[index - 1].position;
			const gap_above: number = dirac_deltas[index + 1].position - dirac_deltas[index].position;
			neighbour = gap_below <= gap_above ? index - 1 : index + 1;
		}

		const lower: number = Math.min(index, neighbour);

		return [
			...dirac_deltas.slice(0, lower),
			dirac_deltas[lower].add(dirac_deltas[lower + 1]),
			...dirac_deltas.slice(lower + 2),
		];
	}

	/**
	 *
	 * Places the bin boundaries so that every bin is centred on the Dirac delta it
	 * holds, which preserves each Dirac delta's own mean and not just the mean of
	 * the whole distribution. This is the property the TTR binning method has, and
	 * the property `create_binning` gets from using two bins per Dirac delta.
	 *
	 * Centring bin `i` on Dirac delta `i` means (b[i] + b[i + 1]) / 2 == p[i], so
	 * the boundaries follow the recurrence b[i + 1] = 2 * p[i] - b[i]: the whole
	 * binning is determined by the first boundary alone. Writing e[i] for the
	 * distance p[i] - b[i], the width of bin `i` is 2 * e[i] and the recurrence is
	 * e[i + 1] = g[i] - e[i], for gaps g[i] = p[i + 1] - p[i]. Each e[i] is
	 * therefore affine in e[0] with an alternating sign, so requiring every
	 * boundary to stay strictly between the two Dirac deltas it separates,
	 * 0 < e[i] < g[i], is a set of linear constraints on e[0].
	 *
	 * Those constraints have no solution for arbitrary Dirac delta spacing, since
	 * the recurrence is undamped and alternating gaps drive e[i] out of its
	 * interval. Where there is a solution, this takes the midpoint of it, which is
	 * the choice furthest from every constraint and so has the widest bins. The
	 * constraints are solved in exact arithmetic, so a feasible interval that is
	 * narrow enough can still yield boundaries that rounding pushes onto or past a
	 * Dirac delta. The constructed boundaries are therefore re-checked and also
	 * rejected in that case.
	 *
	 * Args:
	 * 	positions: Strictly increasing Dirac delta positions, at least two.
	 * Returns:
	 * 	boundary_positions: The (N + 1) boundary positions of the N Dirac deltas, or
	 * 		`null` when no first boundary exists that solves the constraints
	 * 		or when rounding pushes a bin boundary beyond the next Dirac delta.
	 */
	private static _local_mean_boundary_positions(positions: Array<number>): null | Array<number> {
		/*
		 * Intersect the constraints 0 < e[i] < g[i] to bound e[0].
		 */
		let lowest: number = 0.0;
		let highest: number = Number.POSITIVE_INFINITY;
		let constant: number = 0.0;
		let sign: number = 1.0;
		for (let i = 0; i < positions.length - 1; i++) {
			const gap: number = positions[i + 1] - positions[i];
			if (sign > 0) {
				lowest = Math.max(lowest, -constant);
				highest = Math.min(highest, gap - constant);
			} else {
				lowest = Math.max(lowest, constant - gap);
				highest = Math.min(highest, constant);
			}
			constant = gap - constant;
			sign = -sign;
		}

		if (!(lowest < highest)) {
			return null;
		}

		const boundary_positions: Array<number> = Array(positions.length + 1).fill(Number.NaN);
		let distance_to_dirac_delta: number = (lowest + highest) / 2;
		boundary_positions[0] = positions[0] - distance_to_dirac_delta;
		for (let i = 0; i < positions.length; i++) {
			boundary_positions[i + 1] = positions[i] + distance_to_dirac_delta;
			if (i + 1 < positions.length) {
				distance_to_dirac_delta = positions[i + 1] - positions[i] - distance_to_dirac_delta;
			}
		}

		/*
		 * The constraints are solved in exact arithmetic, so re-check the result
		 * rather than trust that rounding kept every bin valid and populated.
		 */
		if (PlotData._first_collapsed_cell(boundary_positions, positions) !== null) {
			return null;
		}

		return boundary_positions;
	}

	/**
	 *
	 * Creates a binning with one bin per Dirac delta, where the bin holding a
	 * Dirac delta carries exactly that Dirac delta's mass and the internal bin
	 * boundaries lie between adjacent Dirac deltas. The bins therefore have
	 * non-uniform widths that follow the spacing of the Dirac deltas, and there
	 * are no empty bins between Dirac deltas, i.e., the binning reads the input
	 * as a continuous distribution with no gaps in its support.
	 *
	 * The total mass of the binning always equals that of the input. Where the
	 * Dirac delta spacing allows it, every bin is also centred on the Dirac delta
	 * it holds, so each Dirac delta's own mean is preserved and not merely the
	 * mean of the whole distribution, which is the property the TTR binning method
	 * has. That is not solvable for every spacing (see
	 * `_local_mean_boundary_positions`), and where it is not, the boundaries fall
	 * back to a single placement fraction shared by all of them, solved to match
	 * the mean of the whole distribution. That mean is then exact, unless matching
	 * it would collapse an extremal bin to zero width and the placement is
	 * therefore clamped to `MIN_INTERIOR_WEIGHT`. The mean is then approximate,
	 * but never further off than placing every boundary at a midpoint would leave
	 * it.
	 *
	 * Near a large magnitude, that placement can round a boundary onto or past a
	 * Dirac delta, which would leave a bin of zero width and infinite density.
	 * The Dirac delta of such a bin is then merged into its nearest neighbour,
	 * which keeps the mass and the mean, and the merged Dirac deltas are binned
	 * instead. The binning then has one bin fewer than there are input Dirac
	 * deltas.
	 *
	 * Args:
	 * 	finite_sorted_dirac_deltas: The input Dirac deltas with finite,
	 * 		strictly increasing positions. At least two are required.
	 * Returns:
	 * 	(boundary_positions, bin_widths, bin_heights): The boundary positions,
	 * 		bin widths, and bin heights that describe the output binning.
	 * Throws:
	 * 	EvalError: When given fewer than two Dirac deltas. A lone Dirac delta
	 * 		has no adjacent Dirac delta to place a bin boundary against, so it
	 * 		has no bin width. Callers plot it as a Dirac delta instead, which is
	 * 		what `_construct_plot_data` does. Also when merging leaves a lone
	 * 		Dirac delta, which takes two Dirac deltas only a few ulps apart.
	 */
	static create_non_uniform_binning(
		finite_sorted_dirac_deltas: Array<DiracDelta>
	): [Array<number>, Array<number>, Array<number>] {
		if (finite_sorted_dirac_deltas.length < 2) {
			throw EvalError(
				"plot_histogram_dirac_deltas: create_non_uniform_binning requires "
				+ `at least two Dirac deltas, got ${finite_sorted_dirac_deltas.length}`
			);
		}

		const positions: Array<number> = finite_sorted_dirac_deltas.map(dd => dd.position);
		const masses: Array<number> = finite_sorted_dirac_deltas.map(dd => dd.mass);
		const binning_of = (boundary_positions: Array<number>): [Array<number>, Array<number>, Array<number>] => {
			const bin_widths: Array<number> = [];
			for (let i = 0; i < masses.length; i++) {
				bin_widths.push(boundary_positions[i + 1] - boundary_positions[i]);
			}

			return [boundary_positions, bin_widths, masses.map((mass, i) => mass / bin_widths[i])];
		};

		/*
		 * Preserving every Dirac delta's own mean also preserves the mean of the
		 * whole distribution, so prefer it wherever the spacing admits it.
		 */
		const local_mean_boundary_positions: null | Array<number> = (
			PlotData._local_mean_boundary_positions(positions)
		);
		if (local_mean_boundary_positions !== null) {
			return binning_of(local_mean_boundary_positions);
		}

		const target_mean: number = pairwise_sum(positions.map((position, i) => position * masses[i]));
		const mean_of = (interior_weight: number): number => {
			const boundaries: Array<number> = PlotData._cell_boundary_positions(positions, interior_weight);

			return pairwise_sum(masses.map((mass, i) => mass * (boundaries[i] + boundaries[i + 1]) / 2));
		};

		/*
		 * The mean of the binning is affine in `interior_weight`, so two
		 * evaluations determine the value that reproduces the input mean. The mean
		 * can also be independent of `interior_weight` (e.g., for two Dirac
		 * deltas, where the mirrored boundaries centre both cells on their Dirac
		 * delta for any placement), in which case any placement is mean-exact.
		 */
		const mean_at_zero: number = mean_of(0.0);
		const mean_at_one: number = mean_of(1.0);
		let interior_weight: number = (
			Math.abs(mean_at_one - mean_at_zero) < 1e-15 ?
				0.5 :
				(target_mean - mean_at_zero) / (mean_at_one - mean_at_zero)
		);

		/*
		 * Keep the placement off the ends of [0, 1], where an extremal bin would
		 * collapse to zero width: the width of an internal bin is a convex
		 * combination of the two gaps adjacent to its Dirac delta, so it stays
		 * positive throughout, but the width of an extremal bin is twice the weight
		 * times the extremal gap. The bound is only there to keep the widths
		 * positive, so it is as small as it can be: clamping is what makes the mean
		 * of the binning approximate, and a placement near an end is the correct
		 * answer for a value whose extremal Dirac deltas are much closer together
		 * than the rest, where the density really is that much higher there.
		 */
		interior_weight = Math.min(
			Math.max(interior_weight, PlotData.MIN_INTERIOR_WEIGHT),
			1 - PlotData.MIN_INTERIOR_WEIGHT,
		);

		const boundary_positions: Array<number> = PlotData._cell_boundary_positions(positions, interior_weight);

		/*
		 * Near a large magnitude, the clamped placement can round a boundary onto
		 * or past a Dirac delta, which would leave a bin of zero width and
		 * infinite density. Merge that Dirac delta into its nearest neighbour,
		 * which keeps the mass and the mean, and bin the merged Dirac deltas
		 * instead.
		 */
		const collapsed_cell: null | number = PlotData._first_collapsed_cell(boundary_positions, positions);
		if (collapsed_cell !== null) {
			return PlotData.create_non_uniform_binning(
				PlotData._merge_into_nearest_neighbour(finite_sorted_dirac_deltas, collapsed_cell)
			);
		}

		return binning_of(boundary_positions);
	}

	/**
	 *
	 * Computes the expected Dirac delta of an input bin PDF.
	 *
	 * Args:
	 * 	boundary_positions: Positions of bin boundaries of the input bin PDF.
	 * 	bin_widths: Widths of the bins of the input bin PDF.
	 * 	bin_heights: Heights of the bins of the input bin PDF.
	 * Returns:
	 * 	expected_dirac_delta: The expected Dirac delta of the bin PDF.
	 * Throws:
	 * 	EvalError: If the bin PDF has no mass. A split of bins only a few
	 * 		ulps wide can leave one half empty.
	 */
	private static _bin_pdf_expected_dirac_delta(
		boundary_positions: Array<number>,
		bin_widths: Array<number>,
		bin_heights: Array<number>
	): DiracDelta {
		const probabilities: Array<number> = bin_widths.map((width, i) => width * bin_heights[i]);
		const probability_sum: number = pairwise_sum(probabilities);
		if (probability_sum === 0) {
			throw EvalError("The bin PDF has no mass, so it has no expected Dirac delta.");
		}

		const moment_sum: number = pairwise_sum(probabilities.map(
			(probability, i) => probability * ((boundary_positions[i + 1] + boundary_positions[i]) / 2)
		));

		return new DiracDelta({
			position: moment_sum / probability_sum,
			mass: probability_sum
		});
	}

	/**
	 *
	 * Computes TTR for an input bin PDF.
	 *
	 * For an input bin PDF with N bins, the shapes are:
	 * 	`boundary_positions.length == N + 1`
	 * 	`bin_widths.length == N`
	 * 	`bin_heights.length == N`
	 *
	 * Args:
	 * 	boundary_positions: Positions of the bin boundaries of the input bin PDF.
	 * 	bin_widths: Widths of the bins of the input bin PDF.
	 * 	bin_heights: Heights of the bins of the input bin PDF.
	 * 	order: TTR order.
	 * Returns:
	 * 	ttr: The TTR of the input bin PDF, a (2 ** `order`)-length array of Dirac deltas.
	 * Throws:
	 * 	EvalError: If a split leaves a half with no mass.
	 */
	static bin_pdf_to_ttr(
		boundary_positions: Array<number>,
		bin_widths: Array<number>,
		bin_heights: Array<number>,
		order: number
	): Array<DiracDelta> {
		const expected_dirac_delta: DiracDelta = PlotData._bin_pdf_expected_dirac_delta(
			boundary_positions, bin_widths, bin_heights
		);

		if (order === 0) {
			return [expected_dirac_delta];
		}

		let ttr: Array<DiracDelta> = [];
		let low_boundary_positions: Array<number> = [];
		let low_bin_widths: Array<number> = [];
		let low_bin_heights: Array<number> = [];
		let high_boundary_positions: Array<number> = [];
		let high_bin_widths: Array<number> = [];
		let high_bin_heights: Array<number> = [];

		for (let i = 0; i < boundary_positions.length; i++) {
			const boundary_position: number = boundary_positions[i];
			if (boundary_position === expected_dirac_delta.position) {
				low_boundary_positions = boundary_positions.slice(0, i + 1);
				low_bin_widths = bin_widths.slice(0, i);
				low_bin_heights = bin_heights.slice(0, i);
				high_boundary_positions = boundary_positions.slice(i);
				high_bin_widths = bin_widths.slice(i);
				high_bin_heights = bin_heights.slice(i);
				break;
			}

			if (boundary_position > expected_dirac_delta.position) {
				low_boundary_positions = boundary_positions.slice(0, i);
				low_boundary_positions.push(expected_dirac_delta.position);
				low_bin_widths = bin_widths.slice(0, i - 1);
				/* `at` wraps a negative index the way Python's indexing does. */
				low_bin_widths.push(
					expected_dirac_delta.position - (boundary_positions.at(i - 1) as number)
				);
				low_bin_heights = bin_heights.slice(0, i);
				high_boundary_positions = [expected_dirac_delta.position].concat(
					boundary_positions.slice(i)
				);
				high_bin_widths = [boundary_position - expected_dirac_delta.position].concat(
					bin_widths.slice(i)
				);
				high_bin_heights = bin_heights.slice(i - 1);
				break;
			}
		}

		ttr = ttr.concat(PlotData.bin_pdf_to_ttr(
			low_boundary_positions, low_bin_widths, low_bin_heights, order - 1
		));
		ttr = ttr.concat(PlotData.bin_pdf_to_ttr(
			high_boundary_positions, high_bin_widths, high_bin_heights, order - 1
		));

		return ttr;
	}

	/**
	 * Merges runs of neighbouring Dirac deltas into `number_of_groups` Dirac
	 * deltas, keeping the mass and the mean of each run. Runs are as long as
	 * `np.array_split` makes them: the first (N mod `number_of_groups`) runs
	 * hold one Dirac delta more than the rest.
	 */
	private static _merge_runs(
		dirac_deltas: Array<DiracDelta>,
		number_of_groups: number
	): Array<DiracDelta> {
		const run_length: number = Math.floor(dirac_deltas.length / number_of_groups);
		const longer_runs: number = dirac_deltas.length % number_of_groups;
		const merged: Array<DiracDelta> = [];
		let start: number = 0;
		for (let group = 0; group < number_of_groups; group++) {
			const end: number = start + run_length + (group < longer_runs ? 1 : 0);
			merged.push(dirac_deltas.slice(start + 1, end).reduce(
				(sum, dd) => sum.add(dd), dirac_deltas[start]
			));
			start = end;
		}

		return merged;
	}

	/**
	 * Constructs the `PlotData`, after parsing the given `DistributionalValue`.
	 * Generates the boundary positions and bin heights, ready for plotting.
	 *
	 * @throws EvalError: When the plotting_resolution is not a power of 2.
	 */
	private _construct_plot_data(): void {
		this.dist.drop_zero_mass_positions();

		this.dist.combine_dirac_deltas()

		/*
		 * Create the list of finite sorted Dirac deltas.
		 * Last three positions are for non-finite values
		 */
		let finite_dirac_deltas: Array<DiracDelta> = this.dist.finite_dirac_deltas;

		/*
		 * If no finite Dirac deltas found, then return.
		 */
		if (finite_dirac_deltas.length == 0) {
			return;
		}

		if (finite_dirac_deltas.length == 1) {
			this.positions = [finite_dirac_deltas[0].position];
			this.masses = [finite_dirac_deltas[0].mass];
			return;
		}

		this.plotting_resolution = PlotData._resolve_plotting_resolution(
			this.dist.UR_order, this.plotting_resolution
		);
		this.plotting_ttr_order = Math.floor(Math.log2(this.plotting_resolution)) - 1;

		/*
		 * Use the TTR binning method for Athens/Rome, as they use the TTR split
		 * as their compression method. Not all Athens/Rome outputs are valid
		 * TTRs, as they could have ended with a libm operation on just the
		 * positions, which does not trigger an additional split. Other types,
		 * e.g. Jupiter, can produce valid TTRs as well, so apply the check
		 * before falling back to the non-uniform binning method.
		 */
		const use_ttr_route: boolean = (
			(this.dist.UR_type !== null && TTR_NATIVE_UR_TYPES.has(this.dist.UR_type))
			|| this.dist.check_is_full_valid_TTR() === true
		);

		if (use_ttr_route) {
			try {
				/*
				 * Create the binning such that the average of two bins surrounding
				 * a Dirac delta is the Dirac delta itself.
				 */
				let [boundary_positions, bin_widths, bin_heights] = PlotData.create_binning(
					finite_dirac_deltas, 0, false
				);

				/*
				 * Find the TTR of the created binning. This is always a valid TTR.
				 */
				const ttr: Array<DiracDelta> = PlotData.bin_pdf_to_ttr(
					boundary_positions, bin_widths, bin_heights, this.plotting_ttr_order
				);

				/*
				 * Create the binning from the obtained (valid) TTR using the TTR
				 * binning method.
				 */
				[boundary_positions, bin_widths, bin_heights] = PlotData.create_binning(
					ttr, this.plotting_ttr_order, true
				);

				this.positions = boundary_positions;
				this.masses = bin_heights;

				return;
			} catch (error) {
				if (!(error instanceof EvalError || error instanceof TypeError)) {
					throw error;
				}
			}
		}

		/*
		 * For non-TTR input, use the non-uniform binning instead, which places
		 * one bin per Dirac delta with boundaries following the spacing of the
		 * Dirac deltas. This reads the input as a continuous distribution with
		 * no gaps in its support, whereas a uniform-width histogram leaves empty
		 * bins wherever the Dirac deltas are sparser than the bin width.
		 * A binning needs two bins, so it needs two Dirac deltas. The order is
		 * only 0 when the caller asked for a `plotting_resolution` of 2.
		 */
		const reduction_order: number = Math.max(this.plotting_ttr_order, 1);
		if (finite_dirac_deltas.length > 2 ** reduction_order) {
			/*
			 * More Dirac deltas than the plot can resolve. Reduce them to
			 * (2 ** `reduction_order`) of them, which is the same number of Dirac
			 * deltas the valid-TTR path represents the value with, via the same
			 * two steps that path uses: bin the Dirac deltas without assuming a
			 * valid TTR, then take the TTR of that binning. Both steps preserve
			 * the total mass and the mean.
			 */
			const [boundary_positions, bin_widths, bin_heights] = PlotData.create_binning(
				finite_dirac_deltas, 0, false
			);
			try {
				finite_dirac_deltas = PlotData.bin_pdf_to_ttr(
					boundary_positions, bin_widths, bin_heights, reduction_order
				);
			} catch (error) {
				if (!(error instanceof EvalError)) {
					throw error;
				}

				/*
				 * A support only a few ulps wide cannot be split. Merge runs of
				 * neighbouring Dirac deltas instead, into as many as the TTR
				 * would give. Each merge keeps the mass and the mean.
				 */
				finite_dirac_deltas = PlotData._merge_runs(finite_dirac_deltas, 2 ** reduction_order);
			}
		}

		const [boundary_positions, , bin_heights] = PlotData.create_non_uniform_binning(
			finite_dirac_deltas
		);

		this.positions = boundary_positions;
		this.masses = bin_heights;
	}
}

export {
	PlotData,
};

export type { PlottingResolution };
