import {
  BUILDING_TYPES,
  TILE_LABELS,
  TILE_TYPES,
  WORKER_MIN,
  WORKER_ROLE_BY_TILE,
  formatNumber,
  isLand,
  isTileActive,
  signed,
  titleCase,
} from "./utils.js";
import {
  ERAS,
  MILITARY_BRANCHES,
  TECH_CATEGORIES,
  branchCost,
  buildingCost,
  canResearch,
  canResearchBranch,
  eraLabel,
  researchCost,
  trainingCost,
} from "./tech.js";
import { ALLIANCE_TYPES, getDiplomacy, relationLabel } from "./trade.js";
import { computeScore, militaryPower } from "./nation.js";

export function bindUI(game, renderer) {
  return new GameUI(game, renderer);
}

class GameUI {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.reportDialogId = null;
    this.victoryShown = false;
    this.cacheDom();
    this.bindEvents();
    this.game.on((event) => this.handleGameEvent(event));
    this.render();
    window.setInterval(() => this.renderStatus(), 1000);
  }

  cacheDom() {
    this.app = document.getElementById("app");
    this.statusStrip = document.getElementById("status-strip");
    this.phaseLabel = document.getElementById("phase-label");
    this.endTurnBtn = document.getElementById("end-turn-btn");
    this.saveBtn = document.getElementById("save-btn");
    this.newGameBtn = document.getElementById("new-game-btn");
    this.resourcePanel = document.getElementById("resource-panel");
    this.nationPanel = document.getElementById("nation-panel");
    this.diplomacyPanel = document.getElementById("diplomacy-panel");
    this.techPanel = document.getElementById("tech-panel");
    this.summaryPanel = document.getElementById("summary-panel");
    this.feed = document.getElementById("event-feed-content");
    this.tilePopup = document.getElementById("tile-popup");
    this.tilePopupContent = document.getElementById("tile-popup-content");
    this.tileCloseBtn = document.getElementById("tile-close-btn");
    this.tooltip = document.getElementById("tooltip");
    this.dialogBackdrop = document.getElementById("dialog-backdrop");
    this.dialogTitle = document.getElementById("dialog-title");
    this.dialogBody = document.getElementById("dialog-body");
    this.dialogCloseBtn = document.getElementById("dialog-close-btn");
  }

  bindEvents() {
    this.renderer.onSelect = (tileId) => {
      this.game.selectTile(tileId);
      if (tileId) this.renderer.focusTile(tileId);
    };
    this.renderer.onHover = (tileId, event) => this.renderTooltip(tileId, event);
    this.tileCloseBtn.addEventListener("click", () => this.game.selectTile(null));
    this.endTurnBtn.addEventListener("click", () => this.game.endTurn());
    this.saveBtn.addEventListener("click", () => {
      const result = this.game.save();
      this.showNotice("Save", result.ok ? "Game saved." : result.reason);
    });
    this.newGameBtn.addEventListener("click", () => {
      this.showConfirmNewGame();
    });
    this.dialogCloseBtn.addEventListener("click", () => this.closeDialog());
    this.tilePopup.addEventListener("click", (event) => this.handleTileClick(event));
    this.diplomacyPanel.addEventListener("click", (event) => this.handleDiplomacyClick(event));
    this.techPanel.addEventListener("click", (event) => this.handleTechClick(event));
  }

  handleGameEvent(event) {
    if (event.type === "battle_report") {
      this.renderer.playBattle(event.report);
      this.showBattleReport(event.report);
    }
    if (event.type === "game_over") this.showVictory();
    this.render();
  }

  render() {
    this.renderStatus();
    this.renderResources();
    this.renderNations();
    this.renderDiplomacy();
    this.renderTech();
    this.renderSummary();
    this.renderEvents();
    this.renderTilePopup();
    this.renderer.renderState(this.game.map, this.game.nations, this.game.selectedTileId);
    this.maybeShowEraReport();
    if (this.game.gameOver) this.showVictory();
  }

  renderStatus() {
    const player = this.game.player;
    this.phaseLabel.textContent = phaseLabel(this.game.phase, this.game.isProcessingTurn);
    this.endTurnBtn.disabled = this.game.isProcessingTurn || Boolean(this.game.pendingEraReport) || Boolean(this.game.gameOver);
    const turnLimit = this.game.settings.unlimitedMode ? "Unlimited" : `${this.game.turn}/${this.game.settings.maxTurns}`;
    this.statusStrip.innerHTML = [
      pill(player.name),
      pill(eraLabel(this.game.era)),
      pill(`Turn ${turnLimit}`),
      pill(`Money $${formatNumber(player.money)}`),
      pill(`Pop ${formatNumber(player.population.total)} (${formatNumber(player.population.available)} free)`),
      pill(this.timeText()),
    ].join("");
  }

  renderResources() {
    const player = this.game.player;
    const foodNeed = Math.ceil(player.population.total * (0.55 + this.game.era * 0.04));
    this.resourcePanel.innerHTML = `
      ${resourceRow("Food", player.resources.food, foodNeed > player.resources.food ? "bad" : "good", `Consumes ${foodNeed}/turn`)}
      ${resourceRow("Materials", player.resources.materials, "warn", "Mining and military")}
      ${resourceRow("Education", player.resources.education, "blue", "Research and factories")}
      ${resourceRow("Industry", player.resources.industry, "good", "Factories and branches")}
      ${resourceRow("Military Power", militaryPower(player, this.game.tiles), "bad", "Defense and conquest")}
    `;
  }

  renderNations() {
    const scores = this.game.scoreboard();
    this.nationPanel.innerHTML = scores.map((entry, index) => {
      const nation = this.game.nations[entry.id];
      return `
        <div class="nation-row">
          <div class="row-head">
            <strong><span style="color:${nation.color}">■</span> ${escapeHtml(entry.name)}</strong>
            <span class="mini-pill">#${index + 1} ${formatNumber(entry.score)}</span>
          </div>
          <div class="muted">${entry.active ? nation.profile : "Conquered"} · ${entry.territory} tiles · ${entry.population} people · ${entry.military} power</div>
        </div>
      `;
    }).join("");
  }

  renderDiplomacy() {
    if (this.game.era < 2) {
      this.diplomacyPanel.innerHTML = `<p class="muted">Diplomacy, trade, and alliances unlock in Era 2.</p>`;
      return;
    }
    const rows = this.game.botIds.map((id) => {
      const nation = this.game.nations[id];
      if (!nation) return "";
      const diplo = getDiplomacy(this.game, this.game.playerId, id);
      const activeAlliances = this.game.alliances.filter((alliance) => alliance.active && alliance.members.includes(this.game.playerId) && alliance.members.includes(id));
      const war = this.game.wars[`${[this.game.playerId, id].sort().join("|")}`]?.active;
      return `
        <div class="diplo-row">
          <div class="row-head">
            <strong><span style="color:${nation.color}">■</span> ${escapeHtml(nation.name)}</strong>
            <span class="mini-pill ${war ? "bad" : ""}">${war ? "War" : relationLabel(diplo.relation)} ${diplo.relation}</span>
          </div>
          <div class="muted">${nation.personality} · ${activeAlliances.length ? activeAlliances.map((a) => a.label).join(", ") : "No active alliance"}</div>
          <div class="row-actions">
            <button class="secondary-btn" data-diplo="trade" data-id="${id}">Trade</button>
            <button class="secondary-btn" data-diplo="alliance" data-id="${id}">Alliance</button>
            <button class="danger-btn" data-diplo="war" data-id="${id}" ${this.game.era < 3 || war ? "disabled" : ""}>Declare War</button>
          </div>
        </div>
      `;
    }).join("");
    const allianceRows = this.game.alliances
      .filter((alliance) => alliance.active && alliance.members.includes(this.game.playerId))
      .map((alliance) => `
        <div class="diplo-row">
          <div class="row-head"><strong>${escapeHtml(alliance.label)}</strong><span class="mini-pill">Ends T${alliance.expiresTurn}</span></div>
          <button class="secondary-btn" data-diplo="break" data-id="${alliance.id}">Break Agreement</button>
        </div>
      `).join("");
    this.diplomacyPanel.innerHTML = rows + (allianceRows ? `<hr />${allianceRows}` : "");
  }

  renderTech() {
    const player = this.game.player;
    const categoryRows = Object.entries(TECH_CATEGORIES).map(([id, config]) => {
      const check = canResearch(this.game, player, id);
      const cost = researchCost(id, player.tech[id]);
      return `
        <div class="tech-row">
          <div class="row-head">
            <strong>${config.label}</strong>
            <span class="mini-pill">Tier ${player.tech[id]}/4</span>
          </div>
          <div class="muted">${escapeHtml(config.description)} Cost: $${formatNumber(cost)}.</div>
          <button class="secondary-btn" data-tech="${id}" ${check.ok ? "" : "disabled"} title="${escapeHtml(check.reason || "")}">
            Research
          </button>
          ${check.ok ? "" : `<div class="muted">${escapeHtml(check.reason)}</div>`}
        </div>
      `;
    }).join("");
    const branchRows = this.game.era < 4 ? `<p class="muted">Military branches unlock in Era 4.</p>` : Object.entries(MILITARY_BRANCHES).map(([id, config]) => {
      const check = canResearchBranch(this.game, player, id);
      const cost = branchCost(id, player.tech.branches[id]);
      return `
        <div class="tech-row">
          <div class="row-head">
            <strong>${config.label}</strong>
            <span class="mini-pill">Level ${player.tech.branches[id]}/3</span>
          </div>
          <div class="muted">${escapeHtml(config.effect)} $${formatNumber(cost.money)}, ${cost.materials} materials, ${cost.education} education, ${cost.industry} industry.</div>
          <button class="secondary-btn" data-branch="${id}" ${check.ok ? "" : "disabled"} title="${escapeHtml(check.reason || "")}">Specialize</button>
          ${check.ok ? "" : `<div class="muted">${escapeHtml(check.reason)}</div>`}
        </div>
      `;
    }).join("");
    this.techPanel.innerHTML = categoryRows + `<div class="tech-row"><strong>Era 4 Branches</strong></div>` + branchRows;
  }

  renderSummary() {
    const summary = this.game.lastSummary;
    if (!summary) {
      this.summaryPanel.innerHTML = `<p class="muted">End a turn to see the round summary.</p>`;
      return;
    }
    this.summaryPanel.innerHTML = `
      ${summaryLine("Money", signed(summary.money))}
      ${summaryLine("Food", signed(summary.food))}
      ${summaryLine("Materials", signed(summary.materials))}
      ${summaryLine("Education", signed(summary.education))}
      ${summaryLine("Industry", signed(summary.industry))}
      ${summaryLine("Population", signed(summary.population))}
      ${summaryLine("Deaths", formatNumber(summary.deaths), summary.deaths ? "bad" : "")}
      ${summaryLine("War Upkeep", `$${formatNumber(summary.upkeep)}`)}
      ${summary.notes.map((note) => `<div class="summary-row muted">${escapeHtml(note)}</div>`).join("")}
    `;
  }

  renderEvents() {
    const recent = [...this.game.events].slice(-12).reverse();
    this.feed.innerHTML = recent.map((event) => {
      const nation = event.nationId ? this.game.nations[event.nationId] : null;
      return `
        <div class="feed-item">
          <span>T${event.turn} · ${escapeHtml(event.type)}</span>
          <div>${nation ? `<b style="color:${nation.color}">${escapeHtml(nation.name)}:</b> ` : ""}${escapeHtml(event.message)}</div>
        </div>
      `;
    }).join("");
  }

  renderTilePopup() {
    const tile = this.game.selectedTileId ? this.game.tileById(this.game.selectedTileId) : null;
    if (!tile) {
      this.tilePopup.hidden = true;
      return;
    }
    this.tilePopup.hidden = false;
    const owner = tile.ownerId ? this.game.nations[tile.ownerId] : null;
    const active = isTileActive(tile);
    const workerRole = WORKER_ROLE_BY_TILE[tile.type];
    const isPlayerTile = tile.ownerId === this.game.playerId;
    const buildRows = this.renderBuildButtons(tile);
    const workerRows = isPlayerTile && workerRole ? this.renderWorkerControls(tile, active) : "";
    const militaryRows = isPlayerTile ? this.renderMilitaryControls(tile) : "";
    this.tilePopupContent.innerHTML = `
      <h2>${escapeHtml(TILE_LABELS[tile.type] || tile.type)} ${tile.isCapital ? "Capital" : ""}</h2>
      <div class="tile-meta">
        ${metric("Coords", `${tile.q}, ${tile.r}`)}
        ${metric("Owner", owner ? owner.name : "Unowned")}
        ${metric("Region", tile.regionId || "Sea")}
        ${metric("Status", tile.type === TILE_TYPES.WATER ? "Water" : active ? "Active" : "Inactive")}
      </div>
      ${tile.unit?.strength ? `<div class="metric"><span>Troops</span><strong>${tile.unit.strength} strength</strong></div>` : ""}
      ${tile.effects.disabledTurns || tile.effects.floodedTurns ? `<p class="warn">Temporary effect active on this tile.</p>` : ""}
      ${buildRows}
      ${workerRows}
      ${militaryRows}
    `;
  }

  renderBuildButtons(tile) {
    if (!isLand(tile)) return `<p class="muted">Water blocks construction until naval movement is used for military crossing.</p>`;
    const buttons = BUILDING_TYPES.map((type) => {
      const check = this.game.canBuild(tile.id, type, this.game.playerId);
      const cost = buildingCost(type, this.game.era);
      return `<button class="secondary-btn" data-tile-action="build" data-type="${type}" ${check.ok ? "" : "disabled"} title="${escapeHtml(check.reason || "")}">${TILE_LABELS[type]} $${cost}</button>`;
    }).join("");
    return `
      <div class="stack">
        <strong>Build</strong>
        <div class="action-grid">${buttons}</div>
      </div>
    `;
  }

  renderWorkerControls(tile, active) {
    const min = WORKER_MIN[tile.type] || 0;
    const need = Math.max(0, min - tile.workers);
    return `
      <div class="stack">
        <strong>Workers</strong>
        <div class="metric-grid">
          ${metric("Assigned", tile.workers)}
          ${metric("Required", min)}
          ${metric("Role", titleCase(WORKER_ROLE_BY_TILE[tile.type]))}
          ${metric("State", active ? "Functioning" : need ? `Needs ${need}` : "Blocked")}
        </div>
        <div class="row-actions">
          <button class="secondary-btn" data-tile-action="workers" data-amount="1">Assign 1</button>
          <button class="secondary-btn" data-tile-action="workers" data-amount="${need || 1}">Fill Minimum</button>
          <button class="secondary-btn" data-tile-action="workers" data-amount="-1">Remove 1</button>
          <button class="danger-btn" data-tile-action="destroy">Destroy</button>
        </div>
      </div>
    `;
  }

  renderMilitaryControls(tile) {
    if (tile.type !== TILE_TYPES.MILITARY && !tile.unit?.strength) return "";
    const train = tile.type === TILE_TYPES.MILITARY
      ? [3, 6].map((amount) => {
          const cost = trainingCost(amount, this.game.era);
          return `<button class="secondary-btn" data-tile-action="train" data-amount="${amount}">Train ${amount} ($${cost.money})</button>`;
        }).join("")
      : "";
    const moves = this.game.militaryActions(tile.id).map((action) => {
      const target = this.game.tileById(action.toTileId);
      const label = `${action.label} ${target.q},${target.r}`;
      return `<button class="${action.action === "attack" ? "danger-btn" : "secondary-btn"}" data-tile-action="move" data-target="${action.toTileId}">${label}</button>`;
    }).join("");
    return `
      <div class="stack">
        <strong>Military</strong>
        <div class="row-actions">${train || ""}${moves || ""}</div>
        ${this.game.era < 3 ? `<p class="muted">War declarations unlock in Era 3. Troops can still be trained for defense.</p>` : ""}
      </div>
    `;
  }

  renderTooltip(tileId, event) {
    if (!tileId || !event) {
      this.tooltip.hidden = true;
      return;
    }
    const tile = this.game.tileById(tileId);
    if (!tile) {
      this.tooltip.hidden = true;
      return;
    }
    const owner = tile.ownerId ? this.game.nations[tile.ownerId]?.name : "Unowned";
    this.tooltip.innerHTML = `<strong>${escapeHtml(TILE_LABELS[tile.type])}</strong><br />${escapeHtml(owner)} · ${tile.q}, ${tile.r}`;
    this.tooltip.style.left = `${event.clientX + 14}px`;
    this.tooltip.style.top = `${event.clientY + 14}px`;
    this.tooltip.hidden = false;
  }

  handleTileClick(event) {
    const button = event.target.closest("[data-tile-action]");
    if (!button) return;
    const tileId = this.game.selectedTileId;
    const action = button.dataset.tileAction;
    let result = null;
    if (action === "build") result = this.game.buildTile(tileId, button.dataset.type);
    if (action === "workers") result = this.game.assignWorkers(tileId, Number(button.dataset.amount));
    if (action === "destroy") result = this.game.destroyTile(tileId);
    if (action === "train") result = this.game.trainUnit(tileId, Number(button.dataset.amount));
    if (action === "move") result = this.game.moveOrAttackUnit(tileId, button.dataset.target);
    if (result && !result.ok) this.showNotice("Action blocked", result.reason);
    this.render();
  }

  handleDiplomacyClick(event) {
    const button = event.target.closest("[data-diplo]");
    if (!button) return;
    const action = button.dataset.diplo;
    const id = button.dataset.id;
    if (action === "trade") this.openTradeDialog(id);
    if (action === "alliance") this.openAllianceDialog(id);
    if (action === "war") {
      const result = this.game.declareWar(id);
      if (!result.ok) this.showNotice("War blocked", result.reason);
    }
    if (action === "break") {
      const result = this.game.breakAlliance(id);
      if (!result.ok) this.showNotice("Alliance", result.reason);
    }
  }

  handleTechClick(event) {
    const techButton = event.target.closest("[data-tech]");
    if (techButton) {
      const result = this.game.research(techButton.dataset.tech);
      if (!result.ok) this.showNotice("Research blocked", result.reason);
      return;
    }
    const branchButton = event.target.closest("[data-branch]");
    if (branchButton) {
      const result = this.game.researchBranch(branchButton.dataset.branch);
      if (!result.ok) this.showNotice("Specialization blocked", result.reason);
    }
  }

  openTradeDialog(partnerId) {
    const partner = this.game.nations[partnerId];
    this.openDialog(`Trade with ${partner.name}`, `
      <form id="trade-form" class="form-grid">
        ${tradeField("offer-money", "Offer money", 0)}
        ${tradeField("request-money", "Request money", 0)}
        ${tradeField("offer-food", "Offer food", 0)}
        ${tradeField("request-food", "Request food", 0)}
        ${tradeField("offer-materials", "Offer materials", 0)}
        ${tradeField("request-materials", "Request materials", 0)}
        ${tradeField("offer-education", "Offer education", 0)}
        ${tradeField("request-education", "Request education", 0)}
        ${tradeField("offer-industry", "Offer industry", 0)}
        ${tradeField("request-industry", "Request industry", 0)}
        ${tradeField("offer-people", "Offer people", 0)}
        ${tradeField("request-people", "Request people", 0)}
        <div class="wide row-actions">
          <button class="primary-btn" type="submit">Send Proposal</button>
        </div>
      </form>
    `, () => {
      this.dialogBody.querySelector("#trade-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const bundle = (prefix) => ({
          money: Number(data.get(`${prefix}-money`) || 0),
          food: Number(data.get(`${prefix}-food`) || 0),
          materials: Number(data.get(`${prefix}-materials`) || 0),
          education: Number(data.get(`${prefix}-education`) || 0),
          industry: Number(data.get(`${prefix}-industry`) || 0),
          people: Number(data.get(`${prefix}-people`) || 0),
        });
        const result = this.game.trade(partnerId, bundle("offer"), bundle("request"));
        this.closeDialog();
        this.showNotice("Trade", result.reason || (result.accepted ? "Accepted." : "Rejected."));
      });
    });
  }

  openAllianceDialog(partnerId) {
    const partner = this.game.nations[partnerId];
    const buttons = Object.entries(ALLIANCE_TYPES).map(([id, config]) => {
      return `<button class="secondary-btn" data-alliance-type="${id}">${config.label} $${config.cost}</button>`;
    }).join("");
    this.openDialog(`Alliance with ${partner.name}`, `
      <p class="muted">Choose an agreement type. Alliances last 6 turns and improve relations when accepted.</p>
      <div class="action-grid">${buttons}</div>
    `, () => {
      this.dialogBody.querySelectorAll("[data-alliance-type]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const result = this.game.proposeAlliance(partnerId, btn.dataset.allianceType);
          this.closeDialog();
          this.showNotice("Alliance", result.reason || (result.accepted ? "Accepted." : "Rejected."));
        });
      });
    });
  }

  showBattleReport(report) {
    this.openDialog("Combat Report", `
      <div class="metric-grid">
        ${metric("Attacker", report.attackerName)}
        ${metric("Defender", report.defenderName)}
        ${metric("Attack", report.attack)}
        ${metric("Defense", report.defense)}
        ${metric("Attacker Losses", report.losses.attacker)}
        ${metric("Defender Losses", report.losses.defender)}
        ${metric("Winner", report.attackerWins ? report.attackerName : report.defenderName)}
        ${metric("Territory", report.attackerWins ? "Changed owner" : "Held")}
      </div>
      ${report.capitalCaptured ? `<p class="good">Capital captured. The defending nation was conquered.</p>` : ""}
    `);
  }

  maybeShowEraReport() {
    const report = this.game.pendingEraReport;
    if (!report || this.reportDialogId === report.id) return;
    this.reportDialogId = report.id;
    this.dialogCloseBtn.hidden = true;
    const rows = report.comparison.map((entry, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${formatNumber(entry.score)}</td>
        <td>${formatNumber(entry.population)}</td>
        <td>${formatNumber(entry.territory)}</td>
        <td>${formatNumber(entry.military)}</td>
      </tr>
    `).join("");
    const playerDelta = report.sinceEra.nations[this.game.playerId];
    this.openDialog(`Era ${report.fromEra} Report`, `
      <p>Era ${report.nextEra} is ready to begin. Submit a reflection to continue.</p>
      <div class="metric-grid">
        ${metric("Score Change", signed(playerDelta.score))}
        ${metric("Population Change", signed(playerDelta.population))}
        ${metric("Territory Change", signed(playerDelta.territory))}
        ${metric("Money Change", `$${signed(playerDelta.money)}`)}
      </div>
      <table class="report-table">
        <thead><tr><th>Rank</th><th>Nation</th><th>Score</th><th>Pop</th><th>Tiles</th><th>Power</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <label class="field">
        <span>Reflection summary</span>
        <textarea id="era-reflection" placeholder="What choices helped or hurt your nation this era?"></textarea>
      </label>
      <div id="reflection-error" class="bad" style="min-height:22px;margin-top:8px"></div>
      <div class="row-actions" style="margin-top:12px">
        <button id="submit-reflection" class="primary-btn">Begin Era ${report.nextEra}</button>
      </div>
    `, () => {
      this.dialogCloseBtn.hidden = true;
      this.dialogBody.querySelector("#submit-reflection").addEventListener("click", () => {
        const text = this.dialogBody.querySelector("#era-reflection").value;
        const result = this.game.submitEraReflection(text);
        if (!result.ok) {
          this.dialogBody.querySelector("#reflection-error").textContent = result.reason;
          return;
        }
        this.reportDialogId = null;
        this.closeDialog();
      });
    });
  }

  showVictory() {
    if (this.victoryShown || !this.game.gameOver) return;
    this.victoryShown = true;
    this.dialogCloseBtn.hidden = true;
    const gameOver = this.game.gameOver;
    const winner = this.game.nations[gameOver.winnerId];
    const rows = gameOver.scores.map((entry, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${formatNumber(entry.score)}</td>
        <td>${entry.active ? "Active" : "Conquered"}</td>
      </tr>
    `).join("");
    this.openDialog("Game Over", `
      <h3>${escapeHtml(winner.name)} wins by ${escapeHtml(gameOver.label)}.</h3>
      <table class="report-table">
        <thead><tr><th>Rank</th><th>Nation</th><th>Strength Score</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="row-actions">
        <button id="victory-new-game" class="primary-btn">Start New Game</button>
      </div>
    `, () => {
      this.dialogCloseBtn.hidden = true;
      this.dialogBody.querySelector("#victory-new-game").addEventListener("click", () => window.location.reload());
    });
  }

  showConfirmNewGame() {
    this.openDialog("Start New Game", `
      <p>This will return to the setup screen. Your current game is already saved unless you clear browser storage.</p>
      <div class="row-actions">
        <button id="confirm-new-game" class="danger-btn">Return to Setup</button>
      </div>
    `, () => {
      this.dialogBody.querySelector("#confirm-new-game").addEventListener("click", () => window.location.reload());
    });
  }

  showNotice(title, message) {
    this.openDialog(title, `<p>${escapeHtml(message || "")}</p>`);
  }

  openDialog(title, html, onMount = null) {
    this.dialogTitle.textContent = title;
    this.dialogBody.innerHTML = html;
    this.dialogBackdrop.hidden = false;
    if (!this.game.pendingEraReport && !this.game.gameOver) this.dialogCloseBtn.hidden = false;
    if (onMount) onMount();
  }

  closeDialog() {
    if (this.game.pendingEraReport || this.game.gameOver) return;
    this.dialogBackdrop.hidden = true;
    this.dialogBody.innerHTML = "";
    this.dialogCloseBtn.hidden = false;
  }

  timeText() {
    const limit = this.game.settings.timeLimitMinutes || 0;
    if (!limit) return "No timer";
    const elapsed = Math.floor((Date.now() - this.game.startedAt) / 1000);
    const remaining = limit * 60 - elapsed;
    if (remaining <= 0) return "Time expired";
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `Time ${minutes}:${String(seconds).padStart(2, "0")}`;
  }
}

function phaseLabel(phase, processing) {
  if (processing && phase === "ai") return "AI Turns";
  if (phase === "round") return "Round Processing";
  if (phase === "ai") return "AI Turns";
  return "Player Turn";
}

function pill(text) {
  return `<span class="status-pill">${escapeHtml(text)}</span>`;
}

function resourceRow(label, value, className = "", note = "") {
  return `
    <div class="resource-row">
      <div class="row-head"><strong>${escapeHtml(label)}</strong><span class="${className}">${formatNumber(value)}</span></div>
      <div class="muted">${escapeHtml(note)}</div>
    </div>
  `;
}

function summaryLine(label, value, className = "") {
  return `<div class="summary-row"><div class="row-head"><span>${escapeHtml(label)}</span><strong class="${className}">${escapeHtml(value)}</strong></div></div>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tradeField(name, label, value) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input name="${name}" type="number" min="0" step="1" value="${value}" />
    </label>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
