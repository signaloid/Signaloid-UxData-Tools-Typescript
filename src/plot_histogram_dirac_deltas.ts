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


class PlotData {
	dist: DistributionalValue;
	plotting_resolution: null | number = null;
	plotting_ttr_order: null | number = null;
	_positions: Array<number> = [];
	_masses: Array<number> = [];
	_widths: Array<number> = [];
	_max_value: null | number = null;

	constructor(
		dist: DistributionalValue,
		plotting_resolution?: number
	) {
		if (dist.mean === null || dist.UR_order == 0) {
			throw EvalError("Failed to load data");
		}

		this.dist = dist;
		if (plotting_resolution) {
			this.plotting_resolution = plotting_resolution;
		}

		this._construct_plot_data();
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

		if (w0 === null || isFinite(det) || isNaN(det)) {
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
	 * Constructs the `PlotData`, after parsing the given `DistributionalValue`.
	 * Generates the boundary positions and bin heights, ready for plotting.
	 *
	 * @throws ValueError: When the plotting_resolution is not a power of 2.
	 */
	private _construct_plot_data(): void {
		//@ts-ignore
		if (this.dist.UR_type != "MonteCarlo") {
			/*
			 * Create the list of finite Dirac deltas.
			 */
			this.dist.drop_zero_mass_positions();
		}

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

		/*
		 * Set plot resolution to (N*2) where N is machine representation
		 */
		const machine_representation: number = 2 ** Math.floor(Math.log2(this.dist.UR_order));
		this.plotting_resolution = Math.floor(
			this.plotting_resolution === null ?
				machine_representation * 2 :
				Math.min((machine_representation * 2), this.plotting_resolution)
		)
		const log2_of_plotting_resolution: number = Math.floor(Math.log2(this.plotting_resolution));
		this.plotting_ttr_order = log2_of_plotting_resolution - 1;

		if (
			this.plotting_resolution > 2
			&& this.plotting_resolution > 2 ** (this.plotting_ttr_order + 1)
		) {
			throw EvalError(
				"plot_histogram_dirac_deltas: plotting_resolution must be a power of 2!"
			);
		}

		/*
		 * Create the binning such that the average of two bins surrounding a Dirac delta
		 * is the Dirac delta itself.
		 */
		let [boundary_positions, bin_widths, bin_heights] = PlotData._create_binning(
			finite_dirac_deltas, 0, false
		);

		/*
		 * Find the TTR of the created binning. This is always a valid TTR.
		 */
		const ttr: Array<DiracDelta> = PlotData._bin_pdf_to_ttr(
			boundary_positions, bin_widths, bin_heights, this.plotting_ttr_order
		);

		/*
		 * Create the binning from the obtained (valid) TTR using the TTR binning method.
		 */
		[boundary_positions, bin_widths, bin_heights] = PlotData._create_binning(
			ttr, this.plotting_ttr_order, true
		);

		this.positions = boundary_positions;
		this.masses = bin_heights;
	}
}

export {
	PlotData,
};
