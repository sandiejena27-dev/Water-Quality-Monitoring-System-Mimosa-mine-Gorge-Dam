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


def load_data():
    """Load all CSV files from data directory."""
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

tab_home, tab_data, tab_model, tab_perf, tab_ema, tab_logs = st.tabs([
    "🏠 Home", "📊 Data Explorer", "🤖 ML Model",
    "📈 Performance", "📋 EMA Report", "📜 Training Logs"
])


# ── TAB 1: HOME ─────────────────────────────────────────────────────────────

with tab_home:
    st.title("◆ Mimosa Mine — Water Quality Intelligence")
    st.markdown("""
    **Component 2** of the Integrated Water Quality Monitoring Framework.  
    This dashboard receives spectral index exports from the **GEE Remote Sensing Engine** 
    and runs a **Random Forest Regression** model to predict in-situ water quality 
    parameters from satellite-derived features.
    """)
    
    # ── Prominent GEE Launch ─────────────────────────────────────────────
    st.subheader("🛰️ Step 1 — Run Remote Sensing Analysis")
    launch_col1, launch_col2 = st.columns([2, 1])
    with launch_col1:
        st.markdown("""
        Open the **GEE Remote Sensing Engine** to:
        - Compute spectral indices (NDWI, NDTI, NDCI, TSI, AWEIn)
        - Visualize water quality layers on the map  
        - **Export Training CSV and Zonal Stats to Google Drive**
        
        Once exported, return here and click **"Sync from Google Drive"** in the sidebar.
        """)
    with launch_col2:
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
    col1, col2, col3 = st.columns(3)
    with col1:
        st.info(
            "**📡 Component 1 — GEE App**\n\n"
            "[Live App →](" + GEE_APP_URL + ")\n\n"
            "→ Sentinel-2 L2A processing\n"
            "→ 5 spectral index computation\n"
            "→ Export CSV/TIFF to Drive"
        )
    with col2:
        st.success(
            "**🔗 Data Bridge — Google Drive**\n\n"
            "[Open Folder →](" + DRIVE_FOLDER_URL + ")\n\n"
            "→ Mimosa_Training_Data_*.csv\n"
            "→ Mimosa_Zonal_Stats_*.csv\n"
            "→ Mimosa_WQ_Indices_*.tif"
        )
    with col3:
        st.warning(
            "**🤖 Component 2 — This Dashboard**\n\n"
            "→ RF Regression (500 trees)\n"
            "→ R², RMSE, CV validation\n"
            "→ EMA S.I. 274 compliance"
        )
    
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
