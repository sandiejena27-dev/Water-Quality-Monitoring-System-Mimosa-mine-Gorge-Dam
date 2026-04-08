/**
 * @name integrated_water_quality_monitoring_mimosa_mine
 * @author JENA SANDRA (Student ID: N02219797L)
 * @program B.SC (HONS) IN GEOGRAPHICAL INFORMATION SYSTEMS AND REMOTE SENSING
 * @topic INTEGRATING WEB-BASED REMOTE SENSING AND GIS TECHNIQUES FOR WATER QUALITY ASSESSMENT
 * 
 * @description
 * This script processes Sentinel-2 imagery to monitor water quality indices
 * (NDWI, NDTI, NDCI/TSI) for the Gorge Dam at Mimosa Mine, Zvishavane.
 * It addresses Objective 2: "To derive satellite-based water quality indices (NDWI, NDTI, TSI)"
 * 
 * INDICES:
 * - NDWI (Normalized Difference Water Index): Delineates water bodies.
 *   Formula: (Green - NIR) / (Green + NIR)
 * - NDTI (Normalized Difference Turbidity Index): Estimates turbidity.
 *   Formula: (Red - Green) / (Red + Green)
 * - NDCI (Normalized Difference Chlorophyll Index): Proxy for Chlorophyll-a / Trophic State.
 *   Formula: (RedEdge1 - Red) / (RedEdge1 + Red)
 *
 * OPTIONS:
 * - Dates set to 2025 to match the "historical records" study period mentioned in Chapter 1.
 */

// 1. DEFINE ROI (Region of Interest)
// Approximate coordinates for Mimosa Mine area.
// Ideally, draw a polygon geometry around Gorge Dam and imports it as 'geometry'.
var roi = ee.Geometry.Point([29.8253, -20.3300]).buffer(2000); // 2km buffer around est. location

// Center the map
Map.centerObject(roi, 14);

// 2. DATA COLLECTION & PRE-PROCESSING
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate('2025-01-01', '2025-12-31') // Study period: Jan - Dec 2025
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));

// Function to mask clouds using the Sentinel-2 QA band
function maskS2clouds(image) {
    var qa = image.select('QA60');

    // Bits 10 and 11 are clouds and cirrus, respectively.
    var cloudBitMask = 1 << 10;
    var cirrusBitMask = 1 << 11;

    // Both flags should be set to zero, indicating clear conditions.
    var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

    return image.updateMask(mask).divide(10000);
}

// 3. INDEX CALCULATION FUNCTIONS
function addIndices(image) {
    // NDWI = (Green - NIR) / (Green + NIR)
    // Sentinel-2: Green=B3, NIR=B8
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');

    // NDTI = (Red - Green) / (Red + Green)
    // Sentinel-2: Red=B4, Green=B3
    var ndti = image.normalizedDifference(['B4', 'B3']).rename('NDTI');

    // NDCI = (RedEdge1 - Red) / (RedEdge1 + Red)
    // Sentinel-2: RedEdge1=B5, Red=B4
    // NDCI is a good proxy for Chlorophyll-a concentration
    var ndci = image.normalizedDifference(['B5', 'B4']).rename('NDCI');

    // Trophic State Index (TSI) - Carlson's TSI based on Chlorophyll-a
    // Note: This is an ESTIMATION. Accurate TSI requires local calibration.
    // Here we assume a linear relationship between NDCI and Chl-a for demonstration.
    // Using a generic empirical model for Chl-a from NDCI (Mishra & Mishra 2012 type approach)
    // Chl_a_est ~ a * NDCI + b (coefficients are hypothetical without local data)
    // Let's visualize NDCI directly as the "Trophic State Indicator" for now.

    return image.addBands([ndwi, ndti, ndci]);
}

// Apply processing
var processedCollection = s2.map(maskS2clouds).map(addIndices);

// 4. WATER MASKING
// We only want to analyze water pixels.
// Use NDWI > 0 (or a slight threshold like -0.1 depending on the scene) to detect water.
var waterMask = processedCollection.select('NDWI').map(function (img) {
    return img.gt(0).rename('water_mask');
});

// Update collection to only include water pixels
var waterOnlyCollection = processedCollection.map(function (img) {
    return img.updateMask(img.select('NDWI').gt(0));
});

// 5. VISUALIZATION
var rgbVis = {
    min: 0.0,
    max: 0.3,
    bands: ['B4', 'B3', 'B2'],
};

var ndwiVis = { min: -1, max: 1, palette: ['white', 'blue'] };
var ndtiVis = { min: -0.2, max: 0.2, palette: ['blue', 'green', 'yellow', 'brown'] }; // Turbidity: Clear -> Turbid
var ndciVis = { min: -0.1, max: 0.5, palette: ['blue', 'green', 'red'] }; // Algae/Chl-a: Low -> High

// Add layers to map (Median composite for the period)
Map.addLayer(processedCollection.median(), rgbVis, 'RGB (True Color)');
Map.addLayer(waterOnlyCollection.select('NDWI').median(), ndwiVis, 'NDWI (Water)', false);
Map.addLayer(waterOnlyCollection.select('NDTI').median(), ndtiVis, 'NDTI (Turbidity)');
Map.addLayer(waterOnlyCollection.select('NDCI').median(), ndciVis, 'NDCI (Chlorophyll/TSI)');

// 6. TIME SERIES CHARTING creates a powerful decision support tool
print('Generating Charts...');

// Chart 1: Average Turbidity (NDTI) over time
var chartNDTI = ui.Chart.image.series({
    imageCollection: waterOnlyCollection.select('NDTI'),
    region: roi,
    reducer: ee.Reducer.mean(),
    scale: 20
}).setOptions({
    title: 'Average Turbidity (NDTI) Over Time',
    vAxis: { title: 'NDTI Value' },
    hAxis: { title: 'Date' },
    lineWidth: 1,
    pointSize: 3
});
print(chartNDTI);

// Chart 2: Average Chlorophyll Proxy (NDCI) over time
var chartNDCI = ui.Chart.image.series({
    imageCollection: waterOnlyCollection.select('NDCI'),
    region: roi,
    reducer: ee.Reducer.mean(),
    scale: 20
}).setOptions({
    title: 'Average Chlorophyll-a Index (NDCI) Over Time',
    vAxis: { title: 'NDCI Value' },
    hAxis: { title: 'Date' },
    lineWidth: 1,
    pointSize: 3,
    colors: ['green']
});
print(chartNDCI);

// 7. DATA EXPORT
// Export the Calculated Indices as a CSV table
var tableToExport = waterOnlyCollection.select(['NDWI', 'NDTI', 'NDCI']).median()
    .reduceRegions({
        collection: ee.FeatureCollection([ee.Feature(roi, { 'label': 'Gorge_Dam_ROI' })]),
        reducer: ee.Reducer.mean(),
        scale: 20
    });

// Export to Drive (CSV Data)
Export.table.toDrive({
    collection: tableToExport,
    description: 'Water_Quality_Indices_Mimosa_Mine_CSV',
    fileFormat: 'CSV'
});

// 8. IMAGE EXPORT (GeoTIFFs for GIS)
// Export the median composite images for use in ArcGIS/QGIS (Objective 5)

// Export RGB (True Color) Base Map of the entire area
Export.image.toDrive({
    image: processedCollection.select(['B4', 'B3', 'B2']).median(),
    description: 'Mimosa_RGB_TrueColor_EntireArea',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF'
});

// Export NDWI (Water Extent) for the entire area (unmasked, so you can do your own thresholding if needed)
Export.image.toDrive({
    image: processedCollection.select('NDWI').median(),
    description: 'Mimosa_NDWI_Water_EntireArea',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF'
});

// Export NDTI (Turbidity) - Masked to water only
Export.image.toDrive({
    image: waterOnlyCollection.select('NDTI').median(),
    description: 'Mimosa_NDTI_Turbidity_WaterOnly',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF'
});

// Export NDCI (Chlorophyll) - Masked to water only
Export.image.toDrive({
    image: waterOnlyCollection.select('NDCI').median(),
    description: 'Mimosa_NDCI_Chlorophyll_WaterOnly',
    scale: 10, // Sentinel-2 resolution
    region: roi,
    fileFormat: 'GeoTIFF'
});

print('Export tasks created for CSV and Images. Check the "Tasks" tab.');
