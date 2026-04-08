/**
 * ============================================================================
 * AUTOMATED WATER EXTRACTION INDEX (AWEIn) — MIMOSA MINE, ZVISHAVANE
 * ============================================================================
 * @name   weekly_awein_extraction_mimosa_mine
 * @author JENA SANDRA (Student ID: N02219797L)
 * @program B.SC (HONS) IN GIS AND REMOTE SENSING
 * @topic  INTEGRATING WEB-BASED REMOTE SENSING AND GIS TECHNIQUES
 *         FOR WATER QUALITY AND EXTENT ASSESSMENT
 *
 * @description
 * Calculates the Automated Water Extraction Index (Non-Shadow version) 
 * from Sentinel-2 Surface Reflectance imagery for the Gorge Dam and
 * surrounding water bodies at Mimosa Mine, Zvishavane, Zimbabwe.
 *
 * Temporal range : 2023-01-01  →  2025-12-31
 * Temporal step  : Weekly composites (7-day medians)
 *
 * WATER EXTRACTION MODEL:
 *
 * AWEInsh (Feyisa et al., 2014) - Non-Shadow Version
 * Formula: 4 × (Green - SWIR1) - (0.25 × NIR + 2.75 × SWIR2)
 * Sentinel-2 Bands:
 *    Green = B3
 *    NIR   = B8
 *    SWIR1 = B11
 *    SWIR2 = B12
 *
 * Interpretation: 
 * Pixels with AWEIn > 0 are typically classified as water. 
 * Values ≤ 0 are classified as non-water (land, vegetation, etc.).
 *
 * OUTPUTS:
 *   • Map layers: RGB, AWEIn Index, Water Extent Mask
 *   • Console charts: Weekly AWEIn time series
 *   • Export CSV: Weekly mean/min/max AWEIn to Google Drive
 *   • Export GeoTIFF: Period-median AWEIn map to Google Drive
 * ============================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. REGION OF INTEREST
// ═══════════════════════════════════════════════════════════════════════════
// Approximate centre of Gorge Dam, Mimosa Mine, Zvishavane.
var roi = ee.Geometry.Point([29.8253, -20.3300]).buffer(2000); // 2 km buffer

Map.centerObject(roi, 14);

// ═══════════════════════════════════════════════════════════════════════════
// 2. DATE RANGE
// ═══════════════════════════════════════════════════════════════════════════
var startDate = '2023-01-01';
var endDate = '2025-12-31';

// ═══════════════════════════════════════════════════════════════════════════
// 3. SENTINEL-2 COLLECTION & CLOUD MASKING
// ═══════════════════════════════════════════════════════════════════════════
function maskS2clouds(image) {
    var qa = image.select('QA60');
    var cloudBitMask = 1 << 10;
    var cirrusBitMask = 1 << 11;
    var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
    return image.updateMask(mask)
        .divide(10000)                // Convert DN to reflectance
        .copyProperties(image, ['system:time_start']);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(maskS2clouds);

print('Total cloud-free scenes (2023–2025):', s2.size());

// ═══════════════════════════════════════════════════════════════════════════
// 4. AWEIn CALCULATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════
function addAWEIn(image) {
    // ── AWEIn Model (Feyisa et al., 2014) ──
    // AWEIn = 4 * (Green - SWIR1) - (0.25 * NIR + 2.75 * SWIR2)
    var awein = image.expression(
        '4 * (GREEN - SWIR1) - (0.25 * NIR + 2.75 * SWIR2)', {
        'GREEN': image.select('B3'),
        'NIR': image.select('B8'),
        'SWIR1': image.select('B11'),
        'SWIR2': image.select('B12')
    }).rename('AWEIn_Index');

    // Create a binary water mask where AWEIn > 0 
    // (Used to calculate just the surface area of the water if needed)
    var waterMask = awein.gt(0).rename('AWEIn_Water_Mask');

    return image.addBands([awein, waterMask]);
}

// Process the collection
var processed = s2.map(addAWEIn);

// ── OPTIONAL: Apply mask to only analyze water pixels ──
// For studying the pure water body extent, we keep all pixels.
// If you only want to see AWEIn values OVER WATER, uncomment the next line:
// var waterOnly = processed.map(function(img) { return img.updateMask(img.select('AWEIn_Water_Mask').eq(1)); });
// For this script, we will analyze the whole scene to see the contrast between land and water.
var waterOnly = processed;

// ═══════════════════════════════════════════════════════════════════════════
// 5. WEEKLY COMPOSITES
// ═══════════════════════════════════════════════════════════════════════════
var start = ee.Date(startDate);
var end = ee.Date(endDate);
var nWeeks = end.difference(start, 'week').ceil();

var weekStarts = ee.List.sequence(0, nWeeks.subtract(1)).map(function (w) {
    return start.advance(w, 'week');
});

// Composite function: for each week, compute mean AWEIn
var weeklyFeatures = ee.FeatureCollection(weekStarts.map(function (d) {
    d = ee.Date(d);
    var weekEnd = d.advance(1, 'week');
    var weekImages = waterOnly.filterDate(d, weekEnd);
    var count = weekImages.size();

    var result = ee.Algorithms.If(count.gt(0),
        // ── HAS IMAGES: compute median composite and reduce ──
        (function () {
            var composite = weekImages.median();
            var stats = composite.select(['AWEIn_Index'])
                .reduceRegion({
                    reducer: ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', true)
                        .combine(ee.Reducer.max(), '', true),
                    geometry: roi, // Note: reducing over the full 2km buffer area
                    scale: 20,
                    maxPixels: 1e9,
                    bestEffort: true
                });
            return ee.Feature(null, {
                'system:time_start': d.millis(),
                'Week_Start': d.format('YYYY-MM-dd'),
                'Week_End': weekEnd.format('YYYY-MM-dd'),
                'Year': d.get('year'),
                'Month': d.get('month'),
                'Week_Number': d.difference(ee.Date(ee.String(d.get('year')).cat('-01-01')), 'week').ceil(),
                'AWEIn_mean': stats.get('AWEIn_Index_mean'),
                'AWEIn_min': stats.get('AWEIn_Index_min'),
                'AWEIn_max': stats.get('AWEIn_Index_max'),
                'Image_Count': count
            });
        })(),
        // ── NO IMAGES: return feature with nulls to show temporal gaps ──
        ee.Feature(null, {
            'system:time_start': d.millis(),
            'Week_Start': d.format('YYYY-MM-dd'),
            'Week_End': weekEnd.format('YYYY-MM-dd'),
            'Year': d.get('year'),
            'Month': d.get('month'),
            'Week_Number': d.difference(ee.Date(ee.String(d.get('year')).cat('-01-01')), 'week').ceil(),
            'AWEIn_mean': null,
            'AWEIn_min': null,
            'AWEIn_max': null,
            'Image_Count': 0
        })
    );

    return ee.Feature(result);
}));

// Retain all weeks (including weeks with no data/images)
var weeklyData = weeklyFeatures;
print('Total chronological weeks retained:', weeklyData.size());

// ═══════════════════════════════════════════════════════════════════════════
// 6. MAP VISUALIZATION
// ═══════════════════════════════════════════════════════════════════════════
var rgbVis = { min: 0.0, max: 0.3, bands: ['B4', 'B3', 'B2'] };

// AWEIn visualization: Water is typically > 0. Land is < 0.
var aweinVis = {
    min: -0.5,
    max: 0.5,
    palette: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0']
    //         Dry Land   Veg/Soil   Threshold   Shallow   Deep Water
};

var waterMaskVis = { min: 0, max: 1, palette: ['#000000', 'blue'] };

// Period-median composite
var medianComposite = waterOnly.median();

Map.addLayer(processed.median(), rgbVis, 'RGB True Colour (2023–2025)', true);
Map.addLayer(medianComposite.select('AWEIn_Index'), aweinVis, 'AWEIn Index Map');
Map.addLayer(medianComposite.select('AWEIn_Water_Mask'), waterMaskVis, 'AWEIn Binary Water Mask (>0)', false);

// ═══════════════════════════════════════════════════════════════════════════
// 7. TIME-SERIES CHARTS
// ═══════════════════════════════════════════════════════════════════════════
// Chart: Weekly AWEIn mean time series over the ROI
var chartAWEIn = ui.Chart.feature.byFeature({
    features: weeklyData,
    xProperty: 'system:time_start',
    yProperties: ['AWEIn_mean']
}).setChartType('LineChart')
    .setOptions({
        title: 'Weekly Mean AWEIn (Non-Shadow) — Mimosa Mine 2023–2025',
        vAxis: { title: 'AWEIn Value', viewWindow: { min: -0.5, max: 0.5 } },
        hAxis: { title: 'Week Starting Date', format: 'MMM yyyy', slantedText: true },
        lineWidth: 1,
        pointSize: 3,
        colors: ['#0571b0'],
        interpolateNulls: true
    });
print(chartAWEIn);

// ═══════════════════════════════════════════════════════════════════════════
// 8. EXPORT — CSV DATA TABLE
// ═══════════════════════════════════════════════════════════════════════════
Export.table.toDrive({
    collection: weeklyData,
    description: 'Mimosa_Mine_Weekly_AWEIn_2023_2025',
    fileNamePrefix: 'Mimosa_Mine_Weekly_AWEIn_2023_2025',
    fileFormat: 'CSV',
    selectors: [
        'Week_Start', 'Week_End', 'Year', 'Month', 'Week_Number',
        'AWEIn_mean', 'AWEIn_min', 'AWEIn_max', 'Image_Count'
    ]
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. EXPORT — GEOTIFF MAPS
// ═══════════════════════════════════════════════════════════════════════════
// Export period-median AWEIn map
Export.image.toDrive({
    image: medianComposite.select('AWEIn_Index').toFloat(),
    description: 'Mimosa_AWEIn_Median_2023_2025',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF',
    maxPixels: 1e9
});

// Export binary AWEIn Water Mask
Export.image.toDrive({
    image: medianComposite.select('AWEIn_Water_Mask').toByte(),
    description: 'Mimosa_AWEIn_Water_Mask_2023_2025',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF',
    maxPixels: 1e9
});

print('─────────────────────────────────────────────────────────');
print('✅  AWEIn Script complete. Check the TASKS tab to run exports.');
print('─────────────────────────────────────────────────────────');
