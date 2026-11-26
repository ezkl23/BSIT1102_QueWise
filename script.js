import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  deleteDoc,
  updateDoc,
  getDocs,
  runTransaction
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// ==========================================
// QUEWISE CONFIGURATION
// ==========================================

const SERVICES = [
  "Transcript of Records (TOR)",
  "Certificate of Enrollment",
  "Certificate of Grades",
  "Good Moral Certificate",
  "Document Request / Follow-up",
  "Other Registrar Concern"
];

let currentRole = "";
let authMode = "signin";
let activeStudentService = SERVICES[0];
let activeAdminService = SERVICES[0];
let liveQueues = {};

SERVICES.forEach(service => {
  liveQueues[service] = [];
});
let unsubscribeStudentQueue = null;
let unsubscribeAdminQueue = null;

let adjustmentMinutes = {};
let unsubscribeAdjustment = null;

function listenToAdjustment(service, callback) {
  const adjustmentRef = doc(db, "queueAdjustments", service);

  return onSnapshot(adjustmentRef, snapshot => {
    adjustmentMinutes[service] = snapshot.exists()
      ? snapshot.data().extraMinutes || 0
      : 0;

    callback(adjustmentMinutes[service]);
  }, error => {
    console.error("Adjustment listener error:", error);
  });
}

async function adjustWaitingTime(service, amount) {
  const current = adjustmentMinutes[service] || 0;
  const updated = Math.max(0, Math.min(600, current + amount));

  try {
    await setDoc(doc(db, "queueAdjustments", service), {
      extraMinutes: updated
    });

  } catch (error) {
    console.error("Failed to adjust waiting time:", error);
    alert("Failed to update waiting time.");
  }
}

async function resetWaitingTimeAdjustment(service) {
  try {
    await setDoc(doc(db, "queueAdjustments", service), {
      extraMinutes: 0
    });

  } catch (error) {
    console.error("Failed to reset waiting time:", error);
    alert("Failed to reset waiting time.");
  }
}

window.adjustWaitingTime = adjustWaitingTime;
window.resetWaitingTimeAdjustment = resetWaitingTimeAdjustment;
// ==========================================
// LOCAL QUEUE STORAGE (TEMPORARY)
// ==========================================

function getQueues() {
  const saved = JSON.parse(localStorage.getItem("qw_queues") || "{}");

  SERVICES.forEach(service => {
    if (!Array.isArray(saved[service])) {
      saved[service] = [];
    }
  });

  return saved;
}

function saveQueues(queues) {
  localStorage.setItem("qw_queues", JSON.stringify(queues));
}

// ==========================================
// FIRESTORE REAL-TIME QUEUE LISTENER
// ==========================================

function listenToQueue(service, callback) {
  console.log("Queue listener auth:", auth.currentUser?.uid);
console.log("Queue listener service:", service);
  const queueRef = collection(db, "queueEntries");

  const queueQuery = query(
    queueRef,
    where("service", "==", service)
  );

  return onSnapshot(queueQuery, snapshot => {
    const queue = snapshot.docs
      .map(document => ({
        id: document.id,
        ...document.data()
      }))
      .filter(person => person.status === "waiting")
      .sort((a, b) => {
        const timeA = a.joinedAt?.toMillis?.() || 0;
        const timeB = b.joinedAt?.toMillis?.() || 0;
        return timeA - timeB;
      });

    callback(queue);
  }, error => {
  console.error("Queue listener error code:", error.code);
  console.error("Queue listener error message:", error.message);
  console.error("Full queue listener error:", error);
});
}
// ==========================================
// AUTHENTICATION INTERFACE
// ==========================================

function showAuth(role, mode) {
  currentRole = role;
  authMode = mode;

  document.getElementById("roleChoice").classList.add("hidden");
  document.getElementById("authForm").classList.remove("hidden");

  const isStudent = role === "student";
  const isSignup = mode === "signup";

  document.getElementById("authTitle").textContent =
    `${isStudent ? "Student" : "Admin"} ${isSignup ? "Create Account" : "Sign in"}`;

  document.getElementById("authDescription").textContent =
    isSignup
      ? "Create your student account using your school email."
      : "Enter your account details.";

  // Change identity label depending on role and mode
 document.getElementById("studentNumberLabel").textContent =
  isStudent
    ? (isSignup ? "Student Number" : "School Email")
    : "Admin Email";

document.getElementById("studentNumber").placeholder =
  isStudent
    ? (isSignup ? "e.g. 2026-00001" : "name@school.edu.ph")
    : "admin@example.com";

  document.getElementById("studentNumber").type =
  (isStudent && !isSignup) || currentRole === "admin" ? "email" : "text";

  // School email field only appears during registration
  document.getElementById("emailGroup").classList.toggle(
    "hidden",
    !(isStudent && isSignup)
  );

  document.getElementById("schoolEmail").required =
    isStudent && isSignup;

  // Signup only for students
  document.getElementById("switchAuthText").classList.toggle(
    "hidden",
    !isStudent
  );

  document.getElementById("switchAuthText").innerHTML =
    mode === "signin"
      ? `Don't have an account? <a href="#" onclick="showAuth('student','signup');return false;">Create an account</a>`
      : `Already have an account? <a href="#" onclick="showAuth('student','signin');return false;">Sign in</a>`;

  document.getElementById("adminHint").classList.toggle(
    "hidden",
    role !== "admin"
  );

  document.getElementById("authNotice").textContent = "";
  document.getElementById("loginForm").reset();
}

function backToRoles() {
  document.getElementById("authForm").classList.add("hidden");
  document.getElementById("roleChoice").classList.remove("hidden");
}

// Keep functions accessible to your HTML inline onclick attributes
window.showAuth = showAuth;
window.backToRoles = backToRoles;

// ==========================================
// LOGIN & REGISTRATION
// ==========================================

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const identity = document.getElementById("studentNumber").value.trim();
  const password = document.getElementById("password").value;
  const notice = document.getElementById("authNotice");
  const submitButton = document.getElementById("submitAuth");

  notice.textContent = "";
  submitButton.disabled = true;

  try {
    // --------------------------------------
    // DEMO ADMIN LOGIN (TEMPORARY)
    // --------------------------------------
    // --------------------------------------
// FIREBASE ADMIN LOGIN
// --------------------------------------
if (currentRole === "admin") {
  const email = identity.trim().toLowerCase();

  const credential = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  const adminUser = credential.user;

  const adminSnapshot = await getDoc(
    doc(db, "admins", adminUser.uid)
  );

  if (!adminSnapshot.exists() || adminSnapshot.data().role !== "admin") {
    notice.textContent = "Access denied. This account is not an authorized admin.";
    await signOut(auth);
    return;
  }

  enterApp("admin", adminUser.email || "Administrator");
  return;
}

    // --------------------------------------
    // STUDENT REGISTRATION
    // --------------------------------------
    if (authMode === "signup") {
      const studentNumber = identity;
      const email = document.getElementById("schoolEmail").value.trim().toLowerCase();

      if (!studentNumber || !email || !password) {
        notice.textContent = "Please complete all fields.";
        return;
      }

      // Basic email format validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        notice.textContent = "Please enter a valid school email address.";
        return;
      }

      if (password.length < 6) {
        notice.textContent = "Password must be at least 6 characters.";
        return;
      }

      // Create Firebase Authentication account
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = credential.user;

      // Save student profile in Firestore
      await setDoc(doc(db, "users", user.uid), {
        studentNumber: studentNumber,
        email: email,
        role: "student",
        createdAt: new Date().toISOString()
      });

      // Registration success
      notice.textContent = "Account created successfully! You may now sign in.";

      await signOut(auth);

      showAuth("student", "signin");

      document.getElementById("authNotice").textContent =
        "Account created. Please sign in.";

      return;
    }

    // --------------------------------------
    // STUDENT LOGIN
    // --------------------------------------
    const email = identity.toLowerCase();

    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const user = credential.user;

    // Retrieve the student profile
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (!profileSnapshot.exists()) {
      notice.textContent = "Student profile not found.";
      await signOut(auth);
      return;
    }

    const profile = profileSnapshot.data();

    if (profile.role !== "student") {
      notice.textContent = "This account is not registered as a student.";
      await signOut(auth);
      return;
    }

    enterApp("student", profile.studentNumber);

  } catch (error) {
    console.error("QueWise Authentication Error:", error);

    switch (error.code) {
      case "auth/email-already-in-use":
        notice.textContent = "This email is already registered.";
        break;

      case "auth/invalid-email":
        notice.textContent = "Please enter a valid email address.";
        break;

      case "auth/weak-password":
        notice.textContent = "Your password is too weak.";
        break;

      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        notice.textContent = "Incorrect email or password.";
        break;

      case "auth/too-many-requests":
        notice.textContent = "Too many attempts. Please try again later.";
        break;

      default:
        notice.textContent = error.message;
    }
  } finally {
    submitButton.disabled = false;
  }
});

// ==========================================
// ENTER DASHBOARD
// ==========================================

function enterApp(role, label) {
  document.getElementById("authPage").classList.add("hidden");
  document.getElementById("appPage").classList.remove("hidden");

  document.getElementById("userLabel").textContent = label;

  document.getElementById("studentDashboard").classList.toggle(
    "hidden",
    role !== "student"
  );

  document.getElementById("adminDashboard").classList.toggle(
    "hidden",
    role !== "admin"
  );

  if (role === "student") {
    renderStudentTabs();
    populateServiceSelect("serviceSelect");

    if (unsubscribeStudentQueue) {
      unsubscribeStudentQueue();
    }

    const service = activeStudentService;

    unsubscribeStudentQueue = listenToQueue(service, updatedQueue => {
      liveQueues[service] = updatedQueue;
      renderStudent();
    });

    if (unsubscribeAdjustment) {
  unsubscribeAdjustment();
}

unsubscribeAdjustment = listenToAdjustment(service, () => {
  renderStudent();
});

    renderStudent();
  } else {
    renderAdminTabs();
    populateServiceSelect("adminServiceSelect");

    if (unsubscribeAdminQueue) {
      unsubscribeAdminQueue();
    }

    const service = activeAdminService;

    unsubscribeAdminQueue = listenToQueue(service, updatedQueue => {
      liveQueues[service] = updatedQueue;
      renderAdmin();
    });

    if (unsubscribeAdjustment) {
  unsubscribeAdjustment();
}

unsubscribeAdjustment = listenToAdjustment(service, () => {
  renderAdmin();
});

    renderAdmin();
  }
}

// ==========================================
// LOGOUT
// ==========================================

async function logout() {
  try {
    // Firebase logout for students
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch (error) {
    console.error("Logout error:", error);
  }

  document.getElementById("appPage").classList.add("hidden");
  document.getElementById("authPage").classList.remove("hidden");

  backToRoles();
}

window.logout = logout;

// ==========================================
// SERVICE SELECT OPTIONS
// ==========================================

function populateServiceSelect(id) {
  document.getElementById(id).innerHTML = SERVICES
    .map(service =>
      `<option value="${escapeHtml(service)}">${escapeHtml(service)}</option>`
    )
    .join("");
}

// ==========================================
// HTML ESCAPE
// ==========================================

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

// ==========================================
// SERVICE TABS
// ==========================================

function renderTabs(containerId, active, onClickName) {
  document.getElementById(containerId).innerHTML = SERVICES.map(service =>
    `<button class="service-tab ${service === active ? "active" : ""}"
      onclick="${onClickName}('${escapeHtml(service).replace(/'/g, "\\'")}')">
      ${escapeHtml(service)}
    </button>`
  ).join("");
}

function renderStudentTabs() {
  renderTabs("studentServiceTabs", activeStudentService, "selectStudentService");
}

function selectStudentService(service) {
  activeStudentService = service;
  renderStudentTabs();

  // Stop listening to the previous service
  if (unsubscribeStudentQueue) {
    unsubscribeStudentQueue();
  }

  // Listen to the newly selected service
  unsubscribeStudentQueue = listenToQueue(service, updatedQueue => {
    liveQueues[service] = updatedQueue;
    renderStudent();
  });

  if (unsubscribeAdjustment) {
  unsubscribeAdjustment();
}

unsubscribeAdjustment = listenToAdjustment(service, () => {
  renderStudent();
});

  renderStudent();
}

function renderAdminTabs() {
  renderTabs("adminServiceTabs", activeAdminService, "selectAdminService");
}

function selectAdminService(service) {
  activeAdminService = service;
  renderAdminTabs();

  // Stop listening to the previous service
  if (unsubscribeAdminQueue) {
    unsubscribeAdminQueue();
  }

  // Listen to the newly selected service
  unsubscribeAdminQueue = listenToQueue(service, updatedQueue => {
    liveQueues[service] = updatedQueue;
    renderAdmin();
  });

  if (unsubscribeAdjustment) {
  unsubscribeAdjustment();
}

unsubscribeAdjustment = listenToAdjustment(service, () => {
  renderAdmin();
});

  renderAdmin();
}

window.selectStudentService = selectStudentService;
window.selectAdminService = selectAdminService;

// ==========================================
// QUEUE DISPLAY
// ==========================================

function queueMarkup(service) {
  const queue = getQueues()[service];

  return `
    <div class="queue-summary">
      <div class="metric">
        <strong>${queue.length}</strong>
        <span>People waiting</span>
      </div>
      <div class="metric">
        <strong>${queue.length ? escapeHtml(queue[0].studentNumber) : "—"}</strong>
        <span>Next in line</span>
      </div>
    </div>

    ${
      queue.length
        ? `<ul class="queue-list">
            ${queue.map((person, index) => `
              <li>
                <span>
                  <span class="queue-number">#${index + 1}</span>
                  ${escapeHtml(person.studentNumber)}
                </span>
                <span class="muted">${person.joinedAt || ""}</span>
              </li>
            `).join("")}
          </ul>`
        : `<p class="empty">No students are currently waiting for this service.</p>`
    }
  `;
}

// ==========================================
// STUDENT DASHBOARD
// ==========================================

function renderStudent() {
  const queue = liveQueues[activeStudentService];

  document.getElementById("studentQueueView").innerHTML = `
    <h3>${escapeHtml(activeStudentService)}</h3>

<div class="now-serving">
  <span>NOW SERVING</span>
  <strong>${queue.length ? escapeHtml(queue[0].queueNumber || "—") : "—"}</strong>
</div>
   <div class="metric">
  <strong>${queue.length > 1 ? escapeHtml(queue[1].studentNumber) : "—"}</strong>
  <span>Next in line</span>
</div>
    </div>
    ${
      queue.length
        ? `<ul class="queue-list">
            ${queue.map((person, i) => `
              <li>
  <span>
    <span class="queue-number">#${i + 1}</span>
    
<div class="queue-ticket">
  <h3>Queue Ticket</h3>
  <div class="ticket-number">
    ${escapeHtml(person.queueNumber || "No ticket")}
  </div>
  <div class="ticket-service">
    ${escapeHtml(person.service)}
  </div>
</div>

  </span>
  <span class="muted">
    ${person.joinedAt?.toDate?.()?.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    }) || ""}
  </span>
</li>
            `).join("")}
          </ul>`
        : `<p class="empty">No students are currently waiting for this service.</p>`
    }
  `;


  const me = document.getElementById("userLabel").textContent;

  const found = SERVICES.find(service =>
    liveQueues[service].some(person =>
      person.studentNumber?.toLowerCase() === me.toLowerCase()
    )
  );

  const status = document.getElementById("myQueueStatus");

  if (!found) {
    status.innerHTML = `
      <p class="muted">You are not currently in a queue.</p>
    `;
  
} else {
  const index = liveQueues[found].findIndex(person =>
    person.studentNumber?.toLowerCase() === me.toLowerCase()
  );

 let waitingTime;
const extraMinutes = adjustmentMinutes[found] || 0;

if (index === 0) {
  waitingTime = "Now Serving";
} else if (index < 5) {
  waitingTime = `${index * 5 + extraMinutes} minutes`;
} else {
  waitingTime = "Not available yet";
}

  status.innerHTML = `
    <p><strong>${escapeHtml(found)}</strong></p>
    <p>
      You are number <strong>#${index + 1}</strong> in line,
      with ${liveQueues[found].length - index - 1} student(s) ahead of you.
    </p>
    <p><strong>Estimated Waiting Time:</strong> ${waitingTime}</p>
  `;
}
}

// ==========================================
// STUDENT JOIN QUEUE
// ==========================================

document.getElementById("joinForm").addEventListener("submit", async e => {
  e.preventDefault();

  const service = document.getElementById("serviceSelect").value;
  const studentNumber = document.getElementById("userLabel").textContent;
  const uid = auth.currentUser.uid;
  const notice = document.getElementById("joinNotice");

  notice.textContent = "Joining queue...";

  try {
    // Check if this student already has an active queue entry
    const existingQuery = query(
      collection(db, "queueEntries"),
      where("uid", "==", uid),
      where("status", "==", "waiting")
    );

    const existingSnapshot = await getDocs(existingQuery);

    if (!existingSnapshot.empty) {
      notice.textContent =
        "You are already in a queue. Finish or ask the admin to remove your current entry first.";
      return;
    }

    // Save the new queue entry to Firestore
    const queueNumber = await generateQueueNumber(service);

await addDoc(collection(db, "queueEntries"), {
  uid: uid,
  studentNumber: studentNumber,
  queueNumber: queueNumber,
  service: service,
  status: "waiting",
  joinedAt: serverTimestamp()
});

    activeStudentService = service;
    renderStudentTabs();
    renderStudent();

    notice.textContent = `You have joined the ${service} queue.`;

  } catch (error) {
    console.error("Join queue error:", error);
    notice.textContent = "Unable to join queue. Please try again.";
  }
});

// ==========================================
// ADMIN DASHBOARD
// ==========================================
async function generateQueueNumber(service) {
  const counterRef = doc(db, "queueCounters", service);

  const nextNumber = await runTransaction(db, async transaction => {
    const counterSnapshot = await transaction.get(counterRef);

    const currentNumber = counterSnapshot.exists()
      ? counterSnapshot.data().lastNumber
      : 0;

    const newNumber = currentNumber + 1;

    transaction.set(counterRef, {
      lastNumber: newNumber
    });

    return newNumber;
  });

  const prefixMap = {
    "Transcript of Records (TOR)": "TOR",
    "Certificate of Enrollment": "COE",
    "Certificate of Grades": "COG",
    "Good Moral Certificate": "GMC",
    "Document Request / Follow-up": "DRF",
    "Other Registrar Concern": "ORC"
  };

  const prefix = prefixMap[service] || "Q";

  return `${prefix}-${String(nextNumber).padStart(3, "0")}`;
}
function renderAdmin() {
  const queue = liveQueues[activeAdminService] || [];
  const extraMinutes = adjustmentMinutes[activeAdminService] || 0;

  const rows = queue.map((person, index) => `
    <li>
      <span>
        <span class="queue-number">#${index + 1}</span>
        <strong>${escapeHtml(person.queueNumber || "No ticket")} — ${escapeHtml(person.studentNumber)}</strong>
        <span class="muted">
          ${person.joinedAt?.toDate?.()?.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          }) || ""}
        </span>
      </span>
      <span class="queue-actions">
       <button class="small-button secondary"
  onclick="console.log('CLICKED'); window.moveNext('${escapeHtml(activeAdminService).replace(/'/g, "\\'")}', ${index})">
  Mark Served
</button>
        <button class="small-button remove-button"
          onclick="removeStudent('${escapeHtml(activeAdminService).replace(/'/g, "\\'")}',${index})">
          Remove
        </button>
      </span>
    </li>
  `).join("");

  document.getElementById("adminQueueView").innerHTML = `
    <h3>${escapeHtml(activeAdminService)}</h3>

    <div class="queue-summary">
      <div class="metric">
        <strong>${queue.length}</strong>
        <span>People waiting</span>
      </div>
    </div>

    <!-- Waiting Time Adjustment -->
    <div class="queue-summary">
      <div class="metric">
        <strong>+${extraMinutes} min</strong>
        <span>Extra Waiting Time</span>
      </div>

      <div class="queue-actions">
        <button class="small-button secondary"
          onclick="window.adjustWaitingTime('${escapeHtml(activeAdminService).replace(/'/g, "\\'")}', 1)">
          +1 Minute
        </button>

        <button class="small-button secondary"
          onclick="window.adjustWaitingTime('${escapeHtml(activeAdminService).replace(/'/g, "\\'")}', -1)">
          Undo 1 Minute
        </button>

        <button class="small-button remove-button"
          onclick="window.resetWaitingTimeAdjustment('${escapeHtml(activeAdminService).replace(/'/g, "\\'")}')">
          Reset
        </button>
      </div>
    </div>

    ${
      queue.length
        ? `<ul class="queue-list">${rows}</ul>`
        : `<p class="empty">No students are currently waiting for this service.</p>`
    }
  `;
}
window.renderAdmin = renderAdmin;

async function resetTicketCounter() {
  const service = activeAdminService;

  const confirmed = confirm(
    `Are you sure you want to reset the ticket counter for ${service}?\n\nThe next ticket will start at 001.`
  );

  if (!confirmed) return;

  try {
    const counterRef = doc(db, "queueCounters", service);

    await updateDoc(counterRef, {
      lastNumber: 0
    });

    alert(`Ticket counter for ${service} has been reset successfully.`);
  } catch (error) {
    console.error("Counter reset error:", error);
    alert("Unable to reset the ticket counter. Please check your permissions.");
  }
}

window.resetTicketCounter = resetTicketCounter;

// ==========================================
// ADMIN REMOVE / SERVE
// ==========================================

async function removeStudent(service, index) {
  console.log("REMOVE CLICKED:", service, index);
  const queue = liveQueues[service];
  const person = queue[index];

  if (!person || !person.id) {
    console.error("Queue entry not found.");
    return;
  }

  try {
    await deleteDoc(doc(db, "queueEntries", person.id));
    console.log("Queue entry removed successfully.");
  } catch (error) {
    console.error("Error removing queue entry:", error);
    alert("Unable to remove queue entry.");
  }
}

async function moveNext(service, index) {
  console.log("MOVE NEXT FUNCTION RUNNING:", service, index);

  const queue = liveQueues[service];
  const person = queue[index];

  if (!person || !person.id) {
    console.error("Queue entry not found.");
    return;
  }

  try {
    await updateDoc(doc(db, "queueEntries", person.id), {
      status: "served",
      servedAt: serverTimestamp()
    });

    console.log("Student marked as served.");
  } catch (error) {
    console.error("Error marking student as served:", error);
    alert("Unable to mark student as served.");
  }
}

window.removeStudent = removeStudent;
window.moveNext = moveNext;

// ==========================================
// ADMIN ADD STUDENT
// ==========================================

document.getElementById("adminAddForm").addEventListener("submit", async e => {
  e.preventDefault();

  const studentNumber = document.getElementById("adminStudentNumber").value.trim();
  const service = document.getElementById("adminServiceSelect").value;
  const notice = document.getElementById("adminNotice");

  if (!studentNumber) return;

  notice.textContent = "Adding student...";

  try {
    // Check if student is already waiting in any queue
    const existingQuery = query(
      collection(db, "queueEntries"),
      where("studentNumber", "==", studentNumber),
      where("status", "==", "waiting")
    );

    const existingSnapshot = await getDocs(existingQuery);

    if (!existingSnapshot.empty) {
      notice.textContent = "This student is already in a queue.";
      return;
    }

    // Create queue entry in Firestore
    await addDoc(collection(db, "queueEntries"), {
      studentNumber: studentNumber,
      service: service,
      uid: null,
      addedByAdmin: true,
      status: "waiting",
      joinedAt: serverTimestamp()
    });

    activeAdminService = service;
    renderAdminTabs();
    renderAdmin();

    document.getElementById("adminStudentNumber").value = "";
    notice.textContent = "Student added to the selected queue.";

  } catch (error) {
    console.error("Admin add student error:", error);
    notice.textContent = "Unable to add student. Please try again.";
  }
});
