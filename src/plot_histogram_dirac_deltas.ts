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


import { DiracDelta } from './dirac_delta';
import { DistributionalValue } from './distributional';


/** Every power of 2 a request can ask for, from the TTR floor up to `MAX_BINS`. */
type PlottingResolution = 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024;


class PlotData {
	static MAX_BINS: number = 1024;
	private static DISTINCT_POSITION_CAP: number = 8192;

	dist: DistributionalValue;
	plotting_resolution: null | number = null;
	plotting_ttr_order: null | number = null;
	_positions: Array<number> = [];
	_masses: Array<number> = [];
	_widths: Array<number> = [];
	_max_value: null | number = null;

	/**
	 * @param binning `@internal` — `from_samples` hands its pre-built
	 * `[boundary_positions, bin_heights]` through here, skipping
	 * `_construct_plot_data`. Not part of the signaloid-python API.
	 */
	constructor(
		dist: DistributionalValue,
		plotting_resolution?: PlottingResolution,
		binning?: [Array<number>, Array<number>]
	) {
		if (dist.mean === null || dist.UR_order == 0) {
			throw EvalError("Failed to load data");
		}

		this.dist = dist;
		if (plotting_resolution !== undefined) {
			this.plotting_resolution = plotting_resolution;
		}

		if (binning !== undefined) {
			this.positions = binning[0];
			this.masses = binning[1];

			return;
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

		/* Below 2 and for NaN there is no TTR order `_bin_pdf_to_ttr` bottoms out on. */
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
	 * Constructs a `PlotData` from an array of float samples, binning them
	 * into a uniform-width histogram at a resolution capped by `MAX_BINS`.
	 *
	 * Collapses samples onto distinct positions, then takes the ordinary route.
	 *
	 * @param samples The float samples, which may contain NaN and +/-Inf.
	 * @param plotting_resolution The number of bins, a power of 2. Determined
	 * from the sample count when not given.
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
		if (samples.length === 0) {
			throw EvalError("samples array must not be empty.");
		}

		const mass_per_sample: number = 1 / samples.length;
		let nan_mass: number = 0;
		let neg_inf_mass: number = 0;
		let pos_inf_mass: number = 0;
		let pos_min: number = Number.POSITIVE_INFINITY;
		let pos_max: number = Number.NEGATIVE_INFINITY;
		let total_weighted_position: number = 0;
		let total_mass: number = 0;
		const distinct_positions: Map<number, number> = new Map();
		let distinct_overflowed: boolean = false;

		for (let i = 0; i < samples.length; i++) {
			const position: number = samples[i];
			total_weighted_position += position * mass_per_sample;
			total_mass += mass_per_sample;

			if (Number.isFinite(position)) {
				if (position < pos_min) {
					pos_min = position;
				}
				if (position > pos_max) {
					pos_max = position;
				}

				if (!distinct_overflowed) {
					const seen: undefined | number = distinct_positions.get(position);
					if (seen !== undefined) {
						distinct_positions.set(position, seen + mass_per_sample);
					} else if (distinct_positions.size < PlotData.DISTINCT_POSITION_CAP) {
						distinct_positions.set(position, mass_per_sample);
					} else {
						distinct_overflowed = true;
					}
				}
			} else if (Number.isNaN(position)) {
				nan_mass += mass_per_sample;
			} else if (position === Number.NEGATIVE_INFINITY) {
				neg_inf_mass += mass_per_sample;
			} else {
				pos_inf_mass += mass_per_sample;
			}
		}

		const has_special_values: boolean = (
			nan_mass > 0 || neg_inf_mass > 0 || pos_inf_mass > 0
		);
		const special_deltas: Array<DiracDelta> = ([
			[Number.NaN, nan_mass],
			[Number.NEGATIVE_INFINITY, neg_inf_mass],
			[Number.POSITIVE_INFINITY, pos_inf_mass],
		] as Array<[number, number]>)
			.filter(([, mass]) => mass > 0)
			.map(([position, mass]) => new DiracDelta({ position, mass }));

		if (!distinct_overflowed) {
			const dirac_deltas: Array<DiracDelta> = [];
			for (const [position, mass] of distinct_positions) {
				dirac_deltas.push(new DiracDelta({ position, mass }));
			}

			const dist: DistributionalValue = new DistributionalValue({
				dirac_deltas: dirac_deltas.concat(special_deltas)
			});
			dist.mean = total_weighted_position / total_mass;

			return new PlotData(dist, plotting_resolution);
		}

		/* ponytail: above the cap the resolution is pinned to MAX_BINS, so no TTR gate applies. */
		const resolution: PlottingResolution = PlotData._resolve_plotting_resolution(
			PlotData.DISTINCT_POSITION_CAP + (has_special_values ? 3 : 0),
			plotting_resolution === undefined ? null : plotting_resolution
		);
		const [boundary_positions, bin_heights] = PlotData._uniform_histogram(
			samples, mass_per_sample, pos_min, pos_max, resolution
		);

		const dirac_deltas: Array<DiracDelta> = [];
		for (let i = 0; i < bin_heights.length; i++) {
			const bin_mass: number = bin_heights[i] * (
				boundary_positions[i + 1] - boundary_positions[i]
			);
			if (bin_mass > 0) {
				dirac_deltas.push(new DiracDelta({
					position: (boundary_positions[i] + boundary_positions[i + 1]) / 2,
					mass: bin_mass
				}));
			}
		}

		const dist: DistributionalValue = new DistributionalValue({
			dirac_deltas: dirac_deltas.concat(special_deltas)
		});
		dist.sort();
		dist.mean = total_weighted_position / total_mass;

		const plot_data: PlotData = new PlotData(
			dist, resolution, [boundary_positions, bin_heights]
		);
		plot_data.plotting_ttr_order = Math.floor(Math.log2(resolution)) - 1;

		return plot_data;
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
	 */
	get max_value(): number {
		if (this._max_value === null) {
			this._max_value = Math.max(...this._masses);
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
	 * 		sorted positions.
	 * 	exponent: The TTR order, i.e., the base-2 logarithm of the number of
	 * 		Dirac deltas in the TTR. The number of bins in the output binning
	 * 		is twice the number of Dirac deltas in the TTR.
	 * 	use_ttr_binning: Flag specifying whether to use the TTR binning method.
	 * Returns:
	 * 	(boundary_positions, boundary_probabilities): The internal boundary positions
	 * 		and boundary probabilities that are intermediaries to get a binning.
	 */
	private static _determine_boundary_positions(
		finite_sorted_dirac_deltas: Array<DiracDelta>,
		exponent: number,
		use_ttr_binning: boolean
	): [Array<number>, Array<number>] {
		const number_of_finite_dirac_deltas: number = finite_sorted_dirac_deltas.length;
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

				if (root1 > 0 && root2 > 0) {
					w0 = Math.min(root1, root2);
				} else if (root1 > 0 || root2 > 0) {
					w0 = Math.max(root1, root2);
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
	 * 		and sorted positions.
	 * 	exponent: The TTR order, i.e., the base-2 logarithm of the number of
	 * 		Dirac deltas in the TTR. The number of bins in the output binning
	 * 		is twice the number of Dirac deltas in the TTR.
	 * 	use_ttr_binning: Flag specifying whether to use the TTR binning method.
	 * Returns:
	 * 	(boundary_positions, bin_widths, bin_heights): The boundary positions,
	 * 		bin widths, and bin heights that describe the output binning.
	 */
	private static _create_binning(
		finite_sorted_dirac_deltas: Array<DiracDelta>,
		exponent: number,
		use_ttr_binning: boolean
	): [Array<number>, Array<number>, Array<number>] {
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
	 * Computes the expected Dirac delta of an input bin PDF.
	 *
	 * Args:
	 * 	boundary_positions: Positions of bin boundaries of the input bin PDF.
	 * 	bin_widths: Widths of the bins of the input bin PDF.
	 * 	bin_heights: Heights of the bins of the input bin PDF.
	 * Returns:
	 * 	expected_dirac_delta: The expected Dirac delta in the format np.array([position, mass]).
	 */
	private static _bin_pdf_expected_dirac_delta(
		boundary_positions: Array<number>,
		bin_widths: Array<number>,
		bin_heights: Array<number>
	): DiracDelta {
		let moment_sum: number = 0.0;
		let probability_sum: number = 0.0;

		for (let i = 0; i < bin_widths.length; i++) {
			const probability: number = bin_widths[i] * bin_heights[i];
			probability_sum += probability;
			moment_sum += (
				probability * (boundary_positions[i + 1] + boundary_positions[i]) / 2
			);
		}

		const expected_dirac_delta: DiracDelta = new DiracDelta({
			position: moment_sum / probability_sum,
			mass: probability_sum
		});

		return expected_dirac_delta
	}

	/**
	 *
	 * Computes TTR for an input bin PDF.
	 *
	 * Args:
	 * 	boundary_positions: Positions of the bin boundaries of the input bin PDF.
	 * 	bin_widths: Widths of the bins of the input bin PDF.
	 * 	bin_heights: Heights of the bins of the input bin PDF.
	 * 	order: TTR order.
	 * Returns:
	 * 	ttr: The TTR of the input bin PDF, a (2 ** `order`)-length array of Dirac deltas
	 * 		with each Dirac delta of the form np.array([position, mass]).
	 */
	private static _bin_pdf_to_ttr(
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

		for (const [i, boundary_position] of boundary_positions.entries()) {
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
				low_boundary_positions = [
					...boundary_positions.slice(0, i), expected_dirac_delta.position
				];
				low_bin_widths = [
					...bin_widths.slice(0, i - 1),
					expected_dirac_delta.position - boundary_positions[i - 1],
				];
				low_bin_heights = bin_heights.slice(0, i);
				high_boundary_positions = [
					expected_dirac_delta.position,
					...boundary_positions.slice(i)
				];
				high_bin_widths = [
					boundary_position - expected_dirac_delta.position,
					...bin_widths.slice(i)
				];
				high_bin_heights = bin_heights.slice(i - 1);
				break;
			}
		}

		ttr = ttr.concat(PlotData._bin_pdf_to_ttr(
			low_boundary_positions, low_bin_widths, low_bin_heights, order - 1
		));
		ttr = ttr.concat(PlotData._bin_pdf_to_ttr(
			high_boundary_positions, high_bin_widths, high_bin_heights, order - 1
		));

		return ttr;
	}

	/**
	 * Bins the given positions into `resolution` equal-width bins spanning
	 * [`pos_min`, `pos_max`], following `np.histogram`'s bin lookup to match
	 * signaloid-python's edges exactly. Non-finite positions are skipped.
	 *
	 * @param masses The mass of each position, or one mass shared by all of them.
	 *
	 * @returns `[boundary_positions, bin_heights]`: the bin edges, and the
	 * binned mass divided by the bin width.
	 */
	private static _uniform_histogram(
		positions: ArrayLike<number>,
		masses: ArrayLike<number> | number,
		pos_min: number,
		pos_max: number,
		resolution: number
	): [Array<number>, Array<number>] {
		/* `np.linspace` places every edge but the last at `pos_min + i * step`. */
		const step: number = (pos_max - pos_min) / resolution;
		const boundary_positions: Array<number> = Array.from(
			{ length: resolution + 1 }, (_, i) => pos_min + i * step
		);
		boundary_positions[resolution] = pos_max;

		const binned_masses: Array<number> = Array(resolution).fill(0);
		const norm: number = resolution / (pos_max - pos_min);
		for (let i = 0; i < positions.length; i++) {
			const position: number = positions[i];
			if (!Number.isFinite(position)) {
				continue;
			}

			/* `np.histogram`'s scaled index, then its correction against the edges. */
			let bin: number = Math.trunc((position - pos_min) * norm);
			if (bin >= resolution) {
				bin = resolution - 1;
			}
			if (position < boundary_positions[bin]) {
				bin -= 1;
			} else if (position >= boundary_positions[bin + 1] && bin !== resolution - 1) {
				bin += 1;
			}

			binned_masses[bin] += typeof masses === "number" ? masses : masses[i];
		}

		const bin_heights: Array<number> = binned_masses.map((mass, i) => {
			const bin_width: number = boundary_positions[i + 1] - boundary_positions[i];
			return bin_width !== 0 ? mass / bin_width : 0;
		});

		return [boundary_positions, bin_heights];
	}

	/**
	 * Constructs the `PlotData`, after parsing the given `DistributionalValue`.
	 * Generates the boundary positions and bin heights, ready for plotting.
	 *
	 * @throws ValueError: When the plotting_resolution is not a power of 2.
	 */
	private _construct_plot_data(): void {
		this.dist.drop_zero_mass_positions();

		this.dist.combine_dirac_deltas()

		/*
		 * Create the list of finite sorted Dirac deltas.
		 * Last three positions are for non-finite values
		 */
		const finite_dirac_deltas: Array<DiracDelta> = this.dist.finite_dirac_deltas;

		/*
		 * If no finite Dirac deltas found, then return.
		 */
		if (finite_dirac_deltas.length == 0) {
			console.warn("No Dirac Deltas found.");
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

		if (this.dist.check_is_full_valid_TTR()) {
			try {
				let [boundary_positions, bin_widths, bin_heights] = PlotData._create_binning(
					finite_dirac_deltas, 0, false
				);

				const ttr: Array<DiracDelta> = PlotData._bin_pdf_to_ttr(
					boundary_positions, bin_widths, bin_heights, this.plotting_ttr_order
				);

				[boundary_positions, bin_widths, bin_heights] = PlotData._create_binning(
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

		/* TTR binning on deltas that are not a valid TTR gives meaningless boundaries. */
		const positions: Array<number> = finite_dirac_deltas.map(dd => dd.position);
		const masses: Array<number> = finite_dirac_deltas.map(dd => dd.mass);
		const [boundary_positions, bin_heights] = PlotData._uniform_histogram(
			positions,
			masses,
			positions[0],
			positions[positions.length - 1],
			this.plotting_resolution
		);

		this.positions = boundary_positions;
		this.masses = bin_heights;
	}
}

export {
	PlotData,
};

export type { PlottingResolution };
