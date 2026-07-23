const $ = (id) => document.getElementById(id);
let loadedBookings = [];

function showBox(id, text, type = "warning") {
  const box = $(id);
  box.textContent = text;
  box.className = `message show ${type}`;
}
function localDate(dateString) { return new Date(`${dateString}T12:00:00`).toLocaleDateString("it-IT"); }
function cleanTime(time) { return String(time || "").slice(0, 5); }
function safeText(value) { return String(value ?? ""); }
function normalize(value) { return safeText(value).toLocaleLowerCase("it-IT").trim(); }

async function loadFieldFilter() {
  const { data, error } = await db.from("campi").select("id,nome").order("nome");
  if (error) return $("admin-message").textContent = "Errore campi: " + error.message;
  $("filtro-campo").innerHTML = '<option value="">Tutti</option>' + (data || []).map(c => `<option value="${c.id}">${safeText(c.nome)}</option>`).join("");
}

async function loadSettings() {
  const { data, error } = await db.from("impostazioni_prenotazioni").select("*").eq("id", 1).single();
  if (error) return showBox("settings-message", "Errore: " + error.message, "error");
  $("prenotazioni-attive").checked = Boolean(data.prenotazioni_attive);
  $("chiusura-dal").value = data.chiusura_dal || "";
  $("chiusura-al").value = data.chiusura_al || "";
  $("messaggio-chiusura").value = data.messaggio_chiusura || "";
}

async function saveSettings() {
  const dal = $("chiusura-dal").value || null;
  const al = $("chiusura-al").value || null;
  if (dal && al && dal > al) return showBox("settings-message", "La data finale deve essere successiva a quella iniziale.", "error");
  const { error } = await db.from("impostazioni_prenotazioni").update({
    prenotazioni_attive: $("prenotazioni-attive").checked,
    chiusura_dal: dal,
    chiusura_al: al,
    messaggio_chiusura: $("messaggio-chiusura").value.trim() || null,
    aggiornato_il: new Date().toISOString()
  }).eq("id", 1);
  if (error) return showBox("settings-message", "Salvataggio non riuscito: " + error.message, "error");
  showBox("settings-message", "Impostazioni salvate.", "success");
}

function filteredAndSortedBookings() {
  const term = normalize($("filtro-testo").value);
  const status = $("filtro-stato").value;
  const order = $("filtro-ordine").value;
  const filtered = loadedBookings.filter(item => {
    if (status && item.stato !== status) return false;
    if (!term) return true;
    const haystack = [item.nome_cliente, item.telefono, item.documento_numero, item.documento_rilasciato_da, item.note, item.campi?.nome, item.data, cleanTime(item.ora_inizio)].map(normalize).join(" ");
    return haystack.includes(term);
  });
  filtered.sort((a, b) => {
    const aKey = `${a.data}T${cleanTime(a.ora_inizio)}`;
    const bKey = `${b.data}T${cleanTime(b.ora_inizio)}`;
    return order === "vicine" ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey);
  });
  return filtered;
}

function renderBookings() {
  const body = $("prenotazioni-body");
  const bookings = filteredAndSortedBookings();
  $("metrica-totale").textContent = bookings.length;
  $("metrica-confermate").textContent = bookings.filter(x => x.stato === "confermata").length;
  $("metrica-annullate").textContent = bookings.filter(x => x.stato === "annullata").length;
  $("admin-message").textContent = bookings.length ? `${bookings.length} prenotazioni visualizzate.` : "Nessuna prenotazione trovata.";
  body.innerHTML = "";

  bookings.forEach(item => {
    const tr = document.createElement("tr");
    if (item.note) tr.classList.add("has-request");
    const cells = [localDate(item.data), `${cleanTime(item.ora_inizio)}–${cleanTime(item.ora_fine)}`, item.campi?.nome || "Campo", item.nome_cliente || "", item.telefono || ""];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 3) { const strong = document.createElement("strong"); strong.textContent = text; td.appendChild(strong); }
      else td.textContent = text;
      tr.appendChild(td);
    });
    const docTd = document.createElement("td");
    docTd.innerHTML = `<strong></strong><br><small></small>`;
    docTd.querySelector("strong").textContent = item.documento_numero || "—";
    docTd.querySelector("small").textContent = item.documento_data_rilascio ? `${localDate(item.documento_data_rilascio)} · ${item.documento_rilasciato_da || ""}` : "";
    tr.appendChild(docTd);
    const noteTd = document.createElement("td");
    if (item.note) {
      const badge = document.createElement("span"); badge.className = "request-badge"; badge.textContent = "📌 Richiesta";
      const p = document.createElement("p"); p.className = "request-text"; p.textContent = item.note;
      noteTd.append(badge, p);
    } else noteTd.textContent = "—";
    tr.appendChild(noteTd);
    const statusTd = document.createElement("td");
    const statusBadge = document.createElement("span"); statusBadge.className = `status ${item.stato}`; statusBadge.textContent = item.stato;
    statusTd.appendChild(statusBadge); tr.appendChild(statusTd);
    const actionTd = document.createElement("td");
    const actionBox = document.createElement("div");
    actionBox.className = "row-actions";

    const statusButton = document.createElement("button");
    statusButton.className = "mini-button";
    statusButton.type = "button";
    statusButton.dataset.action = "status";
    statusButton.dataset.id = item.id;
    statusButton.dataset.status = item.stato === "annullata" ? "confermata" : "annullata";
    statusButton.textContent = item.stato === "annullata" ? "Ripristina" : "Annulla";

    const deleteButton = document.createElement("button");
    deleteButton.className = "mini-button delete-booking";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = item.id;
    deleteButton.dataset.customer = item.nome_cliente || "cliente";
    deleteButton.dataset.booking = `${localDate(item.data)} ${cleanTime(item.ora_inizio)}`;
    deleteButton.textContent = "Elimina";

    actionBox.append(statusButton, deleteButton);
    actionTd.appendChild(actionBox);
    tr.appendChild(actionTd);
    body.appendChild(tr);
  });

  body.querySelectorAll('button[data-action="status"]').forEach(button => button.addEventListener("click", async () => {
    const { error } = await db.from("prenotazioni").update({ stato: button.dataset.status }).eq("id", button.dataset.id);
    if (error) return alert("Aggiornamento non riuscito: " + error.message);
    await loadBookings();
  }));

  body.querySelectorAll('button[data-action="delete"]').forEach(button => button.addEventListener("click", async () => {
    const firstConfirm = confirm(`Eliminare definitivamente la prenotazione di ${button.dataset.customer} del ${button.dataset.booking}?`);
    if (!firstConfirm) return;
    const secondConfirm = confirm("Conferma finale: tutti i dati personali della prenotazione saranno cancellati e non potranno essere recuperati.");
    if (!secondConfirm) return;

    button.disabled = true;
    button.textContent = "Eliminazione…";
    const { data, error } = await db.rpc("elimina_prenotazione_gestore", { p_prenotazione_id: button.dataset.id });
    if (error) {
      button.disabled = false;
      button.textContent = "Elimina";
      return alert("Eliminazione non riuscita: " + error.message);
    }
    if (!data) alert("La prenotazione era già stata eliminata o non è stata trovata.");
    await loadBookings();
  }));
}

async function loadBookings() {
  const body = $("prenotazioni-body");
  body.innerHTML = '<tr><td colspan="9">Caricamento...</td></tr>';
  let query = db.from("prenotazioni").select(`id,campo_id,nome_cliente,telefono,documento_numero,documento_data_rilascio,documento_rilasciato_da,data,ora_inizio,ora_fine,stato,note,campi(nome)`);
  if ($("filtro-da").value) query = query.gte("data", $("filtro-da").value);
  if ($("filtro-a").value) query = query.lte("data", $("filtro-a").value);
  if ($("filtro-campo").value) query = query.eq("campo_id", $("filtro-campo").value);
  const { data, error } = await query;
  if (error) { $("admin-message").textContent = "Errore: " + error.message; body.innerHTML = ""; return; }
  loadedBookings = data || [];
  renderBookings();
}

function resetFilters() {
  $("filtro-testo").value = "";
  $("filtro-stato").value = "";
  $("filtro-campo").value = "";
  $("filtro-ordine").value = "recenti";
  $("filtro-da").value = "";
  $("filtro-a").value = "";
  loadBookings();
}

async function checkSession() {
  const { data } = await db.auth.getSession();
  const logged = Boolean(data.session);
  $("login-box").classList.toggle("hidden", logged);
  $("dashboard").classList.toggle("hidden", !logged);
  if (logged) await Promise.all([loadFieldFilter(), loadSettings(), loadBookings()]);
}

$("login").addEventListener("click", async () => {
  const { error } = await db.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
  if (error) return showBox("login-message", "Accesso non riuscito: " + error.message, "error");
  await checkSession();
});
$("logout").addEventListener("click", async () => { await db.auth.signOut(); await checkSession(); });
$("carica").addEventListener("click", loadBookings);
$("azzera-filtri").addEventListener("click", resetFilters);
$("salva-impostazioni").addEventListener("click", saveSettings);
["filtro-testo", "filtro-stato", "filtro-ordine"].forEach(id => $(id).addEventListener("input", renderBookings));
["filtro-da", "filtro-a", "filtro-campo"].forEach(id => $(id).addEventListener("change", loadBookings));

$("filtro-da").value = "";
$("filtro-a").value = "";
checkSession();
