# Water Quality Assessment: Contamination Index Justification

This document provides the technical justification and theoretical background for the Total Suspended Solids (TSS) models used in the Google Earth Engine script for the Mimosa Mine Gorge Dam, as well as the rationale for normalizing the outputs to a 0–1 "Contamination Index".

---

## 1. Justification for the 0–1 Contamination Index

In standard hydrological remote sensing, Total Suspended Solids (TSS) is quantified in milligrams per liter (mg/L). However, transforming these physical units into a **0 to 1 Contamination Index** offers significant practical advantages for environmental monitoring and decision-support systems, particularly at mining sites like Mimosa Mine.

### The EMA Regulatory Threshold Matrix & The 0–1 Scale

When assessing water quality in a mining context, concentrations of TSS must be evaluated against the explicit standard regulatory tiers mapping safe vs. hazardous effluent limits. In Zimbabwe, the **Environmental Management Agency (EMA)** categorizes effluent discharge permits into a strict, colour-coded tier system under **Statutory Instrument 274 of 2000 (Water [Waste and Effluent Disposal] Regulations)**.

In the final model structure, the maximum mathematical threshold is pegged explicitly to the EMA "Green" general effluent limit (**`maxTSS = 25.0 mg/L`**). This decision transforms the Index from a simple relative curve into a direct, binary compliance tool:

*   **Index 0.00 – 0.99**: The water is below the 25 mg/L threshold. It is legally compliant and safe for general aquatic environments.
*   **Index 1.00 (and mathematically clamped above)**: The water has breached the 25 mg/L EMA Green threshold, entering the Yellow or Red hazard permit zones. 

Assuming a working scale of 0 to 25.0 mg/L (where 25 mg/L = Index `1.0`), the regulatory justification for the remote-sensing index tiers aligns exactly with S.I. 274/2000 as follows:

| EMA S.I. 274 Permit Category | Legal TSS Limit (mg/L) | Mapped Index Score (0–1 scale) | Interpretation / Action |
| :--- | :--- | :--- | :--- |
| **Blue (Sensitive Water)** | `≤ 10 mg/L` | **`0.00 – 0.40`** | Highly pristine water. Meets stringent requirements for discharge into environmentally sensitive catchments. |
| **Green (Normal Water)** | `≤ 25 mg/L` | **`0.41 – 1.00`** | Safe baseline for general effluent discharge into normal inland surface waters. |
| **Yellow, Red, or Severe Hazard** | `> 25 mg/L` | **`> 1.00` (Clamped to 1.0)** | The script clamps mathematical values above 1.0. Any pixel showing an Index of `1.0` is an immediate red flag indicating the water is murkier than the highest permissible normal environmental limit, suggesting a potential tailings or sediment hazard requiring physical inspection. |

### Why a 0–1 Index is Superior for Remote Sensing:

1. **Spatial Mapping:** A 0–1 scale translates perfectly to color palettes (Blue = 0.0, Red = 1.0), immediately highlighting to managers which spatial zones of the dam exceed the 30 mg/L (Index 0.3) threshold.
2. **Model Standardization:** Empirical satellite models are highly precise at measuring *changes* in sediment, but absolute mg/L outputs can have minor offsets without physical water samples to calibrate them. By normalizing to an index against known thresholds, the data becomes an immediate, robust tool for compliance monitoring rather than just a raw physics measurement.
3. **Integration with Machine Learning:** Predictive algorithms (like those in a Flood or Alert Management System) require normalized features (0 to 1) for stable calculation.

---

## 2. Explanation of the Satellite Layers (Bands) Used

To detect suspended solids in water, we rely on the specific physical properties of how sediment interacts with sunlight. Clear water absorbs almost all sunlight in the red and near-infrared spectrums, appearing dark. However, when suspended solids (mining sediment, tailings, soil) enter the water, they reflect sunlight back to the satellite, particularly in the green, red, and near-infrared wavelengths.

The script utilizes the **Sentinel-2 Multispectral Instrument (MSI)**, specifically Surface Reflectance (Level-2A) data, which has been corrected for atmospheric interference.

### The specific bands utilized:

*   **Band 3 (Green, ~560 nm):** Water has relatively high natural reflectance in the green spectrum, but sediment alters this. Green is heavily used in band-ratio models to establish a baseline of water reflectance.
*   **Band 4 (Red, ~665 nm):** **This is the most critical layer for TSS.** Suspended sediments are highly reflective in the red portion of the electromagnetic spectrum. As the concentration of suspended solids increases in Gorge Dam, the reflectance in band 4 increases linearly or exponentially. 
*   **Band 8 (Near-Infrared / NIR, ~842 nm):** Clean water absorbs NIR completely (reflectance is near zero). Therefore, the contrast between Green (Band 3) and NIR (Band 8) is used to calculate the **NDWI (Normalized Difference Water Index)**, which creates a perfect mask to isolate the dam and remove surrounding land pixels from the analysis.

### How the layers are combined into Models:

1. **Red-Band Single-Band Model (Nechad et al., 2010):**
   * *Concept:* Uses only **Band 4 (Red)**. 
   * *Mechanism:* Because red reflectance is directly proportional to sediment load, this established algorithm applies a non-linear curve to Band 4 reflectance to estimate TSS concentration. It is highly robust for moderately to highly turbid mining waters.
2. **Red/Green Ratio Model (Dorji et al., 2020):**
   * *Concept:* Uses a ratio of **Band 4 (Red)** divided by **Band 3 (Green)**.
   * *Mechanism:* Using a ratio rather than a single band helps to cancel out residual errors from atmospheric effects or variable sunlight angles over the dam. If sediment increases, Red goes up faster than Green, thereby increasing the ratio.

***

### Conclusion for your write-up:
By utilizing the red and green spectral responses of Sentinel-2, we can effectively measure changes in turbidity over Mimosa Mine's Gorge Dam. Normalizing these physical reflectance changes into a 0–1 Contamination Index bridges the gap between complex satellite physics and actionable, on-the-ground environmental management protocols.
