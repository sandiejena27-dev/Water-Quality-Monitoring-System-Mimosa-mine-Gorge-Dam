/**
 * ============================================================================
 * INTEGRATED WATER QUALITY MODEL (ML) — MIMOSA MINE, ZVISHAVANE
 * ============================================================================
 * @name   integrated_wq_ml_model
 * @author JENA SANDRA (Student ID: N02219797L)
 * @program B.SC (HONS) IN GIS AND REMOTE SENSING
 *
 * @objective_3 : To develop an integrated water quality model combining 
 *                remote sensing and in-situ data. (Random Forest)
 * @objective_4 : To assess spatio-temporal variations in water quality.
 *
 * @description
 * This script trains a SMILE Random Forest classifier using Sentinel-2 
 * spectral signatures and indices (NDWI, NDTI, TSI) correlated with 
 * simulated in-situ water samples from the Gorge Dam.
 * ============================================================================
 */

// 1. DEFINE ROI (Region of Interest)
var roi = ee.Geometry.Point([29.8253, -20.3300]).buffer(2000); 
Map.centerObject(roi, 15);

// 2. DATA COLLECTION & PRE-PROCESSING
function maskS2clouds(image) {
    var qa = image.select('QA60');
    var cloudBitMask = 1 << 10;
    var cirrusBitMask = 1 << 11;
    var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
    return image.updateMask(mask).divide(10000)
        .copyProperties(image, ['system:time_start']);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate('2023-01-01', '2025-12-31')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 15))
    .map(maskS2clouds);

// 3. FEATURE ENGINEERING (OBJ 2 INTEGRATION)
function addIndices(image) {
    // NDWI (Water Extent)
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
    // NDTI (Turbidity)
    var ndti = image.normalizedDifference(['B4', 'B3']).rename('NDTI');
    // TSI / NDCI (Trophic State Index)
    var ndci = image.normalizedDifference(['B5', 'B4']).rename('NDCI');
    
    return image.addBands([ndwi, ndti, ndci]);
}

var processed = s2.map(addIndices);

// 4. SYNTHETIC IN-SITU DATA (OBJ 1 PLACEHOLDER)
// Define "In-situ" points with simulated WQ status (0 = Clear, 1 = Turbid, 2 = Hazardous)
var trainingPoints = ee.FeatureCollection([
    ee.Feature(ee.Geometry.Point([29.825, -20.331]), { 'class': 0, 'status': 'Clear' }),
    ee.Feature(ee.Geometry.Point([29.826, -20.329]), { 'class': 1, 'status': 'Turbid' }),
    ee.Feature(ee.Geometry.Point([29.824, -20.332]), { 'class': 2, 'status': 'Hazardous' }),
    // Add more points if needed...
]);

// 5. ML MODEL TRAINING (OBJ 3)
var predictionBands = ['B2', 'B3', 'B4', 'B5', 'B8', 'B11', 'NDWI', 'NDTI', 'NDCI'];

// Sample the input image at the training points
var training = processed.median().select(predictionBands).sampleRegions({
    collection: trainingPoints,
    properties: ['class'],
    scale: 10
});

// Train a Random Forest classifier
var classifier = ee.Classifier.smileRandomForest(100).train({
    features: training,
    classProperty: 'class',
    inputProperties: predictionBands
});

// Apply the classifier to the entire period median
var classifiedResult = processed.median().select(predictionBands).classify(classifier);

// 6. VISUALIZATION
var rgbVis = { min: 0.0, max: 0.3, bands: ['B4', 'B3', 'B2'] };
var classVis = {
    min: 0,
    max: 2,
    palette: ['#1a9850', '#fee08b', '#d73027'] // Green (Clear), Yellow (Turbid), Red (Hazardous)
};

Map.addLayer(processed.median(), rgbVis, 'True Colour (Sentinel-2)', true);
Map.addLayer(classifiedResult.updateMask(processed.median().select('NDWI').gt(0)), classVis, 'Integrated WQ Model (Random Forest)');

// 7. SPATIO-TEMPORAL ASSESSMENT (OBJ 4)
// Calculate the percentage of "Hazardous" water over time
var timeSeries = processed.map(function(img) {
    var cls = img.select(predictionBands).classify(classifier);
    var hazardous = cls.eq(2).updateMask(img.select('NDWI').gt(0));
    var area = hazardous.multiply(ee.Image.pixelArea()).reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: roi,
        scale: 20
    }).get('classification');
    return ee.Feature(null, {
        'system:time_start': img.get('system:time_start'),
        'Hazardous_Area_sqm': area
    });
});

print('Generating Spatio-temporal Assessment Chart...');
var chart = ui.Chart.feature.byFeature({
    features: timeSeries,
    xProperty: 'system:time_start',
    yProperties: ['Hazardous_Area_sqm']
}).setOptions({
    title: 'Estimated Hazardous Water Area Over Time',
    vAxis: { title: 'Area (sq m)' },
    hAxis: { title: 'Date' },
    lineWidth: 1,
    pointSize: 2,
    colors: ['#d73027']
});
print(chart);

print('✅ Integrated ML Model Loaded. Ready for validation (Objective 3).');
