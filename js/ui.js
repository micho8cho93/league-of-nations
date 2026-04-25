// HUD + tile action panel + tooltip wiring. Phase 7.


function bindUI(state) {
  const resourceEl = document.getElementById("resource-panel");
  const nationPanelEl = document.getElementById("nation-panel");
  const diplomacyPanelEl = document.getElementById("diplomacy-panel");
  const militaryPanelSection = document.getElementById("military-panel-section");
  const warPanelEl = document.getElementById("war-panel");
  const recruitAmountEl = document.getElementById("recruit-amount");
  const recruitBtn = document.getElementById("recruit-btn");
  const tileInfoEl = document.getElementById("tile-info");
  const tooltipEl = document.getElementById("tooltip");
  const feedEl = document.getElementById("feed-content");
  const feedCurrentEl = document.getElementById("feed-current");
  const phaseIndicatorEl = document.getElementById("phase-indicator");
  const statusNationEl = document.getElementById("status-nation");
  const statusStageEl = document.getElementById("status-stage");
  const statusTurnEl = document.getElementById("status-turn");
  const endTurnBtn = document.getElementById("end-turn-btn");
  const summaryPanel = document.getElementById("summary-panel");
  const summaryContentEl = document.getElementById("summary-content");
  const tradeModalEl = document.getElementById("trade-modal");
  const tradeTitleEl = document.getElementById("trade-title");
  const tradeSubtitleEl = document.getElementById("trade-subtitle");
  const tradePreviewEl = document.getElementById("trade-preview");
  const tradeCloseBtn = document.getElementById("trade-close-btn");
  const tradeResetBtn = document.getElementById("trade-reset-btn");
  const tradeSubmitBtn = document.getElementById("trade-submit-btn");
  const stageModalEl = document.getElementById("stage-modal");
  const stageTitleEl = document.getElementById("stage-title");
  const stageSubtitleEl = document.getElementById("stage-subtitle");
  const stageContentEl = document.getElementById("stage-content");
  const stageCloseBtn = document.getElementById("stage-close-btn");
  const stageGovernmentBtn = document.getElementById("stage-government-btn");
  const governmentModalEl = document.getElementById("government-modal");
  const governmentOptionsEl = document.getElementById("government-options");
  const allianceModalEl = document.getElementById("alliance-modal");
  const allianceTitleEl = document.getElementById("alliance-title");
  const allianceSubtitleEl = document.getElementById("alliance-subtitle");
  const allianceCloseBtn = document.getElementById("alliance-close-btn");
  const allianceSubmitBtn = document.getElementById("alliance-submit-btn");
  const alliancePreviewEl = document.getElementById("alliance-preview");
  const allianceInputs = {
    name: document.getElementById("alliance-name"),
    type: document.getElementById("alliance-type"),
    duration: document.getElementById("alliance-duration"),
    shareResources: document.getElementById("term-share"),
    mutualDefense: document.getElementById("term-defense"),
    tradeExclusivity: document.getElementById("term-exclusive"),
  };
  const tradeInputs = {
    offerMoney: document.getElementById("offer-money"),
    offerPeople: document.getElementById("offer-people"),
    requestMoney: document.getElementById("request-money"),
    requestPeople: document.getElementById("request-people"),
  };
  const techModalEl = document.getElementById("tech-modal");
  const techTitleEl = document.getElementById("tech-title");
  const techSubtitleEl = document.getElementById("tech-subtitle");
  const techGridEl = document.getElementById("tech-grid");
  const techCloseBtn = document.getElementById("tech-close-btn");
  const fleetModalEl = document.getElementById("fleet-modal");
  const fleetTitleEl = document.getElementById("fleet-title");
  const fleetSubtitleEl = document.getElementById("fleet-subtitle");
  const fleetGridEl = document.getElementById("fleet-grid");
  const fleetCloseBtn = document.getElementById("fleet-close-btn");
  const victoryModalEl = document.getElementById("victory-modal");
  const victoryBadgeEl = document.getElementById("victory-badge");
  const victoryTitleEl = document.getElementById("victory-title");
  const victorySubtitleEl = document.getElementById("victory-subtitle");
  const awardsGridEl = document.getElementById("awards-grid");
  const victoryStatsEl = document.getElementById("victory-stats");
  const victoryPlayAgainBtn = document.getElementById("victory-play-again");
  const archiveModalEl = document.getElementById("archive-modal");
  const archiveNationSelectEl = document.getElementById("archive-nation-select");
  const archiveSubtitleEl = document.getElementById("archive-subtitle");
  const archiveContentEl = document.getElementById("archive-content");
  const archiveCloseBtn = document.getElementById("archive-close-btn");
  const openArchivesBtn = document.getElementById("open-archives-btn");
  const manualSaveBtn = document.getElementById("manual-save-btn");
  const newGameBtn = document.getElementById("new-game-btn");
  const saveStatusEl = document.getElementById("save-status");
  const starveIndicatorEl = document.getElementById("starve-indicator");
  const tutorialCardEl = document.getElementById("tutorial-card");
  const tutorialTextEl = document.getElementById("tutorial-text");
  const tutorialDismissBtn = document.getElementById("tutorial-dismiss-btn");
  const warDeclareModalEl = document.getElementById("war-declare-modal");
  const warDeclareSubtitleEl = document.getElementById("war-declare-subtitle");
  const warDeclareInfoEl = document.getElementById("war-declare-info");
  const warDeclareCloseBtn = document.getElementById("war-declare-close-btn");
  const warDeclareCancelBtn = document.getElementById("war-declare-cancel-btn");
  const warDeclareConfirmBtn = document.getElementById("war-declare-confirm-btn");
  const warReportModalEl = document.getElementById("war-report-modal");
  const warReportTitleEl = document.getElementById("war-report-title");
  const warReportSubtitleEl = document.getElementById("war-report-subtitle");
  const warReportContentEl = document.getElementById("war-report-content");
  const warReportCloseBtn = document.getElementById("war-report-close-btn");
  const warReportCloseActionBtn = document.getElementById("war-report-close-action-btn");
  const map = state.map;

  let selectedTile = null;
  let tradePartnerId = null;
  let alliancePartnerId = null;
  let warDeclareTargetId = null;

  function hexColor(type) {
    return "#" + TILE_COLORS[type].toString(16).padStart(6, "0");
  }
  function fmtMoney(n) {
    return `$${n.toLocaleString()}`;
  }
  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function ownerLabel(tile) {
    if (!tile.owner) return "Unclaimed";
    const n = state.nations[tile.owner];
    return n ? n.name : tile.owner;
  }
  function setCurrent(message) {
    feedCurrentEl.textContent = message;
  }

  function renderStatus() {
    const n = state.player;
    statusNationEl.innerHTML = `<span class="nation-dot" style="background:${n.color}"></span>${n.name}`;
    const stageLabel = state.stage >= 4
      ? "Modern Era"
      : state.stage >= STAGES.INDUSTRIAL_EXPANSION
        ? "Industrial Expansion"
        : state.stage >= 3
          ? "Industrial Era"
          : state.stage >= 2
            ? "Trade Era"
            : "Foundational Era";
    statusStageEl.textContent = `Stage: ${state.stage} ${stageLabel}`;
    statusTurnEl.textContent = `Turn: ${state.turn}`;
    const needsGovernment = state.stage >= 2 && !n.government;
    endTurnBtn.disabled = state.isProcessingTurn || needsGovernment;
    endTurnBtn.textContent = state.isProcessingTurn
      ? "Bots Thinking..."
      : needsGovernment
        ? "Choose Government"
        : "End Turn →";
    phaseIndicatorEl.textContent = phaseLabel(state.currentPhase);
    if (starveIndicatorEl) {
      const fed = foodCapacity(n);
      const ratio = n.population.total > 0 ? fed / n.population.total : 1;
      starveIndicatorEl.hidden = ratio >= 1;
      starveIndicatorEl.textContent = ratio < 0.8
        ? `CRITICAL FOOD ${fed}/${n.population.total}`
        : `FOOD SHORTAGE ${fed}/${n.population.total}`;
      starveIndicatorEl.classList.toggle("critical", ratio < 0.8);
    }
  }

  function renderResources() {
    const n = state.player;
    const p = n.population;
    const t = n.tiles;
    const active = {
      farms: t.farms.filter(isTileActive).length,
      mines: t.mines.filter(isTileActive).length,
      schools: t.schools.filter(isTileActive).length,
      military: t.militaryBases.filter(isTileActive).length,
    };
    const fed = foodCapacity(n);
    const starveWarn = fed < p.total
      ? `<div class="starve-warn">⚠ Food ${fed}/${p.total} — ${p.total - fed} unfed</div>`
      : "";
    const assignedWorkers = p.farmers + p.miners + p.scholars + p.soldiers;
    const workerNeed = workerNeedForNation(n);
    const workerSurplus = p.available - workerNeed;
    const workerClass = workerSurplus >= 0 ? "good" : "bad";
    resourceEl.innerHTML = `
      <div class="res-row"><span class="label">Money</span><span class="val">${fmtMoney(n.money)}</span></div>
      <div class="res-row"><span class="label">People</span><span class="val">${p.total}</span></div>
      <div class="res-row"><span class="label">Workers</span><span><span class="${workerClass}">${p.available} available / ${workerNeed} needed</span> <span class="muted">(${assignedWorkers} assigned)</span></span></div>
      <div class="res-row"><span class="label">Government</span><span>${governmentLabel(n.government)}</span></div>
      <div class="sub">
        <span>Farmers ${p.farmers}</span>
        <span>Miners ${p.miners}</span>
        <span>Scholars ${p.scholars}</span>
        <span>Soldiers ${p.soldiers}</span>
      </div>
      <hr/>
      <div class="res-row"><span class="label">Food</span><span>${fed} <span class="muted">fed / ${p.total} needed</span></span></div>
      <div class="res-row"><span class="label">Farms</span><span>${t.farms.length} <span class="muted">active ${active.farms}</span></span></div>
      <div class="res-row"><span class="label">Mines</span><span>${t.mines.length} <span class="muted">active ${active.mines}</span></span></div>
      <div class="res-row"><span class="label">Schools</span><span>${t.schools.length} <span class="muted">active ${active.schools}</span></span></div>
      <div class="res-row"><span class="label">Military</span><span>${t.militaryBases.length} <span class="muted">active ${active.military}</span></span></div>
      <div class="res-row"><span class="label">Territory</span><span>${territoryCount(n)} tiles</span></div>
      ${state.stage >= 3 ? renderStage3Resources(n) : ""}
      ${starveWarn}
    `;
  }

  function renderStage3Resources(n) {
    const slots = factorySlots(n);
    const req = state.getFactoryRequirement(n);
    const atWar = n.atWarWith.length > 0;
    const warStatus = atWar
      ? `<div class="res-row"><span class="label" style="color:var(--danger)">⚔ At War</span><span class="bad">${n.atWarWith.map(id => state.nations[id] ? state.nations[id].name : id).join(", ")}</span></div>`
      : "";
    const techList = Object.entries(TECHNOLOGIES)
      .filter(([, tech]) => (n.technologies[tech.field] || 0) > 0)
      .map(([, tech]) => `${tech.label} ×${n.technologies[tech.field]}`)
      .join(", ");
    const fleetList = Object.entries(FLEET_TYPES)
      .filter(([, f]) => (n.technologies[f.field] || 0) > 0)
      .map(([, f]) => `${f.label} ×${n.technologies[f.field]}`)
      .join(", ");
    const victoryInfo = state.stage >= 4
      ? `<div class="res-row"><span class="label muted">Turn Limit</span><span class="muted">${state.turn}/${state.turnLimit}</span></div>`
      : "";
    return `
      <hr/>
      <div class="res-row"><span class="label">Factories</span><span>${n.tiles.factories.length} <span class="muted">(slots: ${slots.available} free / ${slots.total})</span></span></div>
      <div class="res-row"><span class="label">Next Factory</span><span class="${req.canBuild ? "good" : "muted"}">${req.activeMines}/${req.requiredMines} mines · ${req.activeSchools}/${req.requiredSchools} schools</span></div>
      <div class="res-row"><span class="label">Army Strength</span><span>${state.getTotalMilitaryStrength(n)}</span></div>
      ${techList ? `<div class="res-row"><span class="label">Tech</span><span class="small">${techList}</span></div>` : ""}
      ${fleetList ? `<div class="res-row"><span class="label">Fleets</span><span class="small">${fleetList}</span></div>` : ""}
      ${victoryInfo}
      ${warStatus}
    `;
  }

  function renderNationPanel() {
    const rows = Object.values(state.nations).map((n) => {
      const fed = foodCapacity(n);
      const foodClass = fed < n.population.total ? "bad" : "good";
      const gov = state.stage >= 2 ? governmentLabel(n.government) : "Stage 1";
      return `
        <div class="nation-row">
          <div class="nation-main">
            <span class="nation-dot" style="background:${n.color}"></span>
            <span>${n.name}</span>
          </div>
          <div class="nation-meta">
            <span>${n.isBot ? n.personality : "Player"}</span>
            <span>${fmtMoney(n.money)}</span>
            <span class="${foodClass}">Food ${fed}/${n.population.total}</span>
            <span>${gov}</span>
          </div>
        </div>
      `;
    }).join("");
    nationPanelEl.innerHTML = rows;
  }

  function renderDiplomacyPanel() {
    const rows = state.botIds.map((id) => {
      const n = state.nations[id];
      if (!n) return "";
      const d = state.getDiplomacy(id);
      const relationClass = d.relation >= 65 ? "good" : d.relation <= 35 ? "bad" : "";
      const treatyCount = n.treaties.filter((t) => t.type === "trade").length;
      const alliance = activeAllianceWith(id);
      const route = state.getTradeRouteInfo(id);
      const stage2Locked = state.stage < 2;
      const governmentNeeded = state.stage >= 2 && !state.player.government;
      const atWar = state.player.atWarWith.includes(id);
      const warBadge = atWar ? `<span class="tag tag-war">⚔ At War</span>` : "";
      const canDeclare = state.stage >= 3 && !atWar;
      return `
        <div class="diplo-card${atWar ? " diplo-at-war" : ""}">
          <div class="diplo-head">
            <div class="nation-main">
              <span class="nation-dot" style="background:${n.color}"></span>
              <span>${n.name}</span>
              ${warBadge}
            </div>
            <span class="tag ${relationClass === "good" ? "tag-ok" : relationClass === "bad" ? "tag-warn" : ""}">${d.relation}</span>
          </div>
          <div class="diplo-meta">
            <span>${n.personality}</span>
            <span>${governmentLabel(n.government)}</span>
            <span>${fmtMoney(n.money)}</span>
            <span>${n.population.available} avail</span>
            <span>${treatyCount} trades</span>
            <span>${alliance ? `${alliance.name} (expires in ${Math.max(0, alliance.expiresTurn - state.turn)} turns)` : route.reason}</span>
          </div>
          <div class="diplo-actions">
            <button data-trade="${n.id}" ${state.isProcessingTurn || !route.ok ? "disabled" : ""}>Negotiate Trade</button>
            <button data-alliance="${n.id}" ${state.isProcessingTurn || stage2Locked || governmentNeeded || alliance ? "disabled" : ""}>Propose Alliance</button>
            ${canDeclare ? `<button data-war="${n.id}" class="danger-btn" ${state.isProcessingTurn ? "disabled" : ""}>Declare War</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
    diplomacyPanelEl.innerHTML = rows || `<p class="muted">No foreign nations.</p>`;
    diplomacyPanelEl.querySelectorAll("[data-trade]").forEach((btn) => {
      btn.addEventListener("click", () => openTradeModal(btn.getAttribute("data-trade")));
    });
    diplomacyPanelEl.querySelectorAll("[data-alliance]").forEach((btn) => {
      btn.addEventListener("click", () => openAllianceModal(btn.getAttribute("data-alliance")));
    });
    diplomacyPanelEl.querySelectorAll("[data-war]").forEach((btn) => {
      btn.addEventListener("click", () => openWarDeclareModal(btn.getAttribute("data-war")));
    });
  }

  function renderMilitaryPanel() {
    if (!militaryPanelSection || !warPanelEl) return;
    militaryPanelSection.hidden = state.stage < STAGES.INDUSTRIAL;
    if (state.stage < STAGES.INDUSTRIAL) return;

    const bases = state.player.tiles.militaryBases;
    const available = state.player.population.available;
    const hasBase = bases.length > 0;
    if (recruitBtn) {
      recruitBtn.disabled = state.isProcessingTurn || !hasBase || available <= 0;
      recruitBtn.textContent = hasBase ? `Recruit (${available} available)` : "Build a Base First";
    }

    const baseSummary = bases.length
      ? bases.map((base) => `(${base.q}, ${base.r}) ${base.workers || 0}`).join(" · ")
      : "No military bases built.";
    const attackTargets = state.getAttackTargetsForPlayer();
    const groupedTargets = attackTargets.reduce((groups, target) => {
      const id = target.ownerNation?.id || target.tile.owner;
      if (!groups[id]) groups[id] = [];
      groups[id].push(target);
      return groups;
    }, {});

    const enemyRows = state.player.atWarWith.map((enemyId) => {
      const enemy = state.nations[enemyId];
      if (!enemy) return "";
      const targets = groupedTargets[enemyId] || [];
      const cards = targets.length
        ? targets.slice(0, 8).map((target) => warTargetCard(target)).join("")
        : `<p class="muted">No reachable developed targets. Build or staff a base closer to ${enemy.name}.</p>`;
      return `
        <div class="war-enemy">
          <div class="war-enemy-head">
            <span><span class="nation-dot" style="background:${enemy.color}"></span>${enemy.name}</span>
            <span class="tag tag-war">Strength ${state.getTotalMilitaryStrength(enemy)}</span>
          </div>
          <div class="attack-grid">${cards}</div>
        </div>
      `;
    }).join("");

    const declareHint = state.player.atWarWith.length === 0
      ? `<p class="muted">No active wars. Declare war from Diplomacy, then attack from here or from a selected base.</p>`
      : "";

    warPanelEl.innerHTML = `
      <div class="war-overview">
        <div><span class="label">Your Strength</span><strong>${state.getTotalMilitaryStrength(state.player)}</strong></div>
        <div><span class="label">Bases</span><strong>${bases.length}</strong></div>
      </div>
      <p class="muted small">Garrisons: ${baseSummary}</p>
      ${declareHint}
      ${enemyRows}
    `;

    warPanelEl.querySelectorAll("[data-war-attack]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [tq, tr] = btn.getAttribute("data-war-attack").split(",").map(Number);
        const [bq, br] = btn.getAttribute("data-war-base").split(",").map(Number);
        const targetTile = state.map.tileAt(tq, tr);
        const fromBase = state.map.tileAt(bq, br);
        const pay = btn.getAttribute("data-pay");
        if (!targetTile || !fromBase) return;
        const res = state.attackEnemyTile(fromBase, targetTile, pay);
        if (!res.ok) setCurrent(`Attack failed: ${res.reason}.`);
      });
    });
  }

  function warTargetCard(target) {
    const isMilitary = target.tile.type === "military";
    const moveMoney = target.route?.movementMoneyCost || 0;
    const movePeople = target.route?.movementPeopleCost || 0;
    const moneyCost = isMilitary ? moveMoney : 500 + moveMoney;
    const peopleCost = isMilitary ? movePeople : 5 + movePeople;
    const canMoney = !state.isProcessingTurn && state.player.money >= moneyCost;
    const canPeople = !state.isProcessingTurn && peopleCost > 0 && state.player.population.available >= peopleCost;
    const aStr = militaryStrength(state.player, target.fromBase);
    const dStr = isMilitary ? militaryStrength(target.ownerNation, target.tile) : 0;
    const odds = isMilitary ? `${aStr} vs ${dStr}` : `Raid ${aStr}`;
    const movement = target.route?.movementTiles > 0
      ? `${target.route.mode === "naval" ? "Naval" : "March"} ${target.route.movementTiles}`
      : "Adjacent";
    return `
      <div class="attack-card">
        <div><span class="swatch" style="background:${hexColor(target.tile.type)}"></span>${TILE_LABELS[target.tile.type]} at (${target.tile.q}, ${target.tile.r})</div>
        <div class="muted">Base (${target.fromBase.q}, ${target.fromBase.r}) · ${movement} · ${odds}</div>
        <div class="btn-row">
          <button data-war-attack="${target.tile.q},${target.tile.r}" data-war-base="${target.fromBase.q},${target.fromBase.r}" data-pay="money" ${canMoney ? "" : "disabled"}>${isMilitary && moneyCost === 0 ? "Combat" : fmtMoney(moneyCost)}</button>
          ${peopleCost > 0 ? `<button data-war-attack="${target.tile.q},${target.tile.r}" data-war-base="${target.fromBase.q},${target.fromBase.r}" data-pay="people" ${canPeople ? "" : "disabled"}>${peopleCost} ppl</button>` : ""}
        </div>
      </div>
    `;
  }

  function renderSummary() {
    const s = state.lastSummary;
    if (!s) {
      summaryPanel.hidden = true;
      return;
    }
    summaryPanel.hidden = false;
    const parts = [];
    parts.push(`<div class="sum-turn">End of Turn ${s.turn}</div>`);
    parts.push(
      `<div class="sum-row"><span class="label">Food</span><span>${s.fed}/${s.needed}${
        s.unfed > 0 ? ` <span class="bad">(${s.unfed} unfed)</span>` : ""
      }</span></div>`
    );
    if (s.deaths > 0) {
      const where = Object.entries(s.deathsByField)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      parts.push(
        `<div class="sum-row"><span class="label">Deaths</span><span class="bad">−${s.deaths} <span class="muted">(${where})</span></span></div>`
      );
    }
    if (s.grew) {
      parts.push(
        `<div class="sum-row"><span class="label">Growth</span><span class="good">+${s.gainedPeople} ppl, +${fmtMoney(s.gainedMoney)}</span></div>`
      );
      const bd = Object.entries(s.breakdown)
        .filter(([, v]) => v.people || v.money)
        .map(
          ([k, v]) =>
            `<span>${cap(k)} ×${v.active}: +${v.people}p, +${fmtMoney(v.money)}</span>`
        )
        .join("");
      if (bd) parts.push(`<div class="sum-bd">${bd}</div>`);
    } else {
      parts.push(`<div class="sum-row muted">No growth this turn.</div>`);
    }
    const unlockList = s.stageUnlocks || (s.stageUnlock ? [s.stageUnlock] : []);
    for (const u of unlockList) {
      parts.push(`<div class="sum-row"><span class="label">Unlocked</span><span class="good">${u.name}</span></div>`);
    }
    if (s.disaster) {
      const cls = s.disaster.kind === "good_disaster" ? "good" : "bad";
      parts.push(`<div class="disaster-line ${cls}">${s.disaster.disasterType}: ${s.disaster.details}</div>`);
    }
    summaryContentEl.innerHTML = parts.join("");
  }

  function renderTutorial() {
    if (!tutorialCardEl || !state.tutorial || state.tutorial.dismissed || state.tutorial.completed) {
      if (tutorialCardEl) tutorialCardEl.hidden = true;
      return;
    }
    const steps = [
      "Build your first farm: click an empty tile inside or beside your territory, then choose Farm.",
      "Assign workers: select a farm and use +1 or Top up to min so it becomes active.",
      "End the turn: use the End Turn button to let bots act and process growth.",
    ];
    tutorialTextEl.innerHTML = `<strong>Step ${state.tutorial.step + 1} of 3.</strong> ${steps[state.tutorial.step] || steps[2]}`;
    tutorialCardEl.hidden = false;
  }

  function renderEventFeed() {
    const recent = state.events.slice(-7).reverse();
    feedEl.innerHTML = recent.map((event) => {
      const nation = event.nationId ? state.nations[event.nationId] : null;
      const dot = nation
        ? `<span class="feed-dot" style="background:${nation.color}"></span>`
        : `<span class="feed-dot neutral"></span>`;
      const tileAttr = event.tileCoord
        ? ` data-tile-q="${event.tileCoord.q}" data-tile-r="${event.tileCoord.r}" title="Click to jump to tile"`
        : "";
      const clickClass = event.tileCoord ? " feed-tile-link" : "";
      return `
        <div class="feed-item${clickClass}"${tileAttr}>
          ${dot}
          <span class="feed-turn">T${event.turn}</span>
          <span>${event.message}</span>
          ${event.tileCoord ? `<span class="feed-jump">↗</span>` : ""}
        </div>
      `;
    }).join("");
  }

  feedEl.addEventListener("click", (e) => {
    const item = e.target.closest("[data-tile-q]");
    if (!item) return;
    const q = parseInt(item.dataset.tileQ, 10);
    const r = parseInt(item.dataset.tileR, 10);
    if (isNaN(q) || isNaN(r)) return;
    map.focusOn(q, r);
    const tile = map.tileAt(q, r);
    if (tile) {
      map.selectTile(tile);
      selectedTile = tile;
      renderTilePanel(tile);
    }
  });

  function phaseLabel(phase) {
    if (phase === "bots") return "Bot Turns";
    if (phase === "round") return "Round Processing";
    return "Player Turn";
  }

  function territoryCount(n) {
    const t = n.tiles;
    return (
      t.farms.length +
      t.mines.length +
      t.schools.length +
      t.militaryBases.length +
      t.factories.length +
      t.empty.length
    );
  }

  function workerNeedForNation(nation) {
    const staffedTiles = [
      ...nation.tiles.farms,
      ...nation.tiles.mines,
      ...nation.tiles.schools,
      ...nation.tiles.militaryBases,
      ...nation.tiles.factories,
    ];
    return staffedTiles.reduce((sum, tile) => {
      const min = WORKER_MIN[tile.type];
      if (min == null || isTileActive(tile)) return sum;
      return sum + Math.max(0, min - (tile.workers || 0));
    }, 0);
  }

  function activeAllianceWith(partnerId) {
    return state.alliances.find((a) =>
      a.active && a.members.includes(state.playerId) && a.members.includes(partnerId)
    );
  }

  function refreshStrategicMapHighlights() {
    if (!map.updateStrategicHighlights) return;
    const claimableTiles = map.tiles.filter((tile) =>
      !tile.owner && state.canBuildOn(tile, state.player).ok
    );
    map.updateStrategicHighlights(state.playerId, claimableTiles);
  }

  function productionText(tile) {
    if (!isTileActive(tile)) return null;
    switch (tile.type) {
      case "farm": {
        const base = tile.hasTractor ? 40 : 10;
        return (tile.bountifulTurns || 0) > 0 ? `feeds ${base * 2} people next round` : `feeds ${base} people`;
      }
      case "mine": return "mining capacity";
      case "school": return "education capacity";
      case "military": return "defensive capacity";
      case "factory": return "1 tech slot";
      default: return null;
    }
  }

  const BUILD_OPTIONS = [
    { type: "farm", label: "Farm", effect: "Food production", detail: "Needs 2 farmers to feed 10 people." },
    { type: "mine", label: "Mine", effect: "Mining capacity", detail: "Needs 3 miners for industrial progress." },
    { type: "school", label: "School", effect: "Education capacity", detail: "Needs 3 scholars for factory requirements." },
    { type: "military", label: "Military Base", effect: "Defense and attacks", detail: "Needs 4 soldiers; attacks unlock in Stage 3." },
    { type: "factory", label: "Factory", effect: "Technology slot", detail: "Needs 5 scholars; first one requires 2 active mines and 2 active schools." },
  ];

  function buildLockReason(tileCheck, type) {
    if (!tileCheck.ok) return tileCheck.reason;
    if (type === "factory") {
      if (state.stage < STAGES.INDUSTRIAL) return "Unlocks in Stage 3";
      const req = state.getFactoryRequirement(state.player);
      if (!req.canBuild) {
        return `Need ${req.requiredMines} active mines (have ${req.activeMines}) and ${req.requiredSchools} active schools (have ${req.activeSchools})`;
      }
    }
    const capCheck = state._checkResourceCap(state.player, type);
    if (!capCheck.ok) return capCheck.reason;
    return null;
  }

  function buildCardHTML(option, tileCheck) {
    const { type, label, effect, detail } = option;
    const cost = buildCost(state.stage, type);
    const n = state.player;
    const lockReason = buildLockReason(tileCheck, type);
    const blocked = Boolean(lockReason) || state.isProcessingTurn;
    const canMoney = !blocked && n.money >= cost.money;
    const canPeople = !blocked && cost.people != null && n.population.available >= cost.people;
    const moneyHint = n.money >= cost.money ? "Money" : `Need ${fmtMoney(cost.money - n.money)} more`;
    const peopleHint = cost.people == null
      ? "Money only"
      : n.population.available >= cost.people
        ? "People"
        : `Need ${cost.people - n.population.available} more`;
    const status = state.isProcessingTurn
      ? "Wait for turn"
      : lockReason
        ? lockReason
        : "Available to purchase";
    const moneyBtn = `<button data-build="${type}" data-pay="money" ${canMoney ? "" : "disabled"}>${fmtMoney(cost.money)}</button>`;
    const peopleBtn = cost.people != null
      ? `<button data-build="${type}" data-pay="people" ${canPeople ? "" : "disabled"}>${cost.people} ppl</button>`
      : "";
    return `
      <div class="build-card">
        <div class="build-card-head">
          <div class="build-label"><span class="swatch" style="background:${hexColor(type)}"></span>${label}</div>
          <span class="tag ${lockReason || state.isProcessingTurn ? "tag-warn" : "tag-ok"}">${lockReason || state.isProcessingTurn ? "Locked" : "Available"}</span>
        </div>
        <div class="build-effect">${effect}</div>
        <div class="build-detail">${detail}</div>
        <div class="build-status ${lockReason || state.isProcessingTurn ? "bad" : "good"}">${status}</div>
        <div class="build-payments">
          <div>
            <span>${moneyHint}</span>
            ${moneyBtn}
          </div>
          <div>
            <span>${peopleHint}</span>
            ${peopleBtn || `<button disabled>Unavailable</button>`}
          </div>
        </div>
      </div>
    `;
  }

  function renderTilePanel(tile) {
    if (!tile) {
      tileInfoEl.innerHTML = `<p class="muted">Click a tile to inspect or build.</p>`;
      return;
    }
    const isPlayer = tile.owner === state.playerId;
    const check = state.canBuildOn(tile, state.player);
    const min = WORKER_MIN[tile.type];
    const active = min != null ? isTileActive(tile) : null;
    const production = productionText(tile);
    const tileEffect = tile.disabledTurns > 0
      ? `<div class="row"><span class="label">Disaster</span><span class="bad">Inactive ${tile.disabledTurns} turn(s)</span></div>`
      : tile.floodedTurns > 0
        ? `<div class="row"><span class="label">Disaster</span><span class="bad">Flooded ${tile.floodedTurns} turn(s)</span></div>`
        : tile.bountifulTurns > 0
          ? `<div class="row"><span class="label">Event</span><span class="good">Bountiful harvest</span></div>`
          : "";

    let actionsHTML = "";
    const canClaimNatural = !tile.owner && check.ok;
    if (tile.type === "empty" || canClaimNatural) {
      const buildCards = BUILD_OPTIONS.map((option) => buildCardHTML(option, check)).join("");
      const tileStatus = check.ok
        ? `<p class="build-intro good">${isPlayer ? "This tile is in your territory." : canClaimNatural ? "You can claim this natural land by building here." : "You can claim this adjacent tile by building on it."}</p>`
        : `<p class="build-intro bad">Tile locked: ${check.reason}.</p>`;
      actionsHTML = `
        <div class="action-title">Choose Resource for Tile</div>
        ${tileStatus}
        <div class="build-grid">
          ${buildCards}
        </div>
      `;
    } else if (tile.type === TILE_TYPES.WATER) {
      actionsHTML = `<p class="muted">Water — impassable.</p>`;
    } else if (tile.type === TILE_TYPES.UN || tile.type === TILE_TYPES.ISLAND) {
      actionsHTML = `<p class="muted">Uncharted waters — UN territories reveal in Stage 3.2.</p>`;
    } else if (isPlayer && tile.workerType) {
      const field = tile.workerType;
      const avail = state.player.population.available;
      const atMin = tile.workers >= min;
      const recruitSection = tile.type === "military"
        ? `
          <div class="action-title">Recruitment</div>
          <div class="btn-row">
            <button data-act="recruit-base" data-n="4" ${state.isProcessingTurn || avail < 4 ? "disabled" : ""}>Recruit 4</button>
            <button data-act="recruit-base" data-n="10" ${state.isProcessingTurn || avail < 10 ? "disabled" : ""}>Recruit 10</button>
          </div>
        `
        : "";

      let attackSection = "";
      if (tile.type === "military" && state.stage >= 3 && state.player.atWarWith.length > 0) {
        const targets = state.getAttackTargetsForPlayer().filter((t) => t.fromBase === tile);
        if (targets.length > 0) {
          const targetCards = targets.map((t) => {
            const isMilitary = t.tile.type === "military";
            const moveMoney = t.route?.movementMoneyCost || 0;
            const movePeople = t.route?.movementPeopleCost || 0;
            const moneyCost = isMilitary ? moveMoney : 500 + moveMoney;
            const peopleCost = isMilitary ? movePeople : 5 + movePeople;
            const canMoney = !state.isProcessingTurn && state.player.money >= moneyCost;
            const canPeople = !state.isProcessingTurn && peopleCost > 0 && state.player.population.available >= peopleCost;
            const movement = t.route?.movementTiles > 0
              ? `<span class="muted">${t.route.mode === "naval" ? "Naval" : "March"} ${t.route.movementTiles} tile(s)</span>`
              : `<span class="muted">Adjacent</span>`;
            return `
              <div class="attack-card">
                <div><span class="swatch" style="background:${hexColor(t.tile.type)}"></span>${TILE_LABELS[t.tile.type]} <span class="muted">(${t.ownerNation.name})</span></div>
                ${movement}
                <div class="btn-row">
                  <button data-attack-tile="${t.tile.q},${t.tile.r}" data-from-base="${tile.q},${tile.r}" data-pay="money" ${canMoney ? "" : "disabled"}>${isMilitary && moneyCost === 0 ? "Combat" : fmtMoney(moneyCost)}</button>
                  ${peopleCost > 0 ? `<button data-attack-tile="${t.tile.q},${t.tile.r}" data-from-base="${tile.q},${tile.r}" data-pay="people" ${canPeople ? "" : "disabled"}>${peopleCost} ppl</button>` : ""}
                </div>
              </div>
            `;
          }).join("");
          attackSection = `<div class="action-title">Attack Targets</div><div class="attack-grid">${targetCards}</div>`;
        }
      }

      actionsHTML = `
        <div class="action-title">Workers</div>
        <div class="worker-row">
          <span>${cap(field)}: <strong>${tile.workers}</strong> / min ${min}</span>
          <span class="tag ${active ? "tag-ok" : "tag-warn"}">${active ? "Active" : "Inactive"}</span>
        </div>
        <div class="btn-row">
          <button data-act="assign" data-d="-1" ${state.isProcessingTurn || tile.workers <= 0 ? "disabled" : ""}>−1</button>
          <button data-act="assign" data-d="1" ${state.isProcessingTurn || avail < 1 ? "disabled" : ""}>+1</button>
          <button data-act="top-up" ${state.isProcessingTurn || atMin || avail < (min - tile.workers) ? "disabled" : ""}>Top up to min</button>
          <button data-act="clear" ${state.isProcessingTurn || tile.workers <= 0 ? "disabled" : ""}>Remove all</button>
        </div>
        ${recruitSection}
        ${attackSection}
      `;
    } else if (!isPlayer && tile.owner) {
      const owner = state.nations[tile.owner];
      actionsHTML = owner && owner.isBot
        ? `<button class="wide-btn" data-open-trade="${owner.id}" ${state.isProcessingTurn ? "disabled" : ""}>Negotiate with ${owner.name}</button>`
        : `<p class="muted">Foreign territory.</p>`;
    }

    tileInfoEl.innerHTML = `
      <div class="row"><span class="label">Type</span><span><span class="swatch" style="background:${hexColor(tile.type)}"></span>${TILE_LABELS[tile.type]}</span></div>
      <div class="row"><span class="label">Coord</span><span>(${tile.q}, ${tile.r})</span></div>
      <div class="row"><span class="label">Owner</span><span>${ownerLabel(tile)}</span></div>
      ${min != null ? `<div class="row"><span class="label">Workers</span><span>${tile.workers} / min ${min}</span></div>` : ""}
      ${tileEffect}
      ${production ? `<div class="row"><span class="label">Produces</span><span>${production}</span></div>` : ""}
      <div class="actions">${actionsHTML}</div>
    `;

    tileInfoEl.querySelectorAll("[data-build]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-build");
        const pay = btn.getAttribute("data-pay");
        const res = state.buildTile(tile, type, pay);
        setCurrent(res.ok
          ? `Built ${TILE_LABELS[type]} at (${tile.q}, ${tile.r}).`
          : `Cannot build: ${res.reason}.`);
      });
    });
    tileInfoEl.querySelectorAll('[data-act="assign"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number(btn.getAttribute("data-d"));
        const res = state.assignWorkers(tile, d);
        if (!res.ok) setCurrent(`Cannot assign: ${res.reason}.`);
      });
    });
    const topBtn = tileInfoEl.querySelector('[data-act="top-up"]');
    if (topBtn) {
      topBtn.addEventListener("click", () => {
        const need = min - tile.workers;
        if (need <= 0) return;
        const res = state.assignWorkers(tile, need);
        if (!res.ok) setCurrent(`Cannot top up: ${res.reason}.`);
      });
    }
    const clearBtn = tileInfoEl.querySelector('[data-act="clear"]');
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.assignWorkers(tile, -tile.workers);
      });
    }
    tileInfoEl.querySelectorAll('[data-act="recruit-base"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const count = Number(btn.getAttribute("data-n")) || 1;
        const res = state.recruitSoldiers(count, tile);
        setCurrent(res.ok ? `Recruited ${count} soldiers to (${tile.q}, ${tile.r}).` : `Cannot recruit: ${res.reason}.`);
      });
    });
    const tradeBtn = tileInfoEl.querySelector("[data-open-trade]");
    if (tradeBtn) {
      tradeBtn.addEventListener("click", () => openTradeModal(tradeBtn.getAttribute("data-open-trade")));
    }

    tileInfoEl.querySelectorAll("[data-attack-tile]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [tq, tr] = btn.getAttribute("data-attack-tile").split(",").map(Number);
        const [bq, br] = btn.getAttribute("data-from-base").split(",").map(Number);
        const targetTile = state.map.tileAt(tq, tr);
        const fromBase = state.map.tileAt(bq, br);
        const pay = btn.getAttribute("data-pay");
        if (!targetTile || !fromBase) return;
        const res = state.attackEnemyTile(fromBase, targetTile, pay);
        if (!res.ok) setCurrent(`Attack failed: ${res.reason}.`);
      });
    });
  }

  function openTradeModal(partnerId) {
    const partner = state.nations[partnerId];
    if (!partner) return;
    tradePartnerId = partnerId;
    resetTradeInputs();
    tradeTitleEl.textContent = `Trade with ${partner.name}`;
    tradeSubtitleEl.textContent = tradeSubtitle(partnerId);
    setTradeInputLimits(partner);
    tradeModalEl.hidden = false;
    updateTradePreview();
    tradeInputs.offerMoney.focus();
  }

  function closeTradeModal() {
    tradeModalEl.hidden = true;
    tradePartnerId = null;
  }

  function resetTradeInputs() {
    Object.values(tradeInputs).forEach((input) => {
      input.value = "0";
    });
  }

  function setTradeInputLimits(partner) {
    tradeInputs.offerMoney.max = state.player.money;
    tradeInputs.offerPeople.max = state.player.population.available;
    tradeInputs.requestMoney.max = partner.money;
    tradeInputs.requestPeople.max = partner.population.available;
  }

  function currentTradeDraft() {
    return normalizeTradeDraft({
      offer: {
        money: tradeInputs.offerMoney.value,
        people: tradeInputs.offerPeople.value,
      },
      request: {
        money: tradeInputs.requestMoney.value,
        people: tradeInputs.requestPeople.value,
      },
    });
  }

  function updateTradePreview() {
    if (!tradePartnerId) return;
    const partner = state.nations[tradePartnerId];
    const draft = currentTradeDraft();
    const verdict = evaluateTrade(state.player, partner, draft, state.getDiplomacy(tradePartnerId));
    const route = state.getTradeRouteInfo(tradePartnerId);
    const routePayable = state.player.money >= draft.offer.money + route.cost;
    const give = describeBundle(draft.offer) || "nothing";
    const get = describeBundle(draft.request) || "nothing";
    const resultClass = route.ok && routePayable && verdict.ok && verdict.accepted
      ? "good"
      : route.ok && routePayable && verdict.ok
        ? "bad"
        : "muted";
    const shipCostLine = route.cost > 0
      ? `<div class="trade-ship-cost ${routePayable ? "" : "bad"}">⚓ Ship route fee: $${route.cost.toLocaleString()} deducted from your funds${routePayable ? "" : " — insufficient funds"}</div>`
      : "";
    const routeMessage = route.ok && !routePayable
      ? `Insufficient funds — need $${route.cost.toLocaleString()} for shipping on top of your offer.`
      : route.ok
        ? verdict.reason
        : route.reason;
    tradePreviewEl.innerHTML = `
      <div><strong>You offer:</strong> ${give}</div>
      <div><strong>You request:</strong> ${get}</div>
      ${shipCostLine}
      <div class="${resultClass}">${routeMessage}</div>
    `;
    tradeSubmitBtn.disabled = state.isProcessingTurn || !route.ok || !routePayable || !verdict.ok;
  }

  function submitTrade() {
    if (!tradePartnerId) return;
    const partner = state.nations[tradePartnerId];
    const result = state.proposeTrade(tradePartnerId, currentTradeDraft());
    setCurrent(result.reason);
    if (result.accepted) closeTradeModal();
    else {
      tradeSubtitleEl.textContent = tradeSubtitle(tradePartnerId);
      setTradeInputLimits(partner);
      updateTradePreview();
    }
  }

  function tradeSubtitle(partnerId) {
    const partner = state.nations[partnerId];
    const route = state.getTradeRouteInfo(partnerId);
    return `${partner.personality} terms · Relation ${state.getDiplomacy(partnerId).relation} · ${route.reason}`;
  }

  function openStageModal(unlock) {
    stageTitleEl.textContent = `Stage ${unlock.stage}: ${unlock.name}`;
    stageSubtitleEl.textContent = unlock.details;
    if (unlock.stage === 4) {
      stageContentEl.innerHTML = `
        <div class="stage-grid">
          <div><strong>Tank Fleet</strong><span>Unified force of 4 tanks — adds 20 soldier-equivalents to all combat. Costs $1,000 + 1 factory slot. Requires excavator + university.</span></div>
          <div><strong>Naval Fleet</strong><span>4 naval ships unified — enables coastal cross-water attacks from coastal bases. Requires 4 naval ships, excavator, and university.</span></div>
          <div><strong>Victory Conditions</strong><span>Military, Population, Territory, or Score victory. The game ends when a condition is met or turn ${state.turnLimit} passes.</span></div>
        </div>
      `;
      stageGovernmentBtn.hidden = true;
    } else if (unlock.stage === 3) {
      stageContentEl.innerHTML = `
        <div class="stage-grid">
          <div><strong>Factories</strong><span>Build factories using active mines + active schools. First factory needs 2 of each, then 3, then 4. Each provides 1 tech research slot.</span></div>
          <div><strong>Technologies</strong><span>Tractor, Excavator, University, Tank, Naval Ship — each costs 1 factory slot + money.</span></div>
          <div><strong>Warfare</strong><span>Declare war on rival nations. Use military bases to attack adjacent enemy tiles.</span></div>
        </div>
      `;
      stageGovernmentBtn.hidden = true;
    } else if (unlock.stage === STAGES.INDUSTRIAL_EXPANSION) {
      stageContentEl.innerHTML = `
        <div class="stage-grid">
          <div><strong>Build Costs Escalated</strong><span>Your civilization has exhausted easy land. All construction now costs more.</span></div>
          <div><strong>New Cost Table</strong><span>
            Farm: $100 → $300 &nbsp;·&nbsp; Mine: $200 → $400<br>
            School: $200 → $400 &nbsp;·&nbsp; Military: $400 → $500<br>
            Factory: $700 → $1,000
          </span></div>
          <div><strong>Factory Scaling</strong><span>Later factories need stronger industry: 2 active mines/schools, then 3, then 4.</span></div>
          <div><strong>UN Territories</strong><span>Neutral island territories are now visible and claimable, creating a race for new resource land.</span></div>
        </div>
      `;
      stageGovernmentBtn.hidden = true;
    } else {
      stageContentEl.innerHTML = `
        <div class="stage-grid">
          <div><strong>Government</strong><span>Choose democracy, dictatorship, or monarchy.</span></div>
          <div><strong>Alliances</strong><span>Draft written accords with trade, military, or political terms.</span></div>
          <div><strong>Global Trade</strong><span>Non-adjacent trade is available with a $100 ship cost.</span></div>
        </div>
      `;
      stageGovernmentBtn.hidden = Boolean(state.player.government);
    }
    stageModalEl.hidden = false;
  }

  // ---- Tech modal ----

  function openTechModal() {
    const slots = state.getFactorySlots();
    techTitleEl.textContent = "Technology Research";
    techSubtitleEl.textContent = `Factory slots: ${slots.available} available / ${slots.total} total`;
    techGridEl.innerHTML = Object.values(TECHNOLOGIES).map((tech) => {
      const owned = state.player.technologies[tech.field] || 0;
      const canAfford = state.player.money >= tech.cost;
      const hasSlot = slots.available > 0;
      const canResearch = !state.isProcessingTurn && canAfford && hasSlot;
      const ownedBadge = owned > 0 ? `<span class="tag tag-ok">×${owned}</span>` : "";
      return `
        <div class="tech-card ${owned > 0 ? "tech-owned" : ""}">
          <div class="tech-head">
            <span class="tech-label">${tech.label}</span>
            ${ownedBadge}
          </div>
          <div class="tech-effect">${tech.effect}</div>
          <div class="tech-cost">${fmtMoney(tech.cost)} + 1 factory slot</div>
          <button data-research="${tech.id}" ${canResearch ? "" : "disabled"}>${canResearch ? "Research" : !hasSlot ? "No slots" : !canAfford ? `Need ${fmtMoney(tech.cost)}` : "Researched"}</button>
        </div>
      `;
    }).join("");

    techGridEl.querySelectorAll("[data-research]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const techId = btn.getAttribute("data-research");
        const res = state.researchTechnology(techId);
        setCurrent(res.reason);
        if (res.ok) openTechModal();
      });
    });
    techModalEl.hidden = false;
  }

  function closeTechModal() {
    techModalEl.hidden = true;
  }

  // ---- Fleet modal (Stage 4) ----

  function openFleetModal() {
    const slots = state.getFactorySlots();
    fleetTitleEl.textContent = "Fleet Assembly";
    fleetSubtitleEl.textContent = `Factory slots: ${slots.available} available / ${slots.total} total · Requirements are listed per fleet`;
    fleetGridEl.innerHTML = Object.values(FLEET_TYPES).map((fleet) => {
      const owned = state.player.technologies[fleet.field] || 0;
      const canAfford = state.player.money >= fleet.cost;
      const hasSlot = slots.available > 0;
      const meetsReqs = Object.entries(fleet.requires).every(
        ([req, amt]) => (state.player.technologies[req] || 0) >= amt
      );
      const canBuild = !state.isProcessingTurn && canAfford && hasSlot && meetsReqs;
      const ownedBadge = owned > 0 ? `<span class="tag tag-ok">×${owned}</span>` : "";
      const blockReason = !hasSlot ? "No factory slots" : !meetsReqs ? "Missing tech requirements" : !canAfford ? `Need ${fmtMoney(fleet.cost)}` : "";
      return `
        <div class="tech-card ${owned > 0 ? "tech-owned" : ""}">
          <div class="tech-head">
            <span class="tech-label">${fleet.label}</span>
            ${ownedBadge}
          </div>
          <div class="tech-effect">${fleet.effect}</div>
          <div class="tech-cost">${fmtMoney(fleet.cost)} + 1 factory slot</div>
          <button data-fleet="${fleet.id}" ${canBuild ? "" : "disabled"}>${canBuild ? "Assemble" : blockReason || "Assemble"}</button>
        </div>
      `;
    }).join("");

    fleetGridEl.querySelectorAll("[data-fleet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fleetId = btn.getAttribute("data-fleet");
        const res = state.buildFleet(fleetId);
        setCurrent(res.reason);
        if (res.ok) openFleetModal();
      });
    });
    fleetModalEl.hidden = false;
  }

  function closeFleetModal() {
    fleetModalEl.hidden = true;
  }

  // ---- Victory / End-Game screen ----

  function openVictoryModal(gameOver) {
    const { victoryType, winner, awards } = gameOver;
    const isPlayer = winner.id === state.playerId;
    const victoryLabels = {
      military: { label: "Military Victory", emoji: "⚔️", color: "var(--danger)" },
      population: { label: "Population Victory", emoji: "🌱", color: "var(--accent)" },
      territory: { label: "Territory Victory", emoji: "🗺️", color: "var(--gold)" },
      score: { label: "Score Victory", emoji: "📊", color: "var(--gold)" },
    };
    const vl = victoryLabels[victoryType] || { label: "Victory", emoji: "🏆", color: "var(--gold)" };

    victoryBadgeEl.textContent = vl.emoji;
    victoryBadgeEl.style.color = vl.color;
    victoryTitleEl.textContent = isPlayer ? "You Win!" : `${winner.name} Wins`;
    victoryTitleEl.style.color = isPlayer ? "var(--accent)" : "var(--danger)";
    victorySubtitleEl.textContent = `${vl.label} · Turn ${gameOver.turn}`;

    awardsGridEl.innerHTML = awards.map((award) => {
      const isPlayerAward = award.winner.id === state.playerId;
      return `
        <div class="award-card ${isPlayerAward ? "award-player" : ""}">
          <div class="award-emoji">${award.emoji}</div>
          <div class="award-label">${award.label}</div>
          <div class="award-winner">
            <span class="nation-dot" style="background:${award.winner.color}"></span>
            ${award.winner.name}
          </div>
          <div class="award-score muted">${award.desc}: ${award.winnerScore}</div>
        </div>
      `;
    }).join("");

    const allNations = Object.values(state.nations).sort((a, b) => {
      if (a.id === state.playerId) return -1;
      if (b.id === state.playerId) return 1;
      return b.money - a.money;
    });
    victoryStatsEl.innerHTML = `
      <table class="victory-table">
        <thead>
          <tr>
            <th>Nation</th>
            <th>Money</th>
            <th>People</th>
            <th>Tiles</th>
            <th>Farms</th>
            <th>Military</th>
          </tr>
        </thead>
        <tbody>
          ${allNations.map((n) => `
            <tr class="${n.id === winner.id ? "victory-winner-row" : ""}">
              <td><span class="nation-dot" style="background:${n.color}"></span>${n.name}${n.id === state.playerId ? " (You)" : ""}</td>
              <td>${fmtMoney(n.money)}</td>
              <td>${n.population.total}</td>
              <td>${n.tiles.farms.length + n.tiles.mines.length + n.tiles.schools.length + n.tiles.militaryBases.length + n.tiles.factories.length + n.tiles.empty.length}</td>
              <td>${n.tiles.farms.length}</td>
              <td>${n.tiles.militaryBases.length}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    victoryModalEl.hidden = false;
  }

  // ---- Declare War modal ----

  function openWarDeclareModal(targetId) {
    const target = state.nations[targetId];
    if (!target) return;
    warDeclareTargetId = targetId;
    warDeclareSubtitleEl.textContent = `${target.name} · ${target.personality} · Relation ${state.getDiplomacy(targetId).relation}`;
    const targetStr = state.getTotalMilitaryStrength(target);
    const playerStr = state.getTotalMilitaryStrength(null);
    warDeclareInfoEl.innerHTML = `
      <span>Your strength: <strong>${playerStr}</strong></span>
      <span class="muted"> vs </span>
      <span>${target.name} strength: <strong>${targetStr}</strong></span>
      ${playerStr < targetStr ? `<span class="bad"> ⚠ Enemy is stronger!</span>` : `<span class="good"> ✓ You have military advantage.</span>`}
    `;
    warDeclareModalEl.hidden = false;
  }

  function closeWarDeclareModal() {
    warDeclareModalEl.hidden = true;
    warDeclareTargetId = null;
  }

  function submitWarDeclare() {
    if (!warDeclareTargetId) return;
    const res = state.declareWar(warDeclareTargetId);
    setCurrent(res.reason);
    if (res.ok) closeWarDeclareModal();
  }

  // ---- War report modal ----

  function openWarReportModal(report) {
    const isVictory = report.attackerWins;
    const title = report.type === "military_combat"
      ? (isVictory ? "Victory!" : "Defeated!")
      : "Tile Destroyed!";
    warReportTitleEl.textContent = title;
    warReportTitleEl.style.color = isVictory ? "var(--accent)" : "var(--danger)";

    if (report.type === "military_combat") {
      warReportSubtitleEl.textContent = `${report.attackerName} vs ${report.defenderName} at ${report.coord}`;
      const attackerFleetText = report.attackerFleetsLost > 0 ? `, ${report.attackerFleetsLost} tank fleets` : "";
      const defenderFleetText = report.defenderFleetsLost > 0 ? `, ${report.defenderFleetsLost} tank fleets` : "";
      const movementCost = report.moneyCost > 0 ? fmtMoney(report.moneyCost) : report.peopleCost > 0 ? `${report.peopleCost} people` : "None";
      warReportContentEl.innerHTML = `
        <div class="war-stat-grid">
          <div class="war-stat"><span class="label">Your Strength</span><span>${report.aStr}</span></div>
          <div class="war-stat"><span class="label">Enemy Strength</span><span>${report.dStr}</span></div>
          <div class="war-stat"><span class="label">Remainder</span><span>${report.remainder}</span></div>
          <div class="war-stat"><span class="label">Outcome</span><span class="${isVictory ? "good" : "bad"}">${isVictory ? "Victory" : "Defeat"}</span></div>
          <div class="war-stat"><span class="label">Your Casualties</span><span class="${report.attackerCasualties > 0 ? "bad" : "good"}">${report.attackerCasualties} soldiers${report.attackerTanksLost > 0 ? `, ${report.attackerTanksLost} tanks` : ""}${attackerFleetText}</span></div>
          <div class="war-stat"><span class="label">Enemy Casualties</span><span class="good">${report.defenderCasualties} soldiers${report.defenderTanksLost > 0 ? `, ${report.defenderTanksLost} tanks` : ""}${defenderFleetText}</span></div>
          <div class="war-stat"><span class="label">Tiles Destroyed</span><span class="${report.tilesDestroyed > 0 ? "good" : "muted"}">${report.tilesDestroyed}</span></div>
          <div class="war-stat"><span class="label">Tiles Captured</span><span class="${report.tilesCaptured > 0 ? "good" : "muted"}">${report.tilesCaptured || 0}</span></div>
          <div class="war-stat"><span class="label">Tiles Lost</span><span class="${report.tilesLost > 0 ? "bad" : "muted"}">${report.tilesLost}</span></div>
          <div class="war-stat"><span class="label">Movement</span><span>${report.movementTiles > 0 ? `${report.movementTiles} tile(s)` : "Adjacent"}</span></div>
          <div class="war-stat"><span class="label">Movement Cost</span><span>${movementCost}</span></div>
        </div>
        ${report.note ? `<div class="war-note">${report.note}</div>` : ""}
      `;
    } else {
      warReportSubtitleEl.textContent = `${report.attackerName} attacked ${report.defenderName}'s ${report.tileType}`;
      warReportContentEl.innerHTML = `
        <div class="war-stat-grid">
          <div class="war-stat"><span class="label">Tile Captured</span><span class="good">${report.tileType} at ${report.coord}</span></div>
          <div class="war-stat"><span class="label">Cost</span><span>${report.moneyCost > 0 ? fmtMoney(report.moneyCost) : `${report.peopleCost} people`}</span></div>
          <div class="war-stat"><span class="label">Movement</span><span>${report.movementTiles > 0 ? `${report.movementTiles} tile(s) ${report.movementMode}` : "Adjacent"}</span></div>
        </div>
      `;
    }
    warReportModalEl.hidden = false;
  }

  function closeWarReportModal() {
    warReportModalEl.hidden = true;
  }

  function closeStageModal() {
    stageModalEl.hidden = true;
    if (state.stage >= 2 && !state.player.government) openGovernmentModal();
  }

  function openGovernmentModal() {
    if (state.player.government) return;
    governmentOptionsEl.innerHTML = Object.values(GOVERNMENTS).map((g) => `
      <button class="government-card" data-government="${g.id}">
        <span>${g.label}</span>
        <small>${g.summary}</small>
      </button>
    `).join("");
    governmentOptionsEl.querySelectorAll("[data-government]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const res = state.chooseGovernment(btn.getAttribute("data-government"));
        setCurrent(res.reason);
        if (res.ok) governmentModalEl.hidden = true;
      });
    });
    governmentModalEl.hidden = false;
  }

  function openAllianceModal(partnerId) {
    const partner = state.nations[partnerId];
    if (!partner) return;
    alliancePartnerId = partnerId;
    allianceTitleEl.textContent = `Alliance with ${partner.name}`;
    allianceSubtitleEl.textContent = `${partner.personality} · ${governmentLabel(partner.government)} · Relation ${state.getDiplomacy(partnerId).relation}`;
    allianceInputs.name.value = `${ALLIANCE_TYPES[allianceInputs.type.value]} Accord`;
    allianceModalEl.hidden = false;
    updateAlliancePreview();
    allianceInputs.name.focus();
  }

  function closeAllianceModal() {
    allianceModalEl.hidden = true;
    alliancePartnerId = null;
  }

  function currentAllianceDraft() {
    return {
      name: allianceInputs.name.value,
      type: allianceInputs.type.value,
      duration: allianceInputs.duration.value,
      terms: {
        shareResources: allianceInputs.shareResources.checked,
        mutualDefense: allianceInputs.mutualDefense.checked,
        tradeExclusivity: allianceInputs.tradeExclusivity.checked,
      },
    };
  }

  function updateAlliancePreview() {
    if (!alliancePartnerId) return;
    const draft = currentAllianceDraft();
    const terms = [];
    if (draft.terms.shareResources) terms.push("share resources");
    if (draft.terms.mutualDefense) terms.push("mutual defense");
    if (draft.terms.tradeExclusivity) terms.push("trade exclusivity");
    alliancePreviewEl.innerHTML = `
      <div><strong>${draft.name || "Alliance"}</strong> · ${ALLIANCE_TYPES[draft.type]} · ${draft.duration || 1} turns</div>
      <div>${terms.length ? terms.join(" · ") : "Select at least one term."}</div>
    `;
    allianceSubmitBtn.disabled = !terms.length || state.isProcessingTurn;
  }

  function submitAlliance() {
    if (!alliancePartnerId) return;
    const res = state.proposeAlliance(alliancePartnerId, currentAllianceDraft());
    setCurrent(res.reason);
    if (res.accepted) closeAllianceModal();
    else updateAlliancePreview();
  }

  // ---- National Archives modal ----

  const ARCHIVE_TYPE_LABELS = {
    build_tile: "Built",
    assign_workers: "Workers",
    trade_completed: "Trade",
    trade_rejected: "Trade Rejected",
    alliance_formed: "Alliance",
    alliance_rejected: "Alliance Rejected",
    war_declared: "War",
    combat_resolved: "Combat",
    technology_researched: "Research",
    fleet_built: "Fleet",
    population_growth: "Growth",
    starvation_event: "Starvation",
    stage_unlocked: "Stage Unlock",
    disaster_event: "Disaster",
    pollution_event: "Pollution",
    government_chosen: "Government",
    tutorial_completed: "Tutorial",
    bot_idle: "Bot Idle",
    game_over: "Game Over",
  };

  function renderArchiveModal() {
    const selectedId = archiveNationSelectEl?.value || state.playerId;
    const nation = state.nations[selectedId] || state.player;
    const archives = nation.archives || [];
    archiveSubtitleEl.textContent = `${nation.name} · ${archives.length} entries recorded`;
    if (archives.length === 0) {
      archiveContentEl.innerHTML = `<p class="muted">No archive entries yet. Take actions to build your history.</p>`;
    } else {
      archiveContentEl.innerHTML = [...archives].reverse().map((entry) => {
        const typeLabel = ARCHIVE_TYPE_LABELS[entry.type] || entry.type;
        const costStr = entry.cost
          ? entry.cost.money != null
            ? ` · cost $${entry.cost.money.toLocaleString()}`
            : entry.cost.people != null
              ? ` · cost ${entry.cost.people} people`
              : ""
          : "";
        return `
          <div class="archive-entry">
            <div class="archive-entry-head">
              <span class="archive-type">${typeLabel}</span>
              <span class="archive-turn muted">Turn ${entry.turn}</span>
            </div>
            <div class="archive-details">${entry.details}${costStr}</div>
          </div>
        `;
      }).join("");
    }
  }

  function openArchiveModal() {
    if (archiveNationSelectEl) {
      archiveNationSelectEl.innerHTML = Object.values(state.nations).map((nation) =>
        `<option value="${nation.id}" ${nation.id === state.playerId ? "selected" : ""}>${nation.name}</option>`
      ).join("");
    }
    renderArchiveModal();
    archiveModalEl.hidden = false;
  }

  function closeArchiveModal() {
    archiveModalEl.hidden = true;
  }

  // ---- Wire map callbacks ----

  map.onHover = (tile, e) => {
    if (!tile || !e) {
      tooltipEl.classList.add("hidden");
      return;
    }
    tooltipEl.classList.remove("hidden");
    const min = WORKER_MIN[tile.type];
    const active = min != null && isTileActive(tile);
    tooltipEl.innerHTML = `
      <div class="tt-title"><span class="swatch" style="background:${hexColor(tile.type)}"></span>${TILE_LABELS[tile.type]}</div>
      <div class="tt-row"><span class="label">Coord</span><span>(${tile.q}, ${tile.r})</span></div>
      <div class="tt-row"><span class="label">Owner</span><span>${ownerLabel(tile)}</span></div>
      ${min != null ? `<div class="tt-row"><span class="label">Workers</span><span>${tile.workers}/${min} ${active ? "✓" : "·"}</span></div>` : ""}
      ${tile.disabledTurns > 0 ? `<div class="tt-row"><span class="label">Drought</span><span>${tile.disabledTurns} turns</span></div>` : ""}
      ${tile.floodedTurns > 0 ? `<div class="tt-row"><span class="label">Flood</span><span>${tile.floodedTurns} turns</span></div>` : ""}
      ${tile.bountifulTurns > 0 ? `<div class="tt-row"><span class="label">Harvest</span><span>Double food</span></div>` : ""}
    `;
    const rect = map.canvas.getBoundingClientRect();
    tooltipEl.style.left = e.clientX - rect.left + "px";
    tooltipEl.style.top = e.clientY - rect.top + "px";
  };

  map.onSelect = (tile) => {
    selectedTile = tile;
    renderTilePanel(tile);
    if (tile) {
      setCurrent(`Selected ${TILE_LABELS[tile.type]} at (${tile.q}, ${tile.r}).`);
    }
  };

  // Re-render on any state change.
  state.on((ev) => {
    refreshStrategicMapHighlights();
    renderStatus();
    renderResources();
    renderNationPanel();
    renderDiplomacyPanel();
    renderMilitaryPanel();
    renderSummary();
    renderEventFeed();
    renderTutorial();
    if (selectedTile) renderTilePanel(selectedTile);
    if (tradePartnerId && !tradeModalEl.hidden) {
      const partner = state.nations[tradePartnerId];
      if (partner) {
        tradeSubtitleEl.textContent = tradeSubtitle(tradePartnerId);
        setTradeInputLimits(partner);
        updateTradePreview();
      }
    }
    if (alliancePartnerId && !allianceModalEl.hidden) updateAlliancePreview();
    if (ev && ev.type === "event_added" && ev.event) {
      setCurrent(ev.event.message);
    }
    if (ev && ev.type === "stage_unlocked" && ev.unlock) {
      openStageModal(ev.unlock);
    }
    if (ev && ev.type === "war_report" && ev.report) {
      openWarReportModal(ev.report);
    }
    if (ev && ev.type === "game_over" && ev.winner) {
      openVictoryModal(state.gameOver);
    }
    if (ev && ev.type === "bot_thinking" && ev.nation) {
      setCurrent(`${ev.nation.name} is thinking...`);
    }
    if (ev && ev.source === "end_turn" && ev.summary) {
      const s = ev.summary;
      const bits = [];
      if (s.deaths > 0) bits.push(`${s.deaths} died (starvation)`);
      if (s.grew && (s.gainedPeople || s.gainedMoney)) {
        bits.push(`+${s.gainedPeople} ppl, +${fmtMoney(s.gainedMoney)}`);
      }
      setCurrent(`Turn ${s.turn} ended. ` + (bits.length ? bits.join(" · ") : "No change."));
    }
  });

  endTurnBtn.addEventListener("click", () => {
    if (state.stage >= 2 && !state.player.government) {
      openGovernmentModal();
      return;
    }
    state.endTurn();
  });

  if (openArchivesBtn) {
    openArchivesBtn.addEventListener("click", openArchiveModal);
  }
  if (archiveCloseBtn) {
    archiveCloseBtn.addEventListener("click", closeArchiveModal);
  }
  if (archiveNationSelectEl) {
    archiveNationSelectEl.addEventListener("change", renderArchiveModal);
  }
  if (archiveModalEl) {
    archiveModalEl.addEventListener("click", (e) => {
      if (e.target === archiveModalEl) closeArchiveModal();
    });
  }

  if (manualSaveBtn) {
    manualSaveBtn.addEventListener("click", () => {
      const res = state.manualSave();
      if (saveStatusEl) saveStatusEl.textContent = res.reason;
      setCurrent(res.reason);
    });
  }

  if (newGameBtn) {
    newGameBtn.addEventListener("click", () => {
      if (typeof localStorage !== "undefined") localStorage.removeItem(GAME_SAVE_KEY);
      window.location.reload();
    });
  }

  if (tutorialDismissBtn) {
    tutorialDismissBtn.addEventListener("click", () => state.dismissTutorial());
  }

  techCloseBtn.addEventListener("click", closeTechModal);
  techModalEl.addEventListener("click", (e) => {
    if (e.target === techModalEl) closeTechModal();
  });

  fleetCloseBtn.addEventListener("click", closeFleetModal);
  fleetModalEl.addEventListener("click", (e) => {
    if (e.target === fleetModalEl) closeFleetModal();
  });

  victoryPlayAgainBtn.addEventListener("click", () => window.location.reload());

  warDeclareCloseBtn.addEventListener("click", closeWarDeclareModal);
  warDeclareCancelBtn.addEventListener("click", closeWarDeclareModal);
  warDeclareConfirmBtn.addEventListener("click", submitWarDeclare);
  warDeclareModalEl.addEventListener("click", (e) => {
    if (e.target === warDeclareModalEl) closeWarDeclareModal();
  });

  warReportCloseBtn.addEventListener("click", closeWarReportModal);
  warReportCloseActionBtn.addEventListener("click", closeWarReportModal);
  warReportModalEl.addEventListener("click", (e) => {
    if (e.target === warReportModalEl) closeWarReportModal();
  });

  tradeCloseBtn.addEventListener("click", closeTradeModal);
  tradeResetBtn.addEventListener("click", () => {
    resetTradeInputs();
    updateTradePreview();
  });
  tradeSubmitBtn.addEventListener("click", submitTrade);
  Object.values(tradeInputs).forEach((input) => {
    input.addEventListener("input", updateTradePreview);
  });
  tradeModalEl.addEventListener("click", (e) => {
    if (e.target === tradeModalEl) closeTradeModal();
  });
  stageCloseBtn.addEventListener("click", closeStageModal);
  stageGovernmentBtn.addEventListener("click", () => {
    stageModalEl.hidden = true;
    openGovernmentModal();
  });
  stageModalEl.addEventListener("click", (e) => {
    if (e.target === stageModalEl) closeStageModal();
  });
  allianceCloseBtn.addEventListener("click", closeAllianceModal);
  allianceSubmitBtn.addEventListener("click", submitAlliance);
  Object.values(allianceInputs).forEach((input) => {
    input.addEventListener("input", () => {
      if (input === allianceInputs.type) {
        allianceInputs.name.value = `${ALLIANCE_TYPES[allianceInputs.type.value]} Accord`;
      }
      updateAlliancePreview();
    });
    input.addEventListener("change", updateAlliancePreview);
  });
  allianceModalEl.addEventListener("click", (e) => {
    if (e.target === allianceModalEl) closeAllianceModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!warReportModalEl.hidden) closeWarReportModal();
    else if (!techModalEl.hidden) closeTechModal();
    else if (!fleetModalEl.hidden) closeFleetModal();
    else if (!warDeclareModalEl.hidden) closeWarDeclareModal();
    else if (!tradeModalEl.hidden) closeTradeModal();
    else if (!allianceModalEl.hidden) closeAllianceModal();
    else if (!stageModalEl.hidden) closeStageModal();
    else if (archiveModalEl && !archiveModalEl.hidden) closeArchiveModal();
  });

  const techPanelSection = document.getElementById("tech-panel-section");
  const openTechBtn = document.getElementById("open-tech-btn");
  const fleetPanelSection = document.getElementById("fleet-panel-section");
  const openFleetPanelBtn = document.getElementById("open-fleet-btn");

  function renderPanelVisibility() {
    if (techPanelSection) techPanelSection.hidden = state.stage < STAGES.INDUSTRIAL;
    if (fleetPanelSection) fleetPanelSection.hidden = state.stage < STAGES.MODERN;
  }

  if (openTechBtn) {
    openTechBtn.addEventListener("click", openTechModal);
  }
  if (openFleetPanelBtn) {
    openFleetPanelBtn.addEventListener("click", openFleetModal);
  }
  if (recruitBtn) {
    recruitBtn.addEventListener("click", () => {
      const count = Math.max(1, Math.floor(Number(recruitAmountEl?.value) || 1));
      const res = state.recruitSoldiers(count);
      setCurrent(res.ok ? `Recruited ${count} soldiers.` : `Cannot recruit: ${res.reason}.`);
    });
  }

  state.on(() => {
    renderPanelVisibility();
    if (state.gameOver && victoryModalEl.hidden) {
      openVictoryModal(state.gameOver);
    }
  });

  refreshStrategicMapHighlights();
  renderStatus();
  renderResources();
  renderNationPanel();
  renderDiplomacyPanel();
  renderMilitaryPanel();
  renderSummary();
  renderEventFeed();
  renderTutorial();
  renderTilePanel(null);
  renderPanelVisibility();
}
