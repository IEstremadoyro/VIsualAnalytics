const API = "http://127.0.0.1:8000";
const W = 1000, H = 600;
const M = { top: 20, right: 20, bottom: 40, left: 50 };
const R = 2.5;

const coloresBase = {
    'NORM': '#1a9850',
    'MI': '#d73027',
    'STTC': '#fdae61',
    'CD': '#abd9e9',
    'HYP': '#4575b4',
    'Otro': '#b0b7c0'
};
const coloresDinamicos = d3.scaleOrdinal(d3.schemeCategory10);
const colorPathology = (label) => coloresBase[label] || coloresDinamicos(label);

const tooltip = d3.select("body").append("div").attr("class", "tooltip");

let filtro = null;
let preview = null;
let seleccionado = null;
let hover = null;
let grupos = new Map();
let quadtree, ctx, dpr, arcos, itemsLeyenda;
const cacheSenales = new Map();
let abortSenal = null;

const filtroActivo = () => filtro ?? preview;
const visible = d => { const f = filtroActivo(); return !f || d.diagnostico === f; };

d3.json(`${API}/api/pacientes`).then(({ data }) => {
    iniciarScatter(data);
    dibujarMacroDiagnostico(data);
    draw();
}).catch(err => {
    d3.select("#scatter-plot").html(`<p class="estado error">No se pudo conectar con la API: ${err.message}</p>`);
});

/* ---------- MESO: scatter en Canvas ---------- */
function iniciarScatter(data) {
    const x = d3.scaleLinear().domain(d3.extent(data, d => d.umap_x)).nice().range([M.left, W - M.right]);
    const y = d3.scaleLinear().domain(d3.extent(data, d => d.umap_y)).nice().range([H - M.bottom, M.top]);

    data.forEach(d => { d.px = x(d.umap_x); d.py = y(d.umap_y); });
    grupos = d3.group(data, d => d.diagnostico);
    quadtree = d3.quadtree().x(d => d.px).y(d => d.py).addAll(data);

    const cont = d3.select("#scatter-plot");
    cont.selectAll("*").remove();
    dpr = window.devicePixelRatio || 1;

    const canvas = cont.append("canvas")
        .attr("width", W * dpr).attr("height", H * dpr).node();
    ctx = canvas.getContext("2d");

    const svg = cont.append("svg").attr("class", "overlay").attr("viewBox", [0, 0, W, H]);
    svg.append("g").attr("transform", `translate(0,${H - M.bottom})`)
        .call(d3.axisBottom(x).ticks(10)).call(g => g.select(".domain").remove());
    svg.append("g").attr("transform", `translate(${M.left},0)`)
        .call(d3.axisLeft(y).ticks(10)).call(g => g.select(".domain").remove());

    canvas.addEventListener("mousemove", e => {
        const r = canvas.getBoundingClientRect();

        // CORRECCIÓN MATEMÁTICA: Compensar los márgenes de 'object-fit: contain'
        const scale = Math.min(r.width / W, r.height / H);
        const offsetX = (r.width - W * scale) / 2;
        const offsetY = (r.height - H * scale) / 2;

        // Calcular la coordenada exacta restando el margen y dividiendo por la escala
        const mouseX = (e.clientX - r.left - offsetX) / scale;
        const mouseY = (e.clientY - r.top - offsetY) / scale;

        const d = quadtree.find(mouseX, mouseY, 8);

        const nuevo = d && visible(d) ? d : null;
        if (nuevo !== hover) { hover = nuevo; draw(); }
        if (nuevo) {
            tooltip.style("opacity", .92)
                .html(`<strong>${nuevo.diagnostico}</strong><br/>ID: ${nuevo.patient_id} · Edad: ${nuevo.age}`)
                .style("left", (e.pageX + 12) + "px").style("top", (e.pageY - 30) + "px");
        } else {
            tooltip.style("opacity", 0);
        }
        canvas.style.cursor = nuevo ? "pointer" : "default";
    });

    canvas.addEventListener("mouseleave", () => { hover = null; tooltip.style("opacity", 0); draw(); });
    canvas.addEventListener("click", () => { if (hover) cargarSenal(hover); });
}

function pintar(pts) {
    ctx.beginPath();
    for (const p of pts) { ctx.moveTo(p.px + R, p.py); ctx.arc(p.px, p.py, R, 0, 6.2832); }
    ctx.fill();
}

function draw() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const f = filtroActivo();

    if (f) {
        ctx.globalAlpha = 0.4; ctx.fillStyle = "#dfe3e8";
        for (const [l, pts] of grupos) if (l !== f) pintar(pts);
    }
    ctx.globalAlpha = f ? 0.95 : 0.7;
    for (const [l, pts] of grupos) {
        if (f && l !== f) continue;
        ctx.fillStyle = colorPathology(l);
        pintar(pts);
    }
    ctx.globalAlpha = 1;
    for (const d of [hover, seleccionado]) {
        if (!d) continue;
        ctx.beginPath(); ctx.arc(d.px, d.py, 6, 0, 6.2832);
        ctx.fillStyle = colorPathology(d.diagnostico); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = d === seleccionado ? "#111" : "#555"; ctx.stroke();
    }
}

/* ---------- MICRO: señal ECG ---------- */
async function cargarSenal(d) {
    seleccionado = d; draw();
    const cont = d3.select("#line-chart");
    cont.html('<p class="estado">Cargando señal…</p>');
    abortSenal?.abort();
    abortSenal = new AbortController();
    try {
        let m = cacheSenales.get(d.patient_id);
        if (!m) {
            const r = await fetch(`${API}/api/pacientes/${d.patient_id}/senal`, { signal: abortSenal.signal });
            if (!r.ok) throw new Error((await r.json()).detail || r.status);
            m = await r.json();
            cacheSenales.set(d.patient_id, m);
        }
        dibujarSenal(m, colorPathology(d.diagnostico));
    } catch (err) {
        if (err.name === "AbortError") return;
        cont.html(`<p class="estado error">Error: ${err.message}</p>`);
    }
}

function dibujarSenal(data, color) {
    const senal = data.time_series.derivacion_I;
    const cont = d3.select("#line-chart");
    cont.selectAll("*").remove();

    const lw = 1000, lh = 260, m = { top: 40, right: 20, bottom: 36, left: 50 };
    const svg = cont.append("svg").attr("viewBox", [0, 0, lw, lh]);
    const x = d3.scaleLinear().domain([0, senal.length - 1]).range([m.left, lw - m.right]);
    const y = d3.scaleLinear().domain(d3.extent(senal)).nice().range([lh - m.bottom, m.top]);

    svg.append("g").attr("class", "grid").attr("transform", `translate(${m.left},0)`)
        .call(d3.axisLeft(y).ticks(6).tickSize(-(lw - m.left - m.right)))
        .call(g => g.select(".domain").remove());

    svg.append("g").attr("transform", `translate(0,${lh - m.bottom})`)
        .call(d3.axisBottom(x).tickValues(d3.range(0, senal.length, 100)).tickFormat(d => (d / 100) + " s"));

    const path = svg.append("path")
        .datum(senal)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.6)
        .attr("stroke-linejoin", "round")
        .attr("d", d3.line().x((_, i) => x(i)).y(v => y(v)));

    const totalLength = path.node().getTotalLength();
    let isAnimated = true;

    function iniciarAnimacion() {
        path.attr("stroke-dasharray", totalLength + " " + totalLength)
            .attr("stroke-dashoffset", totalLength)
            .transition()
            .duration(10000)
            .ease(d3.easeLinear)
            .attr("stroke-dashoffset", 0)
            .on("end", iniciarAnimacion);
    }

    function detenerAnimacion() {
        path.interrupt()
            .attr("stroke-dasharray", "none")
            .attr("stroke-dashoffset", null);
    }

    const btnControl = svg.append("g")
        .attr("transform", `translate(${lw - m.right - 100}, 12)`)
        .style("cursor", "pointer")
        .on("click", function () {
            isAnimated = !isAnimated;
            btnText.text(isAnimated ? "⏸ Pausar ECG" : "▶️ Animar ECG");
            if (isAnimated) {
                iniciarAnimacion();
            } else {
                detenerAnimacion();
            }
        });

    btnControl.append("rect")
        .attr("width", 100)
        .attr("height", 24)
        .attr("x", 0)
        .attr("y", -16)
        .attr("rx", 4)
        .attr("fill", "#f1f3f6")
        .attr("stroke", "#d1d5db");

    const btnText = btnControl.append("text")
        .attr("x", 50)
        .attr("y", 0)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .style("fill", "#374151")
        .style("user-select", "none")
        .text("⏸ Pausar ECG");

    iniciarAnimacion();

    svg.append("text").attr("class", "titulo-senal").attr("x", lw / 2).attr("y", 22)
        .attr("text-anchor", "middle")
        .text(`Paciente ${data.patient_id} · ${data.diagnostico} · Derivación I (mV)`);
}

/* ---------- MACRO: donut + leyenda ---------- */
function toggleFiltro(label) {
    filtro = filtro === label ? null : label;
    preview = null;
    actualizarMacro();
    draw();
}

function actualizarMacro() {
    const f = filtroActivo();
    arcos.style("opacity", d => !f || d.data.label === f ? 1 : 0.3);
    itemsLeyenda.classed("apagado", d => f && d.label !== f);
}

function dibujarMacroDiagnostico(data) {
    const cont = d3.select("#macro-view");
    cont.selectAll(".macro-body").remove();
    const wrap = cont.append("div").attr("class", "macro-body");
    wrap.append("p").attr("class", "hint").text("Haz clic en una patología para fijar el filtro");

    const conteo = Array.from(d3.rollup(data, v => v.length, d => d.diagnostico), ([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    const total = data.length;

    const w = 260, h = 260, radius = w / 2 - 10;
    const g = wrap.append("svg").attr("viewBox", [0, 0, w, h]).attr("class", "donut")
        .append("g").attr("transform", `translate(${w / 2},${h / 2})`);

    const arc = d3.arc().innerRadius(radius * 0.58).outerRadius(radius * 0.88);
    const arcHover = d3.arc().innerRadius(radius * 0.58).outerRadius(radius * 0.98);
    const pie = d3.pie().value(d => d.count).sort(null);

    g.append("text").attr("class", "donut-total").attr("y", -2).attr("text-anchor", "middle").text(total.toLocaleString("es"));
    g.append("text").attr("class", "donut-sub").attr("y", 18).attr("text-anchor", "middle").text("registros");

    arcos = g.selectAll("path").data(pie(conteo)).join("path")
        .attr("class", "arco").attr("d", arc)
        .attr("fill", d => colorPathology(d.data.label))
        .on("mouseover", function (event, d) {
            d3.select(this).attr("d", arcHover);
            tooltip.style("opacity", .92).html(`<strong>${d.data.label}</strong><br/>${d.data.count.toLocaleString("es")} casos`)
                .style("left", (event.pageX + 12) + "px").style("top", (event.pageY - 30) + "px");
            preview = d.data.label; actualizarMacro(); draw();
        })
        .on("mouseout", function () {
            d3.select(this).attr("d", arc);
            tooltip.style("opacity", 0);
            preview = null; actualizarMacro(); draw();
        })
        .on("click", (_, d) => toggleFiltro(d.data.label));

    itemsLeyenda = wrap.append("ul").attr("class", "leyenda")
        .selectAll("li").data(conteo).join("li")
        .on("click", (_, d) => toggleFiltro(d.label));
    itemsLeyenda.append("span").attr("class", "chip").style("background", d => colorPathology(d.label));
    itemsLeyenda.append("span").attr("class", "lbl").text(d => d.label);
    itemsLeyenda.append("span").attr("class", "cnt").text(d => `${(100 * d.count / total).toFixed(1)}%`);
}