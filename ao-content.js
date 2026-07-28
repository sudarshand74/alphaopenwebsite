import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=5";

const byId = (id) => document.getElementById(id);
const CONTENT = "aoContent";
const CATEGORIES = "aoFaqCategories";
const FAQS = "aoFaqs";
let adminContent = [];
let adminCategories = [];
let adminFaqs = [];

function isSuperAdmin() {
  const authorization = window.alphaOpenAuthorization || {};
  return authorization.role === "Super Admin"
    || (authorization.roles || []).includes("superAdmin");
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sorted(items, secondary = "title") {
  return [...items].sort((a, b) =>
    number(a.displayOrder, 999) - number(b.displayOrder, 999)
    || String(a[secondary] || "").localeCompare(String(b[secondary] || ""))
  );
}

function empty(container, title, copy) {
  container.replaceChildren();
  const node = document.createElement("div");
  node.className = "dashboard-card empty-state compact";
  const heading = document.createElement("b");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = copy;
  node.append(heading, paragraph);
  container.appendChild(node);
}

function contentCard(record) {
  const article = document.createElement("article");
  article.className = `dashboard-card ao-content-card ${record.sectionType === "currentSeason" ? "featured" : ""}`;
  const meta = document.createElement("span");
  meta.className = "kicker";
  meta.textContent = record.seasonYear || record.seasonId
    ? [record.seasonId, record.seasonYear].filter(Boolean).join(" · ")
    : record.sectionType === "history" ? "AlphaOpen history" : "Season";
  const title = document.createElement("h3");
  title.textContent = record.title;
  const summary = document.createElement("p");
  summary.className = "ao-content-summary";
  summary.textContent = record.summary || "";
  const body = document.createElement("div");
  body.className = "ao-content-body";
  body.textContent = record.content || "";
  article.append(meta, title);
  if (record.summary) article.appendChild(summary);
  article.appendChild(body);
  return article;
}

function renderPublicContent(records) {
  const groups = {
    history: byId("aoHistoryList"),
    currentSeason: byId("aoCurrentSeasonList"),
    pastSeason: byId("aoPastSeasonsList")
  };
  Object.entries(groups).forEach(([sectionType, container]) => {
    const sectionRecords = sorted(records.filter((item) => item.sectionType === sectionType));
    if (!sectionRecords.length) {
      empty(container, `No ${sectionType === "pastSeason" ? "past seasons" : sectionType === "currentSeason" ? "current season" : "history"} published`, "System Admin can publish this information from the Admin control room.");
      return;
    }
    container.replaceChildren(...sectionRecords.map(contentCard));
  });
}

function renderPublicFaqs(categories, faqs) {
  const container = byId("aoFaqList");
  const activeCategories = sorted(categories, "name");
  const sections = activeCategories.map((category) => {
    const categoryFaqs = sorted(faqs.filter((faq) => faq.categoryId === category.id), "question");
    if (!categoryFaqs.length) return null;
    const section = document.createElement("section");
    section.className = "ao-faq-category";
    const heading = document.createElement("h3");
    heading.textContent = category.name;
    section.appendChild(heading);
    categoryFaqs.forEach((faq) => {
      const details = document.createElement("details");
      details.className = "dashboard-card ao-faq-item";
      const question = document.createElement("summary");
      question.textContent = faq.question;
      const answer = document.createElement("div");
      answer.className = "ao-faq-answer";
      answer.textContent = faq.answer;
      details.append(question, answer);
      section.appendChild(details);
    });
    return section;
  }).filter(Boolean);
  if (!sections.length) {
    empty(container, "No FAQs published", "Active FAQs will appear here by category.");
    return;
  }
  container.replaceChildren(...sections);
}

async function loadPublicAo() {
  if (!byId("aoPublicMessage")) return;
  byId("aoPublicMessage").textContent = "Loading AlphaOpen information…";
  const active = (name, maximum) =>
    getDocs(query(collection(db, name), where("status", "==", "active"), limit(maximum)));
  const [contentSnapshot, categorySnapshot, faqSnapshot] = await Promise.all([
    active(CONTENT, 100),
    active(CATEGORIES, 100),
    active(FAQS, 250)
  ]);
  const map = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const content = map(contentSnapshot);
  const categories = map(categorySnapshot);
  const faqs = map(faqSnapshot);
  renderPublicContent(content);
  renderPublicFaqs(categories, faqs);
  byId("aoPublicMessage").textContent =
    `${content.length} AO information record${content.length === 1 ? "" : "s"} and ${faqs.length} active FAQ${faqs.length === 1 ? "" : "s"}.`;
}

function adminRow(record, type, label, detail) {
  const row = document.createElement("article");
  row.className = "ao-admin-row";
  const copy = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = label;
  const description = document.createElement("small");
  description.textContent = detail;
  copy.append(title, description);
  const badge = document.createElement("span");
  badge.className = `badge ${record.status === "active" ? "lime" : "gray"}`;
  badge.textContent = record.status || "inactive";
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary compact-button";
  edit.textContent = "Edit";
  edit.dataset.aoEdit = type;
  edit.dataset.recordId = record.id;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary compact-button danger-button";
  remove.textContent = "Delete";
  remove.dataset.aoDelete = type;
  remove.dataset.recordId = record.id;
  actions.append(edit, remove);
  row.append(copy, badge, actions);
  return row;
}

function updateCategorySelect(selected = "") {
  const select = byId("aoFaqCategory");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = adminCategories.length ? "Select category" : "Add a category first";
  select.appendChild(placeholder);
  sorted(adminCategories, "name").forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.name}${category.status === "active" ? "" : " (Inactive)"}`;
    select.appendChild(option);
  });
  select.value = selected;
}

function renderAdmin() {
  const contentList = byId("aoContentAdminList");
  const categoryList = byId("aoCategoryAdminList");
  const faqList = byId("aoFaqAdminList");
  contentList.replaceChildren(...sorted(adminContent).map((record) =>
    adminRow(record, "content", record.title, `${record.sectionType} · order ${number(record.displayOrder)}`)
  ));
  categoryList.replaceChildren(...sorted(adminCategories, "name").map((record) =>
    adminRow(record, "category", record.name, `Category order ${number(record.displayOrder)}`)
  ));
  const categoryNames = new Map(adminCategories.map((item) => [item.id, item.name]));
  faqList.replaceChildren(...[...adminFaqs].sort((a, b) =>
    number(adminCategories.find((item) => item.id === a.categoryId)?.displayOrder, 999)
    - number(adminCategories.find((item) => item.id === b.categoryId)?.displayOrder, 999)
    || number(a.displayOrder, 999) - number(b.displayOrder, 999)
  ).map((record) =>
    adminRow(record, "faq", record.question, `${categoryNames.get(record.categoryId) || "Missing category"} · order ${number(record.displayOrder)}`)
  ));
  if (!adminContent.length) empty(contentList, "No AO content", "Add the first History or Season record above.");
  if (!adminCategories.length) empty(categoryList, "No FAQ categories", "Add the first category above.");
  if (!adminFaqs.length) empty(faqList, "No FAQs", "Add the first question after creating a category.");
  updateCategorySelect(byId("aoFaqCategory").value);
}

async function loadAdmin() {
  if (!isSuperAdmin() || !byId("aoContentAdminList")) return;
  const [contentSnapshot, categorySnapshot, faqSnapshot] = await Promise.all([
    getDocs(collection(db, CONTENT)),
    getDocs(collection(db, CATEGORIES)),
    getDocs(collection(db, FAQS))
  ]);
  const map = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  adminContent = map(contentSnapshot);
  adminCategories = map(categorySnapshot);
  adminFaqs = map(faqSnapshot);
  renderAdmin();
}

function resetContentForm() {
  byId("aoContentForm").reset();
  byId("aoContentId").value = "";
  byId("aoContentOrder").value = "1";
}

function resetCategoryForm() {
  byId("aoCategoryForm").reset();
  byId("aoCategoryId").value = "";
  byId("aoCategoryOrder").value = "1";
}

function resetFaqForm() {
  byId("aoFaqForm").reset();
  byId("aoFaqId").value = "";
  byId("aoFaqOrder").value = "1";
  updateCategorySelect();
}

async function saveContent(event) {
  event.preventDefault();
  if (!isSuperAdmin()) throw new Error("Super Admin access is required.");
  const id = byId("aoContentId").value;
  const payload = {
    sectionType: byId("aoContentSection").value,
    title: byId("aoContentTitle").value.trim(),
    seasonId: byId("aoContentSeasonId").value.trim() || null,
    seasonYear: number(byId("aoContentSeasonYear").value) || null,
    displayOrder: number(byId("aoContentOrder").value),
    status: byId("aoContentStatus").value,
    summary: byId("aoContentSummary").value.trim(),
    content: byId("aoContentBody").value.trim(),
    updatedAt: serverTimestamp(),
    updatedByUid: auth.currentUser.uid
  };
  if (payload.sectionType === "currentSeason" && payload.status === "active") {
    const batch = writeBatch(db);
    adminContent
      .filter((item) => item.sectionType === "currentSeason" && item.status === "active" && item.id !== id)
      .forEach((item) => batch.update(doc(db, CONTENT, item.id), {
        status: "inactive", updatedAt: serverTimestamp(), updatedByUid: auth.currentUser.uid
      }));
    if (id) batch.update(doc(db, CONTENT, id), payload);
    else {
      const reference = doc(collection(db, CONTENT));
      batch.set(reference, { ...payload, createdAt: serverTimestamp(), createdByUid: auth.currentUser.uid });
    }
    await batch.commit();
  } else if (id) await updateDoc(doc(db, CONTENT, id), payload);
  else await addDoc(collection(db, CONTENT), { ...payload, createdAt: serverTimestamp(), createdByUid: auth.currentUser.uid });
  resetContentForm();
  byId("aoContentAdminMessage").textContent = "AO content saved.";
  await refreshAll();
}

async function saveCategory(event) {
  event.preventDefault();
  if (!isSuperAdmin()) throw new Error("Super Admin access is required.");
  const id = byId("aoCategoryId").value;
  const payload = {
    name: byId("aoCategoryName").value.trim(),
    displayOrder: number(byId("aoCategoryOrder").value),
    status: byId("aoCategoryStatus").value,
    updatedAt: serverTimestamp(),
    updatedByUid: auth.currentUser.uid
  };
  if (id) await updateDoc(doc(db, CATEGORIES, id), payload);
  else await addDoc(collection(db, CATEGORIES), { ...payload, createdAt: serverTimestamp(), createdByUid: auth.currentUser.uid });
  resetCategoryForm();
  byId("aoCategoryAdminMessage").textContent = "FAQ category saved.";
  await refreshAll();
}

async function saveFaq(event) {
  event.preventDefault();
  if (!isSuperAdmin()) throw new Error("Super Admin access is required.");
  const id = byId("aoFaqId").value;
  const payload = {
    categoryId: byId("aoFaqCategory").value,
    question: byId("aoFaqQuestion").value.trim(),
    answer: byId("aoFaqAnswer").value.trim(),
    displayOrder: number(byId("aoFaqOrder").value),
    status: byId("aoFaqStatus").value,
    updatedAt: serverTimestamp(),
    updatedByUid: auth.currentUser.uid
  };
  if (id) await updateDoc(doc(db, FAQS, id), payload);
  else await addDoc(collection(db, FAQS), { ...payload, createdAt: serverTimestamp(), createdByUid: auth.currentUser.uid });
  resetFaqForm();
  byId("aoFaqAdminMessage").textContent = "FAQ saved.";
  await refreshAll();
}

function editRecord(type, id) {
  if (type === "content") {
    const record = adminContent.find((item) => item.id === id);
    if (!record) return;
    byId("aoContentId").value = record.id;
    byId("aoContentSection").value = record.sectionType;
    byId("aoContentTitle").value = record.title || "";
    byId("aoContentSeasonId").value = record.seasonId || "";
    byId("aoContentSeasonYear").value = record.seasonYear || "";
    byId("aoContentOrder").value = number(record.displayOrder);
    byId("aoContentStatus").value = record.status || "inactive";
    byId("aoContentSummary").value = record.summary || "";
    byId("aoContentBody").value = record.content || "";
    byId("aoContentTitle").focus();
  } else if (type === "category") {
    const record = adminCategories.find((item) => item.id === id);
    if (!record) return;
    byId("aoCategoryId").value = record.id;
    byId("aoCategoryName").value = record.name || "";
    byId("aoCategoryOrder").value = number(record.displayOrder);
    byId("aoCategoryStatus").value = record.status || "inactive";
    byId("aoCategoryName").focus();
  } else {
    const record = adminFaqs.find((item) => item.id === id);
    if (!record) return;
    byId("aoFaqId").value = record.id;
    updateCategorySelect(record.categoryId);
    byId("aoFaqOrder").value = number(record.displayOrder);
    byId("aoFaqStatus").value = record.status || "inactive";
    byId("aoFaqQuestion").value = record.question || "";
    byId("aoFaqAnswer").value = record.answer || "";
    byId("aoFaqQuestion").focus();
  }
}

async function deleteRecord(type, id) {
  if (!isSuperAdmin()) throw new Error("Super Admin access is required.");
  if (type === "category" && adminFaqs.some((faq) => faq.categoryId === id))
    throw new Error("Move or delete every FAQ in this category before deleting it.");
  const labels = { content: "AO content record", category: "FAQ category", faq: "FAQ" };
  if (!window.confirm(`Permanently delete this ${labels[type]}?`)) return;
  const collectionName = type === "content" ? CONTENT : type === "category" ? CATEGORIES : FAQS;
  await deleteDoc(doc(db, collectionName, id));
  await refreshAll();
}

async function refreshAll() {
  await Promise.all([loadAdmin(), loadPublicAo()]);
}

function handleAdminClick(event) {
  const edit = event.target.closest("[data-ao-edit]");
  const remove = event.target.closest("[data-ao-delete]");
  if (edit) editRecord(edit.dataset.aoEdit, edit.dataset.recordId);
  if (remove) deleteRecord(remove.dataset.aoDelete, remove.dataset.recordId)
    .catch((error) => window.alphaOpenAuthUI?.showMessage(error.message));
}

function printFaqs() {
  document.querySelectorAll(".ao-faq-item").forEach((item) => item.open = true);
  window.print();
}

byId("aoContentForm")?.addEventListener("submit", (event) =>
  saveContent(event).catch((error) => byId("aoContentAdminMessage").textContent = error.message));
byId("aoCategoryForm")?.addEventListener("submit", (event) =>
  saveCategory(event).catch((error) => byId("aoCategoryAdminMessage").textContent = error.message));
byId("aoFaqForm")?.addEventListener("submit", (event) =>
  saveFaq(event).catch((error) => byId("aoFaqAdminMessage").textContent = error.message));
byId("cancelAoContentEdit")?.addEventListener("click", resetContentForm);
byId("cancelAoCategoryEdit")?.addEventListener("click", resetCategoryForm);
byId("cancelAoFaqEdit")?.addEventListener("click", resetFaqForm);
byId("aoContentAdminList")?.addEventListener("click", handleAdminClick);
byId("aoCategoryAdminList")?.addEventListener("click", handleAdminClick);
byId("aoFaqAdminList")?.addEventListener("click", handleAdminClick);
byId("printAoFaqs")?.addEventListener("click", printFaqs);
byId("printAoFaqsInline")?.addEventListener("click", printFaqs);

window.addEventListener("alphaopen:route-changed", (event) => {
  if (event.detail?.route === "ao") loadPublicAo().catch((error) => {
    byId("aoPublicMessage").textContent = `About AO information is unavailable: ${error.message}`;
  });
});
window.addEventListener("alphaopen:admin-panel-changed", (event) => {
  if (event.detail?.panel === "ao-content") loadAdmin().catch((error) => {
    byId("aoContentAdminMessage").textContent = `AO Admin data is unavailable: ${error.message}`;
  });
});
onAuthStateChanged(auth, () => {
  if (location.hash === "#ao") loadPublicAo().catch((error) => {
    byId("aoPublicMessage").textContent = `About AO information is unavailable: ${error.message}`;
  });
});
