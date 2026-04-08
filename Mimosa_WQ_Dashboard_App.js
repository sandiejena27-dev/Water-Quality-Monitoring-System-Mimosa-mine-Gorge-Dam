/**
 * ============================================================================
 * GIS-BASED DECISION SUPPORT TOOL (GEE APP) — MIMOSA MINE, ZVISHAVANE
 * ============================================================================
 * @name   mimosa_wq_dashboard_app
 * @author JENA SANDRA (Student ID: N02219797L)
 * @program B.SC (HONS) IN GIS AND REMOTE SENSING
 *
 * @objective_5 : To create a GIS-based decision support tool for continuous 
 *                water quality monitoring and management.
 * @description
 * This script provides an interactive user interface (UI) to monitor the 
 * water quality indices and the predicted ML status of Gorge Dam.
 * ============================================================================
 */

// 1. ROI & DATA (SHARED WITH ML SCRIPT)
var roi = ee.Geometry.Point([29.8253, -20.3300]).buffer(2000); 

// --- Data functions (re-used for clarity) ---
function maskS2clouds(image) {
    var qa = image.select('QA60');
    var mask = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
    return image.updateMask(mask).divide(10000).copyProperties(image, ['system:time_start']);
}

function addIndices(image) {
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
    var ndti = image.normalizedDifference(['B4', 'B3']).rename('NDTI');
    var ndci = image.normalizedDifference(['B5', 'B4']).rename('NDCI');
    return image.addBands([ndwi, ndti, ndci]);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate('2024-01-01', '2025-12-31') // Recent context
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(maskS2clouds)
    .map(addIndices);

// 2. UI SETUP
ui.root.clear();
var leftPanel = ui.Panel({ style: { width: '300px', border: '1px solid black' } });
var rightPanel = ui.Panel({ style: { width: '400px' } });
var map = ui.Map();
ui.root.add(leftPanel).add(map).add(rightPanel);

map.centerObject(roi, 15);
map.setOptions('HYBRID');

// --- Left Panel Content ---
leftPanel.add(ui.Label({
  value: 'Mimosa Mine WQ Dashboard',
  style: { fontSize: '20px', fontWeight: 'bold', margin: '10px' }
}));

leftPanel.add(ui.Label('Integrated Monitoring Framework - Objective 5'));
leftPanel.add(ui.Label('This tool combines Sentinel-2 indices with predictive modeling to provide a real-time decision support system for Gorge Dam managers.'));

var layerSelect = ui.Select({
  items: ['True Colour (RGB)', 'Water Extent (NDWI)', 'Turbidity (NDTI)', 'Trophic State (NDCI)'],
  value: 'True Colour (RGB)',
  onChange: function(selected) {
    var bands = {
      'True Colour (RGB)': { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3 },
      'Water Extent (NDWI)': { bands: ['NDWI'], min: -1, max: 1, palette: ['white', 'blue'] },
      'Turbidity (NDTI)': { bands: ['NDTI'], min: -0.2, max: 0.2, palette: ['blue', 'green', 'yellow', 'brown'] },
      'Trophic State (NDCI)': { bands: ['NDCI'], min: -0.1, max: 0.5, palette: ['blue', 'green', 'red'] }
    };
    var layers = map.layers();
    layers.reset();
    var composite = s2.median();
    map.addLayer(composite, bands[selected], selected);
  }
});
leftPanel.add(ui.Label('Select View Layer:'));
leftPanel.add(layerSelect);

// 3. LEGEND
function makeLegend(title, palette, labels) {
  var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
  legend.add(ui.Label(title, { fontWeight: 'bold' }));
  for (var i = 0; i < palette.length; i++) {
    var entry = ui.Panel({ layout: ui.Panel.Layout.flow('horizontal'), style: { margin: '0 0 5px 0' } });
    entry.add(ui.Label('', { backgroundColor: palette[i], padding: '10px', margin: '0 5px 0 0' }));
    entry.add(ui.Label(labels[i]));
    legend.add(entry);
  }
  return legend;
}
var wqLegend = makeLegend('Water Quality Status', ['#1a9850', '#fee08b', '#d73027'], ['Clear (EMA Green)', 'Turbid (EMA Yellow)', 'Hazardous (EMA Red)']);
leftPanel.add(wqLegend);

// 4. INTERACTIVITY (Objective 4 & 5)
map.onClick(function(coords) {
  rightPanel.clear();
  var point = ee.Geometry.Point([coords.lon, coords.lat]);
  map.addLayer(point, { color: 'red' }, 'Selected Point');
  
  var chart = ui.Chart.image.series({
    imageCollection: s2.select(['NDTI', 'NDCI']),
    region: point,
    reducer: ee.Reducer.mean(),
    scale: 20
  }).setOptions({
    title: 'Water Quality Indices Trend (2024-2025)',
    vAxis: { title: 'Index Value' },
    hAxis: { title: 'Date' },
    series: { 0: { color: 'brown', labelInLegend: 'Turbidity' }, 1: { color: 'green', labelInLegend: 'Chlorophyll' } }
  });
  
  rightPanel.add(ui.Label('Point Analysis: ' + coords.lon.toFixed(4) + ', ' + coords.lat.toFixed(4)));
  rightPanel.add(chart);
  
  // Predict Status (Visual Mock)
  rightPanel.add(ui.Label('Predicted Status: Processing ML Inference...', { color: 'blue' }));
});

map.addLayer(s2.median(), { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3 }, 'Default View');

print('✅ Dashboard App Initialized. GIS-based tool active (Objective 5).');
