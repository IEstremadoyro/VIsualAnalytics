# PTB-XL Visual Analytics

Plataforma interactiva de analítica visual para la exploración de señales electrocardiográficas (ECG) del dataset PTB-XL, estructurada en tres niveles de análisis:

- **Nivel Macro (Demografía):** Distribución y filtros demográficos por edad y sexo.
- **Nivel Meso (Espacio Latente):** Proyección bidimensional interactiva (UMAP) para clustering y detección de patrones patológicos.
- **Nivel Micro (Señales Fisiológicas):** Visualización interactiva de la señal electrocardiográfica (Canal I / 12 derivaciones).

---

## 🚀 Estructura del Proyecto

```text
proyecto_visual_analytics/
├── backend/
│   ├── main.py              # API FastAPI con compresión y endpoints de datos/señales
│   └── ...
├── frontend/
│   ├── index.html           # Interfaz de usuario con visualizaciones D3.js
│   ├── app.js               # Lógica interactiva y peticiones a la API
│   └── style.css            # Estilos del dashboard
├── data/
│   ├── ptbxl_limpio_con_umap.csv   # Dataset procesado con coordenadas UMAP
│   ├── modelo_ptbxl_fourier.pth    # Pesos del modelo entrenado
│   └── records100/                 # (Opcional) Señales crudas WFDB descargadas de PhysioNet
├── requirements.txt         # Dependencias de Python
└── README.md
```

---

## 🛠️ Instalación y Ejecución

### 1. Backend (FastAPI)

1. Crear y activar entorno virtual:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Instalar dependencias:
   ```bash
   pip install -r requirements.txt
   ```

3. Iniciar el servidor backend:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8000
   ```

El backend estará disponible en `http://localhost:8000` con documentación interactiva en `http://localhost:8000/docs`.

### 2. Frontend

Puedes abrir `frontend/index.html` en tu navegador o servirlo mediante un servidor local (por ejemplo con Python o la extensión Live Server de VS Code):

```bash
cd frontend
python3 -m http.server 5500
```
Luego abrir `http://localhost:5500`.

---

## 📊 Dataset

Este proyecto utiliza el dataset clínico **PTB-XL** disponible en PhysioNet. Para la visualización de señales crudas a nivel micro, asegúrate de colocar la carpeta `records100/` dentro del directorio `data/`.
