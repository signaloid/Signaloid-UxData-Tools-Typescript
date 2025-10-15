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
You can use the `PlotData` class for plotting a distributional value as a histogram with variable bin width. We also provide the `signaloidChartMount` wrapper function to assist plotting, which you can find [here](./src/plot_wrapper.ts), to easily plot a distributional value like in the following example:

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
signaloidChartMount(chart, plot_data);
```
