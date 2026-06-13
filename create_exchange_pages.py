from pathlib import Path
root = Path('admin')
new_pages = [
    ('account-management.html', 'Account Management'),
    ('user-level.html', 'User Level'),
    ('withdrawal-records.html', 'Withdrawal records'),
    ('recharge-review.html', 'Recharge Review'),
    ('top-up-records.html', 'Top-up records'),
    ('feedback.html', 'Feedback'),
    ('user-invitation-records.html', 'User Invitation Records'),
    ('new-withdrawal-records.html', 'New Withdrawal Records'),
    ('product-management.html', 'Product Management'),
]

template = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <link rel="stylesheet" href="../styles.css" />
</head>
<body>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <div class="admin-brand">
        <div class="admin-logo">K</div>
        <a href="admin.html" class="admin-title">Coinbase Backstage Management System</a>
      </div>
      <nav class="admin-menu">
        <!-- nav will be replaced -->
      </nav>
    </aside>
    <div class="admin-main">
      <header class="admin-header">
        <div class="admin-search">
          <span class="search-icon">🔎</span>
          <input type="text" placeholder="Search Menu" aria-label="Search Menu" />
        </div>
        <div class="admin-header-actions">
          <button class="admin-pill">Start voice broadcast</button>
          <button class="admin-pill">Primary certification audit (0)</button>
          <button class="admin-pill">Advanced Certification Audit (0)</button>
          <button class="admin-pill">Withdrawal Review (0)</button>
          <button class="admin-pill">Cycle contracts (0)</button>
          <button class="admin-pill">Recharge Review (0)</button>
        </div>
        <div class="admin-profile">
          <button class="icon-button">🌐</button>
          <button class="icon-button">⚙️</button>
          <div class="profile-badge">a</div>
          <span>admin</span>
        </div>
      </header>
      <div class="admin-page-header">
        <div>
          <div class="admin-page-title">{title}</div>
          <div class="admin-breadcrumb">Home / Exchange / {title}</div>
        </div>
      </div>
      <main class="admin-dashboard admin-menu-management">
        <div class="admin-layout-grid">
          <section class="admin-panel">
            <div class="panel-header">
              <div>{title}</div>
            </div>
            <p>Placeholder content for {title}.</p>
          </section>
        </div>
      </main>
    </div>
  </div>
</body>
</html>
'''

for fname, title in new_pages:
    path = root / fname
    if not path.exists():
        path.write_text(template.format(title=title), encoding='utf-8')
print('created', len(new_pages), 'exchange submenu pages')
