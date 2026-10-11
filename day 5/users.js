// User Directory - Day 5 assignment

const API_URL = "https://jsonplaceholder.typicode.com/users";

const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusText = document.getElementById("status");
const usersList = document.getElementById("users-list");

// Every user fetched so far. Filtering works on this array, so no new request is made.
let allUsers = [];

// Draws any array of users into the list.
function renderUsers(list) {
  usersList.innerHTML = "";

  for (const user of list) {
    const item = document.createElement("li");

    const name = document.createElement("h3");
    name.textContent = user.name;

    const email = document.createElement("p");
    email.textContent = "Email: " + user.email;

    const city = document.createElement("p");
    city.textContent = "City: " + user.address.city;

    const company = document.createElement("p");
    company.textContent = "Company: " + user.company.name;

    item.append(name, email, city, company);
    usersList.appendChild(item);
  }
}

// Shows only the users whose name includes the filter text (ignoring case).
function applyFilter() {
  if (allUsers.length === 0) {
    return;
  }

  const text = filterInput.value.trim().toLowerCase();
  const matches = allUsers.filter((user) =>
    user.name.toLowerCase().includes(text)
  );

  renderUsers(matches);

  if (matches.length === 0) {
    statusText.textContent = "No users match your filter.";
  } else {
    statusText.textContent = `Showing ${matches.length} of ${allUsers.length} users.`;
  }
}

async function loadUsers() {
  statusText.textContent = "Loading users...";
  loadButton.disabled = true;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Server responded with status " + response.status);
    }

    allUsers = await response.json();
    renderUsers(allUsers);
    statusText.textContent = `Loaded ${allUsers.length} users.`;
    if (filterInput.value.trim() !== "") {
      applyFilter(); // respect any text already typed in the filter box
    }
  } catch (error) {
    usersList.innerHTML = "";
    allUsers = [];
    statusText.textContent = "Error: could not load users. " + error.message;
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", applyFilter);