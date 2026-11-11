/*
 *	Copyright (c) 2026, Signaloid.
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


/**
 * `np.sum`'s pairwise summation, so that sums round exactly as they do in
 * signaloid-data-toolkit: blocks of up to 128 values are summed in 8
 * interleaved partial sums, and longer runs are split in halves at a
 * multiple of 8.
 *
 * @param values The values to sum.
 * @param start The index of the first value to sum.
 * @param count The number of values to sum.
 *
 * @returns The sum of the run.
 */
function pairwise_sum_of_run(values: ArrayLike<number>, start: number, count: number): number {
	if (count < 8) {
		let sum: number = 0;
		for (let i = 0; i < count; i++) {
			sum += values[start + i];
		}

		return sum;
	}

	if (count <= 128) {
		const partial_sums: Array<number> = [];
		for (let j = 0; j < 8; j++) {
			partial_sums.push(values[start + j]);
		}

		let i: number = 8;
		for (; i < count - (count % 8); i += 8) {
			for (let j = 0; j < 8; j++) {
				partial_sums[j] += values[start + i + j];
			}
		}

		let sum: number = (
			((partial_sums[0] + partial_sums[1]) + (partial_sums[2] + partial_sums[3]))
			+ ((partial_sums[4] + partial_sums[5]) + (partial_sums[6] + partial_sums[7]))
		);
		for (; i < count; i++) {
			sum += values[start + i];
		}

		return sum;
	}

	let half: number = Math.floor(count / 2);
	half -= half % 8;

	return pairwise_sum_of_run(values, start, half) + pairwise_sum_of_run(values, start + half, count - half);
}

/**
 * `np.sum`: the pairwise sum added to the identity of addition, +0.0, as
 * `np.add.reduce` does. The identity only changes a sum of negative zeros,
 * which it makes +0.0.
 *
 * @param values The values to sum.
 *
 * @returns The sum.
 */
function pairwise_sum(values: ArrayLike<number>): number {
	return 0.0 + pairwise_sum_of_run(values, 0, values.length);
}

export {
	pairwise_sum,
};
