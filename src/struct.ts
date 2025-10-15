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


const isBigEndianDict: { [key: string]: boolean; } = {
	'@': true,
	'=': true,
	'<': false,
	'>': true,
	'!': true,
};

function checkIsBigEndian(char: string): boolean {
	return char === '' || isBigEndianDict[char];
}

const bufferTypeDict: { [key: string]: any } = {
	'c': Int8Array,
	'b': Int8Array,
	'B': Uint8Array,
	'h': Int8Array,
	'H': Uint8Array,
	'i': Int32Array,
	'I': Uint32Array,
	'l': Int32Array,
	'L': Uint32Array,
	'q': BigInt64Array,
	'Q': BigUint64Array,
	'f': Float32Array,
	'd': Float64Array,
};

const bufferTypeSizeDict: { [key: string]: number } = {
	'c': 1,
	'b': 1,
	'B': 1,
	'h': 1,
	'H': 1,
	'i': 4,
	'I': 4,
	'l': 4,
	'L': 4,
	'q': 8,
	'Q': 8,
	'f': 4,
	'd': 8,
};

const dataViewGetTypeDict: { [key: string]: string } = {
	'c': 'getInt8',
	'b': 'getInt8',
	'B': 'getUint8',
	'h': 'getInt8',
	'H': 'getUint8',
	'i': 'getInt32',
	'I': 'getUint32',
	'l': 'getInt32',
	'L': 'getUint32',
	'q': 'getBigInt64',
	'Q': 'getBigUint64',
	'f': 'getFloat32',
	'd': 'getFloat64',
};

const dataViewSetTypeDict: { [key: string]: string } = {
	'c': 'setInt8',
	'b': 'setInt8',
	'B': 'setUint8',
	'h': 'setInt8',
	'H': 'setUint8',
	'i': 'setInt32',
	'I': 'setUint32',
	'l': 'setInt32',
	'L': 'setUint32',
	'q': 'setBigInt64',
	'Q': 'setBigUint64',
	'f': 'setFloat32',
	'd': 'setFloat64',
};

const endiannessChars: string = Object.keys(isBigEndianDict).join('');
const bufferTypeChars: string = Object.keys(bufferTypeDict).join('');
const pattern = new RegExp(`(?<endian>[${endiannessChars}]*)(?<count>[0-9]*)(?<type>[${bufferTypeChars}])`, 'g');

/**
 * Creates an array of bytes containing the values in the `arr` packed according
 * to the format string `format`. The arguments must match the values required by
 * the format exactly.
 *
 * This is used to imitate the functionality of the Python's `struct.pack` method.
 *
 * @param format The format string of the array of values `arr`.
 * @param arr The array of values to be packed.
 *
 * @returns An array of bytes containing the values of `arr` packed according
 * to the format string `format`.
 */
function pack(format: string, arr: Array<null | number>): null | Array<number> {
	const groups: Array<RegExpMatchArray> = [...format.matchAll(pattern)];

	if (!groups.length) {
		console.warn("Format unreadable.");
		return null;
	}

	let res: Array<number> = [];
	let arrIndex: number = 0;
	for (const g of groups) {
		if (g.groups === undefined) {
			console.warn("Format matching error.");
			return [];
		}

		const isBigEndian: boolean = checkIsBigEndian(g.groups['endian']);
		const count: number = g.groups['count'] ? parseInt(g.groups['count']) : 1;
		const bufferType = bufferTypeDict[g.groups['type']];
		const value_size = bufferTypeSizeDict[g.groups['type']];
		const setType = dataViewSetTypeDict[g.groups['type']];

		for (let i = 0; i < count; i++) {
			const bf = new Uint8Array(value_size);
			const dv = new DataView(bf.buffer);

			let num: null | number | BigInt = arr[arrIndex];
			arrIndex++;
			if (num === null) {
				num = 0;
			}
			if (bufferType === BigInt64Array || bufferType === BigUint64Array) {
				num = BigInt(num);
			}

			//@ts-ignore
			dv[setType](0, num);
			const bytes = Array.from(new Uint8Array(dv.buffer));

			if (!isBigEndian) {
				bytes.reverse();
			}

			res = res.concat(bytes);
		}
	}

	return res;
}

/**
 * Unpack from the buffer `buffer` (presumably packed by pack(format, ...))
 * according to the format string format. The result is a tuple even if it
 * contains exactly one item. The buffer’s size in bytes must match the size
 * required by the format.
 *
 * @param format The format string of the buffer `buffer`.
 * @param buffer
 * @returns
 */
function unpack(format: string, buffer: Array<number>): null | Array<number> {
	const groups: Array<RegExpMatchArray> = [...format.matchAll(pattern)];

	if (!groups.length) {
		console.warn("Format unreadable.");
		return null;
	}

	let res: Array<number> = [];
	let bufferIndex: number = 0;
	for (const g of groups) {
		if (g.groups === undefined) {
			console.warn("Format matching error.");
			return [];
		}

		const isBigEndian: boolean = checkIsBigEndian(g.groups['endian'])
		const count: number = g.groups['count'] ? parseInt(g.groups['count']) : 1;
		const value_size: number = bufferTypeSizeDict[g.groups['type']];
		const getType = dataViewGetTypeDict[g.groups['type']];
		for (let i = 0; i < count; i++) {
			if (bufferIndex + value_size > buffer.length) {
				console.warn("Format string does not match the given buffer.");
				return null;
			}

			let value_buffer_raw: Array<number> =
				[...buffer.slice(bufferIndex, bufferIndex + value_size)]
			bufferIndex += value_size;

			if (!isBigEndian) {
				value_buffer_raw.reverse();
			}

			const value_buffer_uint = new Uint8Array([...value_buffer_raw]);
			const dv = new DataView(value_buffer_uint.buffer);
			//@ts-ignore
			const value = dv[getType](0);

			res.push(value);
		}
	}

	if (bufferIndex !== buffer.length) {
		console.warn("Format string does not match the given buffer.");
		return null;
	}

	return res;
}

export {
	pack,
	unpack,
};
