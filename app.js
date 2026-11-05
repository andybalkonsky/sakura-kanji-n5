const BASE_WORDS=DATA.map(e=>({id:"n5-"+e.kanji,japanese:e.kanji,kana:e.reading,romaji:e.reading,russian:e.ru,kind:e.kind,custom:false}));
const STORAGE_KEY = "sakura-kanji-data-v1";
const DAY = 86400000;
const defaultData = () => ({ app: "sakura-kanji", version: 1, customWords: [], favorites: [], theme: "pink", progress: {}, stats: { total: 0, correct: 0, mistakes: 0, byDay: {}, bestStreak: 0 } });
let data = loadData();
let currentSession = null;
let deferredInstall = null;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const allWords = () => [...BASE_WORDS, ...data.customWords];
const todayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const dayStart = () => new Date(new Date().setHours(0,0,0,0)).getTime();
const shuffle = items => {const a=[...items];for(let i=a.length-1;i>0;i--){const k=Math.floor(Math.random()*(i+1));[a[i],a[k]]=[a[k],a[i]]}return a};

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.version === 1 ? { ...defaultData(), ...saved, favorites: Array.isArray(saved.favorites) ? saved.favorites : [], stats: { ...defaultData().stats, ...saved.stats } } : defaultData();
  } catch {
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function progressFor(id) {
  return data.progress[id] || { repetitions: 0, interval: 0, ease: 2.5, due: 0, correct: 0, incorrect: 0 };
}

function showView(name) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `${name}-view`));
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === name));
  if (name === "home") renderHome();
  if (name === "words") renderWords();
  if (name === "stats") renderStats();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function dueWords() {
  const now = dayStart();
  return allWords().filter(word => progressFor(word.id).due <= now);
}

function reviewedToday() {
  return data.stats.byDay[todayKey()]?.total || 0;
}

function calculateStreak() {
  let streak = 0;
  const cursor = new Date();
  if (!data.stats.byDay[todayKey(cursor)]?.total) cursor.setDate(cursor.getDate() - 1);
  while (data.stats.byDay[todayKey(cursor)]?.total) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderHome() {
  const today = reviewedToday();
  const due = dueWords().length;
  const accuracy = data.stats.total ? Math.round(data.stats.correct / data.stats.total * 100) : null;
  $("#today-count").textContent = today;
  $(".progress-ring").style.setProperty("--progress", `${Math.min(100, today / 20 * 100)}%`);
  $("#due-count").textContent = due;
  $("#streak-count").textContent = calculateStreak();
  $("#accuracy-count").textContent = accuracy === null ? "—" : `${accuracy}%`;
  $("#home-title").textContent = today >= 20 ? "План на сегодня выполнен" : "Готовы к занятию?";
  $("#home-subtitle").textContent = due ? `${due} слов ждут повторения` : "Все слова повторены — можно потренироваться ещё";
}

function renderWords() {
  const query = $("#word-search").value.trim().toLowerCase();
  const onlyFavorites = $("#word-filter").value === "favorites";
  const words = allWords().filter(word => (!onlyFavorites || data.favorites.includes(word.id)) && [word.japanese, word.kana, word.romaji, word.russian].some(value => value.toLowerCase().includes(query)));
  $("#word-count").textContent = allWords().length;
  $("#favorites-count").textContent = data.favorites.length;
  $("#word-list").innerHTML = words.map(word => {
    const progress = progressFor(word.id);
    const learned = progress.repetitions >= 3;
    const favorite = data.favorites.includes(word.id);
    return `<article class="word-row"><div><div class="word-japanese">${escapeHtml(word.japanese)}</div><div class="word-meta">${escapeHtml(word.romaji)} · ${escapeHtml(word.russian)}</div></div><div class="word-actions"><button class="favorite-word ${favorite ? "active" : ""}" type="button" data-favorite-word="${word.id}" aria-label="${favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${escapeHtml(word.japanese)}" aria-pressed="${favorite}">${favorite ? "★" : "☆"}</button><span class="word-status ${learned ? "learned" : ""}">${learned ? "выучено" : progress.correct ? "учится" : "новое"}</span>${word.custom ? `<button class="delete-word" type="button" data-delete-word="${word.id}" aria-label="Удалить ${escapeHtml(word.japanese)}">×</button>` : ""}</div></article>`;
  }).join("") || `<p class="muted">Ничего не найдено.</p>`;
}

function startSession(mode, sourceWords = null) {
  const size = Number($("#session-size").value);
  const source = $("#session-source").value;
  const category = CATEGORIES.find(item => item.id === source);
  const kind = $("#kanji-pool").value;
  let available = category ? allWords().filter(word => category.kanji.includes(word.japanese)) : allWords().filter(word => kind === "all" || word.kind === kind);
  if (source === "favorites") available = available.filter(word => data.favorites.includes(word.id));
  let pool = sourceWords || available;
  if (!sourceWords && source === "all") {
    const due = available.filter(word => progressFor(word.id).due <= dayStart());
    if (due.length) pool = due;
  }
  if (!pool.length) { showToast(source === "favorites" ? "В этом наборе пока нет избранных слов" : "В этом наборе пока нет карточек"); return; }
  const questions = shuffle(pool).slice(0, size);
  currentSession = { mode, questions, optionPool: category ? available : null, index: 0, correct: 0, mistakes: [], answered: false };
  $("#mode-picker").classList.add("hidden");
  $("#session-result").classList.add("hidden");
  $("#quiz").classList.remove("hidden");
  showView("study");
  renderQuestion();
}

function renderQuestion() {
  const session = currentSession;
  const word = session.questions[session.index];
  session.answered = false;
  $("#quiz-counter").textContent = `${session.index + 1}/${session.questions.length}`;
  $("#quiz-progress-bar").style.width = `${session.index / session.questions.length * 100}%`;
  $("#feedback").className = "feedback hidden";
  $("#next-question").classList.add("hidden");
  $("#quiz-options").innerHTML = "";
  $("#typing-form").classList.toggle("hidden", session.mode !== "typing");
  $("#quiz-options").classList.toggle("hidden", session.mode === "typing");
  $("#quiz-reading").textContent = ""; $("#hint-button").textContent="✧ Подсказка";

  if (session.mode === "jp-ru") {
    $("#quiz-direction").textContent = "Выберите перевод";
    $("#quiz-prompt").textContent = word.japanese;
    renderOptions(word, "russian");
  } else if (session.mode === "ru-jp") {
    $("#quiz-direction").textContent = "Выберите японское слово";
    $("#quiz-prompt").textContent = word.russian;
    renderOptions(word, "japanese");
  } else {
    $("#quiz-direction").textContent = "Напишите слово хираганой";
    $("#quiz-prompt").textContent = word.russian;
    $("#typing-answer").value = "";
    setTimeout(() => $("#typing-answer").focus(), 50);
  }
}

function renderOptions(correctWord, field) {
  const options = chooseOptions(correctWord);

  $("#quiz-options").innerHTML = options.map(word => `<button class="option" type="button" data-id="${word.id}">${escapeHtml(word[field])}</button>`).join("");
}

function answerQuestion(isCorrect, selectedId = null) {
  if (currentSession.answered) return;
  currentSession.answered = true;
  const word = currentSession.questions[currentSession.index];
  updateProgress(word.id, isCorrect);
  if (isCorrect) currentSession.correct += 1;
  else if (!currentSession.mistakes.some(item => item.id === word.id)) currentSession.mistakes.push(word);

  if (currentSession.mode !== "typing") {
    $$(".option").forEach(button => {
      button.disabled = true;
      if (button.dataset.id === word.id) button.classList.add("correct");
      if (!isCorrect && button.dataset.id === selectedId) button.classList.add("wrong");
    });
  } else {
    $("#typing-answer").disabled = true;
  }

  $("#quiz-reading").textContent = `${word.japanese}（${word.kana}）· ${word.russian}`;
  const feedback = $("#feedback");
  feedback.textContent = isCorrect ? "Правильно!" : `Правильный ответ: ${`${word.japanese} — ${word.russian}`}`;
  feedback.className = `feedback ${isCorrect ? "correct" : "wrong"}`;
  $("#next-question").textContent = currentSession.index === currentSession.questions.length - 1 ? "Результат" : "Дальше";
  $("#next-question").classList.remove("hidden");
}

function updateProgress(id, isCorrect) {
  const progress = progressFor(id);
  if (isCorrect) {
    progress.repetitions += 1;
    progress.interval = progress.repetitions === 1 ? 1 : progress.repetitions === 2 ? 3 : Math.max(4, Math.round(progress.interval * progress.ease));
    progress.ease = Math.min(2.8, progress.ease + .05);
    progress.correct += 1;
  } else {
    progress.repetitions = 0;
    progress.interval = 1;
    progress.ease = Math.max(1.3, progress.ease - .2);
    progress.incorrect += 1;
  }
  progress.due = dayStart() + progress.interval * DAY;
  progress.last = Date.now();
  data.progress[id] = progress;
  const key = todayKey();
  data.stats.byDay[key] = data.stats.byDay[key] || { total: 0, correct: 0 };
  data.stats.byDay[key].total += 1;
  data.stats.byDay[key].correct += isCorrect ? 1 : 0;
  data.stats.total += 1;
  data.stats.correct += isCorrect ? 1 : 0;
  data.stats.mistakes += isCorrect ? 0 : 1;
  data.stats.bestStreak = Math.max(data.stats.bestStreak, calculateStreak());
  saveData();
}

function nextQuestion() {
  $("#typing-answer").disabled = false;
  if (currentSession.index < currentSession.questions.length - 1) {
    currentSession.index += 1;
    renderQuestion();
  } else {
    finishSession();
  }
}

function finishSession() {
  $("#quiz").classList.add("hidden");
  $("#session-result").classList.remove("hidden");
  $("#result-summary").textContent = `${currentSession.correct} из ${currentSession.questions.length} правильно. Ошибок: ${currentSession.mistakes.length}.`;
  $("#repeat-mistakes").classList.toggle("hidden", currentSession.mistakes.length === 0);
  renderHome();
}

function closeQuiz() {
  currentSession = null;
  $("#quiz").classList.add("hidden");
  $("#session-result").classList.add("hidden");
  $("#mode-picker").classList.remove("hidden");
}

function renderStats() {
  const learned = allWords().filter(word => progressFor(word.id).repetitions >= 3).length;
  const reviewing = allWords().filter(word => progressFor(word.id).correct > 0 && progressFor(word.id).repetitions < 3).length;
  const accuracy = data.stats.total ? Math.round(data.stats.correct / data.stats.total * 100) : null;
  $("#total-answers").textContent = data.stats.total;
  $("#learned-count").textContent = learned;
  $("#mistake-count").textContent = data.stats.mistakes;
  $("#stats-accuracy").textContent = accuracy === null ? "—" : `${accuracy}%`;
  $("#best-streak").textContent = `${data.stats.bestStreak || calculateStreak()} дн.`;
  $("#reviewing-count").textContent = reviewing;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const value = data.stats.byDay[todayKey(date)]?.total || 0;
    return { label: date.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", ""), value };
  });
  const max = Math.max(1, ...days.map(day => day.value));
  $("#week-chart").innerHTML = days.map(day => `<div class="day-bar"><strong>${day.value || ""}</strong><i style="height:${Math.max(3, day.value / max * 110)}px"></i><span>${day.label}</span></div>`).join("");
  const difficultWords = allWords().map(word => ({ word, errors: progressFor(word.id).incorrect })).filter(item => item.errors > 0).sort((first, second) => second.errors - first.errors || first.word.id.localeCompare(second.word.id)).slice(0, 5);
  $("#difficult-words").innerHTML = difficultWords.length ? difficultWords.map(({ word, errors }) => `<div class="difficult-word"><div><strong>${escapeHtml(word.japanese)}</strong><span>${escapeHtml(word.russian)}</span></div><span class="error-count">${errors} ${errorForm(errors)}</span></div>`).join("") : `<p class="muted">Пока нет ошибок — так держать!</p>`;
}

function errorForm(count) {
  if (count % 100 >= 11 && count % 100 <= 14) return "ошибок";
  if (count % 10 === 1) return "ошибка";
  if (count % 10 >= 2 && count % 10 <= 4) return "ошибки";
  return "ошибок";
}

function addWord(form) {
  const formData = new FormData(form);
  const word = { id: `custom-${Date.now()}`, japanese: formData.get("japanese").trim(), kana: formData.get("kana").trim(), romaji: formData.get("kana").trim(), kind: "word", russian: formData.get("russian").trim(), custom: true };
  if(!/[一-鿿]/.test(word.japanese)||!/^[ぁ-ゖ・ー〜\s]+$/.test(word.kana)){showToast("Укажите слово с кандзи и чтение хираганой");return;} if(allWords().some(w=>w.japanese===word.japanese)){showToast("Такое написание уже есть");return;} data.customWords.push(word);
  saveData();
  form.reset();
  $("#add-word-dialog").close();
  renderWords();
  showToast("Слово добавлено");
}

function deleteCustomWord(id) {
  const word = data.customWords.find(item => item.id === id);
  if (!word || !confirm(`Удалить слово «${word.japanese}»?`)) return;
  data.customWords = data.customWords.filter(item => item.id !== id);
  data.favorites = data.favorites.filter(favoriteId => favoriteId !== id);
  delete data.progress[id];
  saveData();
  renderWords();
  showToast("Слово удалено");
}

function exportData() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `sakura-kanji-backup-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Резервная копия создана");
}

async function importData(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (imported.app !== "sakura-kanji" || imported.version !== 1 || !Array.isArray(imported.customWords) || typeof imported.progress !== "object") throw new Error();
    data = { ...defaultData(), ...imported, favorites: Array.isArray(imported.favorites) ? imported.favorites : [], stats: { ...defaultData().stats, ...imported.stats } };
    saveData();
    applyTheme();
    renderHome();
    renderWords();
    renderStats();
    showToast("Данные восстановлены");
  } catch {
    showToast("Не удалось прочитать резервную копию");
  }
}

function normalizeKana(value) {
  return toHiragana(value.trim().replace(/[\s。、・]/g, ""));
}

function toHiragana(value) {
  return value.replace(/[ァ-ヶ]/g, character => String.fromCharCode(character.charCodeAt(0) - 96));
}

function applyTheme() {
  const theme = data.theme === "pink" ? "pink" : "classic";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "pink" ? "#d18b9e" : "#d95d39";
  $$("[data-theme]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.theme === theme)));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2400);
}

$$('.tab').forEach(tab => tab.addEventListener("click", () => { closeQuiz(); showView(tab.dataset.view); }));
$$('[data-start-mode]').forEach(button => button.addEventListener("click", () => startSession(button.dataset.startMode)));
$("#quiz-options").addEventListener("click", event => {
  const option = event.target.closest(".option");
  if (!option) return;
  answerQuestion(option.dataset.id === currentSession.questions[currentSession.index].id, option.dataset.id);
});
$("#typing-form").addEventListener("submit", event => {
  event.preventDefault();
  const word = currentSession.questions[currentSession.index];
  answerQuestion(normalizeKana($("#typing-answer").value) === normalizeKana(word.kana));
});
$("#next-question").addEventListener("click", nextQuestion);
$("#close-quiz").addEventListener("click", closeQuiz);
$("#finish-session").addEventListener("click", () => { closeQuiz(); showView("home"); });
$("#repeat-mistakes").addEventListener("click", () => startSession(currentSession.mode, currentSession.mistakes));
$("#word-search").addEventListener("input", renderWords);
$("#word-filter").addEventListener("change", renderWords);
$("#word-list").addEventListener("click", event => {
  const favoriteButton = event.target.closest("[data-favorite-word]");
  if (favoriteButton) {
    const id = favoriteButton.dataset.favoriteWord;
    data.favorites = data.favorites.includes(id) ? data.favorites.filter(favoriteId => favoriteId !== id) : [...data.favorites, id];
    saveData(); renderWords(); return;
  }
  const button = event.target.closest("[data-delete-word]");
  if (button) deleteCustomWord(button.dataset.deleteWord);
});
$("#show-add-word").addEventListener("click", () => $("#add-word-dialog").showModal());
$("#close-dialog").addEventListener("click", () => $("#add-word-dialog").close());
$("#add-word-form").addEventListener("submit", event => { event.preventDefault(); addWord(event.currentTarget); });
$("#export-data").addEventListener("click", exportData);
$("#import-data").addEventListener("change", event => { if (event.target.files[0]) importData(event.target.files[0]); event.target.value = ""; });
$$('[data-theme]').forEach(button => button.addEventListener("click", () => { data.theme = button.dataset.theme; saveData(); applyTheme(); }));
$("#reset-progress").addEventListener("click", () => {
  if (!confirm("Сбросить весь прогресс? Добавленные слова тоже будут удалены.")) return;
  const theme = data.theme;
  data = { ...defaultData(), theme }; saveData(); applyTheme(); renderHome(); renderWords(); renderStats(); showToast("Прогресс сброшен");
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault(); deferredInstall = event; $("#install-button").classList.remove("hidden");
});
$("#install-button").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#install-button").classList.add("hidden");
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>showToast("Офлайн-режим недоступен в этом браузере")));
applyTheme();
renderHome();

function comparable(w){return new Set(w.russian.toLowerCase().replaceAll('ё','е').match(/[а-я]{3,}/g)?.map(x=>x.slice(0,5))||[])}
function compatible(a,b){const t=comparable(a);return a.id!==b.id&&!a.kana.split('・').some(r=>b.kana.split('・').includes(r))&&![...comparable(b)].some(x=>t.has(x))}
function chooseOptions(w){const out=[w];const preferred=currentSession?.optionPool || allWords().filter(x=>x.kind===w.kind);for(const c of [...shuffle(preferred),...shuffle(allWords())]){if(out.every(x=>compatible(x,c)))out.push(c);if(out.length===4)break}return shuffle(out)}
$("#hint-button").addEventListener("click",()=>{if(!currentSession)return;const w=currentSession.questions[currentSession.index];const show=$("#quiz-reading").textContent==='';$("#quiz-reading").textContent=show?w.kana:'';$("#hint-button").textContent=show?'Скрыть чтение':'✧ Подсказка'});
const themeOptions = document.createElement("optgroup");
themeOptions.label = "По темам";
CATEGORIES.forEach(category => { const option = document.createElement("option"); option.value = category.id; option.textContent = `${category.name} (${category.kanji.length})`; themeOptions.append(option); });
$("#session-source").append(themeOptions);
$("#session-source").addEventListener("change", () => {
  const isCategory = CATEGORIES.some(category => category.id === $("#session-source").value);
  $("#kanji-pool-field").classList.toggle("hidden", isCategory);
});
