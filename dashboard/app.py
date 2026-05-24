"""
============================================================================
MIMOSA MINE — WATER QUALITY ML DASHBOARD
Component 2 of the Integrated WQ Monitoring Framework
============================================================================

Consumes GEE exports from Google Drive, trains a persistent Random Forest
Regression model, and provides interactive performance analytics.

Architecture:
  GEE RS Engine → Google Drive → THIS DASHBOARD → Predictions + Reports

Model Persistence:
  - Model saved via joblib to models/ directory
  - Training log (CSV) accumulates every training run
  - On app load, checks for existing model; loads if found
  - Retrain button adds new data and improves model over time
============================================================================
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import os, json, datetime, warnings
from pathlib import Path

warnings.filterwarnings('ignore')

# ============================================================================
# CONFIG
# ============================================================================

APP_DIR = Path(__file__).parent
MODELS_DIR = APP_DIR / "models"
DATA_DIR = APP_DIR / "sample_data"
DRIVE_FOLDER_ID = "1bapvthKzInFVloehVqh2QdKO74QPyRl4"
GEE_APP_URL = "https://ee-sandiejena27.projects.earthengine.app/view/water-quality-minotoring-system-mimosa-gorge-dam"
DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1bapvthKzInFVloehVqh2QdKO74QPyRl4"
MODEL_PATH = MODELS_DIR / "rf_model.pkl"
LOG_PATH = MODELS_DIR / "training_log.csv"
SCALER_PATH = MODELS_DIR / "scaler.pkl"

MODELS_DIR.mkdir(exist_ok=True)

FEATURE_COLS = ['B2','B3','B4','B5','B8','B11','B12','NDWI','NDTI','NDCI','TSI','AWEIn']

# ── Target Variables ─────────────────────────────────────────────────────────
# RS-derivable parameters (can be predicted from spectral features)
# + Lab-only parameters (entered manually, tracked for compliance)
TARGET_OPTIONS = {
    'TSS (mg/L)': 'TSS_mgL',
    'pH': 'pH',
    'Turbidity (NTU)': 'Turbidity_NTU',
    'Chlorophyll-a (µg/L)': 'Chlorophyll_ugL',
    'Conductivity (µS/cm)': 'Conductivity_uScm',
    'E. coli (CFU/100mL)': 'EColi_CFU',
    'Coliform (CFU/100mL)': 'Coliform_CFU',
    'Free Chlorine (mg/L)': 'FreeChlorine_mgL',
}

# ── Mimosa Mine Potable Water Quality Standards ─────────────────────────────
# Source: Mine operational compliance thresholds (EMA S.I. 274/2000 aligned)
MIMOSA_LIMITS = {
    'TSS_mgL':            {'safe': 1,    'caution': 5,    'unit': 'mg/L',      'label': 'TSS'},
    'pH':                 {'safe_low': 6.5, 'safe_high': 7.5, 'unit': '',       'label': 'pH'},
    'Turbidity_NTU':      {'safe': 1,    'caution': 5,    'unit': 'NTU',       'label': 'Turbidity'},
    'Chlorophyll_ugL':    {'safe': 10,   'caution': 20,   'unit': 'µg/L',      'label': 'Chlorophyll-a'},
    'Conductivity_uScm':  {'safe': 400,  'caution': 600,  'unit': 'µS/cm',     'label': 'Conductivity'},
    'EColi_CFU':          {'safe': 0,    'caution': 1,    'unit': 'CFU/100mL', 'label': 'E. coli',        'zero_tolerance': True},
    'Coliform_CFU':       {'safe': 1000, 'caution': 2000, 'unit': 'CFU/100mL', 'label': 'Total Coliform'},
    'FreeChlorine_mgL':   {'safe_low': 0.2, 'safe_high': 5.0, 'unit': 'mg/L', 'label': 'Free Chlorine'},
}

# Backward compatibility alias
EMA_LIMITS = MIMOSA_LIMITS

st.set_page_config(
    page_title="Mimosa Mine — WQ Intelligence",
    page_icon="◆",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom styling to make the dashboard look extremely premium and gorgeous
st.markdown("""
<style>
    /* Import modern Google Fonts */
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
    
    /* Root overrides */
    html, body, [data-testid="stAppViewContainer"] {
        font-family: 'Outfit', 'Inter', sans-serif !important;
        background-color: #080c15 !important;
        color: #e2e8f0 !important;
    }
    
    /* Header styling */
    h1, h2, h3, h4, h5, h6 {
        font-family: 'Outfit', sans-serif !important;
        font-weight: 600 !important;
        color: #ffffff !important;
        letter-spacing: -0.02em !important;
    }
    
    /* Top banner card */
    .banner-card {
        background: linear-gradient(135deg, rgba(30, 27, 75, 0.4) 0%, rgba(99, 102, 241, 0.15) 100%);
        border: 1px solid rgba(99, 102, 241, 0.25);
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 24px;
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    }
    
    /* Card widgets */
    div[data-testid="stMetricValue"] {
        font-family: 'Outfit', sans-serif !important;
        font-size: 2.2rem !important;
        font-weight: 700 !important;
        background: linear-gradient(to right, #ffffff, #818cf8);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    
    /* Styled metric containers */
    div[data-testid="stMetric"] {
        background: rgba(17, 24, 39, 0.45) !important;
        border: 1px solid rgba(255, 255, 255, 0.05) !important;
        padding: 16px 20px !important;
        border-radius: 12px !important;
        backdrop-filter: blur(8px) !important;
        box-shadow: 0 4px 20px 0 rgba(0, 0, 0, 0.15) !important;
        transition: transform 0.3s ease, border-color 0.3s ease !important;
    }
    div[data-testid="stMetric"]:hover {
        transform: translateY(-4px) !important;
        border-color: rgba(99, 102, 241, 0.4) !important;
    }
    
    /* Custom Sidebar design */
    [data-testid="stSidebar"] {
        background-color: #0c0f1d !important;
        border-right: 1px solid rgba(99, 102, 241, 0.15) !important;
    }
    
    /* Sidebar dividers */
    hr {
        border-color: rgba(255, 255, 255, 0.08) !important;
    }
    
    /* Sleek buttons styling */
    .stButton>button {
        background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%) !important;
        color: white !important;
        border: none !important;
        border-radius: 8px !important;
        padding: 10px 24px !important;
        font-weight: 600 !important;
        font-family: 'Outfit', sans-serif !important;
        transition: all 0.3s ease !important;
        box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4) !important;
    }
    .stButton>button:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 6px 20px rgba(99, 102, 241, 0.6) !important;
        background: linear-gradient(90deg, #818cf8 0%, #6366f1 100%) !important;
    }
    .stButton>button:active {
        transform: translateY(0px) !important;
    }
    
    /* Secondary/standard buttons override */
    div.stDownloadButton>button {
        background: transparent !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        color: #e2e8f0 !important;
        box-shadow: none !important;
    }
    div.stDownloadButton>button:hover {
        border-color: #6366f1 !important;
        color: #ffffff !important;
        background: rgba(99, 102, 241, 0.05) !important;
    }
    
    /* Styled tab container */
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px !important;
        background-color: rgba(17, 24, 39, 0.5) !important;
        padding: 6px 12px !important;
        border-radius: 12px !important;
        border: 1px solid rgba(255, 255, 255, 0.05) !important;
    }
    
    .stTabs [data-baseweb="tab"] {
        height: 40px !important;
        border-radius: 8px !important;
        background-color: transparent !important;
        border: none !important;
        color: #94a3b8 !important;
        font-family: 'Outfit', sans-serif !important;
        font-weight: 500 !important;
        transition: all 0.2s ease !important;
    }
    .stTabs [data-baseweb="tab"]:hover {
        color: #ffffff !important;
        background-color: rgba(255, 255, 255, 0.05) !important;
    }
    .stTabs [aria-selected="true"] {
        background: rgba(99, 102, 241, 0.15) !important;
        color: #818cf8 !important;
        border-bottom: 2px solid #818cf8 !important;
    }
    
    /* Input field design */
    div[data-baseweb="select"], div[data-baseweb="input"], .stSlider {
        background-color: rgba(17, 24, 39, 0.5) !important;
        border-radius: 8px !important;
    }
</style>
""", unsafe_allow_html=True)

# ============================================================================
# PERSISTENCE LAYER
# ============================================================================

def save_model(model, scaler, metadata):
    """Save trained model, scaler, and append to training log."""
    import joblib
    joblib.dump(model, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)
    
    log_entry = {
        'timestamp': datetime.datetime.now().isoformat(),
        'target': metadata.get('target', ''),
        'n_samples': metadata.get('n_samples', 0),
        'n_features': metadata.get('n_features', 0),
        'n_trees': metadata.get('n_trees', 0),
        'r2_train': round(metadata.get('r2_train', 0), 4),
        'r2_test': round(metadata.get('r2_test', 0), 4),
        'rmse': round(metadata.get('rmse', 0), 4),
        'mae': round(metadata.get('mae', 0), 4),
        'cv_mean': round(metadata.get('cv_mean', 0), 4),
        'cv_std': round(metadata.get('cv_std', 0), 4),
    }
    
    if LOG_PATH.exists():
        log_df = pd.read_csv(LOG_PATH)
        log_df = pd.concat([log_df, pd.DataFrame([log_entry])], ignore_index=True)
    else:
        log_df = pd.DataFrame([log_entry])
    
    log_df.to_csv(LOG_PATH, index=False)
    return log_entry


def load_model():
    """Load existing model and scaler if available."""
    import joblib
    if MODEL_PATH.exists() and SCALER_PATH.exists():
        model = joblib.load(MODEL_PATH)
        scaler = joblib.load(SCALER_PATH)
        return model, scaler
    return None, None


def load_training_log():
    """Load training history log."""
    if LOG_PATH.exists():
        return pd.read_csv(LOG_PATH)
    return pd.DataFrame()


# ============================================================================
# DATA LOADING
# ============================================================================

def sync_from_drive():
    """Download latest exports from Google Drive folder."""
    try:
        import gdown
        output = str(DATA_DIR)
        gdown.download_folder(id=DRIVE_FOLDER_ID, output=output, quiet=False)
        return True, "Synced successfully from Google Drive."
    except Exception as e:
        return False, f"Drive sync failed: {str(e)}"


def load_coordinates():
    """Load coordinates from the KML file or fallback to predefined dict."""
    kml_path = APP_DIR.parent / "Mine Datasets" / "Sample Points.kml"
    coords = []
    if kml_path.exists():
        try:
            import xml.etree.ElementTree as ET
            tree = ET.parse(kml_path)
            root = tree.getroot()
            namespaces = {'kml': 'http://www.opengis.net/kml/2.2'}
            # Find coordinates inside kml:coordinates
            for coord_elem in root.findall('.//kml:coordinates', namespaces):
                text = coord_elem.text.strip() if coord_elem.text else ""
                for part in text.split():
                    subparts = part.split(',')
                    if len(subparts) >= 2:
                        lon, lat = float(subparts[0]), float(subparts[1])
                        coords.append({'Longitude': lon, 'Latitude': lat})
        except Exception as e:
            st.warning(f"Error reading KML file: {e}")
    
    # Fallback/precise GEE points for SP01-SP05
    gee_coords = {
        'SP01': (29.84381885600004, -20.31754411099996),
        'SP02': (29.842569424000033, -20.31860980299996),
        'SP03': (29.84402097000003, -20.320410454999944),
        'SP04': (29.84560113300006, -20.31899565699996),
        'SP05': (29.847088369000062, -20.320006020999926),
    }
    
    return coords, gee_coords


def load_data():
    """Load all CSV files from data directory and append coordinates."""
    all_files = list(DATA_DIR.glob("*.csv"))
    if not all_files:
        return None
    
    frames = []
    for f in all_files:
        try:
            df = pd.read_csv(f)
            # Check if it has the expected columns
            if any(col in df.columns for col in FEATURE_COLS):
                df['_source_file'] = f.name
                frames.append(df)
        except Exception:
            continue
    
    if not frames:
        return None
    
    combined = pd.concat(frames, ignore_index=True)
    
    # Merge coordinates
    coords, gee_coords = load_coordinates()
    
    longitudes = []
    latitudes = []
    
    for idx, row in combined.iterrows():
        point_id = str(row.get('id', ''))
        
        # Check if we have exact GEE coordinates for this point
        if point_id in gee_coords:
            lon, lat = gee_coords[point_id]
        elif coords and idx < len(coords):
            # Map remaining points by index from KML
            lon = coords[idx]['Longitude']
            lat = coords[idx]['Latitude']
        else:
            # General Gorge Dam center default fallback
            lon, lat = 29.84462, -20.31911
            
        longitudes.append(lon)
        latitudes.append(lat)
        
    combined['Longitude'] = longitudes
    combined['Latitude'] = latitudes
    
    return combined


# ============================================================================
# MODEL TRAINING
# ============================================================================

def train_model(df, target_col, n_trees=500, test_size=0.3):
    """Train Random Forest Regressor with full validation suite."""
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
    
    # Filter to rows that have both features and target
    available_features = [c for c in FEATURE_COLS if c in df.columns]
    if not available_features or target_col not in df.columns:
        return None
    
    clean = df[available_features + [target_col]].dropna()
    if len(clean) < 5:
        return None
    
    X = clean[available_features]
    y = clean[target_col]
    
    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Split
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=test_size, random_state=42
    )
    
    # Train
    rf = RandomForestRegressor(
        n_estimators=n_trees,
        max_depth=None,
        min_samples_split=2,
        min_samples_leaf=1,
        random_state=42,
        n_jobs=-1,
        oob_score=True
    )
    rf.fit(X_train, y_train)
    
    # Predictions
    y_pred_train = rf.predict(X_train)
    y_pred_test = rf.predict(X_test)
    y_pred_all = rf.predict(X_scaled)
    
    # Metrics
    r2_train = r2_score(y_train, y_pred_train)
    r2_test = r2_score(y_test, y_pred_test)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
    mae = mean_absolute_error(y_test, y_pred_test)
    
    # Cross-validation
    cv_scores = cross_val_score(rf, X_scaled, y, cv=min(5, len(clean)), scoring='r2')
    
    # Feature importance
    importance = pd.DataFrame({
        'Feature': available_features,
        'Importance': rf.feature_importances_
    }).sort_values('Importance', ascending=False)
    
    # Save model persistently
    metadata = {
        'target': target_col,
        'n_samples': len(clean),
        'n_features': len(available_features),
        'n_trees': n_trees,
        'r2_train': r2_train,
        'r2_test': r2_test,
        'rmse': rmse,
        'mae': mae,
        'cv_mean': cv_scores.mean(),
        'cv_std': cv_scores.std(),
    }
    save_model(rf, scaler, metadata)
    
    return {
        'model': rf,
        'scaler': scaler,
        'X_train': X_train, 'X_test': X_test,
        'y_train': y_train, 'y_test': y_test,
        'y_pred_train': y_pred_train,
        'y_pred_test': y_pred_test,
        'y_pred_all': y_pred_all,
        'y_all': y,
        'X_all': X_scaled,
        'r2_train': r2_train, 'r2_test': r2_test,
        'rmse': rmse, 'mae': mae,
        'cv_scores': cv_scores,
        'importance': importance,
        'features': available_features,
        'oob_score': rf.oob_score_,
        'metadata': metadata,
        'clean_df': clean,
    }
def get_compliance_status(param_col, value):
    """Return status and color code for a given parameter and value."""
    limits = MIMOSA_LIMITS.get(param_col, {})
    if not limits or pd.isna(value):
        return 'Unknown', '#6b7280'
    
    is_range = 'safe_low' in limits and 'safe_high' in limits
    is_zero_tolerance = limits.get('zero_tolerance', False)
    
    if is_range:
        low, high = limits['safe_low'], limits['safe_high']
        if low <= value <= high:
            return 'Compliant', '#10b981' # Green
        else:
            return 'Non-Compliant', '#ef4444' # Red
            
    elif is_zero_tolerance:
        if value == 0:
            return 'Compliant', '#10b981' # Green
        else:
            return 'Non-Compliant', '#ef4444' # Red
            
    else:
        safe = limits.get('safe', 25)
        caution = limits.get('caution', 50)
        if value <= safe:
            return 'Compliant', '#10b981' # Green
        elif value <= caution:
            return 'Caution', '#f59e0b' # Orange/Yellow
        else:
            return 'Non-Compliant', '#ef4444' # Red


# ============================================================================
# UI — SIDEBAR
# ============================================================================

with st.sidebar:
    st.markdown("### ◆ MIMOSA MINE")
    st.caption("Water Quality Intelligence Platform")
    st.divider()
    
    # ── STEP 1: GEE App Launch ──────────────────────────────────────────
    st.markdown("**Step 1 → Run GEE Analysis**")
    st.link_button(
        "🛰️ Launch GEE RS Engine",
        GEE_APP_URL,
        use_container_width=True,
        type="primary"
    )
    st.caption("Run spectral indices in GEE, then export CSVs to Drive.")
    
    st.divider()
    
    # ── STEP 2: Drive Sync ──────────────────────────────────────────────
    st.markdown("**Step 2 → Sync Data from Drive**")
    if st.button("🔄 Sync from Google Drive", use_container_width=True):
        with st.spinner("Downloading exports from Drive..."):
            ok, msg = sync_from_drive()
            if ok:
                st.success(msg)
                st.session_state['drive_synced'] = True
            else:
                st.error(msg)
    
    st.link_button("📂 Open Drive Folder", DRIVE_FOLDER_URL, use_container_width=True)
    
    # Upload manual data
    uploaded = st.file_uploader(
        "Or upload CSV manually",
        type=['csv'],
        help="Upload a CSV exported from the GEE RS Engine"
    )
    if uploaded:
        udf = pd.read_csv(uploaded)
        save_path = DATA_DIR / uploaded.name
        udf.to_csv(save_path, index=False)
        st.success(f"Saved: {uploaded.name}")
    
    st.divider()
    
    # ── Pipeline Status ─────────────────────────────────────────────────
    st.markdown("**Pipeline Status**")
    
    # Check data availability
    _data_files = list(DATA_DIR.glob("*.csv"))
    _has_data = len(_data_files) > 0
    _has_gee_data = any('Mimosa' in f.name for f in _data_files)
    
    existing_model, existing_scaler = load_model()
    _has_model = existing_model is not None
    
    # Status indicators
    st.markdown(
        f"{'✅' if True else '⬜'} GEE App — [Published]({GEE_APP_URL})\n\n"
        f"{'✅' if _has_gee_data else '🔲'} Drive Sync — {'GEE exports found' if _has_gee_data else 'Awaiting sync'}\n\n"
        f"{'✅' if _has_data else '🔲'} Data Loaded — {len(_data_files)} file(s)\n\n"
        f"{'✅' if _has_model else '🔲'} ML Model — {'Trained & saved' if _has_model else 'Not trained yet'}"
    )
    
    if _has_model:
        log = load_training_log()
        if not log.empty:
            latest = log.iloc[-1]
            st.metric("R² (Test)", f"{latest['r2_test']:.4f}")
            st.metric("RMSE", f"{latest['rmse']:.4f}")
            st.caption(f"Last trained: {latest['timestamp'][:16]}")
    
    st.divider()
    st.caption("Sentinel-2 L2A • CHIRPS • RF Regressor")
    st.caption(f"Session: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}")


# ============================================================================
# UI — MAIN CONTENT (TABS)
# ============================================================================

tab_home, tab_map, tab_data, tab_model, tab_perf, tab_ema, tab_logs = st.tabs([
    "🏠 Home", "🗺️ Spatial Map", "📊 Data Explorer", "🤖 ML Model",
    "📈 Performance", "📋 Compliance Report", "📜 Training Logs"
])


# ── TAB 1: HOME ─────────────────────────────────────────────────────────────

with tab_home:
        # Premium operational dashboard top banner
    st.markdown("""
    <div class="banner-card">
        <div style="font-size: 2.2rem; font-weight: 700; color: #ffffff; margin-bottom: 8px;">
            ◆ Mimosa Mine — Water Quality Intelligence
        </div>
        <div style="font-size: 1.05rem; color: #94a3b8; font-weight: 300; line-height: 1.6;">
            Component 2 of the Integrated WQ Remote Sensing & Machine Learning Monitoring Framework.
            This platform auto-synchronizes spectral index exports from the GEE cloud engine and compiles
            Random Forest regressions to predict key chemical & biological indices.
        </div>
    </div>
    """, unsafe_allow_html=True)
    
    # ── Prominent GEE Launch ─────────────────────────────────────────────
    launch_col1, launch_col2 = st.columns([2.5, 1])
    with launch_col1:
        st.markdown("""
        <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); padding: 20px; border-radius: 12px; border-left: 5px solid #6366f1;">
            <h4 style="margin-top: 0; color: #ffffff;">🛰️ Step 1 — GEE Remote Sensing Engine Operations</h4>
            <p style="color: #cbd5e1; font-size: 0.9rem; margin-bottom: 0;">
                Launch the Google Earth Engine console to execute high-fidelity spectral computations (NDWI, NDTI, NDCI, TSI, AWEIn) over the Gorge Dam reservoir boundary. Export computed zonal stats to Google Drive when complete.
            </p>
        </div>
        """, unsafe_allow_html=True)
    with launch_col2:
        st.markdown("<div style='height: 15px;'></div>", unsafe_allow_html=True)
        st.link_button(
            "🛰️ LAUNCH GEE APP",
            GEE_APP_URL,
            use_container_width=True,
            type="primary"
        )
        st.link_button(
            "📂 Open Drive Folder",
            DRIVE_FOLDER_URL,
            use_container_width=True
        )
    
    st.divider()
    
    # ── Architecture Diagram ─────────────────────────────────────────────
    st.subheader("System Architecture")
    st.markdown("""
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 5px;">
        <!-- Card 1 -->
        <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-left: 4px solid #6366f1; padding: 20px; border-radius: 12px;">
            <h4 style="margin-top:0; color:#818cf8; margin-bottom:8px;">📡 Component 1 — GEE Engine</h4>
            <p style="font-size:0.85rem; color:#94a3b8; margin-bottom:12px; line-height:1.5;">Sentinel-2 L2A surface reflectance computation & 10-band spectral index modeling.</p>
            <a href="https://ee-sandiejena27.projects.earthengine.app/view/water-quality-minotoring-system-mimosa-gorge-dam" target="_blank" style="font-size:0.85rem; color:#818cf8; text-decoration:none; font-weight:bold;">Launch GEE App →</a>
        </div>
        <!-- Card 2 -->
        <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-left: 4px solid #10b981; padding: 20px; border-radius: 12px;">
            <h4 style="margin-top:0; color:#34d399; margin-bottom:8px;">🔗 Data Bridge — Drive</h4>
            <p style="font-size:0.85rem; color:#94a3b8; margin-bottom:12px; line-height:1.5;">Auto-synchronized remote sensing CSVs and Zonal Stats compiled from cloud operations.</p>
            <a href="https://drive.google.com/drive/folders/1bapvthKzInFVloehVqh2QdKO74QPyRl4" target="_blank" style="font-size:0.85rem; color:#34d399; text-decoration:none; font-weight:bold;">Open Drive Folder →</a>
        </div>
        <!-- Card 3 -->
        <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 12px;">
            <h4 style="margin-top:0; color:#fbbf24; margin-bottom:8px;">🤖 Component 2 — ML Model</h4>
            <p style="font-size:0.85rem; color:#94a3b8; margin-bottom:12px; line-height:1.5;">Random Forest Regression pipelines optimizing multi-variable potable compliance standards.</p>
            <span style="font-size:0.85rem; color:#fbbf24; font-weight:bold;">Model Status: Persistent</span>
        </div>
    </div>
    <br>
    """, unsafe_allow_html=True)
    
    st.divider()
    
    # ── Live Pipeline Status ─────────────────────────────────────────────
    st.subheader("Live Pipeline Status")
    
    data = load_data()
    log = load_training_log()
    
    p1, p2, p3, p4 = st.columns(4)
    
    # Check for GEE-exported data vs demo data
    _data_files = list(DATA_DIR.glob("*.csv"))
    _has_gee = any('Mimosa' in f.name for f in _data_files)
    _has_demo = any('demo' in f.name for f in _data_files)
    
    with p1:
        st.metric("GEE App", "Published ✅")
        st.caption("Access code: MimosaWQ2026")
    with p2:
        if _has_gee:
            st.metric("Drive Data", "Synced ✅")
            st.caption(f"{sum(1 for f in _data_files if 'Mimosa' in f.name)} GEE export(s)")
        elif _has_demo:
            st.metric("Drive Data", "Demo Only ⚠️")
            st.caption("Using demo data — sync from Drive for real data")
        else:
            st.metric("Drive Data", "Not Synced 🔲")
            st.caption("Click Sync in sidebar")
    with p3:
        if data is not None:
            st.metric("Total Samples", len(data))
            st.caption(f"{len([c for c in FEATURE_COLS if c in data.columns])} features loaded")
        else:
            st.metric("Total Samples", "0")
            st.caption("No data yet")
    with p4:
        if not log.empty:
            st.metric("Model Runs", len(log))
            st.caption(f"Best R²: {log['r2_test'].max():.4f}")
        else:
            st.metric("Model Runs", "0")
            st.caption("Train in ML Model tab")
    
    st.divider()
    
    # ── Workflow ─────────────────────────────────────────────────────────
    st.subheader("Workflow")
    st.markdown(f"""
    1. **[Launch GEE App]({GEE_APP_URL})** → Compute indices → Export Training CSV to Drive
    2. **Sync Dashboard** → Click "Sync from Google Drive" in the sidebar (←)
    3. **Train Model** → Go to 🤖 ML Model tab → Select target → Train
    4. **Analyse** → View 📈 Performance plots, feature importance, predictions
    5. **Report** → Check 📋 EMA compliance status per sample point
    6. **Iterate** → Run GEE again with new dates → Sync → Retrain → Model improves
    """)


# ── TAB 1B: SPATIAL MAP ──────────────────────────────────────────────────────

with tab_map:
    st.header("🗺️ Spatial Intelligence — Gorge Dam Study Area")
    st.markdown("""
    Explore water quality parameters across the **Gorge Dam point network** at Zvishavane. 
    Toggle basemaps, switch parameters, and compare in-situ field data against the ML model predictions!
    """)
    
    data = load_data()
    if data is None:
        st.warning("No data loaded. Sync from Google Drive or upload a CSV in the sidebar to view the map.")
    else:
        # Define layout columns: Controls (1) | Map (2.5)
        map_ctrl_col, map_display_col = st.columns([1, 2.5])
        
        with map_ctrl_col:
            st.markdown("### Map Layers & Settings")
            
            # 1. Basemap Style Selection
            basemap_choice = st.selectbox(
                "Basemap Style",
                ["Satellite Detailed", "Sleek Dark Mode", "Clean Light Mode", "Standard Streets"],
                index=0
            )
            basemap_styles = {
                "Satellite Detailed": "white-bg",
                "Sleek Dark Mode": "carto-darkmatter",
                "Clean Light Mode": "carto-positron",
                "Standard Streets": "open-street-map"
            }
            
            # 2. Variable Selector (Layer overswitch)
            map_var_label = st.selectbox(
                "Water Quality Layer",
                list(TARGET_OPTIONS.keys()),
                index=0
            )
            map_var_col = TARGET_OPTIONS[map_var_label]
            limits = MIMOSA_LIMITS.get(map_var_col, {})
            
            # 3. Data Source Mode
            data_mode = st.radio(
                "Data Source Mode",
                ["In-situ (Actual Lab)", "ML Model Predictions"],
                help="Switch between actual laboratory readings and predictions made by the Random Forest model."
            )
            
            st.divider()
            st.markdown("### Compliance Summary")
            
        # Get active coordinates and values
        df_map = data.copy()
        
        # Ensure we filter out duplicate rows per sample point to only show the latest composite
        latest_file = df_map['_source_file'].iloc[-1] if '_source_file' in df_map.columns else None
        if latest_file:
            df_map = df_map[df_map['_source_file'] == latest_file]
            
        # If the user selected predictions:
        is_prediction_mode = (data_mode == "ML Model Predictions")
        prediction_error = None
        
        if is_prediction_mode:
            # Check if model exists and matches
            existing_model, existing_scaler = load_model()
            if existing_model is not None:
                log = load_training_log()
                if not log.empty:
                    latest = log.iloc[-1]
                    trained_target = latest['target']
                    
                    if trained_target == map_var_col:
                        # Predict on map data
                        available_features = [c for c in FEATURE_COLS if c in df_map.columns]
                        clean_predict = df_map[available_features].dropna()
                        if not clean_predict.empty:
                            scaled_predict = existing_scaler.transform(clean_predict)
                            preds = existing_model.predict(scaled_predict)
                            # Assign predictions to map variable
                            df_map.loc[clean_predict.index, map_var_col] = preds
                        else:
                            prediction_error = "No features available for prediction."
                    else:
                        prediction_error = f"Model is trained for **{MIMOSA_LIMITS.get(trained_target, {}).get('label', trained_target)}**, but you requested **{map_var_label}**. Go to **🤖 ML Model** tab and train the model for {map_var_label} first."
            else:
                prediction_error = "No ML model trained yet. Go to **🤖 ML Model** tab and train the model first."
        
        # Calculate compliance status for each point
        statuses = []
        colors = []
        value_displays = []
        
        for idx, row in df_map.iterrows():
            val = row[map_var_col]
            if pd.isna(val):
                status, color = "Unknown", "#6b7280"
                val_str = "No Data"
            else:
                status, color = get_compliance_status(map_var_col, val)
                val_str = f"{val:.2f} {limits.get('unit', '')}"
                
            statuses.append(status)
            colors.append(color)
            value_displays.append(val_str)
            
        df_map['Status'] = statuses
        df_map['MarkerColor'] = colors
        df_map['ValueDisplay'] = value_displays
        
        # Map stats calculation
        valid_vals = df_map[map_var_col].dropna()
        if not valid_vals.empty:
            mean_val = valid_vals.mean()
            compliant_pct = (df_map['Status'] == 'Compliant').sum() / len(df_map) * 100
        else:
            mean_val, compliant_pct = 0, 0
            
        with map_ctrl_col:
            st.metric("Mean Value", f"{mean_val:.2f} {limits.get('unit', '')}")
            st.metric("Compliance Rate", f"{compliant_pct:.1f}%")
            if prediction_error:
                st.warning(prediction_error)
                
        with map_display_col:
            # Center of map
            center_lat = df_map['Latitude'].mean()
            center_lon = df_map['Longitude'].mean()
            
            # Setup Plotly map
            import plotly.graph_objects as go
            
            fig_map = go.Figure()
            
            # Color groups to ensure a clean legend
            status_groups = df_map.groupby('Status')
            
            color_map = {
                "Compliant": "#10b981",
                "Caution": "#f59e0b",
                "Non-Compliant": "#ef4444",
                "Unknown": "#6b7280"
            }
            
            for status_name, group in status_groups:
                fig_map.add_trace(go.Scattermapbox(
                    lat=group['Latitude'],
                    lon=group['Longitude'],
                    mode='markers+text',
                    marker=go.scattermapbox.Marker(
                        size=14,
                        color=color_map.get(status_name, "#6b7280"),
                        opacity=0.9
                    ),
                    text=group['id'],
                    textposition="top center",
                    textfont=dict(size=10, color="#ffffff", family="Outfit"),
                    name=status_name,
                    hoverinfo='text',
                    hovertext=[
                        f"<b>{row['id']} - {row['label']}</b><br>"
                        f"Value: {row['ValueDisplay']}<br>"
                        f"Status: {row['Status']}"
                        for _, row in group.iterrows()
                    ]
                ))
                
            # Basemap configuration
            layout_kwargs = {
                "margin": {"r": 0, "t": 0, "l": 0, "b": 0},
                "height": 520,
                "paper_bgcolor": "rgba(0,0,0,0)",
                "plot_bgcolor": "rgba(0,0,0,0)",
                "showlegend": True,
                "legend": dict(
                    yanchor="top",
                    y=0.98,
                    xanchor="left",
                    x=0.02,
                    bgcolor="rgba(11, 15, 26, 0.85)",
                    bordercolor="rgba(255, 255, 255, 0.1)",
                    borderwidth=1,
                    font=dict(color="#ffffff", family="Outfit")
                ),
                "mapbox": {
                    "center": {"lat": center_lat, "lon": center_lon},
                    "zoom": 14.0
                }
            }
            
            # ESRI World Imagery URL for sleek satellite basemap
            if basemap_choice == "Satellite Detailed":
                layout_kwargs["mapbox"]["style"] = "white-bg"
                layout_kwargs["mapbox"]["layers"] = [
                    {
                        "below": 'traces',
                        "sourcetype": "raster",
                        "source": [
                            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        ],
                        "tileSize": 256
                    }
                ]
            else:
                layout_kwargs["mapbox"]["style"] = basemap_styles.get(basemap_choice, "carto-darkmatter")
                
            fig_map.update_layout(**layout_kwargs)
            st.plotly_chart(fig_map, use_container_width=True)
            
        st.divider()
        
        # ── POINT DETAILS INSPECTOR ──────────────────────────────────────────
        st.subheader("🔬 Sample Point Detail Inspector")
        ins_col1, ins_col2 = st.columns([1, 2])
        
        with ins_col1:
            point_labels = sorted(data['label'].unique().tolist())
            selected_point_label = st.selectbox("Select Point to Inspect", point_labels)
            
            point_data = data[data['label'] == selected_point_label].copy()
            if '_source_file' in point_data.columns:
                point_data = point_data.sort_values('_source_file')
                
            latest_val = point_data[map_var_col].iloc[-1] if not point_data.empty else None
            
            # Show gauge indicator
            if latest_val is not None and not pd.isna(latest_val):
                p_status, p_color = get_compliance_status(map_var_col, latest_val)
                
                if 'safe_low' in limits and 'safe_high' in limits:
                    low = limits['safe_low']
                    high = limits['safe_high']
                    spread = high - low
                    gauge_min = max(0.0, low - spread)
                    gauge_max = high + spread
                else:
                    safe = limits.get('safe', 25)
                    caution = limits.get('caution', 50)
                    gauge_min = 0.0
                    gauge_max = caution * 1.5
                    
                fig_point_gauge = go.Figure(go.Indicator(
                    mode="gauge+number",
                    value=latest_val,
                    title={'text': f"{map_var_label} Level", 'font': {'family': 'Outfit', 'color': '#ffffff', 'size': 16}},
                    number={'suffix': f" {limits.get('unit', '')}", 'font': {'color': '#ffffff', 'family': 'Outfit', 'size': 24}},
                    gauge={
                        'axis': {'range': [gauge_min, gauge_max], 'tickfont': {'color': '#94a3b8'}},
                        'bar': {'color': p_color},
                        'steps': [
                            {'range': [gauge_min, gauge_max], 'color': 'rgba(255, 255, 255, 0.05)'}
                        ]
                    }
                ))
                fig_point_gauge.update_layout(
                    height=240,
                    margin={"t": 50, "b": 10, "l": 20, "r": 20},
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0)",
                    template="plotly_dark"
                )
                st.plotly_chart(fig_point_gauge, use_container_width=True)
            else:
                st.info("No data available for the selected parameter at this point.")
                
        with ins_col2:
            st.markdown(f"### Historical Evolution for **{selected_point_label}**")
            
            if not point_data.empty:
                dates = []
                import re
                for f in point_data['_source_file']:
                    match = re.search(r'\d{4}-\d{2}-\d{2}', str(f))
                    if match:
                        dates.append(match.group(0))
                    else:
                        dates.append(str(f).replace('Mimosa_Training_Data_', '').replace('.csv', ''))
                point_data['Date'] = dates
                
                # Show historical line plot
                fig_history = go.Figure()
                fig_history.add_trace(go.Scatter(
                    x=point_data['Date'],
                    y=point_data[map_var_col],
                    mode='lines+markers',
                    line=dict(color='#818cf8', width=3),
                    marker=dict(size=8, color='#6366f1'),
                    name=map_var_label
                ))
                
                # Threshold reference lines
                if 'safe' in limits:
                    fig_history.add_hline(
                        y=limits['safe'],
                        line_dash="dash",
                        line_color="#10b981",
                        annotation_text="Safe Limit",
                        annotation_position="bottom right"
                    )
                if 'caution' in limits:
                    fig_history.add_hline(
                        y=limits['caution'],
                        line_dash="dash",
                        line_color="#f59e0b",
                        annotation_text="Caution Limit",
                        annotation_position="top right"
                    )
                elif 'safe_low' in limits and 'safe_high' in limits:
                    fig_history.add_hline(
                        y=limits['safe_low'],
                        line_dash="dash",
                        line_color="#ef4444",
                        annotation_text="Lower Compliant Limit"
                    )
                    fig_history.add_hline(
                        y=limits['safe_high'],
                        line_dash="dash",
                        line_color="#ef4444",
                        annotation_text="Upper Compliant Limit"
                    )
                    
                fig_history.update_layout(
                    height=240,
                    margin={"t": 20, "b": 20, "l": 20, "r": 20},
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0)",
                    xaxis=dict(gridcolor="rgba(255,255,255,0.05)", tickfont=dict(color="#94a3b8")),
                    yaxis=dict(gridcolor="rgba(255,255,255,0.05)", tickfont=dict(color="#94a3b8")),
                    template="plotly_dark"
                )
                st.plotly_chart(fig_history, use_container_width=True)
                
                # Show full parameters in-situ card
                latest_record = point_data.iloc[-1]
                st.markdown("#### Latest Laboratory Readings")
                col_i1, col_i2, col_i3, col_i4 = st.columns(4)
                
                def render_param_col(st_col, param_name, param_col):
                    val = latest_record.get(param_col, None)
                    p_lim = MIMOSA_LIMITS.get(param_col, {})
                    if val is not None and not pd.isna(val):
                        _, color = get_compliance_status(param_col, val)
                        st_col.markdown(
                            f"<div style='background: rgba(17, 24, 39, 0.45); border: 1px solid rgba(255,255,255,0.05); padding: 10px 14px; border-radius: 8px; text-align: center; border-left: 4px solid {color}'>"
                            f"<div style='font-size: 0.8rem; color: #94a3b8;'>{param_name}</div>"
                            f"<div style='font-size: 1.1rem; font-weight: bold; color: #ffffff;'>{val:.2f} <span style='font-size: 0.7rem;'>{p_lim.get('unit','')}</span></div>"
                            f"</div>",
                            unsafe_allow_html=True
                        )
                    else:
                        st_col.markdown(
                            f"<div style='background: rgba(17, 24, 39, 0.45); border: 1px solid rgba(255,255,255,0.05); padding: 10px 14px; border-radius: 8px; text-align: center; border-left: 4px solid #6b7280'>"
                            f"<div style='font-size: 0.8rem; color: #94a3b8;'>{param_name}</div>"
                            f"<div style='font-size: 1.1rem; font-weight: bold; color: #6b7280;'>N/A</div>"
                            f"</div>",
                            unsafe_allow_html=True
                        )
                
                render_param_col(col_i1, "TSS", "TSS_mgL")
                render_param_col(col_i2, "pH", "pH")
                render_param_col(col_i3, "Turbidity", "Turbidity_NTU")
                render_param_col(col_i4, "Chlorophyll-a", "Chlorophyll_ugL")


# ── TAB 2: DATA EXPLORER ────────────────────────────────────────────────────

with tab_data:
    st.header("📊 Data Explorer")
    
    data = load_data()
    if data is None:
        st.warning("No data loaded. Sync from Drive or upload a CSV in the sidebar.")
    else:
        st.success(f"Loaded {len(data)} records from {data['_source_file'].nunique()} file(s)")
        
        # Filters
        col1, col2 = st.columns(2)
        with col1:
            if 'label' in data.columns:
                labels = ['All'] + sorted(data['label'].unique().tolist())
                sel_label = st.selectbox("Filter by Sample Point", labels)
                if sel_label != 'All':
                    data = data[data['label'] == sel_label]
        with col2:
            display_cols = st.multiselect(
                "Columns to display",
                data.columns.tolist(),
                default=[c for c in ['id','label'] + FEATURE_COLS + list(TARGET_OPTIONS.values()) if c in data.columns]
            )
        
        st.dataframe(data[display_cols] if display_cols else data, use_container_width=True)
        
        st.divider()
        
        # Distribution plots
        st.subheader("Feature Distributions")
        plot_cols = [c for c in FEATURE_COLS + list(TARGET_OPTIONS.values()) if c in data.columns]
        if plot_cols:
            sel_feat = st.selectbox("Select feature to visualize", plot_cols)
            
            fig_row = make_subplots(rows=1, cols=2, subplot_titles=["Histogram", "Box Plot"])
            fig_row.add_trace(
                go.Histogram(x=data[sel_feat], name=sel_feat, marker_color='#6366f1'),
                row=1, col=1
            )
            fig_row.add_trace(
                go.Box(y=data[sel_feat], name=sel_feat, marker_color='#818cf8'),
                row=1, col=2
            )
            fig_row.update_layout(
                template='plotly_dark', height=350, showlegend=False,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
            )
            st.plotly_chart(fig_row, use_container_width=True)
        
        # Correlation matrix
        st.subheader("Feature Correlation Matrix")
        numeric_cols = [c for c in FEATURE_COLS + list(TARGET_OPTIONS.values()) if c in data.columns]
        if numeric_cols:
            corr = data[numeric_cols].corr()
            fig_corr = px.imshow(
                corr, text_auto='.2f', color_continuous_scale='RdBu_r',
                zmin=-1, zmax=1, template='plotly_dark'
            )
            fig_corr.update_layout(
                height=500, paper_bgcolor='rgba(0,0,0,0)',
                plot_bgcolor='rgba(0,0,0,0)'
            )
            st.plotly_chart(fig_corr, use_container_width=True)


# ── TAB 3: ML MODEL ─────────────────────────────────────────────────────────

with tab_model:
    st.header("🤖 Random Forest Regression")
    
    data = load_data()
    if data is None:
        st.warning("No data loaded. Sync from Drive or upload a CSV first.")
    else:
        st.markdown("Configure and train the model. Each training run is **logged** and the model is **saved persistently**.")
        
        col1, col2, col3 = st.columns(3)
        with col1:
            target_label = st.selectbox("Target Variable", list(TARGET_OPTIONS.keys()))
            target_col = TARGET_OPTIONS[target_label]
        with col2:
            n_trees = st.slider("Number of Trees", 50, 1000, 500, 50)
        with col3:
            test_split = st.slider("Test Split (%)", 10, 50, 30, 5) / 100
        
        if st.button("🚀 Train Model", use_container_width=True, type="primary"):
            with st.spinner("Training Random Forest..."):
                result = train_model(data, target_col, n_trees, test_split)
            
            if result is None:
                st.error("Training failed. Ensure data has both spectral features and lab measurements.")
            else:
                st.session_state['last_result'] = result
                st.success(f"Model trained and saved! R²={result['r2_test']:.4f}, RMSE={result['rmse']:.4f}")
                
                # Metrics cards
                m1, m2, m3, m4, m5 = st.columns(5)
                m1.metric("R² (Train)", f"{result['r2_train']:.4f}")
                m2.metric("R² (Test)", f"{result['r2_test']:.4f}")
                m3.metric("RMSE", f"{result['rmse']:.4f}")
                m4.metric("MAE", f"{result['mae']:.4f}")
                m5.metric("OOB Score", f"{result['oob_score']:.4f}")
                
                st.divider()
                
                # Cross-validation
                st.subheader("Cross-Validation Scores")
                cv = result['cv_scores']
                cv_df = pd.DataFrame({'Fold': [f'Fold {i+1}' for i in range(len(cv))], 'R²': cv})
                fig_cv = px.bar(cv_df, x='Fold', y='R²', color='R²',
                    color_continuous_scale='Viridis', template='plotly_dark')
                fig_cv.add_hline(y=cv.mean(), line_dash='dash', line_color='#f59e0b',
                    annotation_text=f'Mean: {cv.mean():.4f}')
                fig_cv.update_layout(height=300, paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)')
                st.plotly_chart(fig_cv, use_container_width=True)
                
                # Feature importance
                st.subheader("Feature Importance")
                imp = result['importance']
                fig_imp = px.bar(imp, x='Importance', y='Feature', orientation='h',
                    color='Importance', color_continuous_scale='Viridis', template='plotly_dark')
                fig_imp.update_layout(height=400, yaxis={'categoryorder': 'total ascending'},
                    paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)')
                st.plotly_chart(fig_imp, use_container_width=True)


# ── TAB 4: PERFORMANCE ──────────────────────────────────────────────────────

with tab_perf:
    st.header("📈 Model Performance Analysis")
    
    result = st.session_state.get('last_result')
    if result is None:
        # Try to show info from training log
        log = load_training_log()
        if not log.empty:
            st.info("Showing metrics from last saved training run. Train a new model to see full plots.")
            st.dataframe(log.tail(5), use_container_width=True)
        else:
            st.warning("Train a model first in the ML Model tab.")
    else:
        col1, col2 = st.columns(2)
        
        # Predicted vs Actual (scatter)
        with col1:
            st.subheader("Predicted vs Actual")
            fig_scatter = go.Figure()
            fig_scatter.add_trace(go.Scatter(
                x=result['y_test'], y=result['y_pred_test'],
                mode='markers', name='Test', marker=dict(color='#6366f1', size=10)
            ))
            fig_scatter.add_trace(go.Scatter(
                x=result['y_train'], y=result['y_pred_train'],
                mode='markers', name='Train', marker=dict(color='#22d3ee', size=7, opacity=0.5)
            ))
            # Perfect prediction line
            all_vals = np.concatenate([result['y_test'], result['y_train']])
            mn, mx = all_vals.min(), all_vals.max()
            fig_scatter.add_trace(go.Scatter(
                x=[mn, mx], y=[mn, mx], mode='lines', name='1:1 Line',
                line=dict(color='#f59e0b', dash='dash')
            ))
            fig_scatter.update_layout(
                template='plotly_dark', height=400,
                xaxis_title='Actual', yaxis_title='Predicted',
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
            )
            st.plotly_chart(fig_scatter, use_container_width=True)
        
        # Residuals
        with col2:
            st.subheader("Residual Plot")
            residuals = result['y_test'].values - result['y_pred_test']
            fig_resid = go.Figure()
            fig_resid.add_trace(go.Scatter(
                x=result['y_pred_test'], y=residuals,
                mode='markers', marker=dict(color='#f87171', size=10)
            ))
            fig_resid.add_hline(y=0, line_color='#64748b', line_dash='dash')
            fig_resid.update_layout(
                template='plotly_dark', height=400,
                xaxis_title='Predicted', yaxis_title='Residual',
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
            )
            st.plotly_chart(fig_resid, use_container_width=True)
        
        # Residual distribution
        st.subheader("Residual Distribution")
        fig_hist = px.histogram(
            x=residuals, nbins=15, template='plotly_dark',
            color_discrete_sequence=['#818cf8'],
            labels={'x': 'Residual', 'count': 'Frequency'}
        )
        fig_hist.update_layout(
            height=300, paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
        )
        st.plotly_chart(fig_hist, use_container_width=True)
        
        # Model improvement tracker
        st.divider()
        st.subheader("Model Improvement Over Time")
        log = load_training_log()
        if len(log) > 1:
            fig_log = make_subplots(rows=1, cols=2, subplot_titles=['R² Over Runs', 'RMSE Over Runs'])
            fig_log.add_trace(
                go.Scatter(y=log['r2_test'], mode='lines+markers', name='R²',
                    marker=dict(color='#10b981'), line=dict(color='#10b981')),
                row=1, col=1
            )
            fig_log.add_trace(
                go.Scatter(y=log['rmse'], mode='lines+markers', name='RMSE',
                    marker=dict(color='#f87171'), line=dict(color='#f87171')),
                row=1, col=2
            )
            fig_log.update_layout(
                template='plotly_dark', height=300, showlegend=False,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
            )
            st.plotly_chart(fig_log, use_container_width=True)
        else:
            st.caption("Train the model multiple times to see improvement trends.")


# ── TAB 5: EMA COMPLIANCE ───────────────────────────────────────────────────

with tab_ema:
    st.header("📋 Mimosa Mine — Water Quality Compliance Report")
    
    data = load_data()
    result = st.session_state.get('last_result')
    
    if data is None:
        st.warning("No data loaded.")
    else:
        st.markdown("**Mimosa Mine Potable Water Standards** (aligned with EMA S.I. 274/2000)")
        
        # ── Standards Reference Table ─────────────────────────────────────
        st.subheader("Mine Compliance Standards")
        standards_data = {
            'Parameter': ['pH', 'TSS', 'E. coli', 'Total Coliform', 'Free Chlorine', 'Conductivity', 'Turbidity', 'Chlorophyll-a'],
            'Standard': ['6.5 – 7.5', '0 – 1 mg/L', '0 CFU/100mL', '< 1,000 CFU/100mL', '0.2 – 5.0 mg/L', '< 400 µS/cm', '< 1 NTU', '< 10 µg/L'],
            'Type': ['Range', 'Threshold', 'Zero Tolerance', 'Threshold', 'Range', 'Threshold', 'Threshold', 'Threshold'],
            'RS Detectable': ['⚠️ Indirect', '✅ NDTI proxy', '❌ Lab only', '❌ Lab only', '❌ Lab only', '⚠️ Weak', '✅ NDTI proxy', '✅ NDCI proxy']
        }
        st.dataframe(pd.DataFrame(standards_data), use_container_width=True, hide_index=True)
        
        st.divider()
        
        # ── Compliance Assessment per Parameter ───────────────────────────
        for label, col in TARGET_OPTIONS.items():
            if col not in data.columns:
                continue
            
            limits = MIMOSA_LIMITS.get(col, {})
            if not limits:
                continue
            
            st.subheader(f"{label}")
            
            # Determine parameter type and apply appropriate thresholds
            is_range = 'safe_low' in limits and 'safe_high' in limits
            is_zero_tolerance = limits.get('zero_tolerance', False)
            
            if is_range:
                # Range-based: pH (6.5-7.5), Free Chlorine (0.2-5.0)
                low = limits['safe_low']
                high = limits['safe_high']
                data[f'{col}_status'] = data[col].apply(
                    lambda v, lo=low, hi=high: '✅ Compliant' if lo <= v <= hi else '🚨 Non-Compliant'
                )
                st.markdown(f"**Acceptable Range: {low} – {high} {limits.get('unit', '')}**")
                
            elif is_zero_tolerance:
                # Zero tolerance: E. coli must be 0
                data[f'{col}_status'] = data[col].apply(
                    lambda v: '✅ Compliant' if v == 0 else '🚨 DETECTED — Non-Compliant'
                )
                st.markdown(f"**⛔ Zero Tolerance — Must be 0 {limits.get('unit', '')}**")
                
            else:
                # Standard threshold: TSS ≤1, Turbidity ≤1, Coliform <1000, etc.
                safe = limits.get('safe', 25)
                caution = limits.get('caution', 50)
                data[f'{col}_status'] = data[col].apply(
                    lambda v, s=safe, c=caution: '✅ Compliant' if v <= s else ('⚠️ Caution' if v <= c else '🚨 Non-Compliant')
                )
                st.markdown(f"**Safe ≤ {safe} {limits.get('unit','')} | Caution ≤ {caution} {limits.get('unit','')} | Above = Non-Compliant**")
            
            # Display status table per sample point
            if 'label' in data.columns:
                status_df = data[['label', col, f'{col}_status']].drop_duplicates('label')
                status_df.columns = ['Sample Point', label, 'Status']
                
                # Color-code the status
                def highlight_status(val):
                    if '✅' in str(val): return 'color: #10b981'
                    elif '⚠️' in str(val): return 'color: #f59e0b'
                    else: return 'color: #ef4444'
                
                st.dataframe(status_df, use_container_width=True, hide_index=True)
            
            # Gauge chart (different for each type)
            mean_val = data[col].mean()
            
            if is_range:
                low, high = limits['safe_low'], limits['safe_high']
                mid = (low + high) / 2
                spread = high - low
                color = '#10b981' if low <= mean_val <= high else '#ef4444'
                fig_gauge = go.Figure(go.Indicator(
                    mode="gauge+number",
                    value=mean_val,
                    title={'text': f'Mean {label}'},
                    gauge={
                        'axis': {'range': [low - spread, high + spread]},
                        'bar': {'color': color},
                        'steps': [
                            {'range': [low - spread, low], 'color': 'rgba(239,68,68,0.2)'},
                            {'range': [low, high], 'color': 'rgba(16,185,129,0.2)'},
                            {'range': [high, high + spread], 'color': 'rgba(239,68,68,0.2)'},
                        ],
                        'threshold': {'line': {'color': '#10b981', 'width': 2}, 'value': mid}
                    }
                ))
                fig_gauge.update_layout(
                    height=250, template='plotly_dark',
                    paper_bgcolor='rgba(0,0,0,0)'
                )
                st.plotly_chart(fig_gauge, use_container_width=True)
                
            elif not is_zero_tolerance:
                safe = limits.get('safe', 25)
                caution = limits.get('caution', 50)
                color = '#10b981' if mean_val <= safe else ('#f59e0b' if mean_val <= caution else '#ef4444')
                fig_gauge = go.Figure(go.Indicator(
                    mode="gauge+number",
                    value=mean_val,
                    title={'text': f'Mean {label}'},
                    gauge={
                        'axis': {'range': [0, caution * 1.5]},
                        'bar': {'color': color},
                        'steps': [
                            {'range': [0, safe], 'color': 'rgba(16,185,129,0.2)'},
                            {'range': [safe, caution], 'color': 'rgba(245,158,11,0.2)'},
                            {'range': [caution, caution*1.5], 'color': 'rgba(239,68,68,0.2)'},
                        ],
                        'threshold': {'line': {'color': '#ef4444', 'width': 3}, 'value': caution}
                    }
                ))
                fig_gauge.update_layout(
                    height=250, template='plotly_dark',
                    paper_bgcolor='rgba(0,0,0,0)'
                )
                st.plotly_chart(fig_gauge, use_container_width=True)
            
            else:
                # Zero tolerance — simple pass/fail indicator
                detected_count = (data[col] > 0).sum()
                total_count = len(data[col].dropna())
                if detected_count == 0:
                    st.success(f"✅ **PASS** — {limits.get('label', col)} not detected in any sample ({total_count} tested)")
                else:
                    st.error(f"🚨 **FAIL** — {limits.get('label', col)} detected in {detected_count}/{total_count} samples")
            
            st.divider()


# ── TAB 6: TRAINING LOGS ────────────────────────────────────────────────────

with tab_logs:
    st.header("📜 Training History & Logs")
    
    log = load_training_log()
    
    if log.empty:
        st.info("No training runs recorded yet. Train a model to start the log.")
    else:
        st.success(f"**{len(log)} training run(s)** recorded")
        
        # Summary metrics
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Best R²", f"{log['r2_test'].max():.4f}")
        c2.metric("Best RMSE", f"{log['rmse'].min():.4f}")
        c3.metric("Total Runs", len(log))
        c4.metric("Latest Target", log.iloc[-1]['target'])
        
        st.divider()
        
        # Full log table
        st.subheader("Complete Training Log")
        st.dataframe(log.sort_index(ascending=False), use_container_width=True, hide_index=True)
        
        # Trend charts
        if len(log) > 1:
            st.subheader("Performance Trends")
            
            fig_trends = make_subplots(
                rows=2, cols=2,
                subplot_titles=['R² (Test)', 'RMSE', 'MAE', 'CV Mean R²']
            )
            
            metrics = [('r2_test', '#10b981'), ('rmse', '#f87171'), ('mae', '#f59e0b'), ('cv_mean', '#6366f1')]
            for i, (col, color) in enumerate(metrics):
                r, c = divmod(i, 2)
                fig_trends.add_trace(
                    go.Scatter(
                        x=log['timestamp'], y=log[col],
                        mode='lines+markers', name=col,
                        line=dict(color=color), marker=dict(color=color, size=8)
                    ),
                    row=r+1, col=c+1
                )
            
            fig_trends.update_layout(
                template='plotly_dark', height=500, showlegend=False,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
            )
            fig_trends.update_xaxes(showticklabels=False)
            st.plotly_chart(fig_trends, use_container_width=True)
        
        # Download log
        st.divider()
        csv_log = log.to_csv(index=False)
        st.download_button(
            "📥 Download Training Log (CSV)",
            csv_log, "mimosa_training_log.csv", "text/csv",
            use_container_width=True
        )


# ============================================================================
# FOOTER
# ============================================================================

st.divider()
st.caption("Mimosa Mine Integrated WQ Monitoring Framework | Sentinel-2 L2A • CHIRPS v2.0 • RF Regressor • Streamlit")
