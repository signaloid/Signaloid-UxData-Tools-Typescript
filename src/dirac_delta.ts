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


/*
 * Use this multiplier to convert to/from floating point to fixed point masses
 */
const FIXED_POINT_ONE: number = 0x8000000000000000;


class DiracDelta {
	position: number = 0;
	_raw_mass: number = 0;
	_mass: number = 0;

	/**
	 * Initializes the Dirac Delta, given a position, and a mass in either
	 * a fixed-point or a floating point representation. If both representations
	 * are given, the fixed-point one will be used, and the floating-point one
	 * will be ignored.
	 *
	 * @param position The Dirac Delta position.
	 * @param raw_mass The Dirac Delta mass in 64bit fixed-point representation,
	 * defaults to null.
	 * @param mass The Dirac Delta mass in floating-point representation,
	 * defaults to null.
	 */
	constructor(options: {
		position: number,
		raw_mass?: number,
		mass?: number
	}) {
		this.position = options.position;

		if (options.raw_mass !== undefined) {
			this.raw_mass = options.raw_mass;
		} else if (options.mass !== undefined) {
			this.mass = options.mass;
		}
	}

	/**
	 * The Dirac Delta mass in 64bit fixed-point representation.
	 *
	 * @returns The mass
	 */
	get raw_mass(): number {
		return this._raw_mass;
	}

	/**
	 * Sets the Dirac Delta mass given a 64bit fixed-point mass.
	 *
	 * @param value The 64bit fixed-point mass to use.
	 */
	set raw_mass(value: number) {
		this._raw_mass = value;

		/*
		 * The probability mass is a fixed-point format with FIXED_POINT_ONE
		 * representing 1.0. Dividing by FIXED_POINT_ONE gets the number it
		 * represents.
		 */
		this._mass = Number(value) / FIXED_POINT_ONE;
	}

	/**
	 * The Dirac Delta mass in floating-point representation.
	 *
	 * @returns The mass
	 */
	get mass(): number {
		return this._mass;
	}

	/**
	 * Sets the Dirac Delta mass given a floating-point mass.
	 *
	 * @param value The floating-point mass to use.
	 */
	set mass(value: number) {
		this._mass = value;

		if (Number.isNaN(this._mass)) {
			this._raw_mass = 0;
		} else {
			/*
			 * The probability mass is a fixed-point format with FIXED_POINT_ONE
			 * representing 1.0. Multiplying by FIXED_POINT_ONE gets the fixed point
			 * it represents.
			 */
			this._raw_mass = Number(value * FIXED_POINT_ONE);
		}
	}

	/**
	 * Adds two Dirac Delta generating a new one, combining the two positions,
	 * and masses.
	 *
	 * @param other The second Dirac Delta to use for adding.
	 * @returns A new Dirac Delta, with combined position, and mass.
	 */
	public add(other: DiracDelta): DiracDelta {
		const combined_mass: number = this.mass + other.mass;
		const combined_position: number = (
			this.position * this.mass
			+ other.position * other.mass
		) / combined_mass;

		return new DiracDelta({ position: combined_position, mass: combined_mass });
	}

	/**
	 * Checks if this Dirac Delta is less than the given Dirac Delta.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @returns `True` if this Dirac Delta is less than the given Dirac Delta,
	 * `False` otherwise.
	 */
	public lt(other: DiracDelta): boolean {
		return this.position < other.position;
	}

	/**
	 * Checks if this Dirac Delta is less than or equal to the given Dirac Delta.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @returns `True` if this Dirac Delta is less than or equal to the given
	 * Dirac Delta, `False` otherwise.
	 */
	public le(other: DiracDelta): boolean {
		return this.position <= other.position;
	}

	/**
	 * Checks if this Dirac Delta is equal to the given Dirac Delta.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @returns `True` if this Dirac Delta is equal to the given Dirac Delta,
	 * `False` otherwise.
	 */
	public eq(other: DiracDelta): boolean {
		return this.position == other.position;
	}

	/**
	 * Checks if this Dirac Delta is not equal to the given Dirac Delta.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @returns `True` if this Dirac Delta is not equal to the given Dirac Delta,
	 * `False` otherwise.
	 */
	public ne(other: DiracDelta): boolean {
		return this.position != other.position;
	}

	/**
	 * Checks if this Dirac Delta is greater than the given Dirac Delta.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @returns `True` if this Dirac Delta is greater than the given Dirac Delta,
	 * `False` otherwise.
	 */
	public ge(other: DiracDelta): boolean {
		return this.position >= other.position;
	}

	/**
	 * Checks if this Dirac Delta is greater than or equal to the given Dirac Delta.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @returns `True` if this Dirac Delta is greater than or equal to the given
	 * Dirac Delta, `False` otherwise.
	 */
	public gt(other: DiracDelta): boolean {
		return this.position > other.position;
	}

	static comparator(a: DiracDelta, b: DiracDelta): number {
		if (a.lt(b)) {
			return -1;
		}

		if (a.gt(b)) {
			return 1;
		}

		return 0;
	}

	/**
	 * Creates a string representation of the Dirac Delta.
	 *
	 * @returns The string representation.
	 */
	public toString(): string {
		return `[${this.position}, ${this.mass}]`;
	}

	/**
	 * Checks if this Dirac Delta and the given one are similar to each other,
	 * based on the given threshold.
	 *
	 * @param other The second Dirac Delta to use for the comparison.
	 * @param threshold The threshold to use for the comparison
	 * @returns `True` if similar, `False` otherwise.
	 */
	public similar(other: DiracDelta, threshold: number): boolean {
		return Math.abs(this.position - other.position) <= threshold;
	}

	/**
	 * Checks if the Dirac Delta is has a finite position.
	 *
	 * @returns `True` is the Dirac Delta position is finite, `False` otherwise.
	 */
	public isFinite(): boolean {
		return Number.isFinite(this.position)
	}
}

export {
	DiracDelta
}
