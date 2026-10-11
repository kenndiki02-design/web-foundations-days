// Note Writer - Day 4 assignment

const MAX_CHARS = 200;
const WARN_AT = 180;
const DRAFT_KEY = "noteDraft";
const THEME_KEY = "noteTheme";

const noteText = document.getElementById("note-text");
const charCount = document.getElementById("char-count");
const wordCount = document.getElementById("word-count");
const clearBtn = document.getElementById("clear-btn");
const themeToggle = document.getElementById("theme-toggle");

// localStorage can throw (private mode, storage full), so wrap it.
function saveItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.log("Could not save " + key + ":", error.message);
  }
}

function loadItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.log("Could not remove " + key + ":", error.message);
  }
}

function updateCounts() {
  const text = noteText.value;
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

  charCount.textContent = `${chars} / ${MAX_CHARS} characters`;
  wordCount.textContent = `${words} words`;

  charCount.classList.toggle("over", chars > MAX_CHARS);
  charCount.classList.toggle("warning", chars > WARN_AT && chars <= MAX_CHARS);
}

function clearNote() {
  noteText.value = "";
  removeItem(DRAFT_KEY);
  updateCounts();
}

function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
}

noteText.addEventListener("input", function () {
  updateCounts();
  saveItem(DRAFT_KEY, noteText.value);
});

noteText.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    clearNote();
  }
});

clearBtn.addEventListener("click", clearNote);

themeToggle.addEventListener("click", function () {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
  saveItem(THEME_KEY, isDark ? "dark" : "light");
});

// On page load: restore draft and theme, then update the counters.
const savedDraft = loadItem(DRAFT_KEY);
if (savedDraft !== null) {
  noteText.value = savedDraft;
}
applyTheme(loadItem(THEME_KEY) === "dark");
updateCounts();