from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
import wfdb
import os
import ast

app = FastAPI(title="PTB-XL Visual Analytics API")

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

try:
    df_pacientes = pd.read_csv(CSV_PATH)
    
    # 1. Usar el ID oficial de PTB-XL para evitar el desfase de archivos
    id_col = 'ecg_id' if 'ecg_id' in df_pacientes.columns else 'patient_id'
    df_pacientes.set_index(id_col, inplace=True, drop=False)
    
    # 2. Extracción clínica: Mapear códigos a Superclases Diagnósticas
    def obtener_patologia(scp_texto):
        scp = str(scp_texto)
        if 'NORM' in scp: return 'Normal (NORM)'
        if 'MI' in scp: return 'Infarto Miocárdico (MI)'
        if 'STTC' in scp: return 'Cambios ST/T (STTC)'
        if 'CD' in scp: return 'Defecto de Conducción (CD)'
        if 'HYP' in scp: return 'Hipertrofia (HYP)'
        return 'Múltiple / Otro'

    if 'scp_codes' in df_pacientes.columns:
        df_pacientes['diagnostico'] = df_pacientes['scp_codes'].apply(obtener_patologia)
    else:
        df_pacientes['diagnostico'] = 'Normal (NORM)' # Fallback si no existe la columna

except Exception as e:
    print(f"Error cargando CSV: {e}")
    df_pacientes = pd.DataFrame()

@app.get("/api/pacientes")
def get_poblacion_global():
    if df_pacientes.empty:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    
    # Exponer la variable 'diagnostico' hacia D3.js
    columnas_d3 = [id_col, 'age', 'sex', 'umap_x', 'umap_y', 'diagnostico']
    columnas_d3 = [c for c in columnas_d3 if c in df_pacientes.columns]
    
    datos_json = df_pacientes[columnas_d3].rename(columns={id_col: 'patient_id'}).to_dict(orient='records')
    return {"total": len(datos_json), "data": datos_json}

@app.get("/api/pacientes/{patient_id}/senal")
def get_senal_paciente(patient_id: int):
    try:
        fila = df_pacientes.loc[patient_id]
        ruta_archivo = str(fila.get('filename_lr'))
        ruta_completa = os.path.join(DATA_DIR, ruta_archivo)
        
        # Validación de existencia física antes de intentar leer
        if not os.path.exists(ruta_completa + ".dat"):
            raise HTTPException(status_code=404, detail=f"Falta el archivo {ruta_archivo}.dat en tu carpeta local.")

        senales, metadatos = wfdb.rdsamp(ruta_completa)
        canal_I = senales[:, 0]
        
        return {
            "patient_id": patient_id,
            "diagnostico": fila.get('diagnostico', 'Desconocido'),
            "sampling_rate": 100,
            "time_series": {"derivacion_I": canal_I.tolist()}
        }
    except KeyError:
        raise HTTPException(status_code=404, detail="Paciente no encontrado en el CSV.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))