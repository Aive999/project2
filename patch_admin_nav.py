from pathlib import Path
import re

root = Path(r'c:\Users\Judith\Documents\project2\admin')
nav_groups = [
    {
        'label': 'System Management',
        'href': 'admin.html',
        'children': [
            ('menu-management.html', 'Menu Management'),
            ('role-management.html', 'Role Management'),
            ('organization-maintenance.html', 'Organization Maintenance'),
            ('post-maintenance.html', 'Post Maintenance'),
            ('user-configuration.html', 'User Configuration'),
            ('data-dictionary.html', 'Data Dictionary'),
            ('online-users.html', 'Online Users'),
            ('login.html', 'Log In'),
            ('operation-log.html', 'Operation Log'),
            ('kline-api-config.html', 'K-line API Configuration'),
        ],
    },
    {
        'label': 'System Monitoring',
        'href': 'system-monitoring.html',
        'children': [
            ('server-monitor.html', 'Server Monitor'),
            ('cache-monitor.html', 'Cache Monitor'),
        ],
    },
    {
        'label': 'Task Management',
        'href': 'task-management.html',
        'children': [
            ('#', 'Task Queues'),
            ('#', 'Scheduled Tasks'),
            ('#', 'Task History'),
        ],
    },
    {
        'label': 'Generator Code',
        'href': 'generator-code.html',
        'children': [
            ('erupt-code.html', 'Erupt Code'),
        ],
    },
    {
        'label': 'Exchange',
        'href': 'exchange.html',
        'children': [
            ('account-management.html', 'Account Management'),
            ('user-level.html', 'User Level'),
            ('withdrawal-records.html', 'Withdrawal Records'),
            ('recharge-review.html', 'Recharge Review'),
            ('top-up-records.html', 'Top-up Records'),
            ('feedback.html', 'Feedback'),
            ('user-invitation-records.html', 'User Invitation Records'),
            ('new-withdrawal-records.html', 'New Withdrawal Records'),
            ('product-management.html', 'Product Management'),
        ],
    },
    {
        'label': 'Loan Management',
        'href': 'loan-management.html',
        'children': [
            ('loan-setup.html', 'Loan Setup'),
            ('loan-review.html', 'Loan Review'),
        ],
    },
    {
        'label': 'Asset Management',
        'href': 'asset-management.html',
        'children': [
            ('seconds-contracts.html', 'Seconds Contract'),
            ('new-spot-points.html', 'New Spot Points'),
            ('spot-asset-list.html', 'List of Spot Assets'),
            ('contract-asset-list.html', 'List of Contract Assets'),
            ('locked-mining-assets.html', 'Locked Mining Assets'),
        ],
    },
    {
        'label': 'Order Management',
        'href': 'order-management.html',
        'children': [
            ('spot-flow-records.html', 'Spot Flow Records'),
            ('spot-exchange-trades.html', 'Spot Exchange Trades'),
            ('cycle-contracts-trades.html', 'Cycle Contracts Trades'),
        ],
    },
    {
        'label': 'Content Management',
        'href': 'content-management.html',
        'children': [
            ('locked-mining.html', 'Locked Mining'),
            ('copywriting-management.html', 'Copywriting Management'),
        ],
    },
    {
        'label': 'Certification Management',
        'href': 'certification-audit.html',
        'children': [
            ('primary-real-name.html', 'Primary Real Name'),
            ('advanced-real-name.html', 'Advanced Real Name'),
        ],
    },
]

base = '''      <nav class="admin-menu">
{groups}
      </nav>'''


def render_group(group, current_file):
    active = ' active' if current_file == group['href'] or any(href == current_file for href, _ in group['children']) else ''
    open_attr = ' open' if active else ''
    lines = [
        f'        <details class="admin-menu-group"{open_attr}>',
        f'          <summary class="admin-menu-item{active}">',
        f'            <a href="{group["href"]}">{group["label"]}</a>',
        '            <span class="menu-arrow"></span>',
        '          </summary>',
        '          <div class="admin-submenu">',
    ]
    for href, text in group['children']:
        active_sub = ' active' if href == current_file else ''
        lines.append(f'            <a href="{href}" class="admin-submenu-item{active_sub}">{text}</a>')
    lines.extend(['          </div>', '        </details>'])
    return '\n'.join(lines)

for path in sorted(root.glob('*.html')):
    content = path.read_text(encoding='utf-8')
    current = path.name
    groups = [render_group(group, current) for group in nav_groups]
    new_nav = base.format(groups='\n'.join(groups))
    content_new, n = re.subn(r'<nav class="admin-menu">.*?</nav>', new_nav, content, flags=re.S)
    if n != 1:
        print(f'WARN: {path.name} replaced {n} nav blocks')
    path.write_text(content_new, encoding='utf-8')
print('Updated nav on', len(list(root.glob('*.html'))), 'files')
