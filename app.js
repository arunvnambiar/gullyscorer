// Simple client-side scoring engine for a gully-cricket scorer.
// Designed for small matches; not exhaustive but supports ball-by-ball recording, extras, wickets, undo, and export.

(function(){
  const $ = id => document.getElementById(id);

  // UI elements
  const startBtn = $('startMatch');
  const exportBtn = $('exportJson');
  const scorerSection = $('scorerSection');
  const inningsLabel = $('inningsLabel');
  const scoreLine = $('scoreLine');
  const strikerSelect = $('strikerSelect');
  const nonStrikerSelect = $('nonStrikerSelect');
  const outcome = $('outcome');
  const extraRuns = $('extraRuns');
  const dismissedSelect = $('dismissedSelect');
  const registerBall = $('registerBall');
  const undoBall = $('undoBall');
  const deliveryLog = $('deliveryLog');
  const scoreboard = $('scoreboard');
  const bowlerInput = $('bowlerInput');
  const endInningsBtn = $('endInnings');

  // Match state
  let match = null;

  function createMatch(teamAName, teamAPlayers, teamBName, teamBPlayers, overs){
    return {
      teams: [
        { name: teamAName, players: teamAPlayers.map(name => playerFactory(name)) },
        { name: teamBName, players: teamBPlayers.map(name => playerFactory(name)) }
      ],
      overs: Number(overs),
      ballsPerOver: 6,
      innings: [],
      currentInnings: 0,
      deliveries: [] // global log
    };
  }

  function playerFactory(name){
    return { name, runs:0, balls:0, fours:0, sixes:0, out:false, howOut:null, bowledBy:[], wickets:0, runsConceded:0, ballsBowled:0 };
  }

  function startInnings(match, battingTeamIndex, bowlingTeamIndex){
    const inning = {
      battingTeamIndex,
      bowlingTeamIndex,
      runs:0,
      wickets:0,
      oversCompleted:0,
      ballsInCurrentOver:0,
      totalOvers: match.overs,
      deliveries: []
    };
    match.innings.push(inning);
    match.currentInnings = match.innings.length - 1;
    return inning;
  }

  function currentInnings(){
    return match && match.innings[match.currentInnings];
  }

  // UI wiring
  startBtn.addEventListener('click', () => {
    const ta = $('teamAName').value.trim() || 'Team A';
    const tb = $('teamBName').value.trim() || 'Team B';
    const pa = $('teamAPlayers').value.split(',').map(s=>s.trim()).filter(s=>s);
    const pb = $('teamBPlayers').value.split(',').map(s=>s.trim()).filter(s=>s);
    const overs = Math.max(1, Number($('overs').value) || 1);

    match = createMatch(ta, pa, tb, pb, overs);
    // Start with Team A batting, Team B bowling
    startInnings(match, 0, 1);
    setupBatsmenSelectors();
    updateUI();
    scorerSection.classList.remove('hidden');
    exportBtn.disabled = false;
  });

  function setupBatsmenSelectors(){
    const inning = currentInnings();
    const batting = match.teams[inning.battingTeamIndex].players;
    function fill(select, includeOut=false){
      select.innerHTML = '';
      batting.forEach(p=>{
        if (!p.out || includeOut) {
          const opt = document.createElement('option'); opt.value = p.name; opt.textContent = p.name;
          select.appendChild(opt);
        }
      });
    }
    fill(strikerSelect);
    fill(nonStrikerSelect);
    // dismissed list includes all non-out players
    dismissedSelect.innerHTML = '';
    batting.forEach(p=>{
      if (!p.out){
        const opt = document.createElement('option'); opt.value = p.name; opt.textContent = p.name;
        dismissedSelect.appendChild(opt);
      }
    });
  }

  // Register a ball (main logic)
  registerBall.addEventListener('click', () => {
    if (!match) return;
    const inning = currentInnings();
    const batTeam = match.teams[inning.battingTeamIndex];
    const bowlTeam = match.teams[inning.bowlingTeamIndex];
    const striker = strikerSelect.value;
    const nonStriker = nonStrikerSelect.value;
    const bowler = bowlerInput.value.trim() || 'Unknown';
    const oc = outcome.value;
    const extra = Number(extraRuns.value) || 0;
    const dismissed = dismissedSelect.value;

    // Build delivery record
    const delivery = {
      inningIndex: match.currentInnings,
      over: inning.oversCompleted,
      ballInOver: inning.ballsInCurrentOver + 1,
      bowler,
      striker,
      nonStriker,
      outcome: oc,
      extraRuns: extra,
      dismissed: null,
      runs: 0,
      legalDelivery: true,
      timestamp: new Date().toISOString()
    };

    // Outcome handling
    if (oc === 'wide'){
      delivery.extraRuns = Math.max(1, extra || 1);
      delivery.runs = delivery.extraRuns;
      delivery.legalDelivery = false;
    } else if (oc === 'noball'){
      delivery.extraRuns = Math.max(1, extra || 1);
      delivery.runs = delivery.extraRuns;
      delivery.legalDelivery = false;
      // A no-ball normally allows additional runs off the bat; for simplicity user can register next ball normally.
    } else if (oc === 'bye' || oc === 'legbye' || oc === 'penalty'){
      const r = Math.max(0, extra);
      delivery.extraRuns = r;
      delivery.runs = r;
      delivery.legalDelivery = true;
      // credited as extras only
    } else if (oc.startsWith('w_')){
      // wicket on a legal delivery (unless runs came off a no-ball - simplified)
      delivery.legalDelivery = true;
      delivery.runs = 0;
      delivery.dismissed = { whom: dismissed || striker, kind: oc.substring(2) };
    } else {
      // plain runs
      const r = Number(oc) || 0;
      delivery.runs = r;
      delivery.legalDelivery = true;
      // update batsman
    }

    // Apply delivery to inning & players
    applyDelivery(inning, delivery);

    match.deliveries.push(delivery);
    inning.deliveries.push(delivery);
    renderDeliveryLog();
    updateUI();

    // If innings completed by overs or all out, auto end
    if (inning.oversCompleted >= inning.totalOvers || inning.wickets >= (batTeam.players.length - 1)) {
      endInnings();
    }
  });

  function applyDelivery(inning, d){
    const batting = match.teams[inning.battingTeamIndex].players;
    const bowling = match.teams[inning.bowlingTeamIndex].players;
    // find batsman and bowler objects (create if missing in team)
    const bat = batting.find(p => p.name === d.striker) || playerFactory(d.striker);
    const bowl = bowling.find(p => p.name === d.bowler) || playerFactory(d.bowler);

    // Ensure bowlers list contains this bowler object (if not from setup)
    if (!bowling.find(p=>p.name===bowl.name)) bowling.push(bowl);

    // Update runs/wickets/balls
    if (d.extraRuns && (d.outcome === 'wide' || d.outcome === 'noball' || d.outcome === 'bye' || d.outcome === 'legbye' || d.outcome === 'penalty')) {
      inning.runs += d.runs;
      bowl.runsConceded += d.runs;
      // extras: don't increment batsman stats except for no-ball if user inputs runs on bat (not supported here)
    } else if (d.outcome && d.outcome.startsWith('w_')) {
      inning.wickets += 1;
      inning.ballsInCurrentOver += 1;
      bowl.wickets += 1;
      bowl.ballsBowled += 1;
      bowl.runsConceded += d.runs;
      bat.out().catch?.(); // noop but left for pattern
      // mark dismissed
      const dismissedPlayer = batting.find(p=>p.name===d.dismissed.whom);
      if (dismissedPlayer) {
        dismissedPlayer.out = true;
        dismissedPlayer.howOut = d.dismissed.kind;
      }
    } else {
      // regular runs
      inning.runs += d.runs;
      bat.runs += d.runs;
      bat.balls += 1;
      if (d.runs === 4) bat.fours += 1;
      if (d.runs === 6) bat.sixes += 1;
      bowl.ballsBowled += 1;
      bowl.runsConceded += d.runs;
      inning.ballsInCurrentOver += 1;
    }

    // Update over count if over completed and increment oversCompleted
    if (inning.ballsInCurrentOver >= match.ballsPerOver) {
      inning.oversCompleted += 1;
      inning.ballsInCurrentOver = 0;
    }
  }

  // Undo last ball
  undoBall.addEventListener('click', () => {
    if (!match || match.deliveries.length === 0) return;
    const last = match.deliveries.pop();
    const inning = match.innings[last.inningIndex];
    // Remove from inning deliveries
    inning.deliveries.pop();

    // Reverse effects (simple reversal based on stored delivery)
    inning.runs -= last.runs;
    if (last.extraRuns && (last.outcome === 'wide' || last.outcome === 'noball' || last.outcome === 'bye' || last.outcome === 'legbye' || last.outcome === 'penalty')) {
      // extras reversed from bowler
      const bowl = match.teams[inning.bowlingTeamIndex].players.find(p=>p.name===last.bowler);
      if (bowl) bowl.runsConceded -= last.runs;
      // ballsInCurrentOver unchanged for wides/no-balls (they were illegal)
    } else if (last.outcome && last.outcome.startsWith('w_')) {
      inning.wickets -= 1;
      inning.ballsInCurrentOver = Math.max(0, inning.ballsInCurrentOver - 1);
      const bowl = match.teams[inning.bowlingTeamIndex].players.find(p=>p.name===last.bowler);
      if (bowl){ bowl.wickets = Math.max(0, bowl.wickets - 1); bowl.ballsBowled = Math.max(0, bowl.ballsBowled - 1); bowl.runsConceded = Math.max(0, bowl.runsConceded - last.runs); }
      const dismissedPlayer = match.teams[inning.battingTeamIndex].players.find(p=>p.name===last.dismissed.whom);
      if (dismissedPlayer){ dismissedPlayer.out = false; dismissedPlayer.howOut = null; }
    } else {
      // regular runs reversal
      inning.ballsInCurrentOver = Math.max(0, inning.ballsInCurrentOver - 1);
      const bat = match.teams[inning.battingTeamIndex].players.find(p=>p.name===last.striker);
      const bowl = match.teams[inning.bowlingTeamIndex].players.find(p=>p.name===last.bowler);
      if (bat){ bat.runs = Math.max(0, bat.runs - last.runs); bat.balls = Math.max(0, bat.balls - 1); if (last.runs === 4) bat.fours = Math.max(0, bat.fours - 1); if (last.runs === 6) bat.sixes = Math.max(0, bat.sixes - 1); }
      if (bowl){ bowl.runsConceded = Math.max(0, bowl.runsConceded - last.runs); bowl.ballsBowled = Math.max(0, bowl.ballsBowled - 1); }
    }

    // If we decremented an over completion earlier, adjust
    if (inning.oversCompleted > 0 && inning.ballsInCurrentOver === 0 && inning.deliveries.length > 0) {
      // keep as-is
    }

    renderDeliveryLog();
    updateUI();
  });

  endInningsBtn.addEventListener('click', endInnings);

  function endInnings(){
    if (!match) return;
    const cur = currentInnings();
    if (!cur) return;
    // If first innings, start second innings with roles swapped
    if (match.innings.length === 1) {
      startInnings(match, 1, 0);
      setupBatsmenSelectors();
    } else {
      // match finished
      alert('Match complete. Use Export JSON to save the match.');
    }
    updateUI();
  }

  exportBtn.addEventListener('click', () => {
    if (!match) return;
    const data = JSON.stringify(match, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'match.json'; a.click();
    URL.revokeObjectURL(url);
  });

  // Render UI representations
  function updateUI(){
    const c = currentInnings();
    if (!c) return;
    inningsLabel.textContent = `Innings ${match.currentInnings + 1}: ${match.teams[c.battingTeamIndex].name} batting`;
    scoreLine.textContent = `${c.runs}/${c.wickets} (${c.oversCompleted}.${c.ballsInCurrentOver})`;
    renderScoreboard();
  }

  function renderScoreboard(){
    const c = currentInnings();
    scoreboard.innerHTML = '';
    if (!c) return;
    const battingTeam = match.teams[c.battingTeamIndex];
    const bowlingTeam = match.teams[c.bowlingTeamIndex];

    // Batting panel
    const batPanel = document.createElement('div'); batPanel.className = 'panel';
    batPanel.innerHTML = `<strong>Batting - ${battingTeam.name}</strong><br/><small class="muted">Runs: ${c.runs} Wickets: ${c.wickets} Overs: ${c.oversCompleted}.${c.ballsInCurrentOver}</small><hr/>`;
    battingTeam.players.forEach(p=>{
      const li = document.createElement('div');
      li.textContent = `${p.name} ${p.out? '(out - '+(p.howOut||'')+')' : ''} — ${p.runs}(${p.balls})`;
      batPanel.appendChild(li);
    });
    scoreboard.appendChild(batPanel);

    // Bowling panel
    const bowlPanel = document.createElement('div'); bowlPanel.className = 'panel';
    bowlPanel.innerHTML = `<strong>Bowling - ${bowlingTeam.name}</strong><hr/>`;
    bowlingTeam.players.forEach(p=>{
      const overs = p.ballsBowled ? `${Math.floor(p.ballsBowled/6)}.${p.ballsBowled%6}` : '0.0';
      const eco = p.ballsBowled ? (p.runsConceded / (p.ballsBowled/6 || 1)).toFixed(2) : '0.00';
      const li = document.createElement('div');
      li.textContent = `${p.name} — O: ${overs} R: ${p.runsConceded} W: ${p.wickets} Econ: ${eco}`;
      bowlPanel.appendChild(li);
    });
    scoreboard.appendChild(bowlPanel);
  }

  function renderDeliveryLog(){
    deliveryLog.innerHTML = '';
    match.deliveries.slice().reverse().forEach(d=>{
      const li = document.createElement('li');
      li.textContent = `Over ${d.over}.${d.ballInOver}: ${d.striker} vs ${d.bowler} — ${formatDelivery(d)}`;
      deliveryLog.appendChild(li);
    });
  }

  function formatDelivery(d){
    if (d.outcome === 'wide' || d.outcome === 'noball' || d.outcome === 'bye' || d.outcome === 'legbye' || d.outcome === 'penalty'){
      return `${capitalize(d.outcome)} +${d.runs}`;
    }
    if (d.outcome && d.outcome.startsWith('w_')){
      return `Wicket (${d.dismissed ? d.dismissed.whom + ' - ' + d.dismissed.kind : 'unknown'})`;
    }
    return `${d.runs}`;
  }

  function capitalize(s){
    return s && s.charAt(0).toUpperCase() + s.slice(1);
  }

})();