const keyMap = {
  '1':'ㄅ','2':'ㄉ','3':'ˇ','4':'ˋ','5':'ㄓ','6':'ˊ','7':'˙','8':'ㄚ','9':'ㄞ','0':'ㄢ','-':'ㄦ',
  'q':'ㄆ','w':'ㄊ','e':'ㄍ','r':'ㄐ','t':'ㄔ','y':'ㄗ','u':'ㄧ','i':'ㄛ','o':'ㄟ','p':'ㄣ',
  'a':'ㄇ','s':'ㄋ','d':'ㄎ','f':'ㄑ','g':'ㄕ','h':'ㄘ','j':'ㄨ','k':'ㄜ','l':'ㄠ',';':'ㄤ',
  'z':'ㄈ','x':'ㄌ','c':'ㄏ','v':'ㄒ','b':'ㄖ','n':'ㄙ','m':'ㄩ',',':'ㄝ','.':'ㄡ','/':'ㄥ'
};

const fingers = {
  leftPinky:  { name:'左手小指', short:'小指', side:'左手', color:'#59d6aa', keys:['1','q','a','z'] },
  leftRing:   { name:'左手無名指', short:'無名指', side:'左手', color:'#5db7ee', keys:['2','w','s','x'] },
  leftMiddle: { name:'左手中指', short:'中指', side:'左手', color:'#ffc94f', keys:['3','e','d','c'] },
  leftIndex:  { name:'左手食指', short:'食指', side:'左手', color:'#ff7b79', keys:['4','5','r','t','f','g','v','b'] },
  rightIndex: { name:'右手食指', short:'食指', side:'右手', color:'#ff7b79', keys:['6','7','y','u','h','j','n','m'] },
  rightMiddle:{ name:'右手中指', short:'中指', side:'右手', color:'#ffc94f', keys:['8','i','k',','] },
  rightRing:  { name:'右手無名指', short:'無名指', side:'右手', color:'#5db7ee', keys:['9','o','l','.'] },
  rightPinky: { name:'右手小指', short:'小指', side:'右手', color:'#59d6aa', keys:['0','-','p',';','/'] }
};

const keyboardRows = [
  [spec('`','~'), key('1'),key('2'),key('3'),key('4'),key('5'),key('6'),key('7'),key('8'),key('9'),key('0'),key('-'),spec('=','='),spec('backspace','Backspace',1.7)],
  [spec('tab','Tab',1.45),key('q'),key('w'),key('e'),key('r'),key('t'),key('y'),key('u'),key('i'),key('o'),key('p'),spec('[','['),spec(']',']'),spec('\\','\\',1.15)],
  [spec('caps','Caps Lock',1.8),key('a'),key('s'),key('d'),key('f'),key('g'),key('h'),key('j'),key('k'),key('l'),key(';'),spec("'","'"),spec('enter','Enter',2.05)],
  [spec('shift','Shift',2.25),key('z'),key('x'),key('c'),key('v'),key('b'),key('n'),key('m'),key(','),key('.'),key('/'),spec('shift-r','Shift',2.65)],
  [spec('ctrl','Ctrl',.9),spec('fn','Fn',.75),spec('win','⊞',.8),spec('alt','Alt',.9),spec('space','',5.5),spec('alt-r','Alt',.9),spec('ctrl-r','Ctrl',.9),spec('arrow','◀ ▲ ▼ ▶',1.75)]
];

const bopomofoKeyMap = Object.fromEntries(Object.entries(keyMap).map(([keyValue, symbol]) => [symbol, keyValue]));
const punctuationPattern = /[，。！？、；：]/;
const completionStorageKey = 'bopomofo-arcade-completed-v2';
const leaderboardStorageKey = 'bopomofo-arcade-leaderboard-v1';
const playerStorageKey = 'bopomofo-arcade-player-v1';
const attemptStorageKey = 'bopomofo-arcade-attempts-v1';
let memoryCompletedArticles = {};
let memoryLeaderboard = { basic:[], advanced:[] };
let memoryAttempts = [];
let activeBoard = 'basic';
let article = [];
let currentArticleMeta = null;
let cloudDb = null;
let cloudAuth = null;
let cloudUser = null;
let cloudReady = Promise.resolve();
let cloudOnline = false;
let cloudWarned = false;

function key(value) { return { value, label:value.toUpperCase(), bpmf:keyMap[value], size:1 }; }
function spec(value,label,size=1) { return { value,label,size,special:true }; }
function fingerForKey(keyValue) { return Object.entries(fingers).find(([,f]) => f.keys.includes(keyValue)); }

function prepareArticle(meta) {
  const phonetics = meta.phonetics.trim().split(/\s+/); let phoneticIndex = 0;
  const tokens = [...meta.text].map(char => {
    if (punctuationPattern.test(char)) return { char, punctuation:true };
    const bpmf = phonetics[phoneticIndex++];
    const keys = [...bpmf].map(symbol => bopomofoKeyMap[symbol]);
    if (keys.some(keyValue => !keyValue)) console.warn(`找不到「${char} ${bpmf}」的鍵位`);
    return { char, bpmf, keys };
  });
  if (phoneticIndex !== phonetics.length) console.warn(`文章「${meta.title}」的字數與注音數量不同`);
  return tokens;
}

async function initCloudDatabase() {
  if (!window.firebase || !window.bopomofoFirebaseConfig) return null;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.bopomofoFirebaseConfig);
    cloudAuth = firebase.auth();
    const credential = await cloudAuth.signInAnonymously();
    cloudUser = credential.user;
    return firebase.firestore();
  } catch (error) {
    console.warn('Firebase 初始化失敗', error);
    return null;
  }
}

function completedArticleIds() {
  const owner = completionOwner();
  let localCompleted = [];
  try {
    const records = JSON.parse(localStorage.getItem(completionStorageKey) || '{}');
    localCompleted = Array.isArray(records[owner]) ? records[owner] : [];
  } catch { /* file:// fallback */ }
  const cloudCompleted = Array.isArray(memoryCompletedArticles[owner]) ? memoryCompletedArticles[owner] : [];
  const saved = new Set([...localCompleted, ...cloudCompleted]);
  return new Set([...saved].filter(id => articleLibrary.some(articleItem => articleItem.id === id)));
}

function completionOwner() { return playerName().toLocaleLowerCase('zh-TW') || '__尚未命名__'; }

function leaderboardData() {
  let localBoards = { basic:[], advanced:[] };
  try {
    const saved = JSON.parse(localStorage.getItem(leaderboardStorageKey) || '{}');
    localBoards = { basic:Array.isArray(saved.basic) ? saved.basic : [], advanced:Array.isArray(saved.advanced) ? saved.advanced : [] };
  } catch { /* file:// fallback */ }
  return mergeLeaderboards(localBoards, memoryLeaderboard);
}

function attemptData() {
  let localAttempts = [];
  try {
    const saved = JSON.parse(localStorage.getItem(attemptStorageKey) || '[]');
    localAttempts = Array.isArray(saved) ? saved : [];
  } catch { /* file:// fallback */ }
  return mergeAttempts(memoryAttempts, localAttempts);
}

function mergeLeaderboards(...boardsList) {
  const merged = { basic:[], advanced:[] };
  ['basic','advanced'].forEach(mode => {
    const bestByPlayer = new Map();
    boardsList.flatMap(boards => Array.isArray(boards?.[mode]) ? boards[mode] : []).forEach(entry => {
      if (!entry?.name) return;
      const key = entry.name.toLocaleLowerCase('zh-TW');
      const previous = bestByPlayer.get(key);
      if (!previous || entry.score > previous.score || (entry.score === previous.score && entry.accuracy > previous.accuracy)) bestByPlayer.set(key, entry);
    });
    merged[mode] = [...bestByPlayer.values()].sort((a,b) => b.score-a.score || b.accuracy-a.accuracy).slice(0,10);
  });
  return merged;
}

function mergeAttempts(...attemptLists) {
  const seen = new Set();
  return attemptLists.flat().filter(entry => {
    if (!entry?.name) return false;
    const key = [entry.name, entry.mode, entry.score, entry.accuracy, entry.article, entry.date].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => Date.parse(b.date || '') - Date.parse(a.date || '')).slice(0,30);
}

function playerName() { return $('playerName').value.trim().slice(0,10); }

function savePlayerName(announce=true) {
  const name = playerName();
  if (!name) { $('playerName').focus(); showToast('先輸入挑戰者名字喔！'); return false; }
  try { localStorage.setItem(playerStorageKey,name); } catch { /* file:// fallback */ }
  $('playerGreeting').textContent = `${name}，準備好挑戰自己的最高分了嗎？`;
  loadCompletedArticlesFromCloud(name).then(() => {
    updateArticleProgress();
    if (state.mode === 'advanced' && !state.running && state.articleOwner !== completionOwner()) selectRandomArticle();
  });
  if (state.mode === 'advanced' && !state.running && state.articleOwner !== completionOwner()) selectRandomArticle();
  if (announce) showToast(`挑戰者「${name}」已就位！`); return true;
}

function recordLeaderboardScore(mode) {
  const name = playerName(); if (!name || state.score <= 0) return;
  const boards = leaderboardData();
  const previous = boards[mode].find(entry => entry.name.toLocaleLowerCase('zh-TW') === name.toLocaleLowerCase('zh-TW'));
  if (previous && (previous.score > state.score || (previous.score === state.score && previous.accuracy >= accuracyNumber()))) { renderLeaderboard(activeBoard); return; }
  boards[mode] = boards[mode].filter(entry => entry.name.toLocaleLowerCase('zh-TW') !== name.toLocaleLowerCase('zh-TW'));
  boards[mode].push({ name, score:state.score, accuracy:accuracyNumber(), date:formatDateTime(), article:mode === 'advanced' ? currentArticleMeta?.title : '60 秒挑戰' });
  boards[mode].sort((a,b) => b.score-a.score || b.accuracy-a.accuracy); boards[mode] = boards[mode].slice(0,10); memoryLeaderboard = boards;
  try { localStorage.setItem(leaderboardStorageKey,JSON.stringify(boards)); } catch { /* file:// fallback */ }
  renderLeaderboard(activeBoard);
  saveLeaderboardScoreToCloud(mode, boards[mode].find(entry => entry.name.toLocaleLowerCase('zh-TW') === name.toLocaleLowerCase('zh-TW')));
}

function renderLeaderboard(mode=activeBoard) {
  activeBoard = mode; const rows = leaderboardData()[mode]; const board = $('leaderboard');
  document.querySelectorAll('.board-tabs button').forEach(button => button.classList.toggle('active',button.dataset.board === mode));
  if (!rows.length) { board.innerHTML = '<div class="rank-empty">還沒有成績，成為第一位上榜的挑戰者吧！</div>'; return; }
  board.innerHTML = rows.map((entry,index) => `<div class="rank-row"><span class="rank-number">${index+1}</span><span class="rank-player"><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.article || '')}・${entry.date}</small></span><span class="rank-accuracy">正確率 ${entry.accuracy}%</span><strong class="rank-score">${entry.score.toLocaleString()}</strong></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

function saveCompletedArticle(id) {
  const completed = completedArticleIds(); completed.add(id);
  let records = memoryCompletedArticles;
  try { records = JSON.parse(localStorage.getItem(completionStorageKey) || '{}'); } catch { /* file:// fallback */ }
  records[completionOwner()] = [...completed]; memoryCompletedArticles = records;
  try { localStorage.setItem(completionStorageKey, JSON.stringify(records)); } catch { /* file:// fallback */ }
  saveCompletedArticleToCloud(id);
}

async function loadLeaderboardFromCloud() {
  if (!cloudDb) return;
  try {
    const snapshot = await cloudDb.collection('leaderboard').orderBy('score','desc').limit(40).get();
    const boards = { basic:[], advanced:[] };
    snapshot.forEach(doc => {
      const data = doc.data();
      const mode = data.mode === 'advanced' ? 'advanced' : 'basic';
      boards[mode].push({
        name:data.name || '未命名',
        score:Number(data.score || 0),
        accuracy:Number(data.accuracy || 0),
        article:data.articleTitle || '',
        date:cloudDateLabel(data.updatedAt)
      });
    });
    boards.basic = boards.basic.slice(0,10);
    boards.advanced = boards.advanced.slice(0,10);
    memoryLeaderboard = mergeLeaderboards(memoryLeaderboard, boards);
    cloudOnline = true;
    renderLeaderboard(activeBoard);
  } catch (error) {
    warnCloud('雲端排行榜讀取失敗，先使用本機資料。', error);
  }
}

async function saveLeaderboardScoreToCloud(mode, entry) {
  if (!cloudDb || !cloudUser || !entry) return;
  try {
    await cloudDb.collection('leaderboard').doc(`${mode}_${cloudUser.uid}`).set({
      name:entry.name,
      mode,
      uid:cloudUser.uid,
      score:Number(entry.score || 0),
      accuracy:Number(entry.accuracy || 0),
      articleTitle:entry.article || '',
      updatedAt:cloudTimestamp()
    }, { merge:true });
    cloudOnline = true;
    loadLeaderboardFromCloud();
  } catch (error) {
    warnCloud('雲端排行榜寫入失敗，這次先存本機。', error);
  }
}

async function loadAttemptsFromCloud() {
  if (!cloudDb || !cloudUser) return;
  try {
    const snapshot = await cloudDb.collection('attempts')
      .where('uid','==',cloudUser.uid)
      .orderBy('createdAt','desc')
      .limit(30)
      .get();
    memoryAttempts = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        name:data.name || '未命名',
        mode:data.mode || 'basic',
        modeName:data.mode === 'advanced' ? '文章挑戰' : '基礎練習',
        score:Number(data.score || 0),
        accuracy:Number(data.accuracy || 0),
        article:data.articleTitle || '',
        progress:data.progress || '',
        status:data.status || '',
        date:cloudDateLabel(data.createdAt)
      };
    });
    cloudOnline = true;
    renderAttemptLog();
  } catch (error) {
    warnCloud('雲端暫存紀錄讀取失敗，先使用本機資料。', error);
  }
}

async function saveAttemptToCloud(entry) {
  if (!cloudDb || !cloudUser || !entry) return;
  try {
    await cloudDb.collection('attempts').add({
      uid:cloudUser.uid,
      name:entry.name,
      mode:entry.mode,
      score:Number(entry.score || 0),
      accuracy:Number(entry.accuracy || 0),
      articleTitle:entry.article || '',
      progress:entry.progress || '',
      status:entry.status || '',
      createdAt:cloudTimestamp()
    });
    cloudOnline = true;
    loadAttemptsFromCloud();
  } catch (error) {
    warnCloud('雲端暫存失敗，這次先存本機。', error);
  }
}

async function loadCompletedArticlesFromCloud(name=playerName()) {
  if (!cloudDb || !cloudUser || !name) return;
  const owner = name.trim().toLocaleLowerCase('zh-TW');
  if (!owner) return;
  try {
    const snapshot = await cloudDb.collection('article_progress')
      .where('uid','==',cloudUser.uid)
      .get();
    const completed = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.articleId) completed.push(data.articleId);
    });
    memoryCompletedArticles[owner] = completed;
    cloudOnline = true;
  } catch (error) {
    warnCloud('雲端文章進度讀取失敗，先使用本機資料。', error);
  }
}

async function saveCompletedArticleToCloud(id) {
  if (!cloudDb || !cloudUser || !id || !currentArticleMeta) return;
  const owner = completionOwner();
  if (owner === '__尚未命名__') return;
  try {
    await cloudDb.collection('article_progress').doc(`${cloudUser.uid}_${safeDocId(id)}`).set({
      uid:cloudUser.uid,
      name:owner,
      articleId:id,
      articleTitle:currentArticleMeta.title,
      accuracy:accuracyNumber(),
      completedAt:cloudTimestamp()
    }, { merge:true });
    cloudOnline = true;
  } catch (error) {
    warnCloud('雲端文章完成紀錄寫入失敗，這次先存本機。', error);
  }
}

async function resetArticleHistoryInCloud(owner=completionOwner()) {
  if (!cloudDb || !cloudUser || owner === '__尚未命名__') return;
  try {
    const snapshot = await cloudDb.collection('article_progress')
      .where('uid','==',cloudUser.uid)
      .get();
    const batch = cloudDb.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    cloudOnline = true;
  } catch (error) {
    warnCloud('雲端完成紀錄清除失敗，可能是 Firestore 規則尚未允許刪除。', error);
  }
}

function updateArticleProgress() {
  $('articleProgress').textContent = `已完成 ${completedArticleIds().size} / ${articleLibrary.length}`;
}

function selectRandomArticle() {
  const completed = completedArticleIds();
  const available = articleLibrary.filter(candidate => !completed.has(candidate.id));
  state.allArticlesComplete = available.length === 0;
  if (!available.length) {
    currentArticleMeta = null; article = []; $('passage').innerHTML = '';
    showAllArticlesComplete(); return false;
  }
  currentArticleMeta = available[Math.floor(Math.random() * available.length)];
  article = prepareArticle(currentArticleMeta); state.articleIndex = 0; state.syllableIndex = 0; state.needsNewArticle = false; state.articleOwner = completionOwner();
  $('articleTitle').textContent = currentArticleMeta.title; buildPassage(); updateArticleProgress(); updateArticle();
  return true;
}

function showAllArticlesComplete() {
  updateArticleProgress(); $('advancedCover').hidden = false;
  $('advancedCover').querySelector('h2').textContent = '30 篇文章全部完成！';
  $('advancedCover').querySelector('p').textContent = '你已經完成整套練習，按 R 可以開啟新一輪。';
  $('advancedAction').textContent = '按 R 清除完成紀錄'; $('stateText').textContent = '全部文章已完成';
}

const state = {
  mode:'basic', running:false, paused:false, score:0, correct:0, wrong:0, combo:0, bestCombo:0,
  remaining:60, target:null, noteStart:0, noteDuration:3700, missTimer:null, clock:null,
  articleIndex:0, syllableIndex:0, startedAt:0, accepting:false,
  needsNewArticle:false, allArticlesComplete:false, articleOwner:null
};

const $ = id => document.getElementById(id);
const keyElements = {};

function buildKeyboard() {
  const board = $('keyboard');
  keyboardRows.forEach(row => {
    const rowEl = document.createElement('div'); rowEl.className = 'key-row';
    row.forEach(k => {
      const el = document.createElement('div');
      el.className = `key${k.special ? ' special' : ''}${k.value === 'f' || k.value === 'j' ? ' home' : ''}`;
      el.style.setProperty('--size', k.size);
      if (!k.special) {
        const finger = fingerForKey(k.value)?.[1];
        el.style.setProperty('--key-color', finger.color);
        el.innerHTML = `<span class="latin">${k.label}</span><span class="bpmf">${k.bpmf}</span>`;
        keyElements[k.value] = el;
      } else {
        el.innerHTML = `<span class="latin">${k.label}</span>`;
        keyElements[k.value] = el;
      }
      rowEl.appendChild(el);
    });
    board.appendChild(rowEl);
  });
}

function buildFingerGuide() {
  const list = $('fingerList');
  Object.values(fingers).forEach(f => {
    const card = document.createElement('article'); card.className = 'finger-card'; card.style.setProperty('--finger-color', f.color);
    card.innerHTML = `<span class="side-label">${f.side}</span><b>${f.short}</b><p>${f.keys.map(k => k.toUpperCase()).join(' · ')}</p>`;
    list.appendChild(card);
  });
}

function buildPassage() {
  const passage = $('passage'); passage.innerHTML = '';
  article.forEach((part,index) => {
    const el = document.createElement(part.punctuation ? 'span' : 'ruby');
    el.className = part.punctuation ? 'word punctuation' : 'word'; el.dataset.index = index;
    el.innerHTML = part.punctuation ? part.char : `<rb>${part.char}</rb><rt>${part.bpmf}</rt>`;
    passage.appendChild(el);
  });
}

function chooseMode(mode, announce=true) {
  if (state.running) stopRound(false);
  state.mode = mode;
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('basicStage').hidden = mode !== 'basic'; $('advancedStage').hidden = mode !== 'advanced';
  $('roundLabel').textContent = mode === 'basic' ? '60 秒挑戰' : '文章任務';
  $('fourthStatLabel').textContent = mode === 'basic' ? '接住' : '完成字數';
  $('timer').textContent = mode === 'basic' ? '01:00' : '00:00';
  $('readyPanel').hidden = false; $('resultPanel').hidden = true; $('advancedCover').hidden = false;
  $('advancedCover').querySelector('h2').textContent = '讀文章，也練習正確鍵位';
  $('advancedCover').querySelector('p').textContent = '中文字、注音與鍵盤位置會同步出現';
  $('advancedAction').textContent = '按 SPACE 開始文章';
  resetStats();
  clearArticleFeedback();
  if (mode === 'basic') setTarget('1'); else selectRandomArticle();
  renderLeaderboard(mode);
  if (announce) showToast(mode === 'basic' ? '已切換：基礎練習' : '已切換：文章挑戰');
}

function startRound() {
  if (!playerName()) { $('playerName').focus(); showToast('請先輸入名字，才能加入排行榜！'); return; }
  savePlayerName(false);
  if (state.mode === 'advanced' && state.articleOwner !== completionOwner()) selectRandomArticle();
  if (state.mode === 'advanced' && state.allArticlesComplete) { showAllArticlesComplete(); return; }
  if (state.mode === 'advanced' && state.needsNewArticle && !selectRandomArticle()) return;
  clearTimers(); resetStats(); state.running = true; state.paused = false; state.startedAt = Date.now();
  clearArticleFeedback();
  $('stateDot').classList.add('running'); $('stateText').textContent = '練習進行中'; $('resultPanel').hidden = true;
  if (state.mode === 'basic') {
    state.remaining = 60; $('readyPanel').hidden = true; startClock(); nextBasicTarget();
  } else {
    state.articleIndex = 0; state.syllableIndex = 0; $('advancedCover').hidden = true; updateArticle(); startClock();
  }
  updateStats();
}

function startClock() {
  state.clock = setInterval(() => {
    if (state.paused) return;
    if (state.mode === 'basic') {
      state.remaining--; $('timer').textContent = formatTime(state.remaining);
      if (state.remaining <= 0) finishRound();
    } else $('timer').textContent = formatTime(Math.floor((Date.now() - state.startedAt) / 1000));
  },1000);
}

function nextBasicTarget() {
  if (!state.running || state.paused || state.mode !== 'basic') return;
  const keys = Object.keys(keyMap); let next = keys[Math.floor(Math.random() * keys.length)];
  if (keys.length > 1 && next === state.target) next = keys[(keys.indexOf(next)+1) % keys.length];
  state.target = next; setTarget(next);
  state.accepting = true;
  const note = $('fallingNote'); note.className = 'falling-note'; note.style.top = ''; note.style.animationPlayState = ''; note.querySelector('b').textContent = keyMap[next]; note.querySelector('small').textContent = next.toUpperCase();
  note.style.setProperty('--x', `${35 + Math.random()*30}%`); state.noteDuration = Math.max(2300, 3700 - state.correct * 22); note.style.setProperty('--fall-speed', `${state.noteDuration}ms`);
  void note.offsetWidth; note.classList.add('falling'); state.noteStart = performance.now();
  clearTimeout(state.missTimer); state.missTimer = setTimeout(() => missBasic(), state.noteDuration + 80);
}

function missBasic() {
  if (!state.running || state.paused) return;
  state.accepting = false;
  freezeFallingNote(); $('fallingNote').classList.add('missed'); state.wrong++; state.combo = 0; showFeedback(`差一點！正確鍵是 ${state.target.toUpperCase()}`,false); updateStats();
  setTimeout(nextBasicTarget,950);
}

function handleGameKey(pressed) {
  if (state.mode === 'basic' && !state.accepting) return;
  pulsePhysicalKey(pressed);
  if (pressed !== state.target) {
    state.wrong++; state.combo = 0; keyElements[pressed]?.classList.add('wrong-key');
    setTimeout(() => keyElements[pressed]?.classList.remove('wrong-key'),300); showFeedback(randomEncouragement(),false); updateStats(); return;
  }
  if (state.mode === 'basic') hitBasic(); else hitAdvanced();
}

function hitBasic() {
  state.accepting = false;
  clearTimeout(state.missTimer);
  const elapsed = performance.now() - state.noteStart;
  const speedRatio = Math.max(0, Math.min(1, elapsed / state.noteDuration));
  const base = Math.max(8, Math.round(26 - speedRatio * 18));
  const fastHit = speedRatio <= .38;
  state.combo++; state.correct++; state.bestCombo = Math.max(state.bestCombo,state.combo); state.score += base + Math.min(20,state.combo);
  freezeFallingNote(); $('fallingNote').classList.add('hit'); showFeedback(`${randomPraise(fastHit)} +${base}`,true); updateStats();
  setTimeout(nextBasicTarget,260);
}

function freezeFallingNote() {
  const note = $('fallingNote');
  note.style.top = getComputedStyle(note).top; note.classList.remove('falling'); void note.offsetWidth;
}

function hitAdvanced() {
  state.syllableIndex++; state.score += 8 + Math.min(15,state.combo); state.combo++; state.correct++; state.bestCombo = Math.max(state.bestCombo,state.combo);
  const current = currentArticleItem();
  if (state.syllableIndex >= current.keys.length) {
    state.articleIndex++; state.syllableIndex = 0;
    while (article[state.articleIndex]?.punctuation) state.articleIndex++;
    showFeedback(`${randomPraise(false)} 下一字！`,true);
    if (state.articleIndex >= article.length) return finishRound();
  }
  updateArticle(); updateStats();
}

function currentArticleItem() { return article[state.articleIndex]; }

function updateArticle() {
  document.querySelectorAll('.word').forEach(el => {
    const index = Number(el.dataset.index); el.classList.toggle('done', index < state.articleIndex); el.classList.toggle('current', index === state.articleIndex);
  });
  const current = currentArticleItem(); if (!current || current.punctuation) return;
  $('focusCharacter').textContent = current.char;
  const focus = $('focusBopomofo'); focus.innerHTML = '';
  [...current.bpmf].forEach((symbol,index) => {
    const span = document.createElement('span'); span.textContent = symbol; span.className = index < state.syllableIndex ? 'done' : index === state.syllableIndex ? 'current' : ''; focus.appendChild(span);
  });
  state.target = current.keys[state.syllableIndex]; setTarget(state.target);
  $('focusHint').textContent = `${state.syllableIndex + 1} / ${current.keys.length}　依序完成「${current.bpmf}」`;
}

function setTarget(keyValue) {
  Object.values(keyElements).forEach(el => el.classList.remove('target'));
  keyElements[keyValue]?.classList.add('target');
  const symbol = keyMap[keyValue] || 'ㄅ'; const fingerEntry = fingerForKey(keyValue); const finger = fingerEntry?.[1]; const fingerId = fingerEntry?.[0];
  $('coachSymbol').textContent = symbol; $('coachKey').textContent = keyValue.toUpperCase();
  if (!finger) return;
  $('coachSymbol').style.background = finger.color; $('fingerCallout').style.setProperty('--finger-color',finger.color); $('fingerCallout').style.background = `${finger.color}20`; $('fingerCallout').style.color = darkenName(fingerId); $('fingerCallout').querySelector('span').textContent = `使用${finger.name}`;
  document.querySelectorAll('.hand span').forEach(el => el.classList.remove('active'));
  const hand = finger.side === '左手' ? document.querySelector('.left-hand') : document.querySelector('.right-hand');
  hand?.querySelector(`.${fingerId.replace('left','').replace('right','').toLowerCase()}`)?.classList.add('active');
  document.documentElement.style.setProperty('--finger-color',finger.color);
}

function darkenName(id) { return id.includes('Index') ? '#b23f45' : id.includes('Middle') ? '#8b6600' : id.includes('Ring') ? '#2478a7' : '#237f62'; }

function pulsePhysicalKey(keyValue) {
  const el = keyElements[keyValue]; if (!el) return; el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'),110);
}

function pauseRound() {
  if (!state.running) return;
  state.paused = !state.paused; $('stateText').textContent = state.paused ? '已暫停・按 ESC 繼續' : '練習進行中'; $('stateDot').classList.toggle('running',!state.paused);
  if (state.mode === 'basic') {
    if (state.paused) { clearTimeout(state.missTimer); $('fallingNote').style.animationPlayState = 'paused'; }
    else { $('fallingNote').style.animationPlayState = 'running'; state.missTimer = setTimeout(missBasic,1200); }
  }
}

function finishRound() {
  const completedMode = state.mode; stopRound(true);
  recordLeaderboardScore(completedMode);
  if (completedMode === 'basic') {
    $('resultTitle').textContent = `這次接住 ${state.correct} 個注音`;
    $('resultCopy').textContent = accuracyNumber() >= 80 ? '你的鍵位越來越熟了，繼續保持！' : '再練一次，讓手指更熟悉鍵盤位置。';
    $('resultPanel').hidden = false;
  } else {
    const mastered = accuracyNumber() >= 80;
    if (mastered && currentArticleMeta) saveCompletedArticle(currentArticleMeta.id);
    state.needsNewArticle = true; updateArticleProgress(); $('advancedCover').hidden = false;
    $('advancedCover').querySelector('h2').textContent = mastered ? '完成一篇文章！' : '完成一篇文章，再熟練一次！';
    $('advancedCover').querySelector('p').textContent = mastered
      ? `正確率 ${accuracyNumber()}%，已加入完成紀錄；想保留這次挑戰，可按上方暫存成績。`
      : `正確率 ${accuracyNumber()}%，達到 80% 才會加入完成紀錄；也可以先暫存這次成績。`;
    $('advancedAction').textContent = completedArticleIds().size >= articleLibrary.length ? '按 R 開啟新一輪' : '按 SPACE 隨機抽下一篇';
    if (completedArticleIds().size >= articleLibrary.length) state.allArticlesComplete = true;
  }
}

function resetArticleHistory() {
  const owner = completionOwner();
  let records = memoryCompletedArticles;
  try { records = JSON.parse(localStorage.getItem(completionStorageKey) || '{}'); } catch { /* file:// fallback */ }
  delete records[owner]; memoryCompletedArticles = records;
  try { localStorage.setItem(completionStorageKey,JSON.stringify(records)); } catch { /* file:// fallback */ }
  resetArticleHistoryInCloud(owner);
  state.allArticlesComplete = false; state.needsNewArticle = true;
  $('advancedCover').querySelector('h2').textContent = '新的 30 篇挑戰開始！';
  $('advancedCover').querySelector('p').textContent = '完成紀錄已清除，按空白鍵隨機抽出第一篇。';
  $('advancedAction').textContent = '按 SPACE 開始文章'; updateArticleProgress(); showToast('文章完成紀錄已清除');
}

function saveAttemptSnapshot() {
  const name = playerName();
  if (!name) { $('playerName').focus(); showToast('先輸入挑戰者名字，才能暫存成績！'); return false; }
  if (!state.score && !state.correct && !state.wrong) { showToast('先開始挑戰，再暫存成績喔！'); return false; }
  const attempts = attemptData();
  const modeName = state.mode === 'advanced' ? '文章挑戰' : '基礎練習';
  const completedChars = state.mode === 'advanced' ? articleCompletedCount() : state.correct;
  const totalChars = state.mode === 'advanced' ? articleTotalCount() : null;
  const progress = state.mode === 'advanced' ? `${completedChars} / ${totalChars} 字` : `接住 ${state.correct} 個`;
  const status = state.running ? (state.paused ? '暫停中' : '進行中') : '已完成';
  const entry = {
    name,
    mode:state.mode,
    modeName,
    score:state.score,
    accuracy:accuracyNumber(),
    article:state.mode === 'advanced' ? currentArticleMeta?.title || '文章挑戰' : '60 秒挑戰',
    progress,
    status,
    date:formatDateTime()
  };
  attempts.unshift(entry);
  memoryAttempts = attempts.slice(0,30);
  try { localStorage.setItem(attemptStorageKey,JSON.stringify(memoryAttempts)); } catch { /* file:// fallback */ }
  renderAttemptLog();
  saveAttemptToCloud(entry);
  showToast('已暫存本次成績與時間');
  return true;
}

function stopRound(finished) {
  clearTimers(); state.running = false; state.paused = false; state.accepting = false; $('stateDot').classList.remove('running'); $('stateText').textContent = finished ? '練習完成' : '準備開始'; $('fallingNote').className = 'falling-note';
}

function clearTimers() { clearInterval(state.clock); clearTimeout(state.missTimer); }
function resetStats() { state.score=0; state.correct=0; state.wrong=0; state.combo=0; state.bestCombo=0; state.remaining=60; updateStats(); }
function accuracyNumber() { return state.correct + state.wrong ? Math.round(state.correct/(state.correct+state.wrong)*100) : 0; }
function updateStats() { $('score').textContent=state.score.toLocaleString(); $('accuracy').textContent=state.correct+state.wrong ? `${accuracyNumber()}%` : '—'; $('combo').textContent=state.combo; $('correct').textContent=state.mode==='advanced' ? Math.max(0,article.slice(0,state.articleIndex).filter(x=>!x.punctuation).length) : state.correct; $('wrong').textContent=state.wrong; }
function formatTime(seconds) { return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function formatDateTime(date=new Date()) { return date.toLocaleString('zh-TW',{ year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }); }
function articleCompletedCount() { return Math.max(0, article.slice(0,state.articleIndex).filter(item => !item.punctuation).length); }
function articleTotalCount() { return article.filter(item => !item.punctuation).length; }
function safeDocId(value) { return encodeURIComponent(String(value).trim().toLocaleLowerCase('zh-TW')).replace(/\./g,'%2E'); }
function cloudTimestamp() { return window.firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date(); }
function cloudDateLabel(value) {
  if (!value) return formatDateTime();
  if (typeof value.toDate === 'function') return formatDateTime(value.toDate());
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === 'string') return value;
  return formatDateTime();
}
function warnCloud(message,error) {
  console.warn(message,error);
  if (!cloudWarned) {
    cloudWarned = true;
    showToast(message);
  }
}
function randomPraise(perfect=false) { const words = perfect ? ['神準命中！','完美到發光！','超級漂亮！'] : ['太強啦！','手速王！','你做到了！','繼續連擊！']; return words[Math.floor(Math.random()*words.length)]; }
function randomEncouragement() { const words = ['沒關係，再試一次！','差一點點，你可以！','看準發光鍵，再來！','別放棄，下一次會中！']; return words[Math.floor(Math.random()*words.length)]; }
function showFeedback(text,good) {
  if (state.mode === 'advanced') {
    showArticleFeedback(text,good);
    const card=document.querySelector('.game-card'); card.classList.remove('celebrate','encourage'); void card.offsetWidth; card.classList.add(good?'celebrate':'encourage'); setTimeout(()=>card.classList.remove('celebrate','encourage'),600);
    return;
  }
  const el=$('hitFeedback'); el.textContent=text; el.style.color=good?'var(--purple)':'var(--coral)'; el.classList.toggle('bad',!good); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  const card=document.querySelector('.game-card'); card.classList.remove('celebrate','encourage'); void card.offsetWidth; card.classList.add(good?'celebrate':'encourage'); setTimeout(()=>card.classList.remove('celebrate','encourage'),600);
}
function showArticleFeedback(text,good) {
  const el = $('articleFeedback');
  el.textContent = text;
  el.classList.toggle('bad',!good);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}
function clearArticleFeedback() {
  const el = $('articleFeedback');
  if (!el) return;
  el.textContent = '準備開始！';
  el.classList.remove('show','bad');
}
function renderAttemptLog() {
  const log = $('attemptLog');
  const attempts = attemptData().slice(0,6);
  if (!attempts.length) {
    log.innerHTML = '<div class="attempt-empty">還沒有暫存紀錄。完成一段練習後，可以按「暫存本次成績」。</div>';
    return;
  }
  log.innerHTML = attempts.map(entry => `<div class="attempt-row"><span class="attempt-main"><b>${escapeHtml(entry.name)}・${escapeHtml(entry.modeName)}</b><small>${escapeHtml(entry.article)}・${escapeHtml(entry.progress)}・${escapeHtml(entry.status)}・${escapeHtml(entry.date)}</small></span><strong class="attempt-score">${Number(entry.score).toLocaleString()}</strong><span class="attempt-accuracy">${entry.accuracy}%</span></div>`).join('');
}
function showToast(text) { const el=$('toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),1800); }

function physicalKey(event) {
  if (event.code.startsWith('Key')) return event.code.slice(3).toLowerCase();
  if (event.code.startsWith('Digit')) return event.code.slice(5);
  return { Minus:'-', Semicolon:';', Comma:',', Period:'.', Slash:'/' }[event.code] || event.key.toLowerCase();
}

document.addEventListener('keydown', event => {
  if (event.repeat) return;
  if (event.target instanceof HTMLInputElement) return;
  const pressed = physicalKey(event);
  if (event.code === 'Space') { event.preventDefault(); if (!state.running) startRound(); return; }
  if (event.key === 'Escape') { pauseRound(); return; }
  if (!state.running && state.mode === 'advanced' && event.code === 'KeyR' && state.allArticlesComplete) { resetArticleHistory(); return; }
  if (!state.running && (event.code === 'Digit1' || event.code === 'Digit2')) { chooseMode(event.code === 'Digit1' ? 'basic' : 'advanced'); return; }
  if (!state.running || state.paused || !keyMap[pressed]) return;
  event.preventDefault(); handleGameKey(pressed);
});

document.querySelectorAll('.mode-tab').forEach(button => button.addEventListener('click', () => chooseMode(button.dataset.mode)));
document.querySelectorAll('.board-tabs button').forEach(button => button.addEventListener('click', () => renderLeaderboard(button.dataset.board)));
$('savePlayer').addEventListener('click',savePlayerName);
$('saveAttempt').addEventListener('click',saveAttemptSnapshot);
$('playerName').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); savePlayerName(); $('playerName').blur(); } });
$('rankJump').addEventListener('click',() => $('leaderboardSection').scrollIntoView({behavior:'smooth',block:'start'}));

  cloudReady = initCloudDatabase().then(db => {
    cloudDb = db;
    if (!cloudDb) return;
    loadLeaderboardFromCloud();
    loadAttemptsFromCloud();
    const savedName = playerName();
    if (savedName) loadCompletedArticlesFromCloud(savedName).then(() => {
      updateArticleProgress();
      if (state.mode === 'advanced' && !state.running) selectRandomArticle();
    });
  });
  buildKeyboard(); buildFingerGuide(); buildPassage(); chooseMode('basic',false); renderLeaderboard('basic'); renderAttemptLog();
try {
  const savedPlayer = localStorage.getItem(playerStorageKey);
  if (savedPlayer) {
    $('playerName').value = savedPlayer;
    $('playerGreeting').textContent = `${savedPlayer}，歡迎回來！正在同步雲端進度。`;
    cloudReady.then(() => loadCompletedArticlesFromCloud(savedPlayer)).then(() => {
      updateArticleProgress();
      if (state.mode === 'advanced') selectRandomArticle();
      $('playerGreeting').textContent = `${savedPlayer}，歡迎回來！繼續挑戰最高分吧。`;
    });
  }
} catch { /* file:// fallback */ }
