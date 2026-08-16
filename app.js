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
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return isValidGameShape(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  // Guards against the older per-card-grid save format from before scoring
  // was simplified to one number per round; a stale save in that shape is
  // discarded rather than crashing the renderer.
  function isValidGameShape(g) {
    if (!g || !g.players || !g.players.length || !g.rounds || !g.rounds.length) return false;
    var sample = g.rounds[0][g.players[0].id];
    return !Array.isArray(sample);
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
  // Each round is a single golf-style score per player (lower is better;
  // negative scores are allowed). The app just totals them -- it doesn't
  // model cards, deals, or turns.

  function playerCumulative(playerId) {
    var total = 0;
    for (var r = 0; r < state.rounds.length; r++) {
      var v = state.rounds[r][playerId];
      total += typeof v === "number" ? v : 0;
    }
    return total;
  }

  function roundIsComplete(round) {
    return state.players.every(function (p) { return typeof round[p.id] === "number"; });
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
      var round = {};
      players.forEach(function (p) { round[p.id] = null; });
      rounds.push(round);
    }

    state = {
      players: players,
      numRounds: numRounds,
      rounds: rounds,
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
    renderScorecard();
    updateGameOverBanner();

    document.getElementById("btnKeepPlaying").addEventListener("click", function () {
      state.gameOverDismissed = true;
      document.getElementById("gameOverBanner").hidden = true;
    });

    document.getElementById("btnSaveGame").addEventListener("click", function () {
      finishAndSaveGame();
    });
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

  function renderScorecard() {
    var table = document.getElementById("scorecardTable");
    table.innerHTML = "";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    headRow.appendChild(buildCell("th", "Round"));
    state.players.forEach(function (p) { headRow.appendChild(buildCell("th", p.name)); });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    for (var r = 0; r < state.numRounds; r++) {
      var tr = document.createElement("tr");
      var roundTh = buildCell("th", String(r + 1));
      roundTh.setAttribute("scope", "row");
      tr.appendChild(roundTh);

      state.players.forEach(function (p) {
        var td = document.createElement("td");
        var input = document.createElement("input");
        input.type = "number";
        input.step = "1";
        // No inputmode override: iOS's "numeric" keypad hides the minus
        // sign, but the default keyboard for type="number" includes it.
        input.autocomplete = "off";
        input.className = "score-cell";
        input.dataset.round = String(r);
        input.dataset.playerId = p.id;
        var v = state.rounds[r][p.id];
        input.value = typeof v === "number" ? String(v) : "";
        input.setAttribute("aria-label", "Round " + (r + 1) + ", " + p.name);
        td.appendChild(input);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    var tfoot = document.createElement("tfoot");
    var totalRow = document.createElement("tr");
    totalRow.appendChild(buildCell("th", "Total"));
    state.players.forEach(function (p) {
      var td = buildCell("td", String(playerCumulative(p.id)));
      td.className = "total-cell";
      td.dataset.playerId = p.id;
      totalRow.appendChild(td);
    });
    tfoot.appendChild(totalRow);
    table.appendChild(tfoot);

    table.addEventListener("input", onScoreInput);
    table.addEventListener("blur", onScoreBlur, true);
    table.addEventListener("keydown", onScoreKeydown);
  }

  function buildCell(tag, text) {
    var cell = document.createElement(tag);
    cell.textContent = text;
    return cell;
  }

  function onScoreInput(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("score-cell")) return;

    var round = parseInt(input.dataset.round, 10);
    var raw = input.value.trim();
    var n = raw === "" ? NaN : parseInt(raw, 10);
    state.rounds[round][input.dataset.playerId] = isNaN(n) ? null : n;

    saveGame();
    updateTotals();
    renderLeaderboard();
    updateGameOverBanner();
  }

  function onScoreBlur(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("score-cell")) return;
    var round = parseInt(input.dataset.round, 10);
    var v = state.rounds[round][input.dataset.playerId];
    input.value = typeof v === "number" ? String(v) : "";
  }

  var NAV_DELTAS = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1]
  };

  function onScoreKeydown(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("score-cell")) return;

    if (e.key === "Enter") {
      e.preventDefault();
      var cells = Array.prototype.slice.call(document.querySelectorAll(".score-cell"));
      var pos = cells.indexOf(input);
      if (pos >= 0 && pos < cells.length - 1) {
        cells[pos + 1].focus();
        cells[pos + 1].select();
      } else {
        input.blur();
      }
      return;
    }

    var delta = NAV_DELTAS[e.key];
    if (!delta) return;
    e.preventDefault();

    var round = parseInt(input.dataset.round, 10) + delta[0];
    var playerIdx = state.players.findIndex(function (p) { return p.id === input.dataset.playerId; }) + delta[1];

    if (round < 0 || round >= state.numRounds) return;
    if (playerIdx < 0 || playerIdx >= state.players.length) return;

    var target = document.querySelector(
      '.score-cell[data-round="' + round + '"][data-player-id="' + state.players[playerIdx].id + '"]'
    );
    if (target) {
      target.focus();
      target.select();
    }
  }

  function updateTotals() {
    state.players.forEach(function (p) {
      var cell = document.querySelector('.total-cell[data-player-id="' + p.id + '"]');
      if (cell) cell.textContent = String(playerCumulative(p.id));
    });
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
        rounds: state.rounds.map(function (round) { return round[p.id]; })
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
        var v = state.rounds[r][p.id];
        return typeof v === "number" ? String(v) : "";
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
