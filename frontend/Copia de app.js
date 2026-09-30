const width = 1000;
const height = 600;
const margin = { top: 20, right: 20, bottom: 40, left: 50 };

const colorPathology = d3.scaleOrdinal()
    .domain(['Normal (NORM)', 'Infarto Miocárdico (MI)', 'Cambios ST/T (STTC)', 'Defecto de Conducción (CD)', 'Hipertrofia (HYP)', 'Múltiple / Otro'])
    .range(['#1a9850', '#d73027', '#fdae61', '#abd9e9', '#4575b4', '#cccccc']);

const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height]);

const tooltip = d3.select("body").append("div").attr("class", "tooltip");

// Variable global para controlar el filtro fijo
let patologiaSeleccionada = null;

console.log("Cargando datos espaciales desde FastAPI...");

d3.json("http://127.0.0.1:8000/api/pacientes").then(response => {
    const data = response.data;

    dibujarMacroDiagnostico(data);

    const xScale = d3.scaleLinear()
        .domain(d3.extent(data, d => d.umap_x)).nice()
        .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
        .domain(d3.extent(data, d => d.umap_y)).nice()
        .range([height - margin.bottom, margin.top]);

    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(xScale).ticks(10))
        .call(g => g.select(".domain").remove());

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(yScale).ticks(10))
        .call(g => g.select(".domain").remove());

    svg.append("g")
        .selectAll("circle")
        .data(data)
        .join("circle")
        .attr("class", "dot")
        .attr("cx", d => xScale(d.umap_x))
        .attr("cy", d => yScale(d.umap_y))
        .attr("r", 2.5)
        .style("fill", d => colorPathology(d.diagnostico))
        .style("opacity", 0.7)
        .on("mouseover", function (event, d) {
            // Permitir hover solo si el punto no está oculto por el filtro
            if (d3.select(this).style("opacity") > 0.1) {
                d3.select(this).attr("r", 6).style("stroke", "black");
                tooltip.transition().duration(200).style("opacity", .9);
                tooltip.html(`<strong>${d.diagnostico}</strong><br/>ID: ${d.patient_id} | Edad: ${d.age}`)
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }
        })
        .on("mouseout", function (event, d) {
            if (d3.select(this).style("stroke") !== "white") {
                d3.select(this).attr("r", 2.5).style("stroke", "none");
            }
            tooltip.transition().duration(500).style("opacity", 0);
        })
        .on("click", function (event, d) {
            if (d3.select(this).style("opacity") < 0.2) return;

            // Limpiar selección previa de paciente
            d3.selectAll(".dot").style("stroke", "none").attr("r", 2.5);

            // Resaltar el nuevo paciente seleccionado
            d3.select(this).style("stroke", "white").style("stroke-width", "2px").attr("r", 6);

            // Llamar al micro nivel
            d3.json(`http://127.0.0.1:8000/api/pacientes/${d.patient_id}/senal`).then(microData => {
                dibujarSenal(microData, colorPathology(d.diagnostico));
            }).catch(error => {
                d3.select("#line-chart").html(`<p style="color:red; text-align:center; padding:20px;">Error: Archivo físico del paciente ${d.patient_id} no encontrado en /data/records100.</p>`);
            });
        });

});

function dibujarSenal(data, color) {
    const senal = data.time_series.derivacion_I;
    const container = d3.select("#line-chart");
    container.selectAll("*").remove();

    const lw = 1000, lh = 250, lMargin = { top: 40, right: 20, bottom: 40, left: 50 };
    const lSvg = container.append("svg").attr("width", lw).attr("height", lh).attr("viewBox", [0, 0, lw, lh]);

    const lxScale = d3.scaleLinear().domain([0, senal.length]).range([lMargin.left, lw - lMargin.right]);
    const lyScale = d3.scaleLinear().domain(d3.extent(senal)).nice().range([lh - lMargin.bottom, lMargin.top]);

    lSvg.append("g").attr("transform", `translate(0,${lh - lMargin.bottom})`).call(d3.axisBottom(lxScale).tickFormat(d => (d / 100) + "s"));
    lSvg.append("g").attr("transform", `translate(${lMargin.left},0)`).call(d3.axisLeft(lyScale));

    const line = d3.line().x((d, i) => lxScale(i)).y(d => lyScale(d));

    lSvg.append("path").datum(senal).attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("d", line);

    lSvg.append("text")
        .attr("x", lw / 2)
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .style("font-family", "sans-serif")
        .style("font-size", "15px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .text(`Paciente ${data.patient_id} | Diagnóstico: ${data.diagnostico}`);
}

function dibujarMacroDiagnostico(data) {
    const container = d3.select("#macro-view");
    container.selectAll("div").remove();

    const wrapper = container.append("div")
        .style("display", "flex")
        .style("justify-content", "center")
        .style("align-items", "center")
        .style("flex-direction", "column")
        .style("margin-top", "10px");

    wrapper.append("h3").style("margin-bottom", "10px").text("Distribución de Patologías (Haz CLIC para fijar el filtro)");

    const conteo = Array.from(d3.rollup(data, v => v.length, d => d.diagnostico), ([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    const width = 350, height = 250, margin = 20;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = wrapper.append("svg").attr("width", width).attr("height", height)
        .append("g").attr("transform", `translate(${width / 2},${height / 2})`);

    const pie = d3.pie().value(d => d.count).sort(null);
    const data_ready = pie(conteo);

    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.85);
    const arcHover = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.95);

    svg.selectAll("path")
        .data(data_ready)
        .join("path")
        .attr("d", arc)
        .attr("fill", d => colorPathology(d.data.label))
        .attr("stroke", "white").style("stroke-width", "2px").style("cursor", "pointer")
        .on("mouseover", function (event, d) {
            d3.select(this).transition().duration(200).attr("d", arcHover);
            tooltip.transition().duration(200).style("opacity", .9);
            tooltip.html(`<strong>${d.data.label}</strong><br/>${d.data.count} casos`)
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");

            // Preview del filtro solo si no hay uno fijado con clic
            if (!patologiaSeleccionada) {
                d3.selectAll(".dot")
                    .style("opacity", dot => dot.diagnostico === d.data.label ? 1 : 0.03)
                    .style("fill", dot => dot.diagnostico === d.data.label ? colorPathology(d.data.label) : "#e0e0e0");
            }
        })
        .on("mouseout", function (event, d) {
            d3.select(this).transition().duration(200).attr("d", arc);
            tooltip.transition().duration(500).style("opacity", 0);

            // Si no hay filtro fijado, restaurar todo
            if (!patologiaSeleccionada) {
                d3.selectAll(".dot").style("opacity", 0.7).style("fill", dot => colorPathology(dot.diagnostico));
            } else {
                // Si hay un filtro fijado, asegurarse de que se mantenga visualmente
                d3.selectAll(".dot")
                    .style("opacity", dot => dot.diagnostico === patologiaSeleccionada ? 1 : 0.03)
                    .style("fill", dot => dot.diagnostico === patologiaSeleccionada ? colorPathology(patologiaSeleccionada) : "#e0e0e0");
            }
        })
        .on("click", function (event, d) {
            // Lógica de Toggle: Si haces clic en el que ya está seleccionado, se quita el filtro
            if (patologiaSeleccionada === d.data.label) {
                patologiaSeleccionada = null; // Apagar filtro
                d3.selectAll("path").style("opacity", 1); // Restaurar opacidad del anillo
                d3.selectAll(".dot").style("opacity", 0.7).style("fill", dot => colorPathology(dot.diagnostico));
            } else {
                patologiaSeleccionada = d.data.label; // Prender filtro

                // Atenuar las demás tajadas del anillo
                d3.selectAll("path").style("opacity", p => p.data.label === patologiaSeleccionada ? 1 : 0.3);

                // Aplicar el filtro fuerte en el mapa
                d3.selectAll(".dot")
                    .style("opacity", dot => dot.diagnostico === patologiaSeleccionada ? 1 : 0.03)
                    .style("fill", dot => dot.diagnostico === patologiaSeleccionada ? colorPathology(patologiaSeleccionada) : "#e0e0e0");
            }
        });
}