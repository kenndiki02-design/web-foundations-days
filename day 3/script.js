// Notes Toolkit - Day 3 assignment

let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

const CATEGORIES = ["personal", "work", "study"];

// Lower-case, trim and collapse repeated spaces so notes can be compared fairly.
function normalise(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// Returns every note whose text contains `word`, ignoring case.
function searchNotes(word) {
  const target = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(target));
}

// Returns the note with the most characters, or null if there are no notes.
function longestNote() {
  if (notes.length === 0) {
    return null;
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

// Returns an object such as { personal: 2, work: 1, study: 2 }.
function countByCategory() {
  const counts = { personal: 0, work: 0, study: 0 };
  for (const note of notes) {
    if (counts[note.category] === undefined) {
      counts[note.category] = 0;
    }
    counts[note.category] += 1;
  }
  return counts;
}

// Returns a sentence such as "5 notes: 2 personal, 1 work, 2 study."
function getSummary() {
  const total = notes.length;
  const word = total === 1 ? "note" : "notes";
  if (total === 0) {
    return `${total} ${word}.`;
  }
  const counts = countByCategory();
  const parts = [];
  for (const category of CATEGORIES) {
    if (counts[category] > 0) {
      parts.push(`${counts[category]} ${category}`);
    }
  }
  return `${total} ${word}: ${parts.join(", ")}.`;
}

// True if a note with the same text exists (ignoring case and extra spaces).
function isDuplicate(text) {
  const target = normalise(text);
  return notes.some((note) => normalise(note.text) === target);
}

// Adds a note if valid. Returns true when added, false otherwise (logs why).
function addNote(text, category) {
  const cleaned = typeof text === "string" ? text.trim() : "";
  if (cleaned.length < 1 || cleaned.length > 200) {
    console.log("Not added: text must be 1-200 characters.");
    return false;
  }
  if (isDuplicate(cleaned)) {
    console.log("Not added: a note with that text already exists.");
    return false;
  }
  if (!CATEGORIES.includes(category)) {
    console.log("Not added: category must be personal, work or study.");
    return false;
  }
  let maxId = 0;
  for (const note of notes) {
    if (note.id > maxId) {
      maxId = note.id;
    }
  }
  notes.push({ id: maxId + 1, text: cleaned, category: category });
  return true;
}

// ---------------------------------------------------------------- Tests

console.log("--- searchNotes ---");
console.log(searchNotes("THE"));
// [ {id: 2, text: "Finish the Day 3 assignment", category: "study"},
//   {id: 3, text: "Email the project report to Grace", category: "work"} ]
console.log(searchNotes("zebra")); // []

console.log("--- longestNote ---");
console.log(longestNote());
// { id: 3, text: "Email the project report to Grace", category: "work" }
const savedNotes = notes; // keep the real data safe for the edge case
notes = [];
console.log(longestNote()); // null
notes = savedNotes;

console.log("--- countByCategory ---");
console.log(countByCategory()); // { personal: 2, work: 1, study: 2 }
notes = [];
console.log(countByCategory()); // { personal: 0, work: 0, study: 0 }
notes = savedNotes;

console.log("--- getSummary ---");
console.log(getSummary()); // 5 notes: 2 personal, 1 work, 2 study.
notes = [savedNotes[0]];
console.log(getSummary()); // 1 note: 1 personal.
notes = [];
console.log(getSummary()); // 0 notes.
notes = savedNotes;

console.log("--- isDuplicate ---");
console.log(isDuplicate("buy milk and bread")); // true
console.log(isDuplicate("  BUY   milk and   bread ")); // true
console.log(isDuplicate("Walk the dog")); // false

console.log("--- addNote ---");
console.log(addNote("Walk the dog", "personal")); // true
console.log(addNote("walk  the DOG", "personal"));
// logs "Not added: a note with that text already exists." then false
console.log(addNote("", "work"));
// logs "Not added: text must be 1-200 characters." then false
console.log(addNote("x".repeat(201), "work"));
// logs "Not added: text must be 1-200 characters." then false
console.log(addNote("Plan the trip", "holiday"));
// logs "Not added: category must be personal, work or study." then false
console.log(getSummary()); // 6 notes: 3 personal, 1 work, 2 study.