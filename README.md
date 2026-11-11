# Signaloid Ux Data Tools TypeScript
This repository contains a set of tools for parsing and plotting Signaloid distributional data in TypeScript/JavaScript.

## Installation
The package is publicly available through **GitHub Packages**.

Authenticate using your GitHub Access Token:

```sh
echo "Enter your GitHub Access Token with read:packages and repo scopes:" && read -s GITHUB_TOKEN && npm config set @signaloid:registry https://npm.pkg.github.com/ && npm config set //npm.pkg.github.com/:_authToken $GITHUB_TOKEN
```

You can now install the latest version of `@signaloid/uxdata-tools` package via npm:
```bash
npm install @signaloid/uxdata-tools
```

## Parse `Ux` data
You can construct `DistributionalValue` objects by parsing `Ux` string or `Ux` bytes. You can find more details about the Signaloid `Ux` format [here](https://docs.signaloid.io/docs/hardware-api/ux-data-format/). Following is an example of parsing `Ux` strings and `Ux` bytes.

```javascript
import { DistributionalValue } from '@signaloid/uxdata-tools';

...

/* Parse a Ux string */
const distValue = DistributionalValue.parse(ux_string);

/* Parse a Ux bytes buffer */
const distValue = DistributionalValue.parse(ux_bytes_buffer);
```

## Plot `DistributionalValue` objects
You can use the `PlotData` class for plotting a distributional value as a histogram with variable bin width. Its optional second argument sets the plotting resolution, and takes one of the 10 powers of 2 from 2 up to `PlotData.MAX_BINS`, exported as the `PlottingResolution` type. A resolution above what the distribution's TTR order supports is capped down to it. The TTR binning draws that many bins, and the non-uniform binning draws one bin per Dirac delta, at most half that many (2 at a resolution of 2). See [How `PlotData` bins a value](#how-plotdata-bins-a-value). We also provide the `signaloidChartMount` wrapper function to assist plotting, which you can find [here](./src/plot_wrapper.ts), to easily plot a distributional value like in the following example:

```javascript
import { DistributionalValue, PlotData, signaloidChartMount } from '@signaloid/uxdata-tools';

...

/* Create the element to mount the plot */
const chart = document.createElement("div");
chart.className = "signaloid-chart";
document.body.appendChild(chart);

/* Create distributional value object from string */
const distValue = DistributionalValue.parse(ux_string);
const plotData = new PlotData(distValue);

/* Mount the plot */
signaloidChartMount(chart, plotData, { xAxisName: "Latency (ns)" });
```

The third argument is optional. Size the container yourself, at the exported `distributionPlotAspectRatio` (width to height).

| Option | Type | Effect |
| --- | --- | --- |
| `xAxisName` | `string` | Replaces the default x axis name, `Distribution Support`. An empty name keeps the default. |
| `yAxisName` | `string` | Replaces the default y axis name, `Probability Density`. An empty name keeps the default. |
| `xlim` | `[number, number]` | Fixes the x range instead of deriving it from the support and the mean. |
| `ylim` | `[number, number]` | Fixes the y range instead of deriving it from the maximum density. |
| `offsetExponent` | `number` | Fixes the power of 10 the y tick labels are divided by, and the exponent shown in the header above them. 0 leaves the labels raw and draws no header. |

The axes follow matplotlib's rules, as in signaloid-data-toolkit. An `xlim` or `ylim` bound that is `NaN` or infinite throws an `EvalError`, equal bounds are widened by 5% of their magnitude each side, or to -0.05 and 0.05 at 0, and descending bounds, such as `[10, -10]`, draw a reversed axis. A value with no finite Dirac delta, for example one whose mass is all on `NaN`, draws an empty main axis from 0 to 1. Unlike matplotlib, the x tick labels have no offset such as `+1e6` and no shared multiplier such as `1e15`: each label shows its whole tick value.

To draw two or more plots on one set of axes, pass every `PlotData` to `sharedAxes` and spread the result into each `signaloidChartMount` call:

```javascript
import { DistributionalValue, PlotData, sharedAxes, signaloidChartMount } from '@signaloid/uxdata-tools';

const plotDatas = ux_strings.map(
	ux_string => new PlotData(DistributionalValue.parse(ux_string))
);
const axes = sharedAxes(plotDatas);

plotDatas.forEach((plotData, i) => signaloidChartMount(charts[i], plotData, {
	...axes,
	xAxisName: "Latency (ns)",
}));
```

`sharedAxes` returns the `xlim`, `ylim`, and `offsetExponent` every plot should draw on. The x range is the union of each input's support between its 0.005 and 0.995 quantiles, padded 5% each side, so a few extreme samples in the tails do not stretch the shared domain. The y range takes the largest of the per-plot maxima.

An input whose trimmed support is not finite contributes nothing, and `sharedAxes` omits `xlim` entirely when no input has a finite trimmed support, so each plot falls back to its own x range.

## Plot samples
`PlotData.from_samples` plots an array of float samples, such as the output of a Monte Carlo run. Each sample is an equal-mass Dirac delta, and `NaN`, `-Inf`, and `Inf` samples go to the special-values panel:

```javascript
import { PlotData, signaloidChartMount } from '@signaloid/uxdata-tools';

const plotData = PlotData.from_samples(samples);
signaloidChartMount(chart, plotData);
```

## How `PlotData` bins a value
`PlotData` follows [signaloid-data-toolkit](https://github.com/signaloid/signaloid-data-toolkit), so a value plots the same in both:

1. Zero-mass Dirac deltas are dropped, and Dirac deltas at (nearly) the same position are combined. A value left with a single finite Dirac delta is drawn as an arrow.
2. Values from Athens and Rome (`UR_TYPE_ATHENS`, `UR_TYPE_ROME`, together `TTR_NATIVE_UR_TYPES`), and any other value whose Dirac deltas form a full valid TTR, take the **TTR binning**: two bins per Dirac delta of the value's TTR at the plotting resolution.
3. Every other value, for example one from Jupiter, one with an unspecified representation type, or one built from samples, takes the **non-uniform binning**: one bin per Dirac delta, with boundaries that follow the spacing of the Dirac deltas, so the plot has no gaps. Where the spacing allows it, each bin is centred on its Dirac delta. A value with more Dirac deltas than half the plotting resolution (2 at the least) is first reduced to that many, the Dirac deltas of its TTR at that resolution.

A `DistributionalValue` you build yourself has the representation type `UR_TYPE_UNSPECIFIED` unless you pass `UR_type`. Exported as Ux Binary Data, an unspecified type is written as Athens, and in a Ux string it is written as it is.

The plot differs from signaloid-data-toolkit on purpose in a few places. `sharedAxes` and the `yAxisName` and `offsetExponent` chart options have no counterpart there, an explicit `xlim` or `ylim` applies even to a value with no finite Dirac delta, so that plots that share axes keep one scale, and a `plotting_resolution` below 2, or `NaN`, throws an `EvalError` here, where signaloid-data-toolkit plots a value below 2 with 2 bins. As in signaloid-data-toolkit, the resolution is first capped at what the value's TTR order supports and at `PlotData.MAX_BINS`, and a capped resolution that is not a power of 2 throws.
