(function () {
  let online = [];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function deviceInfo(userAgent = "") {
    const browser = /Edg\//i.test(userAgent) ? "Edge"
      : /Firefox\//i.test(userAgent) ? "Firefox"
        : /Chrome\//i.test(userAgent) ? "Chrome"
          : /Safari\//i.test(userAgent) ? "Safari" : "Browser";
    const os = /Android/i.test(userAgent) ? "Android"
      : /iPhone|iPad/i.test(userAgent) ? "iOS"
        : /Windows/i.test(userAgent) ? "Windows"
          : /Mac OS/i.test(userAgent) ? "macOS"
            : /Linux/i.test(userAgent) ? "Linux" : "Unknown";
    const type = /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "Mobile" : "Computer";
    return { browser, os, type };
  }

  async function api(action, payload = {}) {
    const response = await fetch("../api/index.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Server request failed.");
    return data;
  }

  function filteredRows() {
    const filters = {
      user: document.getElementById("filter-user").value.trim().toLowerCase(),
      ip: document.getElementById("filter-ip").value.trim().toLowerCase(),
      source: document.getElementById("filter-ip-source").value.trim().toLowerCase(),
      os: document.getElementById("filter-os").value.trim().toLowerCase(),
      browser: document.getElementById("filter-browser").value.trim().toLowerCase(),
      type: document.getElementById("filter-type").value.trim().toLowerCase()
    };
    return online.filter((row) => Object.entries(filters).every(([field, query]) =>
      !query || String(row[field] || "").toLowerCase().includes(query)
    ));
  }

  function render() {
    const rows = filteredRows();
    document.getElementById("ou-body").innerHTML = rows.length ? rows.map((row) => `
      <tr data-id="${escapeHtml(row.id)}">
        <td><input class="ou-check" type="checkbox" data-id="${escapeHtml(row.id)}"></td>
        <td>${escapeHtml(row.user)}</td>
        <td>${escapeHtml(row.login)}</td>
        <td>${escapeHtml(row.ip)}</td>
        <td>${escapeHtml(row.source)}</td>
        <td>${escapeHtml(row.os)}</td>
        <td>${escapeHtml(row.browser)}</td>
        <td>${escapeHtml(row.type)}</td>
        <td><button class="icon-button ou-kick" data-id="${escapeHtml(row.id)}" title="Force logout">&#128683;</button></td>
      </tr>`).join("") : '<tr><td colspan="9" style="color:#9ca3af">No customers are currently online.</td></tr>';
    document.querySelectorAll(".ou-kick").forEach((button) => {
      button.onclick = () => forceLogout([button.dataset.id]);
    });
  }

  async function load() {
    document.getElementById("ou-body").innerHTML = '<tr><td colspan="9">Loading online users...</td></tr>';
    try {
      const data = await api("admin_online_users");
      online = (data.onlineUsers || []).map((row) => ({ ...row, ...deviceInfo(row.userAgent) }));
      render();
    } catch (error) {
      document.getElementById("ou-body").innerHTML = `<tr><td colspan="9" style="color:#dc2626">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function forceLogout(ids) {
    if (!ids.length || !window.confirm("Force logout the selected session(s)?")) return;
    try {
      await api("admin_force_logout", { sessionIds: ids });
      await load();
    } catch (error) {
      window.alert(error.message);
    }
  }

  function downloadCsv() {
    const rows = [["user", "login", "last seen", "ip", "source", "os", "browser", "type"]]
      .concat(online.map((row) => [row.user, row.login, row.lastSeen, row.ip, row.source, row.os, row.browser, row.type]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "online-users.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById("ou-download").addEventListener("click", downloadCsv);
  document.getElementById("ou-query").addEventListener("click", load);
  document.getElementById("ou-force-logout").addEventListener("click", () => {
    const ids = Array.from(document.querySelectorAll(".ou-check:checked"), (box) => box.dataset.id);
    if (!ids.length) return window.alert("No selection");
    forceLogout(ids);
  });
  document.getElementById("ou-select-all").addEventListener("change", (event) => {
    document.querySelectorAll(".ou-check").forEach((box) => { box.checked = event.target.checked; });
  });
  ["filter-user", "filter-ip", "filter-ip-source", "filter-os", "filter-browser", "filter-type"]
    .forEach((id) => document.getElementById(id).addEventListener("input", render));

  load();
  window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
})();
