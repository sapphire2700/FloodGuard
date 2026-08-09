(function(){
  /* ===================== Config ===================== */
  const THRESHOLDS = [
    {key:'normal',   name:'Normal',   min:0,  color:'#31c48d', desc:'No action needed'},
    {key:'alert',    name:'Alert',    min:45, color:'#f5a623', desc:'Monitor closely, notify MDRRMO'},
    {key:'critical', name:'Critical', min:70, color:'#e8563f', desc:'Sound siren, SMS residents'},
    {key:'evacuate', name:'Evacuate', min:95, color:'#c81e4a', desc:'Close site, initiate evacuation'},
  ];
  const TUBE_MAX_CM = 120;

  const CAUSES = [
    {key:'upstream', label:'Upstream Watershed Runoff', icon:'<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15c1.8-3.2 3.9-4.7 7-4.7 2.8 0 4.6 1.2 7 4.7"/><path d="M7 12c1.4-2 2.4-3.4 4.2-4.2"/><path d="M12 10.3c1.2-1.4 2.3-2.6 4.1-3.5"/></svg>',
     origin:'Mt. Isarog upper catchment · est. 40–70 min lag to Bilog Falls',
     desc:'The upstream rain-gauge station is spiking well ahead of the local one, and the rise here follows the typical upstream lag time. This points to sustained heavy rainfall over the Mt. Isarog upper catchment draining down into Bilog Falls.',
     up:[70,110], loc:[5,20], soil:[55,75]},
    {key:'local', label:'Direct Local Rainfall', icon:'<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15c0-2.2 1.8-4 4-4 1.4 0 2.6.7 3.3 1.8"/><path d="M6 18c1.2-1.6 2.5-2.3 4.3-2.3"/><path d="M13 17c1.1-1.1 1.9-1.7 3.4-2"/></svg>',
     origin:'Directly over Barangay Cabotonan &amp; the falls',
     desc:'The local rain gauge at the falls is registering intense rainfall with almost no lag before the water level responds. The rise is most likely being driven by rainfall falling directly over the immediate catchment, not upstream inflow.',
     up:[5,20], loc:[65,100], soil:[45,65]},
    {key:'combined', label:'Combined Upstream + Local Rainfall', icon:'<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 15c0-2.3 1.7-4.2 4-4.2 1.5 0 2.8.8 3.5 2"/><path d="M6 17c1.2-1.4 2.4-2.1 4-2.1"/><path d="M14 16c1.1-1 2-1.5 3.3-1.7"/><path d="M5 9c1.6-2 3.2-3 5.4-3.5"/></svg>',
     origin:'Mt. Isarog catchment and Cabotonan vicinity, simultaneously',
     desc:'Both the upstream and local rain gauges are elevated at the same time, so upstream discharge and direct local rainfall appear to be compounding each other. This combination typically produces the fastest rates of rise.',
     up:[55,90], loc:[45,80], soil:[65,88]},
    {key:'blockage', label:'Possible Debris / Channel Blockage', icon:'<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14"/><path d="M8 8V6h8v2"/><path d="M9 8v8a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8"/><path d="M7 18h10"/></svg>',
     origin:'Downstream channel near the falls',
     desc:'The rate of rise is outpacing what current rainfall readings alone would predict. This pattern is consistent with a partial blockage — fallen debris, siltation, or vegetation restricting outflow near the falls — and should be visually verified on-site.',
     up:[15,35], loc:[10,30], soil:[30,50]},
  ];
  function randRange(a,b){ return a + Math.random()*(b-a); }

  let level = 32, target = 32, wavePhase = 0;
  let history = [];
  let currentCause = null;
  let rainUp = 3, rainLoc = 2, soilSat = 26;
  let rainUpT = 3, rainLocT = 2, soilSatT = 26;
  let alertsToday = 0;
  let lastStatusKey = 'normal';
  let currentUser = null; // {name, role}
  let alertIdCounter = 0;

  const $ = (id) => document.getElementById(id);

  /* ===================== Toast ===================== */
  function toast(msg){
    const wrap = $('toastWrap');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 3200);
  }

  const TELEMETRY_API = 'http://localhost:3000/api/telemetry';
  let telemetrySyncing = false;

  function setTelemetryState(online, text){
    const pill = $('connPill');
    pill.classList.toggle('offline', !online);
    $('connText').textContent = text;
  }

  async function syncTelemetry(){
    if(telemetrySyncing) return;
    telemetrySyncing = true;
    try {
      const st = statusForLevel(level);
      const response = await fetch(TELEMETRY_API, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          deviceId:'floodguard-web',
          levelCm:Number(level.toFixed(1)),
          status: st.name,
          timestamp:new Date().toISOString()
        })
      });
      const data = await response.json().catch(() => ({}));
      if(response.ok && data.ok){
        setTelemetryState(true, 'LIVE SYNC');
        $('lastUpdate').textContent = 'synced to backend · just now';
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (err) {
      console.warn('Telemetry sync failed', err);
      setTelemetryState(false, 'OFFLINE');
    } finally {
      telemetrySyncing = false;
    }
  }

  /* ===================== Clock ===================== */
  function tickClock(){
    const d = new Date();
    $('clockTime').textContent = d.toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    $('clockDate').textContent = d.toLocaleDateString('en-PH', {day:'2-digit', month:'short', year:'numeric'});
  }
  tickClock(); setInterval(tickClock, 1000);

  /* ===================== LOGIN ===================== */
  let selectedRole = 'mdrrmo';
  $('roleCardMdrrmo').addEventListener('click', () => selectRole('mdrrmo'));
  $('roleCardBarangay').addEventListener('click', () => selectRole('barangay'));
  function selectRole(role){
    selectedRole = role;
    $('roleCardMdrrmo').classList.toggle('selected', role==='mdrrmo');
    $('roleCardBarangay').classList.toggle('selected', role==='barangay');
  }

  function showAuthScreen(screen){
    const signup = screen === 'signup';
    $('loginScreen').style.display = signup ? 'none' : 'flex';
    $('signupScreen').hidden = !signup;
    if(signup) $('signupName').focus(); else $('loginName').focus();
  }

  document.querySelectorAll('[data-password-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.passwordToggle);
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.classList.toggle('is-visible', visible);
      button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', String(visible));
      button.textContent = visible ? '🙈' : '👁';
    });
  });

  $('showSignupBtn').addEventListener('click', () => showAuthScreen('signup'));
  $('showLoginBtn').addEventListener('click', () => showAuthScreen('login'));

  $('loginBtn').addEventListener('click', () => {
    const nameInput = $('loginName').value.trim();
    const name = nameInput || (selectedRole==='mdrrmo' ? 'Juan Dela Cruz' : 'Maria Santos');
    currentUser = { name, role: selectedRole==='mdrrmo' ? 'MDRRMO Personnel' : 'Barangay Official', roleKey: selectedRole };
    doLogin();
  });
  $('loginName').addEventListener('keydown', (e) => { if(e.key==='Enter') $('loginBtn').click(); });
  $('loginPassword').addEventListener('keydown', (e) => { if(e.key==='Enter') $('loginBtn').click(); });

  $('signupBtn').addEventListener('click', () => {
    const name = $('signupName').value.trim();
    const password = $('signupPassword').value;
    const confirmation = $('signupConfirmPassword').value;
    if(!name) return toast('Please enter your full name.');
    if(password.length < 6) return toast('Password must have at least 6 characters.');
    if(password !== confirmation) return toast('Passwords do not match.');
    const roleKey = $('signupRole').value;
    currentUser = { name, role: roleKey==='mdrrmo' ? 'MDRRMO Personnel' : 'Barangay Official', roleKey };
    $('signupPassword').value = '';
    $('signupConfirmPassword').value = '';
    doLogin();
  });

  $('logoutBtn').addEventListener('click', () => {
    currentUser = null;
    $('appShell').classList.remove('active');
    showAuthScreen('login');
    $('loginName').value = '';
    $('loginPassword').value = '';
    toast('Logged out successfully.');
  });

  function initials(name){
    return name.split(' ').filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join('');
  }

  function doLogin(){
    $('loginScreen').style.display = 'none';
    $('appShell').classList.add('active');
    $('userAvatar').textContent = initials(currentUser.name);
    $('userName').textContent = currentUser.name;
    $('userRole').textContent = currentUser.role;
    renderHero();
    renderForecast();
    renderDecisionSupport();
    showView('dashboard');
    toast('Welcome, ' + currentUser.name.split(' ')[0] + '.');
  }

  /* ===================== Role-specific dashboard hero ===================== */
  function renderHero(){
    const box = $('roleHero');
    const activeAlerts = alertsToday > 0 && lastStatusKey !== 'normal' ? 1 : 0;

    if(currentUser.roleKey === 'mdrrmo'){
      box.innerHTML = `
        <div class="role-hero mdrrmo">
          <div class="eyebrow">Municipal Disaster Risk Reduction &amp; Management Office</div>
          <h1>Lagonoy Operations Console</h1>
          <p>Municipal-wide view of flood monitoring stations, response coordination, and disaster preparedness for Lagonoy, Camarines Sur.</p>
          <div class="hero-stats">
            <div class="hstat"><div class="k">Stations monitored</div><div class="v">1 / 1</div></div>
            <div class="hstat"><div class="k">Barangays covered</div><div class="v">Cabotonan</div></div>
            <div class="hstat"><div class="k">Personnel on standby</div><div class="v">6</div></div>
            <div class="hstat"><div class="k">Active alerts</div><div class="v" style="color:${activeAlerts?'#e8563f':'#31c48d'}">${activeAlerts}</div></div>
          </div>
          <div class="hero-actions">
            <button class="primary btn-with-icon" id="btnDispatch"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10"/><path d="M4 11h7"/><path d="M4 15h10"/><path d="M17 5v14l4-4"/></svg>Dispatch response team</button>
            <button class="btn-with-icon" id="btnBroadcast"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h8"/><path d="M5 8h12"/><path d="M5 16h6"/><path d="M17 6v12l4-4"/></svg>Broadcast municipal advisory</button>
            <button class="gold btn-with-icon" id="btnHeroReport"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>Generate incident report</button>
          </div>
        </div>`;
      $('btnDispatch').addEventListener('click', () => toast('Response team dispatched to Bilog Falls.'));
      $('btnBroadcast').addEventListener('click', () => toast('Municipal advisory broadcast to all barangay channels.'));
      $('btnHeroReport').addEventListener('click', () => showView('reports'));
    } else {
      box.innerHTML = `
        <div class="role-hero barangay">
          <div class="eyebrow">Barangay Cabotonan · Community Disaster Watch</div>
          <h1>Barangay Official Console</h1>
          <p>Local monitoring and resident communication for Bilog Falls, the community's primary flood-safety concern.</p>
          <div class="hero-stats">
            <div class="hstat"><div class="k">Residents subscribed</div><div class="v">184</div></div>
            <div class="hstat"><div class="k">Evacuation center</div><div class="v" style="color:#31c48d">Ready</div></div>
            <div class="hstat"><div class="k">Falls → barangay proper</div><div class="v">1.8 km</div></div>
            <div class="hstat"><div class="k">Last community drill</div><div class="v" style="font-size:0.95rem">May 2026</div></div>
          </div>
          <div class="hero-actions">
            <button class="primary btn-with-icon" id="btnNotify"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3V7a1 1 0 0 1 1-1Z"/><path d="m8 10 3 2 3-2"/></svg>Notify residents via SMS</button>
            <button class="btn-with-icon" id="btnEvac"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20H4Z"/><path d="M9 20v-4h6v4"/></svg>View evacuation center status</button>
            <button class="btn-with-icon" id="btnEscalate"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5h6v6"/><path d="M19 5 10 14"/><path d="M5 19h8"/></svg>Escalate to MDRRMO</button>
          </div>
        </div>`;
      $('btnNotify').addEventListener('click', () => toast('SMS advisory queued for 184 subscribed residents.'));
      $('btnEvac').addEventListener('click', () => toast('Evacuation Center (Cabotonan Barangay Hall): Ready · capacity 120.'));
      $('btnEscalate').addEventListener('click', () => toast('Escalation sent to MDRRMO Lagonoy.'));
    }
  }

  /* ===================== Nav / view switching ===================== */
  const VIEW_LABELS = {
    dashboard:'Dashboard', historical:'Historical Records', alerts:'Alert Logs',
    thresholds:'Threshold Levels', users:'Manage Users', reports:'Generate Reports'
  };
  function setMobileMenu(open){
    const menu = $('sidebarMenu');
    $('menuToggle').setAttribute('aria-expanded', String(open));
    $('menuToggle').setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    menu.classList.toggle('mobile-open', open);
  }

  $('menuToggle').addEventListener('click', () => {
    setMobileMenu(!$('sidebarMenu').classList.contains('mobile-open'));
  });
  window.addEventListener('resize', () => { if(window.innerWidth > 860) setMobileMenu(false); });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
      if(window.innerWidth <= 860) setMobileMenu(false);
    });
  });
  function showView(key){
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view===key));
    $('view-'+key).classList.add('active');
    $('viewTitleText').textContent = VIEW_LABELS[key];
    if(key==='historical'){ drawChartOn($('historyChart')); renderHistoryTable(); }
    if(key==='thresholds'){ renderThresholds(); }
  }

  /* ===================== Thresholds ===================== */
  function statusForLevel(v){
    let s = THRESHOLDS[0];
    for(const t of THRESHOLDS){ if(v >= t.min) s = t; }
    return s;
  }
  function renderThresholds(){
    const wrap = $('thresholdList');
    wrap.innerHTML = '';
    THRESHOLDS.forEach(t => {
      if(t.key === 'normal') return;
      const row = document.createElement('div');
      row.className = 'th-row';
      row.innerHTML = `
        <span class="th-dot" style="background:${t.color}"></span>
        <span><span class="th-name">${t.name}</span><span class="th-desc">${t.desc}</span></span>
        <input type="range" min="20" max="119" value="${t.min}" id="range-${t.key}">
        <span class="th-val" id="val-${t.key}">${t.min} cm</span>
      `;
      wrap.appendChild(row);
      row.querySelector('input').addEventListener('input', (e) => {
        t.min = parseInt(e.target.value, 10);
        row.querySelector('.th-val').textContent = t.min + ' cm';
        drawTube(); drawChartOn($('trendChart'));
      });
    });
  }
  renderThresholds();

  /* ===================== Source & cause diagnosis ===================== */
  function pickCause(){
    currentCause = CAUSES[Math.floor(Math.random()*CAUSES.length)];
    rainUpT = randRange(currentCause.up[0], currentCause.up[1]);
    rainLocT = randRange(currentCause.loc[0], currentCause.loc[1]);
    soilSatT = randRange(currentCause.soil[0], currentCause.soil[1]);
  }
  function clearCause(){
    currentCause = null;
    rainUpT = 2 + Math.random()*4;
    rainLocT = 2 + Math.random()*4;
    soilSatT = 20 + Math.random()*10;
  }
  function metricClass(v, warnAt, critAt){
    return v >= critAt ? 'crit' : v >= warnAt ? 'warn' : 'ok';
  }
  function renderSourceCard(){
    const wrap = $('sourceBody');
    if(!wrap) return;
    const metricsHTML = `
      <div class="source-metrics">
        <div class="stat"><div class="k">Upstream rainfall</div><div class="v ${metricClass(rainUp,20,55)}">${rainUp.toFixed(0)} mm/hr</div><div class="sub">Mt. Isarog gauge</div></div>
        <div class="stat"><div class="k">Local rainfall</div><div class="v ${metricClass(rainLoc,20,55)}">${rainLoc.toFixed(0)} mm/hr</div><div class="sub">Falls-side gauge</div></div>
        <div class="stat"><div class="k">Soil saturation</div><div class="v ${metricClass(soilSat,50,70)}">${soilSat.toFixed(0)}%</div><div class="sub">catchment estimate</div></div>
      </div>`;
    if(!currentCause){
      wrap.innerHTML = `
        <div class="source-primary normal">
          <div class="s-icon">✅</div>
          <div>
            <div class="s-label">No significant inflow detected</div>
            <div class="s-origin">Water level within baseline range</div>
            <div class="s-desc">Rain-gauge and flow-rate telemetry show no unusual rainfall or discharge, upstream or locally. Current fluctuations are within normal sensor noise.</div>
          </div>
        </div>${metricsHTML}`;
      return;
    }
    const c = currentCause;
    wrap.innerHTML = `
      <div class="source-primary">
        <div class="s-icon">${c.icon}</div>
        <div>
          <div class="s-label">${c.label}</div>
          <div class="s-origin">📍 ${c.origin}</div>
          <div class="s-desc">${c.desc}</div>
        </div>
      </div>${metricsHTML}
      <div class="source-confidence">Auto-diagnosed from rain-gauge &amp; rate-of-rise correlation (simulated) · confidence <b>${(72+Math.random()*20).toFixed(0)}%</b></div>`;
  }
  renderSourceCard();

  /* ===================== Predictive Flood Forecast (2.4) =====================
     Lightweight short-term linear regression over the most recent sensor
     readings — chosen (per Crucillo et al., 2026 and Byaruhanga et al., 2024)
     because it does not require years of historical hydrological data, unlike
     heavier ML forecasting approaches. */
  function computeForecast(){
    const N = Math.min(10, history.length);
    if(N < 4) return null;
    const pts = history.slice(-N);
    const t0 = pts[0].t;
    const xs = pts.map(p => (p.t - t0) / 60000); // minutes since window start
    const ys = pts.map(p => p.v);
    const n = xs.length;
    const sumX = xs.reduce((a,b)=>a+b,0);
    const sumY = ys.reduce((a,b)=>a+b,0);
    const sumXY = xs.reduce((a,x,i)=>a + x*ys[i], 0);
    const sumXX = xs.reduce((a,x)=>a + x*x, 0);
    const denom = (n*sumXX - sumX*sumX);
    const slope = denom !== 0 ? (n*sumXY - sumX*sumY) / denom : 0; // cm per minute
    return { slopeCmPerMin: slope, windowSize: n };
  }

  function renderForecast(){
    const wrap = $('forecastBody');
    if(!wrap) return;
    const fc = computeForecast();
    const nextT = THRESHOLDS.find(t => t.min > level);
    const rising = fc && fc.slopeCmPerMin > 0.3;

    if(!rising){
      wrap.innerHTML = `
        <div class="forecast-headline">
          <div class="f-icon">📉</div>
          <div>
            <div class="f-title">No significant rise projected</div>
            <div class="f-sub">The short-term trend from the last ${fc?fc.windowSize:0} readings is steady or falling.${nextT ? ' No threshold breach is currently projected if this trend continues.' : ''}</div>
          </div>
        </div>
        <div class="forecast-metrics">
          <div class="stat"><div class="k">Rate of change</div><div class="v ok">${fc? fc.slopeCmPerMin.toFixed(2):'0.00'} cm/min</div><div class="sub">last ${fc?fc.windowSize:0} readings</div></div>
          <div class="stat"><div class="k">Next threshold</div><div class="v">${nextT ? nextT.name : '—'}</div><div class="sub">${nextT ? (nextT.min - level).toFixed(0)+' cm away' : 'at max tier'}</div></div>
          <div class="stat"><div class="k">Projected ETA</div><div class="v">—</div><div class="sub">not applicable</div></div>
        </div>
        <div class="forecast-note">Method: short-term linear regression over the most recent sensor readings (no rainfall-model dependency required).</div>`;
      return;
    }

    const etaMin = nextT ? Math.max(0, (nextT.min - level) / fc.slopeCmPerMin) : null;
    const isCriticalPath = nextT && (nextT.key === 'critical' || nextT.key === 'evacuate') && etaMin !== null && etaMin < 20;
    const headlineClass = isCriticalPath ? 'forecast-headline critical-path' : 'forecast-headline rising';

    wrap.innerHTML = `
      <div class="${headlineClass}">
        <div class="f-icon">${isCriticalPath ? '⚠️' : '📈'}</div>
        <div>
          <div class="f-title">${nextT ? `Water level projected to reach ${nextT.name.toUpperCase()} in ~${etaMin.toFixed(0)} min` : 'Water level rising, already at maximum monitored tier'}</div>
          <div class="f-sub">At the current rate of rise (${fc.slopeCmPerMin.toFixed(2)} cm/min, from the last ${fc.windowSize} readings), the sensor trend is climbing${nextT? ` toward the ${nextT.name} threshold (${nextT.min} cm)` : ''}. Cross-check against the Probable Water Source panel before acting.</div>
        </div>
      </div>
      <div class="forecast-metrics">
        <div class="stat"><div class="k">Rate of change</div><div class="v warn">+${fc.slopeCmPerMin.toFixed(2)} cm/min</div><div class="sub">last ${fc.windowSize} readings</div></div>
        <div class="stat"><div class="k">Next threshold</div><div class="v">${nextT ? nextT.name : '—'}</div><div class="sub">${nextT ? (nextT.min - level).toFixed(0)+' cm away' : 'at max tier'}</div></div>
        <div class="stat"><div class="k">Projected ETA</div><div class="v ${isCriticalPath?'crit':'warn'}">${nextT && etaMin!==null ? '~'+etaMin.toFixed(0)+' min' : '—'}</div><div class="sub">${nextT ? 'if trend continues' : 'n/a'}</div></div>
      </div>
      <div class="forecast-note">Method: short-term linear regression over the most recent sensor readings — a lightweight technique that avoids the large historical datasets heavier ML forecasting models require.</div>`;
  }
  renderForecast();

  /* ===================== Decision-Support Layer (2.5) =====================
     Translates the current status + forecast into an actionable recommendation
     for the logged-in role, rather than a bare threshold-crossed alarm. */
  const DECISION_MATRIX = {
    normal: {
      mdrrmo: ['Continue routine monitoring of the Bilog Falls sensor feed.', 'No dispatch or municipal advisory action required at this time.'],
      barangay: ['Continue routine advisory to residents and visitors.', 'No evacuation or site-closure action required at this time.']
    },
    alert: {
      mdrrmo: ['Notify Barangay Cabotonan officials that water level has reached Alert.', 'Place the response team on standby.', 'Monitor the upstream and local rain gauges for trend confirmation.'],
      barangay: ["Alert on-duty barangay tanods stationed near the falls.", "Advise hikers and swimmers to stay clear of the water's edge.", 'Relay updates to MDRRMO if the level continues to rise.']
    },
    critical: {
      mdrrmo: ['Dispatch the response team to Bilog Falls immediately.', 'Coordinate the SMS alert to all registered residents.', 'Prepare the evacuation center for possible activation.'],
      barangay: ['Confirm the on-site siren has sounded and is audible at the falls.', 'Direct all hikers and swimmers to leave the water immediately.', 'Open the evacuation center and stand by for MDRRMO coordination.']
    },
    evacuate: {
      mdrrmo: ['Declare a formal evacuation for the Bilog Falls area.', 'Close the access trail and post personnel to prevent entry.', 'Confirm with barangay officials that all visitors have left the site.'],
      barangay: ['Execute the evacuation protocol for residents near the falls.', 'Move residents and visitors to the Cabotonan Barangay Hall evacuation center.', 'Report evacuation status back to MDRRMO Lagonoy.']
    }
  };

  function renderDecisionSupport(){
    const wrap = $('decisionSupportBody');
    if(!wrap || !currentUser) return;
    const st = statusForLevel(level);
    const fc = computeForecast();
    const nextT = THRESHOLDS.find(t => t.min > level);
    const etaMin = (fc && fc.slopeCmPerMin > 0.3 && nextT) ? Math.max(0,(nextT.min - level) / fc.slopeCmPerMin) : null;

    $('dsRoleTag').textContent = 'for ' + currentUser.role;

    const actions = (DECISION_MATRIX[st.key] && DECISION_MATRIX[st.key][currentUser.roleKey]) || [];
    const preemptive = (etaMin !== null && etaMin < 15 && st.key !== 'evacuate')
      ? [`Forecast shows the next threshold may be reached in ~${etaMin.toFixed(0)} min — begin preparing the next-tier response now rather than waiting for the threshold to be crossed.`]
      : [];
    const fullList = [...preemptive, ...actions];
    const priorityColor = (st.key === 'evacuate' || st.key === 'critical') ? 'var(--crit)' : st.key === 'alert' ? 'var(--warn)' : 'var(--ok)';

    wrap.innerHTML = `
      <span class="ds-priority" style="color:${priorityColor}">${st.name} priority</span>
      <ul class="ds-list">
        ${fullList.map((a,i) => `<li><span class="n">${i+1}</span><span>${a}</span></li>`).join('')}
      </ul>
      <div class="ds-basis">Recommendation translates the current sensor status and short-term forecast into an actionable response, rather than a threshold-crossed alarm alone.</div>`;
  }

  /* ===================== Tube gauge ===================== */
  const tubeCanvas = $('tubeCanvas');
  const tctx = tubeCanvas.getContext('2d');

  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function drawTube(){
    const W = tubeCanvas.width, H = tubeCanvas.height;
    tctx.clearRect(0,0,W,H);
    const tubeX = 60, tubeW = 60, tubeTop = 20, tubeBottom = H - 40;
    const tubeH = tubeBottom - tubeTop;

    tctx.save();
    roundRect(tctx, tubeX-4, tubeTop-4, tubeW+8, tubeH+8, 16);
    tctx.fillStyle = 'rgba(255,255,255,0.03)';
    tctx.fill();
    tctx.strokeStyle = '#243a72';
    tctx.lineWidth = 1.5;
    tctx.stroke();

    tctx.save();
    roundRect(tctx, tubeX, tubeTop, tubeW, tubeH, 12);
    tctx.clip();

    THRESHOLDS.forEach(t => {
      const yFrom = tubeBottom - Math.min(t.min, TUBE_MAX_CM)/TUBE_MAX_CM*tubeH;
      tctx.fillStyle = t.color + '14';
      tctx.fillRect(tubeX, tubeTop, tubeW, yFrom - tubeTop);
    });

    const pct = Math.min(level, TUBE_MAX_CM) / TUBE_MAX_CM;
    const waterY = tubeBottom - pct*tubeH;
    const st = statusForLevel(level);

    const grad = tctx.createLinearGradient(0, waterY, 0, tubeBottom);
    grad.addColorStop(0, st.color + 'cc');
    grad.addColorStop(1, st.color + '55');
    tctx.fillStyle = grad;

    tctx.beginPath();
    tctx.moveTo(tubeX, tubeBottom+10);
    tctx.lineTo(tubeX, waterY);
    for(let x=0; x<=tubeW; x+=4){
      const y = waterY + Math.sin((x*0.18)+wavePhase) * 3.2;
      tctx.lineTo(tubeX+x, y);
    }
    tctx.lineTo(tubeX+tubeW, tubeBottom+10);
    tctx.closePath();
    tctx.fill();
    tctx.restore();

    THRESHOLDS.forEach(t => {
      if(t.min <= 0 || t.min > TUBE_MAX_CM) return;
      const y = tubeBottom - t.min/TUBE_MAX_CM*tubeH;
      tctx.strokeStyle = t.color;
      tctx.globalAlpha = 0.8;
      tctx.setLineDash([3,3]);
      tctx.beginPath(); tctx.moveTo(tubeX-4, y); tctx.lineTo(tubeX+tubeW+4, y); tctx.stroke();
      tctx.setLineDash([]); tctx.globalAlpha = 1;
      tctx.fillStyle = t.color;
      tctx.font = '600 10px "IBM Plex Mono", monospace';
      tctx.textAlign = 'left';
      tctx.fillText(t.name.toUpperCase(), tubeX+tubeW+10, y+3);
    });

    tctx.fillStyle = '#d4af37';
    roundRect(tctx, tubeX+tubeW/2-14, 0, 28, 18, 4);
    tctx.fill();
    tctx.fillStyle = '#060c1e';
    tctx.font = '700 8px monospace';
    tctx.textAlign='center';
    tctx.fillText('SNSR', tubeX+tubeW/2, 12);
    tctx.restore();
  }

  /* ===================== Trend chart (generic, used by 2 canvases) ===================== */
  function seedHistory(){
    const now = Date.now();
    for(let i=39;i>=0;i--){
      history.push({t: now - i*5*60000, v: 30 + Math.sin(i/4)*4 + Math.random()*3});
    }
  }
  seedHistory();

  function drawChartOn(canvas){
    if(!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.parentElement.clientWidth || 600;
    canvas.width = w * devicePixelRatio;
    canvas.height = 230 * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);

    const W = w, H = 230, padL = 34, padR = 14, padT = 14, padB = 22;
    ctx.clearRect(0,0,W,H);
    const maxV = TUBE_MAX_CM, minV = 0;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    THRESHOLDS.forEach(t => {
      if(t.min<=0) return;
      const y = padT + plotH - (t.min-minV)/(maxV-minV)*plotH;
      ctx.strokeStyle = t.color + '55';
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = t.color;
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(t.name, padL+4, y-4);
    });

    ctx.fillStyle = '#7385b3';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    for(let v=0; v<=maxV; v+=30){
      const y = padT + plotH - (v-minV)/(maxV-minV)*plotH;
      ctx.fillText(v+'', padL-8, y+3);
    }

    ctx.beginPath();
    history.forEach((p,i) => {
      const x = padL + (i/(history.length-1))*plotW;
      const y = padT + plotH - (p.v-minV)/(maxV-minV)*plotH;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = '#6fd0f2';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const last = history[history.length-1];
    const lastX = padL+plotW, lastY = padT + plotH - (last.v-minV)/(maxV-minV)*plotH;
    ctx.lineTo(lastX, padT+plotH);
    ctx.lineTo(padL, padT+plotH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0,padT,0,padT+plotH);
    g.addColorStop(0,'rgba(111,208,242,0.28)');
    g.addColorStop(1,'rgba(111,208,242,0)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI*2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  window.addEventListener('resize', () => {
    drawChartOn($('trendChart'));
    if($('view-historical').classList.contains('active')) drawChartOn($('historyChart'));
  });

  /* ===================== Historical records table ===================== */
  function renderHistoryTable(){
    const body = $('historyBody');
    body.innerHTML = '';
    const rows = history.slice().reverse();
    rows.forEach(p => {
      const st = statusForLevel(p.v);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:'IBM Plex Mono',monospace">${new Date(p.t).toLocaleString('en-PH',{hour12:false})}</td>
        <td style="font-family:'IBM Plex Mono',monospace">${p.v.toFixed(1)} cm</td>
        <td><span class="lvl-chip" style="background:${st.color}22; color:${st.color}; border:1px solid ${st.color}66">${st.name}</span></td>
      `;
      body.appendChild(tr);
    });
    $('historyCount').textContent = rows.length + ' records';
  }

  /* ===================== Alerts (full + mini) ===================== */
  function fireChannel(id, stateId, label, delay){
    const el = $(id), stateEl = $(stateId);
    el.classList.add('active');
    stateEl.textContent = 'sending…';
    setTimeout(() => { stateEl.textContent = label; }, delay);
  }
  function resetChannels(){
    ['chanDash','chanSMS','chanSiren'].forEach(id => $(id).classList.remove('active'));
    $('chanDashState').textContent='idle'; $('chanSMSState').textContent='idle'; $('chanSirenState').textContent='idle';
    $('sirenRing').classList.remove('on');
  }

  /* ---- Alert & evacuation tracking (Objective f: monitoring alert
     dissemination and community response) ---- */
  $('alertLogBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-evac]');
    if(!btn) return;
    const chip = $('chip-' + btn.dataset.evac);
    if(!chip) return;
    if(chip.textContent === 'Pending'){
      chip.textContent = 'Initiated';
      chip.style.background = THRESHOLDS.find(t=>t.key==='critical').color + '22';
      chip.style.color = THRESHOLDS.find(t=>t.key==='critical').color;
      btn.textContent = 'Mark completed';
      toast('Evacuation marked as initiated.');
    } else if(chip.textContent === 'Initiated'){
      chip.textContent = 'Completed';
      chip.style.background = THRESHOLDS.find(t=>t.key==='normal').color + '22';
      chip.style.color = THRESHOLDS.find(t=>t.key==='normal').color;
      btn.remove();
      toast('Evacuation marked as completed.');
    }
  });

  function logAlert(st, v){
    const time = new Date().toLocaleTimeString('en-PH',{hour12:false});
    const chanHTML = `
      <span class="chan sent">🖥️ Dashboard</span>
      ${st.key!=='alert' ? '<span class="chan sent">✉️ SMS</span>' : ''}
      ${(st.key==='critical'||st.key==='evacuate') ? '<span class="chan sent">🔊 Siren</span>' : ''}
    `;
    const chip = `<span class="lvl-chip" style="background:${st.color}22; color:${st.color}; border:1px solid ${st.color}66">${st.name}</span>`;

    // full log
    const body = $('alertLogBody');
    const empty1 = body.querySelector('.empty-row'); if(empty1) empty1.remove();
    const causeHTML = currentCause
      ? `<span class="cause-chip">${currentCause.icon} ${currentCause.label}</span>`
      : `<span class="cause-chip" style="opacity:0.6">— baseline —</span>`;

    alertIdCounter++;
    const evacId = 'ev' + alertIdCounter;
    const needsEvac = (st.key === 'critical' || st.key === 'evacuate');
    const evacHTML = needsEvac
      ? `<span class="evac-chip" id="chip-${evacId}" style="background:${st.color}22; color:${st.color}">Pending</span><button class="evac-btn" data-evac="${evacId}">Mark initiated</button>`
      : `<span class="evac-chip" style="background:rgba(115,133,179,0.15); color:var(--ink-2)">Not required</span>`;

    const tr = document.createElement('tr'); tr.className='fade-in';
    tr.innerHTML = `
      <td style="font-family:'IBM Plex Mono',monospace">${time}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${v.toFixed(1)} cm</td>
      <td>${chip}</td>
      <td>${causeHTML}</td>
      <td>${chanHTML}</td>
      <td style="color:#31c48d">Delivered · ${(2+Math.random()*2).toFixed(1)}s</td>
      <td>${evacHTML}</td>`;
    body.prepend(tr);
    while(body.children.length > 60) body.removeChild(body.lastChild);

    // mini log (dashboard)
    const mini = $('miniAlertBody');
    const empty2 = mini.querySelector('.empty-row'); if(empty2) empty2.remove();
    const tr2 = document.createElement('tr'); tr2.className='fade-in';
    tr2.innerHTML = `
      <td style="font-family:'IBM Plex Mono',monospace">${time}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${v.toFixed(1)} cm</td>
      <td>${chip}</td>`;
    mini.prepend(tr2);
    while(mini.children.length > 4) mini.removeChild(mini.lastChild);

    alertsToday++;
    $('alertCountStat').textContent = alertsToday;
    $('latencyStat').textContent = (2+Math.random()*2).toFixed(1)+'s';
    if(currentUser) renderHero();
  }

  /* ===================== Main tick ===================== */
  function updateBadge(st){
    const badge = $('statusBadge');
    badge.textContent = st.name.toUpperCase();
    badge.style.color = st.color;
    badge.style.background = st.color + '18';
  }
  function updateMeta(prevLevel){
    const st = statusForLevel(level);
    const nextT = THRESHOLDS.find(t => t.min > level);
    $('distToCrit').textContent = nextT ? (nextT.min - level).toFixed(0)+' cm to '+nextT.name : '—';
    const diff = level - prevLevel;
    $('trendVal').textContent = diff > 0.4 ? 'rising ↑' : diff < -0.4 ? 'falling ↓' : 'steady';
    const batt = Math.max(55, 92 - alertsToday*1.2 - (Date.now()%9000)/9000*2);
    $('battVal').textContent = batt.toFixed(0)+'%';
    $('battVal').className = 'v ' + (batt > 70 ? 'good':'mid');
    $('lastUpdate').textContent = 'updated just now';
  }

  function tick(){
    const noise = (Math.random()-0.5) * 1.6;
    level += (target - level) * 0.08 + noise;
    level = Math.max(4, Math.min(118, level));

    const prevLevel = history.length ? history[history.length-1].v : level;
    history.push({t: Date.now(), v: level});
    if(history.length > 40) history.shift();
    wavePhase += 0.25;

    const st = statusForLevel(level);
    $('levelValue').textContent = level.toFixed(1);
    updateBadge(st);
    updateMeta(prevLevel);
    drawTube();
    drawChartOn($('trendChart'));

    rainUp += (rainUpT - rainUp) * 0.15 + (Math.random()-0.5) * 1.2;
    rainLoc += (rainLocT - rainLoc) * 0.15 + (Math.random()-0.5) * 1.0;
    soilSat += (soilSatT - soilSat) * 0.1 + (Math.random()-0.5) * 0.8;
    rainUp = Math.max(0, rainUp);
    rainLoc = Math.max(0, rainLoc);
    soilSat = Math.min(100, Math.max(0, soilSat));
    renderSourceCard();
    renderForecast();
    if(currentUser) renderDecisionSupport();
    if($('view-historical').classList.contains('active')){ drawChartOn($('historyChart')); renderHistoryTable(); }

    if(st.key !== lastStatusKey){
      resetChannels();
      if(st.key !== 'normal'){
        fireChannel('chanDash','chanDashState','notified', 600);
        if(st.key !== 'alert'){
          fireChannel('chanSMS','chanSMSState','sent · '+Math.floor(20+Math.random()*40)+' recipients', 1400);
        } else { $('chanSMSState').textContent = 'idle'; }
        if(st.key === 'critical' || st.key === 'evacuate'){
          $('sirenRing').classList.add('on');
          $('chanSirenState').textContent = 'sounding';
        }
      }
      logAlert(st, level);
      lastStatusKey = st.key;
    }
  }

  drawTube();
  drawChartOn($('trendChart'));
  setInterval(tick, 1400);
  syncTelemetry();
  setInterval(syncTelemetry, 5000);

  $('btnRise').addEventListener('click', () => { target = Math.min(118, target + 35 + Math.random()*20); pickCause(); });
  $('btnCalm').addEventListener('click', () => { target = 28 + Math.random()*6; clearCause(); });

  /* ===================== Users ===================== */
  const users = [
    {name:'Nick Pempeña I', role:'MDRRMO Personnel', area:'MDRRMO Lagonoy', status:'Active'},
    {name:'John Kendric Pahoyo', role:'MDRRMO Personnel', area:'MDRRMO Lagonoy', status:'Active'},
    {name:'Rica Rose Vipinoso', role:'Barangay Official', area:'Barangay Cabotonan', status:'Active'},
    {name:'Maria Santos', role:'Barangay Official', area:'Barangay Cabotonan', status:'Active'},
  ];
  function renderUsers(){
    const body = $('usersBody');
    body.innerHTML = '';
    users.forEach((u, idx) => {
      const tr = document.createElement('tr');
      const chipClass = u.role==='Barangay Official' ? 'role-chip barangay' : 'role-chip';
      tr.innerHTML = `
        <td>${u.name}</td>
        <td><span class="${chipClass}">${u.role}</span></td>
        <td>${u.area}</td>
        <td style="color:#31c48d">${u.status}</td>
        <td><button class="remove-btn" data-idx="${idx}">Remove</button></td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(e.target.dataset.idx,10);
        users.splice(i,1); renderUsers(); toast('User removed.');
      });
    });
  }
  renderUsers();
  $('addUserBtn').addEventListener('click', () => {
    const name = $('newUserName').value.trim();
    const role = $('newUserRole').value;
    const area = $('newUserArea').value.trim() || (role==='Barangay Official' ? 'Barangay Cabotonan' : 'MDRRMO Lagonoy');
    if(!name){ toast('Enter a name before adding a user.'); return; }
    users.push({name, role, area, status:'Active'});
    $('newUserName').value=''; $('newUserArea').value='';
    renderUsers();
    toast('User added: ' + name);
  });

  /* ===================== Reports ===================== */
  $('genReportBtn').addEventListener('click', () => {
    const st = statusForLevel(level);
    const vals = history.map(h=>h.v);
    const avg = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1);
    const max = Math.max(...vals).toFixed(1);
    const now = new Date().toLocaleString('en-PH',{hour12:false});
    const fc = computeForecast();
    const nextT = THRESHOLDS.find(t => t.min > level);
    const rising = fc && fc.slopeCmPerMin > 0.3;
    const etaMin = (rising && nextT) ? Math.max(0,(nextT.min - level) / fc.slopeCmPerMin) : null;
    const forecastLine = !rising
      ? 'Steady/falling trend — no threshold breach currently projected.'
      : `Rising at ${fc.slopeCmPerMin.toFixed(2)} cm/min${nextT ? ` — projected to reach ${nextT.name} in ~${etaMin.toFixed(0)} min` : ''} (linear-regression forecast, last ${fc.windowSize} readings).`;
    const dsActions = (DECISION_MATRIX[st.key] && DECISION_MATRIX[st.key][currentUser.roleKey]) || [];
    const text =
`FLOODGUARD SUMMARY REPORT
Generated: ${now}
Generated by: ${currentUser.name} (${currentUser.role})
Station: Bilog Falls, Barangay Cabotonan, Lagonoy, Camarines Sur

CURRENT STATUS
  Water level: ${level.toFixed(1)} cm
  Status: ${st.name}

PROBABLE SOURCE & CAUSE
  ${currentCause ? currentCause.label + ' — ' + currentCause.origin.replace('&amp;','&') : 'No significant inflow detected — level within baseline range.'}
  Upstream rainfall (Mt. Isarog gauge): ${rainUp.toFixed(0)} mm/hr
  Local rainfall (falls-side gauge): ${rainLoc.toFixed(0)} mm/hr
  Soil saturation (catchment est.): ${soilSat.toFixed(0)}%
  ${currentCause ? currentCause.desc.replace('&amp;','&') : ''}

PREDICTIVE FLOOD FORECAST
  ${forecastLine}

DECISION-SUPPORT RECOMMENDATION (for ${currentUser.role})
${dsActions.map(a => '  - ' + a).join('\n')}

RECENT READINGS (last ${history.length})
  Average level: ${avg} cm
  Peak level: ${max} cm

ALERTS
  Alerts logged this session: ${alertsToday}

THRESHOLD CONFIGURATION
${THRESHOLDS.filter(t=>t.key!=='normal').map(t => '  ' + t.name + ': ' + t.min + ' cm').join('\n')}

-- End of report --`;
    $('reportPreview').textContent = text;
    $('reportPreview').classList.add('show');
    $('downloadReportBtn').disabled = false;
    $('downloadReportBtn').onclick = () => {
      const blob = new Blob([text], {type:'text/plain'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'floodguard-report.txt';
      a.click();
      URL.revokeObjectURL(url);
    };
    toast('Report generated.');
  });

})();
