"""
PTB-XL Visual Analytics v2 - backend FastAPI.

Estructura esperada:
    main.py
    data/ptbxl_predictivo_umap.csv
    data/senales_norm_f16.npy
    data/atencion.npy
    data/norm_stats.npz
    static/index.html, app.js, style.css

Ejecutar:  uvicorn main:app --reload
No necesita torch: las predicciones, vecinos y atención ya vienen calculados
en el notebook (el orden de filas del CSV y de los .npy es el mismo).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).resolve().parent   # carpeta de main.py (p. ej. backend/)
RAIZ = BASE.parent                       # carpeta del proyecto


def _primero(candidatos, marca):
    """Primera carpeta candidata que contiene el archivo `marca`."""
    for c in candidatos:
        if (c / marca).exists():
            return c
    raise FileNotFoundError(
        f"No encuentro '{marca}'. Busqué en:\n" + "\n".join(f"  - {c}" for c in candidatos)
    )


DATA = _primero([BASE / "data", RAIZ / "data", BASE, RAIZ], "ptbxl_predictivo_umap.csv")
STATIC = _primero(
    [BASE / "static", RAIZ / "static", RAIZ / "frontend", BASE / "frontend", RAIZ / "frontend" / "static"],
    "index.html",
)

CLASES = ["NORM", "MI", "STTC", "CD", "HYP"]
CL2I = {c: i for i, c in enumerate(CLASES)}
SPLITS = ["train", "val", "test"]
DERIVACIONES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
FS = 100
PASO_ATENCION = 16  # 1000 muestras -> 62 pasos tras 4 MaxPool(2)

print(f"[PTB-XL] datos:     {DATA}")
print(f"[PTB-XL] estáticos: {STATIC}")
for _f in ("app.js", "style.css"):
    if not (STATIC / _f).exists():
        print(f"[PTB-XL] AVISO: falta {STATIC / _f}. Sin ese archivo la página se ve sin estilos o sin datos.")

app = FastAPI(title="PTB-XL Visual Analytics")
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ---------------------------------------------------------------- datos
df = pd.read_csv(DATA / "ptbxl_predictivo_umap.csv")
SENALES = np.load(DATA / "senales_norm_f16.npy", mmap_mode="r")   # (N, 12, 1000) z-score
ATENCION = np.load(DATA / "atencion.npy", mmap_mode="r")          # (N, 62)
assert len(df) == SENALES.shape[0] == ATENCION.shape[0], "CSV y .npy desalineados"

if (DATA / "norm_stats.npz").exists():
    _s = np.load(DATA / "norm_stats.npz")
    MU, SD = _s["mu"].reshape(-1), _s["sd"].reshape(-1)
else:  # sin estadísticas se devuelve la señal en desviaciones estándar
    MU, SD = np.zeros(12), np.ones(12)

LABEL = df["label"].map(CL2I).to_numpy(dtype=int)
PRED = df["prediccion"].map(CL2I).to_numpy(dtype=int)
SPLIT = df["split"].map({s: i for i, s in enumerate(SPLITS)}).to_numpy(dtype=int)
AGE = df["age"].fillna(0).clip(upper=90).to_numpy()   # PTB-XL codifica >89 años como 300
SEX = df["sex"].fillna(0).astype(int).to_numpy()      # 0 = hombre, 1 = mujer
PROBS = df[[f"p_{c}" for c in CLASES]].to_numpy()
POS = pd.Series(np.arange(len(df)), index=df["ecg_id"])  # ecg_id -> fila

_cache_puntos: dict[str, bytes] = {}


def fila(ecg_id: int) -> int:
    if ecg_id not in POS.index:
        raise HTTPException(404, f"ecg_id {ecg_id} no existe")
    return int(POS[ecg_id])


# ---------------------------------------------------------------- API
@app.get("/api/puntos")
def api_puntos(proy: str = Query("umap", pattern="^(umap|tsne)$")):
    """Todos los puntos en formato columnar (se filtra en el cliente)."""
    if proy not in _cache_puntos:
        cx, cy = f"{proy}_x", f"{proy}_y"
        if cx not in df.columns:
            raise HTTPException(404, f"El CSV no tiene la proyección {proy}")
        payload = {
            "n": len(df),
            "proy": proy,
            "clases": CLASES,
            "id": df["ecg_id"].tolist(),
            "x": df[cx].round(3).tolist(),
            "y": df[cy].round(3).tolist(),
            "label": LABEL.tolist(),
            "pred": PRED.tolist(),
            "conf": df["confianza"].round(3).tolist(),
            "knn": df["knn_acuerdo"].round(2).tolist(),
            "age": AGE.tolist(),
            "sex": SEX.tolist(),
            "split": SPLIT.tolist(),
        }
        _cache_puntos[proy] = json.dumps(payload, separators=(",", ":")).encode()
    return Response(_cache_puntos[proy], media_type="application/json")


@app.get("/api/paciente/{ecg_id}")
def api_paciente(ecg_id: int):
    i = fila(ecg_id)
    r = df.iloc[i]
    vec = [int(v) for v in str(r["vecinos"]).split(";") if v.strip().isdigit()]
    return {
        "ecg_id": int(r["ecg_id"]),
        "patient_id": int(r["patient_id"]),
        "edad": None if r["age"] > 89 else int(r["age"]),
        "sexo": "Mujer" if SEX[i] == 1 else "Hombre",
        "fold": int(r["strat_fold"]),
        "split": r["split"],
        "label": r["label"],
        "prediccion": r["prediccion"],
        "confianza": float(r["confianza"]),
        "probs": [round(float(p), 4) for p in PROBS[i]],
        "knn_acuerdo": float(r["knn_acuerdo"]),
        "frac_vecinos_MI": float(r["frac_vecinos_MI"]),
        "vecinos": vec,
    }


@app.get("/api/senal/{ecg_id}")
def api_senal(ecg_id: int, derivacion: int = Query(0, ge=0, le=11)):
    """Señal de una derivación en mV (filtrada 0,5-40 Hz) y atención interpolada a 100 Hz."""
    i = fila(ecg_id)
    z = np.asarray(SENALES[i, derivacion], dtype=np.float32)
    mv = z * SD[derivacion] + MU[derivacion]

    att = np.asarray(ATENCION[i], dtype=np.float32)
    centros = (np.arange(len(att)) + 0.5) * PASO_ATENCION
    att_m = np.interp(np.arange(len(z)), centros, att)
    att_m = att_m / (att_m.max() + 1e-12)   # 0-1 por registro

    return {
        "fs": FS,
        "derivacion": DERIVACIONES[derivacion],
        "mv": np.round(mv, 4).tolist(),
        "atencion": np.round(att_m, 3).tolist(),
    }


# ---------------------------------------------------------------- estáticos
@app.get("/")
def raiz():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)