/**
 * ============================================================================
 * MIMOSA MINE — INTEGRATED WATER QUALITY MONITORING SYSTEM
 * COMPONENT 1: GEE REMOTE SENSING ENGINE
 * ============================================================================
 *
 * @project   Mimosa Mine Water Quality Assessment Framework
 * @location  Gorge Dam, Mimosa Mine, Zvishavane, Zimbabwe
 * @author    Jena Sandra
 * @version   4.0 (Production Build)
 *
 * ============================================================================
 * SYSTEM ARCHITECTURE
 * ============================================================================
 *
 * This script is COMPONENT 1 of a two-part integrated system:
 *
 *   ┌────────────────────────┐       ┌────────────────────────┐
 *   │  COMPONENT 1 (THIS)   │ Drive │  COMPONENT 2           │
 *   │  GEE RS Engine        │──────>│  Streamlit ML Dashboard│
 *   │  • Sentinel-2 Process │ CSV + │  • RF Regression Model │
 *   │  • Index Computation  │ TIFF  │  • R², RMSE, Plots     │
 *   │  • Spatial Layers     │       │  • Predictions & Maps  │
 *   └────────────────────────┘       └────────────────────────┘
 *
 * Google Drive folder "Mimosa_WQ_Exports" is the data bridge.
 *
 * ============================================================================
 * RESEARCH OBJECTIVES ADDRESSED
 * ============================================================================
 *
 * Obj 2: Derive satellite-based water quality indices from Sentinel-2
 *        → STAGE 1 of this script (NDWI, NDTI, NDCI, TSI, AWEIn)
 *
 * Obj 4: Assess spatio-temporal variations in water quality
 *        → STAGE 2 of this script (time series charts, zonal stats)
 *
 * Obj 5: Create a GIS-based decision support tool
 *        → The complete application shell (map, layers, analytics)
 *
 * Obj 3: Develop and validate an integrated WQ model (RS + in-situ)
 *        → Handled by COMPONENT 2 (Python Dashboard) using exports
 *          from STAGE 3 of this script
 *
 * ============================================================================
 * SPECTRAL INDEX REFERENCES
 * ============================================================================
 *
 * NDWI  — McFeeters, S.K. (1996). The use of the Normalized Difference
 *         Water Index in the delineation of open water features.
 *         Int. J. Remote Sensing, 17(7), 1425-1432.
 *         Formula: (Green - NIR) / (Green + NIR)
 *
 * NDTI  — Lacaux, J.P. et al. (2007). Classification of ponds from
 *         high-spatial-resolution remote sensing.
 *         Formula: (Red - Green) / (Red + Green)
 *
 * NDCI  — Mishra, S. & Mishra, D.R. (2012). Normalized difference
 *         chlorophyll index for trophic state mapping.
 *         Remote Sensing, 4(6), 1573-1599.
 *         Formula: (RedEdge1 - Red) / (RedEdge1 + Red)
 *
 * TSI   — Carlson, R.E. (1977). A trophic state index for lakes.
 *         Limnology & Oceanography, 22(2), 361-369.
 *         Proxy: NDCI * 100 + 50
 *
 * AWEIn — Feyisa, G.L. et al. (2014). Automated Water Extraction Index.
 *         Remote Sensing of Environment, 140, 23-35.
 *         Formula: 4*(Green-SWIR1) - (0.25*NIR + 2.75*SWIR2)
 *
 * ============================================================================
 */


// ============================================================================
// SECTION 0: AUTHENTICATION GATE
// ============================================================================

var ACCESS_PASSWORD = 'MimosaWQ2026';

ui.root.clear();

// --- Login Screen ---
var loginScreen = ui.Panel({
  style: { width: '100%', height: '100%', backgroundColor: '#0f172a' }
});

var loginCard = ui.Panel({
  layout: ui.Panel.Layout.Flow('vertical'),
  style: {
    width: '420px', margin: '100px auto 0 auto', padding: '40px',
    backgroundColor: '#1e293b', border: '2px solid #4338ca', borderRadius: '12px'
  }
});

loginCard.add(ui.Label('MIMOSA MINE', {
  fontWeight: 'bold', fontSize: '24px', color: '#818cf8', textAlign: 'center'
}));
loginCard.add(ui.Label('Water Quality Remote Sensing Engine', {
  fontSize: '13px', color: '#94a3b8', textAlign: 'center', margin: '4px 0 8px 0'
}));
loginCard.add(ui.Label('Component 1 of the Integrated WQ Monitoring Framework', {
  fontSize: '11px', color: '#64748b', textAlign: 'center', margin: '0 0 20px 0'
}));
loginCard.add(ui.Label('Enter Project Access Code:', {
  fontSize: '13px', color: '#cbd5e1', margin: '0 0 8px 0'
}));

var pwdInput = ui.Textbox({
  placeholder: 'Access code...',
  style: { width: '100%', margin: '0 0 12px 0' }
});
var loginError = ui.Label('', {
  color: '#ef4444', fontSize: '12px', shown: false, textAlign: 'center'
});

var loginBtn = ui.Button({
  label: 'LAUNCH ENGINE',
  onClick: function () {
    if (pwdInput.getValue() === ACCESS_PASSWORD) {
      ui.root.clear();
      launchEngine();
    } else {
      loginError.setValue('Invalid access code.');
      loginError.style().set('shown', true);
    }
  },
  style: { stretch: 'horizontal', color: '#818cf8', fontWeight: 'bold' }
});

loginCard.add(pwdInput);
loginCard.add(loginError);
loginCard.add(loginBtn);
loginCard.add(ui.Label('University of Zimbabwe — GIS & Remote Sensing', {
  fontSize: '10px', color: '#475569', textAlign: 'center', margin: '20px 0 0 0'
}));
loginScreen.add(loginCard);
ui.root.add(loginScreen);


// ============================================================================
// SECTION 1: MAIN ENGINE
// ============================================================================

function launchEngine() {

  // ── 1A. STUDY AREA & CONFIGURATION ──────────────────────────────────────────

  // Centroid of all 34 sample points from mine field survey KML
  var DAM_CENTER = ee.Geometry.Point([29.8385, -20.3130]);
  var DEFAULT_ROI = DAM_CENTER.buffer(5800); // Added 800 meters to the original 5000m radius (now 5800m)
  // Shared Drive folder: https://drive.google.com/drive/folders/1bapvthKzInFVloehVqh2QdKO74QPyRl4
  var DRIVE_FOLDER = 'Mimosa_WQ_Exports';

  // Upload your shapefile asset to GEE and update this path
  var RIVERS_ASSET = 'projects/ee-sandiejena27/assets/Gorge_dam_rivers';
  var riverFeatures = ee.FeatureCollection(RIVERS_ASSET);

  // Active analysis geometry (changes when user draws a polygon)
  var activeROI = DEFAULT_ROI;

  // Shared state: the processed composite image after Stage 1 runs
  var processedComposite = null;

  // ── 1B. ACTUAL IN-SITU SAMPLE POINTS (FROM MINE KML) ───────────────────────
  // Source: Mine Datasets/Sample Points.kml — 34 GPS field sampling locations
  // These points are where GEE extracts spectral values for the Python ML model.
  // After export, lab measurements (TSS, pH, E.coli, etc.) are merged in the CSV.

  var samplePoints = ee.FeatureCollection([
    ee.Feature(ee.Geometry.Point([29.84381885600004, -20.31754411099996]), { id: 'SP01', label: 'Testing Point 1', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.842569424000033, -20.31860980299996]), { id: 'SP02', label: 'Testing Point 2', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.84402097000003, -20.320410454999944]), { id: 'SP03', label: 'Testing Point 3', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.84560113300006, -20.31899565699996]), { id: 'SP04', label: 'Testing Point 4', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.847088369000062, -20.320006020999926]), { id: 'SP05', label: 'Testing Point 5', zone: 'core' }),
  ]);


  // ── 1C. STYLE TOKENS ────────────────────────────────────────────────────────

  var S = {
    title: { fontSize: '18px', fontWeight: 'bold', color: '#1e1b4b', margin: '12px 0 4px 0' },
    heading: { fontSize: '14px', fontWeight: 'bold', color: '#312e81', margin: '10px 0 5px 0' },
    body: { fontSize: '11px', color: '#4b5563', whiteSpace: 'pre-wrap' },
    card: { padding: '12px', margin: '10px 0', border: '1px solid #c7d2fe', backgroundColor: '#eef2ff', borderRadius: '8px' },
    success: { fontSize: '11px', fontWeight: 'bold', color: '#059669', margin: '4px 0' },
    pending: { fontSize: '11px', color: '#9ca3af', margin: '4px 0' },
    runBtn: { stretch: 'horizontal', fontWeight: 'bold', color: '#4338ca' },
    mono: { fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre', margin: '4px 0' }
  };


  // ============================================================================
  // SECTION 2: PREPROCESSING & INDEX ENGINE
  // ============================================================================

  /**
   * Cloud masking using Scene Classification Layer (SCL).
   * Retains only vegetation (4), bare soil (5), and water (6) pixels.
   * Scales reflectance bands to [0, 1] while preserving metadata.
   */
  function preprocessSentinel2(img) {
    var scl = img.select('SCL');
    var clearMask = scl.eq(4).or(scl.eq(5)).or(scl.eq(6));

    // Select optical bands BEFORE dividing (avoids corrupting SCL values)
    var optical = img.select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12']);
    var scaled = ee.Image(
      optical.updateMask(clearMask)
        .divide(10000)
        .copyProperties(img, ['system:time_start'])
    );
    return scaled;
  }

  /**
   * Computes all water quality spectral indices on a preprocessed image.
   * Returns the image with index bands appended.
   */
  function computeAllIndices(img) {
    // NDWI — Water extent (McFeeters, 1996)
    var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');

    // NDTI — Turbidity / suspended sediment (Lacaux et al., 2007)
    var ndti = img.normalizedDifference(['B4', 'B3']).rename('NDTI');

    // NDCI — Chlorophyll-a concentration (Mishra & Mishra, 2012)
    var ndci = img.normalizedDifference(['B5', 'B4']).rename('NDCI');

    // TSI — Trophic State Index proxy (Carlson, 1977)
    var tsi = ndci.multiply(100).add(50).rename('TSI');

    // AWEIn — Automated Water Extraction, noise-reduced (Feyisa et al., 2014)
    var awein = img.expression(
      '4.0 * (GREEN - SWIR1) - (0.25 * NIR + 2.75 * SWIR2)', {
      GREEN: img.select('B3'), SWIR1: img.select('B11'),
      NIR: img.select('B8'), SWIR2: img.select('B12')
    }
    ).rename('AWEIn');

    return img.addBands([ndwi, ndti, ndci, tsi, awein]);
  }


  // ============================================================================
  // SECTION 3: UI LAYOUT
  // ============================================================================

  ui.root.clear();

  // ── Three-panel layout: Sidebar | Map | Analytics ───────────────────────────
  var sidebar = ui.Panel({ style: { width: '400px', padding: '15px' } });
  var mapPanel = ui.Map();
  var analytics = ui.Panel({ style: { width: '480px', shown: false } });

  ui.root.add(sidebar).add(mapPanel).add(analytics);

  // Map configuration
  mapPanel.centerObject(DEFAULT_ROI, 15);
  mapPanel.setOptions('HYBRID');
  mapPanel.style().set('cursor', 'crosshair');

  // Enable drawing tools (for polygon analysis)
  var drawTools = mapPanel.drawingTools();
  drawTools.setShown(true);
  drawTools.setLinked(false);
  drawTools.setDrawModes(['polygon', 'rectangle']);

  // ── Sidebar Header ──────────────────────────────────────────────────────────
  sidebar.add(ui.Label('MIMOSA MINE — RS ENGINE', S.title));
  sidebar.add(ui.Label('Remote Sensing Component of the Integrated WQ Framework', S.body));

  // Status bar (updated throughout the workflow)
  var globalStatus = ui.Label('System ready. Begin with Stage 1.', S.pending);


  // ============================================================================
  // SECTION 4: STAGE 1 — SPECTRAL INDEX ANALYSIS
  // ============================================================================

  var stage1 = ui.Panel({ style: S.card });
  stage1.add(ui.Label('STAGE 1: COMPUTE SPECTRAL INDICES', S.heading));
  stage1.add(ui.Label(
    'Select a date range and the indices to compute.\n' +
    'Results appear as layers in the map panel (top-right toggle).', S.body
  ));

  // ── Date Range Selector ─────────────────────────────────────────────────────
  var dateRow = ui.Panel({ layout: ui.Panel.Layout.Flow('horizontal'), style: { margin: '8px 0' } });
  dateRow.add(ui.Label('Start:', { fontSize: '12px', margin: '4px 4px 0 0' }));
  var startDate = ui.Textbox({ value: '2024-01-01', style: { width: '110px' } });
  dateRow.add(startDate);
  dateRow.add(ui.Label('End:', { fontSize: '12px', margin: '4px 8px 0 4px' }));
  var endDate = ui.Textbox({ value: '2024-12-31', style: { width: '110px' } });
  dateRow.add(endDate);
  stage1.add(dateRow);

  // ── Index Checkboxes ────────────────────────────────────────────────────────
  stage1.add(ui.Label('Select indices to compute:', { fontSize: '12px', fontWeight: 'bold', margin: '8px 0 4px 0' }));
  var chkNDWI = ui.Checkbox('NDWI — Water Extent (McFeeters)', true);
  var chkNDTI = ui.Checkbox('NDTI — Turbidity / Sediment (Lacaux)', true);
  var chkNDCI = ui.Checkbox('NDCI — Chlorophyll-a (Mishra)', false);
  var chkTSI = ui.Checkbox('TSI — Trophic State (Carlson)', false);
  var chkAWEIn = ui.Checkbox('AWEIn — Water Detection (Feyisa)', false);
  var useRiverLayer = ui.Checkbox('Use uploaded river shapefile as analysis region', false);
  stage1.add(chkNDWI).add(chkNDTI).add(chkNDCI).add(chkTSI).add(chkAWEIn).add(useRiverLayer);

  // ── Stage 1 Status ──────────────────────────────────────────────────────────
  var stage1Status = ui.Label('⏳ Waiting for user to run indices...', S.pending);

  // ── RUN INDICES BUTTON ──────────────────────────────────────────────────────
  var runIndicesBtn = ui.Button({
    label: '🚀 RUN SPECTRAL INDICES',
    onClick: function () {
      stage1Status.setValue('⏳ Processing Sentinel-2 imagery...');
      stage1Status.style().set('color', '#d97706');

      // Determine analysis region (drawn polygon or default)
      var drawnLayers = drawTools.layers();
      if (drawnLayers.length() > 0) {
        activeROI = drawnLayers.get(0).toGeometry();
        globalStatus.setValue('Using drawn polygon as analysis region.');
      } else if (useRiverLayer.getValue()) {
        activeROI = riverFeatures.geometry();
        globalStatus.setValue('Using uploaded river shapefile as analysis region.');
      } else {
        activeROI = DEFAULT_ROI;
      }

      // Filter Sentinel-2 collection
      var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(activeROI)
        .filterDate(startDate.getValue(), endDate.getValue())
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 15))
        .map(preprocessSentinel2);

      // Create median composite and compute indices
      var composite = s2.median().clip(activeROI);
      var withIndices = computeAllIndices(composite);

      // Store for Stages 2 & 3
      processedComposite = withIndices;

      // Water mask (pixels where NDWI > 0 are water)
      var waterMask = withIndices.select('NDWI').gt(0);

      // ── Add RS input layers to the map (Commented out to improve load/rendering speed) ──
      // Clear previous layers
      mapPanel.layers().reset();

      /*
      mapPanel.addLayer(
        composite, { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3 },
        '[RS] True Color (B4-B3-B2)', true
      );
      mapPanel.addLayer(
        composite, { bands: ['B8', 'B4', 'B3'], min: 0, max: 0.4 },
        '[RS] False Color NIR (B8-B4-B3)', false
      );
      mapPanel.addLayer(
        composite, { bands: ['B12', 'B8', 'B4'], min: 0, max: 0.3 },
        '[RS] SWIR Composite (B12-B8-B4)', false
      );
      */

      // ── Add selected index layers ───────────────────────────────────────
      if (chkNDWI.getValue()) {
        mapPanel.addLayer(
          withIndices.select('NDWI').updateMask(waterMask),
          { min: -0.5, max: 0.8, palette: ['#8B4513', '#D2B48C', 'white', '#87CEEB', '#00008B'] },
          '[INDEX] NDWI — Water Extent', true
        );
      }
      if (chkNDTI.getValue()) {
        mapPanel.addLayer(
          withIndices.select('NDTI').updateMask(waterMask),
          { min: -0.15, max: 0.15, palette: ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'] },
          '[INDEX] NDTI — Turbidity', true
        );
      }
      if (chkNDCI.getValue()) {
        mapPanel.addLayer(
          withIndices.select('NDCI').updateMask(waterMask),
          { min: -0.1, max: 0.1, palette: ['#d73027', '#fc8d59', '#fee08b', '#91cf60', '#1a9850'] },
          '[INDEX] NDCI — Chlorophyll-a', true
        );
      }
      if (chkTSI.getValue()) {
        mapPanel.addLayer(
          withIndices.select('TSI').updateMask(waterMask),
          { min: 30, max: 80, palette: ['#2166ac', '#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b'] },
          '[INDEX] TSI — Trophic State', true
        );
      }
      if (chkAWEIn.getValue()) {
        mapPanel.addLayer(
          withIndices.select('AWEIn').updateMask(waterMask),
          { min: -0.1, max: 0.3, palette: ['white', '#a6bddb', '#2b8cbe', '#045a8d'] },
          '[INDEX] AWEIn — Water Detection', true
        );
      }

      // Add sample points overlay
      mapPanel.addLayer(samplePoints, { color: '#ff00ff' }, 'Sample Points (In-Situ)', true);

      // Zoom to active region
      mapPanel.centerObject(activeROI, 15);

      // ── Compute & display zonal summary ─────────────────────────────────
      var indexBands = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'];
      var stats = withIndices.select(indexBands).reduceRegion({
        reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true)
          .combine(ee.Reducer.minMax(), null, true),
        geometry: activeROI,
        scale: 10,
        maxPixels: 1e9
      });

      stats.evaluate(function (result) {
        if (!result) {
          stage1Status.setValue('⚠️ Error: No data found for selected date range.');
          stage1Status.style().set('color', '#dc2626');
          return;
        }

        // Build summary text
        var txt = '── INDEX RESULTS SUMMARY ──────────────\n';

        function fmt(name) {
          var mean = result[name + '_mean'];
          var std = result[name + '_stdDev'];
          var mn = result[name + '_min'];
          var mx = result[name + '_max'];
          if (mean === undefined || mean === null) return name + ':  No data\n';
          return name + ':  Mean=' + mean.toFixed(4) +
            '  StdDev=' + (std ? std.toFixed(4) : '?') +
            '  [' + (mn ? mn.toFixed(3) : '?') + ' → ' + (mx ? mx.toFixed(3) : '?') + ']\n';
        }

        txt += fmt('NDWI') + fmt('NDTI') + fmt('NDCI') + fmt('TSI') + fmt('AWEIn');

        // Add interpretations
        var ndwiMean = result['NDWI_mean'] || 0;
        var ndtiMean = result['NDTI_mean'] || 0;
        var tsiMean = result['TSI_mean'] || 50;

        txt += '\n── INTERPRETATION ─────────────────────\n';
        txt += 'NDWI: ' + (ndwiMean > 0.3 ? 'Strong water signal' : ndwiMean > 0 ? 'Water present' : 'Minimal water') + '\n';
        txt += 'NDTI: ' + (ndtiMean > 0.1 ? '⚠ High turbidity' : ndtiMean > 0 ? 'Moderate sediment' : 'Low sediment') + '\n';
        txt += 'TSI:  ' + (tsiMean < 40 ? 'Oligotrophic (clean)' : tsiMean < 50 ? 'Mesotrophic (moderate)' : tsiMean < 70 ? '⚠ Eutrophic (enriched)' : '⚠ Hypereutrophic (critical)') + '\n';

        // Display in sidebar
        if (summaryPanel.widgets().length() > 1) {
          summaryPanel.widgets().remove(summaryPanel.widgets().get(1));
        }
        summaryPanel.add(ui.Label(txt, S.mono));

        stage1Status.setValue('✅ Stage 1 Complete. Indices computed and layers added.');
        stage1Status.style().set('color', '#059669');
        globalStatus.setValue('Stage 1 done. Proceed to Stage 2 for analysis charts.');
      });
    },
    style: S.runBtn
  });

  stage1.add(runIndicesBtn);
  stage1.add(stage1Status);

  // Summary display panel (populated after Run)
  var summaryPanel = ui.Panel({ style: { margin: '4px 0' } });
  summaryPanel.add(ui.Label('Index results will appear here after running.', S.pending));
  stage1.add(summaryPanel);

  sidebar.add(stage1);


  // ============================================================================
  // SECTION 5: STAGE 2 — SPATIAL ANALYSIS & CHARTS
  // ============================================================================

  var stage2 = ui.Panel({ style: S.card });
  stage2.add(ui.Label('STAGE 2: ANALYSIS & TEMPORAL CHARTS', S.heading));
  stage2.add(ui.Label(
    'Generate time-series trends and climate correlations.\n' +
    'Charts open in the right analytics panel.', S.body
  ));

  var stage2Status = ui.Label('⏳ Waiting for Stage 1 to complete...', S.pending);

  var runAnalysisBtn = ui.Button({
    label: '📊 GENERATE ANALYSIS',
    onClick: function () {
      if (!processedComposite) {
        stage2Status.setValue('⚠️ Run Stage 1 first!');
        stage2Status.style().set('color', '#dc2626');
        return;
      }

      stage2Status.setValue('⏳ Generating charts...');
      stage2Status.style().set('color', '#d97706');

      // Open right panel
      analytics.clear();
      analytics.style().set('shown', true);

      analytics.add(ui.Label('INTEGRATED AREA ANALYTICS', S.title));
      analytics.add(ui.Label('Time-series and climate analysis for the selected region.', S.body));

      // ── Chart A: Multi-Index Temporal Trend ──────────────────────────────
      var s2TimeSeries = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(activeROI)
        .filterDate(startDate.getValue(), endDate.getValue())
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(preprocessSentinel2)
        .map(computeAllIndices);

      var trendChart = ui.Chart.image.series({
        imageCollection: s2TimeSeries.select(['NDWI', 'NDTI', 'NDCI']),
        region: activeROI,
        reducer: ee.Reducer.mean(),
        scale: 20
      }).setOptions({
        title: 'Chart A: Water Quality Index Trends',
        hAxis: { title: 'Date', format: 'MMM yyyy' },
        vAxis: { title: 'Index Value' },
        lineWidth: 2, pointSize: 3,
        series: {
          0: { color: '#2563eb', label: 'NDWI (Water)' },
          1: { color: '#92400e', label: 'NDTI (Turbidity)' },
          2: { color: '#15803d', label: 'NDCI (Chlorophyll)' }
        },
        curveType: 'function'
      });
      analytics.add(trendChart);

      // ── Chart B: TSI Temporal Trend ──────────────────────────────────────
      var tsiChart = ui.Chart.image.series({
        imageCollection: s2TimeSeries.select(['TSI']),
        region: activeROI,
        reducer: ee.Reducer.mean(),
        scale: 20
      }).setOptions({
        title: 'Chart B: Trophic State Index Over Time',
        hAxis: { title: 'Date' },
        vAxis: { title: 'TSI Score', viewWindow: { min: 20, max: 80 } },
        lineWidth: 2, pointSize: 3,
        colors: ['#dc2626'],
        curveType: 'function'
      });
      analytics.add(tsiChart);

      // ── Chart C: CHIRPS Rainfall (Climate Correlation) ───────────────────
      var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
        .filterBounds(activeROI)
        .filterDate(startDate.getValue(), endDate.getValue());

      var rainChart = ui.Chart.image.series({
        imageCollection: chirps,
        region: activeROI,
        reducer: ee.Reducer.mean(),
        scale: 5000
      }).setChartType('ColumnChart')
        .setOptions({
          title: 'Chart C: Daily Rainfall (CHIRPS) — Climate Correlation',
          hAxis: { title: 'Date' },
          vAxis: { title: 'Rainfall (mm)' },
          colors: ['#3b82f6'],
          bar: { groupWidth: '90%' },
          legend: { position: 'none' }
        });
      analytics.add(rainChart);

      // ── Chart D: Index Comparison Bar Chart ──────────────────────────────
      var indexBands = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'];
      var meanStats = processedComposite.select(indexBands).reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: activeROI,
        scale: 10,
        maxPixels: 1e9
      });

      meanStats.evaluate(function (vals) {
        if (!vals) return;
        var features = [];
        var names = Object.keys(vals);
        for (var i = 0; i < names.length; i++) {
          if (vals[names[i]] !== null) {
            features.push(ee.Feature(null, {
              Index: names[i],
              Mean_Value: vals[names[i]]
            }));
          }
        }
        var fc = ee.FeatureCollection(features);
        var barChart = ui.Chart.feature.byFeature(fc, 'Index', 'Mean_Value')
          .setChartType('ColumnChart')
          .setOptions({
            title: 'Chart D: Mean Index Values (Current Composite)',
            vAxis: { title: 'Mean Value' },
            colors: ['#6366f1'],
            legend: { position: 'none' },
            bar: { groupWidth: '60%' }
          });
        analytics.add(barChart);
      });

      // ── Close Button ────────────────────────────────────────────────────
      var closeBtn = ui.Button({
        label: '✕ Close Analytics Panel',
        onClick: function () { analytics.style().set('shown', false); },
        style: { stretch: 'horizontal', margin: '20px 0 0 0' }
      });
      analytics.add(closeBtn);

      // ── Tip for export ──────────────────────────────────────────────────
      analytics.add(ui.Label(
        '💡 TIP: Click the ↗ pop-out icon on any chart to export as CSV, PNG, or SVG.',
        { fontSize: '10px', color: '#6b7280', margin: '8px 0' }
      ));

      stage2Status.setValue('✅ Stage 2 Complete. Charts generated in right panel.');
      stage2Status.style().set('color', '#059669');
      globalStatus.setValue('Stage 2 done. Proceed to Stage 3 for Drive exports.');
    },
    style: S.runBtn
  });

  stage2.add(runAnalysisBtn);
  stage2.add(stage2Status);
  sidebar.add(stage2);


  // ============================================================================
  // SECTION 6: STAGE 3 — DOWNLOAD & EXPORT DATA
  // ============================================================================
  // NOTE: Export.toDrive() does NOT work in published GEE Apps (no Tasks tab).
  // Instead, we use getDownloadURL() to generate direct download links.
  // Save the downloaded files, then upload them to your shared Google Drive folder.

  var stage3 = ui.Panel({ style: S.card });
  stage3.add(ui.Label('STAGE 3: DOWNLOAD DATA', S.heading));
  stage3.add(ui.Label(
    'If using the GEE App:\n' +
    '1. Click a button below to generate a link.\n' +
    '2. Click the link to download the file to your PC.\n' +
    '3. Upload the file manually to your Drive folder.\n\n' +
    'If using Code Editor:\n' +
    'Files are queued in the "Tasks" tab. Click RUN there.', S.body
  ));

  // Panel to hold generated download links
  var downloadLinksPanel = ui.Panel({ style: { margin: '8px 0' } });
  var stage3Status = ui.Label('⏳ Waiting for Stage 1 to complete...', S.pending);

  // ── Download A: Training Data CSV ─────────────────────────────────────────
  var exportCSVBtn = ui.Button({
    label: '📋 Download Training Data (CSV)',
    onClick: function () {
      if (!processedComposite) {
        stage3Status.setValue('⚠️ Run Stage 1 first!');
        stage3Status.style().set('color', '#dc2626');
        return;
      }

      stage3Status.setValue('⏳ Generating training data download...');
      stage3Status.style().set('color', '#d97706');

      // Extract all band + index values at each sample point
      var extractBands = ['B2', 'B3', 'B4', 'B5', 'B8', 'B11', 'B12', 'NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'];
      var extracted = processedComposite.select(extractBands).sampleRegions({
        collection: samplePoints,
        properties: ['id', 'label'],
        scale: 10,
        geometries: true
      });

      // === CODE EDITOR DIRECT EXPORT ===
      // This sends the task directly to the 'Tasks' tab on the right side of the GEE editor.
      Export.table.toDrive({
        collection: extracted,
        description: 'Mimosa_Training_Data_CSV',
        folder: DRIVE_FOLDER,
        fileFormat: 'CSV'
      });

      // === APP UI DOWNLOAD LINK ===
      var selectors = ['id', 'label', 'B2', 'B3', 'B4', 'B5', 'B8', 'B11', 'B12', 'NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'];
      extracted.getDownloadURL('csv', selectors, 'Mimosa_Training_Data', function (url) {
        downloadLinksPanel.add(ui.Label('📋 Training Data CSV:', S.success));
        downloadLinksPanel.add(ui.Label(url, {
          fontSize: '10px', color: '#60a5fa', whiteSpace: 'pre-wrap'
        }).setUrl(url));

        stage3Status.setValue('✅ CSV Link ready! If in Code Editor, also check the "Tasks" tab to export directly to Drive.');
        stage3Status.style().set('color', '#059669');
      });
    },
    style: { stretch: 'horizontal', fontWeight: 'bold', color: '#4338ca' }
  });

  // ── Download B: Index Rasters (GeoTIFF) ───────────────────────────────────
  var exportRasterBtn = ui.Button({
    label: '🗺️ Download Index Rasters (GeoTIFF)',
    onClick: function () {
      if (!processedComposite) {
        stage3Status.setValue('⚠️ Run Stage 1 first!');
        stage3Status.style().set('color', '#dc2626');
        return;
      }

      stage3Status.setValue('⏳ Generating raster download...');
      stage3Status.style().set('color', '#d97706');

      var indexImage = processedComposite.select(['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn']);

      indexImage.getDownloadURL({
        name: 'Mimosa_WQ_Indices',
        bands: ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'],
        region: activeROI,
        scale: 10,
        format: 'GEO_TIFF'
      }, function (url) {
        if (url) {
          downloadLinksPanel.add(ui.Label('🗺️ Index Rasters GeoTIFF:', S.success));
          downloadLinksPanel.add(ui.Label(url, {
            fontSize: '10px', color: '#60a5fa', whiteSpace: 'pre-wrap'
          }).setUrl(url));
          stage3Status.setValue('✅ GeoTIFF ready! Click the link above to download.');
          stage3Status.style().set('color', '#059669');
        } else {
          stage3Status.setValue('⚠️ Error generating GeoTIFF. Area might be too large.');
          stage3Status.style().set('color', '#dc2626');
        }
      });
    },
    style: { stretch: 'horizontal' }
  });

  // ── Download C: Zonal Statistics CSV ──────────────────────────────────────
  var exportZonalBtn = ui.Button({
    label: '📈 Download Zonal Statistics (CSV)',
    onClick: function () {
      if (!processedComposite) {
        stage3Status.setValue('⚠️ Run Stage 1 first!');
        stage3Status.style().set('color', '#dc2626');
        return;
      }

      stage3Status.setValue('⏳ Computing zonal statistics...');
      stage3Status.style().set('color', '#d97706');

      var indexBands = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'];
      var stats = processedComposite.select(indexBands).reduceRegion({
        reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true)
          .combine(ee.Reducer.minMax(), null, true),
        geometry: activeROI,
        scale: 10,
        maxPixels: 1e9
      });

      stats.evaluate(function (result) {
        if (!result) {
          stage3Status.setValue('⚠️ No data to export.');
          return;
        }

        // Build a FeatureCollection from the stats
        var features = [];
        var indices = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'];
        for (var i = 0; i < indices.length; i++) {
          var name = indices[i];
          features.push(ee.Feature(null, {
            Index: name,
            Mean: result[name + '_mean'] || 0,
            StdDev: result[name + '_stdDev'] || 0,
            Min: result[name + '_min'] || 0,
            Max: result[name + '_max'] || 0
          }));
        }

        var fc = ee.FeatureCollection(features);
        var selectors = ['Index', 'Mean', 'StdDev', 'Min', 'Max'];
        fc.getDownloadURL('csv', selectors, 'Mimosa_Zonal_Stats', function (url) {
          if (url) {
            downloadLinksPanel.add(ui.Label('📈 Zonal Statistics CSV:', S.success));
            downloadLinksPanel.add(ui.Label(url, {
              fontSize: '10px', color: '#60a5fa', whiteSpace: 'pre-wrap'
            }).setUrl(url));
            stage3Status.setValue('✅ Zonal stats ready! Click the link above to download.');
            stage3Status.style().set('color', '#059669');
          } else {
            stage3Status.setValue('⚠️ Error generating Zonal Stats. Area might be too large.');
            stage3Status.style().set('color', '#dc2626');
          }
        });
      });
    },
    style: { stretch: 'horizontal' }
  });

  // ── Drive folder link ─────────────────────────────────────────────────────
  var driveLink = ui.Label(
    '📂 Open Google Drive Folder ↗',
    { fontSize: '11px', color: '#60a5fa', fontWeight: 'bold', margin: '8px 0' }
  ).setUrl('https://drive.google.com/drive/folders/1bapvthKzInFVloehVqh2QdKO74QPyRl4');

  stage3.add(exportCSVBtn);
  stage3.add(exportRasterBtn);
  stage3.add(exportZonalBtn);
  stage3.add(stage3Status);
  stage3.add(downloadLinksPanel);
  stage3.add(driveLink);
  stage3.add(ui.Label(
    '💡 After downloading, upload files to the shared Drive folder.\n' +
    'The Python Dashboard will sync from there automatically.',
    { fontSize: '10px', color: '#9ca3af', whiteSpace: 'pre-wrap', margin: '4px 0' }
  ));
  sidebar.add(stage3);


  // ============================================================================
  // SECTION 7: DRAWING TOOLS & MAP INTERACTION
  // ============================================================================

  var toolsPanel = ui.Panel({ style: S.card });
  toolsPanel.add(ui.Label('CUSTOM AREA ANALYSIS', S.heading));
  toolsPanel.add(ui.Label(
    'Draw a polygon or rectangle around any dam.\n' +
    'Then re-run Stage 1 to analyze that specific area.', S.body
  ));

  var clearDrawBtn = ui.Button({
    label: '🗑️ Clear All Drawings (Reset to Gorge Dam)',
    onClick: function () {
      drawTools.layers().reset();
      activeROI = DEFAULT_ROI;
      mapPanel.centerObject(DEFAULT_ROI, 15);
      globalStatus.setValue('Drawings cleared. Using default Gorge Dam ROI.');
    },
    style: { stretch: 'horizontal' }
  });
  toolsPanel.add(clearDrawBtn);
  sidebar.add(toolsPanel);


  // ── Map Click Inspector ─────────────────────────────────────────────────────
  mapPanel.onClick(function (coords) {
    if (!processedComposite) return; // Only works after Stage 1

    var pt = ee.Geometry.Point([coords.lon, coords.lat]);

    // Extract index values at click point
    var pixelVals = processedComposite.select(['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn'])
      .reduceRegion({
        reducer: ee.Reducer.first(),
        geometry: pt,
        scale: 10
      });

    pixelVals.evaluate(function (vals) {
      if (!vals || vals.NDWI === null) {
        globalStatus.setValue('No data at clicked point.');
        return;
      }

      // Open right panel with point report
      analytics.clear();
      analytics.style().set('shown', true);

      analytics.add(ui.Label('POINT INSPECTION REPORT', S.title));
      analytics.add(ui.Label(
        'Location: ' + coords.lon.toFixed(5) + ', ' + coords.lat.toFixed(5), S.body
      ));

      var report = '── SPECTRAL VALUES AT POINT ────────────\n';
      report += 'NDWI:  ' + (vals.NDWI !== null ? vals.NDWI.toFixed(4) : 'N/A') + '\n';
      report += 'NDTI:  ' + (vals.NDTI !== null ? vals.NDTI.toFixed(4) : 'N/A') + '\n';
      report += 'NDCI:  ' + (vals.NDCI !== null ? vals.NDCI.toFixed(4) : 'N/A') + '\n';
      report += 'TSI:   ' + (vals.TSI !== null ? vals.TSI.toFixed(1) : 'N/A') + '\n';
      report += 'AWEIn: ' + (vals.AWEIn !== null ? vals.AWEIn.toFixed(4) : 'N/A') + '\n';

      // Mimosa Mine Potable Water Compliance Interpretation
      report += '\n── MIMOSA MINE COMPLIANCE ──────────────\n';
      report += 'Standards: pH 6.5-7.5 | TSS 0-1 mg/L\n';
      report += '           E.coli=0 | Coliform<1000\n';
      report += '           Cl₂ 0.2-5 mg/L | EC<400 µS/cm\n';
      report += '───────────────────────────────────────\n';
      var ndti = vals.NDTI || 0;
      var tsi = vals.TSI || 50;
      // TSS proxy from NDTI (mine standard: 0-1 mg/L)
      if (ndti < -0.05) report += 'TSS:  ✅ COMPLIANT (Very low sediment — within 0-1 mg/L)\n';
      else if (ndti < 0.02) report += 'TSS:  ⚠️ CAUTION (Moderate sediment — likely 1-5 mg/L)\n';
      else report += 'TSS:  🚨 NON-COMPLIANT (High sediment — exceeds 1 mg/L)\n';
      // pH proxy from TSI/NDCI
      if (tsi < 55) report += 'pH:   ✅ Likely compliant (low algal activity → stable pH)\n';
      else if (tsi < 65) report += 'pH:   ⚠️ Moderate algal activity → possible pH drift\n';
      else report += 'pH:   🚨 High algal activity → pH risk outside 6.5-7.5\n';
      report += '\n⚠ E.coli, Coliform, Free Cl₂ require lab analysis.\n';

      analytics.add(ui.Label(report, S.mono));

      // Point time series
      var ptSeries = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(pt)
        .filterDate(startDate.getValue(), endDate.getValue())
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(preprocessSentinel2)
        .map(computeAllIndices);

      var ptChart = ui.Chart.image.series({
        imageCollection: ptSeries.select(['NDWI', 'NDTI']),
        region: pt,
        reducer: ee.Reducer.mean(),
        scale: 10
      }).setOptions({
        title: 'Temporal Trend at Clicked Point',
        lineWidth: 2, pointSize: 3,
        series: {
          0: { color: '#2563eb', label: 'NDWI' },
          1: { color: '#92400e', label: 'NDTI' }
        }
      });
      analytics.add(ptChart);

      analytics.add(ui.Button({
        label: '✕ Close',
        onClick: function () { analytics.style().set('shown', false); },
        style: { stretch: 'horizontal', margin: '12px 0 0 0' }
      }));
    });
  });


  // ============================================================================
  // SECTION 8: LEGEND & FOOTER
  // ============================================================================

  // ── EMA Compliance Legend ────────────────────────────────────────────────────
  var legendPanel = ui.Panel({ style: S.card });
  legendPanel.add(ui.Label('MIMOSA MINE COMPLIANCE LEGEND', { fontSize: '11px', fontWeight: 'bold' }));

  function legendRow(color, text) {
    return ui.Panel({
      widgets: [
        ui.Label('', { backgroundColor: color, padding: '8px', margin: '0 8px 0 0' }),
        ui.Label(text, { fontSize: '10px' })
      ],
      layout: ui.Panel.Layout.Flow('horizontal'),
      style: { margin: '2px 0' }
    });
  }

  legendPanel.add(legendRow('#1a9850', 'Compliant — TSS ≤1 mg/L, pH 6.5–7.5'));
  legendPanel.add(legendRow('#fee08b', 'Caution — Approaching limits'));
  legendPanel.add(legendRow('#d73027', 'Non-Compliant — Exceeds mine standards'));
  legendPanel.add(ui.Label(
    'Standards: pH 6.5-7.5 | TSS 0-1 | E.coli=0\n' +
    'Coliform <1000 | Cl₂ 0.2-5 | EC <400 µS/cm',
    { fontSize: '9px', color: '#6b7280', whiteSpace: 'pre', margin: '6px 0 0 0' }
  ));
  sidebar.add(legendPanel);

  // ── Global Status & Footer ──────────────────────────────────────────────────
  sidebar.add(globalStatus);

  sidebar.add(ui.Label(
    'Data: Sentinel-2 MSI L2A (ESA Copernicus)\n' +
    'Climate: CHIRPS v2.0 (UC Santa Barbara)\n' +
    'Exports: Google Drive → Python ML Dashboard',
    { fontSize: '9px', color: '#94a3b8', whiteSpace: 'pre', margin: '15px 0 0 0' }
  ));


  // ── Initial Map Load ────────────────────────────────────────────────────────
  mapPanel.addLayer(
    ee.Image().paint(ee.FeatureCollection(DEFAULT_ROI), 0, 2),
    { palette: ['#818cf8'] },
    'Gorge Dam ROI Boundary', true
  );
  mapPanel.addLayer(
    riverFeatures,
    { color: '#00ffff' },
    'Uploaded Rivers / Tributaries', false
  );

  print('✅ Mimosa Mine RS Engine (v4.0) loaded successfully.');
  print('Follow the 3-stage workflow in the left sidebar.');
  print('Drive export folder: ' + DRIVE_FOLDER);

} // End launchEngine
