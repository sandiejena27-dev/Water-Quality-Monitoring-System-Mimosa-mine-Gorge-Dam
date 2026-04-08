# AWEIn (Automated Water Extraction Index) — Threshold & Unit Justification
This document provides the scientific and mechanical justification for the thresholds and units utilized in the `Mimosa_AWEIn_Weekly_Script.js` for the Mimosa Mine Gorge Dam extraction.

## 1. What are the "Units" of AWEIn?
Like NDVI (Normalized Difference Vegetation Index) or NDWI (Normalized Difference Water Index), **AWEIn is a mathematically unitless spectral index.** 

It does not measure a physical property like milligrams per liter (mg/L), millimeters (mm), or degrees Celsius (°C). Instead, it calculates a **relative score** for each pixel based on how strongly that pixel reflects specific wavelengths of light.

Because we are processing Sentinel-2 **Surface Reflectance (SR)** imagery where the band values range from `0.0` (0% reflectance) to `1.0` (100% reflectance), the resulting AWEIn output is a continuous floating-point number.

## 2. The Theoretical Threshold: `AWEIn > 0`
In spectral water indices, a threshold must be explicitly defined to tell the computer, *"Everything above this number is water, everything below this number is land."*

For `AWEInsh` (the non-shadow version), the original developers (Feyisa et al., 2014) engineered the mathematical coefficients of the formula specifically so that the optimal threshold between water and non-water is **exactly Zero (`0`)**.

### Why Zero?
The basic signature of clear water is that it reflects Green light but completely absorbs Short Wave Infrared (SWIR) light. Let's look at the formula:

`AWEInsh = 4 × (Green - SWIR1) - (0.25 × NIR + 2.75 × SWIR2)`

If you look at the first half of the equation: `(Green - SWIR1)`
*   **Over Water:** Water strongly reflects Green, but absorbs SWIR1. So `Green - SWIR1` becomes a strong **positive** number. Multiplying it by 4 makes it even more positive.
*   **Over Land/Soil:** Bare soil and vegetation strongly reflect SWIR light, but reflect less Green light. So `Green - SWIR1` becomes a **negative** number.

If you look at the second half: `- (0.25 × NIR + 2.75 × SWIR2)`
*   Because water absorbs NIR and SWIR2, this entire right side of the equation evaluates to nearly `0`, allowing the positive Green/SWIR1 ratio to carry the pixel well above `0.0`.
*   Because land/vegetation strongly reflects NIR and SWIR, this right side becomes a large number. Since it is subtracted (`-`) from the entire equation, it heavily penalizes land pixels, driving their final AWEIn score deep into the **low negatives** (e.g., `-0.4`, `-0.7`).

**Therefore, the standard mathematical threshold is exactly 0:** 
* `AWEIn > 0` = Water
* `AWEIn ≤ 0` = Non-Water (Land, Soil, Vegetation)

## 3. Justifying the Visual Palette Thresholds (`min: -0.5, max: 0.5`)
While the mathematical cutoff is exact zero, natural environments are rarely binary. Water quality, depth, and suspended sediment affect how "strong" the liquid water signal is. 

In your Google Earth Engine script, the `aweinVis` parameters are set to:
`min: -0.5, max: 0.5`
`palette: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0']`

This creates a smooth, visual gradient on the map rather than just a harsh black/white mask. This is justified precisely for analyzing water dynamics in a mining dam:

1. **`0.5` (Deep Blue):** Extremely pure, deep, clear water. It strongly absorbs all infrared light and reflects green.
2. **`> 0.0 to 0.4` (Light Blue):** Shallower water, or water with elevated turbidity/sediment (like what your TSS index tracks). Sediment in water slightly increases SWIR reflectance, lowering the overall AWEIn score, but it remains above 0.
3. **`0` (Grey/White):** The absolute boundary. This represents the shoreline mud, shallow wetlands, or saturated soils right at the dam's edge.
4. **`< 0.0 to -0.4` (Orange):** Soil, rocks, or mine tailings.
5. **`-0.5` and lower (Red):** Dense, dry vegetation or bright bare ground.

## 4. Academic Citation for Justification
When justifying this algorithm for your academic paper or report, you can cite the original architects of the model who established the `0` threshold:

*   **Feyisa, G. L., Meilby, H., Fensholt, R., & Proud, S. R. (2014).** *Automated Water Extraction Index: A new technique for surface water mapping using Landsat imagery.* Remote Sensing of Environment, 140, 23-35. [DOI: 10.1016/j.rse.2013.08.029]
