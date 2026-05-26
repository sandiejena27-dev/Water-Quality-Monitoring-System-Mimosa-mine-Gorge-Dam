from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import joblib
import os
from pathlib import Path
from typing import List, Dict, Any

app = FastAPI(title="MIMOSA WQ PLATFORM API", version="1.0.0")

# Enable CORS for the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to the frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = Path(__file__).parent
MODELS_DIR = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)
MODEL_PATH = MODELS_DIR / "rf_model.pkl"
SCALER_PATH = MODELS_DIR / "scaler.pkl"
LOG_PATH = MODELS_DIR / "training_log.csv"

# Request Models
class PredictionRequest(BaseModel):
    features: Dict[str, float]

class TrainingRequest(BaseModel):
    target: str
    data: List[Dict[str, Any]]

@app.get("/")
def read_root():
    return {"status": "ok", "message": "MIMOSA WQ PLATFORM API is running"}

@app.get("/api/health")
def health_check():
    model_loaded = MODEL_PATH.exists() and SCALER_PATH.exists()
    return {"status": "ok", "model_loaded": model_loaded}

@app.post("/api/predict")
def predict(request: PredictionRequest):
    if not MODEL_PATH.exists() or not SCALER_PATH.exists():
        raise HTTPException(status_code=400, detail="Model is not trained yet")
    
    try:
        model = joblib.load(MODEL_PATH)
        scaler = joblib.load(SCALER_PATH)
        
        # Expected feature order
        feature_cols = ['B2','B3','B4','B5','B8','B11','B12','NDWI','NDTI','NDCI','TSI','AWEIn']
        
        # Create DataFrame from request features
        input_data = pd.DataFrame([request.features], columns=feature_cols)
        
        # Scale and predict
        scaled_input = scaler.transform(input_data)
        prediction = model.predict(scaled_input)[0]
        
        return {"prediction": prediction}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/points")
def get_points():
    # Mock data for points, this should ideally come from a database or spatial file
    points = [
        {"id": f"SP{str(i).zfill(2)}", "name": f"Gorge Dam Point {i}", "lat": -20.3, "lng": 29.8, "status": "Compliant"}
        for i in range(1, 35)
    ]
    return {"points": points}

@app.post("/api/train")
def train_model(request: TrainingRequest):
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import r2_score, mean_squared_error
    import datetime
    
    if not request.data:
        raise HTTPException(status_code=400, detail="No training data provided")
        
    df = pd.DataFrame(request.data)
    feature_cols = ['B2','B3','B4','B5','B8','B11','B12','NDWI','NDTI','NDCI','TSI','AWEIn']
    available_features = [c for c in feature_cols if c in df.columns]
    
    if not available_features or request.target not in df.columns:
        raise HTTPException(status_code=400, detail="Missing features or target in data")
        
    clean = df[available_features + [request.target]].dropna()
    if len(clean) < 5:
        raise HTTPException(status_code=400, detail="Not enough valid data points for training")
        
    X = clean[available_features]
    y = clean[request.target]
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.3, random_state=42)
    
    rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    
    y_pred_test = rf.predict(X_test)
    r2_test = r2_score(y_test, y_pred_test)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
    
    # Save
    joblib.dump(rf, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)
    
    return {
        "status": "success", 
        "r2_test": r2_test, 
        "rmse": rmse, 
        "timestamp": datetime.datetime.now().isoformat()
    }
