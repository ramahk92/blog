# College Complaint Portal

This repository now hosts a front-end complaint portal for college facilities.

> ⚠️ Demo-only warning: authentication runs entirely client-side and stores user data in browser localStorage. Even with salted SHA-256 hashes, this is not production-grade security and must be replaced with server-side auth/storage in real deployments.

## Scope and roles
- **Student**: register/login, submit complaint, track status and updates.
- **Admin/Staff**: view queue, assign complaint, update status, close/reject complaints.
- Categories: **Library, Lab, Hostel, Wi-Fi, Other**.

## Core pages
- `index.html` - Home page
- `register.html` - Student registration
- `login.html` - Login
- `student-dashboard.html` - Student dashboard
- `admin-dashboard.html` - Admin dashboard
- `faq.html` - FAQ/help

## Data model (client-side localStorage)
- `cp_users`: users with role/profile fields
- `cp_complaints`: complaint records (title, category, priority, status, due date, assignment, attachment metadata)
- `cp_updates`: complaint activity log / timeline
- `cp_notifications`: notification records
- `cp_current_user`: current session user

## Security and quality controls implemented
- Input sanitization for user-provided text
- Basic validation for all forms
- Role-based access checks for student/admin pages
- Rate limiting for complaint submission (max 3 in 10 minutes per student)
- File upload restrictions: PNG/JPG/WEBP/PDF, max 2MB
- Audit trail through complaint updates timeline

## Workflow and transparency
- Status lifecycle: Submitted → In Review → In Progress → Resolved/Rejected
- Priority levels: Low/Medium/High
- Notifications generated on complaint updates
- Escalation flag is automatically applied when open complaints pass expected resolution date

## Seed data
- Admin account created automatically on first load:
  - Email: `admin@college.edu`
  - Password: `Admin@123`

## Deployment and operations
This is a static site. Host these files on any static web server.

### Backup procedure
- Login as admin and click **Export Backup** on dashboard.
- Store the generated JSON file securely.

### Monitoring guidance
- Monitor volume of escalated complaints from admin analytics.
- Periodically export backups for continuity.

### Complaint handling SOP (admin)
1. Review newly submitted complaints.
2. Assign each complaint to responsible staff/team.
3. Update status as progress occurs.
4. Add clear notes for every status change.
5. Resolve/reject with final resolution reason.
6. Check escalated items daily and prioritize them.
