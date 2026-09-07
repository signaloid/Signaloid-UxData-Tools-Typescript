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
You can use the `PlotData` class for plotting a distributional value as a histogram with variable bin width. Its optional second argument sets the number of bins, and takes one of the 10 powers of 2 from 2 up to `PlotData.MAX_BINS`, exported as the `PlottingResolution` type. A resolution above what the distribution's TTR order supports is capped down to it. We also provide the `signaloidChartMount` wrapper function to assist plotting, which you can find [here](./src/plot_wrapper.ts), to easily plot a distributional value like in the following example:

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
signaloidChartMount(chart, plot_data, { xAxisName: "Latency (ns)" });
```

The third argument is optional. Size the container yourself, at the exported `distributionPlotAspectRatio` (width to height).

| Option | Type | Effect |
| --- | --- | --- |
| `xAxisName` | `string` | Replaces the default x axis name, `Distribution Support`. |
| `yAxisName` | `string` | Replaces the default y axis name, `Probability Density`. |
| `xlim` | `[number, number]` | Fixes the x range instead of deriving it from the support and the mean. |
| `ylim` | `[number, number]` | Fixes the y range instead of deriving it from the maximum density. |
| `offsetExponent` | `number` | Fixes the power of 10 the y tick labels are divided by, and the exponent shown in the header above them. 0 leaves the labels raw and draws no header. |

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

An input whose trimmed support is not finite contributes nothing, and `sharedAxes` omits `xlim` entirely when no input has a finite trimmed support, so the plots fall back to auto-scaling.
