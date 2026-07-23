const $ = (id) => document.getElementById(id);
const dataInput = $("data");
const campoSelect = $("campo");
const slotsBox = $("slots");
const selectedText = $("slot-selezionato");
const messageBox = $("messaggio");
const prenotaButton = $("prenota");

let selectedStart = null;
let selectedEnd = null;
let fields = [];
let bookingsEnabled = true;

function localTodayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function showMessage(text, type = "warning", allowHtml = false) {
  if (allowHtml) messageBox.innerHTML = text;
  else messageBox.textContent = text;
  messageBox.className = `message show ${type}`;
  messageBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatDateItalian(isoDate) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00`));
}

function normalizeDocument(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function loadBookingStatus() {
  const { data, error } = await db.from("impostazioni_prenotazioni").select("prenotazioni_attive,chiusura_dal,chiusura_al,messaggio_chiusura").eq("id", 1).maybeSingle();
  if (error || !data) return;

  const today = localTodayIso();
  const insideClosure = data.chiusura_dal && data.chiusura_al && today >= data.chiusura_dal && today <= data.chiusura_al;
  bookingsEnabled = Boolean(data.prenotazioni_attive) && !insideClosure;

  if (!bookingsEnabled) {
    $("chiusura-box").classList.remove("hidden");
    $("chiusura-messaggio").textContent = data.messaggio_chiusura || "Il servizio di prenotazione è temporaneamente sospeso.";
    $("booking-area").classList.add("disabled-area");
    prenotaButton.disabled = true;
  }
}

async function loadFields() {
  const { data, error } = await db.from("campi").select("id,nome,attivo").eq("attivo", true).order("nome");
  if (error) return showMessage("Impossibile caricare i campi: " + error.message, "error");
  fields = data || [];
  campoSelect.innerHTML = fields.map(campo => `<option value="${campo.id}">${campo.nome}</option>`).join("");
  await loadSlots();
}

async function loadSlots() {
  clearMessage();
  selectedStart = selectedEnd = null;
  selectedText.textContent = "Nessun orario selezionato.";
  slotsBox.innerHTML = "<p>Caricamento disponibilità...</p>";
  const bookingDate = dataInput.value;
  const fieldId = campoSelect.value;
  if (!bookingDate || !fieldId) return;

  const { data: planning, error } = await db.rpc("get_daily_planning", { p_campo_id: fieldId, p_data: bookingDate });
  if (error) {
    slotsBox.innerHTML = "";
    return showMessage("Errore nella lettura del planning: " + error.message, "error");
  }

  const bookingsByStart = new Map((planning || []).map(b => [String(b.ora_inizio).slice(0, 5), b]));
  const start = APP_CONFIG.OPENING_HOUR * 60;
  const end = APP_CONFIG.CLOSING_HOUR * 60;
  const duration = APP_CONFIG.DEFAULT_FIELD_DURATION_MINUTES;
  const now = new Date();
  const today = localTodayIso();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  slotsBox.innerHTML = "";

  for (let min = start; min + duration <= end; min += duration) {
    const slotStart = minutesToTime(min);
    const slotEnd = minutesToTime(min + duration);
    const booking = bookingsByStart.get(slotStart);
    const isPast = bookingDate < today || (bookingDate === today && min <= currentMinutes);
    const paid = min >= APP_CONFIG.PAID_FROM_HOUR * 60;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slot ${paid ? "paid-slot" : "free-slot"}`;
    button.innerHTML = `<span class="slot-time">${slotStart}–${slotEnd}</span><span class="slot-price">${paid ? "A pagamento" : "Gratuito"}</span>`;

    if (booking) {
      button.classList.add("occupied"); button.disabled = true;
      const status = document.createElement("span"); status.className = "slot-status"; status.textContent = "Prenotato";
      const customer = document.createElement("span"); customer.className = "slot-customer"; customer.textContent = booking.nome_pubblico || "Occupato";
      button.append(status, customer);
    } else if (isPast || !bookingsEnabled) {
      button.classList.add("past"); button.disabled = true;
      const status = document.createElement("span"); status.className = "slot-status"; status.textContent = "Non disponibile"; button.appendChild(status);
    } else {
      const status = document.createElement("span"); status.className = "slot-status available-label"; status.textContent = "Libero"; button.appendChild(status);
      button.addEventListener("click", () => {
        document.querySelectorAll(".slot.selected").forEach(el => el.classList.remove("selected"));
        button.classList.add("selected"); selectedStart = slotStart; selectedEnd = slotEnd;
        selectedText.textContent = `Orario selezionato: ${slotStart}–${slotEnd} (${paid ? "a pagamento" : "gratuito"})`;
      });
    }
    slotsBox.appendChild(button);
  }
}

async function createBooking() {
  clearMessage();
  if (!bookingsEnabled) return showMessage("Le prenotazioni sono temporaneamente sospese.", "warning");

  const nomeCliente = $("nome").value.trim();
  const telefono = $("telefono").value.trim();
  const documentoNumero = normalizeDocument($("documento-numero").value);
  const documentoData = $("documento-data-rilascio").value;
  const documentoRilasciatoDa = $("documento-rilasciato-da").value.trim();
  const fieldId = campoSelect.value;
  const bookingDate = dataInput.value;

  if (!bookingDate || !fieldId || !selectedStart) return showMessage("Seleziona data, campo e orario.", "warning");
  if (!nomeCliente || !telefono || !documentoNumero || !documentoData || !documentoRilasciatoDa) return showMessage("Compila tutti i dati obbligatori, compresi quelli della carta d’identità.", "warning");
  if (!$("privacy").checked) return showMessage("Devi accettare l’uso dei dati per la prenotazione.", "warning");

  const fieldName = fields.find(c => String(c.id) === String(fieldId))?.nome || "Campo";
  prenotaButton.disabled = true; prenotaButton.textContent = "Prenotazione in corso...";

  const { data, error } = await db.rpc("crea_prenotazione_v3", {
    p_campo_id: fieldId,
    p_nome_cliente: nomeCliente,
    p_telefono: telefono,
    p_documento_numero: documentoNumero,
    p_documento_data_rilascio: documentoData,
    p_documento_rilasciato_da: documentoRilasciatoDa,
    p_data: bookingDate,
    p_ora_inizio: selectedStart,
    p_ora_fine: selectedEnd,
    p_note: $("note").value.trim() || null
  });

  prenotaButton.disabled = false; prenotaButton.textContent = "Conferma prenotazione";
  if (error) {
    const msg = String(error.message || "");
    if (msg.includes("LIMITE_SETTIMANALE")) return showMessage(`Hai già effettuato due prenotazioni per questa settimana. Per modifiche o annullamenti telefona al ${APP_CONFIG.CONTACT_PHONE_DISPLAY}.`, "error");
    if (msg.includes("ORARIO_OCCUPATO") || error.code === "23505") { await loadSlots(); return showMessage("Questo orario è appena stato prenotato. Scegline un altro.", "error"); }
    if (msg.includes("PRENOTAZIONI_SOSPESE")) return showMessage("Le prenotazioni sono temporaneamente sospese.", "error");
    return showMessage("Prenotazione non riuscita: " + msg, "error");
  }

  const confirmedStart = selectedStart, confirmedEnd = selectedEnd;
  ["nome","telefono","documento-numero","documento-data-rilascio","documento-rilasciato-da","note"].forEach(id => $(id).value = "");
  $("privacy").checked = false;
  await loadSlots();
  showMessage(`<strong>✅ Prenotazione confermata</strong><br>${fieldName}, ${formatDateItalian(bookingDate)}, ${confirmedStart}–${confirmedEnd}.<br><br><strong>📷 Fai uno screenshot di questa schermata</strong> per ricordarti dell’appuntamento.<br><br>Per modificare o annullare telefona al <a href="tel:${APP_CONFIG.CONTACT_PHONE_LINK}"><strong>${APP_CONFIG.CONTACT_PHONE_DISPLAY}</strong></a>.`, "success", true);
}

dataInput.min = localTodayIso(); dataInput.value = localTodayIso();
dataInput.addEventListener("change", loadSlots); campoSelect.addEventListener("change", loadSlots);
$("aggiorna").addEventListener("click", loadSlots); prenotaButton.addEventListener("click", createBooking);
(async () => { await loadBookingStatus(); await loadFields(); })();
