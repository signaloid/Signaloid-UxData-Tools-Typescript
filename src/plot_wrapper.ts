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


import { PlotData } from './plot_histogram_dirac_deltas';
import * as echarts from 'echarts';


/* Single quotes: double ones break the ECharts SVG output. */
const kFontFamily = "'IBM Plex Sans', Helvetica, Roboto, sans-serif";
const kBlack = "#000";
const kGridLineColor = "rgba(0, 0, 0, 0.25)";
const kTickLabelSize = 13;
const kAxisNameSize = 14;
const kMeanColor = "rgb(0, 100, 0)";
const kMeanLabel = "E(X)";
const kYAxisHeadroom = 1.1;
const kXAxisRangePadding = 0.05;
/* Quantiles that bound a shared x range, so that Monte Carlo tails do not stretch it. */
const kRangeLowerQuantile = 0.005;
const kRangeUpperQuantile = 0.995;
const kXAxisName = "Distribution Support";
const kYAxisName = "Probability Density";
const kSpecialValuesYAxisName = "Probability Amplitude";
/* matplotlib's `Locator.nonsingular` widening of equal limits. */
const kNonsingularExpander = 0.05;

const kSupportFrame = { color: kBlack, width: 2 };
const kDensityFrame = { color: "rgba(0, 0, 0, 0.35)", width: 1 };

const kPlotGrid = { top: 12, bottom: 48, left: 80, right: 16 };
const kAxisNameGap = { x: 30, y: 52, specialValuesY: 45 };
const kSpecialValuesGutter = "30%";
const kSpecialValuesWidth = "16%";

/** Width to height, matching the plots the backend serves. */
const distributionPlotAspectRatio = 1.69;

/**
 * Per-plot options of `signaloidChartOption` and `signaloidChartMount`. The
 * ones signaloid-data-toolkit's `plot()` also has keep its defaults.
 */
type SignaloidChartOptions = {
	/** The x axis name, `x_label` in signaloid-data-toolkit. Empty gives the default. */
	xAxisName?: string;
	/** The y axis name. Empty gives the default. */
	yAxisName?: string;
	/** The x range. Without it, the support and the mean set it. */
	xlim?: [number, number];
	/** The y range. Without it, the maximum density sets it. */
	ylim?: [number, number];
	/** The power of 10 the y tick labels are divided by. 0 draws no header. */
	offsetExponent?: number;
};


/* Renderers */
const binStyle_default = () => ({
	fill: "rgba(0, 128, 0, 0.3)",
	stroke: "rgba(0, 128, 0, 0.6)",
	lineWidth: 0.6,
});


function binRenderer(_: any, api: any) {
	/*
	 * Shape of each bin
	 */
	const boundaryPosition = api.value(0);
	const boundaryPositionN = api.value(1);
	const binHeight = api.value(2);

	/* Opposite corners, so that a reversed `xlim` or `ylim` draws the bin too. */
	const corner = api.coord([boundaryPosition, 0]);
	const oppositeCorner = api.coord([boundaryPositionN, binHeight]);

	/*
	 * Bin styling
	 */
	const style = binStyle_default();
	//@ts-ignore
	style.decal = api.visual("decal");

	return {
		type: "rect",
		shape: {
			x: Math.min(corner[0], oppositeCorner[0]),
			y: Math.min(corner[1], oppositeCorner[1]),
			width: Math.abs(oppositeCorner[0] - corner[0]),
			height: Math.abs(oppositeCorner[1] - corner[1]),
		},
		style: style,
	};
}

const diracDeltaStyle_default = () => ({
	stroke: "#000000",
	lineWidth: 3,
});

function diracDeltaRenderer(_: any, api: any) {
	const diracDeltaPosition = api.value(0);
	const diracDeltaMass = api.value(1);
	const points = [
		api.coord([diracDeltaPosition, 0]),
		api.coord([diracDeltaPosition, diracDeltaMass]),
	];

	return {
		type: "polyline",
		shape: {
			points: points,
		},
		style: diracDeltaStyle_default(),
	};
}

function diracDeltaArrowRenderer(_: any, api: any) {
	const diracDeltaPosition = api.value(0);
	const position = api.coord([diracDeltaPosition, api.value(1)]);

	/* Point away from the baseline, which a reversed `ylim` puts above the tip. */
	const direction: number = api.coord([diracDeltaPosition, 0])[1] >= position[1] ? 1 : -1;

	return {
		type: "polygon",
		x: position[0],
		y: position[1],
		shape: {
			points: [
				[0, 0],
				[-6, 10 * direction],
				[6, 10 * direction],
			],
		},
		style: diracDeltaStyle_default(),
	};
}

const frame_default = (frame: { color: string, width: number }) => {
	const lineStyle = { type: "solid" as const, ...frame };

	return {
		axisLine: { show: true, onZero: false, lineStyle: lineStyle },
		axisTick: { show: true, inside: true, lineStyle: lineStyle },
		minorTick: { show: true, lineStyle: { ...lineStyle, width: 1 } },
	};
};

const splitLine_default = () => ({
	lineStyle: {
		type: "dashed" as const,
		color: kGridLineColor,
	},
});

const axisNameTextStyle_default = () => ({
	align: "center" as const,
	color: kBlack,
	fontSize: kAxisNameSize,
});

const axisLabel_default = () => ({
	fontSize: kTickLabelSize,
	color: kBlack,
});

const numericAxisLabel_default = (exponent: number = 0) => ({
	...axisLabel_default(),
	showMaxLabel: false,
	formatter: plainLabel(exponent),
});

/**
 * The y axis maximum `signaloidChartOption` derives, headroom included. A value
 * with no finite Dirac delta keeps matplotlib's empty [0, 1] axis.
 */
function densityAxisMaximum(plot_data: PlotData): number {
	if (plot_data.masses.length === 0) {
		return 1;
	}

	return plot_data.max_value > 0 ? plot_data.max_value * kYAxisHeadroom : kYAxisHeadroom;
}

/**
 * The limits an axis is set to, checked and widened as matplotlib's
 * `set_xlim` and `set_ylim` do. Equal limits `v` become `v -/+ 0.05 * |v|`,
 * or -0.05 and 0.05 at 0.
 *
 * @param limits The lower and upper limit.
 *
 * @returns The limits, widened when they are equal.
 *
 * @throws EvalError: When a limit is NaN or +/-Inf.
 */
function axisLimits(limits: [number, number]): [number, number] {
	if (!Number.isFinite(limits[0]) || !Number.isFinite(limits[1])) {
		throw EvalError("Axis limits cannot be NaN or Inf");
	}
	if (limits[0] !== limits[1]) {
		return limits;
	}

	const widening: number = kNonsingularExpander * (limits[0] === 0 ? 1 : Math.abs(limits[0]));

	return [limits[0] - widening, limits[1] + widening];
}

/**
 * The axis facts two or more plots should all draw on, shaped to spread into
 * `signaloidChartOption`'s chart options. The x range is the union of each
 * input's trimmed support, padded 5% each side. An input whose trimmed support
 * is not finite contributes nothing, and with no finite support at all `xlim`
 * is omitted. This has no counterpart in signaloid-data-toolkit: it began as
 * a port of the benchmarking module's `_compute_shared_xlim`, which has since
 * been removed. That trimmed only adversary distributions, whereas this trims
 * every input because this API has no adversary concept.
 *
 * @param plot_datas The plots that should share their axes.
 *
 * @returns The shared `xlim`, `ylim`, and `offsetExponent`.
 */
function sharedAxes(plot_datas: Array<PlotData>): SignaloidChartOptions {
	if (plot_datas.length === 0) {
		return {};
	}

	let min_x: number = Number.POSITIVE_INFINITY;
	let max_x: number = Number.NEGATIVE_INFINITY;
	for (const plot_data of plot_datas) {
		const low: number = plot_data.dist.inverse_cdf(kRangeLowerQuantile);
		const high: number = plot_data.dist.inverse_cdf(kRangeUpperQuantile);

		if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) {
			continue;
		}

		min_x = Math.min(min_x, low);
		max_x = Math.max(max_x, high);
	}

	const y_max: number = Math.max(...plot_datas.map(densityAxisMaximum));
	const options: SignaloidChartOptions = {
		ylim: [0, y_max],
		offsetExponent: offsetExponent(y_max),
	};

	if (Number.isFinite(min_x) && Number.isFinite(max_x)) {
		const range_spacing: number = kXAxisRangePadding * (max_x - min_x);
		options.xlim = [min_x - range_spacing, max_x + range_spacing];
	}

	return options;
}

function offsetExponent(max: number): number {
	if (!(max > 0)) {
		return 0;
	}

	const exponent = Math.floor(Math.log10(max));

	/* Below this the raw labels are shorter than the header. */
	return Math.abs(exponent) < 3 ? 0 : exponent;
}

/* ECharts 6 renders `130000` as `130,000`. */
function plainLabel(exponent: number) {
	const scale = 10 ** exponent;

	return (value: number) => String(Number((value / scale).toPrecision(6)));
}

/*
 * An x tick label in full. Rounding at the 15th significant digit of the axis
 * magnitude drops the float error of ECharts' ticks, and the decimal string
 * carries the power of ten, which `toFixed` cannot from 1e21.
 */
function fullLabel(limits: [number, number]) {
	/* Never 0, as `axisLimits` widens equal limits. */
	const magnitude: number = Math.max(Math.abs(limits[0]), Math.abs(limits[1]));
	/* 10 ** 308 is the largest finite power of ten. */
	const unit_oom: number = Math.max(Math.floor(Math.log10(magnitude)) - 14, -308);

	return (value: number) => {
		/* Divides or multiplies by an exact power of ten. */
		const units: number = unit_oom >= 0
			? Math.round(value / 10 ** unit_oom)
			: Math.round(value * 10 ** -unit_oom);

		/* `${-0}` is "0". */
		return String(Number(`${units}e${unit_oom}`));
	};
}

/**
 * The ECharts bounds of an axis drawn from `limits[0]` to `limits[1]`. ECharts
 * takes ascending bounds and reverses an axis with `inverse`, so a descending
 * pair, as matplotlib's `set_xlim(10, 0)` takes it, becomes ascending bounds
 * on an inverted axis.
 *
 * @param limits The limits, in the order the axis should run.
 *
 * @returns The `min`, `max`, and `inverse` axis options.
 */
function axisBounds(limits: [number, number]): { min: number, max: number, inverse: boolean } {
	return {
		min: Math.min(limits[0], limits[1]),
		max: Math.max(limits[0], limits[1]),
		inverse: limits[0] > limits[1],
	};
}

function mirroredAxis(axis: any, position: string) {
	return {
		type: axis.type,
		data: axis.data,
		gridIndex: axis.gridIndex,
		position: position,
		min: axis.min,
		max: axis.max,
		inverse: axis.inverse,
		axisLine: axis.axisLine,
		axisTick: axis.axisTick,
		minorTick: axis.minorTick,
		axisLabel: { show: false },
		splitLine: { show: false },
	};
}

/* Default options */
const distributionYAxis_default = (
	max: number,
	name: string = kYAxisName,
	min: number = 0,
	exponent: number = offsetExponent(max)
): echarts.YAXisComponentOption => ({
	type: "value",
	name: name,
	gridIndex: 0,
	nameLocation: "middle",
	nameTextStyle: axisNameTextStyle_default(),
	nameGap: kAxisNameGap.y,
	min: min,
	max: max,
	...frame_default(kDensityFrame),
	splitLine: splitLine_default(),
	axisLabel: numericAxisLabel_default(exponent),
});

const meanMarkLine_default = () => ({
	symbol: "none",
	/* ECharts otherwise rounds the line's position to 2 decimals, as matplotlib's `axvline` does not. */
	precision: -1,
	data: [
		{
			name: kMeanLabel,
			label: {
				show: true,
				position: "insideEndTop",
				distance: 10,
				formatter: "{b}",
				color: kMeanColor,
				fontSize: kTickLabelSize,
				textBorderColor: "#fff",
				textBorderWidth: 2,
			},
			tooltip: {
				show: false,
			},
		},
	],
	lineStyle: {
		color: kMeanColor,
		type: "solid",
		width: 1.5,
	},
	emphasis: {
		disabled: false,
		label: {
			triggerTooltip: false,
		},
	},
	animation: false,
});

const distributionPlotSeries_diracDelta_default = () => ([
	{
		xAxisIndex: 0,
		yAxisIndex: 0,
		type: "custom",
		clip: true,
		renderItem: diracDeltaArrowRenderer,
		tooltip: {
			show: false,
		},
		itemStyle: {
			color: "#000",
			borderWidth: 3,
		},
	},
	{
		xAxisIndex: 0,
		yAxisIndex: 0,
		type: "custom",
		clip: true,
		renderItem: diracDeltaRenderer,
		tooltip: {
			show: false,
		},
		itemStyle: {
			color: "#000",
			borderWidth: 3,
		},
		markLine: meanMarkLine_default(),
	},
]);

const distributionPlotSeries_bin_default = () => ([
	{
		xAxisIndex: 0,
		yAxisIndex: 0,
		type: "custom",
		clip: true,
		renderItem: binRenderer,
		dimensions: ["from", "to", "height", "mass"],
		encode: {
			x: [0, 1],
			y: 2,
		},
		tooltip: {
			show: false,
		},
		itemStyle: {
			color: "rgba(0, 128, 0, 0.3)",
			borderColor: "rgba(0, 128, 0, 0.6)",
			borderWidth: 0.6,
			borderType: "solid",
		},
		markLine: meanMarkLine_default(),
	},
]);

const distributionXAxis_default = (
	limits: [number, number],
	name: string = kXAxisName
): echarts.XAXisComponentOption => ({
	type: "value",
	position: "bottom",
	gridIndex: 0,
	name: name,
	nameLocation: "middle",
	nameTextStyle: axisNameTextStyle_default(),
	nameGap: kAxisNameGap.x,
	...axisBounds(limits),
	...frame_default(kSupportFrame),
	splitLine: splitLine_default(),
	axisLabel: {
		...numericAxisLabel_default(),
		showMinLabel: false,
		formatter: fullLabel(limits),
	},
});

const distributionXAxis_specialValues_default = () => ({
	gridIndex: 1,
	type: "category",
	data: ["NaN", "-Inf", "Inf"],
	...frame_default(kSupportFrame),
	splitLine: splitLine_default(),
	axisLabel: axisLabel_default(),
});

const distributionPlotSeries_specialValues_default = () => ({
	animation: false,
	xAxisIndex: 1,
	yAxisIndex: 1,
	type: "bar",
	itemStyle: {
		color: "rgba(0, 128, 0, 0.3)",
		borderColor: "rgba(0, 128, 0, 0.6)",
		borderWidth: 0.6,
		borderType: "solid",
	},
	labelLine: {
		show: true,
	},
	data: [0, 0, 0]
});

const distributionYAxis_specialValues_default = () => ({
	...distributionYAxis_default(1, kSpecialValuesYAxisName),
	gridIndex: 1,
	nameGap: kAxisNameGap.specialValuesY,
});

const option_default = (): echarts.EChartsOption => ({
	aria: {
		enabled: true,
		decal: {
			show: true,
			decals: {
				color: "rgba(0, 128, 0, 0.6)",
				dashArrayX: [1, 0],
				dashArrayY: [2, 8],
				symbolSize: 0.6,
				rotation: Math.PI / 4,
			},
		},
	},

	textStyle: {
		fontFamily: kFontFamily,
	},
});

const option_specialValuesGrid_default = () => ([
	{ ...kPlotGrid, right: kSpecialValuesGutter },
	{
		top: kPlotGrid.top,
		bottom: kPlotGrid.bottom,
		right: kPlotGrid.right,
		width: kSpecialValuesWidth,
	},
]);

const yAxisOffsetHeader_default = (exponent: number) => ({
	type: "text",
	left: kPlotGrid.left,
	top: 0,
	style: {
		text: `1e${exponent}`,
		fill: kBlack,
		fontSize: kTickLabelSize,
		fontFamily: kFontFamily,
	},
});

/**
 * Generates the ECharts option for a given Ux value, as
 * signaloid-data-toolkit's `plot()` draws it.
 *
 * @param plot_data Plot data of the Ux value to plot.
 * @param chart_options Per-plot options. See `SignaloidChartOptions`.
 *
 * @returns ECharts option.
 *
 * @throws EvalError: When a bound of `xlim` or `ylim`, or of the limits
 * derived in their place, is NaN or +/-Inf.
 */
function signaloidChartOption(
	plot_data: PlotData,
	chart_options: SignaloidChartOptions = {}
): echarts.EChartsOption {
	let distributionPlotSeries;
	const mean: null | number = plot_data.dist.mean;
	const has_finite_mean: boolean = mean !== null && Number.isFinite(mean);

	if (plot_data.positions.length === 1) {
		let data = [[plot_data.positions[0], plot_data.masses[0]]];
		distributionPlotSeries = distributionPlotSeries_diracDelta_default();
		//@ts-ignore
		distributionPlotSeries[0].data = data;
		//@ts-ignore
		distributionPlotSeries[1].data = data;
	} else {
		let data: Array<object> = [];
		for (let i = 0; i < plot_data.positions.length - 1; i++) {
			data.push({
				value: [
					plot_data.positions[i],
					plot_data.positions[i + 1],
					plot_data.masses[i],
					plot_data.widths[i] * plot_data.masses[i],
				],
			});
		}
		distributionPlotSeries = distributionPlotSeries_bin_default();
		//@ts-ignore
		distributionPlotSeries[0].data = data;
	}

	const meanSeries: any = distributionPlotSeries[distributionPlotSeries.length - 1];
	if (has_finite_mean) {
		meanSeries.markLine.data[0].xAxis = mean;
	} else {
		delete meanSeries.markLine;
	}

	const y_bounds = axisBounds(axisLimits(chart_options.ylim ?? [0, densityAxisMaximum(plot_data)]));
	const exponent: number = chart_options.offsetExponent ?? offsetExponent(y_bounds.max);

	const distributionYAxis = {
		...distributionYAxis_default(
			y_bounds.max,
			chart_options.yAxisName || kYAxisName,
			y_bounds.min,
			exponent
		),
		inverse: y_bounds.inverse,
	};

	/* matplotlib's limits for an axis with nothing drawn on it. */
	let x_limits: [number, number] = [0, 1];
	if (chart_options.xlim) {
		/* Even with no finite Dirac delta, so that paired plots keep one scale. */
		x_limits = chart_options.xlim;
	} else if (plot_data.positions.length > 0) {
		const min_x: number = has_finite_mean
			? Math.min(mean as number, plot_data.min_range)
			: plot_data.min_range;
		const max_x: number = has_finite_mean
			? Math.max(mean as number, plot_data.max_range)
			: plot_data.max_range;
		const range_spacing: number = kXAxisRangePadding * (max_x - min_x);

		x_limits = [min_x - range_spacing, max_x + range_spacing];
	}
	/* signaloid-data-toolkit's `x_label if x_label else "Distribution Support"`. */
	const distributionXAxis = distributionXAxis_default(
		axisLimits(x_limits),
		chart_options.xAxisName || kXAxisName
	);

	const xAxis: Array<any> = [distributionXAxis];
	const yAxis: Array<any> = [distributionYAxis];
	const series: Array<any> = [...distributionPlotSeries];
	let grid: any = { ...kPlotGrid };

	if (plot_data.dist.has_special_values) {
		xAxis.push(distributionXAxis_specialValues_default());
		yAxis.push(distributionYAxis_specialValues_default());

		const distributionPlotSeries_specialValues = distributionPlotSeries_specialValues_default();
		distributionPlotSeries_specialValues.data = [
			plot_data.dist.nan_dirac_delta.mass,
			plot_data.dist.neg_inf_dirac_delta.mass,
			plot_data.dist.pos_inf_dirac_delta.mass,
		];
		series.push(distributionPlotSeries_specialValues);

		grid = option_specialValuesGrid_default();
	}

	/* Mirrors last: the series address axes by index. */
	xAxis.push(...xAxis.map(axis => mirroredAxis(axis, "top")));
	yAxis.push(...yAxis.map(axis => mirroredAxis(axis, "right")));

	return {
		...option_default(),
		xAxis: xAxis,
		yAxis: yAxis,
		series: series,
		grid: grid,
		...(exponent !== 0 && { graphic: [yAxisOffsetHeader_default(exponent)] }),
	} as echarts.EChartsOption;
}

/**
 * Mounts the ECharts instance on a given DOM element, and makes it resizeable.
 *
 * @param chartDom DOM element to mount the ECharts instance on.
 * @param plot_data Plot data of the Ux value to plot.
 * @param chart_options Per-plot options, as `signaloidChartOption` takes them.
 *
 * @returns The ECharts instance.
 *
 * @throws EvalError: As `signaloidChartOption` does.
 */
function signaloidChartMount(
	chartDom: any,
	plot_data: PlotData,
	chart_options: SignaloidChartOptions = {}
) {
	const option: echarts.EChartsOption = signaloidChartOption(plot_data, chart_options);

	/*
	 * Initialize the echarts instance based on the prepared dom
	 */
	const myChart = echarts.init(chartDom);
	myChart.setOption(option);

	new ResizeObserver(function () {
		myChart.resize();
	}).observe(chartDom);

	return myChart;
}

export {
	signaloidChartMount,
	signaloidChartOption,
	distributionPlotAspectRatio,
	densityAxisMaximum,
	offsetExponent,
	sharedAxes,
};

export type { SignaloidChartOptions };
