(function () {
  const KEY = {
    users: 'cp_users',
    complaints: 'cp_complaints',
    updates: 'cp_updates',
    notifications: 'cp_notifications',
    currentUser: 'cp_current_user'
  };

  const CATEGORIES = ['Library', 'Lab', 'Hostel', 'Wi-Fi', 'Other'];
  const PRIORITIES = ['Low', 'Medium', 'High'];
  const STATUSES = ['Submitted', 'In Review', 'In Progress', 'Resolved', 'Rejected'];
  const OPEN_STATUSES = new Set(['Submitted', 'In Review', 'In Progress']);
  const ALLOWED_FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
  const PRIORITY_DUE_DAYS = { High: 2, Medium: 4, Low: 7 };
  // Rate limit: maximum 3 complaints per 10-minute window per student.
  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  const SUBMIT_WINDOW_MS = 10 * 60 * 1000;
  const SUBMIT_LIMIT = 3;
  const ADMIN_PASSWORD_HASH = 'e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7';

  function nowISO() { return new Date().toISOString(); }
  function generateId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  async function hashPassword(password) {
    const data = new TextEncoder().encode(String(password));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function sanitize(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .trim();
  }

  function toDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function setMessage(el, type, message) {
    if (!el) return;
    if (!message) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<div class="${type}">${message}</div>`;
  }

  function formatDate(iso) {
    const d = toDate(iso);
    return d ? d.toLocaleString() : '-';
  }

  function normalizeStatusClass(status) {
    return String(status || '').replace(/\s+/g, '');
  }

  function seedData() {
    const users = read(KEY.users, []);
    if (!users.some(u => u.role === 'admin' && u.email === 'admin@college.edu')) {
      users.push({
        id: 'admin-1',
        name: 'Portal Admin',
        email: 'admin@college.edu',
        password_hash: ADMIN_PASSWORD_HASH,
        role: 'admin',
        department: 'Administration',
        created_at: nowISO()
      });
    } else {
      users.forEach(u => {
        if (u.email === 'admin@college.edu' && u.password === 'Admin@123' && !u.password_hash) {
          u.password_hash = ADMIN_PASSWORD_HASH;
          delete u.password;
        }
      });
    }
    write(KEY.users, users);

    if (!Array.isArray(read(KEY.complaints, null))) write(KEY.complaints, []);
    if (!Array.isArray(read(KEY.updates, null))) write(KEY.updates, []);
    if (!Array.isArray(read(KEY.notifications, null))) write(KEY.notifications, []);
  }

  function currentUser() {
    return read(KEY.currentUser, null);
  }

  function setCurrentUser(user) {
    write(KEY.currentUser, user);
  }

  function logout() {
    localStorage.removeItem(KEY.currentUser);
    window.location.href = '/login.html';
  }

  function requireRole(role) {
    const user = currentUser();
    if (!user || (role && user.role !== role)) return null;
    return user;
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async function registerStudent({ name, email, department, password, confirmPassword }) {
    const cleanName = sanitize(name);
    const cleanEmail = sanitize(email).toLowerCase();
    const cleanDepartment = sanitize(department);

    if (cleanName.length < 2) return { ok: false, error: 'Name must be at least 2 characters.' };
    if (!validateEmail(cleanEmail)) return { ok: false, error: 'Enter a valid email address.' };
    if (cleanDepartment.length < 2) return { ok: false, error: 'Department is required.' };
    if (String(password).length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    if (password !== confirmPassword) return { ok: false, error: 'Passwords do not match.' };

    const users = read(KEY.users, []);
    if (users.some(u => u.email === cleanEmail)) return { ok: false, error: 'Email already exists.' };

    const user = {
      id: generateId('stu'),
      name: cleanName,
      email: cleanEmail,
      department: cleanDepartment,
      role: 'student',
      password_hash: await hashPassword(password),
      created_at: nowISO()
    };
    users.push(user);
    write(KEY.users, users);
    return { ok: true };
  }

  async function login({ email, password }) {
    const cleanEmail = sanitize(email).toLowerCase();
    const users = read(KEY.users, []);
    const found = users.find(u => u.email === cleanEmail);
    if (!found) return { ok: false, error: 'Invalid credentials.' };
    const hashed = await hashPassword(password);
    const matched = found.password_hash ? found.password_hash === hashed : found.password === password;
    if (!matched) return { ok: false, error: 'Invalid credentials.' };
    if (!found.password_hash) {
      found.password_hash = hashed;
      delete found.password;
      write(KEY.users, users);
    }
    setCurrentUser({ id: found.id, name: found.name, email: found.email, role: found.role, department: found.department });
    return { ok: true, role: found.role };
  }

  function submitLimitExceeded(userId) {
    const key = `cp_rate_${userId}`;
    const now = Date.now();
    const events = read(key, []).filter(ts => now - ts < SUBMIT_WINDOW_MS);
    events.push(now);
    write(key, events);
    return events.length > SUBMIT_LIMIT;
  }

  function dueDateForPriority(priority, expectedDaysInput) {
    const fallback = PRIORITY_DUE_DAYS[priority] || 5;
    const n = Number(expectedDaysInput);
    const days = Number.isFinite(n) && n > 0 && n <= 30 ? n : fallback;
    const due = new Date();
    due.setDate(due.getDate() + days);
    return due.toISOString();
  }

  function validateAttachment(file) {
    if (!file) return { ok: true, value: null };
    if (!ALLOWED_FILE_TYPES.has(file.type)) return { ok: false, error: 'Only PNG, JPG, WEBP, and PDF attachments are allowed.' };
    if (file.size > MAX_FILE_SIZE) return { ok: false, error: 'Attachment must be 2 MB or smaller.' };
    return {
      ok: true,
      value: {
        name: sanitize(file.name),
        type: sanitize(file.type),
        size: file.size,
        uploaded_at: nowISO()
      }
    };
  }

  function addUpdate({ complaintId, actorId, actorName, message, newStatus }) {
    const updates = read(KEY.updates, []);
    updates.push({
      id: generateId('upd'),
      complaint_id: complaintId,
      actor_id: actorId,
      actor_name: sanitize(actorName),
      message: sanitize(message),
      new_status: newStatus || null,
      created_at: nowISO()
    });
    write(KEY.updates, updates);
  }

  function addNotification({ userId, complaintId, message }) {
    const notifications = read(KEY.notifications, []);
    notifications.push({
      id: generateId('ntf'),
      user_id: userId,
      complaint_id: complaintId,
      message: sanitize(message),
      is_read: false,
      created_at: nowISO()
    });
    write(KEY.notifications, notifications);
  }

  function submitComplaint({ title, category, priority, description, expectedDays, attachment }, user) {
    const cleanTitle = sanitize(title);
    const cleanCategory = sanitize(category);
    const cleanPriority = sanitize(priority);
    const cleanDescription = sanitize(description);

    if (!cleanTitle || cleanTitle.length < 5 || cleanTitle.length > 120) {
      return { ok: false, error: 'Title must be between 5 and 120 characters.' };
    }
    if (!CATEGORIES.includes(cleanCategory)) return { ok: false, error: 'Invalid category selected.' };
    if (!PRIORITIES.includes(cleanPriority)) return { ok: false, error: 'Invalid priority selected.' };
    if (!cleanDescription || cleanDescription.length < 10 || cleanDescription.length > 2000) {
      return { ok: false, error: 'Description must be between 10 and 2000 characters.' };
    }
    if (submitLimitExceeded(user.id)) {
      return { ok: false, error: 'Rate limit exceeded: max 3 complaints in 10 minutes.' };
    }

    const fileValidation = validateAttachment(attachment);
    if (!fileValidation.ok) return { ok: false, error: fileValidation.error };

    const complaints = read(KEY.complaints, []);
    const complaint = {
      id: generateId('cmp'),
      title: cleanTitle,
      category: cleanCategory,
      priority: cleanPriority,
      status: 'Submitted',
      description: cleanDescription,
      attachment: fileValidation.value,
      created_by: user.id,
      created_by_name: user.name,
      created_at: nowISO(),
      updated_at: nowISO(),
      assigned_to: null,
      assigned_department: cleanCategory,
      due_at: dueDateForPriority(cleanPriority, expectedDays),
      escalated: false,
      resolved_at: null
    };
    complaints.push(complaint);
    write(KEY.complaints, complaints);

    addUpdate({
      complaintId: complaint.id,
      actorId: user.id,
      actorName: user.name,
      message: 'Complaint submitted',
      newStatus: 'Submitted'
    });

    return { ok: true, complaint };
  }

  function complaintUpdates(complaintId) {
    return read(KEY.updates, []).filter(u => u.complaint_id === complaintId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  function escalateOverdueComplaints(actorName) {
    const complaints = read(KEY.complaints, []);
    let changed = false;

    complaints.forEach(c => {
      if (c.escalated) return;
      const due = toDate(c.due_at);
      if (!due) return;
      if (OPEN_STATUSES.has(c.status) && due < new Date()) {
        c.escalated = true;
        c.updated_at = nowISO();
        changed = true;
        addUpdate({
          complaintId: c.id,
          actorId: 'system',
          actorName: actorName || 'System',
          message: 'Escalation triggered: expected resolution time exceeded.',
          newStatus: c.status
        });
        addNotification({
          userId: c.created_by,
          complaintId: c.id,
          message: `Complaint ${c.id} is escalated due to delay.`
        });
      }
    });

    if (changed) write(KEY.complaints, complaints);
    return changed;
  }

  function updateComplaint({ complaintId, assignedTo, status, note }, actor) {
    const complaints = read(KEY.complaints, []);
    const complaint = complaints.find(c => c.id === complaintId);
    if (!complaint) return { ok: false, error: 'Complaint not found.' };

    const cleanAssignedTo = sanitize(assignedTo || '');
    const cleanStatus = sanitize(status || complaint.status);
    const cleanNote = sanitize(note || '');

    if (!STATUSES.includes(cleanStatus)) return { ok: false, error: 'Invalid status.' };
    if (!cleanNote || cleanNote.length < 3) return { ok: false, error: 'Update note must be at least 3 characters.' };

    const previousAssignedTo = complaint.assigned_to;
    if (cleanAssignedTo) complaint.assigned_to = cleanAssignedTo;
    const previousStatus = complaint.status;
    complaint.status = cleanStatus;
    complaint.updated_at = nowISO();
    if (cleanStatus === 'Resolved' || cleanStatus === 'Rejected') complaint.resolved_at = nowISO();

    write(KEY.complaints, complaints);

    addUpdate({
      complaintId,
      actorId: actor.id,
      actorName: actor.name,
      message: cleanNote,
      newStatus: cleanStatus
    });

    const statusChanged = previousStatus !== cleanStatus;
    const assignmentChanged = Boolean(cleanAssignedTo && cleanAssignedTo !== previousAssignedTo);
    const changes = [];
    if (statusChanged) changes.push(`status changed to ${cleanStatus}`);
    if (assignmentChanged) changes.push(`assigned to ${cleanAssignedTo}`);
    if (changes.length) {
      const notify = `Complaint ${complaint.id} updated: ${changes.join(' and ')}.`;
      addNotification({ userId: complaint.created_by, complaintId, message: notify });
    }

    return { ok: true };
  }

  function markNotificationsRead(userId) {
    const notifications = read(KEY.notifications, []);
    let changed = false;
    notifications.forEach(n => {
      if (n.user_id === userId && !n.is_read) {
        n.is_read = true;
        changed = true;
      }
    });
    if (changed) write(KEY.notifications, notifications);
  }

  function userNotifications(userId) {
    return read(KEY.notifications, []).filter(n => n.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  function complaintById(idValue) {
    return read(KEY.complaints, []).find(c => c.id === idValue) || null;
  }

  function complaintsForUser(userId) {
    return read(KEY.complaints, []).filter(c => c.created_by === userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  function allComplaints() {
    return read(KEY.complaints, []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  function analytics() {
    const items = read(KEY.complaints, []);
    const open = items.filter(c => OPEN_STATUSES.has(c.status)).length;
    const resolved = items.filter(c => c.status === 'Resolved').length;
    const rejected = items.filter(c => c.status === 'Rejected').length;
    const escalated = items.filter(c => c.escalated).length;
    const byCategory = CATEGORIES.reduce((acc, cat) => {
      acc[cat] = items.filter(c => c.category === cat).length;
      return acc;
    }, {});

    return { total: items.length, open, resolved, rejected, escalated, byCategory };
  }

  function exportBackup() {
    const data = {
      users: read(KEY.users, []),
      complaints: read(KEY.complaints, []),
      updates: read(KEY.updates, []),
      notifications: read(KEY.notifications, [])
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `complaint-portal-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.portal = {
    CATEGORIES,
    PRIORITIES,
    STATUSES,
    formatDate,
    normalizeStatusClass,
    sanitize,
    setMessage,
    seedData,
    currentUser,
    requireRole,
    logout,
    registerStudent,
    login,
    submitComplaint,
    complaintsForUser,
    complaintById,
    complaintUpdates,
    updateComplaint,
    allComplaints,
    analytics,
    userNotifications,
    markNotificationsRead,
    escalateOverdueComplaints,
    exportBackup
  };

  seedData();
})();
