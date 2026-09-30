from functools import lru_cache
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
import pandas as pd
import wfdb
import os
import re

app = FastAPI(title="PTB-XL Visual Analytics API")

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "ptbxl_limpio_con_umap.csv")

PAYLOAD = None

# Diccionario clínico oficial de PhysioNet para agrupar sub-códigos en Superclases
MAPEO_PTBXL = {
    'NORM': 'NORM',
    'AMI': 'MI', 'ALMI': 'MI', 'ASMI': 'MI', 'ILMI': 'MI', 'IMI': 'MI',
    'IPLMI': 'MI', 'IPMI': 'MI', 'LMI': 'MI', 'PMI': 'MI', 'OSMI': 'MI',
    'INJAS': 'MI', 'INJAL': 'MI', 'INJIN': 'MI', 'INJLA': 'MI', 'INJIL': 'MI',
    'ISC_': 'STTC', 'ISCA': 'STTC', 'ISCAS': 'STTC', 'ISCI': 'STTC',
    'ISCIL': 'STTC', 'ISCIN': 'STTC', 'ISCLA': 'STTC', 'NDT': 'STTC', 'STTC': 'STTC',
    'CRBBB': 'CD', 'IRBBB': 'CD', 'IVCD': 'CD', 'LAFB': 'CD', 'LBBB': 'CD',
    'LPFB': 'CD', 'RBBB': 'CD', 'WPW': 'CD', 'ILBBB': 'CD', 'CLBBB': 'CD',
    'LVH': 'HYP', 'RVH': 'HYP', 'SEHYP': 'HYP'
}

# NUEVA LÓGICA: Traducción clínica y acumulación de comorbilidades
def obtener_patologia(scp_texto):
    # Extraer todos los códigos crudos del string (ej: "{'LBBB': 100.0, 'SR': 0.0}")
    codigos_crudos = re.findall(r"'([A-Z0-9_]+)'", str(scp_texto))
    
    patologias = set()
    for codigo in codigos_crudos:
        if codigo in MAPEO_PTBXL:
            patologias.add(MAPEO_PTBXL[codigo])
    
    # Si el paciente solo tiene códigos de ritmo (ej. 'SR', 'AFIB') y ningún diagnóstico principal
    if not patologias:
        return 'Otro'
        
    # Ordenar alfabéticamente para evitar duplicados invertidos (ej. "MI + CD" vs "CD + MI")
    return ' + '.join(sorted(list(patologias)))


try:
    df_pacientes = pd.read_csv(CSV_PATH)
    id_col = 'ecg_id' if 'ecg_id' in df_pacientes.columns else 'patient_id'
    df_pacientes.set_index(id_col, inplace=True, drop=False)

    if 'scp_codes' in df_pacientes.columns:
        df_pacientes['diagnostico'] = df_pacientes['scp_codes'].apply(obtener_patologia)
    else:
        df_pacientes['diagnostico'] = 'NORM'

    columnas = [c for c in [id_col, 'age', 'sex', 'umap_x', 'umap_y', 'diagnostico'] if c in df_pacientes.columns]
    ligero = df_pacientes[columnas].rename(columns={id_col: 'patient_id'}).round({'umap_x': 3, 'umap_y': 3})
    ligero = ligero.astype(object).where(ligero.notna(), None)
    registros = ligero.to_dict(orient='records')
    PAYLOAD = {"total": len(registros), "data": registros}

except Exception as e:
    print(f"Error cargando CSV: {e}")
    df_pacientes = pd.DataFrame()


@app.get("/api/pacientes")
def get_poblacion_global():
    if PAYLOAD is None:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    return JSONResponse(PAYLOAD, headers={"Cache-Control": "public, max-age=3600"})


@lru_cache(maxsize=256)
def _leer_canal_I(ruta_completa: str):
    senales, _ = wfdb.rdsamp(ruta_completa, channels=[0])
    return [round(float(v), 3) for v in senales[:, 0]]


@app.get("/api/pacientes/{patient_id}/senal")
def get_senal_paciente(patient_id: int):
    try:
        fila = df_pacientes.loc[patient_id]
        ruta_archivo = str(fila.get('filename_lr'))
        ruta_completa = os.path.join(DATA_DIR, ruta_archivo)

        if not os.path.exists(ruta_completa + ".dat"):
            raise HTTPException(status_code=404, detail=f"Falta el archivo {ruta_archivo}.dat en tu carpeta local.")

        return {
            "patient_id": patient_id,
            "diagnostico": fila.get('diagnostico', 'Desconocido'),
            "sampling_rate": 100,
            "time_series": {"derivacion_I": _leer_canal_I(ruta_completa)},
        }
    except HTTPException:
        raise
    except KeyError:
        raise HTTPException(status_code=404, detail="Paciente no encontrado en el CSV.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))