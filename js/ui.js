import {
  BIOME_LABELS,
  BUILDING_TYPES,
  TILE_LABELS,
  TILE_TYPES,
  WORKER_MIN,
  WORKER_ROLE_BY_TILE,
  formatNumber,
  isLand,
  isWaterLike,
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
  productionForTile,
  researchCost,
  transportHappinessBonus,
  transportGrowthMultiplier,
  transportUnlockForTier,
  trainingOptionsForNation,
  workerAdminCost,
} from "./tech.js";
import { ALLIANCE_TYPES, getDiplomacy, projectTradeRouteYield, relationLabel } from "./trade.js";
import { computeScore, militaryPower } from "./nation.js";
import { warUpkeep } from "./war.js";
import { BALANCE } from "./balance.js";
import { activeEventSummaries } from "./events.js";

export const TUTORIAL_COMPLETED_KEY = "leagueOfNationsTutorialCompleted";

const TUTORIAL_STEPS = [
  {
    title: "Welcome",
    body: "Grow your nation by managing land, resources, technology, and relationships with rival nations.",
    target: "#app",
  },
  {
    title: "Map",
    body: "The map fills the screen. Zoom out to see the whole world, then select tiles to inspect land, water, owners, buildings, and units.",
    target: ".map-section",
  },
  {
    title: "Resources",
    body: "Your resource strip runs across the top. It shows money, food, materials, population, happiness, education, industry, and military power.",
    target: "#resource-panel",
  },
  {
    title: "Actions",
    body: "The numbered circle shows action points left this turn. Open it for a quick reminder of used actions and what you can do next.",
    target: "#action-counter",
  },
  {
    title: "Tile Controls",
    body: "Use the tile panel to build farms, mines, schools, factories, or military sites when the tile allows it.",
    target: "#tile-popup",
    prepare: "selectPlayerTile",
  },
  {
    title: "Technology",
    body: "Open the tech button to research improvements. Strong progress moves the world into later eras with more options.",
    target: "#tech-tree-btn",
  },
  {
    title: "Tutorial",
    body: "The question-mark button replays this walkthrough whenever you want a refresher.",
    target: "#replay-tutorial-btn",
  },
  {
    title: "Leaderboard",
    body: "The rank button opens the leaderboard so you can compare score, territory, population, happiness, and military power.",
    target: "#leaderboard-btn",
  },
  {
    title: "Diplomacy",
    body: "The diplomacy button opens relations, alliances, embargoes, and wars. Diplomacy and trade unlock in Era 2; war unlocks later.",
    target: "#board-diplomacy-btn",
  },
  {
    title: "Trade",
    body: "The trade button shows active trade routes and projected route yield once trade is unlocked.",
    target: "#board-trade-btn",
  },
  {
    title: "End Turn",
    body: "When you are done making choices, end the turn. Other nations act and resources update for the next round.",
    target: "#end-turn-btn",
  },
  {
    title: "Ready",
    body: "That is the new layout. Good luck building your league.",
    target: "#replay-tutorial-btn",
  },
];

export function bindUI(game, renderer, options = {}) {
  return new GameUI(game, renderer, options);
}

class GameUI {
  constructor(game, renderer, options = {}) {
    this.game = game;
    this.renderer = renderer;
    this.multiplayerClient = options.multiplayerClient || null;
    this.victoryShown = false;
    this.militarySelection = null;
    this.tutorial = null;
    this.turnTimeoutInProgress = false;
    this.cacheDom();
    this.scheduleMapResize();
    this.bindEvents();
    this.unsubscribeGame = this.game.on((event) => this.handleGameEvent(event));
    this.render();
    window.setTimeout(() => this.maybeStartTutorial(), 0);
    window.setInterval(() => {
      this.enforceTurnTimer();
      this.renderStatus();
    }, 1000);
  }

  setGame(game) {
    if (this.unsubscribeGame) this.unsubscribeGame();
    this.game = game;
    this.unsubscribeGame = this.game.on((event) => this.handleGameEvent(event));
    this.clearMilitarySelection();
    this.render();
  }

  cacheDom() {
    this.app = document.getElementById("app");
    this.topPanel = document.getElementById("top-panel");
    this.statusStrip = document.getElementById("status-strip");
    this.phaseLabel = document.getElementById("phase-label");
    this.actionCounter = document.getElementById("action-counter");
    this.techTreeBtn = document.getElementById("tech-tree-btn");
    this.leaderboardBtn = document.getElementById("leaderboard-btn");
    this.boardDiplomacyBtn = document.getElementById("board-diplomacy-btn");
    this.boardTradeBtn = document.getElementById("board-trade-btn");
    this.endTurnBtn = document.getElementById("end-turn-btn");
    this.replayTutorialBtn = document.getElementById("replay-tutorial-btn");
    this.resourcePanel = document.getElementById("resource-panel");
    this.tilePopup = document.getElementById("tile-popup");
    this.tilePopupContent = document.getElementById("tile-popup-content");
    this.tileCloseBtn = document.getElementById("tile-close-btn");
    this.tooltip = document.getElementById("tooltip");
    this.dialogBackdrop = document.getElementById("dialog-backdrop");
    this.dialogTitle = document.getElementById("dialog-title");
    this.dialogBody = document.getElementById("dialog-body");
    this.dialogCloseBtn = document.getElementById("dialog-close-btn");
    this.serverErrorDisplay = document.getElementById("server-error-display");
  }

  bindEvents() {
    this.renderer.onSelect = (tileId) => this.handleMapSelect(tileId);
    this.renderer.onHover = (tileId, event) => this.renderTooltip(tileId, event);
    this.tileCloseBtn.addEventListener("click", () => {
      this.clearMilitarySelection();
      this.game.selectTile(null);
    });
    this.endTurnBtn.addEventListener("click", () => {
      if (this.isServerAuthoritative()) {
        this.clearMilitarySelection();
        this.sendPlayerAction({ type: "endTurn" });
        return;
      }
      this.clearMilitarySelection();
      this.game.endTurn();
    });
    this.actionCounter.addEventListener("click", () => this.openActionDialog());
    this.replayTutorialBtn.addEventListener("click", () => this.startTutorial({ replay: true }));
    this.techTreeBtn.addEventListener("click", () => this.openTechDialog());
    this.leaderboardBtn.addEventListener("click", () => this.openLeaderboardDialog());
    this.boardDiplomacyBtn.addEventListener("click", () => this.openDiplomacyDialog());
    this.boardTradeBtn.addEventListener("click", () => this.openTradeRoutesDialog());
    this.dialogCloseBtn.addEventListener("click", () => this.closeDialog());
    this.dialogBody.addEventListener("click", (event) => this.handleTechClick(event));
    this.dialogBody.addEventListener("click", (event) => this.handleDiplomacyClick(event));
    this.tilePopup.addEventListener("click", (event) => this.handleTileClick(event));
  }

  scheduleMapResize() {
    for (const delay of [0, 120, 260]) {
      window.setTimeout(() => {
        const visibility = this.getFogVisibility();
        window.dispatchEvent(new Event("resize"));
        this.renderer.renderState(this.game.map, this.game.nations, this.game.selectedTileId, this.currentMilitaryHighlights(visibility), visibility);
      }, delay);
    }
  }

  handleGameEvent(event) {
    if (event.type === "state_changed" && event.source !== "selection") this.refreshMilitarySelection();
    if (event.type === "action_spent" && event.nationId === this.game.playerId) this.flashActionCounter();
    if (event.type === "unit_animation" && this.isVisibleActionEvent(event)) this.renderer.playMilitaryAction(event);
    if (event.type === "battle_report") {
      if (this.isVisibleActionEvent(event.report)) {
        this.renderer.playBattle(event.report);
        this.renderer.showBattleDelta(event.report);
      }
    }
    if (event.type === "game_over") this.showVictory();
    this.render();
  }

  // Tutorial flow stays local to the UI layer: it reads game state for anchors,
  // highlights existing controls, and only writes completion to localStorage.
  // It does not persist active game progress.
  maybeStartTutorial() {
    if (localStorage.getItem(TUTORIAL_COMPLETED_KEY) === "true") return;
    this.startTutorial();
  }

	  startTutorial({ replay = false } = {}) {
	    if (this.tutorial) this.closeTutorial({ markComplete: false, restorePanels: false });
	    this.tutorial = {
	      index: 0,
      replay,
      overlay: this.createTutorialOverlay(),
      highlighted: null,
    };
    document.body.append(this.tutorial.overlay);
    document.body.classList.add("tutorial-active");
    this.showTutorialStep(0);
  }

  createTutorialOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "tutorial-overlay";
    overlay.innerHTML = `
      <div class="tutorial-scrim" aria-hidden="true"></div>
      <section class="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <div class="tutorial-step-count"></div>
        <h2 id="tutorial-title"></h2>
        <p id="tutorial-body"></p>
        <div class="tutorial-actions">
          <button type="button" class="secondary-btn" data-tutorial-action="skip">Skip tutorial</button>
          <button type="button" class="secondary-btn" data-tutorial-action="back">Back</button>
          <button type="button" class="primary-btn" data-tutorial-action="next">Next</button>
        </div>
      </section>
    `;
    overlay.addEventListener("click", (event) => this.handleTutorialClick(event));
    return overlay;
  }

  handleTutorialClick(event) {
    const button = event.target.closest("[data-tutorial-action]");
    if (!button || !this.tutorial) return;
    const action = button.dataset.tutorialAction;
    if (action === "skip") {
      this.closeTutorial({ markComplete: true });
      return;
    }
    if (action === "back") {
      this.showTutorialStep(this.tutorial.index - 1);
      return;
    }
    if (this.tutorial.index >= TUTORIAL_STEPS.length - 1) {
      this.closeTutorial({ markComplete: true });
      return;
    }
    this.showTutorialStep(this.tutorial.index + 1);
  }

  showTutorialStep(index) {
    if (!this.tutorial) return;
    const nextIndex = Math.max(0, Math.min(index, TUTORIAL_STEPS.length - 1));
    const step = TUTORIAL_STEPS[nextIndex];
    this.tutorial.index = nextIndex;
    this.prepareTutorialStep(step);
    this.clearTutorialHighlight();

    const overlay = this.tutorial.overlay;
    overlay.querySelector(".tutorial-step-count").textContent = `Step ${nextIndex + 1} of ${TUTORIAL_STEPS.length}`;
    overlay.querySelector("#tutorial-title").textContent = step.title;
    overlay.querySelector("#tutorial-body").textContent = step.body;
    overlay.querySelector("[data-tutorial-action='back']").disabled = nextIndex === 0;
    overlay.querySelector("[data-tutorial-action='next']").textContent = nextIndex === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next";

    const target = document.querySelector(step.target);
    if (target && !target.hidden) {
      target.classList.add("tutorial-highlight");
      this.tutorial.highlighted = target;
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  prepareTutorialStep(step) {
    if (step.prepare !== "selectPlayerTile") return;
    const visibility = this.getFogVisibility();
    const tile = this.game.tiles.find((item) => item.ownerId === this.game.playerId && isLand(item) && this.isTileVisible(item.id, visibility));
    if (!tile) return;
    this.game.selectTile(tile.id);
    this.renderer.focusTile(tile.id);
  }

  clearTutorialHighlight() {
    if (!this.tutorial?.highlighted) return;
    this.tutorial.highlighted.classList.remove("tutorial-highlight");
    this.tutorial.highlighted = null;
  }

	  closeTutorial({ markComplete = true, restorePanels = true } = {}) {
	    if (!this.tutorial) return;
	    this.clearTutorialHighlight();
    this.tutorial.overlay.remove();
	    this.tutorial = null;
	    document.body.classList.remove("tutorial-active");
	    if (markComplete) localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
	  }

	  render() {
	    const visibility = this.getFogVisibility();
	    if (this.renderer?.hoveredTileId && !this.isTileVisible(this.renderer.hoveredTileId, visibility)) {
	      this.renderer.hoveredTileId = null;
	      this.tooltip.hidden = true;
	    }
	    if (this.game.selectedTileId && !this.isTileVisible(this.game.selectedTileId, visibility)) {
	      this.game.selectedTileId = null;
	      this.clearMilitarySelection();
	    }
	    this.renderStatus();
	    this.renderResources();
	    this.refreshBoardDialogs();
	    this.refreshTechDialog();
	    this.renderTilePopup(visibility);
	    this.renderer.renderState(this.game.map, this.game.nations, this.game.selectedTileId, this.currentMilitaryHighlights(visibility), visibility);
    if (this.game.gameOver) this.showVictory();
  }

  handleMapSelect(tileId) {
    if (this.game.isProcessingTurn || this.game.gameOver) return;
    const visibility = this.getFogVisibility();
    if (tileId && !this.isTileVisible(tileId, visibility)) return;

    const currentAction = tileId ? this.militarySelection?.targetActions.get(tileId) : null;
    if (currentAction) {
      const sourceTileId = this.militarySelection.sourceTileId;
      this.clearMilitarySelection();
      const stillValid = this.game
        .getValidMilitaryActionsFromTile(sourceTileId, this.game.playerId)
        .actions.some((action) => action.toTileId === tileId && action.action === currentAction.action);
      if (!stillValid) {
        this.render();
        return;
      }
      if (this.isServerAuthoritative()) {
        const payload = {
          nationId: this.game.playerId,
          fromTileId: sourceTileId,
          toTileId: tileId,
        };
        if (currentAction.action === "attack") this.multiplayerClient.attack(payload);
        else this.sendPlayerAction({ type: "moveOrAttackUnit", fromTileId: sourceTileId, toTileId: tileId });
        this.game.selectTile(tileId);
        this.renderer.focusTile(tileId);
        this.render();
        return;
      }
      const result = this.game.moveOrAttackUnit(sourceTileId, tileId, this.game.playerId);
      if (result.ok) {
        this.game.selectTile(tileId);
        this.renderer.focusTile(tileId);
      } else {
        this.showNotice("Action blocked", result.reason);
      }
      this.render();
      return;
    }

    const nextMilitarySelection = this.createMilitarySelection(tileId, visibility);
    this.militarySelection = nextMilitarySelection;
    this.game.selectTile(tileId);
    if (tileId) this.renderer.focusTile(tileId);
  }

  createMilitarySelection(tileId, visibility = this.getFogVisibility()) {
    if (!tileId || !this.isTileVisible(tileId, visibility)) return null;
    const actions = this.filterMilitaryActions(this.game.getValidMilitaryActionsFromTile(tileId, this.game.playerId), visibility);
    if (!actions?.actions.length) return null;
    return {
      sourceTileId: tileId,
      actions,
      targetActions: new Map(actions.actions.map((action) => [action.toTileId, action])),
    };
  }

  refreshMilitarySelection() {
    if (!this.militarySelection) return;
    this.militarySelection = this.createMilitarySelection(this.militarySelection.sourceTileId);
  }

  clearMilitarySelection() {
    this.militarySelection = null;
  }

  currentMilitaryHighlights(visibility = this.getFogVisibility()) {
    if (!this.militarySelection || !this.isTileVisible(this.militarySelection.sourceTileId, visibility)) return null;
    return {
      sourceTileId: this.militarySelection.sourceTileId,
      moveTargets: this.militarySelection.actions.moveTargets.filter((entry) => this.isTileVisible(entry.toTileId, visibility)),
      attackTargets: this.militarySelection.actions.attackTargets.filter((entry) => this.isTileVisible(entry.toTileId, visibility)),
    };
  }

  getFogVisibility() {
    return this.game.fogOfWarVisibilityFor(this.game.playerId);
  }

  isTileVisible(tileId, visibility = this.getFogVisibility()) {
    return !visibility || visibility.visibleTileIds.has(tileId);
  }

  isVisibleActionEvent(event, visibility = this.getFogVisibility()) {
    const tileIds = [event?.fromTileId, event?.targetTileId, event?.tileId].filter(Boolean);
    if (!tileIds.length) return true;
    return tileIds.every((tileId) => this.isTileVisible(tileId, visibility));
  }

  filterMilitaryActions(actions, visibility = this.getFogVisibility()) {
    if (!actions) return null;
    const sourceVisible = this.isTileVisible(actions.fromTileId, visibility);
    if (!sourceVisible) return null;
    const moveTargets = actions.moveTargets.filter((entry) => this.isTileVisible(entry.toTileId, visibility));
    const attackTargets = actions.attackTargets.filter((entry) => this.isTileVisible(entry.toTileId, visibility));
    const filtered = {
      ...actions,
      moveTargets,
      attackTargets,
      actions: actions.actions.filter((entry) => this.isTileVisible(entry.toTileId, visibility)),
    };
    return filtered.actions.length ? filtered : null;
  }

  isServerAuthoritative() {
    return Boolean(this.game.serverAuthoritative && this.multiplayerClient?.room);
  }

  sendPlayerAction(payload) {
    const nationId = this.game.playerId;
    const nation = this.game.nations[nationId];
    if (!nation || nation.bot || nation.controllerType === "bot") {
      this.showNotice("Action blocked", "You do not control that nation.");
      return;
    }
    if (this.isServerAuthoritative() && !this.isPlayersTurn()) {
      this.showNotice("Waiting", "It is not your turn yet.");
      return;
    }
    this.multiplayerClient.sendPlayerAction({ ...payload, nationId });
  }

  renderStatus() {
    const player = this.game.player;
    const waitingForTurn = this.isServerAuthoritative() && !this.isPlayersTurn();
    this.phaseLabel.textContent = phaseLabel(this.game.phase, this.game.isProcessingTurn);
    this.endTurnBtn.disabled = this.game.isProcessingTurn || Boolean(this.game.gameOver) || waitingForTurn;
    this.endTurnBtn.textContent = waitingForTurn ? "Waiting" : "End Turn";
    this.renderActionCounter();
    const turnLimit = this.game.settings.unlimitedMode ? "Unlimited" : `${this.game.turn}/${this.game.settings.maxTurns}`;
    const statusPills = [
      pill(player.name),
      pill(eraLabel(this.game.era)),
      pill(`Turn ${turnLimit}`),
      pill(this.game.settings.fogOfWarEnabled ? "Fog On" : "Fog Off"),
      pill(`Money $${formatNumber(player.money)}`),
      pill(`Pop ${formatNumber(player.population.total)} (${formatNumber(player.population.available)} free)`),
      pill(`Happy ${formatNumber(populationHappiness(player))} ${happinessBand(player).label}`),
    ];
    const timerText = this.turnTimerText();
    if (timerText) statusPills.push(pill(timerText));
    for (const event of activeEventSummaries(this.game).slice(0, 2)) {
      statusPills.push(pill(`${event.name}: ${event.duration}T`));
    }
    this.statusStrip.innerHTML = statusPills.join("");
  }

  enforceTurnTimer() {
    if (this.turnTimeoutInProgress || this.isServerAuthoritative()) return;
    if (!this.isTurnTimerExpired()) return;
    this.turnTimeoutInProgress = true;
    this.clearMilitarySelection();
    Promise.resolve(this.game.missTurn(this.game.playerId, "Turn timer expired."))
      .finally(() => {
        this.turnTimeoutInProgress = false;
      });
  }

  isTurnTimerExpired() {
    const limit = Number(this.game.settings.turnTimerMinutes || this.game.settings.timeLimitMinutes || 0);
    if (limit <= 0 || this.game.gameOver || this.game.isProcessingTurn || this.game.phase !== "player") return false;
    if (this.isServerAuthoritative() && !this.isPlayersTurn()) return false;
    const elapsed = Math.floor((Date.now() - (this.game.turnStartedAt || Date.now())) / 1000);
    return elapsed >= limit * 60;
  }

  activeTurnNationId() {
    const seats = this.game.seats || [];
    const index = Math.max(0, Math.min(seats.length - 1, Number(this.game.currentTurnIndex) || 0));
    return seats[index]?.nationId || this.game.playerId;
  }

  isPlayersTurn() {
    return !this.isServerAuthoritative() || this.activeTurnNationId() === this.game.playerId;
  }

	  renderActionCounter() {
	    if (!this.actionCounter) return;
	    const player = this.game.player;
	    const remaining = Math.max(0, Number(player.actionPoints ?? player.actionsRemaining) || 0);
	    const used = Math.max(0, Number(player.actionsUsedThisTurn) || 0);
	    this.actionCounter.textContent = String(remaining);
	    this.actionCounter.title = `${remaining} action points left. ${used} used this turn.`;
	    this.actionCounter.setAttribute("aria-label", `${remaining} action points left`);
	    this.actionCounter.classList.toggle("no-actions", remaining <= 0);
	  }

	  renderActionSummaryHtml() {
	    const player = this.game.player;
	    const remaining = Math.max(0, Number(player.actionPoints ?? player.actionsRemaining) || 0);
	    const used = Math.max(0, Number(player.actionsUsedThisTurn) || 0);
    const nextAction = this.militarySelection
      ? `Choose a highlighted tile to move or attack from ${this.militarySelection.sourceTileId}.`
      : this.game.selectedTileId
        ? "Use tile controls, choose a military target, or inspect another tile."
        : "Select a tile or end the turn when ready.";
    const activeEvents = activeEventSummaries(this.game);
	    return `
	      <div class="metric-grid">
	        ${metric("Available", remaining)}
	        ${metric("Used", used)}
	      </div>
	      <p class="${remaining <= 0 ? "bad" : "muted"}">${escapeHtml(nextAction)}</p>
        ${activeEvents.length ? `<div class="summary-row"><strong>Active Events</strong>${activeEvents.map((event) => `<div class="muted">${escapeHtml(event.name)}: ${escapeHtml(event.effect)} ${event.duration} turn${event.duration === 1 ? "" : "s"} left.</div>`).join("")}</div>` : ""}
        ${this.renderTurnSummaryHtml()}
	    `;
	  }

  actionCost(actionType) {
    return BALANCE.actions?.costs?.[actionType] ?? 1;
  }

  canUseAction(actionType) {
    return Math.max(0, Number(this.game.player?.actionPoints ?? this.game.player?.actionsRemaining) || 0) >= this.actionCost(actionType);
  }

  actionDisabledAttribute(actionType, check = { ok: true }) {
    return check.ok && this.canUseAction(actionType) ? "" : "disabled";
  }

  actionDisabledReason(actionType, check = { ok: true }) {
    if (!check.ok) return check.reason || "";
    return this.canUseAction(actionType) ? "" : `Requires ${this.actionCost(actionType)} action point.`;
  }

  actionPreview(actionType, check = { ok: true }, costText = "") {
    const reason = this.actionDisabledReason(actionType, check);
    const actionCost = this.actionCost(actionType);
    const parts = [`${actionCost} AP`, costText].filter(Boolean).join(" · ");
    return `<div class="${reason ? "action-preview blocked" : "action-preview"}">${escapeHtml(parts || "No cost")}${reason ? ` · ${escapeHtml(reason)}` : ""}</div>`;
  }

  renderTurnSummaryHtml() {
    const grouped = new Map();
    for (const entry of (this.game.events || []).slice(-18)) {
      const turn = Number(entry.turn || this.game.turn);
      if (!grouped.has(turn)) grouped.set(turn, []);
      grouped.get(turn).push(entry);
    }
    if (!grouped.size) return "";
    return `
      <div class="summary-row">
        <strong>Turn Log</strong>
        ${[...grouped.entries()].sort((a, b) => b[0] - a[0]).map(([turn, entries]) => `
          <div class="turn-log-group">
            <span class="mini-pill">Turn ${turn}</span>
            ${entries.map((entry) => `<div class="muted ${entry.type === "global_event" ? "warn" : ""}">${escapeHtml(entry.message)}</div>`).join("")}
          </div>
        `).join("")}
      </div>
    `;
  }

  flashActionCounter() {
    if (!this.actionCounter) return;
    this.renderActionCounter();
    this.actionCounter.classList.remove("action-counter-pulse");
    void this.actionCounter.offsetWidth;
    this.actionCounter.classList.add("action-counter-pulse");
    window.clearTimeout(this.actionCounterTimer);
    this.actionCounterTimer = window.setTimeout(() => {
      this.actionCounter.classList.remove("action-counter-pulse");
    }, 520);
  }

  renderResources() {
    const player = this.game.player;
    const flows = this.projectResourceFlows(player);
    const foodClass = flows.food < 0 || player.resources.food + flows.food < 0 ? "bad" : "good";
    const happinessEnabled = this.game.settings.happinessEnabled !== false;
    document.querySelectorAll(".ui-tooltip[data-floating-tooltip='true']").forEach((tooltip) => tooltip.remove());
    this.resourcePanel.innerHTML = `
      ${resourceRow({
        id: "money",
        label: "Money",
        icon: "🪙",
        value: `$${formatNumber(player.money)}`,
        className: flows.moneyNet < 0 ? "bad" : "good",
        note: "Buildings, units, diplomacy",
        rate: `${signed(flows.moneyNet)}/turn`,
        tooltip: `Generated from taxes, trade, and industry. Used for buildings, units, and diplomacy. Current income: ${signed(flows.moneyNet)}/turn${flows.upkeep ? ` after $${formatNumber(flows.upkeep)} war upkeep` : ""}.`,
      })}
      ${resourceRow({
        id: "food",
        label: "Food",
        icon: "🌾",
        value: player.resources.food,
        className: foodClass,
        note: `Produced ${formatNumber(flows.foodProduced)}, consumes ${formatNumber(flows.foodConsumed)}/turn`,
        rate: `${signed(flows.food)}/turn`,
        tooltip: `Produced by farms and fertile land. Consumed by population each turn. Shortages slow or reduce population. Current net food: ${signed(flows.food)}/turn (${formatNumber(flows.foodProduced)} produced, ${formatNumber(flows.foodConsumed)} consumed).`,
      })}
      ${resourceRow({
        id: "materials",
        label: "Materials",
        icon: "⛏️",
        value: player.resources.materials,
        className: flows.materials < 0 ? "bad" : "warn",
        note: "Mining, factories, military",
        rate: `${signed(flows.materials)}/turn`,
        tooltip: `Generated by mines and advanced military infrastructure. Used for buildings, unit training, factories, and military specialization. Current materials flow: ${signed(flows.materials)}/turn.`,
      })}
      ${resourceRow({
        id: "population",
        label: "Population",
        icon: "👥",
        value: player.population.total,
        className: flows.population < 0 ? "bad" : "good",
        note: `${formatNumber(player.population.available)} free people`,
        rate: `${signed(flows.population)}/turn`,
        tooltip: `Population supplies workers and soldiers. It grows when food production beats consumption and territory has capacity. Transportation multiplier: ${formatPercent(transportGrowthMultiplier(player))}. Current projected change: ${signed(flows.population)}/turn. Capacity: ${formatNumber(flows.capacity)} people.`,
      })}
      ${resourceRow({
        id: "happiness",
        label: "Happiness",
        icon: "🙂",
        value: happinessEnabled ? `${formatNumber(populationHappiness(player))}/100` : "Off",
        className: happinessEnabled ? happinessClass(player) : "warn",
        note: happinessEnabled ? `${happinessBand(player).label} · ${formatPercent(happinessBand(player).workRate)} work rate` : "Mechanic disabled",
        rate: happinessEnabled ? happinessRiskText(player) : "No happiness effects",
        tooltip: happinessEnabled
          ? `Happiness reflects food security, upkeep pressure, war, losses, diplomatic stability, and transportation supply chains. ${happinessEffectText(player)}`
          : "Citizen happiness is disabled for this game.",
      })}
      ${resourceRow({
        id: "education",
        label: "Education",
        icon: "📚",
        value: player.resources.education,
        className: flows.education < 0 ? "bad" : "blue",
        note: "Research and factories",
        rate: `${signed(flows.education)}/turn`,
        tooltip: `Generated by schools. Used for research, factories, and advanced military branches. Current education flow: ${signed(flows.education)}/turn.`,
      })}
      ${resourceRow({
        id: "industry",
        label: "Industry",
        icon: "🏭",
        value: player.resources.industry,
        className: "good",
        note: "Factories and branches",
        rate: `${signed(flows.industry)}/turn`,
        tooltip: `Generated by factories when they have enough workers, materials, and education. Used for late-era development and military branches. Current industry flow: ${signed(flows.industry)}/turn.`,
      })}
      ${resourceRow({
        id: "military",
        label: "Military Power",
        icon: "🛡️",
        value: militaryPower(player, this.game.tiles),
        className: "bad",
        note: "Defense and conquest",
        rate: "",
        tooltip: "Military power summarizes trained units, military buildings, and branch bonuses. It helps defend territory and win wars.",
      })}
    `;
    this.resourcePanel.querySelectorAll("[data-tooltip]").forEach((row) => {
      createTooltip(row, row.dataset.tooltip);
    });
  }

  projectResourceFlows(player) {
    const foodFlow = this.game.foodFlowFor(player.id);
    const flows = {
      money: 0,
      moneyNet: 0,
      upkeep: warUpkeep(this.game, player.id),
      food: 0,
      foodProduced: 0,
      foodConsumed: foodFlow.consumed,
      materials: 0,
      education: 0,
      industry: 0,
      population: 0,
      capacity: foodFlow.capacity,
    };
    const available = { ...player.resources };
    const happinessEnabled = this.game.settings.happinessEnabled !== false;
    for (const tile of this.game.tiles.filter((item) => item.ownerId === player.id)) {
      const production = productionForTile(player, tile, this.game.era);
      if (!production) continue;
      if (tile.type === TILE_TYPES.FACTORY) {
        if (available.materials < production.materialsCost || available.education < production.educationCost) {
          flows.money += applyProjectedHappiness(player, 20, happinessEnabled);
          continue;
        }
        available.materials -= production.materialsCost;
        available.education -= production.educationCost;
        flows.materials -= production.materialsCost;
        flows.education -= production.educationCost;
      }
      for (const resource of ["food", "materials", "education", "industry"]) {
        if (!production[resource]) continue;
        const produced = applyProjectedHappiness(player, production[resource], happinessEnabled);
        flows[resource] += produced;
        available[resource] += produced;
        if (resource === "food") flows.foodProduced += produced;
      }
      if (production.money) flows.money += applyProjectedHappiness(player, production.money, happinessEnabled);
      if (production.people) flows.population += production.people;
    }
    const trade = projectTradeRouteYield(this.game, player.id);
    flows.money += trade.money;
    flows.food += trade.food;
    flows.foodProduced += trade.food;
    flows.materials += trade.materials;
    flows.education += trade.education;
    flows.industry += trade.industry;
    flows.food -= flows.foodConsumed;
    flows.moneyNet = flows.money - flows.upkeep;
    flows.population += projectedFoodGrowth(this.game, player, flows);
    return flows;
  }

  renderLeaderboardHtml() {
    const happinessText = this.game.settings.happinessEnabled === false
      ? "happiness off"
      : null;
    const scores = this.game.scoreboard();
    return scores.map((entry, index) => {
      const nation = this.game.nations[entry.id];
      const happiness = happinessText || `${formatNumber(populationHappiness(nation))} happiness (${happinessBand(nation).label})`;
      return `
        <div class="nation-row">
          <div class="row-head">
            <strong><span style="color:${nation.color}">■</span> ${escapeHtml(entry.name)}</strong>
            <span class="mini-pill">#${index + 1} ${formatNumber(entry.score)}</span>
          </div>
          <div class="muted">${entry.active ? nation.profile : "Conquered"} · ${entry.territory} tiles · ${entry.population} people · ${entry.military} power · ${happiness}</div>
        </div>
      `;
    }).join("");
  }

  renderSelectionPanel(visibility = this.getFogVisibility()) {
    if (!this.selectionPanel) return;
    const tile = this.game.selectedTileId ? this.game.tileById(this.game.selectedTileId) : null;
    if (!tile || !this.isTileVisible(tile.id, visibility)) {
      this.selectionPanel.innerHTML = `<p class="muted">No tile selected.</p>`;
      return;
    }
    const owner = tile.ownerId ? this.game.nations[tile.ownerId] : null;
    const active = isTileActive(tile);
    const isPlayerTile = tile.ownerId === this.game.playerId;
    const validActions = this.filterMilitaryActions(this.game.getValidMilitaryActionsFromTile(tile.id, this.game.playerId), visibility);
    const actionContext = this.militarySelection?.sourceTileId === tile.id
      ? `${validActions?.moveTargets.length || 0} move targets · ${validActions?.attackTargets.length || 0} attack targets`
      : isPlayerTile
        ? "Player tile"
        : owner
          ? "Foreign territory"
          : "Unowned tile";
    this.selectionPanel.innerHTML = `
      <div class="row-head">
        <strong>${escapeHtml(TILE_LABELS[tile.type] || tile.type)}${tile.isCapital ? " Capital" : ""}</strong>
        <span class="mini-pill">${escapeHtml(tile.q)}, ${escapeHtml(tile.r)}</span>
      </div>
      <div class="metric-grid">
        ${metric("Owner", owner ? owner.name : "Unowned")}
        ${metric("Status", tile.type === TILE_TYPES.WATER ? "Water" : active ? "Active" : "Inactive")}
        ${metric("Biome", biomeLabel(tile))}
        ${metric("Region", tile.regionId || "Sea")}
        ${metric("Context", actionContext)}
      </div>
      ${tile.unit?.strength ? `<div class="metric"><span>Troops</span><strong>${formatNumber(tile.unit.strength)} strength</strong></div>` : ""}
      <p class="muted">Detailed build, worker, and training controls remain on the selected tile popup.</p>
    `;
  }

  renderDiplomacyHtml() {
    if (this.game.era < 2) {
      return `<p class="muted">Diplomacy, trade, and alliances unlock in Era 2.</p>`;
    }
    const rows = this.diplomacyTargetIds().map((id) => {
      const nation = this.game.nations[id];
      if (!nation) return "";
      const diplo = getDiplomacy(this.game, this.game.playerId, id);
      const activeAlliances = this.game.alliances.filter((alliance) => alliance.active && alliance.members.includes(this.game.playerId) && alliance.members.includes(id));
      const war = this.game.wars[`${[this.game.playerId, id].sort().join("|")}`]?.active;
      const route = this.game.tradeRoutes.find((item) => item.status !== "removed" && item.members?.includes(this.game.playerId) && item.members?.includes(id));
      const routeText = route ? `Route ${route.status}${route.status === "disrupted" ? ` until T${route.disruptedUntil}` : ""}` : "No trade route";
      const embargoActive = (diplo.embargoes?.[this.game.playerId] || 0) > this.game.turn;
      return `
        <div class="diplo-row">
          <div class="row-head">
            <strong><span style="color:${nation.color}">■</span> ${escapeHtml(nation.name)}</strong>
            <span class="mini-pill ${war ? "bad" : ""}">${war ? "War" : relationLabel(diplo.relation)} ${diplo.relation}</span>
          </div>
          <div class="muted">${nation.personality} · ${activeAlliances.length ? activeAlliances.map((a) => a.label).join(", ") : "No active alliance"} · ${routeText}</div>
          <div class="row-actions">
            <button class="secondary-btn" data-diplo="trade" data-id="${id}" ${this.actionDisabledAttribute("trade")}>Trade</button>
            <button class="secondary-btn" data-diplo="alliance" data-id="${id}" ${this.actionDisabledAttribute("proposeAlliance")}>Alliance</button>
            <button class="secondary-btn" data-diplo="embargo" data-id="${id}" ${war || embargoActive || !this.canUseAction("embargo") ? "disabled" : ""}>${embargoActive ? "Embargoed" : `Embargo $${BALANCE.trade.embargo.cost}`}</button>
            <button class="danger-btn" data-diplo="war" data-id="${id}" ${this.game.era < 3 || war || !this.canUseAction("declareWar") ? "disabled" : ""}>Declare War</button>
          </div>
        </div>
      `;
    }).join("");
    const allianceRows = this.game.alliances
      .filter((alliance) => alliance.active && alliance.members.includes(this.game.playerId))
      .map((alliance) => `
        <div class="diplo-row">
          <div class="row-head"><strong>${escapeHtml(alliance.label)}</strong><span class="mini-pill">Ends T${alliance.expiresTurn}</span></div>
          <button class="secondary-btn" data-diplo="break" data-id="${alliance.id}" ${this.actionDisabledAttribute("breakAlliance")}>Break Agreement</button>
        </div>
      `).join("");
    return rows + (allianceRows ? `<hr />${allianceRows}` : "");
  }

  diplomacyTargetIds() {
    return Object.values(this.game.nations)
      .filter((nation) => nation.id !== this.game.playerId && nation.active)
      .map((nation) => nation.id);
  }

  renderTradeRoutesHtml() {
    if (this.game.era < 2) {
      return `<p class="muted">Trade unlocks in Era 2.</p>`;
    }
    const yieldInfo = projectTradeRouteYield(this.game, this.game.playerId);
    const yieldParts = ["money", "food", "materials", "education", "industry"]
      .filter((resource) => yieldInfo[resource])
      .map((resource) => `${signed(yieldInfo[resource])} ${resource}`)
      .join(" · ");
    const routeRows = this.game.tradeRoutes
      .filter((route) => route.status !== "removed" && route.members?.includes(this.game.playerId))
      .map((route) => {
        const partnerId = route.members.find((id) => id !== this.game.playerId);
        const partner = this.game.nations[partnerId];
        return `
          <div class="trade-row">
            <div class="row-head">
              <strong>${escapeHtml(partner?.name || "Unknown partner")}</strong>
              <span class="mini-pill">${escapeHtml(route.status)}</span>
            </div>
            <div class="muted">${route.status === "disrupted" ? `Disrupted until turn ${route.disruptedUntil}.` : "Route is available this turn."}</div>
          </div>
        `;
      }).join("");
    return `
      <div class="trade-row">
        <div class="row-head"><strong>Projected Yield</strong><span class="mini-pill">${escapeHtml(yieldParts || "No active yield")}</span></div>
      </div>
      ${routeRows || `<p class="muted">No player trade routes yet. Use Diplomacy to propose trades.</p>`}
    `;
  }

  renderTechTreeHtml() {
    const player = this.game.player;
    const categoryRows = Object.entries(TECH_CATEGORIES).map(([id, config]) => {
      const check = canResearch(this.game, player, id);
      const tier = player.tech[id] || 0;
      const cost = researchCost(id, tier);
      const transportDetails = id === "infrastructure" ? `<div class="muted">${escapeHtml(transportTechSummary(player, tier))}</div>` : "";
      return `
        <div class="tech-row">
          <div class="row-head">
            <strong>${config.label}</strong>
            <span class="mini-pill">Tier ${tier}/4</span>
          </div>
          <div class="muted">${escapeHtml(config.description)} Cost: $${formatNumber(cost)}.</div>
          ${transportDetails}
          <button class="secondary-btn" data-tech="${id}" ${this.actionDisabledAttribute("researchTech", check)} title="${escapeHtml(this.actionDisabledReason("researchTech", check))}">
            Research
          </button>
          ${check.ok && this.canUseAction("researchTech") ? "" : `<div class="muted">${escapeHtml(this.actionDisabledReason("researchTech", check))}</div>`}
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
          <button class="secondary-btn" data-branch="${id}" ${this.actionDisabledAttribute("researchBranch", check)} title="${escapeHtml(this.actionDisabledReason("researchBranch", check))}">Specialize</button>
          ${check.ok && this.canUseAction("researchBranch") ? "" : `<div class="muted">${escapeHtml(this.actionDisabledReason("researchBranch", check))}</div>`}
        </div>
      `;
    }).join("");
    return categoryRows + `<div class="tech-row"><strong>Era 4 Branches</strong></div>` + branchRows;
  }

	  openTechDialog() {
	    this.openDialog("Tech Tree", this.renderTechTreeHtml());
	  }
	
	  openActionDialog() {
	    this.openDialog("Actions", this.renderActionSummaryHtml());
	  }
	
	  openLeaderboardDialog() {
	    this.openDialog("Nation Leaderboard", this.renderLeaderboardHtml());
  }

  openDiplomacyDialog() {
    this.openDialog("Diplomacy", this.renderDiplomacyHtml());
  }

  openTradeRoutesDialog() {
    this.openDialog("Trade", this.renderTradeRoutesHtml());
  }

  refreshBoardDialogs() {
    if (this.dialogBackdrop.hidden) return;
    if (this.dialogTitle.textContent === "Actions") this.dialogBody.innerHTML = this.renderActionSummaryHtml();
    if (this.dialogTitle.textContent === "Nation Leaderboard") this.dialogBody.innerHTML = this.renderLeaderboardHtml();
    if (this.dialogTitle.textContent === "Diplomacy") this.dialogBody.innerHTML = this.renderDiplomacyHtml();
    if (this.dialogTitle.textContent === "Trade") this.dialogBody.innerHTML = this.renderTradeRoutesHtml();
  }

  refreshTechDialog() {
    if (this.dialogBackdrop.hidden || this.dialogTitle.textContent !== "Tech Tree") return;
    this.dialogBody.innerHTML = this.renderTechTreeHtml();
  }

  renderTilePopup(visibility = this.getFogVisibility()) {
    const tile = this.game.selectedTileId ? this.game.tileById(this.game.selectedTileId) : null;
    if (!tile || !this.isTileVisible(tile.id, visibility)) {
      this.tilePopup.hidden = true;
      this.tilePopup.classList.remove("military-targeting");
      return;
    }
    this.tilePopup.hidden = false;
    const isMilitaryTargeting = this.militarySelection?.sourceTileId === tile.id;
    this.tilePopup.classList.toggle("military-targeting", isMilitaryTargeting);
    if (isMilitaryTargeting) {
      this.tilePopup.style.top = "auto";
      this.tilePopup.style.bottom = "12px";
      this.tilePopup.style.maxHeight = "220px";
    } else {
      this.tilePopup.style.removeProperty("top");
      this.tilePopup.style.removeProperty("bottom");
      this.tilePopup.style.removeProperty("max-height");
    }
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
        ${metric("Biome", biomeLabel(tile))}
        ${metric("Status", tile.type === TILE_TYPES.WATER ? "Water" : active ? "Active" : "Inactive")}
      </div>
      ${tile.unit?.strength ? `<div class="metric"><span>Troops</span><strong>${tile.unit.strength} strength</strong></div>` : ""}
      ${tile.effects.disabledTurns || tile.effects.floodedTurns ? `<p class="warn">Temporary effect active on this tile.</p>` : ""}
      <div class="row-actions"><button class="secondary-btn" data-tile-action="details">Tile Details</button></div>
      ${buildRows}
      ${workerRows}
      ${militaryRows}
    `;
  }

  renderBuildButtons(tile) {
    const buildableTerrain = isLand(tile) || isWaterLike(tile) || tile.type === TILE_TYPES.MOUNTAIN;
    if (!buildableTerrain) return "";
    const buttons = BUILDING_TYPES.map((type) => {
      const check = this.game.canBuild(tile.id, type, this.game.playerId);
      const cost = buildingCost(type, this.game.era);
      return `<div>${this.actionPreview("buildTile", check, `$${cost}`)}<button class="secondary-btn" data-tile-action="build" data-type="${type}" ${this.actionDisabledAttribute("buildTile", check)} title="${escapeHtml(this.actionDisabledReason("buildTile", check))}">${TILE_LABELS[type]} $${cost}</button></div>`;
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
        ${this.actionPreview("assignWorkers", { ok: true }, `$${workerAdminCost(1)} per worker`)}
        <div class="row-actions">
          <button class="secondary-btn" data-tile-action="workers" data-amount="1" ${this.actionDisabledAttribute("assignWorkers")}>Assign 1</button>
          <button class="secondary-btn" data-tile-action="workers" data-amount="${need || 1}" ${this.actionDisabledAttribute("assignWorkers")}>Fill Minimum</button>
          <button class="secondary-btn" data-tile-action="workers" data-amount="-1" ${this.actionDisabledAttribute("assignWorkers")}>Remove 1</button>
          <button class="danger-btn" data-tile-action="destroy" ${this.actionDisabledAttribute("destroyTile")}>Destroy</button>
        </div>
      </div>
    `;
  }

  renderMilitaryControls(tile) {
    if (tile.type !== TILE_TYPES.MILITARY && !tile.unit?.strength) return "";
    const player = this.game.player;
    const visibility = this.getFogVisibility();
    const train = tile.type === TILE_TYPES.MILITARY
      ? trainingOptionsForNation(player, this.game.era).map((option) => {
          const cost = formatCost(option.cost);
          return `<div>${this.actionPreview("trainUnit", { ok: true }, cost)}<button class="secondary-btn" data-tile-action="train" data-amount="${option.strength}" data-branch="${option.branch}" ${this.actionDisabledAttribute("trainUnit")} title="${escapeHtml(option.description)}">${escapeHtml(option.label)} (${cost})</button></div>`;
        }).join("")
      : "";
    const actions = this.filterMilitaryActions(this.game.getValidMilitaryActionsFromTile(tile.id, this.game.playerId), visibility) || { moveTargets: [], attackTargets: [] };
    const moveCount = actions.moveTargets.length;
    const attackCount = actions.attackTargets.length;
    const targetSummary = tile.unit?.strength
      ? `<div class="row-actions">
          <span class="mini-pill">${escapeHtml(actions.unitTypeLabel)} ${actions.moveRange}/${actions.attackRange}</span>
          <span class="mini-pill">${moveCount} move ${moveCount === 1 ? "target" : "targets"}</span>
          <span class="mini-pill ${attackCount ? "bad" : ""}">${attackCount} attack ${attackCount === 1 ? "target" : "targets"}</span>
        </div>`
      : "";
    return `
      <div class="stack">
        <strong>Military</strong>
        ${targetSummary}
        <div class="row-actions">${train || ""}</div>
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
    if (!tile || !this.isTileVisible(tile.id)) {
      this.tooltip.hidden = true;
      return;
    }
    const owner = tile.ownerId ? this.game.nations[tile.ownerId]?.name : "Unowned";
    this.tooltip.innerHTML = `<strong>${escapeHtml(TILE_LABELS[tile.type])}</strong><br />${escapeHtml(biomeLabel(tile))} · ${escapeHtml(owner)} · ${tile.q}, ${tile.r}`;
    this.tooltip.style.left = `${event.clientX + 14}px`;
    this.tooltip.style.top = `${event.clientY + 14}px`;
    this.tooltip.hidden = false;
  }

  handleTileClick(event) {
    const button = event.target.closest("[data-tile-action]");
    if (!button) return;
    const tileId = this.game.selectedTileId;
    const action = button.dataset.tileAction;
    if (action === "details") {
      this.openTileDetailDialog(tileId);
      return;
    }
    if (this.isServerAuthoritative()) {
      // Multiplayer/server-authoritative logic: UI sends intent only. The
      // Colyseus room validates and mutates, then returns a fresh snapshot.
      if (action === "build") this.sendPlayerAction({ type: "buildTile", tileId, buildingType: button.dataset.type });
      if (action === "workers") this.sendPlayerAction({ type: "assignWorkers", tileId, amount: Number(button.dataset.amount) });
      if (action === "destroy") this.sendPlayerAction({ type: "destroyTile", tileId });
      if (action === "train") this.sendPlayerAction({
        type: "trainUnit",
        tileId,
        strength: Number(button.dataset.amount),
        branch: button.dataset.branch || "infantry",
      });
      if (action === "move" && this.militarySelection?.targetActions.has(button.dataset.target)) {
        this.sendPlayerAction({ type: "moveOrAttackUnit", fromTileId: tileId, toTileId: button.dataset.target });
        this.clearMilitarySelection();
      }
      return;
    }
    // Local/offline logic: solo games keep mutating the local GameState directly.
    let result = null;
    if (action === "build") result = this.game.buildTile(tileId, button.dataset.type);
    if (action === "workers") result = this.game.assignWorkers(tileId, Number(button.dataset.amount));
    if (action === "destroy") result = this.game.destroyTile(tileId);
    if (action === "train") result = this.game.trainUnit(tileId, Number(button.dataset.amount), this.game.playerId, { branch: button.dataset.branch || "infantry" });
    if (action === "move" && this.militarySelection?.targetActions.has(button.dataset.target)) {
      result = this.game.moveOrAttackUnit(tileId, button.dataset.target);
      this.clearMilitarySelection();
    }
    if (result?.ok) this.showActionDeltas(action, tileId, button, result);
    if (result && !result.ok) this.showNotice("Action blocked", result.reason);
    this.render();
  }

  openTileDetailDialog(tileId) {
    const tile = tileId ? this.game.tileById(tileId) : null;
    if (!tile || !this.isTileVisible(tile.id)) {
      this.showNotice("Tile hidden", "That tile is hidden by fog of war.");
      return;
    }
    const owner = tile.ownerId ? this.game.nations[tile.ownerId] : null;
    const production = owner ? productionForTile(owner, tile, this.game.era) : null;
    const resourceText = production
      ? ["money", "food", "materials", "education", "industry", "people"].filter((key) => production[key]).map((key) => `${key}: ${signed(production[key])}/turn`).join(" · ")
      : "No active production";
    const buildCosts = BUILDING_TYPES.map((type) => `${TILE_LABELS[type]} $${formatNumber(buildingCost(type, this.game.era))}`).join(" · ");
    this.openDialog("Tile Details", `
      <div class="metric-grid">
        ${metric("Owner", owner ? owner.name : "Unowned")}
        ${metric("Resource", resourceText)}
        ${metric("Workers", tile.workers)}
        ${metric("Actions", tile.ownerId === this.game.playerId ? "Build, workers, military where valid" : "Inspect only")}
      </div>
      <div class="summary-row"><strong>Costs</strong><div class="muted">${escapeHtml(buildCosts)}</div></div>
    `);
  }

  handleAcceptedPlayerAction(message = {}) {
    const isOwnAction = !message.nationId || message.nationId === this.game.playerId;
    const actionType = normalizeAcceptedActionType(message.type);
    if (!isOwnAction && actionType !== "moveOrAttackUnit" && actionType !== "attack") return;
    const payload = message.payload || {};
    const result = message.result || {};
    if (!result.ok) return;

    if (actionType === "buildTile") {
      this.showActionDeltas("build", payload.tileId, null, result, { buildingType: payload.buildingType });
    } else if (actionType === "assignWorkers") {
      this.showActionDeltas("workers", payload.tileId, null, result);
    } else if (actionType === "destroyTile") {
      this.showActionDeltas("destroy", payload.tileId, null, result);
    } else if (actionType === "trainUnit") {
      this.showActionDeltas("train", payload.tileId, null, result, { amount: payload.strength ?? payload.amount });
    } else if (actionType === "moveOrAttackUnit" || actionType === "attack") {
      const targetTileId = result.targetTileId || payload.toTileId;
      const targetVisible = this.isTileVisible(targetTileId);
      if (isOwnAction && result.cost && targetVisible) this.showResourceDeltas(targetTileId, [{ resource: "money", delta: -result.cost }]);
      if (result.action === "battle" && result.report) {
        if (this.isVisibleActionEvent(result.report)) {
          this.renderer.playBattle(result.report);
          this.renderer.showBattleDelta(result.report);
        }
      } else {
        if (this.isVisibleActionEvent({ fromTileId: result.fromTileId || payload.fromTileId, targetTileId })) {
          this.renderer.playMilitaryAction({
            action: "move",
            nationId: message.nationId,
            unitType: result.unitType,
            fromTileId: result.fromTileId || payload.fromTileId,
            targetTileId,
            path: result.path,
          });
        }
      }
    }
  }

  showActionDeltas(action, tileId, button, result, context = {}) {
    const tile = this.game.tileById(tileId);
    const deltas = [];
    if (action === "build") {
      deltas.push({ resource: "money", delta: -result.cost });
      deltas.push(...this.buildingProductionDeltas(tile, context.buildingType));
    } else if (action === "workers") {
      if (result.cost) deltas.push({ resource: "money", delta: -result.cost });
      deltas.push({ resource: "population", delta: -Math.abs(result.changed) });
    } else if (action === "destroy") {
      deltas.push({ resource: "money", delta: -result.cost });
    } else if (action === "train") {
      deltas.push({ resource: "money", delta: -result.cost.money });
      if (result.cost.materials) deltas.push({ resource: "materials", delta: -result.cost.materials });
      if (result.cost.people) deltas.push({ resource: "population", delta: -result.cost.people });
      deltas.push({ resource: "military", delta: Number(context.amount ?? button?.dataset.amount ?? 0) });
    }
    this.showResourceDeltas(tileId, deltas);
  }

  buildingProductionDeltas(tile, typeOverride = "") {
    if (!tile) return [];
    const player = this.game.player;
    const tileType = typeOverride || tile.type;
    const minWorkers = WORKER_MIN[tileType] || 1;
    const mockTile = { ...tile, type: tileType, workers: minWorkers };
    const production = productionForTile(player, mockTile, this.game.era);
    if (!production) return [];
    const deltas = [];
    for (const resource of ["food", "materials", "education", "industry"]) {
      if (production[resource]) deltas.push({ resource, delta: production[resource], suffix: "/turn" });
    }
    if (production.money) deltas.push({ resource: "money", delta: production.money, suffix: "/turn" });
    if (production.people) deltas.push({ resource: "population", delta: production.people, suffix: "/turn" });
    return deltas;
  }

  showResourceDeltas(tileId, deltas) {
    if (!tileId) return;
    const items = deltas
      .filter((d) => d.delta !== 0)
      .map(({ resource, delta, suffix = "" }) => ({
        text: `${delta > 0 ? "+" : "-"}${resource === "money" ? "$" : ""}${formatNumber(Math.abs(delta))}${suffix}`,
        color: delta > 0 ? "#59c99b" : "#df6c67",
      }));
    this.renderer.showTileResourceDeltas(tileId, items);
  }

  handleDiplomacyClick(event) {
    const button = event.target.closest("[data-diplo]");
    if (!button) return;
    const action = button.dataset.diplo;
    const id = button.dataset.id;
    if (action === "trade") this.openTradeDialog(id);
    if (action === "alliance") this.openAllianceDialog(id);
    if (this.isServerAuthoritative()) {
      if (action === "embargo") this.sendPlayerAction({ type: "embargo", targetId: id });
      if (action === "war") this.sendPlayerAction({ type: "declareWar", targetId: id });
      if (action === "break") this.sendPlayerAction({ type: "breakAlliance", allianceId: id });
      return;
    }
    // Local/offline logic: diplomacy mutates the local GameState directly.
    if (action === "embargo") {
      const result = this.game.embargo(id);
      if (!result.ok) this.showNotice("Embargo blocked", result.reason);
    }
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
      if (this.isServerAuthoritative()) {
        this.sendPlayerAction({ type: "researchTech", category: techButton.dataset.tech });
        return;
      }
      const result = this.game.research(techButton.dataset.tech);
      if (!result.ok) this.showNotice("Research blocked", result.reason);
      if (result.ok) this.refreshTechDialog();
      return;
    }
    const branchButton = event.target.closest("[data-branch]");
    if (branchButton) {
      if (this.isServerAuthoritative()) {
        this.sendPlayerAction({ type: "researchBranch", branch: branchButton.dataset.branch });
        return;
      }
      const result = this.game.researchBranch(branchButton.dataset.branch);
      if (!result.ok) this.showNotice("Specialization blocked", result.reason);
      if (result.ok) this.refreshTechDialog();
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
        if (this.isServerAuthoritative()) {
          this.multiplayerClient.proposeTrade({
            nationId: this.game.playerId,
            partnerId,
            offer: bundle("offer"),
            request: bundle("request"),
          });
          this.closeDialog();
          return;
        }
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
          if (this.isServerAuthoritative()) {
            this.sendPlayerAction({
              type: "proposeAlliance",
              partnerId,
              allianceType: btn.dataset.allianceType,
            });
            this.closeDialog();
            return;
          }
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
        ${metric("Unit Type", report.unitTypeLabel || "Infantry")}
        ${metric("Territory", report.territoryChanged ? "Changed owner" : report.captureAttempt ? "Held" : "Strike only")}
      </div>
      ${report.capitalCaptured ? `<p class="good">Capital captured. The defending nation was conquered.</p>` : ""}
    `);
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
        <button id="victory-new-game" class="primary-btn">Return to Setup</button>
      </div>
    `, () => {
      this.dialogCloseBtn.hidden = true;
      this.dialogBody.querySelector("#victory-new-game").addEventListener("click", () => window.location.reload());
    });
  }

  showNotice(title, message) {
    this.openDialog(title, `<p>${escapeHtml(message || "")}</p>`);
  }

  showServerError(message) {
    const text = String(message || "The multiplayer server reported an error.");
    if (this.serverErrorDisplay) {
      this.serverErrorDisplay.textContent = text;
      this.serverErrorDisplay.hidden = false;
      window.clearTimeout(this.serverErrorTimer);
      this.serverErrorTimer = window.setTimeout(() => {
        this.serverErrorDisplay.hidden = true;
      }, 6000);
    }
    this.showNotice("Server error", text);
  }

  openDialog(title, html, onMount = null) {
    this.dialogTitle.textContent = title;
    this.dialogBody.innerHTML = html;
    this.dialogBackdrop.hidden = false;
    if (!this.game.gameOver) this.dialogCloseBtn.hidden = false;
    if (onMount) onMount();
  }

  closeDialog() {
    if (this.game.gameOver) return;
    this.dialogBackdrop.hidden = true;
    this.dialogBody.innerHTML = "";
    this.dialogCloseBtn.hidden = false;
  }

  turnTimerText() {
    const limit = Number(this.game.settings.turnTimerMinutes || this.game.settings.timeLimitMinutes || 0);
    if (!limit) return "";
    const elapsed = Math.floor((Date.now() - (this.game.turnStartedAt || Date.now())) / 1000);
    const remaining = limit * 60 - elapsed;
    if (remaining <= 0) return "Time expired";
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `Turn timer ${minutes}:${String(seconds).padStart(2, "0")}`;
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

function resourceRow({
  id,
  label,
  icon,
  value,
  className = "",
  note = "",
  rate = "",
  tooltip = "",
}) {
  return `
    <div class="resource-row has-tooltip" data-resource="${escapeHtml(id)}" data-tooltip="${escapeHtml(tooltip)}">
      <div class="resource-main">
        <span class="resource-icon" aria-hidden="true">${icon}</span>
        <div class="resource-copy">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(note)}</span>
        </div>
      </div>
      <div class="resource-value">
        <strong class="${className}">${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong>
        ${rate ? `<span class="${className}">${escapeHtml(rate)}</span>` : ""}
      </div>
    </div>
  `;
}

export function createTooltip(element, content) {
  if (!element || !content) return null;
  const id = `tooltip-${Math.random().toString(36).slice(2)}`;
  element.classList.add("has-tooltip");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-describedby", id);

  const tooltip = document.createElement("div");
  tooltip.id = id;
  tooltip.className = "ui-tooltip";
  tooltip.dataset.floatingTooltip = "true";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  tooltip.textContent = content;
  document.body.append(tooltip);

  const place = () => {
    const rect = element.getBoundingClientRect();
    const margin = 10;
    const width = Math.min(280, window.innerWidth - margin * 2);
    tooltip.style.width = `${width}px`;
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tooltipRect.width - margin, Math.max(margin, rect.right - tooltipRect.width));
    const below = rect.bottom + 7;
    const above = rect.top - tooltipRect.height - 7;
    const top = below + tooltipRect.height + margin <= window.innerHeight ? below : Math.max(margin, above);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const open = () => {
    document.querySelectorAll(".tooltip-open").forEach((item) => {
      if (item !== element) item.classList.remove("tooltip-open");
    });
    document.querySelectorAll(".ui-tooltip.is-visible").forEach((item) => {
      if (item !== tooltip) {
        item.classList.remove("is-visible");
        item.hidden = true;
      }
    });
    tooltip.hidden = false;
    element.classList.add("tooltip-open");
    place();
    tooltip.classList.add("is-visible");
  };
  const close = () => {
    element.classList.remove("tooltip-open");
    tooltip.classList.remove("is-visible");
    tooltip.hidden = true;
  };
  element.addEventListener("pointerenter", open);
  element.addEventListener("pointermove", place);
  element.addEventListener("pointerleave", close);
  element.addEventListener("focus", open);
  element.addEventListener("blur", close);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  element.addEventListener("click", () => {
    open();
    window.setTimeout(() => {
      document.addEventListener("pointerdown", (event) => {
        if (!element.contains(event.target)) close();
      }, { once: true });
    }, 0);
  });
  return tooltip;
}

function populationHappiness(nation) {
  return Math.max(0, Math.min(100, Math.round(Number(nation?.population?.happiness ?? 65))));
}

function happinessBand(nation) {
  const value = populationHappiness(nation);
  const bands = BALANCE.population.happiness?.bands || [];
  return bands.find((band) => value >= band.min) || {
    label: "Content",
    workRate: 1,
    stoppageChance: 0,
    militaryRefusalChance: 0,
  };
}

function happinessClass(nation) {
  const value = populationHappiness(nation);
  if (value >= 65) return "good";
  if (value >= 45) return "warn";
  return "bad";
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function happinessRiskText(nation) {
  const band = happinessBand(nation);
  if (band.stoppageChance || band.militaryRefusalChance) {
    return `${formatPercent(band.stoppageChance)} stoppage · ${formatPercent(band.militaryRefusalChance)} refusal`;
  }
  if (band.workRate < 1) return "Slower work";
  if (band.workRate > 1) return "Bonus work";
  return "Stable";
}

function happinessEffectText(nation) {
  const band = happinessBand(nation);
  return `${band.label} population: ${formatPercent(band.workRate)} work rate, ${formatPercent(band.stoppageChance)} tile stoppage risk, ${formatPercent(band.militaryRefusalChance)} military refusal risk.`;
}

function applyProjectedHappiness(nation, amount, enabled = true) {
  if (amount <= 0) return amount;
  if (!enabled) return amount;
  return Math.max(0, Math.ceil(amount * happinessBand(nation).workRate));
}

function biomeLabel(tile) {
  return BIOME_LABELS[tile?.biome] || (tile?.terrain === "water" ? BIOME_LABELS.water : BIOME_LABELS.grassland);
}

function projectedFoodGrowth(game, player, flows) {
  const stockAfterFood = player.resources.food + flows.food;
  if (stockAfterFood < 0) return -Math.max(1, Math.ceil(Math.abs(stockAfterFood) / BALANCE.population.famineFoodPerDeath));
  if (flows.food < BALANCE.population.growth.minimumFoodSurplus) return 0;
  const headroom = Math.max(0, flows.capacity - player.population.total);
  if (headroom <= 0 || flows.capacity <= 0) return 0;
  const surplusRatio = Math.min(1, flows.food / Math.max(1, flows.foodConsumed));
  const headroomFraction = headroom / flows.capacity;
  const growth = BALANCE.population.growth;
  const baseGrowth =
    surplusRatio >= growth.thrivingSurplusRatio ? growth.thrivingGrowth :
    surplusRatio >= growth.comfortableSurplusRatio ? growth.comfortableGrowth :
    growth.marginalGrowth;
  return Math.round(baseGrowth * headroomFraction * transportGrowthMultiplier(player));
}

function transportTechSummary(player, tier) {
  const current = transportUnlockForTier(tier)?.label || "No transport network";
  const next = transportUnlockForTier(tier + 1);
  const currentEffect = `Current: ${current}, ${formatPercent(transportGrowthMultiplier(player))} population growth multiplier, +${transportHappinessBonus(player)} happiness recovery.`;
  if (!next) return currentEffect;
  return `${currentEffect} Next: ${next.label} in Era ${next.era}.`;
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function formatCost(cost) {
  const parts = [`$${formatNumber(cost.money || 0)}`];
  for (const resource of ["materials", "education", "industry"]) {
    if (cost[resource]) parts.push(`${formatNumber(cost[resource])} ${resource}`);
  }
  if (cost.people) parts.push(`${formatNumber(cost.people)} pop`);
  return parts.join(", ");
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

function normalizeAcceptedActionType(type) {
  return {
    ASSIGN_WORKERS: "assignWorkers",
    BUILD_TILE: "buildTile",
    DESTROY_TILE: "destroyTile",
    TRAIN_UNIT: "trainUnit",
    MOVE_OR_ATTACK_UNIT: "moveOrAttackUnit",
    DECLARE_WAR: "declareWar",
    TRADE: "trade",
    PROPOSE_TRADE: "proposeTrade",
    ACCEPT_TRADE: "acceptTrade",
    REJECT_TRADE: "rejectTrade",
    ATTACK: "attack",
    PROPOSE_ALLIANCE: "proposeAlliance",
    BREAK_ALLIANCE: "breakAlliance",
    EMBARGO: "embargo",
    RESEARCH: "research",
    RESEARCH_TECH: "researchTech",
    RESEARCH_BRANCH: "researchBranch",
    END_TURN: "endTurn",
  }[type] || type;
}
