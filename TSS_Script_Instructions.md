# Weekly TSS Estimation — Mimosa Mine, Zvishavane (2023–2025)

Script file: `Mimosa_TSS_Weekly_Script.js`

## What It Does

Uses **Sentinel-2 SR** imagery to estimate **Total Suspended Solids (TSS)** and normalizes it into a **0–1 Contamination Index** (0 = Clean, 1 = Highly Contaminated) for water bodies around Gorge Dam, Mimosa Mine. Data is aggregated into **weekly composites** across 3 years (2023–2025).

### TSS Contamination Index Models Used

| Model | Original Formula | Source |
|---|---|---|
| **Red-Band** | TSS = 610.94 × ρ_Red / (1 − ρ_Red / 0.2324) | Nechad et al., 2010 |
| **Red/Green Ratio** | TSS = 955 × (Red/Green) − 411 | Dorji et al., 2020 |

*Note: The raw milligram/Litre outputs from these models are divided by a maximum threshold (default: 100) and clamped between 0 and 1 to align with local on-the-ground testing methods.*

## How to Use

1. Open [GEE Code Editor](https://code.earthengine.google.com/)
2. Copy the entire contents of `Mimosa_TSS_Weekly_Script.js`
3. Paste into the central code area → click **Run**
4. View results:
   - **Map**: Contamination layers (Red-Band and Ratio models, scaled 0 to 1), NDWI water extent, RGB
   - **Console**: 4 time-series charts tracking the 0-1 index over time.
5. **Export** (click the **Tasks** tab):
   | Task | Type | Description |
   |---|---|---|
   | `Mimosa_Mine_Weekly_Contamination_Index_2023_2025` | CSV | Weekly mean/min/max Index + NDTI |
   | `Mimosa_Contamination_RedBand_Median_2023_2025` | GeoTIFF | Period-median map (Red-Band, 0-1 scale) |
   | `Mimosa_Contamination_Ratio_Median_2023_2025` | GeoTIFF | Period-median map (Ratio, 0-1 scale) |
   | `Mimosa_RGB_TrueColor_2023_2025` | GeoTIFF | True-colour base map |

## CSV Columns

`Week_Start`, `Week_End`, `Year`, `Month`, `Week_Number`, `TSS_Red_mean_Idx`, `TSS_Red_min_Idx`, `TSS_Red_max_Idx`, `TSS_Ratio_mean_Idx`, `TSS_Ratio_min_Idx`, `TSS_Ratio_max_Idx`, `NDTI_mean`, `Image_Count`

## Customisation

- **Location**: Replace the `roi` point/buffer with a drawn polygon for greater accuracy
- **Dates**: Change `startDate` / `endDate` variables
- **TSS thresholds on map**: Adjust `tssVis.min` and `tssVis.max` to match local ranges
- **Coefficients**: Update `A_red`, `C_red`, `alpha`, `beta` with locally calibrated values
