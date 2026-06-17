(function () {
  const isLoginPage = location.pathname.endsWith("/login.html");
  const loggedIn = localStorage.getItem("adminLogin") === "true";

  if (!isLoginPage && !loggedIn) {
    window.location.href = "login.html";
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function readUsers() {
    try {
      return JSON.parse(localStorage.getItem("demoExchangeUsers") || "{}");
    } catch {
      return {};
    }
  }

  function readAdminAccounts() {
    try {
      return JSON.parse(localStorage.getItem("adminAccountData") || "[]");
    } catch {
      return [];
    }
  }

  function showToast(message, type = "success") {
    let toast = $(".admin-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "admin-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `admin-toast ${type} show`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function normalizeIcons() {
    $$(".admin-search .search-icon").forEach((node) => {
      node.textContent = "🔎";
      node.setAttribute("aria-hidden", "true");
    });
    $$(".admin-profile .icon-button").forEach((button) => {
      if (button.textContent.includes("ä") || button.textContent.trim() === "") {
        button.textContent = "中文";
      }
      if (button.textContent.includes("â")) {
        button.textContent = "⚙";
      }
    });
    $$(".table-btn").forEach((button) => {
      button.textContent = button.textContent
        .replace(/ðŸ”|🔍/g, "Query")
        .replace(/â–¦/g, "Table Control")
        .trim();
    });
    $$(".empty-box").forEach((box) => {
      if (box.textContent.includes("ð")) {
        const p = $("p", box)?.textContent || "No Data";
        box.innerHTML = `<div class="empty-icon">📦</div><p>${p.replace("No Date", "No Data")}</p>`;
      }
    });
    $$("td").forEach((cell) => {
      if (cell.textContent.includes("ð") || cell.textContent.includes("âœ")) {
        cell.innerHTML = '<button class="row-action" data-action="view">View</button><button class="row-action" data-action="edit">Edit</button>';
      }
    });
  }

  function setActiveNavigation() {
    const page = location.pathname.split("/").pop() || "admin.html";
    $$(".admin-menu a").forEach((link) => {
      const href = link.getAttribute("href");
      const active = href === page;
      link.classList.toggle("active", active);
      link.closest(".admin-submenu-item")?.classList.toggle("active", active);
      if (active) {
        const details = link.closest("details");
        if (details) details.open = true;
        const summary = details?.querySelector(".admin-menu-item");
        summary?.classList.add("active");
      }
    });
  }

  function bindMenuSearch() {
    const input = $(".admin-search input");
    if (!input) return;
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      $$(".admin-menu-group").forEach((group) => {
        const links = $$("a", group);
        const matched = !query || links.some((link) => link.textContent.toLowerCase().includes(query));
        group.style.display = matched ? "" : "none";
        if (query && matched) group.open = true;
      });
    });
  }

  function updateDashboardCards() {
    const cards = $$(".admin-card");
    if (!cards.length) return;
    const users = Object.values(readUsers());
    const accounts = readAdminAccounts();
    const userTotal = users.length + accounts.length;
    const portfolioTotal = users.reduce((sum, user) => sum + Number(user.balances?.USDT || 0), 0) +
      accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
    const today = new Date().toLocaleDateString();
    const newToday = users.filter((user) =>
      (user.transactions || []).some((tx) => String(tx.time || "").startsWith(today))
    ).length;

    const values = [userTotal, newToday, money(portfolioTotal), money(portfolioTotal)];
    cards.forEach((card, index) => {
      const value = $(".card-value", card);
      if (value && values[index] !== undefined) value.textContent = values[index];
    });
  }

  function bindHeaderActions() {
    const routes = [
      ["Primary certification", "primary-real-name.html"],
      ["Advanced Certification", "advanced-real-name.html"],
      ["Withdrawal Review", "withdrawal-records.html"],
      ["Cycle contracts", "cycle-contracts-trades.html"],
      ["Recharge Review", "recharge-review.html"]
    ];
    $$(".admin-pill").forEach((button) => {
      button.addEventListener("click", () => {
        const text = button.textContent;
        if (text.includes("voice")) {
          button.classList.toggle("active");
          showToast(button.classList.contains("active") ? "Voice broadcast started." : "Voice broadcast stopped.");
          return;
        }
        const route = routes.find(([label]) => text.includes(label));
        if (route) window.location.href = route[1];
      });
    });
  }

  function rowMatchesFilters(row, controls) {
    const rowText = row.textContent.toLowerCase();
    return controls.every((control) => {
      const value = control.value?.trim().toLowerCase();
      return !value || rowText.includes(value);
    });
  }

  function filterTable(panel) {
    const controls = $$("input, select", $(".filter-row", panel)).filter((control) => control.type !== "checkbox");
    const rows = $$("tbody tr", panel).filter((row) => !row.querySelector(".empty-box"));
    let visible = 0;
    rows.forEach((row) => {
      const show = rowMatchesFilters(row, controls);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    showToast(`Showing ${visible} record${visible === 1 ? "" : "s"}.`);
  }

  function buildColumnPanel(panel) {
    let picker = $(".column-picker", panel);
    if (picker) {
      picker.remove();
      return;
    }
    const table = $("table", panel);
    if (!table) return;
    const headers = $$("thead th", table);
    picker = document.createElement("div");
    picker.className = "column-picker";
    picker.innerHTML = headers.map((th, index) => `
      <label><input type="checkbox" checked data-column-index="${index}"> ${th.textContent.trim() || "Select"}</label>
    `).join("");
    $(".table-tools", panel)?.after(picker);
    picker.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-column-index]");
      if (!input) return;
      const index = Number(input.dataset.columnIndex) + 1;
      $$(`tr > *:nth-child(${index})`, table).forEach((cell) => {
        cell.style.display = input.checked ? "" : "none";
      });
    });
  }

  function bindTables() {
    $$(".admin-panel").forEach((panel) => {
      const queryButton = $$(".table-btn", panel).find((button) => button.textContent.toLowerCase().includes("query"));
      queryButton?.addEventListener("click", () => filterTable(panel));
      $$(".filter-row input, .filter-row select", panel).forEach((control) => {
        control.addEventListener("input", () => filterTable(panel));
        control.addEventListener("change", () => filterTable(panel));
      });

      const tableControl = $$(".table-btn", panel).find((button) => button.textContent.toLowerCase().includes("table control"));
      tableControl?.addEventListener("click", () => buildColumnPanel(panel));
    });

    $$("thead input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const table = checkbox.closest("table");
        $$("tbody input[type='checkbox']", table).forEach((box) => {
          box.checked = checkbox.checked;
        });
      });
    });

    document.addEventListener("click", (event) => {
      const action = event.target.closest(".row-action");
      if (!action) return;
      const row = action.closest("tr");
      const cells = $$("td", row).map((td) => td.textContent.trim()).filter(Boolean);
      showToast(`${action.dataset.action === "edit" ? "Editing" : "Viewing"} record ${cells[1] || cells[0] || ""}.`);
    });

    $$(".pagination button").forEach((button) => {
      button.addEventListener("click", () => {
        $$(".pagination button").forEach((item) => item.classList.toggle("active", item === button));
        showToast(`Page ${button.textContent.trim()} selected.`);
      });
    });
  }

  function bindGenericForms() {
    $$("form").forEach((form) => {
      if (form.id === "loginForm") return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        showToast("Saved successfully.");
      });
    });
    $$(".primary-button, .secondary-button").forEach((button) => {
      if (button.id || button.closest("form") || button.onclick) return;
      button.addEventListener("click", () => showToast(`${button.textContent.trim() || "Action"} completed.`));
    });
  }

  function init() {
    normalizeIcons();
    setActiveNavigation();
    bindMenuSearch();
    updateDashboardCards();
    bindHeaderActions();
    bindTables();
    bindGenericForms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
