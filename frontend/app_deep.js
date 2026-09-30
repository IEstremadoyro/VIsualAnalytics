/* ============================================================
   Estado global
   ============================================================ */
const width = 1000;
const height = 600;
const margin = { top: 20, right: 20, bottom: 40, left: 50 };
const DPR = Math.min(window.devicePixelRatio || 1, 2); // limita DPR para no reventar el canvas

const colorPathology = d3.scaleOrdinal()
    .domain(['Normal (NORM)', 'Infarto Miocárdico (MI)', 'Cambios ST/T (STTC)',
        'Defecto de Conducción (CD)', 'Hipertrofia (HYP)', 'Múltiple / Otro'])
    .range(['#22a884', '#e63946', '#f4a261', '#4cc9f0', '#4361ee', '#adb5bd']);

const tooltip = d3.select("body").append("div").attr("class", "tooltip");

let dataGlobal = [];
let xScale, yScale;
let quadtree;
let patologiaSeleccionada = null;
let hoveredId = null;

let ctx, canvasNode;
let needsRedraw = false;

/* ============================================================
   Init del panel Meso (canvas + svg de ejes superpuestos)
   ============================================================ */
const container = d3.select("#scatter-plot")
    .style("position", "relative")
    .style("width", width + "px")
    .style("height", height + "px");

// 1. Canvas (puntos) debajo
canvasNode = container.append("canvas")
    .attr("width", width * DPR)
    .attr("height", height * DPR)
    .style("width", width + "px")
    .style("height", height + "px")
    .style("position", "absolute")
    .style("inset", 0)
    .style("cursor", "crosshair")
    .node();

ctx = canvasNode.getContext("2d", { alpha: true });
ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

// 2. SVG (ejes) encima, sin capturar el mouse
const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("position", "absolute")
    .style("inset", 0)
    .style("pointer-events", "none");

/* ============================================================
   Carga inicial
   ============================================================ */
d3.json("http://127.0.0.1:8000/api/pacientes").then(response => {
    dataGlobal = response.data;

    xScale = d3.scaleLinear()
        .domain(d3.extent(dataGlobal, d => d.umap_x)).nice()
        .range([margin.left, width - margin.right]);

    yScale = d3.scaleLinear()
        .domain(d3.extent(dataGlobal, d => d.umap_y)).nice()
        .range([height - margin.bottom, margin.top]);

    // Ejes
    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(xScale).ticks(10))
        .call(g => g.select(".domain").remove());

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(yScale).ticks(10))
        .call(g => g.select(".domain").remove());

    // Quadtree para hit-testing O(log n) → evita 21k listeners
    quadtree = d3.quadtree()
        .x(d => xScale(d.umap_x))
        .y(d => yScale(d.umap_y))
        .addAll(dataGlobal);

    dibujarMacroDiagnostico(dataGlobal);
    renderCanvas();

    // Interacción con el canvas (un único listener)
    container.on("mousemove", onCanvasMove)
        .on("mouseleave", onCanvasLeave)
        .on("click", onCanvasClick);
});

/* ============================================================
   Render del canvas — 21k puntos sin tocar el DOM
   ============================================================ */
function renderCanvas() {
    needsRedraw = false;
    ctx.clearRect(0, 0, width, height);

    const sel = patologiaSeleccionada;
    const points = dataGlobal;
    const n = points.length;

    // Precomputar posiciones una sola vez
    for (let i = 0; i < n; i++) {
        const d = points[i];
        const x = xScale(d.umap_x);
        const y = yScale(d.umap_y);

        let alpha = 0.65;
        let color = colorPathology(d.diagnostico);

        if (sel && d.diagnostico !== sel) {
            alpha = 0.04;
            color = "#cfd4da";
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 2.8, 0, 6.28318);
        ctx.fill();
    }

    // Punto resaltado encima
    if (hoveredId !== null) {
        const h = points.find(p => p.patient_id === hoveredId);
        if (h) {
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(xScale(h.umap_x), yScale(h.umap_y), 7, 0, 6.28318);
            ctx.fillStyle = "#fff";
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = colorPathology(h.diagnostico);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
}

function scheduleRedraw() {
    if (needsRedraw) return;
    needsRedraw = true;
    requestAnimationFrame(renderCanvas);
}

/* ============================================================
   Interacción con el canvas
   ============================================================ */
function onCanvasMove(event) {
    const [mx, my] = d3.pointer(event, canvasNode);
    const found = quadtree.find(mx, my, 12); // radio de tolerancia px

    if (found && !(patologiaSeleccionada && found.diagnostico !== patologiaSeleccionada)) {
        if (hoveredId !== found.patient_id) {
            hoveredId = found.patient_id;
            scheduleRedraw();
        }
        tooltip.style("opacity", 1)
            .html(`<strong>${found.diagnostico}</strong>
                   <div class="tt-sub">ID ${found.patient_id} · ${found.age} años · ${found.sex ?? ''}</div>`)
            .style("left", (event.pageX + 14) + "px")
            .style("top", (event.pageY - 20) + "px");
        canvasNode.style.cursor = "pointer";
    } else {
        if (hoveredId !== null) {
            hoveredId = null;
            scheduleRedraw();
        }
        tooltip.style("opacity", 0);
        canvasNode.style.cursor = "crosshair";
    }
}

function onCanvasLeave() {
    if (hoveredId !== null) { hoveredId = null; scheduleRedraw(); }
    tooltip.style("opacity", 0);
}

function onCanvasClick(event) {
    const [mx, my] = d3.pointer(event, canvasNode);
    const found = quadtree.find(mx, my, 12);
    if (!found) return;
    if (patologiaSeleccionada && found.diagnostico !== patologiaSeleccionada) return;

    d3.json(`http://127.0.0.1:8000/api/pacientes/${found.patient_id}/senal`)
        .then(microData => dibujarSenal(microData, colorPathology(found.diagnostico)))
        .catch(() => {
            d3.select("#line-chart").html(
                `<p class="error">Error: archivo físico del paciente ${found.patient_id} no encontrado.</p>`
            );
        });
}

/* ============================================================
   Panel Micro (ECG) — sin cambios funcionales, sí estéticos
   ============================================================ */
function dibujarSenal(data, color) {
    const senal = data.time_series.derivacion_I;
    const container = d3.select("#line-chart");
    container.selectAll("*").remove();

    const lw = 960, lh = 260;
    const lm = { top: 46, right: 24, bottom: 36, left: 56 };

    const lSvg = container.append("svg")
        .attr("viewBox", [0, 0, lw, lh])
        .style("width", "100%")
        .style("height", "auto");

    const lx = d3.scaleLinear().domain([0, senal.length]).range([lm.left, lw - lm.right]);
    const ly = d3.scaleLinear().domain(d3.extent(senal)).nice().range([lh - lm.bottom, lm.top]);

    // Grid sutil
    lSvg.append("g").attr("class", "grid")
        .attr("transform", `translate(0,${lh - lm.bottom})`)
        .call(d3.axisBottom(lx).ticks(10).tickSize(-(lh - lm.top - lm.bottom)).tickFormat(""));

    lSvg.append("g").attr("transform", `translate(${lm.left},0)`)
        .call(d3.axisLeft(ly).ticks(4))
        .call(g => g.select(".domain").remove());

    lSvg.append("g").attr("transform", `translate(0,${lh - lm.bottom})`)
        .call(d3.axisBottom(lx).ticks(8).tickFormat(d => (d / 100) + "s"))
        .call(g => g.select(".domain").remove());

    const line = d3.line().x((_, i) => lx(i)).y(d => ly(d));

    lSvg.append("path")
        .datum(senal)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.6)
        .attr("stroke-linejoin", "round")
        .attr("d", line);

    lSvg.append("text")
        .attr("x", lw / 2).attr("y", 24)
        .attr("text-anchor", "middle")
        .attr("class", "ecg-title")
        .text(`Paciente ${data.patient_id} · ${data.diagnostico}`);
}

/* ============================================================
   Panel Macro (anillo de patologías)
   ============================================================ */
function dibujarMacroDiagnostico(data) {
    const container = d3.select("#macro-view");
    container.selectAll("div.macro-wrapper").remove();

    const wrapper = container.append("div").attr("class", "macro-wrapper");

    const conteo = Array.from(
        d3.rollup(data, v => v.length, d => d.diagnostico),
        ([label, count]) => ({ label, count })
    ).sort((a, b) => b.count - a.count);

    const size = 260, radius = size / 2 - 20;

    const svg = wrapper.append("svg")
        .attr("viewBox", `0 0 ${size} ${size}`)
        .append("g").attr("transform", `translate(${size / 2},${size / 2})`);

    const pie = d3.pie().value(d => d.count).sort(null);
    const arcs = pie(conteo);
    const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius * 0.9);
    const arcH = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);

    const paths = svg.selectAll("path")
        .data(arcs)
        .join("path")
        .attr("d", arc)
        .attr("fill", d => colorPathology(d.data.label))
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .style("transition", "opacity .2s");

    paths.on("mouseover", function (event, d) {
        d3.select(this).transition().duration(150).attr("d", arcH);
        tooltip.style("opacity", 1)
            .html(`<strong>${d.data.label}</strong><div class="tt-sub">${d.data.count.toLocaleString()} casos</div>`)
            .style("left", (event.pageX + 14) + "px")
            .style("top", (event.pageY - 20) + "px");

        if (!patologiaSeleccionada) {
            patologiaSeleccionada = d.data.label;   // simula filtro temporal
            scheduleRedraw();
            patologiaSeleccionada = null;
        }
    })
        .on("mouseout", function () {
            d3.select(this).transition().duration(150).attr("d", arc);
            tooltip.style("opacity", 0);
            if (!patologiaSeleccionada) scheduleRedraw();
        })
        .on("click", function (event, d) {
            if (patologiaSeleccionada === d.data.label) {
                patologiaSeleccionada = null;
                paths.style("opacity", 1);
            } else {
                patologiaSeleccionada = d.data.label;
                paths.style("opacity", p => p.data.label === patologiaSeleccionada ? 1 : 0.28);
            }
            scheduleRedraw();
        });
}