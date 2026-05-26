/**
 * ============================================================================
 * MIMOSA MINE — INTEGRATED WATER QUALITY MONITORING SYSTEM
 * COMPONENT 1: GEE REMOTE SENSING ENGINE (v4.2 — Full Production)
 * ============================================================================
 *
 * @project   Mimosa Mine Water Quality Assessment Framework
 * @location  Gorge Dam & Retention Reservoirs, Mimosa Mine, Zvishavane
 * @author    Jena Sandra
 * @version   4.2 (Full Production Build — Modern Interface)
 *
 * ============================================================================
 * SYSTEM ARCHITECTURE
 * ============================================================================
 *
 * This script is COMPONENT 1 of a two-part integrated system:
 *
 *   ┌────────────────────────┐       ┌────────────────────────┐
 *   │  COMPONENT 1 (THIS)   │ Drive │  COMPONENT 2           │
 *   │  GEE RS Engine        │──────>│  Python ML Dashboard   │
 *   │  • Sentinel-2 Process │ CSV + │  • RF Regression Model │
 *   │  • Index Computation  │ TIFF  │  • R², RMSE, Plots     │
 *   │  • Spatial Layers     │       │  • Predictions & Maps  │
 *   └────────────────────────┘       └────────────────────────┘
 *
 * Google Drive folder "Mimosa_WQ_Exports" is the data bridge.
 * Drive Link: https://drive.google.com/drive/folders/1bapvthKzInFVloehVqh2QdKO74QPyRl4
 *
 * ============================================================================
 * RESEARCH OBJECTIVES ADDRESSED
 * ============================================================================
 *
 * Obj 2: Derive satellite-based water quality indices from Sentinel-2
 *        → Remote Sensing Analysis section (NDWI, NDTI, NDCI, TSI, AWEIn,
 *          SABI, FAI, EVI, MSAVI, CI)
 *
 * Obj 4: Assess spatio-temporal variations in water quality
 *        → Temporal Analytics section (multi-index time series,
 *          seasonal decomposition, rainfall correlation)
 *
 * Obj 5: Create a GIS-based decision support tool
 *        → The complete application shell with interactive map layers,
 *          point inspection, polygon analysis, and export pipeline
 *
 * Obj 3: Develop and validate an integrated WQ model (RS + in-situ)
 *        → Preliminary RF classification in-GEE + full model in
 *          COMPONENT 2 (Python Dashboard) using exported data
 *
 * ============================================================================
 * SPECTRAL INDEX REFERENCES
 * ============================================================================
 *
 * NDWI  — McFeeters, S.K. (1996). The use of the Normalized Difference
 *         Water Index in the delineation of open water features.
 *         Int. J. Remote Sensing, 17(7), 1425-1432.
 *         Formula: (Green - NIR) / (Green + NIR)
 *         Bands: (B3 - B8) / (B3 + B8)
 *
 * NDTI  — Lacaux, J.P. et al. (2007). Classification of ponds from
 *         high-spatial-resolution remote sensing: application to the
 *         monitoring of an aquatic ecotoxicology site.
 *         Formula: (Red - Green) / (Red + Green)
 *         Bands: (B4 - B3) / (B4 + B3)
 *
 * NDCI  — Mishra, S. & Mishra, D.R. (2012). Normalized difference
 *         chlorophyll index: A novel model for remote estimation of
 *         chlorophyll-a concentration in turbid productive waters.
 *         Remote Sensing of Environment, 117, 394-406.
 *         Formula: (RedEdge1 - Red) / (RedEdge1 + Red)
 *         Bands: (B5 - B4) / (B5 + B4)
 *
 * TSI   — Carlson, R.E. (1977). A trophic state index for lakes.
 *         Limnology & Oceanography, 22(2), 361-369.
 *         Proxy: NDCI * 100 + 50
 *         Range: <40 Oligotrophic, 40-50 Mesotrophic,
 *                50-70 Eutrophic, >70 Hypereutrophic
 *
 * AWEIn — Feyisa, G.L. et al. (2014). Automated Water Extraction Index:
 *         A new hand-designed water index for water mapping.
 *         Remote Sensing of Environment, 140, 23-35.
 *         Formula: 4*(Green-SWIR1) - (0.25*NIR + 2.75*SWIR2)
 *         Bands: 4*(B3-B11) - (0.25*B8 + 2.75*B12)
 *
 * SABI  — Alawadi, F. (2010). Detection of surface algal blooms using
 *         the newly developed algorithm. Remote Sensing of Environment.
 *         Formula: (NIR - Red) / (Green + Blue)
 *         Bands: (B8 - B4) / (B3 + B2)
 *
 * FAI   — Hu, C. (2009). A novel ocean color index to detect floating
 *         algae in the global oceans. Remote Sensing of Environment.
 *         Formula: NIR - (Red + (SWIR1 - Red) * (833 - 665) / (1614 - 665))
 *
 * EVI   — Huete, A.R. et al. (2002). Enhanced Vegetation Index.
 *         Formula: 2.5 * (NIR - Red) / (NIR + 6*Red - 7.5*Blue + 1)
 *
 * MSAVI — Qi, J. et al. (1994). Modified Soil-Adjusted Vegetation Index.
 *         Formula: (2*NIR + 1 - sqrt((2*NIR+1)² - 8*(NIR-Red))) / 2
 *
 * CI    — Contamination Index (Custom for Mining Environments)
 *         Formula: (NDTI + (1 - NDWI)) / 2
 *         Range: 0 (Clean) to 1 (Contaminated)
 *         Reference: Mimosa Mine Water Quality Standards (adapted from EMA S.I. 274/2000)
 *
 * ============================================================================
 * WATER QUALITY ASSESSMENT STANDARDS (MIMOSA INTERNAL STANDARDS)
 * ============================================================================
 *
 * Mimosa Mining Company Internal Potable Water Standards
 *
 * Parameter        | Mimosa Limit   | Class
 * ─────────────────|────────────────|──────────────
 * TSS              | 0 - 1 mg/L     | Compliant
 * pH               | 6.5 - 7.5      | Compliant
 * E.coli           | 0 cfu/100mL    | Compliant
 * Total Coliform   | <1000 cfu/100mL| Compliant
 * Free Chlorine    | 0.2 - 5 mg/L   | Compliant
 * Conductivity (EC)| <400 µS/cm     | Compliant
 *
 * ============================================================================
 */


// ============================================================================
// SECTION 0: AUTHENTICATION GATE
// ============================================================================

var ACCESS_PASSWORD = 'MimosaWQ2026';

ui.root.clear();

// Login screen with centered card
var loginBg = ui.Panel({
  style: { width: '100%', height: '100%', backgroundColor: '#0c0a1a' }
});

var loginBox = ui.Panel({
  layout: ui.Panel.Layout.Flow('vertical'),
  style: {
    width: '380px', margin: '100px auto 0 auto', padding: '36px 32px',
    backgroundColor: '#18162b', border: '1px solid #2d2b55', borderRadius: '16px'
  }
});

// Brand identity
loginBox.add(ui.Label('◆', {
  fontSize: '28px', color: '#818cf8', textAlign: 'center', margin: '0 0 4px 0'
}));
loginBox.add(ui.Label('MIMOSA MINE', {
  fontWeight: 'bold', fontSize: '20px', color: '#e0e7ff', textAlign: 'center', margin: '0'
}));
loginBox.add(ui.Label('Water Quality Intelligence Platform', {
  fontSize: '11px', color: '#6366f1', textAlign: 'center', margin: '4px 0 24px 0'
}));

// Input fields
var pwdField = ui.Textbox({
  placeholder: 'Enter access code',
  style: { width: '100%', margin: '0 0 12px 0' }
});
var pwdError = ui.Label('', {
  color: '#f87171', fontSize: '11px', shown: false, textAlign: 'center'
});

loginBox.add(pwdField);
loginBox.add(pwdError);

// Login button with validation
loginBox.add(ui.Button({
  label: 'ACCESS PLATFORM',
  onClick: function () {
    if (pwdField.getValue() === ACCESS_PASSWORD) {
      ui.root.clear();
      boot();
    } else {
      pwdError.setValue('Incorrect access code');
      pwdError.style().set('shown', true);
    }
  },
  style: { stretch: 'horizontal', color: '#818cf8', fontWeight: 'bold' }
}));

loginBox.add(ui.Label('GIS & Remote Sensing Research Platform', {
  fontSize: '9px', color: '#3730a3', textAlign: 'center', margin: '20px 0 0 0'
}));

loginBg.add(loginBox);
ui.root.add(loginBg);


// ============================================================================
// SECTION 1: MAIN PLATFORM BOOT
// ============================================================================

function boot() {

  // ── 1A. Study Area Configuration ────────────────────────────────────────────

  /**
   * Primary study area: Gorge Dam at Mimosa Platinum Mine
   * Coordinates: 29.84462°E, 20.31911°S
   * Buffer: 5000m to capture full dam extent and surrounding
   * influence zone including tailings, inlet streams, and outflow
   */
  var DAM_CENTER = ee.Geometry.Point([29.84462, -20.31911]);
  var DEFAULT_ROI = DAM_CENTER.buffer(5800); // Added 800 meters to the original 5000m radius (now 5800m)

  // River/tributary network table asset (Upload 'Gorge_dam_rivers.zip' from 'Rivers - Tributes' folder as a GEE Table Asset)
  var RIVERS_ASSET = 'projects/ee-sandiejena27/assets/Gorge_dam_rivers';
  var riverFeatures = ee.FeatureCollection(RIVERS_ASSET);

  // Shared Drive folder for export pipeline
  // URL: https://drive.google.com/drive/folders/1bapvthKzInFVloehVqh2QdKO74QPyRl4
  var DRIVE_FOLDER = 'Mimosa_WQ_Exports';

  // Dynamic state variables
  var activeROI = DEFAULT_ROI;
  var processedComposite = null;
  var selectedStart = '2024-01-01';
  var selectedEnd = '2024-12-31';
  var currentCollection = null;


  // ── 1B. In-situ Sample Point Network ────────────────────────────────────────

  /**
   * Spatially distributed sampling network across Gorge Dam.
   * 10 strategically placed points covering:
   *   - Dam center and cardinal directions
   *   - Inlet (upstream water source)
   *   - Outlet (discharge point)
   *   - Tailings-adjacent zone (contamination monitoring)
   *   - Upstream and downstream reference points
   *
   * *** REPLACE THESE WITH YOUR ACTUAL FIELD GPS COORDINATES ***
   * After export, merge the CSV with your laboratory measurements.
   */
  var samplePoints = ee.FeatureCollection([
    ee.Feature(ee.Geometry.Point([29.84381885600004, -20.31754411099996]), { id: 'SP01', label: 'Testing Point 1', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.842569424000033, -20.31860980299996]), { id: 'SP02', label: 'Testing Point 2', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.84402097000003, -20.320410454999944]), { id: 'SP03', label: 'Testing Point 3', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.84560113300006, -20.31899565699996]), { id: 'SP04', label: 'Testing Point 4', zone: 'core' }),
    ee.Feature(ee.Geometry.Point([29.847088369000062, -20.320006020999926]), { id: 'SP05', label: 'Testing Point 5', zone: 'core' }),
  ]);

  // Simulated in-situ training labels for preliminary classification
  // Status: 0 = Compliant, 1 = Caution, 2 = Hazardous
  var trainingPoints = ee.FeatureCollection([
    ee.Feature(ee.Geometry.Point([29.84381885600004, -20.31754411099996]), { status: 0 }),
    ee.Feature(ee.Geometry.Point([29.842569424000033, -20.31860980299996]), { status: 1 }),
    ee.Feature(ee.Geometry.Point([29.84402097000003, -20.320410454999944]), { status: 1 }),
    ee.Feature(ee.Geometry.Point([29.84560113300006, -20.31899565699996]), { status: 0 }),
    ee.Feature(ee.Geometry.Point([29.847088369000062, -20.320006020999926]), { status: 2 }),
  ]);


  // ============================================================================
  // SECTION 2: SPECTRAL PROCESSING ENGINE
  // ============================================================================

  /**
   * preprocessS2 — Cloud masking and radiometric correction
   *
   * Uses Scene Classification Layer (SCL) to create a quality mask.
   * Retained classes:
   *   4 = Vegetation
   *   5 = Bare Soil
   *   6 = Water
   * Scales digital numbers to surface reflectance [0, 1].
   *
   * Critical: optical bands are selected BEFORE division to avoid
   * corrupting SCL integer values. Result is cast to ee.Image()
   * to preserve method chain compatibility.
   */
  function preprocessS2(img) {
    var scl = img.select('SCL');
    var clearMask = scl.eq(4).or(scl.eq(5)).or(scl.eq(6));

    var optical = img.select([
      'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'
    ]);

    var scaled = ee.Image(
      optical.updateMask(clearMask)
        .divide(10000)
        .copyProperties(img, ['system:time_start'])
    );
    return scaled;
  }

  /**
   * addIndices — Comprehensive water quality index computation
   *
   * Computes 10 spectral indices covering:
   *   - Water detection (NDWI, AWEIn)
   *   - Turbidity/sediment (NDTI, CI)
   *   - Algal/chlorophyll (NDCI, TSI, SABI, FAI)
   *   - Vegetation vigor/riparian (EVI, MSAVI)
   */
  function addIndices(img) {
    // ── Water Detection Indices ────────────────────────────
    var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
    var awein = img.expression(
      '4.0*(GREEN-SWIR1) - (0.25*NIR + 2.75*SWIR2)', {
      GREEN: img.select('B3'), SWIR1: img.select('B11'),
      NIR: img.select('B8'), SWIR2: img.select('B12')
    }).rename('AWEIn');

    // ── Turbidity / Sediment Indices ───────────────────────
    var ndti = img.normalizedDifference(['B4', 'B3']).rename('NDTI');

    // ── Chlorophyll / Trophic Indices ──────────────────────
    var ndci = img.normalizedDifference(['B5', 'B4']).rename('NDCI');
    var tsi = ndci.multiply(100).add(50).rename('TSI');
    var sabi = img.expression(
      '(NIR - RED) / (GREEN + BLUE)', {
      NIR: img.select('B8'), RED: img.select('B4'),
      GREEN: img.select('B3'), BLUE: img.select('B2')
    }).rename('SABI');
    var fai = img.expression(
      'NIR - (RED + (SWIR1 - RED) * (833.0 - 665.0) / (1614.0 - 665.0))', {
      NIR: img.select('B8'), RED: img.select('B4'), SWIR1: img.select('B11')
    }).rename('FAI');

    // ── Vegetation / Riparian Indices ──────────────────────
    var evi = img.expression(
      '2.5 * (NIR - RED) / (NIR + 6.0*RED - 7.5*BLUE + 1.0)', {
      NIR: img.select('B8'), RED: img.select('B4'), BLUE: img.select('B2')
    }).rename('EVI');
    var msavi = img.expression(
      '(2.0*NIR + 1.0 - sqrt(pow(2.0*NIR + 1.0, 2) - 8.0*(NIR - RED))) / 2.0', {
      NIR: img.select('B8'), RED: img.select('B4')
    }).rename('MSAVI');

    // ── Contamination Index (Custom) ───────────────────────
    var ci = ndti.add(ee.Image(1).subtract(ndwi)).divide(2).rename('CI');

    return img.addBands([ndwi, awein, ndti, ndci, tsi, sabi, fai, evi, msavi, ci]);
  }


  // ============================================================================
  // SECTION 3: UI SHELL — MODERN LAYOUT
  // ============================================================================

  ui.root.clear();

  // Three-column layout: Navigation | Map | Analytics
  var nav = ui.Panel({
    style: { width: '360px', padding: '0', backgroundColor: '#fafafe' }
  });
  var mapView = ui.Map();
  var rightPane = ui.Panel({
    style: { width: '480px', shown: false, backgroundColor: '#fafafe' }
  });

  ui.root.add(nav).add(mapView).add(rightPane);

  // Map configuration
  mapView.centerObject(DEFAULT_ROI, 15);
  mapView.setOptions('HYBRID');
  mapView.style().set('cursor', 'crosshair');

  // Enable drawing tools for polygon analysis
  var drawTools = mapView.drawingTools();
  drawTools.setShown(true);
  drawTools.setLinked(false);
  drawTools.setDrawModes(['polygon', 'rectangle']);

  // Automatically update activeROI and status bar when drawing is completed or edited
  drawTools.onDraw(function (geom) {
    activeROI = geom;
    statusLbl.setValue('● Drawing captured — Click "Compute & Display" to analyze.');
    drawTools.setShape(null); // Automatically switch back to pan/navigation mode
  });
  drawTools.onEdit(function (geom) {
    activeROI = geom;
    statusLbl.setValue('● Drawing modified — Click "Compute & Display" to analyze.');
  });

  // ── Brand Header ────────────────────────────────────────────────────────────
  var brandBar = ui.Panel({
    style: { backgroundColor: '#1e1b4b', padding: '16px 20px', margin: '0' }
  });
  brandBar.add(ui.Label('◆  MIMOSA MINE', {
    fontSize: '16px', fontWeight: 'bold', color: '#c7d2fe', margin: '0'
  }));
  brandBar.add(ui.Label('Remote Sensing Intelligence', {
    fontSize: '10px', color: '#818cf8', margin: '2px 0 0 0'
  }));
  nav.add(brandBar);

  // ── Status Strip ────────────────────────────────────────────────────────────
  var statusStrip = ui.Panel({
    style: {
      backgroundColor: '#eef2ff', padding: '6px 20px',
      margin: '0', border: '1px solid #c7d2fe'
    }
  });
  var statusLbl = ui.Label('● Ready — Select parameters and compute', {
    fontSize: '10px', color: '#4338ca', fontWeight: 'bold'
  });
  statusStrip.add(statusLbl);
  nav.add(statusStrip);


  // ── Accordion Builder Utility ───────────────────────────────────────────────

  /**
   * Creates a collapsible section panel with header toggle.
   * @param {string} icon - Emoji icon for the section header
   * @param {string} title - Section title text
   * @param {string} accentColor - Color for the toggle button and arrow
   * @param {Array} contentWidgets - Array of ui widgets to add to section body
   * @param {boolean} startOpen - Whether the section starts expanded
   * @returns {Object} { panel, content, open(), close() }
   */
  function makeSection(icon, title, accentColor, contentWidgets, startOpen) {
    var isOpen = startOpen || false;

    var content = ui.Panel({
      style: {
        shown: isOpen, padding: '12px 20px 16px 20px',
        backgroundColor: '#ffffff'
      }
    });
    for (var w = 0; w < contentWidgets.length; w++) {
      content.add(contentWidgets[w]);
    }

    var headerRow = ui.Panel({
      layout: ui.Panel.Layout.Flow('horizontal'),
      style: {
        padding: '10px 20px', margin: '0',
        backgroundColor: '#ffffff',
        border: '1px solid #f1f5f9'
      }
    });

    var arrow = ui.Label(isOpen ? '▾' : '▸', {
      fontSize: '12px', color: accentColor,
      margin: '0 8px 0 0', fontWeight: 'bold'
    });
    var label = ui.Label(icon + '  ' + title, {
      fontSize: '13px', fontWeight: 'bold',
      color: '#1e293b', margin: '0', stretch: 'horizontal'
    });

    var toggleBtn = ui.Button({
      label: isOpen ? '−' : '+',
      onClick: function () {
        isOpen = !isOpen;
        content.style().set('shown', isOpen);
        arrow.setValue(isOpen ? '▾' : '▸');
        toggleBtn.setLabel(isOpen ? '−' : '+');
      },
      style: {
        padding: '0 6px', margin: '0',
        fontWeight: 'bold', color: accentColor
      }
    });

    headerRow.add(arrow);
    headerRow.add(label);
    headerRow.add(toggleBtn);

    var wrapper = ui.Panel({
      style: { margin: '0', padding: '0', border: '1px solid #e2e8f0' }
    });
    wrapper.add(headerRow);
    wrapper.add(content);

    return {
      panel: wrapper,
      content: content,
      open: function () {
        isOpen = true;
        content.style().set('shown', true);
        arrow.setValue('▾');
        toggleBtn.setLabel('−');
      },
      close: function () {
        isOpen = false;
        content.style().set('shown', false);
        arrow.setValue('▸');
        toggleBtn.setLabel('+');
      }
    };
  }


  // ============================================================================
  // SECTION 4: REMOTE SENSING ANALYSIS (Accordion Section)
  // ============================================================================

  // ── Date Range Controls (At Will Selection) ──────────────────────────────────
  var startBox = ui.Textbox({
    value: selectedStart,
    placeholder: 'YYYY-MM-DD',
    onChange: function (text) {
      selectedStart = text;
      statusLbl.setValue('● Date Range updated: ' + selectedStart + ' → ' + selectedEnd);
    },
    style: { width: '100px' }
  });

  var endBox = ui.Textbox({
    value: selectedEnd,
    placeholder: 'YYYY-MM-DD',
    onChange: function (text) {
      selectedEnd = text;
      statusLbl.setValue('● Date Range updated: ' + selectedStart + ' → ' + selectedEnd);
    },
    style: { width: '100px' }
  });

  // Dropdown for quick seasonal & annual presets
  var presetSelect = ui.Select({
    items: [
      'Custom (Enter dates below)',
      'Full Year 2024',
      'Dry Season 2024 (May-Oct)',
      'Wet Season 2024 (Nov-Apr)',
      'Full Year 2023',
      'Dry Season 2023 (May-Oct)',
      'Wet Season 2023 (Nov-Apr)',
      'Full Year 2022'
    ],
    placeholder: 'Quick Date Presets',
    value: 'Full Year 2024',
    onChange: function (key) {
      if (key === 'Full Year 2024') {
        selectedStart = '2024-01-01'; selectedEnd = '2024-12-31';
      } else if (key === 'Dry Season 2024 (May-Oct)') {
        selectedStart = '2024-05-01'; selectedEnd = '2024-10-31';
      } else if (key === 'Wet Season 2024 (Nov-Apr)') {
        selectedStart = '2024-11-01'; selectedEnd = '2025-04-30';
      } else if (key === 'Full Year 2023') {
        selectedStart = '2023-01-01'; selectedEnd = '2023-12-31';
      } else if (key === 'Dry Season 2023 (May-Oct)') {
        selectedStart = '2023-05-01'; selectedEnd = '2023-10-31';
      } else if (key === 'Wet Season 2023 (Nov-Apr)') {
        selectedStart = '2023-11-01'; selectedEnd = '2024-04-30';
      } else if (key === 'Full Year 2022') {
        selectedStart = '2022-01-01'; selectedEnd = '2022-12-31';
      }

      // Update textboxes visually to match preset
      if (key !== 'Custom (Enter dates below)') {
        startBox.setValue(selectedStart, false);
        endBox.setValue(selectedEnd, false);
      }
      statusLbl.setValue('● Date: ' + selectedStart + ' → ' + selectedEnd);
    },
    style: { stretch: 'horizontal', margin: '4px 0' }
  });

  var dateInputsPanel = ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    style: { stretch: 'horizontal', margin: '4px 0', backgroundColor: '#ffffff' }
  });
  dateInputsPanel.add(ui.Label('Start:', { fontSize: '11px', color: '#64748b', margin: '8px 4px 0 0' }));
  dateInputsPanel.add(startBox);
  dateInputsPanel.add(ui.Label('End:', { fontSize: '11px', color: '#64748b', margin: '8px 4px 0 8px' }));
  dateInputsPanel.add(endBox);

  // ── Index Selection Checkboxes ──────────────────────────────────────────────
  var idxLabel = ui.Label('Water Quality Indices', {
    fontSize: '11px', fontWeight: 'bold', color: '#6366f1', margin: '12px 0 4px 0'
  });
  var chkNDWI = ui.Checkbox('NDWI   Water Extent', true);
  var chkNDTI = ui.Checkbox('NDTI   Turbidity / Sediment', true);
  var chkNDCI = ui.Checkbox('NDCI   Chlorophyll-a', false);
  var chkTSI = ui.Checkbox('TSI    Trophic State', false);
  var chkAWEIn = ui.Checkbox('AWEIn  Water Detection', false);
  var chkSABI = ui.Checkbox('SABI   Algal Bloom', false);
  var chkFAI = ui.Checkbox('FAI    Floating Algae', false);
  var chkCI = ui.Checkbox('CI     Contamination Index', false);

  var vegLabel = ui.Label('Riparian / Vegetation', {
    fontSize: '11px', fontWeight: 'bold', color: '#6366f1', margin: '8px 0 4px 0'
  });
  var chkEVI = ui.Checkbox('EVI    Enhanced Vegetation', false);
  var chkMSAVI = ui.Checkbox('MSAVI  Modified Soil-Adj Veg', false);

  var riverLabel = ui.Label('Hydrology / Rivers', {
    fontSize: '11px', fontWeight: 'bold', color: '#6366f1', margin: '8px 0 4px 0'
  });
  var chkRivers = ui.Checkbox({
    label: 'Show River & Tributary Network',
    value: false,
    onChange: function (checked) {
      var layers = mapView.layers();
      for (var i = 0; i < layers.length(); i++) {
        var layer = layers.get(i);
        if (layer.getName() === 'Rivers & Tributaries Network') {
          layer.setShown(checked);
          break;
        }
      }
    }
  });
  var chkUseRivers = ui.Checkbox('Use rivers as analysis boundary', false);

  // ── Run Button & Status ─────────────────────────────────────────────────────
  var rsStatus = ui.Label('', { fontSize: '10px', color: '#6b7280', margin: '8px 0 0 0' });
  var imgCountLabel = ui.Label('', { fontSize: '10px', color: '#94a3b8', margin: '2px 0 0 0' });

  var runBtn = ui.Button({
    label: 'Compute & Display',
    onClick: function () {
      statusLbl.setValue('● Processing Sentinel-2...');
      rsStatus.setValue('');
      imgCountLabel.setValue('');

      // Determine analysis region
      var layers = drawTools.layers();
      if (layers.length() > 0) {
        activeROI = layers.get(0).getEeObject();
      } else if (chkUseRivers.getValue()) {
        activeROI = riverFeatures.geometry();
      } else {
        activeROI = DEFAULT_ROI;
      }

      // Build Sentinel-2 collection
      var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(activeROI)
        .filterDate(selectedStart, selectedEnd)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 15))
        .map(preprocessS2);

      currentCollection = s2;

      // Display image count
      s2.size().evaluate(function (count) {
        imgCountLabel.setValue('Scenes used: ' + count + ' Sentinel-2 images');
      });

      // Create median composite and compute ALL indices
      var composite = s2.median().clip(activeROI);
      var withIdx = addIndices(composite);
      processedComposite = withIdx;

      // Water mask
      var wMask = withIdx.select('NDWI').gt(0);

      // Clear map and add layers
      mapView.layers().reset();

      // ── RS INPUT LAYERS (Commented out to improve load/rendering speed) ──
      /*
      mapView.addLayer(
        composite, { bands: ['B4','B3','B2'], min: 0, max: 0.3 },
        'True Color (B4-B3-B2)', true
      );
      mapView.addLayer(
        composite, { bands: ['B8','B4','B3'], min: 0, max: 0.4 },
        'False Color NIR (B8-B4-B3)', false
      );
      mapView.addLayer(
        composite, { bands: ['B12','B8','B4'], min: 0, max: 0.3 },
        'SWIR Composite (B12-B8-B4)', false
      );
      */

      // ── WQ INDEX LAYERS (user-selected) ─────────────────────────────────
      var indexPalettes = {
        NDWI: { min: -0.5, max: 0.8, pal: ['#8B4513', '#D2B48C', '#fff', '#87CEEB', '#00008B'] },
        NDTI: { min: -0.15, max: 0.15, pal: ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'] },
        NDCI: { min: -0.1, max: 0.1, pal: ['#d73027', '#fc8d59', '#fee08b', '#91cf60', '#1a9850'] },
        TSI: { min: 30, max: 80, pal: ['#2166ac', '#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b'] },
        AWEIn: { min: -0.1, max: 0.3, pal: ['#fff', '#a6bddb', '#2b8cbe', '#045a8d'] },
        SABI: { min: -0.5, max: 0.5, pal: ['#d73027', '#fee08b', '#1a9850'] },
        FAI: { min: -0.01, max: 0.02, pal: ['#2166ac', '#f7f7f7', '#1a9850'] },
        CI: { min: 0, max: 1, pal: ['#1a9850', '#fee08b', '#d73027'] },
        EVI: { min: -0.2, max: 0.8, pal: ['#fff5eb', '#a1d99b', '#006d2c'] },
        MSAVI: { min: -0.2, max: 0.8, pal: ['#fff5eb', '#a1d99b', '#006d2c'] }
      };

      var checks = {
        NDWI: chkNDWI, NDTI: chkNDTI, NDCI: chkNDCI, TSI: chkTSI,
        AWEIn: chkAWEIn, SABI: chkSABI, FAI: chkFAI, CI: chkCI,
        EVI: chkEVI, MSAVI: chkMSAVI
      };

      var labels = {
        NDWI: 'NDWI (Water)', NDTI: 'NDTI (Turbidity)', NDCI: 'NDCI (Chlorophyll)',
        TSI: 'TSI (Trophic)', AWEIn: 'AWEIn (Water Det.)', SABI: 'SABI (Algal)',
        FAI: 'FAI (Float. Algae)', CI: 'CI (Contamination)',
        EVI: 'EVI (Vegetation)', MSAVI: 'MSAVI (Soil-Adj Veg)'
      };

      var idxNames = Object.keys(checks);
      for (var i = 0; i < idxNames.length; i++) {
        var name = idxNames[i];
        if (checks[name].getValue()) {
          var vis = indexPalettes[name];
          // Use water mask for WQ indices, no mask for vegetation indices
          var masked = (name === 'EVI' || name === 'MSAVI')
            ? withIdx.select(name)
            : withIdx.select(name).updateMask(wMask);
          mapView.addLayer(masked, { min: vis.min, max: vis.max, palette: vis.pal }, labels[name], true);
        }
      }

      // Sample points overlay
      mapView.addLayer(samplePoints, { color: '#ff00ff' }, 'Sample Points', true);
      mapView.centerObject(activeROI, 15);

      // ── Floating Results Card (Map Overlay) ─────────────────────────────
      var indexBands = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'CI'];
      withIdx.select(indexBands).reduceRegion({
        reducer: ee.Reducer.mean().combine(ee.Reducer.minMax(), null, true),
        geometry: activeROI, scale: 10, maxPixels: 1e9
      }).evaluate(function (r) {
        if (!r) { statusLbl.setValue('● No data found for date range'); return; }

        // Build floating card
        var floater = ui.Panel({
          style: {
            position: 'bottom-left', width: '320px', padding: '14px',
            backgroundColor: 'rgba(15,23,42,0.92)', borderRadius: '10px',
            border: '1px solid #334155', margin: '0 0 10px 10px'
          }
        });

        floater.add(ui.Label('Index Summary — Zonal Statistics', {
          fontSize: '12px', fontWeight: 'bold', color: '#e0e7ff', margin: '0 0 8px 0'
        }));

        function statRow(name) {
          var v = r[name + '_mean'];
          var mn = r[name + '_min'];
          var mx = r[name + '_max'];
          if (v === null || v === undefined) return;
          var row = ui.Panel({ layout: ui.Panel.Layout.Flow('horizontal'), style: { margin: '2px 0' } });
          row.add(ui.Label(name, { fontSize: '11px', fontWeight: 'bold', color: '#93c5fd', width: '50px' }));
          row.add(ui.Label(v.toFixed(4), { fontSize: '11px', color: '#e2e8f0', width: '72px' }));
          row.add(ui.Label('[' + (mn !== null ? mn.toFixed(3) : '?') + ' → ' + (mx !== null ? mx.toFixed(3) : '?') + ']', {
            fontSize: '9px', color: '#64748b'
          }));
          floater.add(row);
        }
        statRow('NDWI'); statRow('NDTI'); statRow('NDCI');
        statRow('TSI'); statRow('AWEIn'); statRow('CI');

        // Contamination interpretation
        var ndtiVal = r['NDTI_mean'] || 0;
        var tsiVal = r['TSI_mean'] || 50;
        var ciVal = r['CI_mean'] || 0;

        var interpTxt = '';
        interpTxt += 'Turbidity: ' + (ndtiVal > 0.1 ? '⚠ HIGH' : ndtiVal > 0 ? 'Moderate' : 'Low') + '  |  ';
        interpTxt += 'TSI: ' + (tsiVal < 40 ? 'Oligotrophic' : tsiVal < 50 ? 'Mesotrophic' : tsiVal < 70 ? 'Eutrophic' : 'Hypereutrophic');

        floater.add(ui.Label(interpTxt, { fontSize: '9px', color: '#94a3b8', margin: '6px 0 2px 0' }));

        // Overall Mimosa compliance status
        var mimosaStatus = ciVal < 0.3 ? '✓ COMPLIANT' : ciVal < 0.6 ? '⚠ CAUTION' : '✕ NON-COMPLIANT';
        var mimosaColor = ciVal < 0.3 ? '#10b981' : ciVal < 0.6 ? '#f59e0b' : '#ef4444';
        floater.add(ui.Label('Mimosa Status: ' + mimosaStatus, {
          fontSize: '11px', fontWeight: 'bold', color: mimosaColor, margin: '4px 0 0 0'
        }));

        mapView.add(floater);
        statusLbl.setValue('● Analysis complete — ' + imgCountLabel.getValue());
        rsStatus.setValue('✓ Layers added to map. Toggle in Layers panel (top-right) →');
      });
    },
    style: { stretch: 'horizontal', color: '#4338ca', fontWeight: 'bold' }
  });

  // ── Build Accordion Section ─────────────────────────────────────────────────
  var rsSection = makeSection('📡', 'Remote Sensing Analysis', '#4338ca', [
    ui.Label('Date Range Select', { fontSize: '11px', fontWeight: 'bold', color: '#6366f1', margin: '0 0 4px 0' }),
    presetSelect,
    dateInputsPanel,
    idxLabel, chkNDWI, chkNDTI, chkNDCI, chkTSI, chkAWEIn, chkSABI, chkFAI, chkCI,
    vegLabel, chkEVI, chkMSAVI,
    riverLabel, chkRivers, chkUseRivers,
    runBtn, rsStatus, imgCountLabel
  ], true);
  nav.add(rsSection.panel);


  // ============================================================================
  // SECTION 5: PRELIMINARY ML CLASSIFICATION (In-GEE Preview)
  // ============================================================================

  var mlStatus = ui.Label('', { fontSize: '10px', color: '#6b7280', margin: '4px 0 0 0' });

  var runMLBtn = ui.Button({
    label: 'Run Preliminary Classification',
    onClick: function () {
      if (!processedComposite) {
        mlStatus.setValue('Run RS Analysis first');
        return;
      }
      statusLbl.setValue('● Training Random Forest...');
      mlStatus.setValue('');

      var predictorBands = ['B2', 'B3', 'B4', 'B5', 'B8', 'B11', 'B12', 'NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'CI'];

      // Sample training data from composite
      var trainingData = processedComposite.select(predictorBands).sampleRegions({
        collection: trainingPoints,
        properties: ['status'],
        scale: 10
      });

      // Split 70/30
      var split = trainingData.randomColumn('rand');
      var trainSet = split.filter(ee.Filter.lt('rand', 0.7));
      var testSet = split.filter(ee.Filter.gte('rand', 0.7));

      // Train Random Forest (500 trees)
      var rf = ee.Classifier.smileRandomForest(500).train({
        features: trainSet,
        classProperty: 'status',
        inputProperties: predictorBands
      });

      // Predict across entire image
      var prediction = processedComposite.select(predictorBands).classify(rf);
      var wMask = processedComposite.select('NDWI').gt(0);

      mapView.addLayer(
        prediction.updateMask(wMask),
        { min: 0, max: 2, palette: ['#10b981', '#f59e0b', '#dc2626'] },
        'ML Classification (RF-500)', true
      );

      // Accuracy assessment
      var validated = testSet.classify(rf);
      var errMatrix = validated.errorMatrix('status', 'classification');
      print('── ML ACCURACY ASSESSMENT ──');
      print('Confusion Matrix:', errMatrix);
      print('Overall Accuracy:', errMatrix.accuracy());
      print('Kappa Coefficient:', errMatrix.kappa());

      // Variable importance
      var importance = rf.explain();
      print('Variable Importance:', importance);

      statusLbl.setValue('● ML classification complete');
      mlStatus.setValue('✓ Prediction layer added. Accuracy in Console tab →');
    },
    style: { stretch: 'horizontal', color: '#7c3aed', fontWeight: 'bold' }
  });

  var mlSection = makeSection('🤖', 'ML Classification Preview', '#7c3aed', [
    ui.Label('Random Forest (500 trees) trained on sample points.\nFull model runs in the Python Dashboard.', {
      fontSize: '10px', color: '#6b7280', whiteSpace: 'pre-wrap'
    }),
    runMLBtn, mlStatus
  ], false);
  nav.add(mlSection.panel);


  // ============================================================================
  // SECTION 6: TEMPORAL ANALYTICS
  // ============================================================================

  var analyticsBtn = ui.Button({
    label: 'Generate Charts',
    onClick: function () {
      if (!processedComposite) { statusLbl.setValue('● Run analysis first'); return; }
      statusLbl.setValue('● Loading charts...');

      rightPane.clear();
      rightPane.style().set('shown', true);

      // Header with close button
      var closeRow = ui.Panel({
        layout: ui.Panel.Layout.Flow('horizontal'),
        style: { padding: '12px 16px', backgroundColor: '#1e1b4b' }
      });
      closeRow.add(ui.Label('Temporal Analytics Dashboard', {
        fontSize: '14px', fontWeight: 'bold', color: '#e0e7ff', stretch: 'horizontal'
      }));
      closeRow.add(ui.Button({
        label: '✕', style: { color: '#ef4444', padding: '0 8px' },
        onClick: function () { rightPane.style().set('shown', false); }
      }));
      rightPane.add(closeRow);
      rightPane.add(ui.Label(
        'Pop out any chart (↗ icon) to export as CSV, PNG, or SVG.',
        { fontSize: '9px', color: '#94a3b8', margin: '4px 16px 8px 16px' }
      ));

      // Build time series collection
      var ts = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(activeROI)
        .filterDate(selectedStart, selectedEnd)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(preprocessS2)
        .map(addIndices);

      // ── Chart A: Multi-Index Temporal Trend ──────────────────────────────
      rightPane.add(ui.Chart.image.series({
        imageCollection: ts.select(['NDWI', 'NDTI', 'NDCI']),
        region: activeROI, reducer: ee.Reducer.mean(), scale: 20
      }).setOptions({
        title: 'Water Quality Index Trends',
        hAxis: { title: '', format: 'MMM yyyy' },
        vAxis: { title: 'Index Value' },
        lineWidth: 2, pointSize: 3, curveType: 'function',
        series: {
          0: { color: '#2563eb', label: 'NDWI' },
          1: { color: '#92400e', label: 'NDTI' },
          2: { color: '#15803d', label: 'NDCI' }
        }
      }));

      // ── Chart B: Trophic State ───────────────────────────────────────────
      rightPane.add(ui.Chart.image.series({
        imageCollection: ts.select(['TSI']),
        region: activeROI, reducer: ee.Reducer.mean(), scale: 20
      }).setOptions({
        title: 'Trophic State Index (TSI) Progression',
        vAxis: { title: 'TSI Score', viewWindow: { min: 20, max: 80 } },
        lineWidth: 2, pointSize: 3, colors: ['#dc2626'], curveType: 'function'
      }));

      // ── Chart C: Contamination Index ─────────────────────────────────────
      rightPane.add(ui.Chart.image.series({
        imageCollection: ts.select(['CI']),
        region: activeROI, reducer: ee.Reducer.mean(), scale: 20
      }).setOptions({
        title: 'Contamination Index (CI) — Mining Impact',
        vAxis: { title: 'CI Score (0=Clean, 1=Contaminated)' },
        lineWidth: 2, pointSize: 3, colors: ['#b45309'], curveType: 'function'
      }));

      // ── Chart D: CHIRPS Rainfall ─────────────────────────────────────────
      var rain = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
        .filterBounds(activeROI)
        .filterDate(selectedStart, selectedEnd);

      rightPane.add(ui.Chart.image.series({
        imageCollection: rain,
        region: activeROI, reducer: ee.Reducer.mean(), scale: 5000
      }).setChartType('ColumnChart').setOptions({
        title: 'Daily Rainfall (CHIRPS) — Climate Correlation',
        colors: ['#3b82f6'],
        bar: { groupWidth: '90%' },
        legend: { position: 'none' }
      }));

      // ── Chart E: Index Comparison Bar Chart ──────────────────────────────
      processedComposite.select(['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'CI'])
        .reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: activeROI, scale: 10, maxPixels: 1e9
        }).evaluate(function (v) {
          if (!v) return;
          var feats = [];
          var keys = Object.keys(v);
          for (var i = 0; i < keys.length; i++) {
            if (v[keys[i]] !== null) feats.push(ee.Feature(null, { Index: keys[i], Value: v[keys[i]] }));
          }
          rightPane.add(ui.Chart.feature.byFeature(ee.FeatureCollection(feats), 'Index', 'Value')
            .setChartType('ColumnChart').setOptions({
              title: 'Mean Index Comparison (Current Composite)',
              colors: ['#6366f1'], legend: { position: 'none' },
              bar: { groupWidth: '55%' }
            })
          );
        });

      statusLbl.setValue('● Charts ready — 5 analytics generated');
    },
    style: { stretch: 'horizontal', color: '#0d9488', fontWeight: 'bold' }
  });

  var chartSection = makeSection('📊', 'Temporal Analytics', '#0d9488', [
    ui.Label('Time-series trends, climate correlation, and seasonal patterns.', {
      fontSize: '10px', color: '#6b7280'
    }),
    analyticsBtn
  ], false);
  nav.add(chartSection.panel);


  // ============================================================================
  // SECTION 7: EXPORT & DIRECT BROWSER DOWNLOADS
  // ============================================================================

  var exportStatus = ui.Label('', { fontSize: '10px', color: '#059669', margin: '4px 0 0 0', fontWeight: 'bold' });

  var downloadLinksPanel = ui.Panel({
    style: {
      padding: '8px',
      backgroundColor: 'rgba(255,255,255,0.05)',
      borderRadius: '6px',
      margin: '6px 0',
      border: '1px dashed #34d399'
    }
  });
  downloadLinksPanel.add(ui.Label('Direct download links will appear here...', { fontSize: '9px', color: '#94a3b8' }));

  // ── Band and Scale Selection Dropdowns (Memory Limit Workaround) ───────────
  var dlBandLabel = ui.Label('1. Choose Indices to Download:', {
    fontSize: '11px', fontWeight: 'bold', color: '#059669', margin: '8px 0 2px 0'
  });
  
  var dlBandSelect = ui.Select({
    items: [
      'All 10 Spectral Indices (ZIP)',
      'NDWI Only (Water Extent)',
      'NDTI Only (Turbidity / Sediment)',
      'NDCI Only (Chlorophyll-a)',
      'TSI Only (Trophic State Index)',
      'AWEIn Only (Water Detection)',
      'SABI Only (Algal Bloom)',
      'FAI Only (Floating Algae)',
      'CI Only (Contamination Index)',
      'EVI Only (Enhanced Vegetation)',
      'MSAVI Only (Modified Soil-Adj Veg)'
    ],
    value: 'All 10 Spectral Indices (ZIP)',
    style: { stretch: 'horizontal', margin: '4px 0' }
  });

  var dlScaleLabel = ui.Label('2. Choose Resolution / Scale:', {
    fontSize: '11px', fontWeight: 'bold', color: '#059669', margin: '8px 0 2px 0'
  });
  
  var dlScaleSelect = ui.Select({
    items: [
      '10 meters (Full resolution - May exceed 50MB)',
      '20 meters (Recommended - Safe, 4x smaller)',
      '30 meters (Medium resolution - 9x smaller)',
      '60 meters (Coarse resolution)'
    ],
    value: '20 meters (Recommended - Safe, 4x smaller)',
    style: { stretch: 'horizontal', margin: '4px 0' }
  });

  var expRasterBtn = ui.Button({
    label: '🗺️ Direct GeoTIFF Map (Download)',
    onClick: function () {
      if (!processedComposite) { exportStatus.setValue('Run analysis first'); return; }

      exportStatus.setValue('⏳ Generating direct GeoTIFF zip download...');
      exportStatus.style().set('color', '#d97706');

      // 1. Resolve selected bands
      var bandChoice = dlBandSelect.getValue();
      var selectedBands = [];
      var filenameSuffix = '';
      var filePerBand = true;

      if (bandChoice === 'All 10 Spectral Indices (ZIP)') {
        selectedBands = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'SABI', 'FAI', 'CI', 'EVI', 'MSAVI'];
        filenameSuffix = 'All_Indices';
        filePerBand = true;
      } else {
        filePerBand = false;
        if (bandChoice.indexOf('NDWI') !== -1) { selectedBands = ['NDWI']; filenameSuffix = 'NDWI'; }
        else if (bandChoice.indexOf('NDTI') !== -1) { selectedBands = ['NDTI']; filenameSuffix = 'NDTI'; }
        else if (bandChoice.indexOf('NDCI') !== -1) { selectedBands = ['NDCI']; filenameSuffix = 'NDCI'; }
        else if (bandChoice.indexOf('TSI') !== -1) { selectedBands = ['TSI']; filenameSuffix = 'TSI'; }
        else if (bandChoice.indexOf('AWEIn') !== -1) { selectedBands = ['AWEIn']; filenameSuffix = 'AWEIn'; }
        else if (bandChoice.indexOf('SABI') !== -1) { selectedBands = ['SABI']; filenameSuffix = 'SABI'; }
        else if (bandChoice.indexOf('FAI') !== -1) { selectedBands = ['FAI']; filenameSuffix = 'FAI'; }
        else if (bandChoice.indexOf('CI') !== -1) { selectedBands = ['CI']; filenameSuffix = 'CI'; }
        else if (bandChoice.indexOf('EVI') !== -1) { selectedBands = ['EVI']; filenameSuffix = 'EVI'; }
        else if (bandChoice.indexOf('MSAVI') !== -1) { selectedBands = ['MSAVI']; filenameSuffix = 'MSAVI'; }
      }

      // 2. Resolve selected scale
      var scaleChoice = dlScaleSelect.getValue();
      var scaleVal = 20;
      if (scaleChoice.indexOf('10 meters') !== -1) scaleVal = 10;
      else if (scaleChoice.indexOf('20 meters') !== -1) scaleVal = 20;
      else if (scaleChoice.indexOf('30 meters') !== -1) scaleVal = 30;
      else if (scaleChoice.indexOf('60 meters') !== -1) scaleVal = 60;

      var description = 'Mimosa_' + filenameSuffix + '_' + selectedStart.replace(/-/g, '') + '_' + scaleVal + 'm';
      var imageToExport = processedComposite.select(selectedBands);

      // Standard GEE task (for background Drive exporting at high res if needed)
      Export.image.toDrive({
        image: imageToExport,
        description: description,
        folder: DRIVE_FOLDER, region: activeROI, scale: scaleVal, maxPixels: 1e10, fileFormat: 'GeoTIFF'
      });

      // Direct Web App download link (with strict 50MB error catching)
      imageToExport.getDownloadURL({
        name: description,
        scale: scaleVal,
        crs: 'EPSG:4326', // WGS 84 Projection for clean ArcGIS/QGIS importing
        region: activeROI,
        format: 'GEO_TIFF',
        filePerBand: filePerBand // Pack separate band files inside ZIP if multi-band
      }, function (url, err) {
        if (err) {
          var errMsg = err.toString();
          if (errMsg.indexOf('50428800') !== -1 || errMsg.indexOf('exceeds') !== -1 || errMsg.indexOf('limit') !== -1 || errMsg.indexOf('too large') !== -1) {
            exportStatus.setValue('✕ GEE 50MB Limit Exceeded! Try 20m scale or downloading a single index.');
          } else {
            exportStatus.setValue('✕ Error generating download: ' + err);
          }
          exportStatus.style().set('color', '#ef4444');
          return;
        }
        if (url) {
          downloadLinksPanel.clear();
          var link = ui.Label('📥 Click here to download GeoTIFF Zip', {
            fontSize: '11px', fontWeight: 'bold', color: '#10b981', margin: '4px 0'
          }).setUrl(url);
          downloadLinksPanel.add(link);
          exportStatus.setValue('✓ Direct GeoTIFF link ready! Click below.');
          exportStatus.style().set('color', '#059669');
        } else {
          exportStatus.setValue('✕ Direct download generation failed.');
          exportStatus.style().set('color', '#ef4444');
        }
      });
    },
    style: { stretch: 'horizontal' }
  });

  var expCSVBtn = ui.Button({
    label: '📋 Direct Training Data (CSV)',
    onClick: function () {
      if (!processedComposite) { exportStatus.setValue('Run analysis first'); return; }

      exportStatus.setValue('⏳ Generating direct CSV download...');
      exportStatus.style().set('color', '#d97706');

      var description = 'Mimosa_TrainingData_' + selectedStart.replace(/-/g, '');
      var bands = ['B2', 'B3', 'B4', 'B5', 'B8', 'B11', 'B12', 'NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'SABI', 'FAI', 'CI', 'EVI', 'MSAVI'];
      var trainingFC = processedComposite.select(bands).sampleRegions({
        collection: samplePoints, properties: ['id', 'label', 'zone'], scale: 10, geometries: true
      });

      // Standard GEE task (for IDE fallback)
      Export.table.toDrive({
        collection: trainingFC,
        description: description,
        folder: DRIVE_FOLDER, fileFormat: 'CSV'
      });

      // Direct Web App download link
      var selectors = ['id', 'label', 'zone', 'B2', 'B3', 'B4', 'B5', 'B8', 'B11', 'B12', 'NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'SABI', 'FAI', 'CI', 'EVI', 'MSAVI'];
      trainingFC.getDownloadURL('csv', selectors, description, function (url, err) {
        if (err) {
          exportStatus.setValue('✕ Error generating CSV: ' + err);
          exportStatus.style().set('color', '#ef4444');
          return;
        }
        if (url) {
          downloadLinksPanel.clear();
          var link = ui.Label('📥 Click here to download Training CSV', {
            fontSize: '11px', fontWeight: 'bold', color: '#10b981', margin: '4px 0'
          }).setUrl(url);
          downloadLinksPanel.add(link);
          exportStatus.setValue('✓ Direct CSV link ready! Click below.');
          exportStatus.style().set('color', '#059669');
        } else {
          exportStatus.setValue('✕ Direct CSV generation failed.');
          exportStatus.style().set('color', '#ef4444');
        }
      });
    },
    style: { stretch: 'horizontal' }
  });

  var expStatsBtn = ui.Button({
    label: '📈 Direct Zonal Statistics (CSV)',
    onClick: function () {
      if (!processedComposite) { exportStatus.setValue('Run analysis first'); return; }

      exportStatus.setValue('⏳ Calculating and generating Zonal Stats link...');
      exportStatus.style().set('color', '#d97706');

      var description = 'Mimosa_ZonalStats_' + selectedStart.replace(/-/g, '');
      var names = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'CI'];
      processedComposite.select(names).reduceRegion({
        reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true)
          .combine(ee.Reducer.minMax(), null, true),
        geometry: activeROI, scale: 10, maxPixels: 1e9
      }).evaluate(function (r) {
        if (!r) {
          exportStatus.setValue('✕ Zonal stats calculation failed.');
          exportStatus.style().set('color', '#ef4444');
          return;
        }
        var feats = [];
        for (var i = 0; i < names.length; i++) {
          feats.push(ee.Feature(null, {
            Index: names[i],
            Mean: r[names[i] + '_mean'] || 0, StdDev: r[names[i] + '_stdDev'] || 0,
            Min: r[names[i] + '_min'] || 0, Max: r[names[i] + '_max'] || 0
          }));
        }

        var statsFC = ee.FeatureCollection(feats);

        // Standard GEE task (for IDE fallback)
        Export.table.toDrive({
          collection: statsFC,
          description: description,
          folder: DRIVE_FOLDER, fileFormat: 'CSV'
        });

        // Direct Web App download link
        statsFC.getDownloadURL('csv', ['Index', 'Mean', 'StdDev', 'Min', 'Max'], description, function (url, err) {
          if (err) {
            exportStatus.setValue('✕ Error generating Zonal Stats CSV: ' + err);
            exportStatus.style().set('color', '#ef4444');
            return;
          }
          if (url) {
            downloadLinksPanel.clear();
            var link = ui.Label('📥 Click here to download Zonal Stats CSV', {
              fontSize: '11px', fontWeight: 'bold', color: '#10b981', margin: '4px 0'
            }).setUrl(url);
            downloadLinksPanel.add(link);
            exportStatus.setValue('✓ Zonal Stats link ready! Click below.');
            exportStatus.style().set('color', '#059669');
          } else {
            exportStatus.setValue('✕ Zonal Stats generation failed.');
            exportStatus.style().set('color', '#ef4444');
          }
        });
      });
    },
    style: { stretch: 'horizontal' }
  });

  var exportSection = makeSection('📤', 'Direct Browser Download', '#059669', [
    ui.Label('Generate direct browser download links for ArcGIS, QGIS and spreadsheets.', {
      fontSize: '10px', color: '#6b7280'
    }),
    dlBandLabel, dlBandSelect,
    dlScaleLabel, dlScaleSelect,
    expRasterBtn, expCSVBtn, expStatsBtn, downloadLinksPanel, exportStatus
  ], false);
  nav.add(exportSection.panel);


  // ============================================================================
  // SECTION 8: REGION & DRAWING TOOLS
  // ============================================================================

  var drawPolyBtn = ui.Button({
    label: '✏ Draw Custom Polygon',
    onClick: function () {
      drawTools.setShape('polygon');
      statusLbl.setValue('● Polygon drawing active: click on map to add vertices, double-click to finish.');
    },
    style: { stretch: 'horizontal', color: '#d97706' }
  });

  var drawRectBtn = ui.Button({
    label: '⬜ Draw Custom Rectangle',
    onClick: function () {
      drawTools.setShape('rectangle');
      statusLbl.setValue('● Rectangle drawing active: click and drag on map to draw.');
    },
    style: { stretch: 'horizontal', color: '#d97706' }
  });

  var resetDrawBtn = ui.Button({
    label: 'Clear Drawings → Reset to Gorge Dam',
    onClick: function () {
      drawTools.layers().reset();
      activeROI = DEFAULT_ROI;
      mapView.centerObject(DEFAULT_ROI, 15);
      statusLbl.setValue('● Reset to Gorge Dam ROI');
    },
    style: { stretch: 'horizontal' }
  });

  var toolsSection = makeSection('🔧', 'Region & Drawing Tools', '#d97706', [
    ui.Label('Draw a polygon around any dam, then re-run analysis.\nUse the shortcuts below or the map drawing toolbar.', {
      fontSize: '10px', color: '#6b7280', whiteSpace: 'pre-wrap'
    }),
    drawPolyBtn,
    drawRectBtn,
    resetDrawBtn
  ], false);
  nav.add(toolsSection.panel);


  // ============================================================================
  // SECTION 9: MIMOSA COMPLIANCE LEGEND
  // ============================================================================

  var leg = ui.Panel({
    style: { padding: '8px 20px', border: '1px solid #e2e8f0' }
  });
  leg.add(ui.Label('Mimosa Compliance Status', {
    fontSize: '10px', fontWeight: 'bold', color: '#475569', margin: '0 0 4px 0'
  }));

  function dot(col, txt) {
    var r = ui.Panel({
      layout: ui.Panel.Layout.Flow('horizontal'), style: { margin: '1px 0' }
    });
    r.add(ui.Label('●', { color: col, fontSize: '14px', margin: '0 6px 0 0' }));
    r.add(ui.Label(txt, { fontSize: '9px', color: '#6b7280' }));
    return r;
  }
  leg.add(dot('#10b981', 'Compliant — TSS ≤1 mg/L, pH 6.5–7.5'));
  leg.add(dot('#f59e0b', 'Caution — Approaching limits'));
  leg.add(dot('#ef4444', 'Non-Compliant — Exceeds mine standards'));
  leg.add(ui.Label(
    'pH 6.5-7.5 | TSS 0-1 | E.coli=0 | Coliform <1000 | Free Cl₂ 0.2-5 | EC <400',
    { fontSize: '8px', color: '#6b7280', whiteSpace: 'pre', margin: '4px 0 0 0' }
  ));
  nav.add(leg);

  // Footer
  nav.add(ui.Label('Sentinel-2 L2A  •  CHIRPS v2.0  •  smileRF-500  •  Drive Export', {
    fontSize: '8px', color: '#cbd5e1', textAlign: 'center', margin: '8px 0'
  }));


  // ============================================================================
  // SECTION 10: MAP CLICK HANDLER — POINT INSPECTION
  // ============================================================================

  mapView.onClick(function (c) {
    if (!processedComposite) return;
    // If drawing tools are active (user is placing vertices for a polygon/rectangle),
    // skip the click-to-inspect handler to avoid stealing focus.
    if (drawTools.getShape() !== null) return;

    var pt = ee.Geometry.Point([c.lon, c.lat]);

    var allBands = ['NDWI', 'NDTI', 'NDCI', 'TSI', 'AWEIn', 'SABI', 'FAI', 'CI', 'EVI', 'MSAVI'];
    processedComposite.select(allBands).reduceRegion({
      reducer: ee.Reducer.first(), geometry: pt, scale: 10
    }).evaluate(function (v) {
      if (!v || v.NDWI === null) return;

      rightPane.clear();
      rightPane.style().set('shown', true);

      // Header
      var hdr = ui.Panel({ style: { backgroundColor: '#1e1b4b', padding: '12px 16px' } });
      var hdrRow = ui.Panel({ layout: ui.Panel.Layout.Flow('horizontal') });
      hdrRow.add(ui.Label('Point Inspection', {
        fontSize: '14px', fontWeight: 'bold', color: '#e0e7ff', stretch: 'horizontal'
      }));
      hdrRow.add(ui.Button({
        label: '✕', style: { color: '#ef4444', padding: '0 8px' },
        onClick: function () { rightPane.style().set('shown', false); }
      }));
      hdr.add(hdrRow);
      hdr.add(ui.Label(c.lon.toFixed(5) + '°E, ' + c.lat.toFixed(5) + '°S', {
        fontSize: '10px', color: '#818cf8'
      }));
      rightPane.add(hdr);

      // Values table
      var tbl = ui.Panel({ style: { padding: '12px 16px' } });
      tbl.add(ui.Label('Spectral Index Values', {
        fontSize: '12px', fontWeight: 'bold', color: '#312e81', margin: '0 0 8px 0'
      }));

      function valRow(name, val) {
        var row = ui.Panel({ layout: ui.Panel.Layout.Flow('horizontal'), style: { margin: '3px 0' } });
        row.add(ui.Label(name, { fontWeight: 'bold', fontSize: '11px', width: '60px', color: '#4338ca' }));
        row.add(ui.Label(val !== null && val !== undefined ? val.toFixed(4) : 'N/A', {
          fontSize: '11px', color: '#1e293b'
        }));
        return row;
      }

      var names = Object.keys(v);
      for (var i = 0; i < names.length; i++) {
        tbl.add(valRow(names[i], v[names[i]]));
      }

      // Compliance assessment
      var ndti = v.NDTI || 0;
      var ci = v.CI || 0;
      var badge = ci < 0.3 ? { txt: '✓ COMPLIANT — Within Mimosa limits', col: '#059669' } :
        ci < 0.6 ? { txt: '⚠ CAUTION — Approaching limits', col: '#d97706' } :
          { txt: '✕ NON-COMPLIANT — Exceeds mine standards', col: '#dc2626' };
      tbl.add(ui.Label(badge.txt, {
        fontWeight: 'bold', fontSize: '12px', color: badge.col, margin: '12px 0 0 0'
      }));
      rightPane.add(tbl);

      // Point time series chart
      var ptTs = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(pt).filterDate(selectedStart, selectedEnd)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(preprocessS2).map(addIndices);

      rightPane.add(ui.Chart.image.series({
        imageCollection: ptTs.select(['NDWI', 'NDTI', 'CI']),
        region: pt, reducer: ee.Reducer.mean(), scale: 10
      }).setOptions({
        title: 'Temporal Trend at Point',
        lineWidth: 2, pointSize: 3,
        series: {
          0: { color: '#2563eb', label: 'NDWI' },
          1: { color: '#92400e', label: 'NDTI' },
          2: { color: '#dc2626', label: 'CI' }
        }
      }));
    });
  });


  // ============================================================================
  // SECTION 11: INITIAL MAP LOAD & CONSOLE OUTPUT
  // ============================================================================

  // Display ROI boundary
  mapView.addLayer(
    ee.Image().paint(ee.FeatureCollection(DEFAULT_ROI), 0, 2),
    { palette: ['#818cf8'] },
    'Gorge Dam ROI', true
  );

  // Display river & tributary network layer (starts as hidden, toggled via checkbox)
  mapView.addLayer(
    riverFeatures,
    { color: '#00ffff' },
    'Rivers & Tributaries Network',
    false
  );

  // Console output
  print('◆ Mimosa RS Engine v4.2 loaded');
  print('Access: Authenticated');
  print('Export folder: ' + DRIVE_FOLDER);
  print('Indices available: NDWI, NDTI, NDCI, TSI, AWEIn, SABI, FAI, CI, EVI, MSAVI');
  print('ML Engine: smileRandomForest (500 trees)');
  print('Climate: CHIRPS Daily Precipitation');

} // End boot()
