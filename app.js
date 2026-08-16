(function () {
  "use strict";

  var STORAGE_GAME = "playnine_game_v1";
  var STORAGE_HISTORY = "playnine_history_v1";
  var STORAGE_LAST_PLAYERS = "playnine_last_players_v1";
  var MAX_PLAYERS = 8;
  var MIN_PLAYERS = 2;

  var app = document.getElementById("app");
  var btnHistory = document.getElementById("btnHistory");
  var btnNewGame = document.getElementById("btnNewGame");
  var btnExport = document.getElementById("btnExport");

  var state = null; // current in-progress game, or null
  var view = "setup"; // 'setup' | 'game' | 'history'

  // ---------- persistence ----------

  function loadGame() {
    try {
      var raw = localStorage.getItem(STORAGE_GAME);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveGame() {
    if (state) localStorage.setItem(STORAGE_GAME, JSON.stringify(state));
  }

  function clearGame() {
    localStorage.removeItem(STORAGE_GAME);
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(STORAGE_HISTORY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list));
  }

  function loadLastPlayers() {
    try {
      var raw = localStorage.getItem(STORAGE_LAST_PLAYERS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- scoring ----------

  // A column of 3 matching (and fully revealed) cards scores 0 instead of
  // its sum -- the signature Play Nine rule.
  function columnScore(vals) {
    var filled = vals.every(function (v) { return v !== null && v !== undefined; });
    if (filled && vals[0] === vals[1] && vals[1] === vals[2]) return 0;
    return vals.reduce(function (sum, v) { return sum + (v || 0); }, 0);
  }

  function gridTotal(grid) {
    var total = 0;
    for (var col = 0; col < 3; col++) {
      total += columnScore([grid[col], grid[col + 3], grid[col + 6]]);
    }
    return total;
  }

  function matchedColumns(grid) {
    var cols = [];
    for (var col = 0; col < 3; col++) {
      var vals = [grid[col], grid[col + 3], grid[col + 6]];
      var filled = vals.every(function (v) { return v !== null && v !== undefined; });
      if (filled && vals[0] === vals[1] && vals[1] === vals[2]) cols.push(col);
    }
    return cols;
  }

  function playerCumulative(playerId) {
    var total = 0;
    for (var r = 0; r < state.rounds.length; r++) {
      total += gridTotal(state.rounds[r][playerId]);
    }
    return total;
  }

  function roundIsComplete(roundGrids) {
    return state.players.every(function (p) {
      return roundGrids[p.id].every(function (v) { return v !== null && v !== undefined; });
    });
  }

  function gameIsComplete() {
    return state.rounds.every(roundIsComplete);
  }

  // ---------- id helper ----------

  var idCounter = 0;
  function uid() {
    idCounter += 1;
    return "p" + Date.now().toString(36) + idCounter.toString(36);
  }

  // ---------- setup screen ----------

  function renderSetup() {
    var tpl = document.getElementById("tpl-setup");
    app.innerHTML = "";
    app.appendChild(tpl.content.cloneNode(true));

    var playerList = document.getElementById("playerList");
    var numRoundsSel = document.getElementById("numRounds");
    var numRoundsCustom = document.getElementById("numRoundsCustom");
    var errorMsg = document.getElementById("setupError");

    var lastPlayers = loadLastPlayers();
    var initialNames = (lastPlayers && lastPlayers.length >= MIN_PLAYERS) ? lastPlayers : ["", ""];

    initialNames.forEach(function (name) { addPlayerRow(playerList, name); });

    document.getElementById("btnAddPlayer").addEventListener("click", function () {
      if (playerList.children.length >= MAX_PLAYERS) return;
      addPlayerRow(playerList, "");
      playerList.lastElementChild.querySelector(".player-name-input").focus();
    });

    playerList.addEventListener("click", function (e) {
      var btn = e.target.closest(".btn-remove-player");
      if (!btn) return;
      if (playerList.children.length <= 1) return;
      btn.closest(".player-row").remove();
      renumberPlaceholders(playerList);
    });

    numRoundsSel.addEventListener("change", function () {
      numRoundsCustom.hidden = numRoundsSel.value !== "custom";
      if (!numRoundsCustom.hidden) numRoundsCustom.focus();
    });

    document.getElementById("btnStartGame").addEventListener("click", function () {
      var names = Array.prototype.map.call(
        playerList.querySelectorAll(".player-name-input"),
        function (input) { return input.value.trim(); }
      );

      var seen = {};
      var players = [];
      for (var i = 0; i < names.length; i++) {
        var name = names[i] || ("Player " + (i + 1));
        var key = name.toLowerCase();
        if (seen[key]) name = name + " (" + (i + 1) + ")";
        seen[name.toLowerCase()] = true;
        players.push({ id: uid(), name: name });
      }

      if (players.length < MIN_PLAYERS) {
        errorMsg.textContent = "Add at least " + MIN_PLAYERS + " players.";
        errorMsg.hidden = false;
        return;
      }

      var numRounds = numRoundsSel.value === "custom"
        ? parseInt(numRoundsCustom.value, 10)
        : parseInt(numRoundsSel.value, 10);

      if (!numRounds || numRounds < 1 || numRounds > 30) {
        errorMsg.textContent = "Enter a valid number of rounds (1-30).";
        errorMsg.hidden = false;
        return;
      }

      startGame(players, numRounds);
    });
  }

  function addPlayerRow(playerList, name) {
    var tpl = document.getElementById("tpl-player-row");
    var node = tpl.content.cloneNode(true);
    var input = node.querySelector(".player-name-input");
    input.value = name || "";
    input.placeholder = "Player " + (playerList.children.length + 1);
    playerList.appendChild(node);
  }

  function renumberPlaceholders(playerList) {
    Array.prototype.forEach.call(playerList.children, function (row, i) {
      row.querySelector(".player-name-input").placeholder = "Player " + (i + 1);
    });
  }

  function startGame(players, numRounds) {
    var rounds = [];
    for (var r = 0; r < numRounds; r++) {
      var roundGrids = {};
      players.forEach(function (p) {
        roundGrids[p.id] = new Array(9).fill(null);
      });
      rounds.push(roundGrids);
    }

    state = {
      players: players,
      numRounds: numRounds,
      rounds: rounds,
      currentRound: 0,
      gameOverDismissed: false
    };

    saveGame();
    localStorage.setItem(STORAGE_LAST_PLAYERS, JSON.stringify(players.map(function (p) { return p.name; })));
    view = "game";
    render();
  }

  // ---------- game screen ----------

  function renderGame() {
    var tpl = document.getElementById("tpl-game");
    app.innerHTML = "";
    app.appendChild(tpl.content.cloneNode(true));

    renderLeaderboard();
    renderRoundTabs();
    renderRoundGrids();
    updateGameOverBanner();

    document.getElementById("btnPrevRound").addEventListener("click", function () {
      goToRound(state.currentRound - 1);
    });
    document.getElementById("btnNextRound").addEventListener("click", function () {
      goToRound(state.currentRound + 1);
    });

    document.getElementById("btnKeepPlaying").addEventListener("click", function () {
      state.gameOverDismissed = true;
      document.getElementById("gameOverBanner").hidden = true;
    });

    document.getElementById("btnSaveGame").addEventListener("click", function () {
      finishAndSaveGame();
    });
  }

  function goToRound(index) {
    if (index < 0 || index >= state.numRounds) return;
    state.currentRound = index;
    saveGame();
    renderRoundTabs();
    renderRoundGrids();
  }

  function renderLeaderboard() {
    var list = document.getElementById("leaderboardList");
    list.innerHTML = "";

    var ranked = state.players.map(function (p) {
      return { id: p.id, name: p.name, total: playerCumulative(p.id) };
    }).sort(function (a, b) {
      return a.total - b.total || a.name.localeCompare(b.name);
    });

    var medals = ["🥇", "🥈", "🥉"];

    ranked.forEach(function (p, i) {
      var li = document.createElement("li");
      li.className = "leaderboard-item" + (i === 0 ? " rank-1" : "");
      li.innerHTML =
        '<span class="lb-medal">' + (medals[i] || "") + '</span>' +
        '<span class="lb-rank">' + (i + 1) + '</span>' +
        '<span class="lb-name"></span>' +
        '<span class="lb-total">' + p.total + '</span>';
      li.querySelector(".lb-name").textContent = p.name;
      list.appendChild(li);
    });
  }

  function renderRoundTabs() {
    var tabs = document.getElementById("roundTabs");
    tabs.innerHTML = "";
    for (var r = 0; r < state.numRounds; r++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "round-tab" +
        (r === state.currentRound ? " active" : "") +
        (roundIsComplete(state.rounds[r]) ? " complete" : "");
      btn.textContent = String(r + 1);
      btn.addEventListener("click", (function (idx) {
        return function () { goToRound(idx); };
      })(r));
      tabs.appendChild(btn);
    }

    document.getElementById("btnPrevRound").disabled = state.currentRound === 0;
    document.getElementById("btnNextRound").disabled = state.currentRound === state.numRounds - 1;
  }

  function renderRoundGrids() {
    var container = document.getElementById("roundGrids");
    container.innerHTML = "";
    var tpl = document.getElementById("tpl-player-grid-card");
    var grids = state.rounds[state.currentRound];

    state.players.forEach(function (p) {
      var node = tpl.content.cloneNode(true);
      var card = node.querySelector(".player-grid-card");
      card.dataset.playerId = p.id;
      node.querySelector(".player-grid-name").textContent = p.name;

      var cardGrid = node.querySelector(".card-grid");
      var grid = grids[p.id];
      for (var i = 0; i < 9; i++) {
        var input = document.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.pattern = "[0-9]*";
        input.maxLength = 2;
        input.autocomplete = "off";
        input.className = "card-cell";
        input.dataset.playerId = p.id;
        input.dataset.index = String(i);
        input.value = grid[i] === null || grid[i] === undefined ? "" : String(grid[i]);
        input.setAttribute("aria-label", p.name + " card " + (i + 1));
        cardGrid.appendChild(input);
      }

      container.appendChild(node);
      updatePlayerCardUI(p.id);
    });

    container.addEventListener("input", onCellInput);
    container.addEventListener("blur", onCellBlur, true);
    container.addEventListener("keydown", onCellKeydown);
  }

  function onCellInput(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("card-cell")) return;

    var digits = input.value.replace(/[^0-9]/g, "").slice(0, 2);
    if (digits !== input.value) input.value = digits;

    var playerId = input.dataset.playerId;
    var idx = parseInt(input.dataset.index, 10);
    var grid = state.rounds[state.currentRound][playerId];

    if (digits === "") {
      grid[idx] = null;
    } else {
      var n = parseInt(digits, 10);
      grid[idx] = n;
    }

    saveGame();
    updatePlayerCardUI(playerId);
    renderLeaderboard();
    updateRoundTabIndicator();
    updateGameOverBanner();
  }

  function onCellBlur(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("card-cell")) return;
    var playerId = input.dataset.playerId;
    var idx = parseInt(input.dataset.index, 10);
    var grid = state.rounds[state.currentRound][playerId];
    var v = grid[idx];
    if (v !== null && v !== undefined) {
      if (v > 12) v = 12;
      if (v < 0) v = 0;
      grid[idx] = v;
      input.value = String(v);
      saveGame();
      updatePlayerCardUI(playerId);
      renderLeaderboard();
    }
  }

  var ARROW_DELTAS = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1]
  };

  function onCellKeydown(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("card-cell")) return;

    if (e.key === "Enter") {
      e.preventDefault();
      var cells = Array.prototype.slice.call(document.querySelectorAll(".card-cell"));
      var pos = cells.indexOf(input);
      if (pos >= 0 && pos < cells.length - 1) {
        cells[pos + 1].focus();
        cells[pos + 1].select();
      } else {
        input.blur();
      }
      return;
    }

    var delta = ARROW_DELTAS[e.key];
    if (!delta) return;
    e.preventDefault();

    var idx = parseInt(input.dataset.index, 10);
    var row = Math.floor(idx / 3) + delta[0];
    var col = (idx % 3) + delta[1];
    var playerIdx = state.players.findIndex(function (p) { return p.id === input.dataset.playerId; });

    if (row < 0 || row > 2) return;
    if (col < 0) { playerIdx -= 1; col = 2; }
    if (col > 2) { playerIdx += 1; col = 0; }
    if (playerIdx < 0 || playerIdx >= state.players.length) return;

    var targetId = state.players[playerIdx].id;
    var targetIdx = row * 3 + col;
    var target = document.querySelector(
      '.card-cell[data-player-id="' + targetId + '"][data-index="' + targetIdx + '"]'
    );
    if (target) {
      target.focus();
      target.select();
    }
  }

  function updatePlayerCardUI(playerId) {
    var card = document.querySelector('.player-grid-card[data-player-id="' + playerId + '"]');
    if (!card) return;
    var grid = state.rounds[state.currentRound][playerId];

    card.querySelector(".player-grid-score").textContent = gridTotal(grid);

    var zeroCols = matchedColumns(grid);
    var cells = card.querySelectorAll(".card-cell");
    cells.forEach(function (cell) {
      var idx = parseInt(cell.dataset.index, 10);
      var col = idx % 3;
      cell.classList.toggle("col-zero", zeroCols.indexOf(col) !== -1);
    });
  }

  function updateRoundTabIndicator() {
    var tabs = document.querySelectorAll(".round-tab");
    var tab = tabs[state.currentRound];
    if (tab) tab.classList.toggle("complete", roundIsComplete(state.rounds[state.currentRound]));
  }

  function updateGameOverBanner() {
    var banner = document.getElementById("gameOverBanner");
    if (!banner) return;
    var complete = gameIsComplete();

    if (!complete) {
      state.gameOverDismissed = false;
      banner.hidden = true;
      return;
    }

    if (state.gameOverDismissed) {
      banner.hidden = true;
      return;
    }

    var ranked = state.players.map(function (p) {
      return { name: p.name, total: playerCumulative(p.id) };
    }).sort(function (a, b) { return a.total - b.total; });

    var winners = ranked.filter(function (p) { return p.total === ranked[0].total; });
    var winnerText = winners.length === 1
      ? winners[0].name + " wins with " + winners[0].total + " points!"
      : winners.map(function (w) { return w.name; }).join(" & ") + " tie for the win with " + winners[0].total + " points!";

    document.getElementById("gameOverWinner").textContent = winnerText;
    banner.hidden = false;
  }

  function finishAndSaveGame() {
    var ranked = state.players.map(function (p) {
      return { name: p.name, total: playerCumulative(p.id) };
    }).sort(function (a, b) { return a.total - b.total; });

    var winners = ranked.filter(function (p) { return p.total === ranked[0].total; });

    var roundScores = state.players.map(function (p) {
      return {
        name: p.name,
        rounds: state.rounds.map(function (round) { return gridTotal(round[p.id]); })
      };
    });

    var history = loadHistory();
    history.unshift({
      date: new Date().toISOString(),
      numRounds: state.numRounds,
      players: ranked,
      winnerName: winners.map(function (w) { return w.name; }).join(" & "),
      roundScores: roundScores
    });
    saveHistory(history);

    clearGame();
    state = null;
    view = "setup";
    render();
  }

  // ---------- CSV export ----------

  function csvField(value) {
    var s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function gameToCsv() {
    var header = ["Round"].concat(state.players.map(function (p) { return p.name; }));
    var lines = [header.map(csvField).join(",")];

    for (var r = 0; r < state.numRounds; r++) {
      var row = [String(r + 1)].concat(state.players.map(function (p) {
        return String(gridTotal(state.rounds[r][p.id]));
      }));
      lines.push(row.map(csvField).join(","));
    }

    var totalRow = ["Total"].concat(state.players.map(function (p) {
      return String(playerCumulative(p.id));
    }));
    lines.push(totalRow.map(csvField).join(","));

    return lines.join("\r\n");
  }

  function exportCsv() {
    var csv = gameToCsv();
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "play-nine-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- history screen ----------

  function renderHistory() {
    var tpl = document.getElementById("tpl-history");
    app.innerHTML = "";
    app.appendChild(tpl.content.cloneNode(true));

    var list = document.getElementById("historyList");
    var history = loadHistory();

    if (history.length === 0) {
      list.innerHTML = '<p class="empty-state">No completed games yet. Play a game and save it to see it here.</p>';
    } else {
      history.forEach(function (game) {
        var entry = document.createElement("div");
        entry.className = "history-entry";
        var dateStr = new Date(game.date).toLocaleDateString(undefined, {
          year: "numeric", month: "short", day: "numeric"
        });
        var rowsHtml = game.players.map(function (p, i) {
          return '<div class="h-row' + (p.name === game.winnerName || i === 0 ? " winner" : "") + '">' +
            '<span></span><span>' + p.total + '</span></div>';
        }).join("");
        entry.innerHTML =
          '<div class="h-date">' + dateStr + ' &middot; ' + game.numRounds + ' rounds</div>' +
          rowsHtml;
        var nameSpans = entry.querySelectorAll(".h-row span:first-child");
        game.players.forEach(function (p, i) { nameSpans[i].textContent = p.name; });

        if (game.roundScores && game.roundScores.length) {
          entry.appendChild(buildRoundDetail(game));
        }

        list.appendChild(entry);
      });
    }

    document.getElementById("btnClearHistory").addEventListener("click", function () {
      if (history.length === 0) return;
      if (confirm("Clear all game history? This can't be undone.")) {
        saveHistory([]);
        renderHistory();
      }
    });

    document.getElementById("btnBackFromHistory").addEventListener("click", function () {
      view = state ? "game" : "setup";
      render();
    });
  }

  function buildRow(tag, cellValues) {
    var tr = document.createElement("tr");
    cellValues.forEach(function (text) {
      var cell = document.createElement(tag);
      cell.textContent = text;
      tr.appendChild(cell);
    });
    return tr;
  }

  function buildRoundDetail(game) {
    var details = document.createElement("details");
    details.className = "history-detail";

    var summary = document.createElement("summary");
    summary.textContent = "View round-by-round";
    details.appendChild(summary);

    var table = document.createElement("table");
    table.className = "history-table";

    var thead = document.createElement("thead");
    thead.appendChild(buildRow("th", ["Round"].concat(game.roundScores.map(function (p) { return p.name; }))));
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    for (var r = 0; r < game.numRounds; r++) {
      tbody.appendChild(buildRow("td", [String(r + 1)].concat(
        game.roundScores.map(function (p) { return String(p.rounds[r]); })
      )));
    }
    table.appendChild(tbody);

    var wrapper = document.createElement("div");
    wrapper.className = "history-table-wrap";
    wrapper.appendChild(table);
    details.appendChild(wrapper);
    return details;
  }

  // ---------- top-level render / header ----------

  function render() {
    btnNewGame.hidden = !state || view === "setup";
    btnHistory.hidden = view === "history";
    btnExport.hidden = !state || view !== "game";

    if (view === "history") {
      renderHistory();
    } else if (view === "game" && state) {
      renderGame();
    } else {
      view = "setup";
      renderSetup();
    }
  }

  btnHistory.addEventListener("click", function () {
    view = "history";
    render();
  });

  btnExport.addEventListener("click", function () {
    if (state) exportCsv();
  });

  btnNewGame.addEventListener("click", function () {
    if (confirm("Start a new game? Current progress will be lost unless you finish and save it first.")) {
      clearGame();
      state = null;
      view = "setup";
      render();
    }
  });

  // ---------- init ----------

  state = loadGame();
  view = state ? "game" : "setup";
  render();
})();
