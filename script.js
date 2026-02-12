// Exposure Time Calculator - JavaScript port of the notebook
(function () {
  let config = null;
  let chartExposure = null;
  let chartMag = null;

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

  function updateExposureChart(
    R_star,
    R_sky,
    R_dark,
    n_pix,
    N_readout,
    refTime,
    refSNR,
  ) {
    console.debug("updateExposureChart called", { refTime, refSNR });
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

    const canvas = $("snr-chart-tab");
    if (!canvas) {
      console.error("snr-chart-tab canvas not found");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (chartExposure) chartExposure.destroy();

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

    try {
      chartExposure = new Chart(ctx, {
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
    } catch (err) {
      console.error("Error creating exposure chart:", err);
    }
  }

  // Magnitude vs SNR chart
  function updateMagChart(
    expTime,
    targetMag,
    seeing,
    binning,
    airmass,
    air_quality,
    read_mode,
    used_filter,
    N_readout,
  ) {
    // magnitude range: targetMag +/- 3
    const mags = [];
    const step = 0.05;
    const minMag = targetMag - 2;
    const maxMag = targetMag + 2;
    for (let m = minMag; m <= maxMag + 1e-9; m += step)
      mags.push(parseFloat(m.toFixed(2)));

    const k_array =
      config.photometry.extinction_coefficients[used_filter] ||
      config.photometry.extinction_coefficients.V;
    const k = k_array[Math.max(0, Math.min(4, air_quality - 1))];
    const ZP = config.photometry.zero_points[used_filter];

    const n_pix = getNpix(seeing, binning);
    const R_dark = config.camera.dark_current_e_per_s;
    const R_sky =
      config.sky.brightness_e_per_s[used_filter] ||
      config.sky.brightness_e_per_s.V;

    const snrVals = mags.map((magv) => {
      const R_star_v = Math.pow(10, 0.4 * (ZP - (magv + k * airmass)));
      return calculateSNRForTime(
        expTime,
        R_star_v,
        R_sky,
        R_dark,
        n_pix,
        N_readout,
      );
    });

    // SNR at the target magnitude for the crosshair
    const R_star_target = Math.pow(10, 0.4 * (ZP - (targetMag + k * airmass)));
    const snrAtTarget = calculateSNRForTime(
      expTime,
      R_star_target,
      R_sky,
      R_dark,
      n_pix,
      N_readout,
    );

    const dataPoints = mags.map((m, i) => ({ x: m, y: snrVals[i] }));

    console.debug("updateMagChart called", { expTime, used_filter });
    const canvas = $("mag-chart");
    if (!canvas) {
      console.error("mag-chart canvas not found");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (chartMag) chartMag.destroy();

    // plugin to draw reference point (target magnitude)
    const magReferencePlugin = {
      id: "magReference",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const xPixel = xScale.getPixelForValue(targetMag);
        const yPixel = yScale.getPixelForValue(snrAtTarget);
        const chartBottom = chart.chartArea.bottom;
        const chartLeft = chart.chartArea.left;

        ctx.save();
        ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(xPixel, yPixel);
        ctx.lineTo(xPixel, chartBottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(chartLeft, yPixel);
        ctx.lineTo(xPixel, yPixel);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "rgba(239,68,68,1)";
        ctx.beginPath();
        ctx.arc(xPixel, yPixel, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      },
    };

    try {
      chartMag = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: "SNR",
              data: dataPoints,
              parsing: false,
              borderColor: "rgba(16, 185, 129, 1)",
              backgroundColor: "rgba(16, 185, 129, 0.08)",
              tension: 0.2,
              fill: true,
              pointRadius: 0,
              showLine: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "rgba(230, 238, 248, 0.8)" } },
          },
          scales: {
            x: {
              type: "linear",
              position: "bottom",
              reverse: false,
              title: {
                display: true,
                text: "Magnitude",
                color: "rgba(230,238,248,0.8)",
              },
              ticks: { color: "rgba(230,238,248,0.8)" },
              min: Math.min(...mags),
              max: Math.max(...mags),
            },
            y: {
              title: {
                display: true,
                text: "SNR",
                color: "rgba(230,238,248,0.8)",
              },
              ticks: { color: "rgba(230,238,248,0.8)" },
            },
          },
        },
        plugins: [magReferencePlugin],
      });
    } catch (err) {
      console.error("Error creating mag chart:", err);
    }
  }

  function updateStats(
    expTime,
    R_star,
    R_sky,
    R_dark,
    n_pix,
    seeing,
    binning,
    mag,
    used_filter,
    calculatedSNR = null,
  ) {
    // Constants
    const gain = config.camera.gain_e_per_adu;
    const saturation = config.camera.saturation_adu;
    const pixelScale = config.telescope.pixel_scale_arcsec_per_px;

    // Sigma in binned pixels: FWHM / 2.3548 / binning
    const sigmaPx = seeing / pixelScale / 2.3548 / binning;

    // Signal in reference area
    const signalE = R_star * expTime;
    const signalAdu = signalE / gain;

    // Sky background per pixel
    const skyEPx = R_sky * expTime;
    const skyAduPx = skyEPx / gain;

    // Peak pixel value (Gaussian PSF)
    const peakStarE = signalE / (2 * Math.PI * sigmaPx * sigmaPx);
    const peakTotalE = peakStarE + skyEPx + R_dark * expTime;
    const peakTotalAdu = peakTotalE / gain;

    // FWHM Sampling
    const fwhmPix = seeing / (pixelScale * binning);

    // Saturation percentage
    const saturationPct = (peakTotalAdu / saturation) * 100;

    // Update display with proper formatting - matching HTML structure
    $("stat-brightness").textContent = `${mag.toFixed(2)}`;
    $("stat-filter").textContent = used_filter;
    $("stat-time").textContent = `${expTime.toFixed(2)}`;

    // Use calculated SNR if provided (SNR mode), otherwise use input value (exposure mode)
    const displaySNR =
      calculatedSNR !== null ? calculatedSNR : parseFloat($("snr").value);
    $("stat-snr").textContent = `${displaySNR.toFixed(2)}`;

    // store raw electron values on the elements so we can toggle units without recomputing
    const elPeak = $("stat-peak-e");
    const elSignal = $("stat-signal-e");
    const elSky = $("stat-sky-e");
    if (elPeak) elPeak.dataset.electrons = peakTotalE;
    if (elSignal) elSignal.dataset.electrons = signalE;
    if (elSky) elSky.dataset.electrons = skyEPx;

    // initial display (will be adjusted by unit toggle)
    $("stat-peak-e").textContent = `${peakTotalE.toFixed(2)}`;
    $("stat-saturation").textContent = `${saturationPct.toFixed(2)}`;
    $("stat-fwhm").textContent = `${fwhmPix.toFixed(2)}`;
    $("stat-refarea").textContent = `${n_pix.toFixed(2)}`;
    $("stat-signal-e").textContent = `${signalE.toFixed(2)}`;
    $("stat-sky-e").textContent = `${skyEPx.toFixed(2)}`;
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
      btn.textContent = "Calculate";
    } else {
      labelText.textContent = "Exposure time (s)";
      input.placeholder = "20";
      input.value = "20";
      btn.textContent = "Calculate";
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
      if (Number.isFinite(out.t)) {
        const mag = parseFloat($("mag").value);
        const seeing = parseFloat($("seeing").value);
        const binning = parseInt($("binning").value);
        const used_filter = $("used_filter").value;
        updateStats(
          out.t,
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          seeing,
          binning,
          mag,
          used_filter,
        );
        updateExposureChart(
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          out.N_readout,
          out.t,
          snrVal,
        );
        // also update magnitude plot (use same exposure time)
        updateMagChart(
          out.t,
          mag,
          seeing,
          binning,
          parseFloat($("airmass").value),
          Math.max(1, Math.min(5, parseInt($("air_quality").value))),
          $("read_mode").value,
          used_filter,
          out.N_readout,
        );
      } else {
        console.error("No valid solution for exposure time");
      }
    } else {
      if (Number.isFinite(out.snr_calc)) {
        const mag = parseFloat($("mag").value);
        const seeing = parseFloat($("seeing").value);
        const binning = parseInt($("binning").value);
        const used_filter = $("used_filter").value;
        updateStats(
          snrVal,
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          seeing,
          binning,
          mag,
          used_filter,
          out.snr_calc,
        );
        updateExposureChart(
          out.R_star,
          out.R_sky,
          config.camera.dark_current_e_per_s,
          out.n_pix,
          out.N_readout,
          snrVal,
          out.snr_calc,
        );
        // update magnitude plot using the provided exposure time input
        updateMagChart(
          snrVal,
          mag,
          seeing,
          binning,
          parseFloat($("airmass").value),
          Math.max(1, Math.min(5, parseInt($("air_quality").value))),
          $("read_mode").value,
          used_filter,
          out.N_readout,
        );
      } else {
        console.error("No valid SNR calculation");
      }
    }
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
      // Tab buttons for graphs
      // attach per-button listeners
      const tabButtons = document.querySelectorAll(".tab-button");
      if (tabButtons && tabButtons.length) {
        tabButtons.forEach((btn) => {
          btn.addEventListener("click", (ev) => {
            console.debug("Tab button clicked:", btn.dataset.target);
            const target = btn.dataset.target;
            document
              .querySelectorAll(".tab-button")
              .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            document
              .querySelectorAll(".tab-content")
              .forEach((tc) => (tc.style.display = "none"));
            const el = document.getElementById(target);
            if (el) el.style.display = "block";
          });
        });
      } else {
        console.debug("No tab buttons found");
      }
      // delegated click handler as a robust fallback
      document.addEventListener("click", (ev) => {
        const b = ev.target.closest && ev.target.closest(".tab-button");
        if (!b) return;
        const target = b.dataset.target;
        document
          .querySelectorAll(".tab-button")
          .forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        document
          .querySelectorAll(".tab-content")
          .forEach((tc) => (tc.style.display = "none"));
        const el = document.getElementById(target);
        if (el) el.style.display = "block";
      });
    } catch (error) {
      console.error("Error in DOMContentLoaded:", error);
    }
  });
})();
