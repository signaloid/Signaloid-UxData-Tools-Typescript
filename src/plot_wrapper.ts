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


import { PlotData } from './plot_histogram_dirac_deltas';
import * as echarts from 'echarts';


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
	let start = api.coord([boundaryPosition, binHeight]);
	let size = api.size([boundaryPositionN - boundaryPosition, binHeight]);

	/*
	 * Bin styling
	 */
	const style = binStyle_default();
	//@ts-ignore
	style.decal = api.visual("decal");

	return {
		type: "rect",
		shape: {
			x: start[0],
			y: start[1],
			width: size[0],
			height: size[1],
		},
		style: style,
	};
}

const diracDeltaStyle_default = () => ({
	stroke: "#000000",
	lineWidth: 3,
});

function diracDeltaRenderer(_: any, api: any) {
	const diracDeltaPosition = api.value();
	const points = [api.coord([diracDeltaPosition, 0]), api.coord([diracDeltaPosition, 1])];

	return {
		type: "polyline",
		shape: {
			points: points,
		},
		style: diracDeltaStyle_default(),
	};
}

function diracDeltaArrowRenderer(_: any, api: any) {
	const diracDeltaPosition = api.value();
	const position = api.coord([diracDeltaPosition, 1]);

	return {
		type: "polygon",
		x: position[0],
		y: position[1],
		shape: {
			points: [
				[0, 0],
				[-6, 10],
				[6, 10],
			],
		},
		style: diracDeltaStyle_default(),
	};
}

/* Default options */
const distributionYAxis_default = (): echarts.YAXisComponentOption => ({
	type: "value",
	name: "Probability Density",
	gridIndex: 0,
	nameLocation: "middle",
	nameTextStyle: {
		align: "center",
		fontSize: 14,
	},
	nameGap: 35,
	min: 0,
	max: 1.2,
	axisLine: {
		lineStyle: {
			type: "solid",
			width: 1,
			color: "#000",
		},
	},
	axisTick: {
		show: true,
		inside: true,
		lineStyle: {
			type: "solid",
			width: 1,
			color: "#000",
		},
	},
	minorTick: {
		show: true,
	},
	splitLine: {
		lineStyle: {
			type: "dashed",
			color: "rgba(0, 0, 0, 0.5)",
		},
	},
});

const distributionPlotSeries_diracDelta_default = () => ([
	{
		xAxisIndex: 0,
		yAxisIndex: 0,
		type: "custom",
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
		renderItem: diracDeltaRenderer,
		tooltip: {
			show: false,
		},
		itemStyle: {
			color: "#000",
			borderWidth: 3,
		},
		markLine: {
			symbol: "none",
			data: [
				{
					name: "E(x)",
					label: {
						show: true,
						position: "insideMiddleTop",
						formatter: "{b}",
					},
					tooltip: {
						show: false,
					},
				},
			],
			lineStyle: {
				color: "rgba(0, 128, 0, 0.8)",
				type: "solid",
				width: 2,
			},
			emphasis: {
				disabled: false,
				label: {
					triggerTooltip: false,
				},
			},
			animation: false,
		},
	},
]);

const distributionPlotSeries_bin_default = () => ([
	{
		xAxisIndex: 0,
		yAxisIndex: 0,
		type: "custom",
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
		markLine: {
			symbol: "none",
			data: [
				{
					name: "E(x)",
					label: {
						show: true,
						position: "insideMiddleTop",
						formatter: "{b}",
					},
					tooltip: {
						show: false,
					},
				},
			],
			lineStyle: {
				color: "rgba(0, 128, 0, 0.8)",
				type: "solid",
				width: 2,
			},
			emphasis: {
				disabled: false,
				label: {
					triggerTooltip: false,
				},
			},
			animation: false,
		},
	},
]);

const distributionXAxis_default = (): echarts.XAXisComponentOption => ({
	type: "value",
	alignTicks: true,
	position: "bottom",
	gridIndex: 0,
	name: "Distribution Support",
	nameLocation: "middle",
	nameTextStyle: {
		align: "center",
		fontSize: 14,
	},
	nameGap: 30,
	scale: true,
	axisTick: {
		show: true,
		inside: true,
		lineStyle: {
			type: "solid",
			width: 2,
			color: "#000",
		},
	},
	minorTick: {
		show: true,
	},
	axisLine: {
		lineStyle: {
			type: "solid",
			width: 2,
			color: "#000",
		},
	},
	splitLine: {
		lineStyle: {
			type: "dashed",
			color: "rgba(0, 0, 0, 0.5)",
		},
	},
});

const distributionXAxis_specialValues_default = () => ({
	gridIndex: 1,
	type: "category",
	data: ["NaN", "-Inf", "Inf"],
	axisTick: {
		show: true,
		inside: true,
		lineStyle: {
			type: "solid",
			width: 2,
			color: "#000",
		},
	},
	minorTick: {
		show: true,
	},
	axisLine: {
		lineStyle: {
			type: "solid",
			width: 2,
			color: "#000",
		},
	},
	splitLine: {
		lineStyle: {
			type: "dashed",
			color: "rgba(0, 0, 0, 0.5)",
		},
	},
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
	name: "Probability Amplitude",
	nameLocation: "middle",
	alignTicks: true,
	scale: true,
	nameTextStyle: {
		align: "center",
		fontSize: 14,
	},
	nameGap: 35,
	gridIndex: 1,
	type: "value",
	min: 0,
	max: 1,
	axisLine: {
		onZero: false,
		lineStyle: {
			type: "solid",
			width: 1,
			color: "#000",
		},
	},
	axisTick: {
		show: true,
		inside: true,
		lineStyle: {
			type: "solid",
			width: 1,
			color: "#000",
		},
	},
	minorTick: {
		show: true,
	},
	splitLine: {
		lineStyle: {
			type: "dashed",
			color: "rgba(0, 0, 0, 0.5)",
		},
	},
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

	/*
	 * Plot with NaN, inf and -inf files
	 */
	xAxis: [distributionXAxis_default()],
	yAxis: [],
	series: [],
});

const option_specialValuesGrid_default = () => ([
	{ left: "10%", top: "2%", width: "63%", height: "80%" },
	{ right: "0%", top: "2%", width: "16%", height: "80%" },
]);

/**
 *  Generates the ECharts option for a given Ux value.
 *
 *  @param uxValue: Ux value in string format.
 *  @returns ECharts option.
 */
function signaloidChartOption(plot_data: PlotData): echarts.EChartsOption {
	const distributionYAxis: echarts.YAXisComponentOption = distributionYAxis_default();
	let distributionPlotSeries;

	if (plot_data.dist.UR_order === 1) {
		/*
		 * For plotting a Ux value that has only one dirac delta
		 */
		let data = [plot_data.positions[0]];
		distributionPlotSeries = distributionPlotSeries_diracDelta_default();
		//@ts-ignore
		distributionPlotSeries[0].data = data;
		//@ts-ignore
		distributionPlotSeries[1].data = data;
		//@ts-ignore
		distributionPlotSeries[1].markLine.data[0].xAxis = plot_data.dist.mean;
	} else {
		/*
		 * For plotting a ux value that has distributional data
		 */
		let data: Array<object> = [];
		for (let i = 0; i < plot_data.positions.length; i++) {
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
		//@ts-ignore
		distributionPlotSeries[0].markLine.data[0].xAxis = plot_data.dist.mean;

		distributionYAxis.max = Number(Math.max(...plot_data.masses).toFixed(3)) * 1.2;
		//@ts-ignore
		distributionYAxis.axisLine.onZero = false;
	}

	/*
	 * Plot with NaN, inf and -inf files
	 */
	const option: echarts.EChartsOption = option_default();
	//@ts-ignore
	option.yAxis.push(distributionYAxis);
	//@ts-ignore
	option.series.push(...distributionPlotSeries);

	if (plot_data.dist.has_special_values) {
		//@ts-ignore
		option.xAxis.push(distributionXAxis_specialValues_default());
		//@ts-ignore
		option.yAxis.push(distributionYAxis_specialValues_default());

		const distributionYAxis_specialValues = distributionPlotSeries_specialValues_default();
		distributionYAxis_specialValues.data = [
			plot_data.dist.nan_dirac_delta.mass,
			plot_data.dist.neg_inf_dirac_delta.mass,
			plot_data.dist.pos_inf_dirac_delta.mass,
		];
		//@ts-ignore
		option.series.push(distributionYAxis_specialValues);

		/*
		 * Plot without NaN, inf and -inf files
		 */
		option.grid = option_specialValuesGrid_default();
	}

	return option;
}

/**
 *  Mounts the ECharts instance on a given DOM element, and makes it resizeable.
 *
 *  @param chartDom: DOM element to mount the ECharts instance on.
 *  @param uxValue: Ux value in string format.
 */
function signaloidChartMount(chartDom: any, plot_data: PlotData) {
	const option: echarts.EChartsOption = signaloidChartOption(plot_data);

	/*
	 * Initialize the echarts instance based on the prepared dom
	 */
	const myChart = echarts.init(chartDom);
	myChart.setOption(option);

	window.addEventListener('resize', function () {
		myChart.resize();
	});

	return myChart;
}

export { signaloidChartMount, signaloidChartOption };
