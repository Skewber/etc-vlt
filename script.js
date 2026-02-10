// Exposure Time Calculator - JavaScript port of the notebook
(function () {
  let config = null;
  let chart = null;

  function $(id) {
    return document.getElementById(id);
  }

  async function loadConfig() {
    try {
      const response = await fetch("config.json");
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      config = await response.json();
      console.log("Config loaded:", config);
    } catch (error) {
      console.error("Error loading config:", error);
      throw error;
    }
  }

  function getNpix(fwhm, binning) {
    const s = config.telescope.pixel_scale_arcsec_per_px;
    const aperture = config.telescope.aperture_multiplier;
    const r = (aperture * fwhm) / 2 / s / binning;
    const A = Math.PI * r * r;
    return A;
  }

  function calc(mode) {
    const mag = parseFloat($("mag").value);
    const snr = parseFloat($("snr").value);
    const airmass = parseFloat($("airmass").value);
    const air_quality = Math.max(
      1,
      Math.min(5, parseInt($("air_quality").value)),
    );
    const seeing = parseFloat($("seeing").value);
    const binning = parseInt($("binning").value);
    const read_mode = $("read_mode").value;
    const used_filter = $("used_filter").value;

    const n_pix = getNpix(seeing, binning);

    const N_readout =
      config.camera.read_modes[read_mode] || config.camera.read_modes["8 MHz"];
    const R_dark = config.camera.dark_current_e_per_s;

    const R_sky =
      config.sky.brightness_e_per_s[used_filter] ||
      config.sky.brightness_e_per_s.V;

    const ZP = config.photometry.zero_points[used_filter];
    const k_array =
      config.photometry.extinction_coefficients[used_filter] ||
      config.photometry.extinction_coefficients.V;
    const k = k_array[air_quality - 1];
    const R_star = Math.pow(10, 0.4 * (ZP - (mag + k * airmass)));

    let result = { n_pix, R_star, R_sky, N_readout };

    if (mode === "exposure") {
      // coefficients for quadratic in t: a t^2 + b t + c = 0
      const a = Math.pow(R_star, 2);
      const b = -Math.pow(snr, 2) * (R_star + n_pix * (R_sky + R_dark));
      const c = -Math.pow(snr, 2) * n_pix * Math.pow(N_readout, 2);

      const disc = b * b - 4 * a * c;
      let t = NaN;
      if (disc >= 0) {
        t = (-b + Math.sqrt(disc)) / (2 * a);
        if (t < 0) t = NaN;
      }
      result.t = t;
    } else {
      // Calculate SNR for a given exposure time
      const exp_time = parseFloat($("snr").value); // Note: in SNR mode, this field holds exp_time
      result.snr_calc =
        (R_star * exp_time) /
        Math.sqrt(
          R_star * exp_time +
            n_pix * (exp_time * (R_sky + R_dark) + Math.pow(N_readout, 2)),
        );
    }

    return result;
  }

  function calculateSNRForTime(
    exp_time,
    R_star,
    R_sky,
    R_dark,
    n_pix,
    N_readout,
  ) {
    return (
      (R_star * exp_time) /
      Math.sqrt(
        R_star * exp_time +
          n_pix * (exp_time * (R_sky + R_dark) + Math.pow(N_readout, 2)),
      )
    );
  }

  function updateChart(
    R_star,
    R_sky,
    R_dark,
    n_pix,
    N_readout,
    refTime,
    refSNR,
  ) {
    // Generate exposure time range
    const minTime = Math.max(0.1, refTime * 0.7);
    const maxTime = refTime * 1.5;
    const step = (maxTime - minTime) / 50;

    const expoVals = [];
    const snrVals = [];

    for (let i = 0; i <= 50; i++) {
      const t = minTime + i * step;
      expoVals.push(t);
      snrVals.push(
        calculateSNRForTime(t, R_star, R_sky, R_dark, n_pix, N_readout),
      );
    }

    const ctx = $("snr-chart").getContext("2d");

    if (chart) {
      chart.destroy();
    }

    const minSNR = Math.min(...snrVals);
    const maxSNR = Math.max(...snrVals);

    // Custom plugin to draw reference point with crosshairs
    const referencePointPlugin = {
      id: "referencePoint",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;

        // Get pixel positions for the reference point
        const xPixel = xScale.getPixelForValue(refTime);
        const yPixel = yScale.getPixelForValue(refSNR);

        // Get axis boundaries
        const chartBottom = chart.chartArea.bottom;
        const chartLeft = chart.chartArea.left;

        // Draw vertical line to x-axis (dashed)
        ctx.save();
        ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(xPixel, yPixel);
        ctx.lineTo(xPixel, chartBottom);
        ctx.stroke();

        // Draw horizontal line to y-axis (dashed)
        ctx.beginPath();
        ctx.moveTo(chartLeft, yPixel);
        ctx.lineTo(xPixel, yPixel);
        ctx.stroke();
        ctx.restore();

        // Draw red dot at reference point
        ctx.save();
        ctx.fillStyle = "rgba(239, 68, 68, 1)";
        ctx.strokeStyle = "rgba(239, 68, 68, 1)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(xPixel, yPixel, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      },
    };

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: expoVals,
        datasets: [
          {
            label: "SNR",
            data: snrVals,
            borderColor: "rgba(79, 70, 229, 1)",
            backgroundColor: "rgba(79, 70, 229, 0.1)",
            tension: 0.3,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "rgba(230, 238, 248, 0.8)",
              font: { size: 12 },
            },
          },
          referencePoint: {}, // Enable the custom plugin
        },
        scales: {
          x: {
            type: "linear",
            title: {
              display: true,
              text: "Exposure time (s)",
              color: "rgba(230, 238, 248, 0.8)",
            },
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "rgba(230, 238, 248, 0.8)" },
            min: minTime,
            max: maxTime,
          },
          y: {
            title: {
              display: true,
              text: "SNR",
              color: "rgba(230, 238, 248, 0.8)",
            },
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "rgba(230, 238, 248, 0.8)" },
            beginAtZero: false,
            min: minSNR * 0.95,
            max: maxSNR * 1.05,
          },
        },
      },
      plugins: [referencePointPlugin],
    });
  }

  function updateMode() {
    const mode = document.querySelector(
      'input[name="calc_mode"]:checked',
    ).value;
    const labelText = $("label-snr-or-time-text");
    const input = $("snr");
    const btn = $("calc-btn");

    if (mode === "exposure") {
      labelText.textContent = "Target SNR";
      input.placeholder = "10";
      input.value = "10";
      btn.textContent = "Calculate exposure time";
    } else {
      labelText.textContent = "Exposure time (s)";
      input.placeholder = "20";
      input.value = "20";
      btn.textContent = "Calculate SNR";
    }
  }

  function performCalculation() {
    console.log("Calculate button clicked");
    const mode = document.querySelector(
      'input[name="calc_mode"]:checked',
    ).value;
    const out = calc(mode);
    const snrVal = parseFloat($("snr").value);

    if (mode === "exposure") {
      const line1 = $("result-line1");
      const line2 = $("result-line2");
      if (!Number.isFinite(out.t)) {
        line1.textContent = "Exposure time: No valid solution (check inputs)";
        line2.textContent = `SNR: ${snrVal}`;
        updateChart(
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          out.N_readout,
          20,
          5,
        );
      } else {
        line1.textContent = `Exposure time: ${out.t.toFixed(3)} s`;
        line2.textContent = `SNR: ${snrVal}`;
        updateChart(
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          out.N_readout,
          out.t,
          snrVal,
        );
      }
    } else {
      const line1 = $("result-line1");
      const line2 = $("result-line2");
      if (!Number.isFinite(out.snr_calc)) {
        line1.textContent = `Exposure time: ${snrVal} s`;
        line2.textContent = "SNR: invalid";
        updateChart(
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          out.N_readout,
          snrVal,
          5,
        );
      } else {
        line1.textContent = `Exposure time: ${snrVal} s`;
        line2.textContent = `SNR: ${out.snr_calc.toFixed(3)}`;
        updateChart(
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          out.N_readout,
          snrVal,
          out.snr_calc,
        );
      }
    }
    $("debug").textContent =
      `n_pix=${out.n_pix.toFixed(2)}  R_star=${out.R_star.toExponential(3)}  R_sky=${out.R_sky}  N_readout=${out.N_readout}`;
  }

  window.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded event fired");
    try {
      await loadConfig();
      console.log("Config loaded successfully");
      document.querySelectorAll('input[name="calc_mode"]').forEach((radio) => {
        radio.addEventListener("change", updateMode);
      });
      const calcBtn = $("calc-btn");
      console.log("calc-btn element:", calcBtn);
      if (calcBtn) {
        calcBtn.addEventListener("click", performCalculation);
        console.log("Event listener attached to calc-btn");
      } else {
        console.error("calc-btn element not found");
      }
    } catch (error) {
      console.error("Error in DOMContentLoaded:", error);
    }
  });
})();
