/**
 * ============================================================================
 * TOTAL SUSPENDED SOLIDS (TSS) ESTIMATION — MIMOSA MINE, ZVISHAVANE
 * ============================================================================
 * @name   weekly_tss_estimation_mimosa_mine
 * @author JENA SANDRA (Student ID: N02219797L)
 * @program B.SC (HONS) IN GIS AND REMOTE SENSING
 * @topic  INTEGRATING WEB-BASED REMOTE SENSING AND GIS TECHNIQUES
 *         FOR WATER QUALITY ASSESSMENT
 *
 * @description
 * Estimates Total Suspended Solids (TSS) concentration (mg/L) from
 * Sentinel-2 Surface Reflectance imagery for the Gorge Dam and
 * surrounding water bodies at Mimosa Mine, Zvishavane, Zimbabwe.
 *
 * Temporal range : 2023-01-01  →  2025-12-31
 * Temporal step  : Weekly composites (7-day medians)
 *
 * TSS RETRIEVAL MODELS (two complementary approaches):
 *
 * 1. RED-BAND MODEL  (Nechad et al., 2010)
 *    TSS = A_red × ρ(Red) / (1 − ρ(Red) / C_red) + B_red
 *    Where ρ(Red) = B4 reflectance
 *    Calibration: A_red = 610.94, C_red = 0.2324, B_red = 0 (generic)
 *
 * 2. RED / GREEN RATIO MODEL (Dorji et al., 2020; Luo et al., 2018)
 *    TSS = α × (Red / Green) + β
 *    Calibration: α = 955.0, β = −411.0 (generic for inland turbid water)
 *
 * NOTE: These coefficients are from the peer-reviewed literature and provide
 *       defensible estimates. For maximum accuracy, calibrate with in-situ
 *       water-sample data from Gorge Dam.
 *
 * OUTPUTS:
 *   • Map layers: RGB, TSS (Red-band), TSS (Ratio), NDWI water extent
 *   • Console charts: Weekly TSS time series (both models)
 *   • Export CSV: Weekly mean/min/max TSS to Google Drive
 *   • Export GeoTIFF: Period-median TSS map to Google Drive
 * ============================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. REGION OF INTEREST
// ═══════════════════════════════════════════════════════════════════════════
// Approximate centre of Gorge Dam, Mimosa Mine, Zvishavane.
// For better accuracy, draw a polygon around the dam in the GEE geometry
// tools and name it 'geometry', then replace 'roi' references below.
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
// 4. TSS INDEX FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
// Model coefficients (generic — replace with local calibration if available)
var A_red = 610.94;   // Nechad et al., 2010
var C_red = 0.2324;
var B_red = 0;

var alpha = 955.0;    // Red/Green ratio model
var beta = -411.0;

function addTSS(image) {
    var red = image.select('B4');  // Red band (665 nm)
    var green = image.select('B3');  // Green band (560 nm)
    var nir = image.select('B8');  // NIR  band (842 nm)

    // ── NDWI for water masking ──
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');

    // ── TSS Model 1: Red-band single-band (Nechad et al., 2010) ──
    // TSS = A × ρ_red / (1 − ρ_red / C) + B
    var tss_red_raw = red.multiply(A_red)
        .divide(ee.Image(1).subtract(red.divide(C_red)))
        .add(B_red);

    // ── TSS Model 2: Red / Green ratio (Dorji et al., 2020) ──
    var ratio = red.divide(green);
    var tss_ratio_raw = ratio.multiply(alpha).add(beta);

    // ── NDTI (Turbidity proxy for cross-reference, naturally -1 to 1) ──
    var ndti = image.normalizedDifference(['B4', 'B3']).rename('NDTI');

    // ── NORMALIZE TO 0-1 SCALE (CONTAMINATION INDEX) ──
    // Based on typical ranges: 0 mg/L (clean) to ~100 mg/L (highly contaminated)
    // Adjust the 'maxTSS' value below if your local max is different (e.g., 50 or 200)
    var maxTSS = 25.0;

    // Normalize and clamp between 0 and 1
    var tss_red = tss_red_raw.divide(maxTSS).clamp(0, 1).rename('TSS_Red_Index');
    var tss_ratio = tss_ratio_raw.divide(maxTSS).clamp(0, 1).rename('TSS_Ratio_Index');

    return image.addBands([ndwi, tss_red, tss_ratio, ndti]);
}

// Process the collection
var processed = s2.map(addTSS);

// ── Apply water mask (NDWI > 0 = water) ──
var waterOnly = processed.map(function (img) {
    return img.updateMask(img.select('NDWI').gt(0));
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. WEEKLY COMPOSITES
// ═══════════════════════════════════════════════════════════════════════════
// Build a list of week-start dates from startDate to endDate
var start = ee.Date(startDate);
var end = ee.Date(endDate);
var nWeeks = end.difference(start, 'week').ceil();

var weekStarts = ee.List.sequence(0, nWeeks.subtract(1)).map(function (w) {
    return start.advance(w, 'week');
});

// Composite function: for each week, compute mean TSS over water pixels
// Uses ee.Algorithms.If to safely handle weeks with zero imagery
var weeklyFeatures = ee.FeatureCollection(weekStarts.map(function (d) {
    d = ee.Date(d);
    var weekEnd = d.advance(1, 'week');
    var weekImages = waterOnly.filterDate(d, weekEnd);
    var count = weekImages.size();

    // Only compute stats when images exist; otherwise return null properties
    var result = ee.Algorithms.If(count.gt(0),
        // ── HAS IMAGES: compute median composite and reduce ──
        (function () {
            var composite = weekImages.median();
            var stats = composite.select(['TSS_Red_Index', 'TSS_Ratio_Index', 'NDTI'])
                .reduceRegion({
                    reducer: ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', true)
                        .combine(ee.Reducer.max(), '', true),
                    geometry: roi,
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
                'TSS_Red_mean_Idx': stats.get('TSS_Red_Index_mean'),
                'TSS_Ratio_mean_Idx': stats.get('TSS_Ratio_Index_mean'),
                'NDTI_mean': stats.get('NDTI_mean'),
                'TSS_Red_min_Idx': stats.get('TSS_Red_Index_min'),
                'TSS_Ratio_min_Idx': stats.get('TSS_Ratio_Index_min'),
                'TSS_Red_max_Idx': stats.get('TSS_Red_Index_max'),
                'TSS_Ratio_max_Idx': stats.get('TSS_Ratio_Index_max'),
                'Image_Count': count
            });
        })(),
        // ── NO IMAGES: return feature with zero count (will be filtered out) ──
        ee.Feature(null, {
            'system:time_start': d.millis(),
            'Week_Start': d.format('YYYY-MM-dd'),
            'Week_End': weekEnd.format('YYYY-MM-dd'),
            'Year': d.get('year'),
            'Month': d.get('month'),
            'Week_Number': d.difference(ee.Date(ee.String(d.get('year')).cat('-01-01')), 'week').ceil(),
            'TSS_Red_mean_Idx': null,
            'TSS_Ratio_mean_Idx': null,
            'NDTI_mean': null,
            'TSS_Red_min_Idx': null,
            'TSS_Ratio_min_Idx': null,
            'TSS_Red_max_Idx': null,
            'TSS_Ratio_max_Idx': null,
            'Image_Count': 0
        })
    );

    return ee.Feature(result);
}));

// Retain all weeks (including weeks with no data/images) as per user request
var weeklyData = weeklyFeatures;
print('Total chronological weeks retained:', weeklyData.size());

// ═══════════════════════════════════════════════════════════════════════════
// 6. MAP VISUALIZATION
// ═══════════════════════════════════════════════════════════════════════════
var rgbVis = { min: 0.0, max: 0.3, bands: ['B4', 'B3', 'B2'] };

var tssVis = {
    min: 0,
    max: 1.0,        // 0 to 1 Contamination Index
    palette: ['#0571b0', '#92c5de', '#f7f7f7', '#f4a582', '#ca0020']
    //         Clean      Very Low   Moderate    High       Severe
};

var ndwiVis = { min: -1, max: 1, palette: ['white', 'blue'] };

// Period-median composite
var medianComposite = waterOnly.median();

Map.addLayer(processed.median(), rgbVis, 'RGB True Colour (2023–2025)', true);
Map.addLayer(medianComposite.select('NDWI'), ndwiVis, 'NDWI Water Extent', false);
Map.addLayer(medianComposite.select('TSS_Red_Index'), tssVis, 'Contamination Index (Red-Band)');
Map.addLayer(medianComposite.select('TSS_Ratio_Index'), tssVis, 'Contamination Index (Ratio)', false);

// ═══════════════════════════════════════════════════════════════════════════
// 7. TIME-SERIES CHARTS
// ═══════════════════════════════════════════════════════════════════════════
// Chart A: Weekly TSS (Red-band model) time series
var chartTSS_Red = ui.Chart.feature.byFeature({
    features: weeklyData,
    xProperty: 'system:time_start',
    yProperties: ['TSS_Red_mean_Idx']
}).setChartType('LineChart')
    .setOptions({
        title: 'Weekly Contamination Index (Red-Band Model) — Mimosa Mine 2023–2025',
        vAxis: { title: 'Contamination Index (0-1)', viewWindow: { min: 0, max: 1 } },
        hAxis: { title: 'Week Starting Date', slantedText: true },
        lineWidth: 1,
        pointSize: 3,
        colors: ['#d95f02'],
        interpolateNulls: true
    });
print(chartTSS_Red);

// Chart B: Weekly TSS (Ratio model) time series
var chartTSS_Ratio = ui.Chart.feature.byFeature({
    features: weeklyData,
    xProperty: 'system:time_start',
    yProperties: ['TSS_Ratio_mean_Idx']
}).setChartType('LineChart')
    .setOptions({
        title: 'Weekly Contamination Index (Red/Green Ratio) — Mimosa Mine 2023–2025',
        vAxis: { title: 'Contamination Index (0-1)', viewWindow: { min: 0, max: 1 } },
        hAxis: { title: 'Week Starting Date', slantedText: true },
        lineWidth: 1,
        pointSize: 3,
        colors: ['#7570b3'],
        interpolateNulls: true
    });
print(chartTSS_Ratio);

// Chart C: Both models compared
var chartCompare = ui.Chart.feature.byFeature({
    features: weeklyData,
    xProperty: 'system:time_start',
    yProperties: ['TSS_Red_mean_Idx', 'TSS_Ratio_mean_Idx']
}).setChartType('LineChart')
    .setOptions({
        title: 'Weekly Contamination Index Comparison — Both Models',
        vAxis: { title: 'Contamination Index (0-1)', viewWindow: { min: 0, max: 1 } },
        hAxis: { title: 'Week Starting Date', slantedText: true },
        lineWidth: 1,
        pointSize: 3,
        colors: ['#d95f02', '#7570b3'],
        series: {
            0: { labelInLegend: 'Red-Band Index' },
            1: { labelInLegend: 'Ratio Index' }
        },
        interpolateNulls: true
    });
print(chartCompare);

// Chart D: NDTI for cross-reference
var chartNDTI = ui.Chart.feature.byFeature({
    features: weeklyData,
    xProperty: 'system:time_start',
    yProperties: ['NDTI_mean']
}).setChartType('LineChart')
    .setOptions({
        title: 'Weekly NDTI (Turbidity Proxy) — Mimosa Mine 2023–2025',
        vAxis: { title: 'NDTI Value' },
        hAxis: { title: 'Week Starting Date', slantedText: true },
        lineWidth: 1,
        pointSize: 3,
        colors: ['#1b9e77'],
        interpolateNulls: true
    });
print(chartNDTI);

// ═══════════════════════════════════════════════════════════════════════════
// 8. EXPORT — CSV DATA TABLE
// ═══════════════════════════════════════════════════════════════════════════
Export.table.toDrive({
    collection: weeklyData,
    description: 'Mimosa_Mine_Weekly_Contamination_Index_2023_2025',
    fileNamePrefix: 'Mimosa_Mine_Weekly_Contamination_Index_2023_2025',
    fileFormat: 'CSV',
    selectors: [
        'Week_Start', 'Week_End', 'Year', 'Month', 'Week_Number',
        'TSS_Red_mean_Idx', 'TSS_Red_min_Idx', 'TSS_Red_max_Idx',
        'TSS_Ratio_mean_Idx', 'TSS_Ratio_min_Idx', 'TSS_Ratio_max_Idx',
        'NDTI_mean', 'Image_Count'
    ]
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. EXPORT — GEOTIFF TSS MAPS
// ═══════════════════════════════════════════════════════════════════════════
// Export period-median TSS (Red-Band model)
Export.image.toDrive({
    image: medianComposite.select('TSS_Red_Index').toFloat(),
    description: 'Mimosa_Contamination_RedBand_Median_2023_2025',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF',
    maxPixels: 1e9
});

// Export period-median TSS (Ratio model)
Export.image.toDrive({
    image: medianComposite.select('TSS_Ratio_Index').toFloat(),
    description: 'Mimosa_Contamination_Ratio_Median_2023_2025',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF',
    maxPixels: 1e9
});

// Export RGB true-colour composite
Export.image.toDrive({
    image: processed.select(['B4', 'B3', 'B2']).median(),
    description: 'Mimosa_RGB_TrueColor_2023_2025',
    scale: 10,
    region: roi,
    fileFormat: 'GeoTIFF',
    maxPixels: 1e9
});

print('─────────────────────────────────────────────────────────');
print('✅  Script complete. Check the TASKS tab to run exports.');
print('─────────────────────────────────────────────────────────');
