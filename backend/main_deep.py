from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware   # ← comprime respuestas
from functools import lru_cache
import pandas as pd
import numpy as np
import wfdb
import os

app = FastAPI(title="PTB-XL Visual Analytics API")

app.add_middleware(GZipMiddleware, minimum_size=500)  # JSON comprimido ~10x

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "ptbxl_limpio_con_umap.csv")

df_pacientes = pd.DataFrame()
_poblacion_cache = None   # caché del payload ya serializado

try:
    df_pacientes = pd.read_csv(CSV_PATH)

    id_col = 'ecg_id' if 'ecg_id' in df_pacientes.columns else 'patient_id'
    df_pacientes.set_index(id_col, inplace=True, drop=False)

    def obtener_patologia(scp_texto):
        scp = str(scp_texto)
        if 'NORM' in scp: return 'Normal (NORM)'
        if 'MI'   in scp: return 'Infarto Miocárdico (MI)'
        if 'STTC' in scp: return 'Cambios ST/T (STTC)'
        if 'CD'   in scp: return 'Defecto de Conducción (CD)'
        if 'HYP'  in scp: return 'Hipertrofia (HYP)'
        return 'Múltiple / Otro'

    if 'scp_codes' in df_pacientes.columns:
        df_pacientes['diagnostico'] = df_pacientes['scp_codes'].apply(obtener_patologia)
    else:
        df_pacientes['diagnostico'] = 'Normal (NORM)'

    # >>> REDUCCIÓN DE PAYLOAD: redondear coordenadas y normalizar tipos
    for col in ('umap_x', 'umap_y'):
        if col in df_pacientes.columns:
            df_pacientes[col] = df_pacientes[col].round(3).astype('float32')

    if 'age' in df_pacientes.columns:
        df_pacientes['age'] = pd.to_numeric(df_pacientes['age'], errors='coerce').fillna(0).astype('int16')

except Exception as e:
    print(f"Error cargando CSV: {e}")


@app.get("/api/pacientes")
def get_poblacion_global():
    """Devuelve una vez todo el dataset. Se cachea en memoria tras la primera llamada."""
    global _poblacion_cache
    if df_pacientes.empty:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")

    if _poblacion_cache is not None:
        return _poblacion_cache

    columnas = [id_col, 'age', 'sex', 'umap_x', 'umap_y', 'diagnostico']
    columnas = [c for c in columnas if c in df_pacientes.columns]

    datos = (
        df_pacientes[columnas]
        .rename(columns={id_col: 'patient_id'})
        .to_dict(orient='records')
    )
    _poblacion_cache = {"total": len(datos), "data": datos}
    return _poblacion_cache


@lru_cache(maxsize=256)   # cachea lecturas de señal idénticas
def _cargar_senal(ruta_completa: str):
    senales, _ = wfdb.rdsamp(ruta_completa)
    return senales[:, 0].tolist()


@app.get("/api/pacientes/{patient_id}/senal")
def get_senal_paciente(patient_id: int):
    try:
        fila = df_pacientes.loc[patient_id]
        ruta_archivo = str(fila.get('filename_lr'))
        ruta_completa = os.path.join(DATA_DIR, ruta_archivo)

        if not os.path.exists(ruta_completa + ".dat"):
            raise HTTPException(status_code=404, detail=f"Falta {ruta_archivo}.dat")

        canal_I = _cargar_senal(ruta_completa)

        return {
            "patient_id": patient_id,
            "diagnostico": fila.get('diagnostico', 'Desconocido'),
            "sampling_rate": 100,
            "time_series": {"derivacion_I": canal_I},
        }
    except KeyError:
        raise HTTPException(status_code=404, detail="Paciente no encontrado en el CSV.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))