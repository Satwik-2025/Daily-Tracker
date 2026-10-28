// ------------------------------------------------------------------ helpers --

const $ = (id) => document.getElementById(id);

// Build an element: el("div", { class: "x", onclick: fn }, "text", childEl)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

// Dates are handled as local "YYYY-MM-DD" strings so the server always gets
// the day *you* are living in, whatever time zone it runs in.
function toISO(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
const today = () => toISO(new Date());

function prettyDate(s) {
  return fromISO(s).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// "16:30" -> "4:30 PM"
function prettyTime(t) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function conflictText(conflicts) {
  return conflicts
    .map((c) => `“${c.title}” (${prettyTime(c.start)} – ${prettyTime(c.end)}${c.repeats ? ", every week" : ""})`)
    .join(", ");
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

let toastTimer;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2500);
}

// ------------------------------------------------------------------ routing --
// Each button changes the #hash; we show the matching <section>.

const pages = { daily: loadDay, timetable: loadWeek, monthly: loadMonth };

async function showPage() {
  await flushSave();
  const name = location.hash.slice(1) in pages ? location.hash.slice(1) : "daily";
  for (const key of Object.keys(pages)) {
    $(`page-${key}`).classList.toggle("hidden", key !== name);
  }
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  pages[name]();
}
window.addEventListener("hashchange", showPage);

// -------------------------------------------------------------- daily tasks --

let currentDay = today();
let dayTasks = [];
let saveTimer;

async function loadDay() {
  $("day-picker").value = currentDay;
  $("day-picker").max = today();
  $("day-next").disabled = currentDay >= today();
  $("day-title").textContent = currentDay === today() ? "Today" : prettyDate(currentDay);

  const { data } = await api("GET", `/api/tasks?date=${currentDay}`);
  dayTasks = data;
  renderTasks();
  loadDaySchedule();
}

function renderTasks() {
  const list = $("task-list");
  list.replaceChildren(...dayTasks.map(taskRow));
  $("no-tasks").classList.toggle("hidden", dayTasks.length > 0);

  const done = dayTasks.filter((t) => t.status === "done").length;
  const marked = dayTasks.filter((t) => t.status).length;
  $("day-summary").textContent = dayTasks.length
    ? `${done} of ${dayTasks.length} done · ${dayTasks.length - marked} still to mark`
    : "";
}

function taskRow(task) {
  const setStatus = (status) => {
    task.status = task.status === status ? null : status; // click again to clear
    renderTasks();
    saveDay();
  };

  const remark = el("input", {
    class: "glass-input remark",
    placeholder: "Remarks (e.g. woke up at 8, skipped gym)",
    maxlength: 200,
    value: task.remark,
    oninput: (e) => {
      task.remark = e.target.value;
      saveDay(600);
    },
  });

  const extra = el("div", { class: "task-extra" });
  for (const slot of task.slots) {
    extra.append(el("span", { class: "slot-tag" }, `⏰ ${prettyTime(slot.start)} – ${prettyTime(slot.end)}`));
  }

  return el("li", { class: `task ${task.status || ""}` },
    el("span", { class: "task-name" }, task.name),
    el("div", { class: "task-actions" },
      el("button", { class: `glass-btn mark-btn done ${task.status === "done" ? "on" : ""}`, title: "Done", onclick: () => setStatus("done") }, "✓"),
      el("button", { class: `glass-btn mark-btn missed ${task.status === "missed" ? "on" : ""}`, title: "Not done", onclick: () => setStatus("missed") }, "✗"),
      el("button", { class: "glass-btn icon-btn", title: "Add a time to the timetable", onclick: () => toggleScheduleForm(task, extra) }, "⏰"),
      el("button", { class: "glass-btn icon-btn", title: "Stop tracking this task", onclick: () => removeTask(task) }, "🗑"),
    ),
    remark,
    extra,
  );
}

function saveDay(delay = 0) {
  $("save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const entries = dayTasks.map((t) => ({ task_id: t.id, status: t.status, remark: t.remark }));
    saveTimer = null;
    const { ok, data } = await api("POST", "/api/logs", logBody());
    $("save-status").textContent = ok ? "All changes saved ✓" : data.error || "Could not save";
  }, delay);
}

function logBody() {
  const entries = dayTasks.map((t) => ({ task_id: t.id, status: t.status, remark: t.remark }));
  return { date: currentDay, today: today(), entries };
}

async function flushSave() {
  // Called before switching day/page so a remark still being typed isn't lost.
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await api("POST", "/api/logs", logBody());
  $("save-status").textContent = "All changes saved ✓";
}

$("add-task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("new-task-name").value.trim();
  if (!name) return;
  // A new task counts from the day you are looking at onwards.
  const { ok, data } = await api("POST", "/api/tasks", { name, start_date: currentDay });
  if (!ok) return toast(data.error);
  $("new-task-name").value = "";
  dayTasks.push({ id: data.id, name, status: null, remark: "", slots: [] });
  renderTasks();
});

async function removeTask(task) {
  if (!confirm(`Stop tracking “${task.name}” from today?\nEarlier days keep their history.`)) return;
  await flushSave();
  await api("DELETE", `/api/tasks/${task.id}?date=${today()}`);
  loadDay();
}

// "I'll do this between 4 and 5" -> puts the task on the timetable for this day.
function toggleScheduleForm(task, container) {
  const existing = container.querySelector(".schedule-form");
  if (existing) return existing.remove();

  const start = el("input", { type: "time", class: "glass-input", required: true });
  const end = el("input", { type: "time", class: "glass-input", required: true });
  const note = el("div", { class: "message hidden" });

  async function submit(force) {
    if (!start.value || !end.value) return toast("Pick a start and end time");
    const { ok, status, data } = await api("POST", "/api/events", {
      title: task.name, date: currentDay, start: start.value, end: end.value, task_id: task.id, force,
    });
    if (status === 409) {
      note.className = "message";
      note.replaceChildren(
        `⚠️ That time is already taken: ${conflictText(data.conflicts)}.`,
        el("br"),
        el("button", { type: "button", class: "glass-btn small", onclick: () => submit(true) }, "Add anyway"),
        el("button", { type: "button", class: "glass-btn small", onclick: () => note.classList.add("hidden") }, "Pick another time"),
      );
      return;
    }
    if (!ok) return toast(data.error);
    task.slots.push({ start: start.value, end: end.value });
    toast(`Added “${task.name}” to the timetable`);
    renderTasks();
    loadDaySchedule();
  }

  container.append(el("form", {
    class: "schedule-form",
    onsubmit: (e) => { e.preventDefault(); submit(false); },
  }, "I'll do it from", start, "to", end,
     el("button", { type: "submit", class: "glass-btn small primary" }, "Add to timetable"),
     note));
}

async function loadDaySchedule() {
  const { data } = await api("GET", `/api/week?start=${currentDay}`);
  const events = data[0].events;
  $("day-schedule").replaceChildren(
    ...(events.length
      ? events.map((e) => el("li", { class: e.repeats ? "" : "once" },
          el("span", { class: "time" }, `${prettyTime(e.start)} – ${prettyTime(e.end)}`), e.title))
      : [el("li", { class: "muted" }, "Nothing on the timetable for this day.")]),
  );
}

async function goToDay(day) {
  await flushSave();
  currentDay = day > today() ? today() : day;
  loadDay();
}
$("day-prev").addEventListener("click", () => goToDay(addDays(currentDay, -1)));
$("day-next").addEventListener("click", () => goToDay(addDays(currentDay, 1)));
$("day-picker").addEventListener("change", (e) => e.target.value && goToDay(e.target.value));

// ---------------------------------------------------------------- timetable --

function mondayOf(s) {
  const d = fromISO(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}
let weekStart = mondayOf(today());

async function loadWeek() {
  const end = addDays(weekStart, 6);
  const fmt = (s) => fromISO(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  $("week-title").textContent = `${fmt(weekStart)} – ${fmt(end)}`;
  $("event-date").value ||= today();

  const { data } = await api("GET", `/api/week?start=${weekStart}`);
  $("week-grid").replaceChildren(...data.map((day) =>
    el("div", { class: `day-col ${day.date === today() ? "today" : ""}` },
      el("h4", {}, day.weekday.slice(0, 3), el("small", {}, fromISO(day.date).getDate())),
      ...day.events.map((e) =>
        el("div", { class: `chip ${e.repeats ? "weekly" : "once"}` },
          el("span", { class: "time" }, `${prettyTime(e.start)} – ${prettyTime(e.end)}`),
          e.title,
          el("button", { class: "del", title: "Delete", onclick: () => deleteEvent(e) }, "×"))),
    )));
}

async function deleteEvent(e) {
  const what = e.repeats ? `“${e.title}” from every week` : `“${e.title}”`;
  if (!confirm(`Delete ${what}?`)) return;
  await api("DELETE", `/api/events/${e.id}`);
  loadWeek();
}

$("event-repeat").addEventListener("change", (e) => {
  const weekly = e.target.value === "weekly";
  $("event-weekday").classList.toggle("hidden", !weekly);
  $("event-date").classList.toggle("hidden", weekly);
});

async function addEvent(force) {
  const weekly = $("event-repeat").value === "weekly";
  const body = {
    title: $("event-title").value.trim(),
    start: $("event-start").value,
    end: $("event-end").value,
    force,
    ...(weekly ? { weekday: Number($("event-weekday").value) } : { date: $("event-date").value }),
  };
  const { ok, status, data } = await api("POST", "/api/events", body);
  const msg = $("event-message");
  msg.classList.remove("hidden");

  if (status === 409) {
    msg.className = "message";
    msg.replaceChildren(
      `⚠️ There is already something at that time: ${conflictText(data.conflicts)}.`,
      el("br"),
      el("button", { class: "glass-btn small", onclick: () => addEvent(true) }, "Add anyway"),
      el("button", { class: "glass-btn small", onclick: () => msg.classList.add("hidden") }, "Pick another time"),
    );
    return;
  }
  if (!ok) {
    msg.className = "message";
    msg.textContent = data.error;
    return;
  }
  msg.className = "message ok";
  msg.textContent = `Added “${body.title}”.`;
  $("event-title").value = "";
  if (!weekly) weekStart = mondayOf(body.date); // jump to the week you just added to
  loadWeek();
}

$("event-form").addEventListener("submit", (e) => {
  e.preventDefault();
  addEvent(false);
});
$("week-prev").addEventListener("click", () => { weekStart = addDays(weekStart, -7); loadWeek(); });
$("week-next").addEventListener("click", () => { weekStart = addDays(weekStart, 7); loadWeek(); });

// ------------------------------------------------------------- monthly view --

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth() + 1; // 1-12

async function loadMonth() {
  const { data } = await api("GET", `/api/month?year=${viewYear}&month=${viewMonth}&today=${today()}`);
  $("month-title").textContent = data.month_name;

  const table = $("month-table");
  const hasData = data.tasks.length > 0;
  table.classList.toggle("hidden", !hasData);
  $("no-month-data").classList.toggle("hidden", hasData);

  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  const head = el("tr", {}, el("th", { class: "name" }, "Task"));
  for (let d = 1; d <= data.days; d++) {
    const wd = (data.first_weekday + d - 1) % 7;
    head.append(el("th", { class: wd >= 5 ? "weekend" : "" }, d, el("br"), letters[wd]));
  }
  head.append(el("th", { class: "pct" }, "%"));

  const symbols = { done: "✓", missed: "✗", empty: "·", na: "" };
  const rows = data.tasks.map((t) =>
    el("tr", {},
      el("td", { class: "name" }, t.name),
      ...t.cells.map((c) => el("td", { class: `cell-${c.state}`, title: c.remark || "" }, symbols[c.state])),
      el("td", { class: "pct" }, t.percent == null ? "–" : `${t.percent}%`)));
  table.replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));

  $("month-percent").textContent = data.percent == null ? "–" : `${data.percent}%`;
  $("month-ring").style.setProperty("--p", data.percent || 0);
  $("month-summary").textContent = data.marked
    ? `${data.done} / ${data.marked} tasks completed this month`
    : "No days logged in this month yet.";
  $("month-unlogged").textContent = data.unlogged
    ? `${data.unlogged} task-day(s) not marked yet (shown as · and not counted)`
    : "";
}

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  loadMonth();
}
$("month-prev").addEventListener("click", () => shiftMonth(-1));
$("month-next").addEventListener("click", () => shiftMonth(1));

// Closing the tab: send any unsaved remark in the background.
window.addEventListener("pagehide", () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  navigator.sendBeacon("/api/logs", new Blob([JSON.stringify(logBody())], { type: "application/json" }));
});
showPage();
