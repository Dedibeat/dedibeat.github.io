import { parseSearch, evalSearchAst } from './search.js';

const API_BASE = 'https://script.google.com/macros/s/AKfycbxnClmvPtVRcJiXVHM5qaZMKxfXCDiHsdUz9VFWUpEaNHM-IGEWhgTM23ZBdr-nVecN/exec';

let Problems = [];

const STATUS_OPTIONS = ['no submission','tl','re','wa','ac','ni'];


/* ------------------ utilities ------------------ */
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function statusClass(status) {
  if (status == 'AC') return 'status-solved';
  if (status == '') return 'status-nosub';
  return 'status-unsolved';
}
function difficultyBadge(d) {
  let val = parseFloat(d);
  if (Number.isNaN(val)) val = 0;
  let norm = val;
  if (val > 1) norm = val / 100;
  norm = Math.max(0, Math.min(1, norm));
  const hue = Math.round(norm * 120);
  const bg = `hsl(${hue},70%,85%)`;
  const percentText = (norm * 100).toFixed(1) + '%';
  return `<span class="difficulty" style="background:${bg};border:1px solid rgba(0,0,0,0.06)">${percentText}</span>`;
}

/* ------------------ fetch public list ------------------ */
async function fetchData() {
  const url = API_BASE + '?action=' + encodeURIComponent('getProblems');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET getProblems failed: ${res.status}`);
  return res.json();
}

/* ------------------ render table ------------------ */
function renderTable() {
  const tbody = document.querySelector('#problemsTable tbody');
  tbody.innerHTML = '';
  const member = document.getElementById('memberSelect').value;
  const filter = document.getElementById('filterSelect').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const sortMode = document.getElementById('sortSelect').value;

  // copy array
  let data = Array.isArray(Problems) ? Problems.slice() : [];

  // search
  if (search) {
    const hayGetter = d =>
      (String(d.Name || d.name || '') + ' ' +
       String(d.Tags || '') + ' ' +
       String(d['Contest'] || '') + ' ' +
       String(d._rowId || '')).toLowerCase();

    let ast = null;
    try {
      ast = parseSearch(search);
    } catch (err) {
      console.warn('Parse error, fallback substring:', err);
    }

    if (ast) {
      data = data.filter(d => evalSearchAst(ast, hayGetter(d)));
    } else {
      const needle = search.toLowerCase();
      data = data.filter(d => hayGetter(d).includes(needle));
    }
  }

  // filter by member status
  if (filter === 'solved') data = data.filter(d => (d[member + ' status'] === 'AC'));
  else if (filter === 'unsolved') data = data.filter(d => (d[member + ' status'] !== 'AC'));
  else if (filter === 'no submission') data = data.filter(d => (d[member + ' status'] === ''));

  // sort
  if (sortMode === 'difficulty_desc') data.sort((a, b) => parseFloat(b.Difficulty || 0) - parseFloat(a.Difficulty || 0));
  else if (sortMode === 'difficulty_asc') data.sort((a, b) => parseFloat(a.Difficulty || 0) - parseFloat(b.Difficulty || 0));
  else if (sortMode === 'teams_solved_desc') data.sort((a, b) => parseFloat(b['Teams solved'] || 0) - parseFloat(a['Teams solved'] || 0));
  else if (sortMode === 'id_asc') data.sort((a, b) => parseInt(a['id'] || 0) - parseInt(b['id'] || 0));

  // render
  data.forEach(row => {
    const id = Number(row['id']);
    const status = row[member + ' status'] || '';

    const url = row.Name_link || row.name_link || row.Link || row.link || null;
    const nameText = row.Name || row.name || '';
    const nameHtml = url
      ? `<a href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(nameText)}</a>`
      : escapeHtml(nameText);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(id)}</td>
      <td>${escapeHtml(row['Contest'] || '')}</td>
      <td>${nameHtml}</td>
      <td>${escapeHtml(row.Tags || '')}</td>
      <td>${difficultyBadge(row.Difficulty)}</td>
      <td>${escapeHtml(row['Teams solved'] || '')}</td>
      <td class="${statusClass(status)}" data-rowid="${escapeHtmlAttr(id)}">${escapeHtml(status)}</td>
    `;
    const statusTd = tr.querySelector('td[data-rowid]');
    if (statusTd) statusTd.addEventListener('click', ()=>showStatusEditor(statusTd, id, member, status));
    tbody.appendChild(tr);
  });
}

/* ---------- Inline status editor (drop-in replacement) ---------- */
function showStatusEditor(td, id, member, status){
  // current value normalization: '' => 'no submission', else lowercase code
  const current = (status === undefined || status === null || String(status).trim() === '') ? 'no submission' : String(status).trim().toLowerCase();

  const sel = document.createElement('select');
  STATUS_OPTIONS.forEach(v=>{
    const o = document.createElement('option');
    o.value = v;                            // save lowercase (or 'no submission')
    o.textContent = (v === 'no submission') ? v : v.toUpperCase(); // display text
    sel.appendChild(o);
  });

  sel.value = current;
  sel.className = 'inline-select';

  // insert into cell and focus
  td.innerHTML = '';
  td.appendChild(sel);
  sel.focus();

  let done = false;
  async function finish(save){
    if (done) return;
    done = true;

    const newVal = (sel.value || '').toString().trim().toLowerCase(); // 'no submission' or e.g. 'ac','wa'
    const displayText = (newVal === 'no submission') ? '' : newVal.toUpperCase();

    if (save && newVal !== current){
      // update local Problems array (keep member-specific key like "Dugar status")
      const pid = Number(id);
      if (Array.isArray(Problems)) {
        const p = Problems.find(pr => Number(pr['id']) === pid || Number(pr._rowId) === pid);
        if (p) {
          p[member + ' status'] = (newVal === 'no submission') ? '' : newVal.toUpperCase();
        }
      }

      // update cell display immediately
      td.textContent = displayText;
      td.className = statusClass(displayText);

      try {
        const url = API_BASE + '?action=' + encodeURIComponent('updateStatus');
        const body = new URLSearchParams({
          id: pid,
          member: member,
          status: (newVal === 'no submission') ? '' : newVal.toUpperCase()
        }).toString();

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body
        });

        const text = await res.text();
        if (!res.ok) {
          throw new Error('Server returned ' + res.status + ': ' + text);
        }
        // try to keep local status list in sync if you implement reloadStatus()
        if (typeof reloadStatus === 'function') await reloadStatus();
      } catch (err) {
        console.error('Save failed', err);
        td.style.outline = '2px solid rgba(200,0,0,0.6)';
        alert('Save failed: ' + (err && err.message));
        // fallback: reload everything to be safe
        if (typeof reloadAll === 'function') await reloadAll();
      }
    } else {
      // nothing changed, just re-render
      renderTable();
    }
  }

  sel.addEventListener('blur', ()=>finish(true));
  sel.addEventListener('change', ()=>finish(true));
  sel.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Escape') renderTable();
    else if (ev.key === 'Enter') finish(true);
  });
}


/* ------------------ toggle tags (CSS class) ------------------ */
function toggleTags() {
  const table = document.getElementById('problemsTable');
  const button = document.getElementById('toggle-tags');
  table.classList.toggle('tags-hidden');
  const visible = !table.classList.contains('tags-hidden');
  button.textContent = visible ? 'Hide tags' : 'Show tags';
}

/* ------------------ Google Sign-In helpers ------------------ */
/* Called automatically by GSI after success (configured in index.html g_id_onload) */
function handleCredentialResponse(response) {
  // response.credential is the ID token (JWT)
  localStorage.setItem('id_token', response.credential);
  showSignedIn(response.credential);
}

/* show user info client-side (not used for auth) */
function showSignedIn(idToken) {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    document.getElementById('userInfo').textContent = payload.email || payload.name || 'Signed in';
  } catch (e) {
    document.getElementById('userInfo').textContent = 'Signed in';
  }
  document.getElementById('logoutBtn').style.display = 'inline-block';
  // hide the GSI button so user doesn't click it again
  const gsi = document.getElementById('gsi-container');
  if (gsi) gsi.style.display = 'none';
}

/* sign-out on client (removes token) */
function signOutClient() {
  localStorage.removeItem('id_token');
  document.getElementById('userInfo').textContent = '';
  document.getElementById('logoutBtn').style.display = 'none';
  const gsi = document.getElementById('gsi-container');
  if (gsi) gsi.style.display = '';
}




/* ------------------ wiring + init ------------------ */
document.getElementById('toggle-tags').addEventListener('click', toggleTags);
document.getElementById('memberSelect').addEventListener('change', renderTable);
document.getElementById('filterSelect').addEventListener('change', renderTable);
document.getElementById('sortSelect').addEventListener('change', renderTable);
document.getElementById('searchInput').addEventListener('input', renderTable);
document.getElementById('logoutBtn').addEventListener('click', signOutClient);

async function reloadAll() {
  try {
    Problems = await fetchData();
    renderTable();
    document.getElementById('summary').textContent = `${Array.isArray(Problems) ? Problems.length : 0} problems`;

    // set initial tag button text
    const initialVisible = !document.getElementById('problemsTable').classList.contains('tags-hidden');
    document.getElementById('toggle-tags').textContent = initialVisible ? 'Hide tags' : 'Show tags';

    // if token exists from previous session, show it
    const existing = localStorage.getItem('id_token');
    if (existing) showSignedIn(existing);
  } catch (err) {
    console.error(err);
    document.getElementById('summary').textContent = 'Failed to load problems';
  }
}

reloadAll();

