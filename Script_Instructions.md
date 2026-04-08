# Water Quality Monitoring with Google Earth Engine

I have created a powerful Google Earth Engine (GEE) script to monitor water quality at Gorge Dam, Mimosa Mine.

## Script Overview
The script uses **Sentinel-2 satellite imagery** to calculate three key indices:
1.  **NDWI (Normalized Difference Water Index)**: To detect water surface area.
2.  **NDTI (Normalized Difference Turbidity Index)**: To estimate water turbidity (cloudiness/sediment).
3.  **NDCI (Normalized Difference Chlorophyll Index)**: A proxy for **Trophic State Index (TSI)**, indicating algal bloom potential.

## How to Use
1.  **Open GEE Code Editor**: Go to [code.earthengine.google.com](https://code.earthengine.google.com/).
2.  **Copy Code**: Open the file `Mimosa_Water_Quality_Script.js` in this folder, copy all the text.
3.  **Paste & Run**: Paste it into the central code area of the Google Earth Engine Code Editor and click **Run**.
4.  **Inspect Results**:
    *   **Map**: Precise layers for Water, Turbidity, and Chlorophyll will appear on the map.
    *   **Charts**: Look at the "Console" tab (right side) to see the time-series charts generated for 2025.
    *   **Export**: Click the "Tasks" tab (right side). You will see **5 Tasks**:
        1.  `Water_Quality_Indices_Mimosa_Mine_CSV`: The data table for Excel.
        2.  `Mimosa_RGB_TrueColor_EntireArea`: A true-color (RGB) visual base map of the whole area.
        3.  `Mimosa_NDWI_Water_EntireArea`: The Water Extent index map for the whole area.
        4.  `Mimosa_NDTI_Turbidity_WaterOnly`: The Turbidity map image (GeoTIFF), masked to just the water.
        5.  `Mimosa_NDCI_Chlorophyll_WaterOnly`: The Chlorophyll map image (GeoTIFF), masked to just the water.
        *   Click **Run** next to each to download them to your Google Drive. These images can be opened in ArcGIS or QGIS for your "GIS-based decision support tool".

## Customization
*   **Adjust Dates**: Change the `'2025-01-01'` and `'2025-12-31'` lines in the script to your desired date range.
*   **Refine Location**: The script uses a point buffer. For better accuracy, you can draw a polygon around the dam using the geometry tools in the top-left of the map and name it `geometry` in the script.
