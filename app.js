const state = {
  records: [],
  movements: JSON.parse(localStorage.getItem("thumby-erp-movements-v1") || "[]"),
  currentView: "search",
  selectedRecord: null,
};

const viewContent = {
  search: { kicker: "Inventory search", title: "Find stock instantly" },
  dashboard: { kicker: "ERP overview", title: "Inventory pilot overview" },
  updates: { kicker: "Daily workflow", title: "Controlled stock updates" },
  quality: { kicker: "Data readiness", title: "Prepare for go-live" },
};

const element = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const normalizeText = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
const normalizePart = (value) => normalizeText(value).replace(/[\s._/\\-]/g, "");
const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

function isBlankLike(value) {
  return ["", "N/A", "NA", "NIL", "NONE", "NULL", "-", "--"].includes(normalizeText(value));
}

function sourceAvailability(record) {
  if (record.sourceAvailable === "") return "No source balance";
  return record.sourceAvailable;
}

function matchType(record, query) {
  const raw = normalizeText(query);
  const canonical = normalizePart(query);
  if (canonical && record.partNumberNormalized === canonical) return "Exact P/N";
  if (raw && normalizeText(record.serialNumber) === raw) return "Exact serial";
  if (raw && normalizeText(record.batchNumber) === raw) return "Exact batch";
  if (canonical && record.partNumberNormalized.startsWith(canonical)) return "P/N starts with";
  if (raw && normalizeText(record.description).includes(raw)) return "Description match";
  return "Source record";
}

function scoreRecord(record, query) {
  const raw = normalizeText(query);
  const canonical = normalizePart(query);
  if (!raw) return 0;
  if (canonical && record.partNumberNormalized === canonical) return 1000;
  if (raw === normalizeText(record.partNumber)) return 980;
  if (raw === normalizeText(record.serialNumber)) return 920;
  if (raw === normalizeText(record.batchNumber)) return 900;
  if (canonical && record.partNumberNormalized.startsWith(canonical)) return 720;
  if (normalizeText(record.partNumber).includes(raw)) return 680;
  if (normalizeText(record.serialNumber).includes(raw)) return 580;
  if (normalizeText(record.batchNumber).includes(raw)) return 540;
  if (normalizeText(record.description).startsWith(raw)) return 440;
  if (normalizeText(record.description).includes(raw)) return 350;
  if (normalizeText(record.location).includes(raw)) return 250;
  if (normalizeText(record.reference).includes(raw)) return 180;
  return 0;
}

function currentFilters() {
  return {
    query: element("search-input").value,
    base: element("base-filter").value,
    kind: element("kind-filter").value,
    availability: element("availability-filter").value,
  };
}

function filteredRecords() {
  const filters = currentFilters();
  const matches = state.records.filter((record) => {
    if (filters.base !== "all" && record.base !== filters.base) return false;
    if (filters.kind !== "all" && record.recordKind !== filters.kind) return false;
    if (filters.availability === "available" && record.availableNumeric === null) return false;
    if (filters.availability === "review" && record.availableNumeric !== null) return false;
    if (!filters.query.trim()) return true;
    return scoreRecord(record, filters.query) > 0;
  });
  return matches.sort((a, b) => {
    const difference = scoreRecord(b, filters.query) - scoreRecord(a, filters.query);
    if (difference) return difference;
    return a.partNumber.localeCompare(b.partNumber);
  });
}

function recordMeta(record) {
  const items = [];
  if (!isBlankLike(record.location)) items.push(`Location: ${escapeHTML(record.location)}`);
  if (!isBlankLike(record.batchNumber)) items.push(`Batch: ${escapeHTML(record.batchNumber)}`);
  if (!isBlankLike(record.serialNumber)) items.push(`Serial: ${escapeHTML(record.serialNumber)}`);
  if (!isBlankLike(record.expiry)) items.push(`Expiry: ${escapeHTML(record.expiry)}`);
  items.push(`${escapeHTML(record.base)} · ${escapeHTML(record.sourceSheet)} row ${record.sourceRow}`);
  return items.map((item) => `<span>${item}</span>`).join("");
}

function renderResults() {
  const records = filteredRecords();
  const filters = currentFilters();
  const maxResults = 60;
  const visible = records.slice(0, maxResults);
  const queryDescription = filters.query.trim() ? `for “${escapeHTML(filters.query.trim())}”` : "from all searchable source records";
  element("results-title").textContent = records.length ? `${numberFormat.format(records.length)} matching records` : "No matching source records";
  element("results-subtitle").innerHTML = records.length > maxResults
    ? `Showing the first ${maxResults} ${queryDescription}. Refine search or filters to narrow the list.`
    : `Showing ${numberFormat.format(records.length)} records ${queryDescription}.`;
  element("download-results").disabled = !records.length;

  if (!records.length) {
    element("results").innerHTML = `<div class="empty-state"><strong>No record matched this search.</strong>Try removing spaces, use part of the P/N, or search a description, serial, batch, or bin.</div>`;
    return;
  }
  element("results").innerHTML = visible.map((record) => {
    const matching = matchType(record, filters.query);
    const description = record.description || "No description in source";
    const available = sourceAvailability(record);
    const availableLabel = record.availableNumeric === null ? "Source availability" : "Source available";
    return `<article class="result-card">
      <div class="result-main">
        <div class="result-topline"><span class="part-number">${escapeHTML(record.partNumber)}</span><span class="match-badge">${matching}</span><span class="status-badge">Needs verification</span></div>
        <p class="description">${escapeHTML(description)}</p>
        <div class="record-meta">${recordMeta(record)}</div>
      </div>
      <div class="result-side"><strong>${escapeHTML(available)}</strong><small>${availableLabel} · ${escapeHTML(record.recordKind)}</small><button class="button quiet update-record" type="button" data-record-id="${escapeHTML(record.id)}">Update stock</button></div>
    </article>`;
  }).join("");
  document.querySelectorAll(".update-record").forEach((button) => button.addEventListener("click", () => openMovement(button.dataset.recordId)));
}

function fillFilters() {
  const bases = [...new Set(state.records.map((record) => record.base))].sort();
  const kinds = [...new Set(state.records.map((record) => record.recordKind))].sort();
  element("base-filter").insertAdjacentHTML("beforeend", bases.map((base) => `<option value="${escapeHTML(base)}">${escapeHTML(base)}</option>`).join(""));
  element("kind-filter").insertAdjacentHTML("beforeend", kinds.map((kind) => `<option value="${escapeHTML(kind)}">${escapeHTML(kind)}</option>`).join(""));
}

function renderDashboard() {
  const bases = [...new Set(state.records.map((record) => record.base))];
  const numericAvailability = state.records.filter((record) => record.availableNumeric !== null).length;
  const uniquePartCandidates = new Set(state.records.map((record) => record.partNumberNormalized)).size;
  const locations = new Set(state.records.map((record) => normalizeText(record.location)).filter(Boolean).filter((value) => !["N/A", "NA", "NIL","NONE"].includes(value))).size;
  const metrics = [
    [numberFormat.format(state.records.length), "Searchable source records", "Merged continuation rows preserved"],
    [numberFormat.format(uniquePartCandidates), "P/N candidates", "Awaiting master-data approval"],
    [numberFormat.format(locations), "Location labels", "Need governed location mapping"],
    [numberFormat.format(state.movements.length), "Local daily updates", "Pending controller approval"],
  ];
  element("metric-grid").innerHTML = metrics.map(([value, label, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><em>${note}</em></article>`).join("");
  const counts = bases.map((base) => ({ base, count: state.records.filter((record) => record.base === base).length })).sort((a, b) => b.count - a.count);
  const largest = Math.max(...counts.map((entry) => entry.count));
  element("base-summary").innerHTML = counts.map(({ base, count }) => `<div class="base-line"><strong>${escapeHTML(base)}</strong><div class="bar"><span style="width:${Math.round((count / largest) * 100)}%"></span></div><b>${numberFormat.format(count)}</b></div>`).join("");
  element("movement-summary").innerHTML = state.movements.length
    ? `<strong>${numberFormat.format(state.movements.length)}</strong>movement${state.movements.length === 1 ? "" : "s"} saved on this device. Export the queue or connect the central database to send for approval.`
    : `<strong>No updates yet</strong>Create the first controlled receipt, issue, transfer, adjustment, return, or stock-count draft.`;
  element("sync-state").innerHTML = `<span class="dot ${numericAvailability ? "amber" : "green"}"></span> Device pilot`;
}

function saveMovements() {
  localStorage.setItem("thumby-erp-movements-v1", JSON.stringify(state.movements));
}

function renderMovements() {
  const target = element("movement-table");
  if (!state.movements.length) {
    target.innerHTML = `<tr><td class="table-empty" colspan="7">No daily stock updates have been saved on this device.</td></tr>`;
    renderDashboard();
    return;
  }
  target.innerHTML = [...state.movements].reverse().map((movement) => `<tr>
    <td>${escapeHTML(movement.createdAt)}</td><td><strong>${escapeHTML(movement.type)}</strong></td><td>${escapeHTML(movement.partNumber)}</td><td>${escapeHTML(movement.quantity)}</td><td>${escapeHTML(movement.location)}</td><td>${escapeHTML(movement.reference || "—")}</td><td><span class="status-badge">Pending approval</span></td>
  </tr>`).join("");
  renderDashboard();
}

function openMovement(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) {
    showToast("Select a stock record from search before creating an update.");
    switchView("search");
    return;
  }
  state.selectedRecord = record;
  element("movement-record-id").value = record.id;
  element("movement-item").value = `${record.partNumber} — ${record.description || "No description"}`;
  element("movement-location").value = isBlankLike(record.location) ? "" : record.location;
  element("movement-quantity").value = "";
  element("movement-reference").value = record.reference || "";
  element("movement-note").value = "";
  element("movement-dialog").showModal();
}

function submitMovement(event) {
  event.preventDefault();
  const record = state.records.find((item) => item.id === element("movement-record-id").value);
  const quantity = Number(element("movement-quantity").value);
  if (!record || !Number.isFinite(quantity) || quantity <= 0) {
    showToast("Choose a source record and enter a quantity greater than zero.");
    return;
  }
  const movement = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    createdAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    type: element("movement-type").value,
    quantity: element("movement-quantity").value,
    location: element("movement-location").value.trim(),
    reference: element("movement-reference").value.trim(),
    note: element("movement-note").value.trim(),
    partNumber: record.partNumber,
    description: record.description,
    recordId: record.id,
    source: `${record.sourceWorkbook} / ${record.sourceSheet} / row ${record.sourceRow}`,
    status: "Pending approval",
  };
  state.movements.push(movement);
  saveMovements();
  element("movement-dialog").close();
  renderMovements();
  showToast("Daily update saved on this device and marked pending approval.");
  switchView("updates");
}

function toCSV(rows, headers) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(quote).join(","), ...rows.map((row) => headers.map((header) => quote(row[header])).join(","))].join("\n");
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function downloadResults() {
  const rows = filteredRecords().map((record) => ({
    base: record.base, partNumber: record.partNumber, description: record.description, location: record.location, serialNumber: record.serialNumber,
    batchNumber: record.batchNumber, sourceAvailable: record.sourceAvailable, sourceQuantity: record.sourceQuantity, expiry: record.expiry,
    sourceWorkbook: record.sourceWorkbook, sourceSheet: record.sourceSheet, sourceRow: record.sourceRow,
  }));
  downloadFile("thumby-erp-search-results.csv", toCSV(rows, ["base", "partNumber", "description", "location", "serialNumber", "batchNumber", "sourceAvailable", "sourceQuantity", "expiry", "sourceWorkbook", "sourceSheet", "sourceRow"]));
}

function downloadMovements() {
  if (!state.movements.length) {
    showToast("There are no daily updates to download yet.");
    return;
  }
  downloadFile("thumby-erp-daily-updates.csv", toCSV(state.movements, ["createdAt", "type", "partNumber", "description", "quantity", "location", "reference", "note", "source", "status"]));
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}-view`));
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  element("view-kicker").textContent = viewContent[view].kicker;
  element("view-title").textContent = viewContent[view].title;
  if (view === "dashboard") renderDashboard();
  if (view === "updates") renderMovements();
}

let toastTimer;
function showToast(message) {
  const toast = element("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  ["search-input", "base-filter", "kind-filter", "availability-filter"].forEach((id) => element(id).addEventListener(id === "search-input" ? "input" : "change", renderResults));
  element("reset-filters").addEventListener("click", () => {
    element("search-input").value = "";
    element("base-filter").value = "all";
    element("kind-filter").value = "all";
    element("availability-filter").value = "all";
    renderResults();
  });
  element("new-movement").addEventListener("click", () => openMovement(state.selectedRecord?.id));
  element("new-movement-secondary").addEventListener("click", () => openMovement(state.selectedRecord?.id));
  element("close-dialog").addEventListener("click", () => element("movement-dialog").close());
  element("cancel-dialog").addEventListener("click", () => element("movement-dialog").close());
  element("movement-form").addEventListener("submit", submitMovement);
  element("download-results").addEventListener("click", downloadResults);
  element("download-movements").addEventListener("click", downloadMovements);
}

async function initialize() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  bindEvents();
  try {
    const response = await fetch("initial-inventory.json");
    if (!response.ok) throw new Error("Inventory data could not load");
    const payload = await response.json();
    state.records = payload.records.map((record) => ({ ...record, searchText: normalizeText([record.partNumber, record.description, record.serialNumber, record.batchNumber, record.location, record.reference].join(" ")) }));
    fillFilters();
    renderResults();
    renderMovements();
  } catch (error) {
    element("results-title").textContent = "Inventory source data is unavailable";
    element("results-subtitle").textContent = "Open this application through its local web address so the data file can load.";
    element("results").innerHTML = `<div class="empty-state"><strong>Unable to load the source inventory.</strong>The application shell is ready, but its supplied inventory file was not available.</div>`;
  }
}

initialize();
